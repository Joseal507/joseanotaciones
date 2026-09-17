import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/deckStore'
import type { FlashcardDeckStore, PlannedCard, GeneratedFlashcard, RepairFeedback } from '../../lib/materialBrain/flashcards/types'
import { FLASHCARD_GENERATOR_VERSION } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'

// ============================================================
// Contract suite: the aggregate `noProgress` early-exit in the repair
// loop (deckStore.ts) must not cut the loop off before a card that just
// earned a fresh, not-yet-consumed escalation (previousAttemptWasIdentical)
// gets its one escalated attempt — otherwise the previous fix (repair
// no-progress detection) is neutralized whenever the stuck target is
// alone in its round (the real shape a single leftover pending target
// takes once everything else in the batch has already converged).
//
// Unlike the previous suite (which needed a "helper" unit to keep the
// loop alive past round 1), this one uses a SINGLE target on purpose —
// that is exactly the scenario the aggregate noProgress check used to
// break on prematurely.
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

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards repair escalation vs. aggregate no-progress convergence contracts ──\n')

  await test('A/B: R0 invalid, R1 byte-identical — the loop does NOT stop before R2, and R2 receives previousAttemptWasIdentical=true', async () => {
    const u = unit('u-solo-stuck', 'Reaccion directa', 'La reaccion directa transforma reactivos en productos.', { kind: 'event_or_data', provenance: [] })
    const b = brain([u], 'fp-escalation-1')
    const store = new InMemoryDeckStore()
    const feedbackSeen: (RepairFeedback | undefined)[] = []
    let call = 0
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      call++
      feedbackSeen.push(feedback)
      // Same broken candidate on EVERY call — the model never diverges.
      return card(planned, 'reaccion directa?', 'transforma reactivos.', false, ['contextless_question'])
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })

    assert.equal(call, 8, 'the full MAX_GENERATION_ATTEMPTS_PER_TARGET budget must run for a single never-converging target — no aggregate early-break can cut it off early')
    // feedbackSeen[0]=R0 (undefined), [1]=R1 (fed from R0, not yet flagged), [2]=R2 (fed from R1, WAS identical -> must be flagged)
    assert.notEqual(feedbackSeen[1]?.previousAttemptWasIdentical, true, 'R1 must not be pre-flagged')
    assert.equal(feedbackSeen[2]?.previousAttemptWasIdentical, true, 'R2 must receive the escalation earned by R1 reproducing R0 unchanged')
  })

  await test('C: total calls stay at exactly 1 initial + FLASHCARD_REPAIR_ROUNDS — no extra provider call added', async () => {
    const u = unit('u-solo-budget', 'Presupuesto solo', 'Dato de control aislado.', { kind: 'event_or_data', provenance: [] })
    const b = brain([u], 'fp-escalation-2')
    const store = new InMemoryDeckStore()
    let call = 0
    const generateFn = async (planned: PlannedCard) => {
      call++
      return card(planned, 'igual?', 'igual.', false, ['contextless_question'])
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.equal(call, 8, 'still bounded by the explicit per-target fuse — 1 initial + 7 repair rounds, never unbounded')
  })

  await test('D (superseded by product decision): same rejectionReason every round is now semantic no-progress, retried to the full budget instead of early-breaking', async () => {
    const u = unit('u-solo-vary', 'Nunca repite', 'Este dato jamas produce candidatos identicos.', { kind: 'event_or_data', provenance: [] })
    const b = brain([u], 'fp-escalation-3')
    const store = new InMemoryDeckStore()
    let call = 0
    const generateFn = async (planned: PlannedCard) => {
      call++
      // Different broken text every single call — never triggers identicalCandidateByCardId.
      return card(planned, `pregunta ${call}?`, `respuesta ${call}.`, false, ['contextless_question'])
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    // Product decision change: repeating the SAME rejectionReason every
    // round (even with different wording) is now semantic no-progress —
    // there is no more aggregate early-break; this target keeps getting
    // fresh attempts up to the full per-target budget.
    assert.equal(call, 8, 'same rejectionReason every round is semantic no-progress — retried to the full attempt budget')
  })

  await test('E: R2 still invalid after the escalated attempt — target stays pending, coverage never inflated', async () => {
    const u = unit('u-solo-stillbad', 'Sigue mal', 'Nunca se arregla ni con la escalacion.', { kind: 'event_or_data', provenance: [] })
    const b = brain([u], 'fp-escalation-4')
    const store = new InMemoryDeckStore()
    const generateFn = async (planned: PlannedCard) =>
      card(planned, 'igual?', 'igual.', false, ['contextless_question'])
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 0, 'a target that never validates must never be marked covered, escalation or not')
    assert.equal(result.status, 'failed', 'zero valid cards for this single target means the deck-level status is failed, not partial')
  })

  await test('F: R2 valid after the escalated attempt — target becomes covered normally', async () => {
    const u = unit('u-solo-fixed', 'Se arregla en R2', 'Este dato se corrige exactamente en la segunda ronda de repair.')
    const b = brain([u], 'fp-escalation-5')
    const store = new InMemoryDeckStore()
    let call = 0
    const generateFn = async (planned: PlannedCard) => {
      call++
      if (call <= 2) return card(planned, 'igual?', 'igual.', false, ['contextless_question']) // R0 and R1: identical, invalid
      // R2 (the escalated attempt): a genuinely different, valid card.
      return card(planned, `Con base en el material autorizado, ¿qué establece la evidencia respecto a ${planned.id}?`, `Respuesta verificada: ${planned.retrievalObjective} — confirmado por evidencia directa del material.`)
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 1, 'the escalated R2 attempt succeeding must be reflected as covered')
    assert.equal(call, 3, 'still bounded — the fix succeeding does not add an extra round')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-repair-escalation-convergence-contracts: ALL PASS')
}

main()
