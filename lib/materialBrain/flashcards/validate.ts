import { normalizeSemanticText } from '../identity'
import { normalizeAcademicContent } from '../../academic-content/validation'
import type { FlashcardDeckCoverage, FlashcardPlan, GeneratedFlashcard } from './types'
import type { MaterialBrain } from '../types'
import { DOCUMENT_METADATA_TOPIC_PATTERN } from '../academicRole'

export const TERMINAL_REJECTION_REASONS: ReadonlySet<string> = new Set([
  'non_studyable_document_metadata',
  'non_studyable_document_scope_question',
])

export function isTerminalRejection(reasons: string[]): boolean {
  return reasons.length > 0 && reasons.every(r => TERMINAL_REJECTION_REASONS.has(r))
}

const SEMANTIC_DUPLICATE_THRESHOLD = 0.95

function jaccard(a: string, b: string): number {
  const tokensA = new Set(a.split(/\s+/).filter(Boolean))
  const tokensB = new Set(b.split(/\s+/).filter(Boolean))
  if (tokensA.size === 0 || tokensB.size === 0) return 0
  let intersection = 0
  for (const t of tokensA) if (tokensB.has(t)) intersection++
  const union = tokensA.size + tokensB.size - intersection
  return union === 0 ? 0 : intersection / union
}

function objectiveKey(unitIds: string[], relationIds: string[], objective: string): string {
  return [
    [...unitIds].sort().join(','),
    [...relationIds].sort().join(','),
    normalizeSemanticText(objective),
  ].join('||')
}

export function validateDeck(cards: GeneratedFlashcard[], plan: FlashcardPlan, brain?: MaterialBrain): GeneratedFlashcard[] {
  const result: GeneratedFlashcard[] = cards.map(c => ({ ...c, validationErrors: [...c.validationErrors], validated: false }))

  const objectiveSeen = new Map<string, number>()
  for (let i = 0; i < result.length; i++) {
    const c = result[i]
    const key = objectiveKey(c.sourceUnitIds, c.sourceRelationIds, c.retrievalObjective)
    if (objectiveSeen.has(key)) {
      c.validationErrors.push('duplicate_objective')
    } else {
      objectiveSeen.set(key, i)
    }
  }

  const active: number[] = []
  for (let i = 0; i < result.length; i++) {
    if (!result[i].validationErrors.includes('duplicate_objective')) active.push(i)
  }

  for (let a = 0; a < active.length; a++) {
    const idxA = active[a]
    const cardA = result[idxA]
    if (cardA.validationErrors.length > 0) continue
    const normA = normalizeSemanticText(cardA.question)
    for (let b = a + 1; b < active.length; b++) {
      const idxB = active[b]
      const cardB = result[idxB]
      if (cardB.validationErrors.length > 0) continue
      const normB = normalizeSemanticText(cardB.question)
      if (jaccard(normA, normB) >= SEMANTIC_DUPLICATE_THRESHOLD) {
        cardB.validationErrors.push('semantic_duplicate_question')
      }
    }
  }

  for (const c of result) {
    if (!c.question.trim() || !c.answer.trim()) {
      if (!c.validationErrors.includes('empty_question_or_answer')) {
        c.validationErrors.push('empty_question_or_answer')
      }
    }
    c.validated = c.validationErrors.length === 0
  }

  const CORRUPTION_PATTERNS: RegExp[] = [
    /\*{3,}/,
    /\\{2,}[a-zA-Z]/,
    /\[\*+[^\]]*\*+\]/,
  ]
  const IMMEDIATE_SELF_REPEAT = /([^\s]{4,})\1/
  function hasCorruptionArtifacts(text: string): boolean {
    return CORRUPTION_PATTERNS.some(pattern => pattern.test(text)) || IMMEDIATE_SELF_REPEAT.test(text)
  }

  for (const c of result) {
    if (!c.validated) continue
    const questionCheck = normalizeAcademicContent(c.question)
    const answerCheck = normalizeAcademicContent(c.answer)
    if (questionCheck.requiresRegeneration || answerCheck.requiresRegeneration
      || hasCorruptionArtifacts(c.question) || hasCorruptionArtifacts(c.answer)) {
      c.validationErrors.push('broken_academic_content')
      c.validated = false
    }
  }

  for (const c of result) {
    if (!c.validated) continue
    const verdict = detectCircularOrLeaked(c.question, c.answer)
    if (verdict) {
      c.validationErrors.push(verdict)
      c.validated = false
    }
  }

  if (brain) {
    const unitById = new Map(brain.units.map(u => [u.id, u]))
    for (const c of result) {
      if (!c.validated) continue
      if (c.sourceUnitIds.length !== 1) continue
      const unit = unitById.get(c.sourceUnitIds[0])
      if (!unit) continue
      if (unit.kind !== 'fact' && unit.kind !== 'event_or_data') continue
      if (!looksLikeNakedValueQuestion(c.question)) continue

      if (unit.kind === 'event_or_data' && unit.identity.qualifiers.length === 0) {
        c.validationErrors.push('contextless_question')
        c.validated = false
        continue
      }
      if (unit.identity.qualifiers.length === 0) continue
      c.question = repairContextlessQuestion(c.question, unit.displayQualifiers || [])
      const identityTokens = new Set(
        normalizeSemanticText(unit.identity.qualifiers.join(' ')).split(' ').filter(Boolean),
      )
      const qTokens = new Set(normalizeSemanticText(c.question).split(' ').filter(Boolean))
      const hasIdentifyingContext = [...identityTokens].some(t => qTokens.has(t))
      if (!hasIdentifyingContext) {
        c.validationErrors.push('contextless_question')
        c.validated = false
      }
    }
  }

  if (brain) {
    const unitById = new Map(brain.units.map(u => [u.id, u]))
    for (const c of result) {
      if (!c.validated) continue
      const relevantUnits = c.sourceUnitIds
        .map(id => unitById.get(id))
        .filter((u): u is NonNullable<typeof u> => !!u && (u.kind === 'fact' || u.kind === 'event_or_data' || u.kind === 'example'))
      if (relevantUnits.some(u => u.kind === 'event_or_data' && u.identity.qualifiers.length === 0)) {
        c.validationErrors.push('contextless_question')
        c.validated = false
        continue
      }
      const qualifiedUnits = relevantUnits.filter(u => u.identity.qualifiers.length > 0)
      if (qualifiedUnits.length === 0) continue
      const identityTokens = [...new Set(
        qualifiedUnits.flatMap(u => u.identity.qualifiers).flatMap(q => normalizeSemanticText(q).split(' ')).filter(Boolean),
      )]
      if (identityTokens.length === 0) continue
      c.question = repairContextlessQuestion(c.question, qualifiedUnits.flatMap(u => u.displayQualifiers || []))
      const qTokens = new Set(normalizeSemanticText(c.question).split(' ').filter(Boolean))
      const overlapCount = identityTokens.filter(t => qTokens.has(t)).length
      const hasIdentifyingContext = overlapCount / identityTokens.length >= 0.5
      if (!hasIdentifyingContext) {
        c.validationErrors.push('contextless_question')
        c.validated = false
      }
    }
  }

  const DOCUMENT_SELF_REFERENCE = /\b(el|este|dicho|del|de\s+(este|dicho|la))\s+(texto|documento|libro|pdf|material|fuente)\b|\bthe\s+(text|document|source|material)\b/i
  for (const c of result) {
    if (!c.validated) continue
    if (DOCUMENT_SELF_REFERENCE.test(c.question) && DOCUMENT_METADATA_TOPIC_PATTERN.test(c.question)) {
      c.validationErrors.push('non_studyable_document_metadata')
      c.validated = false
    }
  }

  const DOCUMENT_SCOPE_VERB = /\b(introduce|presenta|aborda|cubre|desarrolla|plantea)\b/i
  for (const c of result) {
    if (!c.validated) continue
    if (DOCUMENT_SELF_REFERENCE.test(c.question) && DOCUMENT_SCOPE_VERB.test(c.question)) {
      c.validationErrors.push('non_studyable_document_scope_question')
      c.validated = false
    }
  }

  const DEICTIC_REFERENT_PATTERNS: RegExp[] = [
    /seg[uú]n\s+(el|lo)\s+(texto|documento|dicho|mencionado|indicado)/i,
    /en\s+el\s+ejemplo\s+(dado|mencionado|anterior|citado)/i,
    /en\s+la\s+(reacci[oó]n|figura|gr[aá]fica|tabla)\s+(dada|mencionada|anterior|citada)/i,
    /\beste\s+sistema\b|\besta\s+gr[aá]fica\b|\beste\s+experimento\b|\bel\s+experimento\b(?!\s+de\s+\S)/i,
    /\bla\s+mezcla\b(?!\s+de\s+\S)/i,
    /\b(este|esta)\s+(caso|paciente)\b(?!\s+(de|d[eé])\s+\S)/i,
    /according to the text|in the (given|above) example|this system\b|this graph\b|the experiment\b(?!\s+with\s)|this (case|patient)\b/i,
  ]
  if (brain) {
    const unitById = new Map(brain.units.map(u => [u.id, u]))
    for (const c of result) {
      if (!c.validated) continue
      if (!DEICTIC_REFERENT_PATTERNS.some(p => p.test(c.question))) continue
      const sourceUnits = c.sourceUnitIds
        .map(id => unitById.get(id))
        .filter((u): u is NonNullable<typeof u> => !!u)
      const qualifiers = sourceUnits.flatMap(u => u.identity.qualifiers)
      const displayQualifiers = sourceUnits.flatMap(u => u.displayQualifiers || [])
      if (displayQualifiers.length > 0) c.question = repairContextlessQuestion(c.question, displayQualifiers)
      const identityTokens = new Set(
        qualifiers.flatMap(q => normalizeSemanticText(q).split(' ')).filter(Boolean),
      )
      const qTokens = new Set(normalizeSemanticText(c.question).split(' ').filter(Boolean))
      const hasIdentifyingContext = identityTokens.size > 0 && [...identityTokens].some(t => qTokens.has(t))
      if (!hasIdentifyingContext) {
        c.validationErrors.push('contextless_question')
        c.validated = false
      }
    }
  }

  const SUPERSCRIPT_DIGITS = /[⁰¹²³⁴⁵⁶⁷⁸⁹]/
  function normalizeFormulaText(text: string): string {
    return text.replace(/\\(d|t)?frac\{[^{}]*\}\{[^{}]*\}/g, m => `${m} / `)
  }
  function hasDivisionMarker(text: string): boolean {
    const t = normalizeFormulaText(text)
    return /\//.test(t) || /\\frac/.test(t) || /÷/.test(t)
  }
  function hasExponentMarker(text: string): boolean {
    return /\^/.test(text) || SUPERSCRIPT_DIGITS.test(text) || /\*\*/.test(text)
  }
  if (brain) {
    const unitById = new Map(brain.units.map(u => [u.id, u]))
    for (const c of result) {
      if (!c.validated) continue
      const cardText = `${c.question} ${c.answer}`
      for (const unitId of c.sourceUnitIds) {
        const u = unitById.get(unitId)
        if (!u || u.kind !== 'formula') continue
        const symbols = u.variables.map(v => v.symbol).filter(Boolean)
        const allSymbolsPresent = symbols.length > 0 && symbols.every(s => cardText.includes(s))
        if (!allSymbolsPresent) continue
        const authorized = u.expression
        const lostDivision = hasDivisionMarker(authorized) && !hasDivisionMarker(cardText)
        const lostExponent = hasExponentMarker(authorized) && !hasExponentMarker(cardText)
        if (lostDivision || lostExponent) {
          c.validationErrors.push('formula_structure_mismatch')
          c.validated = false
          break
        }
      }
    }
  }

  function extractCompactNotationTokens(text: string): string[] {
    return [...new Set(text.match(/[A-Za-zΑ-Ωα-ω]+\d+|\d+[A-Za-zΑ-Ωα-ω]+/g) || [])]
  }
  function extractMarkerJoinedTokens(text: string): { letters: string; digits: string }[] {
    const matches = text.match(/[A-Za-zΑ-Ωα-ω]+[_^]\{?\d+\}?/g) || []
    return matches
      .map(m => m.match(/^([A-Za-zΑ-Ωα-ω]+)[_^]\{?(\d+)\}?$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map(m => ({ letters: m[1], digits: m[2] }))
  }
  function normalizeForNotationCompare(text: string): string {
    return text
      .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
      .replace(/\$([^$]*)\$/g, '$1')
      .replace(/_\{([^}]*)\}/g, '$1')
      .replace(/\^\{([^}]*)\}/g, '$1')
      .replace(/_([A-Za-z0-9])/g, '$1')
      .replace(/\^([A-Za-z0-9])/g, '$1')
  }
  const RELATIONAL_OPERATOR_PATTERN = />>|<<|>=|<=|≫|≪|→|←|⇌|±|≈|≠|>|</
  function hasRelationalOperatorMarker(text: string): boolean {
    return RELATIONAL_OPERATOR_PATTERN.test(text)
  }

  const RELATIONAL_VERBAL_EQUIVALENT_PATTERN = /much[oa]s?\s+mayor(es)?\s+que|much[oa]s?\s+menor(es)?\s+que|muy\s+superior(es)?\s+a|muy\s+inferior(es)?\s+a|predomina(n)?\s+sobre|domina(n)?\s+sobre|aproximadamente\s+igual(es)?\s+a|se\s+(convierte|transforma)\s+en|da(n)?\s+lugar\s+a|conduce(n)?\s+a|en\s+equilibrio\s+con|reacciona(n)?\s+(de\s+forma\s+)?reversible(mente)?\s+con|much\s+(greater|less)\s+than|far\s+exceeds|approximately\s+equal\s+to|converts?\s+(in)?to|leads?\s+to|(is|are)\s+in\s+equilibrium\s+with/i
  function hasRelationalVerbalEquivalent(text: string): boolean {
    return RELATIONAL_VERBAL_EQUIVALENT_PATTERN.test(text)
  }
  const RELATIONAL_OPERATOR_WINDOW = /.{0,25}(?:>>|<<|>=|<=|≫|≪|→|←|⇌|±|≈|≠|>|<)\S*.{0,25}/g
  const GREEK_SYMBOL_PATTERN = /[Α-Ωα-ω]|\\(Delta|delta|alpha|beta|gamma|Gamma|theta|Theta|lambda|Lambda|mu|pi|Pi|sigma|Sigma|omega|Omega|phi|Phi|psi|Psi|epsilon|nu|tau|chi|rho)\b/
  const GREEK_SYMBOL_WINDOW = /.{0,25}(?:[Α-Ωα-ω]|\\(?:Delta|delta|alpha|beta|gamma|Gamma|theta|Theta|lambda|Lambda|mu|pi|Pi|sigma|Sigma|omega|Omega|phi|Phi|psi|Psi|epsilon|nu|tau|chi|rho)\b)\S*.{0,25}/g
  function hasGreekSymbol(text: string): boolean {
    return GREEK_SYMBOL_PATTERN.test(text)
  }
  function splitLetterDigit(token: string): { letters: string; digits: string; digitsFirst: boolean } | null {
    const m1 = token.match(/^([A-Za-zΑ-Ωα-ω]+)(\d+)$/)
    if (m1) return { letters: m1[1], digits: m1[2], digitsFirst: false }
    const m2 = token.match(/^(\d+)([A-Za-zΑ-Ωα-ω]+)$/)
    if (m2) return { letters: m2[2], digits: m2[1], digitsFirst: true }
    return null
  }
  if (brain) {
    const unitById = new Map(brain.units.map(u => [u.id, u]))
    for (const c of result) {
      if (!c.validated) continue
      const cardTextRaw = `${c.question} ${c.answer}`
      const cardTextNormalized = normalizeForNotationCompare(cardTextRaw)
      for (const unitId of c.sourceUnitIds) {
        const u = unitById.get(unitId)
        if (!u) continue
        const sourceText = u.kind === 'formula' ? `${u.statement} ${u.expression}` : u.statement
        const tokens = extractCompactNotationTokens(sourceText)
        let broken = false
        let lostPreservation: string | null = null
        for (const token of tokens) {
          if (cardTextNormalized.includes(token)) continue
          const parts = splitLetterDigit(token)
          if (!parts) continue
          const spacedVariant = parts.digitsFirst ? `${parts.digits} ${parts.letters}` : `${parts.letters} ${parts.digits}`
          if (cardTextRaw.includes(spacedVariant)) { broken = true; lostPreservation = token; break }
        }
        if (!broken) {
          const cardOutsideMath = cardTextRaw.replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\$[^$]*\$/g, ' ')
          for (const { letters, digits } of extractMarkerJoinedTokens(sourceText)) {
            const fused = `${letters}${digits}`
            if (cardOutsideMath.includes(fused)) { broken = true; lostPreservation = `${letters}_${digits}`; break }
          }
        }
        const restatesFusedToken = tokens.some(t => cardTextNormalized.includes(t))
        const restatedBracketTokens = (sourceText.match(/\[[^\[\]]{1,20}\]/g) || []).filter(t => cardTextRaw.includes(t))
        const restatesBracketToken = restatedBracketTokens.length > 0
        const mantissas = (sourceText.match(/\d+\.\d+/g) || []).filter(m => cardTextRaw.includes(m))
        const restatesMantissa = mantissas.length > 0
        if (!broken && (restatesFusedToken || restatesMantissa || restatesBracketToken)) {
          const lostDivision = hasDivisionMarker(sourceText) && !hasDivisionMarker(cardTextRaw)
          const lostExponent = hasExponentMarker(sourceText) && !hasExponentMarker(cardTextRaw)
          if (lostDivision || lostExponent) {
            broken = true
            const anchor = restatesMantissa ? mantissas[0] : (tokens.find(t => cardTextNormalized.includes(t)) || restatedBracketTokens[0])
            lostPreservation = anchor ? `${lostDivision ? 'division' : 'exponent'} in ${anchor}` : (lostDivision ? 'division structure' : 'exponent structure')
          }
        }
        if (!broken && hasRelationalOperatorMarker(sourceText)) {
          const windows = sourceText.match(RELATIONAL_OPERATOR_WINDOW) || []
          for (const w of windows) {
            const windowTokens = normalizeSemanticText(w).split(' ').filter(Boolean)
            if (windowTokens.length === 0) continue
            const overlap = windowTokens.filter(t => cardTextNormalized.includes(t)).length
            const restatesThisComparison = overlap / windowTokens.length >= 0.5
            if (restatesThisComparison && !hasRelationalOperatorMarker(cardTextRaw) && !hasRelationalVerbalEquivalent(cardTextRaw)) {
              broken = true; lostPreservation = w.trim(); break
            }
          }
        }
        if (!broken && hasGreekSymbol(sourceText)) {
          const windows = sourceText.match(GREEK_SYMBOL_WINDOW) || []
          for (const w of windows) {
            const windowTokens = normalizeSemanticText(w).split(' ').filter(Boolean)
            if (windowTokens.length === 0) continue
            const overlap = windowTokens.filter(t => cardTextNormalized.includes(t)).length
            const restatesThisContext = overlap / windowTokens.length >= 0.5
            if (restatesThisContext && !hasGreekSymbol(cardTextRaw)) { broken = true; lostPreservation = w.trim(); break }
          }
        }
        if (broken) {
          c.validationErrors.push('notation_structure_lost')
          c.validated = false
          if (lostPreservation) {
            if (!c.requiredPreservations) c.requiredPreservations = []
            c.requiredPreservations.push(lostPreservation)
          }
          break
        }
      }
    }
  }

  const VACUOUS_CONTEXT_ANSWER = /^(en (el|la) (contexto|ambito|marco) de|in the context of|within the (context|field|scope) of)\s+.{1,40}\.?$/i
  const RELATIONAL_QUESTION = /relacionad|related/i
  const BARE_RELATION_ANSWER = /^(con|with)\s+[^.?!]{1,40}\.?$/i
  const VAGUE_RELATION_QUESTION = /¿?\s*(con|a)\s+qu[eé]\s+(concepto|tema|idea|principio)s?\s+(est[aá]n?|se\s+(encuentra|relaciona))n?\s+relacionad/i
  const UNSPECIFIC_RETRIEVAL_QUESTION = /¿?\s*(en\s+qu[eé]\s+(contexto|[aá]mbito|marco)|qu[eé]\s+(es\s+posible|se\s+puede[n]?|se\s+debe[n]?)\s+(calcular|obtener|determinar|derivar)|de\s+qu[eé]\s+depende|c[oó]mo\s+se\s+(puede[n]?)\s+(obtener|calcular|determinar)|qu[eé]\s+establece\s+el\s+concepto\s+de|qu[eé]\s+se\s+calcula\s+en\s+el\s+proceso\s+de|cu[aá]l\s+es\s+el\s+paso\s+para|cu[aá]l\s+es\s+la\s+caracter[ií]stica\s+principal\s+de)\b/i
  for (const c of result) {
    if (!c.validated) continue
    const answer = c.answer.trim()
    if (VACUOUS_CONTEXT_ANSWER.test(answer)
      || (RELATIONAL_QUESTION.test(c.question) && BARE_RELATION_ANSWER.test(answer))
      || VAGUE_RELATION_QUESTION.test(c.question)
      || UNSPECIFIC_RETRIEVAL_QUESTION.test(c.question)) {
      c.validationErrors.push('low_information_value')
      c.validated = false
    }
  }

  const TEMPLATE_LEAKAGE_THRESHOLD = 0.6
  for (const c of result) {
    if (!c.validated) continue
    if (!c.retrievalObjective) continue
    const qNorm = normalizeSemanticText(c.question)
    const objNorm = normalizeSemanticText(c.retrievalObjective)
    if (jaccard(qNorm, objNorm) >= TEMPLATE_LEAKAGE_THRESHOLD) {
      c.validationErrors.push('template_leakage')
      c.validated = false
    }
  }

  if (brain) {
    const knownLabels = new Set(brain.units.map(u => normalizeSemanticText(u.label)).filter(Boolean))
    const QUOTED_SPAN = /['"‘’“”«»]([^'"‘’“”«»]{3,80})['"‘’“”«»]/g
    for (const c of result) {
      if (!c.validated || knownLabels.size === 0) continue
      let match: RegExpExecArray | null
      QUOTED_SPAN.lastIndex = 0
      while ((match = QUOTED_SPAN.exec(c.question))) {
        if (knownLabels.has(normalizeSemanticText(match[1]))) {
          c.validationErrors.push('internal_label_leakage')
          c.validated = false
          break
        }
      }
    }
  }

  function hasUnwrappedMathMarkers(text: string): boolean {
    const outsideMath = text.replace(/\DisposableSpanRegExp/g, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\$[^$]*\$/g, ' ')
    return /_/.test(outsideMath) || /\^/.test(outsideMath) || /\\[a-zA-Z]/.test(outsideMath)
  }
  for (const c of result) {
    if (!c.validated) continue
    const repairedQuestion = repairUnwrappedNotation(c.question)
    const repairedAnswer = repairUnwrappedNotation(c.answer)
    if (hasUnwrappedMathMarkers(repairedQuestion) || hasUnwrappedMathMarkers(repairedAnswer)) {
      c.validationErrors.push('unwrapped_notation')
      c.validated = false
    } else if (repairedQuestion !== c.question || repairedAnswer !== c.answer) {
      c.question = repairedQuestion
      c.answer = repairedAnswer
    }
  }

  return result
}

const WH_OPENER = /^\s*(¿)?(qu[eé]|cu[aá]l(es)?|cu[aá]nto[a]?s?|c[oó]mo|what|which|how (much|many)|who)(?=\s|$)/i
const MAX_NAKED_QUESTION_WORDS = 9
function looksLikeNakedValueQuestion(question: string): boolean {
  const trimmed = question.trim()
  if (!WH_OPENER.test(trimmed)) return false
  const wordCount = trimmed.replace(/[¿?.,]/g, '').split(/\s+/).filter(Boolean).length
  return wordCount <= MAX_NAKED_QUESTION_WORDS
}

export function detectCircularOrLeaked(question: string, answer: string): 'answer_leaked_in_question' | 'circular_question_answer' | null {
  const qNorm = normalizeSemanticText(question)
  const aNorm = normalizeSemanticText(answer)
  if (!aNorm) return null
  const aTokens = aNorm.split(' ').filter(Boolean)
  if (!aTokens.length) return null

  if (aTokens.length >= 2 && qNorm.includes(aNorm)) return 'answer_leaked_in_question'

  if (aTokens.length <= 6) {
    const qTokens = new Set(qNorm.split(' ').filter(Boolean))
    const covered = aTokens.filter(t => qTokens.has(t)).length
    if (covered / aTokens.length >= 0.8) return 'circular_question_answer'
  }

  return null
}

function questionNamesConflictingInstance(question: string, qualifiers: string[]): boolean {
  const candidatePattern = /\b\p{Lu}[\p{L}]*\s+(?:\p{Lu}[\p{L}]*|\d+)\b/gu
  const candidates = question.match(candidatePattern) || []
  if (candidates.length === 0) return false
  const normalizedQualifiers = new Set(qualifiers.map(q => normalizeSemanticText(q)))
  return candidates.some(c => !normalizedQualifiers.has(normalizeSemanticText(c)))
}

export function repairContextlessQuestion(question: string, qualifiers: string[]): string {
  if (qualifiers.length === 0) return question
  // Callers may flatMap displayQualifiers across MULTIPLE source units of a
  // consolidated card — several of those units can legitimately carry the
  // exact same qualifier string (e.g. same species, different table row).
  // Deduplicate here, once, so no caller can ever produce "En el contexto
  // de H2, H2, H2: ..." by repeating the same value N times.
  const dedupedQualifiers = [...new Set(qualifiers)]
  const contextPrefix = dedupedQualifiers.join(', ')
  const identityTokens = normalizeSemanticText(contextPrefix).split(' ').filter(Boolean)
  if (identityTokens.length === 0) return question
  const qTokens = new Set(normalizeSemanticText(question).split(' ').filter(Boolean))
  if (identityTokens.some(t => qTokens.has(t))) return question
  if (questionNamesConflictingInstance(question, qualifiers)) return question
  return `En el contexto de ${contextPrefix}: ${question}`
}

function findBalancedBraceEnd(text: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function consumeLatexMacroSpan(text: string, start: number): number | null {
  let i = start + 1
  while (i < text.length && /[a-zA-Z]/.test(text[i])) i++
  if (i === start + 1) return null
  while (i < text.length && text[i] === '{') {
    const end = findBalancedBraceEnd(text, i)
    if (end === -1) break
    i = end + 1
  }
  return i
}

const IDENTIFIER_MARKER_TOKEN = /[A-Za-zΑ-Ωα-ω0-9]+(?:[_^]\{?[A-Za-z0-9+\-]+\}?)+/y

function repairUnwrappedNotationSegment(part: string): string {
  let out = ''
  let i = 0
  while (i < part.length) {
    if (part[i] === '\\') {
      const end = consumeLatexMacroSpan(part, i)
      if (end !== null) {
        out += `$${part.slice(i, end)}$`
        i = end
        continue
      }
    }
    IDENTIFIER_MARKER_TOKEN.lastIndex = i
    const m = IDENTIFIER_MARKER_TOKEN.exec(part)
    if (m && m.index === i) {
      out += `$${m[0]}$`
      i += m[0].length
      continue
    }
    out += part[i]
    i++
  }
  return out
}

export function repairUnwrappedNotation(text: string): string {
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$]*\$)/g)
  return parts
    .map(part => {
      if (part.startsWith('$')) return part
      return repairUnwrappedNotationSegment(part)
    })
    .join('')
}

export interface CoverageTransfer {
  targetId: string
  cardId: string
  sharedSourceUnitIds: string[]
  transferType: 'direct' | 'transfer'
}

export interface ReconciledCoverage {
  coveredTargetIds: string[]
  pendingTargetIds: string[]
  coverageTransfers: CoverageTransfer[]
}

export function reconcileFinalCoverage(finalCards: GeneratedFlashcard[], plan: FlashcardPlan): ReconciledCoverage {
  const validCards = finalCards.filter(c => c.validated)

  const targetSourceUnits = new Map<string, Set<string>>()
  for (const pc of plan.plannedCards) {
    if (!pc.conceptClusterId) continue
    const set = targetSourceUnits.get(pc.conceptClusterId) || new Set<string>()
    for (const id of pc.sourceUnitIds) set.add(id)
    targetSourceUnits.set(pc.conceptClusterId, set)
  }

  const coveredTargetIds: string[] = []
  const coverageTransfers: CoverageTransfer[] = []
  for (const [targetId, requiredUnits] of targetSourceUnits) {
    const directCard = validCards.find(c => c.conceptClusterId === targetId)
    if (directCard) {
      coveredTargetIds.push(targetId)
      coverageTransfers.push({
        targetId, cardId: directCard.id,
        sharedSourceUnitIds: directCard.sourceUnitIds.filter(id => requiredUnits.has(id)),
        transferType: 'direct',
      })
      continue
    }
    let bestCard: GeneratedFlashcard | undefined
    let bestShared: string[] = []
    for (const c of validCards) {
      const shared = c.sourceUnitIds.filter(id => requiredUnits.has(id))
      if (shared.length > bestShared.length) { bestCard = c; bestShared = shared }
    }
    if (bestCard && bestShared.length > 0) {
      coveredTargetIds.push(targetId)
      coverageTransfers.push({ targetId, cardId: bestCard.id, sharedSourceUnitIds: bestShared, transferType: 'transfer' })
    }
  }

  const targetIds = [...targetSourceUnits.keys()]
  const coveredSet = new Set(coveredTargetIds)
  const pendingTargetIds = targetIds.filter(id => !coveredSet.has(id))
  return { coveredTargetIds, pendingTargetIds, coverageTransfers }
}

export function computeDeckCoverage(cards: GeneratedFlashcard[], plan: FlashcardPlan): FlashcardDeckCoverage {
  const validCards = cards.filter(c => c.validated)
  const failedCards = cards.filter(c => !c.validated)

  const targetedUnitIds = [...new Set(plan.targetedUnitIds)]
  const targetedRelationIds = [...new Set(plan.targetedRelationIds)]

  const coveredUnitIds = [...new Set(validCards.flatMap(c => c.sourceUnitIds))]
    .filter(id => targetedUnitIds.includes(id))
  const coveredRelationIds = [...new Set(validCards.flatMap(c => c.sourceRelationIds))]
    .filter(id => targetedRelationIds.includes(id))

  const targetedConceptClusterIds = [...new Set(plan.plannedCards.map(c => c.conceptClusterId).filter(Boolean))]
  const coveredConceptClusterIds = reconcileFinalCoverage(cards, plan).coveredTargetIds

  const unitSetComplete =
    targetedUnitIds.length === 0 ||
    targetedUnitIds.every(id => coveredUnitIds.includes(id))
  const relationSetComplete =
    targetedRelationIds.length === 0 ||
    targetedRelationIds.every(id => coveredRelationIds.includes(id))

  let status: FlashcardDeckCoverage['status']
  if (targetedUnitIds.length === 0 && targetedRelationIds.length === 0) {
    status = 'complete'
  } else if (unitSetComplete && relationSetComplete && validCards.length > 0) {
    status = 'complete'
  } else if (validCards.length > 0) {
    status = 'partial'
  } else {
    status = 'failed'
  }

  return {
    targetedUnitIds,
    targetedRelationIds,
    coveredUnitIds,
    coveredRelationIds,
    targetedConceptClusterIds,
    coveredConceptClusterIds,
    status,
    metrics: {
      plannedCards: cards.length,
      validCards: validCards.length,
      failedCards: failedCards.length,
      targetedUnits: targetedUnitIds.length,
      coveredUnits: coveredUnitIds.length,
      targetedRelations: targetedRelationIds.length,
      coveredRelations: coveredRelationIds.length,
      targetedConcepts: targetedConceptClusterIds.length,
      coveredConcepts: coveredConceptClusterIds.length,
    },
  }
}
