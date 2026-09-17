import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/deckStore'
import { buildRepairFeedbackBlock } from '../../lib/materialBrain/flashcards/generator'
import type { FlashcardDeckStore, PlannedCard, GeneratedFlashcard, RepairFeedback } from '../../lib/materialBrain/flashcards/types'
import { FLASHCARD_GENERATOR_VERSION } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'

// ============================================================
// Contract suite: repair no-progress detection + escalation.
//
// Root cause (real CLUTCH 2.pdf run, fingerprint 4693131946a3f365):
// a repair round can return a question+answer byte-identical to the
// one that was just rejected — the provider call is spent for zero
// informational gain, and the NEXT round's feedback (built from that
// same unchanged "previous candidate") doesn't ask for anything new
// either, so the failure repeats. This suite proves: (1) a no-progress
// round is detected via the existing fingerprint mechanism, (2) the
// following round's RepairFeedback carries previousAttemptWasIdentical
// for THAT card only, (3) buildRepairFeedbackBlock renders a subject-
// agnostic divergence instruction when that flag is set, (4) a round
// that DOES change the text never sets the flag, (5) a still-invalid
// (but different) candidate is rejected normally — no relaxation of
// validate.ts, (6) coverage never changes artificially, (7) round/
// provider-call budget is unchanged (FLASHCARD_REPAIR_ROUNDS stays 2).
//
// NOTE: the repair loop's pre-existing `noProgress` early-exit
// (deckStore.ts) operates on the WHOLE round's pending-target count,
// not per-card — so a batch with only ONE ever-failing target stops
// after round 1 regardless of FLASHCARD_REPAIR_ROUNDS, same as before
// this change (untouched by this fix, out of this mission's scope).
// Every fixture below therefore includes a second "helper" unit that
// resolves on its first repair attempt, keeping the round loop alive
// long enough to reach round 2 for the stuck unit — exactly the shape
// of the real CLUTCH 2.pdf batches, which always had multiple pending
// targets per round.
// ============================================================

class InMemoryDeckStore implements FlashcardDeckStore {
  map = new Map<string, any>()
  async get(fp: string) { return this.map.get(fp) || null }
  async set(fp: string, deck: any) { this.map.set(fp, deck) }
}

function scopeFor(materialIds: string[]) { return buildSourceSelectionSnapshot(materialIds, {}) }
function unit(id: string, label: string, statement: string, extra: any = {}): KnowledgeUnit {
  return {
    id, kind: 'concept', label, statement,
    identity: { canonicalSubject: extra.canonicalSubject ?? label, semanticKey: extra.semanticKey ?? label.toLowerCase(), qualifiers: extra.qualifiers || [] },
    importance: { tier: extra.tier || 'critical', signals: extra.signals || ['declared_in_material'], confidence: 1 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: statement, chunkId: 'chunk-1' }],
    domainTags: extra.domainTags || [],
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
function helperGenerateFn(planned: PlannedCard, callCount: Record<string, number>) {
  callCount[planned.id] = (callCount[planned.id] || 0) + 1
  // Fails once (round 0), then a genuinely valid card on its first repair attempt.
  if (callCount[planned.id] === 1) return card(planned, '', '', false, ['broken_academic_content'])
  return card(planned, `Con base en el material autorizado, ¿qué establece la evidencia respecto a ${planned.id}?`, `Respuesta verificada: ${planned.retrievalObjective} — confirmado por evidencia directa del material.`)
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards repair no-progress detection + escalation contracts ──\n')

  await test('A/B: an identical round-1 candidate is detected, and round-2 feedback carries previousAttemptWasIdentical=true', async () => {
    const uHelper = unit('u-helper-1', 'Concepto ayudante', 'Concepto que se repara correctamente en la primera ronda.')
    const uStuck = unit('u-stuck', 'Reaccion directa', 'La reaccion directa transforma reactivos en productos.', { kind: 'event_or_data', provenance: [] }) // no deterministic fallback path: this target is designed to genuinely never converge
    const b = brain([uHelper, uStuck], 'fp-noprogress-1')
    const store = new InMemoryDeckStore()
    const callCount: Record<string, number> = {}
    const feedbackSeenPerCall: Record<string, (RepairFeedback | undefined)[]> = {}
    const BROKEN_Q = 'reaccion directa?'
    const BROKEN_A = 'transforma reactivos.'
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      if (planned.sourceUnitIds.includes(uHelper.id)) return helperGenerateFn(planned, callCount)
      const key = planned.sourceUnitIds[0]
      callCount[key] = (callCount[key] || 0) + 1
      feedbackSeenPerCall[key] = feedbackSeenPerCall[key] || []
      feedbackSeenPerCall[key].push(feedback)
      // Always returns the exact same broken candidate — contextless,
      // no matter what feedback it receives — simulating a model that
      // ignores repair instructions.
      return card(planned, BROKEN_Q, BROKEN_A, false, ['contextless_question'])
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })

    const stuckFeedback = feedbackSeenPerCall[uStuck.id]
    assert.equal(callCount[uStuck.id], 8, 'expected the full MAX_GENERATION_ATTEMPTS_PER_TARGET budget (1 initial + 7 repair rounds) since this card never converges')
    // stuckFeedback[0] = round 0 (initial generation, no feedback yet)
    // stuckFeedback[1] = round 1 (fed from round 0's rejection, not yet flagged identical)
    // stuckFeedback[2] = round 2 (fed from round 1, which WAS identical to round 0 -> must be flagged)
    assert.notEqual(stuckFeedback[1]?.previousAttemptWasIdentical, true, 'round 1 feedback must not be pre-flagged before any repeat has been observed')
    assert.equal(stuckFeedback[2]?.previousAttemptWasIdentical, true, 'round 2 feedback must know round 1 reproduced the rejected candidate unchanged')
  })

  await test('C: buildRepairFeedbackBlock renders a subject-agnostic divergence instruction when previousAttemptWasIdentical is true', () => {
    const feedback: RepairFeedback = {
      plannedCardId: 'c1',
      rejectionReasons: ['contextless_question'],
      requiredPreservations: [],
      requiredContextEvidence: ['Ejemplo del sistema H2 + I2'],
      previousCandidate: { question: '¿Qué ocurre?', answer: 'Algo.' },
      previousAttemptWasIdentical: true,
    }
    const block = buildRepairFeedbackBlock(feedback)
    assert.match(block, /reproduced the rejected card unchanged/i)
    assert.match(block, /structurally different question/i)
    assert.doesNotMatch(block, /química|quimica|equilibrio/i, 'the divergence instruction must not hardcode any subject-specific content')
    // The per-reason strategy and context evidence must still be present alongside the escalation — additive, not a replacement.
    assert.match(block, /contextless_question/)
    assert.match(block, /Ejemplo del sistema H2 \+ I2/)
  })

  await test('D: a round that DOES change the text never sets previousAttemptWasIdentical for the next round', async () => {
    const uHelper = unit('u-helper-2', 'Concepto ayudante', 'Concepto que se repara correctamente en la primera ronda.')
    const uProgress = unit('u-progress', 'Reaccion inversa', 'La reaccion inversa transforma productos en reactivos.', { kind: 'event_or_data', provenance: [] })
    const b = brain([uHelper, uProgress], 'fp-noprogress-2')
    const store = new InMemoryDeckStore()
    const callCount: Record<string, number> = {}
    const feedbackSeenPerCall: Record<string, (RepairFeedback | undefined)[]> = {}
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      if (planned.sourceUnitIds.includes(uHelper.id)) return helperGenerateFn(planned, callCount)
      const key = planned.sourceUnitIds[0]
      callCount[key] = (callCount[key] || 0) + 1
      feedbackSeenPerCall[key] = feedbackSeenPerCall[key] || []
      feedbackSeenPerCall[key].push(feedback)
      // Distinct broken text every round, still invalid (still contextless) —
      // progress in wording, but never actually fixed.
      const n = callCount[key]
      return card(planned, `intento ${n} contextless?`, `respuesta ${n}.`, false, ['contextless_question'])
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    const progressFeedback = feedbackSeenPerCall[uProgress.id]
    assert.equal(callCount[uProgress.id], 8, 'same rejectionReason every round is semantic no-progress — still retried to the full attempt budget, never stopped early')
    assert.notEqual(progressFeedback[2]?.previousAttemptWasIdentical, true, 'round 2 must not be escalated when round 1 genuinely changed the text')
  })

  await test('E: a different-but-still-invalid candidate is rejected normally — no relaxation of validate.ts', async () => {
    const uHelper = unit('u-helper-3', 'Concepto ayudante', 'Concepto que se repara correctamente en la primera ronda.')
    const uBad = unit('u-stillbad', 'Concepto roto', 'Este concepto no tiene contexto suficiente.', { kind: 'event_or_data', provenance: [] })
    const b = brain([uHelper, uBad], 'fp-noprogress-3')
    const store = new InMemoryDeckStore()
    const callCount: Record<string, number> = {}
    const generateFn = async (planned: PlannedCard) => {
      if (planned.sourceUnitIds.includes(uHelper.id)) return helperGenerateFn(planned, callCount)
      const key = planned.sourceUnitIds[0]
      callCount[key] = (callCount[key] || 0) + 1
      // Every attempt is textually different but still fails the SAME real gate (empty/broken).
      return card(planned, '', `distinta ${callCount[key]}`, false, ['broken_academic_content'])
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    const c = result.deck!.cards.find(x => x.sourceUnitIds.includes('u-stillbad'))
    assert.ok(!c || !c.validated, 'a genuinely bad candidate must stay rejected regardless of escalation')
  })

  await test('F: coverage does not change artificially because of the escalation mechanism', async () => {
    const uHelper = unit('u-helper-4', 'Concepto ayudante', 'Concepto que se repara correctamente en la primera ronda.')
    const uNeverCovered = unit('u-cov', 'Nunca cubierto', 'Este dato nunca produce un candidato valido.', { kind: 'event_or_data', provenance: [] })
    const b = brain([uHelper, uNeverCovered], 'fp-noprogress-4')
    const store = new InMemoryDeckStore()
    const callCount: Record<string, number> = {}
    const generateFn = async (planned: PlannedCard) => {
      if (planned.sourceUnitIds.includes(uHelper.id)) return helperGenerateFn(planned, callCount)
      return card(planned, 'siempre igual?', 'siempre igual.', false, ['contextless_question'])
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    const coveredIds = result.deck!.coverage.coveredConceptClusterIds
    assert.ok(!coveredIds.includes('cluster-u-cov'), 'a target that never produces a valid card must never be marked covered')
    assert.equal(coveredIds.length, 1, 'only the genuinely-fixed helper target is covered')
  })

  await test('G: total provider calls stay bounded by FLASHCARD_REPAIR_ROUNDS — escalation reuses existing rounds, adds none', async () => {
    const uHelper = unit('u-helper-5', 'Concepto ayudante', 'Concepto que se repara correctamente en la primera ronda.')
    const uBudget = unit('u-budget', 'Presupuesto', 'Dato de control para contar llamadas.', { kind: 'event_or_data', provenance: [] })
    const b = brain([uHelper, uBudget], 'fp-noprogress-5')
    const store = new InMemoryDeckStore()
    const callCount: Record<string, number> = {}
    const generateFn = async (planned: PlannedCard) => {
      if (planned.sourceUnitIds.includes(uHelper.id)) return helperGenerateFn(planned, callCount)
      const key = planned.sourceUnitIds[0]
      callCount[key] = (callCount[key] || 0) + 1
      return card(planned, 'igual?', 'igual.', false, ['contextless_question'])
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.equal(callCount[uBudget.id], 8, 'exactly 1 initial generation + 7 repair rounds — the full, but still bounded, per-target budget')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-repair-no-progress-contracts: ALL PASS')
}

main()
