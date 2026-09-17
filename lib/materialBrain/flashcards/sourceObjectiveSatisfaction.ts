import { normalizeSemanticText } from '../identity'
import type { KnowledgeUnit } from '../types'
import type { PlannedCard } from './types'

// ============================================================
// SOURCE-OBJECTIVE SATISFACTION — a new, independent authority.
//
// This module deliberately separates two responsibilities that a single
// "answer vs source overlap" metric used to conflate (real regression:
// CASE-B — a correct, heavily-paraphrased answer over a short source
// statement was hard-rejected for near-zero lexical overlap, exactly the
// false positive this split exists to prevent):
//
//   1. OBJECTIVE RECOVERY — does the ANSWER contribute real academic
//      content beyond what the QUESTION already presupposes? This never
//      looks at the source at all. A card that just restates its own
//      question back as a declarative sentence ("Existe una relación
//      entre X y Y" answering "¿Qué relación existe entre X y Y?") fails
//      here regardless of how well X/Y happen to match the source.
//
//   2. SOURCE SUPPORT — is whatever the answer DOES claim backed by the
//      card's own source units? For kinds with strong structure
//      (formula/definition/terminology/process) this checks the actual
//      structured fields. For weak-structure kinds (concept/fact/example/
//      event_or_data) lexical overlap is used ONLY as supportive
//      evidence, NEVER as proof of absence — zero overlap on a short
//      statement is exactly what a valid, heavily-reworded paraphrase
//      looks like, so it resolves to `ambiguous`, never `rejected`.
//
// A third and fourth dimension stay as before, now clearly separated in
// the evidence object:
//   3. COGNITIVE COMPLIANCE — does the answer's structure actually match
//      the declared cognitiveType, where a structural check exists
//      (procedure + ProcessUnit.steps)?
//   4. QUANTITATIVE SAFETY — for application cards, are the numbers the
//      question introduces backed by the source (Decision 2)?
//
// STATES: satisfied | rejected | ambiguous. Hard `rejected` can only come
// from objective recovery, cognitive compliance, or quantitative safety —
// source support alone can never produce `rejected` for weak-structure
// kinds, only `ambiguous`. `ambiguous` is a first-class outcome that
// re-enters the SAME retry/strategy-ladder/fuse machinery in deckStore.ts
// — never silently counted as covered, never falsely declared wrong.
// There is no second LLM judge here — everything is deterministic, and
// where determinism runs out, this module says so instead of guessing.
// ============================================================

export type SourceObjectiveReason =
  | 'objective_not_recovered'
  | 'source_support_ambiguous'
  | 'unsupported_answer_content'
  | 'cognitive_operation_not_satisfied'
  | 'quantitative_evidence_missing'
  | 'quantitative_value_unsupported'
  | 'source_evidence_missing'

export type SourceObjectiveStatus = 'satisfied' | 'rejected' | 'ambiguous'

interface ObjectiveRecoveryEvidence {
  signal: 'fast_pass' | 'fast_fail' | 'ambiguous'
  novelContentTokens: string[]
  novelTokenCount: number
  questionEchoRatio: number
}

interface SourceSupportEvidence {
  signal: 'supported' | 'ambiguous'
  sharedObjectiveTokens: string[]
  objectiveTokenCount: number
  structuralCheck?: 'formula_symbols' | 'definition_term' | 'terminology_term' | 'statement_overlap'
}

interface CognitiveOperationEvidence {
  status: 'satisfied' | 'not_satisfied' | 'not_applicable'
  stepsRepresented?: number
  stepsTotal?: number
}

interface QuantitativeEvidence {
  status: 'safe' | 'unsupported' | 'not_applicable'
  answerNumbers?: string[]
  unsupportedNumbers?: string[]
  sourceHadAnyNumericEvidence?: boolean
}

export interface SourceObjectiveEvidence {
  objectiveRecovery: ObjectiveRecoveryEvidence
  sourceSupport: SourceSupportEvidence
  cognitive: CognitiveOperationEvidence
  quantitative: QuantitativeEvidence
}

export interface SourceObjectiveResult {
  status: SourceObjectiveStatus
  reasons: SourceObjectiveReason[]
  evidence: SourceObjectiveEvidence
}

// ── shared helpers ──────────────────────────────────────────

function contentTokens(text: string): string[] {
  return normalizeSemanticText(text).split(' ').filter(Boolean)
}

// ── 1. OBJECTIVE RECOVERY (answer vs question only — never the source) ──
//
// information(answer) - information(question): the novel content tokens
// are exactly what the answer contributes beyond what was already asked.
// Two real-deck-calibrated signals, combined (neither alone separated the
// 4 confirmed-vacuous cards from real accepted cards cleanly):
//   - novelTokenCount: how many genuinely new content words the answer
//     introduces at all;
//   - questionEchoRatio: what fraction of the answer's own vocabulary is
//     just the question's vocabulary restated as a declarative sentence.
// A vacuous answer scores low on the first AND high on the second at the
// same time (confirmed against #6/#17/#38/#46); a substantive answer,
// however short, reliably has more new content and echoes the question
// less. Threshold band left deliberately narrow and ambiguous-tolerant.
const OBJECTIVE_RECOVERY_NOVEL_FLOOR = 4
const OBJECTIVE_RECOVERY_NOVEL_CEILING = 1
const OBJECTIVE_RECOVERY_ECHO_CEILING = 0.5

function evaluateObjectiveRecovery(question: string, answer: string): ObjectiveRecoveryEvidence {
  const qTokens = new Set(contentTokens(question))
  const aTokensArr = contentTokens(answer)
  const aTokensSet = new Set(aTokensArr)
  const novel = [...aTokensSet].filter(t => !qTokens.has(t))
  const echoed = aTokensSet.size - novel.length
  const questionEchoRatio = aTokensSet.size > 0 ? echoed / aTokensSet.size : 1

  if (novel.length <= OBJECTIVE_RECOVERY_NOVEL_CEILING && questionEchoRatio > OBJECTIVE_RECOVERY_ECHO_CEILING) {
    return { signal: 'fast_fail', novelContentTokens: novel, novelTokenCount: novel.length, questionEchoRatio }
  }
  if (novel.length > OBJECTIVE_RECOVERY_NOVEL_FLOOR) {
    return { signal: 'fast_pass', novelContentTokens: novel, novelTokenCount: novel.length, questionEchoRatio }
  }
  return { signal: 'ambiguous', novelContentTokens: novel, novelTokenCount: novel.length, questionEchoRatio }
}

// ── 2. SOURCE SUPPORT (structured-first, lexical overlap as evidence ──
//    only — never proof of absence for weak-structure kinds) ──────────

/** Kind-specific structured text folded into the generic overlap pool — a ProcessUnit's real content lives in its `steps`, a FormulaUnit's in its `expression`/`variables`, not necessarily in a short top-level `statement`. */
function unitEvidenceText(u: KnowledgeUnit): string {
  const parts = [u.statement, u.label]
  if (u.kind === 'formula') parts.push(u.expression, ...u.variables.map(v => `${v.symbol} ${v.meaning}`))
  if (u.kind === 'process') parts.push(...u.steps.map(s => s.text))
  if (u.kind === 'definition') parts.push(u.term)
  if (u.kind === 'terminology') parts.push(...u.aliases)
  if (u.kind === 'example') parts.push(u.illustrates)
  return parts.join(' ')
}

/**
 * Overlap is used ONLY in the positive direction here: enough shared
 * objective-bearing vocabulary is real evidence of support. Zero (or low)
 * overlap is NOT evidence of the opposite — a short source statement,
 * heavily and correctly paraphrased, looks lexically identical to an
 * unsupported answer. That case is `ambiguous`, by design, not `rejected`.
 */
const SOURCE_SUPPORT_THRESHOLD = 0.25

function statementSupportSignal(question: string, answer: string, statement: string): {
  signal: 'supported' | 'ambiguous'
  sharedTokens: string[]
  objectiveTokenCount: number
} {
  const qTokens = new Set(contentTokens(question))
  const aTokens = new Set(contentTokens(answer))
  const sTokens = contentTokens(statement)
  const objectiveTokens = [...new Set(sTokens)].filter(t => !qTokens.has(t))
  if (objectiveTokens.length === 0) return { signal: 'ambiguous', sharedTokens: [], objectiveTokenCount: 0 }
  const shared = objectiveTokens.filter(t => aTokens.has(t))
  const ratio = shared.length / objectiveTokens.length
  if (ratio >= SOURCE_SUPPORT_THRESHOLD) return { signal: 'supported', sharedTokens: shared, objectiveTokenCount: objectiveTokens.length }
  return { signal: 'ambiguous', sharedTokens: shared, objectiveTokenCount: objectiveTokens.length }
}

function evaluateSourceSupport(question: string, answer: string, units: KnowledgeUnit[]): SourceSupportEvidence {
  // Structural checks first — the strongest available signal per kind.
  const formulaUnit = units.find(u => u.kind === 'formula')
  if (formulaUnit) {
    const symbols = formulaUnit.variables.map(v => v.symbol).filter(Boolean)
    const answerNorm = answer.replace(/[\s${}\\]/g, '').toLowerCase()
    const exprNorm = formulaUnit.expression.replace(/[\s${}\\]/g, '').toLowerCase()
    const exprPresent = exprNorm.length > 0 && answerNorm.includes(exprNorm)
    const symbolsPresent = symbols.filter(s => answerNorm.includes(s.replace(/[\s${}\\]/g, '').toLowerCase()))
    if (exprPresent || symbolsPresent.length >= Math.max(1, Math.ceil(symbols.length / 2))) {
      return { signal: 'supported', sharedObjectiveTokens: symbolsPresent, objectiveTokenCount: symbols.length, structuralCheck: 'formula_symbols' }
    }
  }
  const definitionUnit = units.find(u => u.kind === 'definition')
  if (definitionUnit) {
    const termTokens = contentTokens(definitionUnit.term)
    const aTokens = new Set(contentTokens(answer))
    const termNamed = termTokens.length > 0 && termTokens.every(t => aTokens.has(t))
    const overlap = statementSupportSignal(question, answer, definitionUnit.statement)
    if (termNamed && overlap.signal === 'supported') {
      return { signal: 'supported', sharedObjectiveTokens: overlap.sharedTokens, objectiveTokenCount: overlap.objectiveTokenCount, structuralCheck: 'definition_term' }
    }
  }
  const terminologyUnit = units.find(u => u.kind === 'terminology')
  if (terminologyUnit) {
    const aliasSet = new Set([terminologyUnit.label, ...terminologyUnit.aliases].flatMap(contentTokens))
    const aTokens = new Set(contentTokens(answer))
    const anyAliasNamed = [...aliasSet].some(t => aTokens.has(t))
    const overlap = statementSupportSignal(question, answer, terminologyUnit.statement)
    if (anyAliasNamed && overlap.signal === 'supported') {
      return { signal: 'supported', sharedObjectiveTokens: overlap.sharedTokens, objectiveTokenCount: overlap.objectiveTokenCount, structuralCheck: 'terminology_term' }
    }
  }

  // Generic fallback (also the path structured kinds fall through to when
  // their structural check didn't resolve): combine every source unit's
  // evidence text. Result is EITHER 'supported' (real positive evidence)
  // or 'ambiguous' — never 'rejected'. There is no lexical signal strong
  // enough to prove a correct paraphrase absent.
  const combinedText = units.map(unitEvidenceText).join(' ')
  const overlap = statementSupportSignal(question, answer, combinedText)
  return { signal: overlap.signal, sharedObjectiveTokens: overlap.sharedTokens, objectiveTokenCount: overlap.objectiveTokenCount, structuralCheck: 'statement_overlap' }
}

// ── 3. cognitiveType compliance (only where structure allows verification) ──

const STEP_TOKEN_OVERLAP_THRESHOLD = 0.5

function evaluateCognitiveOperation(card: PlannedCard, answer: string, units: KnowledgeUnit[]): CognitiveOperationEvidence {
  if (card.cognitiveType === 'procedure') {
    const processUnit = units.find(u => u.kind === 'process')
    if (!processUnit || processUnit.steps.length < 2) return { status: 'not_applicable' }
    const aTokens = new Set(contentTokens(answer))
    let stepsRepresented = 0
    for (const step of processUnit.steps) {
      const stepTokens = contentTokens(step.text)
      if (stepTokens.length === 0) continue
      const shared = stepTokens.filter(t => aTokens.has(t))
      if (shared.length / stepTokens.length >= STEP_TOKEN_OVERLAP_THRESHOLD) stepsRepresented++
    }
    const satisfied = stepsRepresented >= Math.min(2, processUnit.steps.length)
    return { status: satisfied ? 'satisfied' : 'not_satisfied', stepsRepresented, stepsTotal: processUnit.steps.length }
  }
  // recall / comprehension / application / comparison: no structural
  // field exists today that lets this module verify the OPERATION itself
  // (as opposed to the content) without guessing — deliberately left
  // not_applicable rather than inventing a check.
  return { status: 'not_applicable' }
}

// ── 4. quantitative safety (Decision 2 — application cards only) ──────

function cleanMathText(text: string): string {
  return text
    .replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\\times|×/g, 'x')
    .replace(/[${}]/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
}

function normalizeNumStr(raw: string): string {
  const n = parseFloat(raw.replace(',', '.'))
  return Number.isFinite(n) ? String(n) : raw
}

/** Extracts numeric literals, treating "a × 10^b" / "a x 10 b" as ONE token so mantissa and exponent are never mistaken for two independent free-floating numbers. */
function extractNumericTokens(text: string): string[] {
  const cleaned = cleanMathText(text)
  const tokens: string[] = []
  const sciRe = /(-?\d+(?:\.\d+)?)\s*x\s*10\s*\^?\s*\{?\s*(-?\d+)\s*\}?/gi
  let match: RegExpExecArray | null
  while ((match = sciRe.exec(cleaned))) {
    tokens.push(`${normalizeNumStr(match[1])}e${normalizeNumStr(match[2])}`)
  }
  const withoutSci = cleaned.replace(sciRe, ' ')
  const plainRe = /-?\d+(?:\.\d+)?/g
  while ((match = plainRe.exec(withoutSci))) {
    tokens.push(normalizeNumStr(match[0]))
  }
  return tokens
}

// Scope: the numbers introduced in the QUESTION are the "given data" of
// the application scenario — those are exactly what #15/#21 (real
// deck evidence) fabricated (a Kc value and concentrations with no
// numeric example anywhere in the source formula unit). A number that
// appears ONLY in the ANSWER as the result of applying the source's own
// formula to those givens is a computed value, not a given — verifying
// that the arithmetic itself is correct would require a math-evaluation
// authority this phase deliberately does not build (Decision 2: that
// capability is deferred, not faked here). So: check the givens, not
// the arithmetic.
function evaluateQuantitativeSafety(card: PlannedCard, question: string, units: KnowledgeUnit[]): QuantitativeEvidence {
  if (card.cognitiveType !== 'application') return { status: 'not_applicable' }
  const questionNumbers = extractNumericTokens(question)
  if (questionNumbers.length === 0) return { status: 'not_applicable' }

  const sourceSurface = units.map(u => {
    const parts = [u.statement, u.label, ...u.provenance.map(p => p.quote || '')]
    if (u.kind === 'formula') parts.push(u.expression, ...u.variables.map(v => `${v.symbol} ${v.meaning}`))
    if (u.kind === 'event_or_data' && u.value) parts.push(u.value)
    return parts.join(' ')
  }).join(' ')
  const sourceNumbers = new Set(extractNumericTokens(sourceSurface))
  const sourceHadAnyNumericEvidence = sourceNumbers.size > 0
  const unsupported = questionNumbers.filter(n => !sourceNumbers.has(n))
  if (unsupported.length === 0) return { status: 'safe', answerNumbers: questionNumbers, sourceHadAnyNumericEvidence }
  return { status: 'unsupported', answerNumbers: questionNumbers, unsupportedNumbers: unsupported, sourceHadAnyNumericEvidence }
}

// ── entry point ──────────────────────────────────────────

export function evaluateSourceObjectiveSatisfaction(
  card: PlannedCard,
  generated: { question: string; answer: string },
  units: KnowledgeUnit[],
): SourceObjectiveResult {
  if (units.length === 0) {
    return {
      status: 'rejected',
      reasons: ['source_evidence_missing'],
      evidence: {
        objectiveRecovery: { signal: 'fast_fail', novelContentTokens: [], novelTokenCount: 0, questionEchoRatio: 1 },
        sourceSupport: { signal: 'ambiguous', sharedObjectiveTokens: [], objectiveTokenCount: 0 },
        cognitive: { status: 'not_applicable' },
        quantitative: { status: 'not_applicable' },
      },
    }
  }

  const objectiveRecovery = evaluateObjectiveRecovery(generated.question, generated.answer)
  const sourceSupport = evaluateSourceSupport(generated.question, generated.answer, units)
  const cognitive = evaluateCognitiveOperation(card, generated.answer, units)
  const quantitative = evaluateQuantitativeSafety(card, generated.question, units)

  const reasons: SourceObjectiveReason[] = []
  const evidence: SourceObjectiveEvidence = { objectiveRecovery, sourceSupport, cognitive, quantitative }

  // Hard rejection: only objective recovery, cognitive compliance, and
  // quantitative safety can produce it. Source support NEVER does on its
  // own — see module header. A vacuous answer is rejected here even if it
  // happens to share vocabulary with the source (the 4 real cases below
  // all measure `sourceSupport: 'supported'` on at least some pass, yet
  // still get rejected on objective recovery alone).
  if (objectiveRecovery.signal === 'fast_fail') {
    reasons.push('objective_not_recovered')
    return { status: 'rejected', reasons, evidence }
  }
  if (cognitive.status === 'not_satisfied') {
    reasons.push('cognitive_operation_not_satisfied')
    return { status: 'rejected', reasons, evidence }
  }
  if (quantitative.status === 'unsupported') {
    reasons.push(quantitative.sourceHadAnyNumericEvidence ? 'quantitative_value_unsupported' : 'quantitative_evidence_missing')
    return { status: 'rejected', reasons, evidence }
  }

  // objectiveRecovery !== 'fast_fail' from here on (already returned above).
  // A short-but-real answer can legitimately score 'ambiguous' on the
  // pure answer-vs-question lexical signal alone (a terse correct claim
  // and a terse vacuous one can look similar by that metric alone) — real
  // deck evidence for #22/#25/#49. When sourceSupport independently
  // confirms real, positive evidence of source grounding, that is enough
  // corroboration to resolve the ambiguity as satisfied. This can NEVER
  // rescue a `fast_fail` (already returned above, unconditionally) — it
  // only resolves genuine uncertainty when both weak signals agree.
  // Deliberately NOT auto-promoting fast_pass+ambiguous to satisfied: a
  // heavily-paraphrased CORRECT claim (CASE-B) and a fluent but
  // off-topic invented claim (a "wild tangent") are lexically
  // indistinguishable at this point — both show real novel content vs
  // the question, paired with unverifiable source overlap. Per the
  // module's own contract, that genuine double-uncertainty stays
  // `ambiguous` (never silently `satisfied`, never falsely `rejected`)
  // and goes back through repair asking for a more source-anchored
  // phrasing — see `source_support_ambiguous` below.
  if (objectiveRecovery.signal === 'ambiguous' && sourceSupport.signal === 'supported') {
    return { status: 'satisfied', reasons: [], evidence }
  }
  if (objectiveRecovery.signal === 'fast_pass' && sourceSupport.signal === 'supported') {
    return { status: 'satisfied', reasons: [], evidence }
  }

  if (objectiveRecovery.signal === 'ambiguous') reasons.push('objective_not_recovered')
  if (sourceSupport.signal === 'ambiguous') reasons.push('source_support_ambiguous')
  return { status: 'ambiguous', reasons, evidence }
}
