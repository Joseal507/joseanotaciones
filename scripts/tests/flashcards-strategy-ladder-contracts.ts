import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/deckStore'
import { validateDeck } from '../../lib/materialBrain/flashcards/validate'
import { buildDeterministicFallbackCard, COGNITIVE_TYPE_ROTATION } from '../../lib/materialBrain/flashcards/generator'
import type { FlashcardDeckStore, PlannedCard, GeneratedFlashcard, RepairFeedback } from '../../lib/materialBrain/flashcards/types'
import { FLASHCARD_GENERATOR_VERSION } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'

// ============================================================
// Contract suite: escalation LADDER for the two rejectionReasons real
// trace evidence showed freezing on a fixed, repeated candidate even
// under plain reconstructFromSource — template_leakage and
// circular_question_answer. A generic "try again" instruction does not
// change the model's output at low temperature when nothing else in the
// prompt changes, so the ladder forces a genuinely different question
// FORM (CognitiveType rotation — an existing, domain-agnostic
// PlannedCard field, never invented) and, as a last resort, a single
// code-constructed candidate built ONLY from structured source fields
// (never card.retrievalObjective, never invented content) — validated
// through the exact same validateDeck() as any LLM candidate.
// ============================================================

class InMemoryDeckStore implements FlashcardDeckStore {
  map = new Map<string, any>()
  async get(fp: string) { return this.map.get(fp) || null }
  async set(fp: string, deck: any) { this.map.set(fp, deck) }
}

function scopeFor(materialIds: string[]) { return buildSourceSelectionSnapshot(materialIds, {}) }
function unit(id: string, label: string, statement: string, extra: any = {}): KnowledgeUnit {
  return {
    id, kind: extra.kind || 'concept', label, statement,
    identity: { canonicalSubject: label, semanticKey: label.toLowerCase(), qualifiers: [] },
    importance: { tier: 'critical', signals: ['declared_in_material'], confidence: 1 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: statement, chunkId: 'chunk-1' }],
    domainTags: [],
    ...extra,
  } as any
}
function brain(units: KnowledgeUnit[], fingerprint: string): MaterialBrain {
  return {
    scope: { ...scopeFor(['mat-a']), fingerprint },
    meta: { version: '1.0.0', builderVersion: '1.0.0', generatedAt: new Date().toISOString(), chunking: { strategy: 'test', chunkSizeChars: 0, chunkCount: 0 }, llmCallsUsed: 0, retries: 0, status: 'ready' },
    units, relations: [],
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    knowledgeExtraction: { chunksAttempted: 0, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}
function card(planned: PlannedCard, question: string, answer: string, validated = false, errors: string[] = []): GeneratedFlashcard {
  return { ...planned, question, answer, provenance: [], generatorVersion: FLASHCARD_GENERATOR_VERSION, generatedAt: new Date().toISOString(), validated, validationErrors: errors }
}
function goodCard(planned: PlannedCard) {
  return card(planned, `Con base en el material autorizado, ¿qué establece la evidencia respecto a ${planned.id}?`, `Respuesta verificada: ${planned.retrievalObjective} — confirmado por evidencia directa del material.`)
}

function latestTraceFor(fingerprint: string): any {
  const dir = path.join(process.cwd(), '.flashcards-traces')
  const files = readdirSync(dir).filter(f => f.startsWith(`${fingerprint}-`) && f.endsWith('.json'))
  assert.ok(files.length > 0, `expected a trace file for fingerprint ${fingerprint}`)
  return JSON.parse(readFileSync(path.join(dir, files[files.length - 1]), 'utf8'))
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards escalation-ladder (template_leakage / circular_question_answer) contracts ──\n')

  await test('A: template_leakage stuck under reconstructFromSource → CognitiveType rotates → converges', async () => {
    const u = unit('u-a', 'Concepto A', 'Concepto A es un hecho verificable con contenido academico real.')
    const b = brain([u], 'fp-ladder-a')
    const store = new InMemoryDeckStore()
    const seenCognitiveType: (string | undefined)[] = []
    let call = 0
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      call++
      seenCognitiveType.push(feedback?.cognitiveTypeOverride)
      // Stuck on template_leakage for the first several attempts, then a genuinely different, valid attempt once rotated.
      if (feedback?.cognitiveTypeOverride) return goodCard(planned)
      return card(planned, 'igual siempre?', 'igual siempre.', false, ['template_leakage'])
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 1, 'must converge once CognitiveType rotation kicks in')
    assert.ok(seenCognitiveType.some(t => t !== undefined), 'at least one attempt must have received a rotated CognitiveType')
  })

  await test('B: circular_question_answer stuck under reconstructFromSource → CognitiveType rotates → converges', async () => {
    const u = unit('u-b', 'Concepto B', 'Concepto B es un hecho verificable con contenido academico real.')
    const b = brain([u], 'fp-ladder-b')
    const store = new InMemoryDeckStore()
    let call = 0
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      call++
      if (feedback?.cognitiveTypeOverride) return goodCard(planned)
      return card(planned, 'circular?', 'circular.', false, ['circular_question_answer'])
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 1)
  })

  await test('C: strategy A (plain reconstruct) fails → strategy B (rotation) actually requests a DIFFERENT structure, not a reformulation', async () => {
    const u = unit('u-c', 'Concepto C', 'Concepto C es un hecho verificable con contenido academico real.')
    const b = brain([u], 'fp-ladder-c')
    const store = new InMemoryDeckStore()
    const feedbacks: (RepairFeedback | undefined)[] = []
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      feedbacks.push(feedback)
      return card(planned, `intento ${feedbacks.length}?`, `respuesta ${feedbacks.length}.`, false, ['circular_question_answer'])
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    // attempt1=undefined, attempt2=plain repair (no reconstruct, no rotation),
    // attempt3=reconstructFromSource plain (level 0, no cognitiveTypeOverride),
    // attempt4+=ladder level 1+ (cognitiveTypeOverride set) — a REAL structural change, not just reworded text.
    assert.equal(feedbacks[2]?.reconstructFromSource, true)
    assert.equal(feedbacks[2]?.cognitiveTypeOverride, undefined, 'plain reconstruct (strategy A) must not yet rotate CognitiveType')
    assert.ok(feedbacks[3]?.cognitiveTypeOverride, 'strategy B must set a rotated CognitiveType — a genuinely different question form')
    assert.notEqual(feedbacks[3]?.cognitiveTypeOverride, u.kind, 'the override must differ from the original framing')
  })

  await test('D: no ladder level can alter the source knowledge — the deterministic fallback answer is byte-identical to unit.statement', () => {
    const u = unit('u-d', 'Definicion D', 'La definicion exacta de D es esta oracion verbatim del material.', { kind: 'definition', term: 'D' })
    const pc: PlannedCard = { id: 'pc-d', sourceUnitIds: [u.id], sourceRelationIds: [], retrievalObjective: 'obj', cognitiveType: 'recall', rationale: 'r', conceptClusterId: 'cluster-d' } as any
    const fallback = buildDeterministicFallbackCard(pc, u)
    assert.ok(fallback)
    assert.equal(fallback!.answer, u.statement, 'the fallback answer must be the source statement VERBATIM — never paraphrased or invented')
    assert.doesNotMatch(fallback!.question, /obj\b/, 'the fallback must never reuse card.retrievalObjective text')
  })

  await test('E: the deterministic fallback candidate passes validateDeck for real (not trusted blindly)', () => {
    const u = unit('u-e', 'Definicion E', 'La definicion de E establece una propiedad clara y verificable del material.', { kind: 'definition', term: 'E' })
    const pc: PlannedCard = { id: 'pc-e', sourceUnitIds: [u.id], sourceRelationIds: [], retrievalObjective: 'obj-e', cognitiveType: 'recall', rationale: 'r', conceptClusterId: 'cluster-e' } as any
    const fallback = buildDeterministicFallbackCard(pc, u)!
    const b = brain([u], 'fp-ladder-e')
    const validated = validateDeck([fallback], { plannedCards: [pc], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(validated[0].validated, true, JSON.stringify(validated[0].validationErrors))
  })

  await test('F: fallback impossible (multi-unit card / event_or_data with no distinguishing qualifiers) → returns null, target stays unresolved rather than fabricated', () => {
    const u1 = unit('u-f1', 'Concepto F1', 'stmt f1')
    const u2 = unit('u-f2', 'Concepto F2', 'stmt f2')
    const pcMultiUnit: PlannedCard = { id: 'pc-f-multi', sourceUnitIds: [u1.id, u2.id], sourceRelationIds: [], retrievalObjective: 'o', cognitiveType: 'recall', rationale: 'r', conceptClusterId: 'c' } as any
    assert.equal(buildDeterministicFallbackCard(pcMultiUnit, u1), null, 'a multi-unit card must never get a fallback (would risk inventing a relation)')
    // P3 fix (final coverage rescue): concept/fact kinds now DO have a safe
    // structured fallback (label + statement verbatim, same pattern as
    // definition/terminology/formula/process) — real-deck evidence showed
    // two concept units ("reacción directa"/"reacción inversa") stuck
    // pending purely because this path returned null unconditionally for
    // them. event_or_data with NO provenance quote at all is still the
    // one genuinely unbuildable case (no safe distinguishing evidence to
    // ground the question in without inventing one).
    const uEventNoProvenance = { ...unit('u-f3', 'Evento F3', 'stmt f3', { kind: 'event_or_data' }), provenance: [] }
    const pcEvent: PlannedCard = { id: 'pc-f-event', sourceUnitIds: [uEventNoProvenance.id], sourceRelationIds: [], retrievalObjective: 'o', cognitiveType: 'recall', rationale: 'r', conceptClusterId: 'c' } as any
    assert.equal(buildDeterministicFallbackCard(pcEvent, uEventNoProvenance as any), null, 'event_or_data with no provenance quote has no safe grounding for its question — must not fabricate one')
  })

  await test('G: an invalid deterministic fallback is never accepted just to raise coverage', async () => {
    // A definition whose statement is short enough to risk circularity — validateDeck must still be the authority.
    const u = unit('u-g', 'Definicion G', 'G.', { kind: 'definition', term: 'G' })
    const b = brain([u], 'fp-ladder-g')
    const store = new InMemoryDeckStore()
    const generateFn = async (planned: PlannedCard) => card(planned, 'siempre igual?', 'siempre igual.', false, ['circular_question_answer'])
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    // Whatever happens (fallback constructed-but-rejected, or LLM path exhausted), coverage must never be inflated for an invalid card —
    // a leftover invalid placeholder MAY remain in deck.cards (normal, honest record of the last attempt), but it must never count as covered.
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 0, 'an invalid fallback/LLM candidate must never be counted as covering the target')
    assert.equal(result.status, 'failed')
  })

  await test('H: total attempts stay bounded at MAX_GENERATION_ATTEMPTS_PER_TARGET=8 even with the ladder active', async () => {
    const u = unit('u-h', 'Concepto H', 'Concepto H es un hecho verificable con contenido academico real.', { kind: 'event_or_data', provenance: [] })
    const b = brain([u], 'fp-ladder-h')
    const store = new InMemoryDeckStore()
    let llmCalls = 0
    const generateFn = async (planned: PlannedCard) => { llmCalls++; return card(planned, 'siempre igual?', 'siempre igual.', false, ['circular_question_answer']) }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.ok(llmCalls <= 8, `LLM calls must never exceed the per-target budget, got ${llmCalls}`)
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 0)
    const trace = latestTraceFor('fp-ladder-h')
    const entry = trace.unresolvedGenerationFailures.find((e: any) => e.plannedCardId)
    assert.ok(entry, 'must still be recorded as unresolved, never silently dropped')
  })

  // K. Repair-stagnation regression (P1 fix): real-deck evidence showed a
  // target stuck on template_leakage produce the EXACT fingerprint
  // sequence A,A,B,B,B,B,B,B — the candidate froze byte-identical for 6
  // straight LLM calls once strategyLevel saturated at 2, because
  // cognitiveTypeOverride was wired directly to the CAPPED ladder level.
  // This reproduces that sequence deterministically and proves the fix:
  // strategyLevel stays capped at 2 (semantics unchanged) while the
  // CognitiveType rotation keeps advancing through the remaining budget.
  await test('K: template_leakage stuck at strategyLevel=2 keeps rotating CognitiveType instead of freezing (A,A,B,B,B,B,B,B fingerprint regression)', async () => {
    const u = unit('u-k', 'Concepto K', 'Concepto K es un hecho verificable con contenido academico real sobre el tema K.', { kind: 'event_or_data', provenance: [] })
    const b = brain([u], 'fp-ladder-k')
    const store = new InMemoryDeckStore()
    const seenFeedback: (RepairFeedback | undefined)[] = []
    let call = 0
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      call++
      seenFeedback.push(feedback)
      // Attempts 1-2: fingerprint A (byte-identical). Attempts 3-8:
      // fingerprint B (byte-identical to EACH OTHER, but different from A)
      // — exactly the real-deck A,A,B,B,B,B,B,B pattern. Always rejected
      // for the SAME single reason (template_leakage), regardless of any
      // cognitiveTypeOverride the feedback carries — this mock never
      // converges, by design, so the ladder is forced through every
      // remaining attempt of the budget.
      const text = call <= 2 ? 'fingerprint A siempre igual' : 'fingerprint B siempre igual'
      return card(planned, `${text}?`, `${text}.`, false, ['template_leakage'])
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })

    // 1. provider calls stay within the existing budget.
    assert.ok(call <= 8, `provider calls must stay <= MAX_GENERATION_ATTEMPTS_PER_TARGET, got ${call}`)
    // 2. strategyLevel (ladder semantics: fallback-tried-once,
    // suppressRetrievalObjective) never exceeds 2 — untouched by the fix.
    for (const fb of seenFeedback) assert.ok((fb?.strategyLevel ?? 0) <= 2, `strategyLevel must never exceed 2, saw ${fb?.strategyLevel}`)
    // 6. suppressRetrievalObjective keeps its existing level-2 semantics
    // (true once strategyLevel reaches 2, for template_leakage).
    const level2Feedback = seenFeedback.filter(fb => fb?.strategyLevel === 2)
    assert.ok(level2Feedback.length > 0, 'the mock must actually reach strategyLevel=2 for this test to be meaningful')
    for (const fb of level2Feedback) assert.equal(fb!.suppressRetrievalObjective, true, 'suppressRetrievalObjective must stay true throughout strategyLevel=2')
    // 4/5. Once strategyLevel=2, the remaining calls must NOT all carry
    // the same cognitiveTypeOverride — the rotation must keep advancing
    // through COGNITIVE_TYPE_ROTATION's cycle instead of freezing.
    const level2Overrides = level2Feedback.map(fb => fb!.cognitiveTypeOverride)
    const distinctLevel2Overrides = new Set(level2Overrides)
    assert.ok(
      distinctLevel2Overrides.size > 1,
      `once strategyLevel saturates at 2, cognitiveTypeOverride must keep rotating — all ${level2Overrides.length} calls carried the SAME value (${[...distinctLevel2Overrides]}), reproducing the exact stagnation bug`,
    )
    // Every observed override must be a real, existing CognitiveType from
    // the existing cycle — never an invented value.
    for (const t of distinctLevel2Overrides) assert.ok(t && t in COGNITIVE_TYPE_ROTATION, `cognitiveTypeOverride must be a real CognitiveType from the existing cycle, got ${t}`)
    // 7/8. Target stays genuinely unresolved — no invalid card ever
    // accepted to inflate coverage.
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 0, 'a target that never produces a valid candidate must never count as covered')
    assert.ok(result.deck!.cards.every(c => !c.sourceUnitIds.includes(u.id) || !c.validated), 'no invalid candidate for this target may ever be accepted')
  })

  // K2. Convergence proof: the SAME stagnation shape (stuck through
  // strategyLevel=2), but a LATER rotation happens to land on a
  // CognitiveType the mock accepts as valid — proving the fix doesn't
  // just change metadata, it actually unblocks convergence within the
  // SAME existing budget.
  await test('K2: a rotation AFTER strategyLevel=2 saturates can still converge, without burning the rest of the budget', async () => {
    const u = unit('u-k2', 'Concepto K2', 'Concepto K2.') // short/self-referential statement: the deterministic fallback's own generic question would be circular against it, so the fallback attempt fails validation (consuming ladder level 2's one attempt) without resolving the target — preserving this test's LLM-rotation convergence path
    const b = brain([u], 'fp-ladder-k2')
    const store = new InMemoryDeckStore()
    let call = 0
    const seenCognitiveTypes: (string | undefined)[] = []
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      call++
      seenCognitiveTypes.push(feedback?.cognitiveTypeOverride)
      // Converges only once the rotation reaches 'comparison' — a
      // rotation amount that only becomes reachable AFTER strategyLevel
      // has already saturated at 2 (rotate(recall,1)=comprehension,
      // rotate(recall,2)=application — 'comparison' requires rotation
      // count 3, i.e. one full escalation past the old frozen point).
      if (feedback?.cognitiveTypeOverride === 'comparison') return goodCard(planned)
      return card(planned, 'igual siempre?', 'igual siempre.', false, ['template_leakage'])
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })

    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 1, 'repair must converge once the rotation reaches the accepted CognitiveType')
    const validCard = result.deck!.cards.find(c => c.sourceUnitIds.includes(u.id) && c.validated)
    assert.ok(validCard, 'the converged card must be present and validated')
    assert.ok(call < 8, `must not burn the rest of the budget once converged, got ${call} calls`)
    assert.ok(seenCognitiveTypes.includes('comparison'), 'the rotation must have actually reached comparison to converge')
  })

  // L. Alternating-failure stagnation (P2 fix): real-deck evidence showed
  // a target cycling template_leakage -> notation_structure_lost ->
  // template_leakage -> ... that NEVER re-triggered escalation once
  // strategyLevel saturated at 2, because sameReasonSet/sameCandidateFingerprint
  // only compare against the SINGLE immediately-preceding round — an
  // A/B/A/B/... cycle passes that 1-step check every time even though the
  // SAME already-rejected candidate (A) keeps reappearing. Reproduces the
  // mission's own conceptual example verbatim: A,A,B,A,C,A (non-consecutive
  // revisits of a previously-rejected candidate+reason state).
  await test('L: alternating template_leakage/notation_structure_lost cycle with non-consecutive candidate revisits keeps rotating CognitiveType', async () => {
    const u = unit('u-l', 'Concepto L', 'Concepto L es un hecho verificable con contenido academico real sobre el tema L.', { kind: 'event_or_data', provenance: [] })
    const b = brain([u], 'fp-ladder-l')
    const store = new InMemoryDeckStore()
    const seenFeedback: (RepairFeedback | undefined)[] = []
    let call = 0
    // candA/template_leakage repeats at calls 1,2,3,4 (reaching
    // strategyLevel=2 the same way test K does), then REVISITS at calls
    // 6 and 8 — never consecutively, always separated by a genuinely
    // different candidate (candB/candC) failing for the OTHER reason.
    const script = [
      { text: 'candA', reason: 'template_leakage' },
      { text: 'candA', reason: 'template_leakage' },
      { text: 'candA', reason: 'template_leakage' },
      { text: 'candA', reason: 'template_leakage' },
      { text: 'candB', reason: 'notation_structure_lost' },
      { text: 'candA', reason: 'template_leakage' }, // non-consecutive revisit of candA/template_leakage
      { text: 'candC', reason: 'notation_structure_lost' },
      { text: 'candA', reason: 'template_leakage' }, // revisits again
    ]
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      seenFeedback.push(feedback)
      const step = script[call]
      call++
      return card(planned, `${step.text}?`, `${step.text}.`, false, [step.reason])
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })

    // strategyLevel <= 2 always.
    for (const fb of seenFeedback) assert.ok((fb?.strategyLevel ?? 0) <= 2, `strategyLevel must never exceed 2, saw ${fb?.strategyLevel}`)
    const level2Feedback = seenFeedback.filter(fb => fb?.strategyLevel === 2)
    assert.ok(level2Feedback.length >= 3, 'the mock must reach strategyLevel=2 with room for at least 2 further revisit-triggered escalations')
    // suppressRetrievalObjective keeps its existing level-2 semantics —
    // true whenever the dominant (fed-in) reason is template_leakage,
    // false when it's notation_structure_lost. Unrelated to this fix,
    // must remain intact.
    for (const fb of level2Feedback) {
      const dominant = fb!.rejectionReasons[0]
      assert.equal(fb!.suppressRetrievalObjective, dominant === 'template_leakage', `suppressRetrievalObjective must track the dominant reason (${dominant}), got ${fb!.suppressRetrievalObjective}`)
    }
    // The core assertion: cognitiveTypeOverride must NOT freeze once a
    // non-consecutive revisit of an already-rejected candidate+reason
    // state occurs — it must keep advancing through COGNITIVE_TYPE_ROTATION.
    const level2Overrides = level2Feedback.map(fb => fb!.cognitiveTypeOverride)
    const distinctLevel2Overrides = new Set(level2Overrides)
    assert.ok(
      distinctLevel2Overrides.size > 1,
      `once a previously-rejected candidate+reason state reappears (non-consecutively), cognitiveTypeOverride must keep rotating — all ${level2Overrides.length} calls carried the SAME value (${[...distinctLevel2Overrides]})`,
    )
    for (const t of distinctLevel2Overrides) assert.ok(t && t in COGNITIVE_TYPE_ROTATION, `cognitiveTypeOverride must be a real CognitiveType from the existing cycle, got ${t}`)
    // Provider calls stay within budget; no invalid card accepted.
    assert.ok(call <= 8, `provider calls must stay <= MAX_GENERATION_ATTEMPTS_PER_TARGET, got ${call}`)
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 0, 'a target that never produces a valid candidate must never count as covered')
  })

  // L2. Guardrail: mere RECURRENCE of a historical rejection reason must
  // NEVER be sufficient authority to escalate on its own when the
  // candidate fingerprint is genuinely new every time — only an EXACT
  // fingerprint+reason repeat (a real revisit of an already-rejected
  // state) may do that. Protects against over-escalating on legitimate,
  // ongoing exploration that merely keeps failing for a familiar reason.
  await test('L2: a historically-recurring rejectionReason with a genuinely NEW candidate every time does NOT trigger extra historical escalation', async () => {
    const u = unit('u-l2', 'Concepto L2', 'Concepto L2 es un hecho verificable con contenido academico real sobre el tema L2.', { kind: 'event_or_data', provenance: [] })
    const b = brain([u], 'fp-ladder-l2')
    const store = new InMemoryDeckStore()
    const seenFeedback: (RepairFeedback | undefined)[] = []
    let call = 0
    // Calls 1-4: identical candidate/reason, reaching strategyLevel=2 —
    // same as test K/L. Calls 5-8: a BRAND NEW, never-before-seen
    // fingerprint every time, alternating reasons — none of these states
    // (fingerprint+reason) has ever occurred before, so stateSeenBefore
    // must stay false throughout, even though "template_leakage" itself
    // keeps recurring across the whole history.
    const script = [
      { text: 'candA', reason: 'template_leakage' },
      { text: 'candA', reason: 'template_leakage' },
      { text: 'candA', reason: 'template_leakage' },
      { text: 'candA', reason: 'template_leakage' },
      { text: 'candD', reason: 'notation_structure_lost' },
      { text: 'candE', reason: 'template_leakage' }, // NEW fingerprint, historically-recurring reason
      { text: 'candF', reason: 'notation_structure_lost' },
      { text: 'candG', reason: 'template_leakage' }, // NEW fingerprint again
    ]
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      seenFeedback.push(feedback)
      const step = script[call]
      call++
      return card(planned, `${step.text}?`, `${step.text}.`, false, [step.reason])
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })

    const level2Feedback = seenFeedback.filter(fb => fb?.strategyLevel === 2)
    assert.ok(level2Feedback.length >= 3, 'the mock must reach strategyLevel=2 for this guardrail test to be meaningful')
    const level2Overrides = level2Feedback.map(fb => fb!.cognitiveTypeOverride)
    const distinctLevel2Overrides = new Set(level2Overrides)
    assert.equal(
      distinctLevel2Overrides.size, 1,
      `a genuinely new candidate every time must NOT escalate further just because the reason recurred historically — expected a single frozen cognitiveTypeOverride, got ${[...distinctLevel2Overrides]}`,
    )
  })

  // L3. Convergence proof for the alternating-cycle fix specifically: the
  // mock only accepts a candidate once cognitiveTypeOverride reaches
  // 'comparison' — a rotation amount reachable ONLY via a non-consecutive
  // revisit escalation (rotate(recall,3)), never via the old frozen
  // rotate(recall,2)="application" ceiling. Proves the fix unblocks real
  // convergence, not just metadata variety.
  await test('L3: convergence after a non-consecutive revisit unlocks a CognitiveType otherwise unreachable', async () => {
    const u = unit('u-l3', 'Concepto L3', 'Concepto L3.') // same reasoning as K2 above
    const b = brain([u], 'fp-ladder-l3')
    const store = new InMemoryDeckStore()
    let call = 0
    const seenCognitiveTypes: (string | undefined)[] = []
    const script = [
      { text: 'candA', reason: 'template_leakage' },
      { text: 'candA', reason: 'template_leakage' },
      { text: 'candA', reason: 'template_leakage' },
      { text: 'candA', reason: 'template_leakage' },
      { text: 'candB', reason: 'notation_structure_lost' },
      { text: 'candA', reason: 'template_leakage' }, // non-consecutive revisit -> unlocks rotation 3 = 'comparison' for the NEXT call
    ]
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      seenCognitiveTypes.push(feedback?.cognitiveTypeOverride)
      if (feedback?.cognitiveTypeOverride === 'comparison') return goodCard(planned)
      const step = script[call]
      call++
      return card(planned, `${step.text}?`, `${step.text}.`, false, [step.reason])
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })

    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 1, 'repair must converge once the revisit-triggered rotation reaches the accepted CognitiveType')
    const validCard = result.deck!.cards.find(c => c.sourceUnitIds.includes(u.id) && c.validated)
    assert.ok(validCard, 'the converged card must be present and validated')
    assert.ok(seenCognitiveTypes.includes('comparison'), 'the non-consecutive revisit must have actually unlocked comparison for convergence to happen')
  })

  // M. Guaranteed final-attempt fallback (P0 fix): provider variance must
  // never eliminate constructible content. A target whose rejection
  // reason genuinely varies every single round (real exploration, never
  // triggering the no-progress/ladder escalation at all — ladderLevel
  // never reaches 2 through the normal path) must STILL get the
  // deterministic, grounded fallback attempted on its LAST remaining
  // attempt, since the underlying unit (concept, single-source, real
  // statement) is genuinely buildable. This is the guarantee that "no
  // safe candidate could be built" (state 3) never happens just because
  // the LLM's 8 tries all failed — only when construction is truly
  // impossible.
  await test('M: a target whose reason genuinely varies every round (never escalates the ladder) still gets the deterministic fallback tried on its LAST attempt', async () => {
    const u = unit('u-m', 'Concepto M', 'Concepto M es un hecho verificable con contenido academico real sobre el tema M.')
    const b = brain([u], 'fp-ladder-m')
    const store = new InMemoryDeckStore()
    let call = 0
    const seenFeedback: (RepairFeedback | undefined)[] = []
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      seenFeedback.push(feedback)
      call++
      // A brand-new candidate AND a brand-new rejection reason every
      // single round — sameCandidateFingerprint/sameReasonSet/stateSeenBefore
      // never fire, so the ladder never escalates past level 0 through
      // the normal no-progress path.
      return card(planned, `intento ${call}?`, `respuesta ${call}.`, false, [`reason_${call}`])
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })

    // The ladder genuinely never escalated (no feedback ever carried a
    // strategyLevel) — proving this target's rescue did NOT come from
    // the ladder reaching level 2 the normal way.
    assert.ok(seenFeedback.every(fb => fb?.strategyLevel === undefined), 'this scenario must never trigger normal ladder escalation, to isolate the final-attempt guarantee')
    // Yet the target must still end up covered — the deterministic
    // fallback (grounded in the unit's own real statement) must have
    // been tried on the last attempt regardless.
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 1, 'a genuinely constructible target must never end up unresolved purely because every LLM attempt used a different, non-repeating rejection reason')
    const validCard = result.deck!.cards.find(c => c.sourceUnitIds.includes(u.id) && c.validated)
    assert.ok(validCard, 'the rescued card must be present and validated')
    assert.equal(validCard!.answer, u.statement, 'the rescue must be the deterministic fallback (answer verbatim from the unit statement), never a fabricated LLM candidate that happened to validate')
  })

  await test('I: multiple targets can be at different ladder levels within the same batch', async () => {
    const uEasy = unit('u-i-easy', 'Fotosintesis', 'La fotosintesis convierte luz solar en energia quimica en las plantas.')
    const uHard = unit('u-i-hard', 'Mitosis', 'La mitosis es el proceso de division celular que produce celulas identicas.')
    const b = brain([uEasy, uHard], 'fp-ladder-i')
    const store = new InMemoryDeckStore()
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      const key = planned.sourceUnitIds[0]
      if (key === uEasy.id) return goodCard(planned)
      // uHard: only converges once CognitiveType rotation actually kicks in.
      if (feedback?.cognitiveTypeOverride) return goodCard(planned)
      return card(planned, 'igual?', 'igual.', false, ['template_leakage'])
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 2, 'both targets must end up covered despite being at different ladder levels at different times')
  })

  await test('J: a card that already validated is never sent back through generation again', async () => {
    const uEasy = unit('u-j-easy', 'Respiracion celular', 'La respiracion celular libera energia a partir de la glucosa.')
    const uHard = unit('u-j-hard', 'Osmosis', 'La osmosis es el movimiento de agua a traves de una membrana semipermeable.')
    const b = brain([uEasy, uHard], 'fp-ladder-j')
    const store = new InMemoryDeckStore()
    const callCount: Record<string, number> = {}
    const generateFn = async (planned: PlannedCard) => {
      const key = planned.sourceUnitIds[0]
      callCount[key] = (callCount[key] || 0) + 1
      if (key === uEasy.id) return goodCard(planned)
      return card(planned, 'igual?', 'igual.', false, ['circular_question_answer'])
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.equal(callCount[uEasy.id], 1, 'a validated target must never be regenerated, no matter what the ladder is doing for a sibling target')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-strategy-ladder-contracts: ALL PASS')
}

main()
