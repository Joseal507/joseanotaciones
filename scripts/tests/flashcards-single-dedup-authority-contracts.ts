import assert from 'node:assert/strict'
import { planFlashcards } from '../../lib/materialBrain/flashcards/planner'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/index'
import type { FlashcardDeck, FlashcardDeckStore, GeneratedFlashcard, PlannedCard } from '../../lib/materialBrain/flashcards/types'
import { FLASHCARD_GENERATOR_VERSION } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

// ============================================================
// FASE 2 (P0 mission — "UNA SOLA autoridad de dedup"). Real product
// contract: planner-level dedup is 100% deterministic (zero provider
// calls, ever — semanticDedup.ts's plan-time Tier-2 LLM judge was
// removed entirely); the SINGLE LLM dedup authority left is
// reconcilePedagogicalDuplicates (pedagogicalDedup.ts), running
// post-generation over real question/answer/cognitiveType/
// retrievalObjective — deterministic-first there too, LLM judge only
// for genuine ambiguity. Fase 1's delta-scoped repair dedup is
// untouched and still verified here (Case G).
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
    meta: {
      version: '1.0.0', builderVersion: MATERIAL_BRAIN_BUILDER_VERSION, generatedAt: new Date(0).toISOString(),
      chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 1 }, llmCallsUsed: 0, retries: 0, status: 'ready',
    },
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
  console.log('\n── Flashcards single-dedup-authority contracts (FASE 2) ──\n')
  await rm(TRACE_DIR, { recursive: true, force: true }).catch(() => {})

  // ── Case A: deterministically-demonstrable duplicate -> planner collapses, no provider ──
  await test('CASE-A: two near-verbatim equivalent units collapse at plan time with zero provider involvement', () => {
    const u1 = unit('u-a1', 'fact', 'Ley de Ohm', 'La ley de Ohm establece que el voltaje es proporcional a la corriente y a la resistencia.')
    const u2 = unit('u-a2', 'fact', 'Ley de Ohm', 'La ley de Ohm establece que el voltaje es proporcional a la corriente y la resistencia.')
    const plan = planFlashcards(brain('fp-a', [u1, u2]))
    assert.equal(plan.plannedCards.length, 1, 'a near-verbatim restatement must auto-merge deterministically (Jaccard >= AUTO_MERGE_THRESHOLD)')
    assert.ok(plan.skipped.some(s => s.reason === 'semantic_duplicate_of_target' && s.method === 'deterministic'))
  })

  // ── Case B: ambiguous units -> planner never calls a provider; both proceed to generation ──
  await test('CASE-B: two ambiguous (moderate-overlap) units are NEVER provider-resolved at plan time — both proceed, post-generation dedup decides', async () => {
    const u1 = unit('u-b1', 'fact', 'Catalizador', 'Un catalizador acelera las reacciones directa e inversa sin modificar K.')
    const u2 = unit('u-b2', 'fact', 'Catalizador', 'La presencia de un catalizador permite alcanzar el equilibrio más rápido, pero no cambia la constante de equilibrio.')
    const b = brain('fp-b', [u1, u2])
    const plan = planFlashcards(b)
    assert.equal(plan.plannedCards.length, 2, 'planner must never collapse an ambiguous pair on its own')
    assert.equal(plan.ambiguousDuplicateGroups.length, 1, 'flagged informationally, not resolved')
    let pedagogicalCalls = 0
    const result = await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), {
      // Both answers are grounded in their own unit's real vocabulary (not
      // just a correct-but-unanchored paraphrase) so BOTH reach the single
      // post-generation dedup authority as validated cards — a card stuck
      // at Source-Objective Satisfaction status=ambiguous never becomes
      // `validated`, and pedagogicalDedup only judges validated cards
      // (by design — dedup operates on accepted candidates, see Phase 1
      // Part 2 investigation). That's a correct, pre-existing ordering
      // constraint, not something this fixture should route around by
      // leaving an answer unanchored.
      generateFn: async planned => {
        const variant = planned.sourceUnitIds[0] === 'u-b1'
          ? { question: '¿Cómo afecta un catalizador a la constante K?', answer: 'El catalizador acelera las reacciones directa e inversa sin modificar K, según el material.' }
          : { question: '¿Qué ocurre con K cuando se introduce un catalizador?', answer: 'El material indica que un catalizador permite alcanzar el equilibrio más rápido, sin cambiar la constante de equilibrio K.' }
        return { ...planned, ...variant, provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(), validated: true, validationErrors: [] }
      },
      pedagogicalJudgeFn: async pairs => { pedagogicalCalls++; return pairs.map(p => ({ pairId: p.pairId, duplicate: true })) },
    })
    assert.ok(pedagogicalCalls >= 1, 'the ambiguous pair must reach the SINGLE post-generation dedup authority')
    const validCards = result.deck!.cards.filter(c => c.validated)
    assert.equal(validCards.length, 1, 'post-generation dedup must be the one that resolves it')
  })

  // ── Case C: distinct concepts with similar vocabulary -> no over-merge ──
  await test('CASE-C: distinct concepts sharing vocabulary are never over-merged (contrast-flip protects both layers)', async () => {
    const u1 = unit('u-c1', 'fact', 'Efecto temperatura', 'Un aumento de temperatura favorece la reaccion endotermica.')
    const u2 = unit('u-c2', 'fact', 'Efecto temperatura inverso', 'Una disminucion de temperatura favorece la reaccion exotermica.')
    const b = brain('fp-c', [u1, u2])
    const plan = planFlashcards(b)
    assert.equal(plan.plannedCards.length, 2, 'contrast-flip must veto merging opposite-condition facts at plan time')
    const result = await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), {
      generateFn: async planned => fakeCard(planned,
        planned.sourceUnitIds[0] === 'u-c1' ? '¿Qué favorece un aumento de temperatura?' : '¿Qué favorece una disminucion de temperatura?',
        planned.sourceUnitIds[0] === 'u-c1' ? 'Favorece la reaccion endotermica, con evidencia directa del material.' : 'Favorece la reaccion exotermica, con evidencia directa del material.'),
    })
    const validCards = result.deck!.cards.filter(c => c.validated)
    assert.equal(validCards.length, 2, 'opposite-condition facts must both survive post-generation dedup too')
  })

  // ── Case D: cross-label same proposition -> post-generation dedup detects ──
  await test('CASE-D: cross-label (different unit labels) same retrieval proposition is detected by the post-generation authority', async () => {
    const u1 = unit('u-d1', 'fact', 'Principio de Le Chatelier', 'El sistema se desplaza para contrarrestar la perturbacion aplicada.')
    const u2 = unit('u-d2', 'fact', 'Respuesta del equilibrio a perturbaciones', 'Cuando se perturba el equilibrio, el sistema reacciona para contrarrestar el cambio introducido.')
    const b = brain('fp-d', [u1, u2])
    const plan = planFlashcards(b)
    assert.equal(plan.plannedCards.length, 2, 'different labels are never auto-merged at plan time')
    // Each answer grounded in its OWN unit's statement (not a single
    // shared answer text) — both still share enough core paraphrase
    // vocabulary ("sistema"/"contrarrestar") for the cross-label dedup
    // pass to flag them as a candidate pair, but each is well-supported
    // on its own so this exercises real dedup merging (not an accidental
    // "only one ever validated" pass — a shared-answer-text version of
    // this fixture left u-d2 perpetually source_support_ambiguous against
    // its own, differently-worded statement).
    const result = await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), {
      generateFn: async planned => fakeCard(planned,
        planned.sourceUnitIds[0] === 'u-d1' ? '¿Qué establece el principio de Le Chatelier?' : '¿Cómo responde el equilibrio a una perturbación?',
        planned.sourceUnitIds[0] === 'u-d1'
          ? 'El sistema se desplaza para contrarrestar la perturbación aplicada.'
          : 'Cuando se perturba el equilibrio, el sistema reacciona para contrarrestar el cambio introducido.'),
      pedagogicalJudgeFn: async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: true })),
    })
    const validCards = result.deck!.cards.filter(c => c.validated)
    assert.equal(validCards.length, 1, 'cross-label same-proposition cards must collapse to 1 via the post-generation authority')
  })

  // ── Case E: complementary cards of the same concept -> both survive ──
  await test('CASE-E: complementary cards (definition vs application) of the SAME concept both survive', async () => {
    const u1 = unit('u-e1', 'concept', 'Constante K', 'La constante de equilibrio K relaciona concentraciones de productos y reactivos.', { semanticKey: 'constante k' })
    const u2 = unit('u-e2', 'fact', 'Aplicacion de K', 'Un valor de K muy elevado favorece la formacion de productos en la reaccion.', { semanticKey: 'constante k' })
    const b = brain('fp-e', [u1, u2])
    const result = await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), {
      generateFn: async planned => ({
        ...planned,
        question: planned.sourceUnitIds[0] === 'u-e1' ? '¿Qué relaciona la constante de equilibrio K?' : '¿Qué implica un valor de K muy elevado?',
        answer: planned.sourceUnitIds[0] === 'u-e1' ? 'Relaciona las concentraciones de productos y reactivos en el equilibrio.' : 'Que la reaccion favorece fuertemente la formacion de productos.',
        cognitiveType: planned.sourceUnitIds[0] === 'u-e1' ? 'recall' : 'application',
        provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(), validated: true, validationErrors: [],
      }),
      pedagogicalJudgeFn: async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: false })),
    })
    const validCards = result.deck!.cards.filter(c => c.validated)
    assert.ok(validCards.length >= 2, `complementary recall+application cards must both survive, got ${validCards.length}`)
  })

  // ── Case F: planDedupProviderCalls === 0, always ──
  await test('CASE-F: planDedupProviderCalls is always 0 — proven via the persisted trace', async () => {
    const u1 = unit('u-f1', 'fact', 'Catalizador', 'Un catalizador acelera las reacciones directa e inversa sin modificar K.')
    const u2 = unit('u-f2', 'fact', 'Catalizador', 'La presencia de un catalizador permite alcanzar el equilibrio mas rapido, pero no cambia la constante.')
    const b = brain('fp-f', [u1, u2])
    let savedPath = ''
    const origLog = console.log
    console.log = (...args: any[]) => {
      const line = args.join(' ')
      if (line.includes('FLASHCARDS_TRACE_SAVED')) savedPath = JSON.parse(line.replace(/^.*FLASHCARDS_TRACE_SAVED\s*/, '')).path
      origLog(...args)
    }
    try {
      await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), {
        generateFn: async planned => fakeCard(planned, `Pregunta ${planned.id}`, `Respuesta ${planned.id} con contenido propio suficiente.`),
      })
    } finally {
      console.log = origLog
    }
    assert.ok(savedPath, 'trace must have been persisted')
    const fileContent = JSON.parse(await readFile(savedPath, 'utf8'))
    assert.equal(fileContent.pipelineTrace.providerCalls.planDedup, 0, 'planDedupProviderCalls must be explicitly 0')
  })

  // ── Case G: repair stays delta-scoped (Fase 1 intact) ──
  await test('CASE-G: repair dedup remains delta-scoped after FASE 2 — fullDeckDedupRuns stays 1', async () => {
    const uA = unit('u-g-a', 'fact', 'A', 'stmt a')
    const uB = unit('u-g-b', 'fact', 'B', 'stmt b')
    const b = brain('fp-g', [uA, uB])
    let attempt = 0
    const generateFn = async (planned: PlannedCard) => {
      attempt++
      if (planned.sourceUnitIds.includes('u-g-b') && attempt <= 2) {
        return { ...planned, question: '', answer: '', provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(), validated: false, validationErrors: ['broken_academic_content'] }
      }
      return fakeCard(planned, `Con base en el material autorizado, ¿qué establece la evidencia respecto a ${planned.id}?`, `Respuesta verificada: ${planned.retrievalObjective} confirmado por evidencia directa del material.`)
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
    assert.equal(fileContent.dedupDiagnostics.fullDeckDedupRuns, 1, 'FASE 1 contract must remain intact after FASE 2')
  })

  // ── Case H: coverage transfer intact through the single-authority merge ──
  await test('CASE-H: a post-generation merge still transfers coverage correctly to both original targets', async () => {
    const u1 = unit('u-h1', 'fact', 'Catalizador', 'Un catalizador acelera las reacciones directa e inversa sin modificar K.')
    const u2 = unit('u-h2', 'fact', 'Catalizador', 'La presencia de un catalizador permite alcanzar el equilibrio mas rapido sin cambiar la constante.')
    const b = brain('fp-h', [u1, u2])
    const result = await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), {
      generateFn: async planned => ({
        ...planned,
        question: planned.sourceUnitIds[0] === 'u-h1' ? '¿Qué hace un catalizador a las reacciones?' : '¿Qué logra un catalizador en el equilibrio?',
        answer: 'El catalizador acelera el proceso sin modificar la constante de equilibrio, con evidencia directa del material.',
        provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(), validated: true, validationErrors: [],
      }),
      pedagogicalJudgeFn: async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: true })),
    })
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 1, 'both targets share one conceptCluster and must remain covered via the survivor')
    const survivor = result.deck!.cards.find(c => c.validated)
    assert.ok(survivor && survivor.sourceUnitIds.includes('u-h1') && survivor.sourceUnitIds.includes('u-h2'), 'the survivor must union both original sourceUnitIds')
  })

  // ── Case I: restore / regenerate intact ──
  await test('CASE-I: restore-first and explicit-regenerate remain intact after removing the plan-time dedup system', async () => {
    const u = unit('u-i1', 'fact', 'Hecho', 'Un hecho aislado y suficiente.')
    const b = brain('fp-i', [u])
    const store = new InMemoryDeckStore()
    const generateFn = async (planned: PlannedCard) => fakeCard(planned, '¿Qué establece el hecho?', 'Establece un hecho aislado y suficiente, con evidencia directa.')
    const r1 = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    const r2 = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.deepEqual(r1.deck!.cards.map(c => c.id), r2.deck!.cards.map(c => c.id), 'restore-first must return the same identities')
    const r3 = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any, regenerate: true })
    assert.equal(r3.status, 'ready', 'explicit regenerate must still succeed')
  })

  // ── Case J: provider calls do not scale O(N) ──
  await test('CASE-J: N=300 distinct units — provider calls stay sub-linear, not O(N)', async () => {
    const units = Array.from({ length: 300 }, (_, i) => unit(`u-j${i}`, 'fact', `Hecho ${i}`, `Contenido único y distinto del hecho numero ${i}.`))
    const unitsById = new Map(units.map(u => [u.id, u]))
    const b = brain('fp-j', units)
    let generationBatches = 0
    let pedagogicalCalls = 0
    const result = await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), {
      // Grounded in the real unit statement (not a boilerplate keyed only
      // by the card's opaque id) — an answer with none of the source
      // unit's real content is correctly treated as unsupported/ambiguous
      // by Source-Objective Satisfaction and would exhaust the retry
      // budget per target, breaking the sub-linear provider-call claim
      // this test actually exists to verify.
      generateBatchFn: async cards => {
        generationBatches++
        return new Map(cards.map(c => [c.id, fakeCard(c, `Describe brevemente ${c.sourceUnitIds[0]}.`, `Así lo indica el material: ${unitsById.get(c.sourceUnitIds[0])!.statement}`)]))
      },
      pedagogicalJudgeFn: async pairs => { pedagogicalCalls++; return pairs.map(p => ({ pairId: p.pairId, duplicate: false })) },
    })
    assert.notEqual(result.deck!.coverage.status, 'failed')
    assert.ok(generationBatches < 300, `generation batches must be sub-linear, got ${generationBatches}`)
    console.log(`     (N=300 -> ${generationBatches} generation batches, ${pedagogicalCalls} pedagogical dedup calls)`)
  })

  await rm(TRACE_DIR, { recursive: true, force: true }).catch(() => {})

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-single-dedup-authority-contracts: ALL PASS')
}

main()
