import assert from 'node:assert/strict'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/deckStore'
import { planFlashcards } from '../../lib/materialBrain/flashcards/planner'
import type { FlashcardDeckStore, GeneratedFlashcard, PlannedCard } from '../../lib/materialBrain/flashcards/types'
import { FLASHCARD_GENERATOR_VERSION } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

// ============================================================
// FASE 3 CORRECCIÓN — bug de semántica de coverage. A terminal rejection
// (isTerminalRejection) means "stop automatically retrying THIS
// candidate" — it NEVER means "this target is not academic". The
// previous FASE 3 change silently shrank the coverage denominator
// (academicPlan) whenever a target's only candidate ended terminal,
// which can hide real failures behind an artificially inflated ratio
// (real risk explicitly named: "39 targets, 1 fails terminally -> must
// show 38/39 pending, never magically become 38/38"). This suite proves
// the corrected separation: academic eligibility is decided ONLY
// upstream (planner.ts, before a PlannedCard exists) — never here, never
// by re-reading a validation outcome.
// ============================================================

class InMemoryDeckStore implements FlashcardDeckStore {
  map = new Map<string, any>()
  async get(fp: string) { return this.map.get(fp) || null }
  async set(fp: string, deck: any) { this.map.set(fp, deck) }
}
function unit(id: string, kind: KnowledgeUnit['kind'], label: string, statement: string, extra: any = {}): KnowledgeUnit {
  return {
    id, kind, label, statement,
    identity: { canonicalSubject: extra.canonicalSubject ?? label, semanticKey: extra.semanticKey ?? label, qualifiers: extra.qualifiers || [] },
    importance: { tier: extra.tier || 'supporting', signals: extra.signals || ['model_judged'], confidence: 0.9 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: statement, chunkId: 'c-1' }],
    domainTags: extra.domainTags || [],
    ...extra,
  } as any
}
function brain(fingerprint: string, units: KnowledgeUnit[]): MaterialBrain {
  return {
    scope: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint },
    meta: { version: '1.0.0', builderVersion: MATERIAL_BRAIN_BUILDER_VERSION, generatedAt: new Date(0).toISOString(), chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 1 }, llmCallsUsed: 0, retries: 0, status: 'ready' },
    units, relations: [],
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}
function fakeCard(planned: PlannedCard, question: string, answer: string): GeneratedFlashcard {
  return { ...planned, question, answer, provenance: [], generatorVersion: FLASHCARD_GENERATOR_VERSION, generatedAt: new Date().toISOString(), validated: true, validationErrors: [] }
}

const TRACE_DIR = path.join(process.cwd(), '.debug', 'flashcards-traces')

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards coverage-denominator fix contracts (FASE 3 correction) ──\n')
  await rm(TRACE_DIR, { recursive: true, force: true }).catch(() => {})

  // Genuinely distinct vocabulary per unit — NOT just a swapped number —
  // so the deterministic Tier-1 planner dedup (Jaccard >= 0.62 on
  // near-identical phrasing) never collapses them into one cluster.
  const DISTINCT_TOPICS = [
    'la fotosintesis convierte luz solar en energia quimica almacenada',
    'la mitosis produce dos celulas hijas geneticamente identicas',
    'la tectonica de placas explica el movimiento de la corteza terrestre',
    'la ley de conservacion establece que la masa no se crea ni destruye',
    'el ciclo del agua describe la circulacion continua entre oceano y atmosfera',
    'la seleccion natural favorece rasgos que mejoran la supervivencia',
    'la difusion celular mueve particulas de mayor a menor concentracion',
    'el sistema nervioso transmite señales electricas entre neuronas',
    'la fermentacion produce energia sin necesidad de oxigeno',
    'la herencia mendeliana describe la transmision de caracteres geneticos',
  ]
  function tenAcademicUnits(failIndex: number) {
    return Array.from({ length: 10 }, (_, i) => unit(`u-a${i}`, 'fact', `Concepto ${i}`, DISTINCT_TOPICS[i]))
  }
  // Distinct answer text per target — reuses each unit's own distinct
  // topic sentence, so post-generation pedagogicalDedup never merges
  // unrelated targets on shared boilerplate wording either.
  function answerFor(planned: PlannedCard): string {
    const idx = Number(planned.sourceUnitIds[0]?.replace('u-a', ''))
    const topic = Number.isFinite(idx) ? DISTINCT_TOPICS[idx] : 'contenido academico distintivo'
    return `Establece que ${topic}, con evidencia directa del material.`
  }

  // ── A: 10 academic targets, 1 terminal -> 9 covered, 1 pending, denominator 10 ──
  await test('A. 10 academic targets + 1 terminal rejection -> covered=9, pending=1, denominator=10 (never 9/9)', async () => {
    const units = tenAcademicUnits(3)
    const b = brain('fp-a', units)
    const generateFn = async (planned: PlannedCard) => {
      if (planned.sourceUnitIds[0] === 'u-a3') {
        // Simulates the real-deck shape: the MODEL produces a self-
        // referential/ownership question for this one target, terminal
        // per validate.ts gate 6b — a genuine academic target whose
        // candidate happened to fail terminally.
        return { ...planned, question: '¿Quién posee el copyright de este material?', answer: 'Pertenece a la editorial.', provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(), validated: false, validationErrors: [] }
      }
      return fakeCard(planned, `¿Qué establece el concepto ${planned.id}?`, answerFor(planned))
    }
    const result = await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), { generateFn: generateFn as any })
    const cov = result.deck!.coverage
    assert.equal(cov.targetedConceptClusterIds.length, 10, `denominator must stay 10, got ${cov.targetedConceptClusterIds.length}`)
    assert.equal(cov.coveredConceptClusterIds.length, 9, `covered must be 9, got ${cov.coveredConceptClusterIds.length}`)
    assert.equal(cov.status, 'partial', 'a genuinely pending academic target must produce partial status, never complete')
  })

  // ── B: 10 source candidates, 1 unambiguous metadata -> excluded UPSTREAM, denominator 9 ──
  await test('B. 10 source units + 1 unambiguous metadata -> planner excludes it upstream, academic denominator=9, no generation/repair for it', async () => {
    const units = tenAcademicUnits(-1)
    units.push(unit('u-meta', 'event_or_data', 'Nota editorial', 'Primera edicion 2015', {
      provenance: [{ materialId: 'mat-a', page: 1, chunkId: 'c-1', quote: 'Primera edicion, 2015. Editorial Ejemplo. Todos los derechos reservados.' }],
    }))
    const b = brain('fp-b', units)
    const plan = planFlashcards(b)
    assert.equal(plan.plannedCards.length, 10, 'the metadata unit must never produce a plannedCard — excluded upstream, before generation')
    let generationCallsForMeta = 0
    const generateFn = async (planned: PlannedCard) => {
      if (planned.sourceUnitIds.includes('u-meta')) generationCallsForMeta++
      return fakeCard(planned, `¿Qué establece ${planned.id}?`, `Contenido academico distintivo para ${planned.id}, con evidencia directa del material.`)
    }
    const result = await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), { generateFn: generateFn as any })
    assert.equal(generationCallsForMeta, 0, 'metadata must never consume a generation call')
    assert.equal(result.deck!.coverage.targetedConceptClusterIds.length, 10, 'the academic denominator (10 real facts) is unaffected by the excluded metadata')
  })

  // ── C: academic target gets terminal rejection -> no retry, stays pending ──
  await test('C. a genuinely academic target whose candidate gets a terminal rejection is never retried, and stays pending (not covered)', async () => {
    const u = unit('u-c', 'fact', 'Concepto C', 'Hecho academico real con contenido propio suficiente.')
    const b = brain('fp-c', [u])
    let attempts = 0
    const generateFn = async (planned: PlannedCard) => {
      attempts++
      return { ...planned, question: '¿A quién pertenece el copyright de este material?', answer: 'A la editorial.', provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(), validated: false, validationErrors: [] }
    }
    const result = await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), { generateFn: generateFn as any })
    assert.equal(attempts, 1, 'a terminal rejection must never be retried')
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 0, 'the target must remain pending, never silently covered')
    assert.equal(result.deck!.coverage.targetedConceptClusterIds.length, 1, 'the target must remain in the denominator — it is still academic')
  })

  // ── D: retryable rejection CAN enter repair ──
  await test('D. a retryable rejection (notation) DOES enter repair and can recover', async () => {
    const u = unit('u-d', 'fact', 'Constante K', 'Cuando la constante K es mucho mayor que 1 (K >> 1), la reaccion favorece los productos.')
    const b = brain('fp-d', [u])
    let attempt = 0
    const generateFn = async (planned: PlannedCard) => {
      attempt++
      if (attempt === 1) return fakeCard(planned, '¿Qué indica un valor de K muy alto (K 1)?', 'Indica que la reaccion favorece los productos.')
      return fakeCard(planned, '¿Qué indica que K sea mucho mayor que 1?', 'Indica que la reaccion favorece los productos, con evidencia directa del material.')
    }
    const result = await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), { generateFn: generateFn as any })
    assert.ok(attempt >= 2, 'a retryable rejection must reach a repair round')
    assert.ok(result.deck!.cards.some(c => c.validated), 'the retryable target must be recoverable')
  })

  // ── E: no magic denominator shrink ──
  await test('E. coverage never silently changes from 9/10 to 9/9 when a target fails terminally', async () => {
    const units = tenAcademicUnits(7)
    const b = brain('fp-e', units)
    const generateFn = async (planned: PlannedCard) => {
      if (planned.sourceUnitIds[0] === 'u-a7') {
        return { ...planned, question: '¿A quién pertenece este material?', answer: 'A la editorial.', provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(), validated: false, validationErrors: [] }
      }
      return fakeCard(planned, `¿Qué establece el concepto ${planned.id}?`, answerFor(planned))
    }
    const result = await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), { generateFn: generateFn as any })
    const cov = result.deck!.coverage
    assert.notEqual(cov.targetedConceptClusterIds.length, cov.coveredConceptClusterIds.length, 'denominator must NOT quietly shrink to match the numerator')
    assert.equal(cov.targetedConceptClusterIds.length, 10)
    assert.equal(cov.coveredConceptClusterIds.length, 9)
  })

  // ── F: coverageInvariantPassed stays true ──
  await test('F. coverageInvariantPassed remains true with a genuinely pending terminal target', async () => {
    const units = tenAcademicUnits(2)
    const b = brain('fp-f', units)
    const generateFn = async (planned: PlannedCard) => {
      if (planned.sourceUnitIds[0] === 'u-a2') {
        return { ...planned, question: '¿Cuál es el ISBN de este material?', answer: 'No se especifica.', provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(), validated: false, validationErrors: [] }
      }
      return fakeCard(planned, `¿Qué establece el concepto ${planned.id}?`, answerFor(planned))
    }
    let savedPath = ''
    const origLog = console.log
    console.log = (...args: any[]) => {
      const line = args.join(' ')
      if (line.includes('FLASHCARDS_TRACE_SAVED')) savedPath = JSON.parse(line.replace(/^.*FLASHCARDS_TRACE_SAVED\s*/, '')).path
      origLog(...args)
    }
    try {
      await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), { generateFn: generateFn as any })
    } finally {
      console.log = origLog
    }
    const fileContent = JSON.parse(await readFile(savedPath, 'utf8'))
    assert.equal(fileContent.pipelineTrace.coverageInvariantPassed, true)
  })

  // ── G/H: Fase 1/2 remain intact ──
  await test('G/H. fullDeckDedupRuns===1 and planDedupProviderCalls===0 remain intact after the coverage fix', async () => {
    const units = tenAcademicUnits(-1)
    const b = brain('fp-gh', units)
    const generateFn = async (planned: PlannedCard) => fakeCard(planned, `¿Qué establece el concepto ${planned.id}?`, answerFor(planned))
    let savedPath = ''
    const origLog = console.log
    console.log = (...args: any[]) => {
      const line = args.join(' ')
      if (line.includes('FLASHCARDS_TRACE_SAVED')) savedPath = JSON.parse(line.replace(/^.*FLASHCARDS_TRACE_SAVED\s*/, '')).path
      origLog(...args)
    }
    try {
      await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), { generateFn: generateFn as any })
    } finally {
      console.log = origLog
    }
    const fileContent = JSON.parse(await readFile(savedPath, 'utf8'))
    assert.equal(fileContent.dedupDiagnostics.fullDeckDedupRuns, 1)
    assert.equal(fileContent.pipelineTrace.providerCalls.planDedup, 0)
  })

  await rm(TRACE_DIR, { recursive: true, force: true }).catch(() => {})

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-coverage-denominator-fix-contracts: ALL PASS')
}

main()
