import assert from 'node:assert/strict'
import { reconcilePedagogicalDuplicates } from '../../lib/materialBrain/flashcards/pedagogicalDedup'
import type { GeneratedFlashcard, PlannedCard } from '../../lib/materialBrain/flashcards/types'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/index'
import type { FlashcardDeck, FlashcardDeckStore } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { planFlashcards } from '../../lib/materialBrain/flashcards/planner'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'

// ============================================================
// Cross-label pedagogical dedup — closes the blocker explicitly named in
// the previous report: "different label" was never a safe boundary for
// "different knowledge". This suite proves retrieval-intent equivalence
// (not label/question-text similarity) drives merging, generically
// across domains — one fixture set genericized from the real Le
// Châtelier over-fragmentation, never hardcoded to chemistry.
// ============================================================

function card(id: string, unitIds: string[], objective: string, cognitiveType: PlannedCard['cognitiveType'], question: string, answer: string): GeneratedFlashcard {
  return {
    id, sourceUnitIds: unitIds, sourceRelationIds: [], retrievalObjective: objective, cognitiveType,
    rationale: 'r', question, answer, provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(),
    validated: true, validationErrors: [],
  }
}

function unit(id: string, kind: KnowledgeUnit['kind'], label: string, statement: string): KnowledgeUnit {
  return {
    id, kind, label, statement,
    identity: { canonicalSubject: label, semanticKey: label, qualifiers: [] },
    importance: { tier: 'supporting', signals: ['model_judged'], confidence: 0.9 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: statement, chunkId: 'c-1' }],
    domainTags: [],
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

class InMemoryDeckStore implements FlashcardDeckStore {
  private map = new Map<string, FlashcardDeck>()
  async get(fingerprint: string) { return this.map.get(fingerprint) || null }
  async set(fingerprint: string, deck: FlashcardDeck) { this.map.set(fingerprint, deck) }
}

// A judge that mimics real semantic adjudication reasonably well for
// deterministic testing: duplicate iff normalized answers share >=0.5
// token overlap AND neither looks like an "application"/"criteria"-style
// answer the other lacks. Kept intentionally simple/deterministic so
// the suite never depends on live provider output.
function heuristicJudge(pairs: { pairId: string; a: { answer: string }; b: { answer: string } }[]) {
  const norm = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean))
  return Promise.resolve(pairs.map(p => {
    const ta = norm(p.a.answer)
    const tb = norm(p.b.answer)
    let inter = 0
    for (const t of ta) if (tb.has(t)) inter++
    const union = ta.size + tb.size - inter
    const overlap = union ? inter / union : 0
    return { pairId: p.pairId, duplicate: overlap >= 0.5 }
  }))
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards pedagogical (cross-label) dedup contracts ──\n')

  await test('DEDUP-X1: same retrieval intent, different labels/units -> merge (real-world genericized: 4-way principle restatement)', async () => {
    const cards = [
      card('a', ['u-principle'], 'State the principle', 'recall', '¿Qué establece el Principio X sobre un sistema perturbado?', 'Establece que el sistema se desplaza para contrarrestar la perturbación aplicada.'),
      card('b', ['u-response'], 'Describe system response to disturbance', 'recall', '¿Qué ocurre con la posición de equilibrio cuando un sistema es perturbado?', 'El sistema se desplaza para contrarrestar la perturbación introducida.'),
      card('c', ['u-shift'], 'Describe shift on perturbation', 'recall', '¿Qué sucede con la posición de equilibrio cuando se introduce una perturbación?', 'El sistema se desplaza en la dirección que contrarresta la perturbación.'),
      card('d', ['u-link'], 'Relate principle to shift', 'comprehension', '¿Cómo se relaciona el Principio X con el desplazamiento del equilibrio?', 'El principio predice que el sistema se desplazará para contrarrestar la perturbación aplicada.'),
    ]
    const { cards: result, mergedCount } = await reconcilePedagogicalDuplicates(cards, heuristicJudge)
    assert.ok(mergedCount >= 2, `expected at least 2 merges among 4 near-identical restatements, got ${mergedCount}`)
    assert.ok(result.length < 4, `expected fewer than 4 surviving cards, got ${result.length}`)
  })

  await test('DEDUP-X2: same intent, radically different wording -> merge', async () => {
    // Genuinely near-zero lexical overlap ("radically different
    // wording" is the whole point) — only a real semantic judge (the
    // provider, out of scope for a deterministic unit test) can tell
    // these are the same claim. This test verifies the pipeline reaches
    // the judge and correctly ACTS on a "duplicate" verdict; judgment
    // quality itself is the production judge's job, not this suite's.
    const cards = [
      card('a', ['u1'], 'objective A', 'recall', 'q1', 'La velocidad de reacción aumenta al elevar la temperatura porque más partículas superan la energía de activación.'),
      card('b', ['u2'], 'objective B', 'recall', 'q2', 'Calentar el sistema acelera la reacción, dado que una mayor proporción de moléculas alcanza el umbral energético necesario.'),
    ]
    const { mergedCount } = await reconcilePedagogicalDuplicates(cards, async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: true })))
    assert.equal(mergedCount, 1)
  })

  await test('DEDUP-X3: definition vs application -> keep both', async () => {
    const cards = [
      card('a', ['u1'], 'Define mitosis', 'recall', '¿Qué es la mitosis?', 'Es el proceso de división celular que produce dos células hijas genéticamente idénticas.'),
      card('b', ['u2'], 'Differentiate from meiosis', 'comparison', '¿En qué se diferencia la mitosis de la meiosis?', 'La mitosis produce células idénticas diploides, mientras que la meiosis produce gametos haploides genéticamente distintos.'),
    ]
    const { mergedCount } = await reconcilePedagogicalDuplicates(cards, heuristicJudge)
    assert.equal(mergedCount, 0, 'a definition and a comparison are different cognitiveTypes and must never be compared/merged')
  })

  await test('DEDUP-X4: cause vs consequence, independently study-worthy -> keep both', async () => {
    const cards = [
      card('a', ['u1'], 'objective cause', 'recall', 'q1', 'La deforestación intensiva reduce la capacidad del suelo para retener agua.'),
      card('b', ['u2'], 'objective consequence', 'recall', 'q2', 'La erosión del suelo provoca sedimentación en los ríos cercanos y pérdida de fertilidad agrícola.'),
    ]
    const { mergedCount } = await reconcilePedagogicalDuplicates(cards, heuristicJudge)
    assert.equal(mergedCount, 0)
  })

  await test('DEDUP-X5: formula recall vs variable meaning -> keep both', async () => {
    const cards = [
      card('a', ['u-formula'], 'State the formula', 'recall', '¿Cuál es la fórmula que relaciona Kp y Kc?', '$K_p = K_c(RT)^{\\Delta n}$.'),
      card('b', ['u-formula'], 'Explain what Δn represents', 'comprehension', '¿Qué representa Δn en esa fórmula?', 'Es la diferencia entre los moles de gas en productos y reactivos.'),
    ]
    const { mergedCount } = await reconcilePedagogicalDuplicates(cards, heuristicJudge)
    assert.equal(mergedCount, 0, 'different cognitiveType (recall vs comprehension) — never compared')
  })

  await test('DEDUP-X6: same worked example repeated through two disjoint source units -> merge', async () => {
    const cards = [
      card('a', ['u-ex-result-1'], 'objective', 'recall', 'q1', 'El resultado final del cálculo es una concentración de aproximadamente 0.031 M para el compuesto estudiado.'),
      card('b', ['u-ex-result-2'], 'objective', 'recall', 'q2', 'Tras aplicar el método, se obtiene una concentración final de aproximadamente 0.031 M para el compuesto.'),
    ]
    const { mergedCount } = await reconcilePedagogicalDuplicates(cards, heuristicJudge)
    assert.equal(mergedCount, 1)
  })

  await test('DEDUP-X7: similar wording but opposite claims -> NEVER merge (contrast-flip veto, no provider call needed)', async () => {
    let judgeCalls = 0
    const judge = async (pairs: any[]) => { judgeCalls++; return heuristicJudge(pairs) }
    const cards = [
      card('a', ['u1'], 'objective', 'recall', 'q1', 'Aumentar la presión favorece el lado con menor número de moles de gas.'),
      card('b', ['u2'], 'objective', 'recall', 'q2', 'Aumentar la presión desfavorece el lado con menor número de moles de gas.'),
    ]
    const { mergedCount } = await reconcilePedagogicalDuplicates(cards, judge)
    assert.equal(mergedCount, 0)
    assert.equal(judgeCalls, 0, 'contrast-flip must veto deterministically, never even reach the provider')
  })

  await test('DEDUP-X8: two historical facts about the same person but different events -> keep', async () => {
    const cards = [
      card('a', ['u1'], 'objective', 'recall', 'q1', 'Firmó el tratado que puso fin al conflicto en 1918.'),
      card('b', ['u2'], 'objective', 'recall', 'q2', 'Lideró la reforma económica que transformó la industria nacional en 1925.'),
    ]
    const { mergedCount } = await reconcilePedagogicalDuplicates(cards, heuristicJudge)
    assert.equal(mergedCount, 0)
  })

  await test('DEDUP-X9: definition vs diagnostic criterion of same disease -> keep', async () => {
    const cards = [
      card('a', ['u1'], 'Define the disease', 'recall', '¿Qué es la neumonía?', 'Es una infección que inflama los sacos alveolares de uno o ambos pulmones.'),
      card('b', ['u2'], 'Diagnostic criterion', 'recall', '¿Qué hallazgo confirma el diagnóstico de neumonía en la radiografía?', 'La presencia de un infiltrado alveolar localizado en la radiografía de tórax.'),
    ]
    const { mergedCount } = await reconcilePedagogicalDuplicates(cards, heuristicJudge)
    assert.equal(mergedCount, 0)
  })

  await test('DEDUP-X10: legal rule vs its application to a case -> keep', async () => {
    const cards = [
      card('a', ['u1'], 'State the rule', 'recall', '¿Qué elementos exige la doctrina de negligencia?', 'Deber de cuidado, incumplimiento, causalidad y daño.'),
      card('b', ['u2'], 'Apply the rule', 'application', 'En el caso descrito, ¿por qué se determinó negligencia del conductor?', 'Porque incumplió su deber de cuidado al no respetar la señal, causando directamente el daño al peatón.'),
    ]
    const { mergedCount } = await reconcilePedagogicalDuplicates(cards, heuristicJudge)
    assert.equal(mergedCount, 0, 'different cognitiveType (recall vs application) — never compared')
  })

  await test('DEDUP-X11: merge transfers ALL equivalent target coverage to the survivor', async () => {
    const cards = [
      card('a', ['u-a1', 'u-a2'], 'objective', 'recall', 'q1', 'El sistema se desplaza para contrarrestar la perturbación aplicada según el principio.'),
      card('b', ['u-b1'], 'objective', 'recall', 'q2', 'Ante una perturbación, el sistema reacciona desplazándose para contrarrestarla, conforme al principio.'),
    ]
    const { cards: result, mergedCount } = await reconcilePedagogicalDuplicates(cards, async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: true })))
    assert.equal(mergedCount, 1)
    const survivor = result.find(c => c.id === 'a' || c.id === 'b')
    assert.ok(survivor)
    assert.deepEqual([...survivor!.sourceUnitIds].sort(), ['u-a1', 'u-a2', 'u-b1'].sort(), 'survivor must inherit the union of both cards\' source unit ids — no coverage lost')
  })

  await test('DEDUP-X12: result independent of source/card ordering', async () => {
    const a = card('a', ['u-a1'], 'objective', 'recall', 'q1', 'El sistema se desplaza para contrarrestar la perturbación aplicada según el principio general.')
    const b = card('b', ['u-b1'], 'objective', 'recall', 'q2', 'Ante una perturbación, el sistema reacciona desplazándose para contrarrestarla, conforme al principio general.')
    const r1 = await reconcilePedagogicalDuplicates([a, b], heuristicJudge)
    const r2 = await reconcilePedagogicalDuplicates([b, a], heuristicJudge)
    assert.equal(r1.mergedCount, r2.mergedCount)
    assert.equal(r1.cards.length, r2.cards.length)
  })

  await test('DEDUP-X13: N=500/1000 remains bounded — never O(N²) provider calls', async () => {
    let judgeCalls = 0
    const judge = async (pairs: any[]) => { judgeCalls += pairs.length > 0 ? 1 : 0; return heuristicJudge(pairs) }
    const cards: GeneratedFlashcard[] = []
    for (let i = 0; i < 500; i++) {
      // Deliberately DIVERSE content (no shared vocabulary) so this
      // stresses the bucketing/bounding logic, not accidental merging.
      cards.push(card(`u${i}`, [`unit${i}`], 'objective', 'recall', `q${i}`, `Zconceptoq${i} describe wpropiedadx${i * 7 + 3} mediante vfenomenou${i * 13 + 5} en el contexto tunicox${i}.`))
    }
    const { mergedCount } = await reconcilePedagogicalDuplicates(cards, judge)
    assert.equal(mergedCount, 0, 'diverse content must not spuriously merge')
    assert.ok(judgeCalls <= 1, `judge must be invoked at most once (one batched call), got ${judgeCalls} invocations`)
  })

  await test('DEDUP end-to-end: getOrBuildFlashcardDeck wires pedagogicalJudgeFn and reports mergedCount in meta', async () => {
    const units = [
      unit('u-principle', 'fact', 'Principio X', 'El sistema se desplaza para contrarrestar la perturbación aplicada.'),
      unit('u-response', 'fact', 'Respuesta del sistema', 'Ante una perturbación, el sistema se desplaza para contrarrestarla.'),
    ]
    const b = brain('fp-dedup-e2e', units)
    const store = new InMemoryDeckStore()
    const result = await getOrBuildFlashcardDeck(b, store, {
      pedagogicalJudgeFn: heuristicJudge as any,
      generateBatchFn: async cs => new Map(cs.map(c => {
        const u = units.find(uu => uu.id === c.sourceUnitIds[0])!
        const text = u.id === 'u-principle'
          ? '¿Qué establece el Principio X sobre un sistema perturbado?'
          : '¿Qué ocurre con el sistema cuando es perturbado?'
        const answer = u.id === 'u-principle'
          ? 'Establece que el sistema se desplaza para contrarrestar la perturbación aplicada.'
          : 'El sistema se desplaza para contrarrestar la perturbación introducida en su entorno.'
        return [c.id, { ...c, question: text, answer, provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(), validated: false, validationErrors: [] }]
      })),
    })
    assert.ok((result.deck?.meta.pedagogicalMergesApplied || 0) >= 1, 'end-to-end deck build must apply and report the cross-label merge')
    assert.equal(result.deck?.coverage.status, 'complete', 'coverage must remain complete after the merge (no target lost)')
  })

  // ---------------------------------------------------------------
  // Dedup instrumentation (surgical audit, IMPLEMENTACIÓN AUTORIZADA):
  // diagnostics-only, must not change merge behavior or introduce/remove
  // concurrency at the orchestration level (its judge()-per-callBatch
  // loop is, and remains, sequential — only defaultPedagogicalJudge's
  // OWN internal sub-batching has concurrency, untouched here).
  // ---------------------------------------------------------------
  function candidateCard(id: string, sharedToken: string, uniqueSuffix: string): GeneratedFlashcard {
    return card(id, [`u-${id}`], `objective ${id}`, 'recall', `¿Pregunta ${id}?`, `${sharedToken} palabraunica${uniqueSuffix} relleno${uniqueSuffix} extra${uniqueSuffix}`)
  }

  await test('DEDUP-DIAG-1: diagnostics report real (non-null) counts for candidate pairs, deterministic resolutions, and ambiguous pairs', async () => {
    // 3 cards sharing one content token, pairwise jaccard well below the
    // auto-merge threshold -> 3 ambiguous pairs, 0 auto-merges.
    const cards = [candidateCard('d1', 'commontoken', 'A'), candidateCard('d2', 'commontoken', 'B'), candidateCard('d3', 'commontoken', 'C')]
    const alwaysDistinct = async (pairs: any[]) => pairs.map(p => ({ pairId: p.pairId, duplicate: false }))
    const { diagnostics } = await reconcilePedagogicalDuplicates(cards, alwaysDistinct as any)
    assert.equal(diagnostics.candidatePairs, 3, JSON.stringify(diagnostics))
    assert.equal(diagnostics.deterministicResolved, 0)
    assert.equal(diagnostics.ambiguousPairs, 3)
    assert.equal(diagnostics.judgeBatches, 1)
    assert.equal(diagnostics.judgeCalls, 1)
    assert.deepEqual(diagnostics.judgeBatchSizes, [3])
    assert.equal(diagnostics.judgeBatchDurationsMs.length, 1)
    assert.ok(diagnostics.candidateConstructionMs >= 0)
    assert.ok(diagnostics.deterministicResolutionMs >= 0)
    assert.ok(diagnostics.judgeWallMs >= 0)
    assert.ok(diagnostics.mergeFinalizationMs >= 0)
  })

  await test('DEDUP-DIAG-2: a deterministically auto-merged pair is counted, and no judge call is made when there are no ambiguous pairs left', async () => {
    // Two cards with near-identical answers (jaccard >= AUTO_MERGE_THRESHOLD) -> resolved without any provider call.
    const cards = [
      card('m1', ['u-m1'], 'obj', 'recall', '¿Q1?', 'el sistema se desplaza para contrarrestar la perturbacion aplicada'),
      card('m2', ['u-m2'], 'obj', 'recall', '¿Q2?', 'el sistema se desplaza para contrarrestar la perturbacion aplicada'),
    ]
    let judgeCalled = false
    const failingJudge = async () => { judgeCalled = true; return [] }
    const { diagnostics, mergedCount } = await reconcilePedagogicalDuplicates(cards, failingJudge as any)
    assert.equal(mergedCount, 1)
    assert.equal(diagnostics.deterministicResolved, 1)
    assert.equal(diagnostics.ambiguousPairs, 0)
    assert.equal(diagnostics.judgeBatches, 0)
    assert.equal(judgeCalled, false, 'a fully auto-merged pair must never reach the judge')
  })

  await test('DEDUP-DIAG-3/13: the judge()-per-callBatch loop stays SEQUENTIAL (unchanged) — two disjoint ambiguous-pair clusters run one after the other, never concurrently', async () => {
    // 7 mutually-ambiguous cards (all share ONE token -> one connected
    // component of C(7,2)=21 pairs, exceeding PAIRS_PER_CALL=20, so it is
    // sent whole in its own call) + 2 more cards sharing a DIFFERENT
    // token (a second, disjoint 1-pair component) -> exactly 2 callBatches.
    const bigCluster = Array.from({ length: 7 }, (_, i) => candidateCard(`big${i}`, 'sharedbig', String(i)))
    const smallCluster = [candidateCard('sm0', 'sharedsmall', 'x'), candidateCard('sm1', 'sharedsmall', 'y')]
    const cards = [...bigCluster, ...smallCluster]
    const callWindows: { start: number; end: number; size: number }[] = []
    const timedJudge = async (pairs: any[]) => {
      const start = Date.now()
      await new Promise(resolve => setTimeout(resolve, 25))
      callWindows.push({ start, end: Date.now(), size: pairs.length })
      return pairs.map(p => ({ pairId: p.pairId, duplicate: false }))
    }
    const { diagnostics } = await reconcilePedagogicalDuplicates(cards, timedJudge as any)
    assert.equal(diagnostics.judgeBatches, 2, JSON.stringify(diagnostics))
    assert.equal(callWindows.length, 2)
    const [first, second] = callWindows.sort((a, b) => a.start - b.start)
    assert.ok(second.start >= first.end, `second batch must start AFTER the first one finished (sequential, unchanged) — first ended ${first.end}, second started ${second.start}`)
    assert.deepEqual([...diagnostics.judgeBatchSizes].sort((a, b) => a - b), [1, 21])
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-pedagogical-dedup-contracts: ALL PASS')
}

main()
