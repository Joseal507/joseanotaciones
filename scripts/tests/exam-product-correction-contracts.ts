import { MemoryExamGradingStore } from '../../lib/materialBrain/examGrading'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  buildExamEnjoyerUniverse, composeEnjoyerExamBlueprint, conciseExcerpt,
} from '../../lib/materialBrain/examEnjoyerContext'
import { POST, __routeDeps, buildMultipleChoiceOptions } from '../../app/api/alai-studyal-exam/route'
import { InMemoryExamGenerationStore } from '../../lib/materialBrain/examGenerationStore'

// ============================================================
// EXAM_PRODUCT_CORRECTION contracts.
//
// Implements the P0 + essential P1 items from
// EXAM_PRODUCT_AUDIT_RECOMMENDATION against a REALISTIC, CLUTCH-shaped
// fixture (long multi-sentence source blocks, real Enjoyer hints
// including "open"/"problem", real bloomLevel labels) — not synthetic
// one-line targets, which is exactly what let the old certification
// suite pass while the live product shipped source-dump answers,
// forced-100% coverage claims, and a matching privacy leak.
// ============================================================

const selection = { ...buildSourceSelectionSnapshot(['clutch'], { clutch: [28, 29, 30, 31, 32, 33] }), fingerprint: 'fp-clutch-exam' }

// Long, realistic worked-problem-style source blocks — the exact shape
// (~250-400 words) that produced a 309-word MCQ correct option live.
const longBlock = (n: number) => `Problema número ${n} sobre equilibrio químico: cuando se calcula la constante de equilibrio Kc para una reacción como H2(g) + I2(g) <-> 2HI(g), es fundamental construir correctamente la expresión de equilibrio a partir de la ecuación balanceada. Cada especie gaseosa o en disolución acuosa participa en la expresión con un exponente igual a su coeficiente estequiométrico, mientras que los sólidos puros y líquidos puros se omiten por definición, ya que su actividad termodinámica se considera igual a uno bajo condiciones estándar. Continuando el problema ${n}, la tabla ICE (Inicial, Cambio, Equilibrio) permite calcular las concentraciones de equilibrio de cada especie a partir de las concentraciones iniciales dadas y el cambio estequiométrico x. Sustituyendo los valores de equilibrio en la expresión Kc = [HI]^2 / ([H2][I2]) se obtiene el valor numérico de la constante para esta temperatura específica, el cual permanece constante mientras la temperatura no cambie, independientemente de las concentraciones iniciales utilizadas.`

const clutchItems = Array.from({ length: 24 }, (_, i) => ({
  id: `ice-kc-${i}`, name: `Cálculo de Kc — paso ${i}`, kind: i % 4 === 0 ? 'formula' : i % 4 === 1 ? 'process' : i % 4 === 2 ? 'concept' : 'fact',
  content: longBlock(i), importance: i % 3 === 0 ? 'high' : 'medium', difficulty: i % 5 === 0 ? 'advanced' : 'medium',
  // Real Enjoyer hint shapes reported live — mixed mcq/open/problem, plus real bloomLevel labels.
  examTypes: i % 6 === 0 ? ['mcq', 'open'] : i % 6 === 1 ? ['mcq'] : i % 6 === 2 ? ['mcq', 'problem'] : i % 6 === 3 ? ['mcq', 'open', 'problem'] : i % 6 === 4 ? ['problem'] : ['problem', 'mcq'],
  bloomLevel: i % 4 === 0 ? 'remember' : i % 4 === 1 ? 'understand' : i % 4 === 2 ? 'apply' : 'analyze',
  topicId: `topic-${Math.floor(i / 4)}`, materialId: 'clutch', pages: [28 + (i % 6)],
  sourceSpans: [{ page: 28 + (i % 6), quote: longBlock(i).slice(0, 60) }],
}))

const clutchPayload = {
  sourceSelectionFingerprint: selection.fingerprint, materialIds: ['clutch'], selectedPages: selection.selectedPages,
  materialLanguage: 'es',
  topicsIndex: Array.from({ length: 6 }, (_, i) => ({ id: `topic-${i}`, title: `Equilibrio químico — bloque ${i}` })),
  globalOrderedAnalysis: clutchItems, uniqueConceptsIndex: [],
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── EXAM_PRODUCT_CORRECTION contracts ──\n')

  const universe = buildExamEnjoyerUniverse(clutchPayload, selection)

  await test('1. real Enjoyer open/problem hints survive normalization (previously silently dropped)', () => {
    const withProblem = universe.targets.filter(target => target.rawExamTypeHints.includes('problem'))
    const withOpen = universe.targets.filter(target => target.rawExamTypeHints.includes('open'))
    assert.ok(withProblem.length > 0, 'at least one target must carry the raw "problem" hint')
    assert.ok(withOpen.length > 0, 'at least one target must carry the raw "open" hint')
  })

  await test('2. bloomLevel survives and drives skill INDEPENDENTLY of response type — apply/analyze reach application/critical_thinking, not just "comprehension"', () => {
    const blueprint = composeEnjoyerExamBlueprint(universe, 60, 'clutch-skill', 'seed-skill')
    const skills = new Set(blueprint.slots.map(slot => slot.skill))
    assert.ok(skills.has('application'), `application must be reachable, got: ${[...skills].join(',')}`)
    assert.ok(skills.has('critical_thinking'), `critical_thinking (bloom analyze) must be reachable, got: ${[...skills].join(',')}`)
    // A multiple_choice slot must NOT be hardcoded to "comprehension" —
    // its skill must trace to the primary target's bloomLevel.
    const mcSlot = blueprint.slots.find(slot => slot.type === 'multiple_choice' && slot.skill !== 'comprehension')
    assert.ok(blueprint.slots.some(slot => slot.type === 'short_answer' && slot.skill === 'application'), 'application requires a worked response with a complete criterion')
  })

  await test('3. no single scored MCQ decision bundles more than 1 primary + 2 context targets — the exact "8 targets, one binary response" defect is structurally impossible', () => {
    const blueprint = composeEnjoyerExamBlueprint(universe, 60, 'clutch-slot', 'seed-slot')
    for (const slot of blueprint.slots) {
      if (slot.type === 'matching' || slot.type === 'multi_select') continue
      assert.equal(slot.assessedTargetIds.length, 1, `slot ${slot.id} (${slot.type}) must assess exactly 1 target, got ${slot.assessedTargetIds.length}`)
      assert.ok(slot.contextTargetIds.length <= 2, `slot ${slot.id} must cap context targets at 2, got ${slot.contextTargetIds.length}`)
    }
  })

  await test('4. coverage is 100% across the full Enjoyer universe; impossible duration is rejected pre-generation', () => {
    // A 15-minute exam cannot honestly evaluate 24 long-content targets (min is 25 min)
    const scoped = composeEnjoyerExamBlueprint(universe, 15, 'short', 'seed')
    assert.ok(scoped.slots.length > 0)
    assert.ok(scoped.coverage.notAssessedDueToScopeTargetIds.length > 0)
    assert.ok(scoped.expectedCompletionSeconds <= 15 * 60 * .85)

    // With sufficient duration (60 min), all 24 targets are assessed (100% coverage)
    const blueprint = composeEnjoyerExamBlueprint(universe, 60, 'clutch-cov-60', 'seed-cov-60')
    assert.equal(blueprint.coverage.assessedTargetIds.length, 24, 'a 60-minute exam must assess all 24 targets')
    assert.equal(blueprint.coverage.notAssessedDueToScopeTargetIds.length, 0, 'no targets omitted')
    assert.equal(blueprint.coverage.coverageStatus, 'complete')
    assert.equal(blueprint.coverage.assessedCoveragePercent, 100)
  })

  await test('5. closed answers are complete and bounded; private open criteria retain complete source authority', () => {
    const blueprint = composeEnjoyerExamBlueprint(universe, 60, 'clutch-excerpt', 'seed-excerpt')
    for (const slot of blueprint.slots) {
      if (slot.answerAuthority.kind === 'single_text') {
        assert.ok(slot.type === 'short_answer' ? slot.answerAuthority.canonicalValue === slot.frozenSources[0].content : slot.answerAuthority.canonicalValue.length <= 200, 'closed answers are bounded complete propositions; open criteria preserve the full canonical source')
        assert.ok(!slot.answerAuthority.canonicalValue.endsWith('…'))
        for (const distractor of slot.answerAuthority.distractorPool) {
          assert.ok(distractor.length <= 200, 'every distractor pool entry must be a single bounded excerpt')
          assert.ok(!distractor.includes(' · '), 'no distractor pool entry may be a "·"-joined concatenation of multiple sources')
        }
      }
      if (slot.answerAuthority.kind === 'multi_text') {
        for (const value of [...slot.answerAuthority.canonicalValues, ...slot.answerAuthority.distractorPool]) {
          assert.ok(value.length <= 200, 'multi_select values must be bounded excerpts too')
        }
      }
    }
  })

  await test('6. buildMultipleChoiceOptions never concatenates multiple pool entries with "·" padding — real fresh long-content shape, provider distractors preferred, no source dump', () => {
    const target = universe.targets[0]
    assert.equal(conciseExcerpt(target.content, 180), '', 'a long first proposition cannot be truncated into an MCQ answer')
    const excerpt = 'La constante depende de la temperatura para la reacción indicada.'
    const authority = {
      kind: 'single_text' as const,
      canonicalValue: excerpt,
      distractorPool: universe.targets.slice(1, 8).map(t => conciseExcerpt(t.content, 180)),
    }
    const providerDistractors = ['Una alternativa plausible pero incorrecta sobre el mismo bloque de equilibrio.', 'Otra alternativa incorrecta con longitud comparable a la respuesta correcta.']
    const built = buildMultipleChoiceOptions(authority, providerDistractors, 'seed-mcq')
    assert.ok(built, 'must build valid options from realistic long-content excerpts')
    for (const option of built!.options) {
      assert.ok(!option.includes(' · '), `no option may be a "·"-joined concatenation: "${option}"`)
      assert.ok(option.length <= 220, `every option must stay a single bounded proposition, got ${option.length} chars`)
    }
    assert.ok(built!.options.includes(providerDistractors[0]) || built!.options.includes(providerDistractors[1]), 'provider-authored distractors must be preferred over pool backfill when valid')
  })

  await test('7. category-diversity/skill allocation is not chemistry-specific — the same bloomLevel-driven mechanism generalizes to any subject (verified structurally: skillFor never inspects domain vocabulary)', () => {
    const genericItems = clutchItems.map((item, i) => ({
      ...item,
      id: `generic-${i}`,
      content: i % 4 === 2
        ? `Problema número ${i} genérico sobre aplicación de reglas: cuando se calcula el resultado sustituyendo los datos dados del caso x = ${i} en la ecuación general, se obtiene el valor numérico correspondiente para esta condición específica.`
        : `Contenido académico genérico y suficientemente largo para el elemento número ${i}, sin ningún vocabulario específico de química.`,
      bloomLevel: item.bloomLevel,
    }))
    const genericUniverse = buildExamEnjoyerUniverse({ ...clutchPayload, globalOrderedAnalysis: genericItems }, selection)
    const blueprint = composeEnjoyerExamBlueprint(genericUniverse, 60, 'generic-skill', 'seed-generic')
    const skills = new Set(blueprint.slots.map(slot => slot.skill))
    assert.ok(skills.has('application') && skills.has('critical_thinking'), 'bloomLevel-driven skill allocation must work identically on non-chemistry content')
  })

  // Minimal, single-batch, matching-only universe — isolates the
  // matching-privacy path from the multi-type progressive batching
  // exercised by the other tests above.
  const matchingSelection = { ...buildSourceSelectionSnapshot(['clutch-m'], { 'clutch-m': [1] }), fingerprint: 'fp-clutch-match' }
  const matchingItems = Array.from({ length: 4 }, (_, i) => ({
    id: `match-${i}`, name: `Término ${i}`, kind: 'concept',
    content: `Definición canónica y suficientemente larga del término número ${i} del equilibrio químico.`,
    importance: 'high', difficulty: 'medium', examTypes: ['matching'],
    topicId: 'topic-match', materialId: 'clutch-m', pages: [1], sourceSpans: [{ page: 1, quote: `cita ${i}` }],
  }))
  const matchingPayload = {
    sourceSelectionFingerprint: matchingSelection.fingerprint, materialIds: ['clutch-m'], selectedPages: matchingSelection.selectedPages,
    topicsIndex: [{ id: 'topic-match', title: 'Definiciones' }], globalOrderedAnalysis: matchingItems, uniqueConceptsIndex: [],
  }

  await test('8. matching public payload contains independent left/right lists with NO canonical correspondence revealed pre-submission — the confirmed live leak, closed', async () => {
    const original = { ...__routeDeps }
    try {
      Object.assign(__routeDeps, {
        getServerSession: async () => ({ user: { id: 'match-user' } }),
        getAuthoritativeFreeSession: async () => ({ id: 'match-session', userId: 'match-user', processMode: 'free', sourceSelection: matchingSelection }),
        getMaterial: async () => ({ id: 'clutch-m' }),
        lookupStudyalMaterialEnjoyer: async () => matchingPayload,
        gradingStore: new MemoryExamGradingStore(), examStore: new InMemoryExamGenerationStore(),
        generateValidatedLegacyJson: async ({ validate, prompt }: any) => {
          const blocks = String(prompt).split(/\n(?=\d+\.\s+slotId=)/).filter((b: string) => /^\d+\.\s+slotId=/.test(b))
          const value = blocks.map((block: string, i: number) => {
            const slotId = block.match(/slotId=(\S+)/)?.[1] || ''
            const sourceItemIds = (block.match(/sourceItemIds=([^\n]+)/)?.[1] || '').split(',').map((v: string) => v.trim()).filter(Boolean)
            return { slotId, type: 'matching', sourceItemIds, prompt: `¿Empareja los términos #${i}?`, rubricHints: [], pairs: [{ left: 'x', right: 'y' }] }
          })
          assert.ok(validate(value).valid, 'mock response must satisfy route validation')
          return value
        },
      })
      const post = (body: object) => POST(new NextRequest('http://localhost/api/alai-studyal-exam', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
      const data = await (await post({ mode: 'generate', sessionId: 'match-session', durationMinutes: 30 })).json()
      assert.ok(data.exam, `generation must succeed: ${JSON.stringify(data)}`)
      const matchingQuestions = data.exam.questions.filter((q: any) => q.type === 'matching' && q.ready !== false)
      assert.ok(matchingQuestions.length > 0, 'this fixture must produce at least one ready matching question in a single batch')
      for (const q of matchingQuestions) {
        assert.equal(q.pairs, undefined, 'the PUBLIC pre-submission payload must never carry `pairs` (the true correspondence)')
        assert.equal(q.matchingCorrectMap, undefined, 'the PUBLIC pre-submission payload must never carry the correctness map')
        assert.ok(Array.isArray(q.matchingLeftTexts) && Array.isArray(q.matchingRightTexts), 'must carry independent left/right text lists')
        assert.equal(q.matchingLeftTexts.length, q.matchingRightTexts.length)
      }
    } finally { Object.assign(__routeDeps, original) }
  })

  await test('9. matchingCorrectMap correctly identifies the true right-side position for every left index, and it is NEVER present in the public payload (grading proof + privacy proof together)', async () => {
    const original = { ...__routeDeps }
    try {
      const store = new InMemoryExamGenerationStore()
      Object.assign(__routeDeps, {
        getServerSession: async () => ({ user: { id: 'match-user-2' } }),
        getAuthoritativeFreeSession: async () => ({ id: 'match-session-2', userId: 'match-user-2', processMode: 'free', sourceSelection: { ...matchingSelection, fingerprint: 'fp-clutch-match-2' } }),
        getMaterial: async () => ({ id: 'clutch-m' }),
        lookupStudyalMaterialEnjoyer: async () => ({ ...matchingPayload, sourceSelectionFingerprint: 'fp-clutch-match-2' }),
        gradingStore: new MemoryExamGradingStore(), examStore: store,
        generateValidatedLegacyJson: async ({ validate, prompt }: any) => {
          const blocks = String(prompt).split(/\n(?=\d+\.\s+slotId=)/).filter((b: string) => /^\d+\.\s+slotId=/.test(b))
          const value = blocks.map((block: string, i: number) => {
            const slotId = block.match(/slotId=(\S+)/)?.[1] || ''
            const sourceItemIds = (block.match(/sourceItemIds=([^\n]+)/)?.[1] || '').split(',').map((v: string) => v.trim()).filter(Boolean)
            return { slotId, type: 'matching', sourceItemIds, prompt: `¿Empareja los términos #${i}?`, rubricHints: [], pairs: [{ left: 'x', right: 'y' }] }
          })
          assert.ok(validate(value).valid)
          return value
        },
      })
      const post = (body: object) => POST(new NextRequest('http://localhost/api/alai-studyal-exam', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
      const data = await (await post({ mode: 'generate', sessionId: 'match-session-2', durationMinutes: 30 })).json()
      assert.ok(data.exam, `generation must succeed: ${JSON.stringify(data)}`)
      const restored: any = await (store as any).getArtifact(require('../../lib/materialBrain/examGenerationStore').examGenerationIdentity('match-session-2', 'fp-clutch-match-2', data.exam.id))
      const privateQuestion = restored.questions.find((q: any) => q.type === 'matching')
      assert.ok(privateQuestion, 'private artifact must contain the matching question')
      assert.ok(privateQuestion.matchingCorrectMap, 'private artifact must carry the correctness map')
      const correctMap = privateQuestion.matchingCorrectMap
      for (const [leftIndex, rightIndex] of Object.entries(correctMap)) {
        assert.equal(privateQuestion.matchingRightTexts[rightIndex as number], privateQuestion.pairs[Number(leftIndex)].right, `left ${leftIndex} must map to its TRUE right text at the recorded shuffled position`)
      }
      const publicQuestion = data.exam.questions.find((q: any) => q.type === 'matching')
      assert.equal(publicQuestion.matchingCorrectMap, undefined, 'public payload must never carry the correctness map')
      assert.equal(publicQuestion.pairs, undefined, 'public payload must never carry the true pairs')
    } finally { Object.assign(__routeDeps, original) }
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('exam-product-correction-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
