import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/deckStore'
import type { FlashcardDeckStore, PlannedCard, GeneratedFlashcard, RepairFeedback } from '../../lib/materialBrain/flashcards/types'
import { FLASHCARD_GENERATOR_VERSION } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'

// ============================================================
// Contract suite: adaptive per-target retry budget (product decision —
// "prefiero que sobren flashcards a que falten"). A target must not go
// pending just because its first 1-2 generation attempts were bad
// wording. Each PlannedCard now gets up to MAX_GENERATION_ATTEMPTS_PER_TARGET
// (8: 1 initial + 7 repair rounds) real attempts, batched together with
// whatever other targets are also still eligible each round — never a
// fixed, shared round count. Two independent no-progress signals force a
// permanent switch to "reconstruct from source" mode for that card only:
//   A. lexical — a round reproduces the previous candidate byte-identical.
//   B. semantic — the text changes but fails for the exact same
//      rejectionReason set again.
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
function goodCard(planned: PlannedCard) {
  return card(planned, `Con base en el material autorizado, ¿qué establece la evidencia respecto a ${planned.id}?`, `Respuesta verificada: ${planned.retrievalObjective} — confirmado por evidencia directa del material.`)
}

function latestTraceFor(fingerprint: string): any {
  const dir = path.join(process.cwd(), '.flashcards-traces')
  const files = readdirSync(dir).filter(f => f.startsWith(`${fingerprint}-`) && f.endsWith('.json'))
  assert.ok(files.length > 0, `expected at least one trace file for fingerprint ${fingerprint}`)
  const withStat = files.map(f => ({ f, mtime: readFileSync(path.join(dir, f), 'utf8').length }))
  // fingerprint-runId is unique per call in this suite (fresh fingerprint per test), so any match is the one we want.
  const latest = withStat[withStat.length - 1].f
  return JSON.parse(readFileSync(path.join(dir, latest), 'utf8'))
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards adaptive per-target retry budget contracts ──\n')

  await test('A: fails twice, validates on attempt 3 → covered', async () => {
    const u = unit('u-a', 'Concepto A', 'Concepto A tiene una definicion clara y verificable.')
    const b = brain([u], 'fp-retry-a')
    const store = new InMemoryDeckStore()
    let call = 0
    const generateFn = async (planned: PlannedCard) => {
      call++
      if (call <= 2) return card(planned, 'igual?', 'igual.', false, ['circular_question_answer'])
      return goodCard(planned)
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.equal(call, 3)
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 1)
  })

  await test('B: fails five times, validates on attempt 6 → covered', async () => {
    const u = unit('u-b', 'Concepto B', 'Concepto B.') // short/self-referential: keeps the deterministic fallback candidate circular (rejected) so this target must actually converge via the mock's goodCard at attempt 6, not the fallback
    const b = brain([u], 'fp-retry-b')
    const store = new InMemoryDeckStore()
    let call = 0
    const generateFn = async (planned: PlannedCard) => {
      call++
      if (call <= 5) return card(planned, `intento ${call}?`, `respuesta ${call}.`, false, ['low_information_value'])
      return goodCard(planned)
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.equal(call, 6)
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 1)
  })

  await test('C: same fingerprint (byte-identical candidate) → lexical escalation on the next round', async () => {
    const u = unit('u-c', 'Concepto C', 'Concepto C tiene una definicion clara y verificable.')
    const b = brain([u], 'fp-retry-c')
    const store = new InMemoryDeckStore()
    const feedbacks: (RepairFeedback | undefined)[] = []
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      feedbacks.push(feedback)
      return card(planned, 'siempre igual?', 'siempre igual.', false, ['contextless_question'])
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    // feedbacks[0]=attempt1 (undefined), [1]=attempt2 (not yet flagged), [2]=attempt3 (must be flagged, lexical)
    assert.notEqual(feedbacks[1]?.reconstructFromSource, true)
    assert.equal(feedbacks[2]?.reconstructFromSource, true)
    assert.equal(feedbacks[2]?.previousAttemptWasIdentical, true, 'the trigger must be recorded as lexical')
  })

  await test('D: text changes but same rejectionReason repeats → semantic escalation on the next round', async () => {
    const u = unit('u-d', 'Concepto D', 'Concepto D tiene una definicion clara y verificable.')
    const b = brain([u], 'fp-retry-d')
    const store = new InMemoryDeckStore()
    const feedbacks: (RepairFeedback | undefined)[] = []
    let call = 0
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      call++
      feedbacks.push(feedback)
      return card(planned, `pregunta distinta ${call}?`, `respuesta distinta ${call}.`, false, ['circular_question_answer'])
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.notEqual(feedbacks[1]?.reconstructFromSource, true)
    assert.equal(feedbacks[2]?.reconstructFromSource, true, 'same rejectionReason twice in a row, even with different text, must escalate')
    assert.notEqual(feedbacks[2]?.previousAttemptWasIdentical, true, 'the trigger must be recorded as semantic, not lexical — the text was NOT identical')
  })

  await test('E: rejectionReason changes every round → never confused with no-progress, stays in patch mode', async () => {
    const u = unit('u-e', 'Concepto E', 'Concepto E tiene una definicion clara y verificable.')
    const b = brain([u], 'fp-retry-e')
    const store = new InMemoryDeckStore()
    const REASONS = ['circular_question_answer', 'low_information_value', 'template_leakage', 'notation_structure_lost', 'circular_question_answer', 'low_information_value', 'template_leakage']
    const feedbacks: (RepairFeedback | undefined)[] = []
    let call = 0
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback?: RepairFeedback) => {
      feedbacks.push(feedback)
      const reason = REASONS[call] || 'low_information_value'
      call++
      return card(planned, `pregunta ${call}?`, `respuesta ${call}.`, false, [reason])
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    // A rotating reason never repeats consecutively, so no attempt should ever be flagged reconstructFromSource.
    assert.ok(feedbacks.every(f => f?.reconstructFromSource !== true), 'a genuinely different rejectionReason each round must never trigger reconstruction escalation')
  })

  await test('F: an already-validated target receives zero additional retries', async () => {
    const u = unit('u-f', 'Concepto F', 'Concepto F tiene una definicion clara y verificable.')
    const b = brain([u], 'fp-retry-f')
    const store = new InMemoryDeckStore()
    let call = 0
    const generateFn = async (planned: PlannedCard) => { call++; return goodCard(planned) }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.equal(call, 1, 'a target that validates on attempt 1 must never be retried again')
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 1)
  })

  await test('G: multiple targets — only the still-pending one keeps being retried', async () => {
    const uGood = unit('u-g-good', 'Fotosintesis', 'La fotosintesis convierte luz solar en energia quimica en las plantas.')
    const uBad = unit('u-g-bad', 'Mitosis', 'La mitosis es el proceso de division celular que produce celulas identicas.', { kind: 'event_or_data', provenance: [] }) // event_or_data with no provenance quote: the deterministic fallback returns null (unbuildable) rather than a candidate, so this target genuinely exhausts the LLM-only 8-attempt fuse as originally designed
    const b = brain([uGood, uBad], 'fp-retry-g')
    const store = new InMemoryDeckStore()
    const callCount: Record<string, number> = {}
    const generateFn = async (planned: PlannedCard) => {
      const key = planned.sourceUnitIds[0]
      callCount[key] = (callCount[key] || 0) + 1
      if (key === uGood.id) return goodCard(planned)
      return card(planned, 'malo?', 'malo.', false, ['circular_question_answer'])
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.equal(callCount[uGood.id], 1, 'the already-covered target must never be regenerated in later rounds')
    assert.equal(callCount[uBad.id], 8, 'the still-pending target keeps its own full retry budget')
  })

  await test('H: a target reaches the fuse → unresolved_generation_failure is recorded, never silently dropped', async () => {
    const u = unit('u-h', 'Concepto H', 'Concepto H tiene una definicion clara y verificable.', { kind: 'event_or_data', provenance: [] }) // same reasoning as test G above
    const fp = 'fp-retry-h'
    const b = brain([u], fp)
    const store = new InMemoryDeckStore()
    let call = 0
    const generateFn = async (planned: PlannedCard) => { call++; return card(planned, 'nunca?', 'nunca.', false, ['circular_question_answer']) }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.equal(call, 8)
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 0)
    const trace = latestTraceFor(fp)
    assert.ok(Array.isArray(trace.unresolvedGenerationFailures), 'trace must persist an unresolvedGenerationFailures array')
    const entry = trace.unresolvedGenerationFailures.find((e: any) => e.conceptClusterId?.includes('u-h') || e.plannedCardId)
    assert.ok(entry, 'the exhausted target must have a recorded failure entry')
    assert.equal(entry.attemptsUsed, 8)
    assert.deepEqual(entry.finalReason, ['circular_question_answer'])
    assert.equal(entry.rejectionHistory.length, 8, 'one history entry per attempt, including the initial one')
  })

  await test('I: one target hits the fuse while a sibling validates — coverage stays monotonic', async () => {
    const uGood = unit('u-i-good', 'Respiracion celular', 'La respiracion celular libera energia a partir de la glucosa.')
    const uBad = unit('u-i-bad', 'Osmosis', 'La osmosis es el movimiento de agua a traves de una membrana semipermeable.', { kind: 'event_or_data', provenance: [] }) // same reasoning as test G/H above
    const b = brain([uGood, uBad], 'fp-retry-i')
    const store = new InMemoryDeckStore()
    const generateFn = async (planned: PlannedCard) => {
      const key = planned.sourceUnitIds[0]
      if (key === uGood.id) return goodCard(planned)
      return card(planned, 'malo?', 'malo.', false, ['circular_question_answer'])
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    const coveredIds = result.deck!.coverage.coveredConceptClusterIds
    assert.equal(coveredIds.length, 1, 'the good target must remain covered')
    assert.equal(result.deck!.coverage.targetedConceptClusterIds.length, 2, 'both targets remain in the denominator')
  })

  await test('J: no loop iteration can exceed MAX_GENERATION_ATTEMPTS_PER_TARGET (hard bound, not just typical case)', async () => {
    const u = unit('u-j', 'Concepto J', 'Concepto J tiene una definicion clara y verificable.', { kind: 'event_or_data', provenance: [] })
    const b = brain([u], 'fp-retry-j')
    const store = new InMemoryDeckStore()
    let call = 0
    const generateFn = async (planned: PlannedCard) => { call++; return card(planned, `x${call}?`, `y${call}.`, false, ['low_information_value']) }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.equal(call, 8, 'exactly 8 — never more, regardless of how many times the candidate keeps changing')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-adaptive-retry-budget-contracts: ALL PASS')
}

main()
