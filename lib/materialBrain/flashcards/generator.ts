import { alaiJson } from '../../alai'
import type { KnowledgeRelation, KnowledgeUnit } from '../types'
import type { CognitiveType, GeneratedFlashcard, PlannedCard, RepairFeedback } from './types'
import { FLASHCARD_GENERATOR_VERSION } from './types'
import { normalizeSemanticText } from '../identity'

// Deterministic, domain-agnostic rotation — never invented per-subject,
// just a fixed cycle over the SAME CognitiveType enum PlannedCard already
// carries. Used only to force a genuinely different question FORM when a
// card is stuck (see RepairFeedback.strategyLevel), never to pick a
// cognitive type at random or based on content.
export const COGNITIVE_TYPE_ROTATION: Record<CognitiveType, CognitiveType> = {
  recall: 'comprehension',
  comprehension: 'application',
  application: 'comparison',
  comparison: 'procedure',
  procedure: 'recall',
}
const COGNITIVE_TYPE_HINT: Record<CognitiveType, string> = {
  recall: 'ask directly for the fact/value/definition itself',
  comprehension: 'ask the student to explain or restate the idea in their own terms',
  application: 'ask the student to use this fact/value in a concrete calculation or scenario',
  comparison: 'ask the student to relate or contrast this fact with another fact from the SAME source units',
  procedure: 'ask the student to state the steps/order/sequence involved',
}

// ============================================================
// Flashcard generator.
//
// `generateFlashcard` (single-card) is kept for callers/tests that
// need it, but the production path is `generateFlashcardBatch` — P0
// fix: the original design made ONE provider call per PlannedCard,
// so a 115-card deck cost 115 calls. Batched generation groups many
// planned cards (bounded per call, see FLASHCARD_BATCH_SIZE in
// deckStore.ts) into a single structured-JSON request, dramatically
// cutting provider calls (O(ceil(N/batchSize)), never O(N)) while
// still giving each card only the units/relations it actually needs.
// ============================================================

const MATH_FORMATTING_RULES = [
  'Math/formula formatting (P0 — MUST follow exactly, this content renders through a LaTeX-aware parser):',
  '- Inline math: wrap in single dollar signs, e.g. $K_c = \\frac{[C]^c[D]^d}{[A]^a[B]^b}$.',
  '- Block/standalone equations: wrap in double dollar signs $$...$$.',
  '- Subscripts: use _{...} inside math delimiters, e.g. $K_{eq}$, $[H_2O]$. Superscripts: use ^{...}, e.g. $x^2$, $10^{-14}$.',
  '- Fractions: \\frac{numerator}{denominator}. Roots: \\sqrt{...}. Delta: \\Delta. Reversible arrow: \\rightleftharpoons. Reaction arrow: \\rightarrow.',
  '- Chemical formulas/equations (if the material is chemistry): use \\ce{...} (mhchem), e.g. \\ce{N2O4 <=> 2NO2}.',
  '- NEVER use plain asterisks (*, *****), raw unicode superscript characters, or unescaped backslashes outside math delimiters — always the LaTeX commands above, always inside $...$ or $$...$$.',
  '- Never duplicate the same expression twice in the same field.',
].join('\n')

export interface GenerationContext {
  units: KnowledgeUnit[]
  relations: KnowledgeRelation[]
}

export type GenerateFlashcardFn = (card: PlannedCard, context: GenerationContext, language?: string, feedback?: RepairFeedback) => Promise<GeneratedFlashcard>

// P1 fix (surgical audit — "repair loop reintenta con el mismo prompt"):
// renders a repair round's targeted context — never included for round-0
// generation (no feedback arg there at all). Kept short and specific:
// the model doesn't need the full source restated, just why the LAST
// attempt for THIS card failed and what it must not lose again.
// FASE 3 mission ("REPAIR NO DEBE REPETIR EL MISMO FALLO CIEGAMENTE"):
// a reason-code -> strategy lookup, entirely GENERAL (keyed by the
// validator's own reason codes, never by target/domain content) — real-
// deck evidence showed 3 identical rejections in a row for the same
// target because every repair round received the exact same generic
// "fix the problem" instruction regardless of WHAT the problem was.
// Each strategy line tells the model the SHAPE of the fix, not the
// specific fact — new reason codes simply fall through to the generic
// line, nothing here needs updating when validate.ts gains a new gate.
const REPAIR_STRATEGY_BY_REASON: Record<string, string> = {
  notation_structure_lost: 'Preserve the required notation/symbols/relationships listed below — either the exact symbol or its standard verbal equivalent (e.g. "much greater than" for ">>") satisfies this; do not drop the comparison or structure entirely.',
  unwrapped_notation: 'Wrap all math/chemistry notation in $...$ (inline) or $$...$$ (block) delimiters — do not leave LaTeX commands or subscript/superscript markers as bare text.',
  broken_academic_content: 'Ensure any LaTeX/math notation is syntactically valid and properly delimited — check that every command and bracket is well-formed.',
  contextless_question: 'The question must explicitly name the specific instance, example, system, or case it refers to — do not leave it as a generic question that could apply to multiple contexts.',
  circular_question_answer: 'Reformulate the question so it does not already state the answer, and ensure the answer adds real information beyond restating the question.',
  answer_leaked_in_question: 'Reformulate the question so it does not already contain the answer verbatim.',
  low_information_value: 'State a concrete claim, value, or relationship — not a vague pointer to a topic or context.',
  template_leakage: 'Phrase this as a genuine question, not a restatement of the retrieval objective wording.',
  non_studyable_document_metadata: 'Ask about real academic content the material teaches — never about the document itself (its copyright, authorship, edition, or publication details).',
  // Source-objective satisfaction reasons (sourceObjectiveSatisfaction.ts) —
  // generic, subject-agnostic guidance for each failure mode it detects.
  objective_not_recovered: 'The answer must actually state the specific fact, value, or relationship the source unit(s) describe — not just acknowledge that it exists, matters, or relates to the topic.',
  unsupported_answer_content: 'Every claim in the answer must be traceable to the source unit(s) provided — remove any content the source does not state.',
  cognitive_operation_not_satisfied: 'The answer must genuinely walk through the real steps/structure from the source unit — not a single summarized action standing in for the whole procedure.',
  quantitative_evidence_missing: 'The source has no numeric example to support a quantitative application here — do not invent numbers. Use a non-quantitative framing of the same knowledge, or a value explicitly present in the source.',
  quantitative_value_unsupported: 'Every numeric value in the answer must come directly from the source unit(s) — do not invent, substitute, or alter any number.',
  // The claim is plausibly correct but too lexically distant from the
  // source to verify deterministically — ask for a version that keeps
  // the SAME meaning while anchoring more explicitly to the source's own
  // wording/terms, not a different or hedged claim.
  source_support_ambiguous: 'Your claim could not be verified against the source wording. Keep the exact same meaning, but phrase it using vocabulary/terms closer to the source unit(s) provided — do not change what you are asserting, just anchor it more explicitly to the source.',
}
export function repairStrategyFor(reasons: string[]): string[] {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const reason of reasons) {
    const strategy = REPAIR_STRATEGY_BY_REASON[reason]
    if (strategy && !seen.has(strategy)) { seen.add(strategy); lines.push(`- Strategy for "${reason}": ${strategy}`) }
  }
  return lines
}

export function buildRepairFeedbackBlock(feedback?: RepairFeedback): string {
  if (!feedback) return ''
  const lines = [
    '',
    'REPAIR CONTEXT — your previous attempt at this exact card was rejected. Do not just repeat it; fix the specific problem below.',
    `- Rejection reason(s): ${feedback.rejectionReasons.join(', ') || 'unspecified'}`,
    ...repairStrategyFor(feedback.rejectionReasons),
  ]
  if (feedback.requiredPreservations.length > 0) {
    lines.push(
      `- The previous candidate lost required source notation/relationships. Preserve this faithfully in the repaired card (meaning and notation must survive, verbatim copying is not required): ${feedback.requiredPreservations.join('; ')}`,
    )
  }
  // FASE B ("repair contextless con evidencia concreta"): a generic
  // "be more specific" instruction gives the model nothing to actually
  // insert. When authorized qualifier evidence exists, hand it over
  // verbatim — the SAME data repairContextlessQuestion (validate.ts)
  // already trusts deterministically — and explicitly forbid inventing
  // context beyond it (fail-closed: if this list is empty, the model
  // gets NO fabricated substitute).
  if (feedback.requiredContextEvidence && feedback.requiredContextEvidence.length > 0) {
    lines.push(
      `- The question must identify the specific instance using ONLY this source evidence (do not invent context not listed here): ${feedback.requiredContextEvidence.join('; ')}`,
    )
  }
  if (feedback.reconstructFromSource) {
    // Patching has already failed to converge for this exact card (either
    // byte-identical output, or the same rejectionReason repeating with
    // different wording). The previous candidate is a failed draft, not a
    // source of truth — deliberately NOT shown here, so the model cannot
    // anchor on it. Only the source units/relations already listed above
    // (context.units/context.relations in the caller) are the ground truth.
    lines.push(
      '- Your last attempts at this exact card kept failing for the same reason. STOP iterating on that wording — build a NEW flashcard from scratch, using ONLY the source units/relations provided above. Do not treat any earlier attempt as a starting point. Never invent information the source does not contain.',
      ...reconstructStrategyFor(feedback.rejectionReasons),
    )
    if (feedback.strategyLevel && feedback.cognitiveTypeOverride) {
      lines.push(
        `- Rebuilding from source was not enough — the SAME problem kept recurring. Change the question's cognitive form to "${feedback.cognitiveTypeOverride}": ${COGNITIVE_TYPE_HINT[feedback.cognitiveTypeOverride]}. Use ONLY relationships/steps/applications the source evidence above actually states — if it does not support this framing, state the single most literal fact from the source instead, but you MUST NOT reuse the same question form you already tried.`,
      )
    }
    if (feedback.suppressRetrievalObjective) {
      lines.push(
        '- The retrieval objective for this card is deliberately withheld this round. Do not guess or reconstruct it — write the question directly from the source unit(s)/relation(s) above.',
      )
    }
  } else {
    if (feedback.previousCandidate) {
      lines.push(`- Previous rejected question: ${feedback.previousCandidate.question}`)
      lines.push(`- Previous rejected answer: ${feedback.previousCandidate.answer}`)
    }
    if (feedback.previousAttemptWasIdentical) {
      lines.push(
        '- Your previous repair reproduced the rejected card unchanged. You MUST produce a structurally different question this time — do not reuse the same question form or wording. Preserve the academic meaning and any required notation/context listed above.',
      )
    }
  }
  return lines.join('\n')
}

// Reconstruction-mode strategies (subject-agnostic, keyed only by the
// validator's own reason codes): when patching has already failed to
// converge, the fix is not "try again" but "change what kind of question
// this is" — grounded only in the source, never inventing a relationship
// or framing the source does not support. Any reason without a specific
// entry here still gets the generic "build a new flashcard from scratch"
// instruction above.
const RECONSTRUCT_STRATEGY_BY_REASON: Record<string, string> = {
  notation_structure_lost: 'Reconstruct the question and answer directly from the source notation/expression referenced above and preserve it exactly (or via its standard verbal equivalent) — do not paraphrase away the structure again.',
  circular_question_answer: 'Ask about this fact using a genuinely different question form than plain recall (e.g. relate it to another value, ask for its role/effect, ask what distinguishes it from a related fact) — only when the source evidence actually supports that framing. Never invent a relationship the source does not state.',
}
function reconstructStrategyFor(reasons: string[]): string[] {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const reason of reasons) {
    const strategy = RECONSTRUCT_STRATEGY_BY_REASON[reason]
    if (strategy && !seen.has(strategy)) { seen.add(strategy); lines.push(`- Reconstruction strategy for "${reason}": ${strategy}`) }
  }
  return lines
}

function pickProvenance(card: PlannedCard, context: GenerationContext) {
  const unitProvs = card.sourceUnitIds
    .flatMap(id => context.units.find(u => u.id === id)?.provenance || [])
  const relationProvs = card.sourceRelationIds
    .flatMap(id => context.relations.find(r => r.id === id)?.provenance || [])
  return unitProvs[0] || relationProvs[0] || null
}

// ============================================================
// Deterministic fallback — the LAST rung of the reconstruction ladder
// (RepairFeedback.strategyLevel === 2), attempted at most ONCE per card
// and only when it can be built with a hard structural guarantee against
// inventing content: exactly one source unit, using ONLY that unit's own
// `label`/`statement`/kind-specific fields (never card.retrievalObjective,
// which is the very thing template_leakage echoes). The answer is always
// the unit's `statement` VERBATIM — nothing paraphrased, nothing added.
// This candidate is NOT trusted blindly: the caller (deckStore.ts) still
// runs it through the exact same validateDeck() as any LLM candidate, and
// only uses it if it genuinely passes. If it doesn't, or can't be built
// (multi-unit card, missing label/statement), this returns null and the
// card falls back to another rotated LLM attempt — never a fabricated
// substitute. Kind-aware but subject-agnostic: works identically for a
// medicine "definition" unit or a math "formula" unit.
// ============================================================
export function buildDeterministicFallbackCard(card: PlannedCard, unit: KnowledgeUnit | undefined): GeneratedFlashcard | null {
  if (card.sourceUnitIds.length !== 1 || card.sourceRelationIds.length > 0) return null
  if (!unit) return null
  // Prefer identity.canonicalSubject over the raw label: `label` is
  // sometimes a full descriptive sentence rather than a short noun phrase
  // (real-deck evidence: a "concept" unit whose `label` duplicated its
  // entire `statement`, making any label-based question trivially
  // circular against the answer) — canonicalSubject is the field
  // Material Brain already designates as the short canonical name.
  const label = (unit.identity?.canonicalSubject?.trim() || unit.label?.trim())
  const statement = unit.statement?.trim()
  if (!label || !statement) return null

  let question: string
  switch (unit.kind) {
    case 'definition':
      question = `¿Cuál es la definición de ${unit.term?.trim() || label} según el material?`
      break
    case 'terminology':
      question = `¿Qué significa el término ${label} en este material, y con qué otros nombres se lo menciona?`
      break
    case 'formula':
      question = `¿Cuál es la expresión de ${label} y qué representa cada una de sus variables?`
      break
    case 'process':
      question = `¿Cuáles son los pasos del proceso ${label} descrito en el material, en orden?`
      break
    case 'example':
      // Label deliberately NOT quoted — validate.ts's internal-label-leakage
      // gate flags any quoted span in the question that matches a known
      // internal unit label verbatim (real-deck evidence: quoting the
      // label here triggered `internal_label_leakage`).
      question = `¿Qué ilustra el ejemplo de ${label} según el material?`
      break
    case 'concept':
    case 'fact':
      // Same pattern as definition/terminology/formula/process above —
      // label (+ displayQualifiers when present) is the distinguishing
      // device, answer is the statement verbatim. Real-deck evidence
      // (two "reacción directa"/"reacción inversa" concept units) showed
      // these kinds had NO deterministic rescue at all, leaving them
      // entirely dependent on the LLM never leaking template phrasing —
      // this closes that gap the same way the other four kinds already
      // were closed. Not blindly trusted: still runs through the exact
      // same validateDeck()/circularity/SOS gates as any LLM candidate.
      // Label deliberately NOT quoted (see internal_label_leakage note above).
      question = `¿Cuál es el planteamiento exacto de ${label} según el material?`
      break
    case 'event_or_data': {
      // A bare numeric/event value with no qualifiers is genuinely at risk
      // of a circular restatement ("¿Cuál es el valor de X?" / "El valor
      // de X es 51.") — real-deck evidence. Ground the question in the
      // unit's own provenance quote instead of its (possibly bare) label:
      // the raw source text is real evidence, never invented, and its
      // wording/symbols differ enough from the distilled `statement` to
      // avoid the circularity/leakage gates in the common case. When no
      // provenance quote exists, this kind still returns null (fails
      // closed rather than risk a fabricated distinguishing context).
      const quote = unit.provenance[0]?.quote?.trim()
      if (!quote) return null
      // If the quote is essentially the same content as the statement
      // (common when the source line IS just the bare value), embedding
      // it verbatim in the question would leak the answer into the
      // question itself — only proceed when the quote carries genuinely
      // NOVEL tokens beyond the statement. Token novelty (not raw
      // character length) is the reliable signal: a terse formula-
      // notation quote is often textually SHORTER than its prose
      // statement while still carrying strictly more distinguishing
      // information (matches the same signal extraction.ts already uses
      // to decide whether to promote this quote as a qualifier upstream).
      const statementTokens = new Set(normalizeSemanticText(statement).split(' ').filter(Boolean))
      const quoteTokens = normalizeSemanticText(quote).split(' ').filter(Boolean)
      const novelQuoteTokens = quoteTokens.filter(t => !statementTokens.has(t))
      if (novelQuoteTokens.length === 0) return null
      question = `¿Qué valor o dato reporta el material en el siguiente fragmento?\n"${quote}"`
      break
    }
    default:
      return null
  }
  return {
    ...card,
    question,
    answer: statement,
    provenance: unit.provenance[0] ? [unit.provenance[0]] : [],
    generatorVersion: FLASHCARD_GENERATOR_VERSION,
    generatedAt: new Date().toISOString(),
    validated: false,
    validationErrors: [],
  }
}

function formatUnit(unit: KnowledgeUnit): string {
  let detail = unit.statement
  if (unit.kind === 'formula') {
    detail += `\nExpression: ${unit.expression}`
    detail += `\nVariables: ${unit.variables.map(v => `${v.symbol} = ${v.meaning}`).join('; ')}`
  }
  if (unit.kind === 'process') {
    detail += `\nSteps:\n${unit.steps.map(s => `${s.order}. ${s.text}`).join('\n')}`
  }
  if (unit.kind === 'example') {
    detail += `\nIllustrates: ${unit.illustrates}`
  }
  return `[${unit.kind}] ${unit.label}\n${detail}\nSource pages: ${unit.provenance.map(p => `${p.materialId}:p${p.page}`).join(', ')}`
}

function formatRelation(relation: KnowledgeRelation, context: GenerationContext): string {
  const from = context.units.find(u => u.id === relation.fromUnitId)
  const to = context.units.find(u => u.id === relation.toUnitId)
  return `[${relation.type}] ${from?.label || relation.fromUnitId} → ${to?.label || relation.toUnitId}\n${relation.statement}\nSource pages: ${relation.provenance.map(p => `${p.materialId}:p${p.page}`).join(', ')}`
}

function buildPrompt(card: PlannedCard, context: GenerationContext, language?: string, feedback?: RepairFeedback): string {
  const langHint = language || 'the same language as the source material'
  return [
    'You are a flashcard designer for retrieval practice.',
    '',
    'Generate exactly ONE flashcard for the following retrieval objective.',
    '',
    feedback?.suppressRetrievalObjective ? '' : `Retrieval objective: ${card.retrievalObjective}`,
    `Cognitive type: ${feedback?.cognitiveTypeOverride || card.cognitiveType}`,
    '',
    'Source knowledge units:',
    ...context.units.map(formatUnit),
    '',
    card.sourceRelationIds.length > 0 ? 'Source relations:' : '',
    ...context.relations.map(r => formatRelation(r, context)),
    '',
    'Rules:',
    '- The question must test exactly the retrieval objective, not something else.',
    '- The answer must be concise, accurate, and grounded ONLY in the source units/relations above.',
    '- Do NOT include the answer inside the question.',
    '- If the objective is comparison, the question must ask for a comparison.',
    '- If the objective is procedure, the question must ask for steps/order.',
    '- If the objective is application, the question must present a concrete use/calculation.',
    `- Write the question and answer in ${langHint}.`,
    '- Never generate a card about copyright, editorial/publisher info, page/slide navigation ("previous slide", "page X of Y"), or any other document metadata — only real academic knowledge.',
    '',
    MATH_FORMATTING_RULES,
    buildRepairFeedbackBlock(feedback),
    '',
    'Return valid JSON: { "question": string, "answer": string }',
  ].join('\n')
}

export async function generateFlashcard(
  card: PlannedCard,
  context: GenerationContext,
  language?: string,
  feedback?: RepairFeedback,
): Promise<GeneratedFlashcard> {
  const response = await alaiJson<{ question: string; answer: string }>({
    messages: [
      { role: 'system', content: buildPrompt(card, context, language, feedback) },
      { role: 'user', content: 'Generate the flashcard JSON now.' },
    ],
    temperature: 0.3,
    maxTokens: 800,
    json: true,
    taskType: 'flashcard_v2',
    stage: 'generate_one',
  })

  const question = String(response?.question || '').trim()
  const answer = String(response?.answer || '').trim()

  if (!question || !answer) {
    throw new Error(`FLASHCARD_GENERATION_EMPTY:${card.id}`)
  }

  const provenance = pickProvenance(card, context)

  return {
    ...card,
    question,
    answer,
    provenance: provenance ? [provenance] : [],
    generatorVersion: FLASHCARD_GENERATOR_VERSION,
    generatedAt: new Date().toISOString(),
    validated: false,
    validationErrors: [],
  }
}

function buildBatchPrompt(cards: PlannedCard[], context: GenerationContext, language?: string, feedbackByCardId?: Map<string, RepairFeedback>): string {
  const langHint = language || 'the same language as the source material'
  const cardBlocks = cards.map((card, i) => {
    const feedback = feedbackByCardId?.get(card.id)
    return [
    `--- CARD ${i + 1} (id: "${card.id}") ---`,
    feedback?.suppressRetrievalObjective ? '' : `Retrieval objective: ${card.retrievalObjective}`,
    `Cognitive type: ${feedback?.cognitiveTypeOverride || card.cognitiveType}`,
    `Relevant source unit ids: ${card.sourceUnitIds.join(', ') || 'none'}`,
    `Relevant source relation ids: ${card.sourceRelationIds.join(', ') || 'none'}`,
    buildRepairFeedbackBlock(feedback),
  ].filter(Boolean).join('\n')
  })
  return [
    'You are a flashcard designer for retrieval practice.',
    '',
    `Generate exactly ONE flashcard for EACH of the ${cards.length} retrieval objectives below.`,
    'Each card is independent — do not merge them, do not skip any, do not add extras.',
    '',
    'Full source knowledge (use ONLY the units/relations referenced by each card\'s ids):',
    ...context.units.map(u => `[unit ${u.id}] ${formatUnit(u)}`),
    '',
    context.relations.length > 0 ? 'Source relations:' : '',
    ...context.relations.map(r => `[relation ${r.id}] ${formatRelation(r, context)}`),
    '',
    ...cardBlocks,
    '',
    'Rules:',
    '- Each question must test EXACTLY its own retrieval objective, not something else, and not another card\'s objective.',
    '- The answer must be concise, accurate, and grounded ONLY in the referenced source units/relations.',
    '- Do NOT include the answer inside the question.',
    '- If the objective is comparison, the question must ask for a comparison. If procedure, ask for steps/order. If application, present a concrete use/calculation.',
    `- Write every question and answer in ${langHint}.`,
    '- Never generate a card about copyright, editorial/publisher info, page/slide navigation, or any other document metadata.',
    '',
    MATH_FORMATTING_RULES,
    '',
    `Return valid JSON: { "cards": [ { "id": string (must exactly match one of the given card ids), "question": string, "answer": string } ] } — exactly ${cards.length} entries, one per card id above.`,
  ].join('\n')
}

/**
 * Batched generation — the production path. Groups many PlannedCards
 * into ONE provider call (bounded by the caller's batch size), never
 * one call per card. A card id the provider fails to return, or returns
 * with an empty question/answer, is simply absent from the result map —
 * the caller (deckStore.ts) treats missing ids as gaps for the bounded
 * repair pass, never as a silent success.
 */
export async function generateFlashcardBatch(
  cards: PlannedCard[],
  context: GenerationContext,
  language?: string,
  feedbackByCardId?: Map<string, RepairFeedback>,
): Promise<Map<string, GeneratedFlashcard>> {
  const result = new Map<string, GeneratedFlashcard>()
  if (!cards.length) return result
  const cardById = new Map(cards.map(c => [c.id, c]))

  const response = await alaiJson<{ cards: { id: string; question: string; answer: string }[] }>({
    messages: [
      { role: 'system', content: buildBatchPrompt(cards, context, language, feedbackByCardId) },
      { role: 'user', content: 'Generate the flashcards JSON now.' },
    ],
    temperature: 0.3,
    maxTokens: Math.min(8000, 300 + cards.length * 220),
    json: true,
    taskType: 'flashcard_v2',
    stage: 'generate_batch',
  })

  const returned = Array.isArray(response?.cards) ? response.cards : []
  for (const entry of returned) {
    const card = cardById.get(String(entry?.id || ''))
    if (!card) continue // provider referenced an id we never asked about — ignored, never trusted as identity
    const question = String(entry?.question || '').trim()
    const answer = String(entry?.answer || '').trim()
    if (!question || !answer) continue // treated as a gap, not a malformed card
    const provenance = pickProvenance(card, context)
    result.set(card.id, {
      ...card,
      question,
      answer,
      provenance: provenance ? [provenance] : [],
      generatorVersion: FLASHCARD_GENERATOR_VERSION,
      generatedAt: new Date().toISOString(),
      validated: false,
      validationErrors: [],
    })
  }
  return result
}
