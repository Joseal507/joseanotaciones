import { MemoryExamGradingStore } from '../../lib/materialBrain/examGrading'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { buildExamEnjoyerUniverse, composeEnjoyerExamBlueprint, conciseExcerpt, EXAM_ENJOYER_GENERATOR_VERSION } from '../../lib/materialBrain/examEnjoyerContext'
import { authorSlotQuestion, buildMultipleChoiceOptions, hasExactlyOneCanonicalOption, examTaskMatchesOperation, POST, __routeDeps } from '../../app/api/alai-studyal-exam/route'
import { InMemoryExamGenerationStore, examGenerationIdentity } from '../../lib/materialBrain/examGenerationStore'

const selection = { ...buildSourceSelectionSnapshot(['material'], { material: [20, 24] }), fingerprint: 'pass2-source' }
// Literal source sentences from the fresh persisted artifact; no chemistry calculation.
const inverse = 'Para la reacción $N_2O_4(g) \\rightleftharpoons 2NO_2(g)$, la constante de equilibrio $K_c$ es 0.212 a 100 °C. Para la reacción inversa, $2NO_2(g) \\rightleftharpoons N_2O_4(g)$, la constante de equilibrio $K_c$ es 4.72 a 100 °C, lo cual es el recíproco de 0.212.'
const lead = 'Para la reacción de disolución de cloruro de plomo (II), PbCl₂(s) ⇌ Pb²⁺(ac) + 2Cl⁻(ac), la expresión de la constante de equilibrio Kc solo incluye las concentraciones de los iones en disolución, [Pb²⁺] y [Cl⁻]², excluyendo el sólido PbCl₂.'
const item = (id: string, content: string, bloomLevel = 'understand', kind = 'concept') => ({ id, name: id, content, bloomLevel, kind, examTypes: ['mcq', 'open'], topicId: id, importance: 'high', difficulty: 'medium', materialId: 'material', pages: [20], sourceSpans: [{ page: 20, quote: content }] })
const payload = { sourceSelectionFingerprint: selection.fingerprint, materialIds: ['material'], selectedPages: selection.selectedPages,
  materialLanguage: 'es', topicsIndex: [{ id: 'inverse', title: 'Inversa' }], uniqueConceptsIndex: [],
  globalOrderedAnalysis: [item('inverse', inverse, 'apply', 'example'), item('lead', lead), item('recognition', 'La regla conserva la condición indicada. Esta condición delimita el caso.'), item('analysis', 'La primera condición favorece una dirección. La segunda permite justificar la comparación.', 'analyze')] }
const universe = buildExamEnjoyerUniverse(payload, selection)
const blueprint = composeEnjoyerExamBlueprint(universe, 30, 'pass2', 'pass2')
let count = 0
async function test(name: string, fn: () => unknown | Promise<unknown>) { await fn(); console.log(`PASS ${++count}: ${name}`) }
const post = (body: object) => POST(new NextRequest('http://localhost/api/alai-studyal-exam', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

async function main() {
await test('inverse example retains 4.72 AND its referent, never a first-sentence application criterion', () => {
  const slot = blueprint.slots.find(s => s.assessmentFocus === 'inverse')!
  assert.equal(slot.type, 'short_answer')
  assert.equal(slot.answerAuthority.kind, 'single_text')
  if (slot.answerAuthority.kind !== 'single_text') throw Error('criterion')
  assert.equal(slot.answerAuthority.canonicalValue, inverse)
  assert.equal(authorSlotQuestion('pass2', blueprint, slot, { slotId: slot.id, type: 'multiple_choice', sourceItemIds: slot.sourceItemIds, prompt: '¿Cuál es el valor de la constante inversa?', distractors: ['half of 0.212', '0.212', 'double of 0.212'] }), null)
})
await test('generic numeric, text and formula authorities have exactly one public correct value', () => {
  for (const canonical of ['4.72', 'Contrato bilateral', String.raw`K = \frac{a^2}{b_1}`]) {
    const distractors = canonical === '4.72' ? ['4.720', '0.212', '2.12', '9.44'] : ['Alternativa uno', 'Alternativa dos', 'Alternativa tres']
    const built = buildMultipleChoiceOptions({ kind: 'single_text', canonicalValue: canonical, distractorPool: [] }, distractors, canonical)!
    assert.ok(built)
    assert.ok(hasExactlyOneCanonicalOption(built.options, canonical, built.correctAnswer))
  }
  assert.equal(hasExactlyOneCanonicalOption(['0.212', '0.106', '0.424'], '4.72', 0), false)
  assert.equal(hasExactlyOneCanonicalOption(['4.72', '4.720', '0.212'], '4.72', 0), false)
})
await test('long first propositions and broken formulas cannot become ellipsis answers', () => {
  assert.equal(conciseExcerpt(lead), '')
  assert.equal(conciseExcerpt('Incomplete answer…'), '')
  assert.equal(conciseExcerpt(String.raw`A $\frac{a. b}{c}$ formula.`), '')
  assert.equal(conciseExcerpt('A complete proposition. A second proposition.'), 'A complete proposition.')
  const slot = blueprint.slots.find(s => s.assessmentFocus === 'lead')!
  assert.equal(slot.type, 'short_answer')
  assert.equal(slot.answerAuthority.kind === 'single_text' && slot.answerAuthority.canonicalValue, lead)
})
await test('closed options never backfill with unrelated true source statements', () => {
  assert.equal(buildMultipleChoiceOptions({kind:'single_text', canonicalValue:'Respuesta canónica.', distractorPool:['Otra verdad.', 'Una verdad distinta.']}, [], 'seed'), null)
})
await test('definition/recall cannot satisfy application; recognition cannot satisfy analysis', () => {
  const application = blueprint.slots.find(s => s.skill === 'application')!
  const analysis = blueprint.slots.find(s => s.skill === 'critical_thinking')!
  for (const prompt of ['¿Cuál es la definición correcta de Kc?', '¿Cuál es el valor proporcionado en el ejemplo?', 'What is the definition of the rule?']) assert.equal(examTaskMatchesOperation(application, prompt), false)
  assert.equal(examTaskMatchesOperation(analysis, '¿Qué implica que Q sea mayor que K?'), false)
  assert.equal(examTaskMatchesOperation(application, 'Aplica la regla al caso de la reacción inversa y muestra los pasos.'), true)
  assert.equal(examTaskMatchesOperation(analysis, 'Compara las dos condiciones del caso y justifica la conclusión con evidencia.'), true)
})
await test('server freezes operation and rubric; provider cannot replace skill or grading criterion', () => {
  const slot = blueprint.slots.find(s => s.skill === 'application')!
  const q = authorSlotQuestion('pass2', blueprint, slot, { type: slot.type, sourceItemIds: slot.sourceItemIds, prompt: 'Aplica la regla al caso de la reacción inversa y muestra los pasos.', skill: 'retention', rubricHints: ['Accept any answer'] })!
  assert.ok(q)
  assert.equal(q.skill, 'application')
  assert.equal(q.expectedAnswer, inverse)
  assert.ok(!q.rubricHints?.includes('Accept any answer'))
})
await test('every exposed duration composes within its budget with explicit target accounting', () => {
  for (const duration of [15, 30, 45, 60, 90]) {
    const b = composeEnjoyerExamBlueprint(universe, duration, 'duration', 'duration')
    assert.ok(b.slots.length > 0)
    assert.ok(b.expectedCompletionSeconds <= duration * 60 * 0.85)
    const ids = [...b.coverage.assessedTargetIds, ...b.coverage.contextOnlyTargetIds, ...b.coverage.notAssessedDueToScopeTargetIds]
    assert.equal(new Set(ids).size, universe.targets.length)
    assert.equal(ids.length, universe.targets.length)
  }
})
await test('UI response format is independent of frozen skill, including restored old section names', () => {
  const ui = readFileSync('components/materias/ALAIStudyALExams.tsx', 'utf8')
  assert.ok(ui.includes("short_answer: 'Respuesta corta'"))
  assert.ok(ui.includes('{TYPE_LABEL[q.type]}</div>'))
  assert.ok(!ui.includes('{q.section}</div>'))
})
await test('old 15-minute schema restores without assessedTargetIds crash, mutation or provider calls', async () => {
  const original = { ...__routeDeps }
  try {
    const store = new InMemoryExamGenerationStore()
    const oldBlueprint = JSON.parse(JSON.stringify(blueprint))
    delete oldBlueprint.coverage.assessedTargetIds
    delete oldBlueprint.coverage.assessedCoveragePercent
    oldBlueprint.schemaVersion = 2
    oldBlueprint.generatorVersion = 'enjoyer-exam-progressive-1.0.0'
    const identity = examGenerationIdentity('session', selection.fingerprint, 'old-15')
    const manifest = { schemaVersion: 2, identity, examId: 'old-15', fingerprint: selection.fingerprint, sessionId: 'session', blueprint: oldBlueprint, totalSlots: 0, status: 'ready' as const, slots: {}, providerAttemptsBudget: 0, providerAttemptsUsed: 0, createdAt: '', updatedAt: '' }
    await store.saveManifest(identity, manifest)
    await store.saveArtifact(identity, { examId: 'old-15', fingerprint: selection.fingerprint, meta: { status:'ready', generatedAt:'' }, questions: [] })
    Object.assign(__routeDeps, { getServerSession: async()=>({user:{id:'user'}}), getAuthoritativeFreeSession: async()=>({id:'session',userId:'user',sourceSelection:selection}), gradingStore: new MemoryExamGradingStore(), examStore:store, generateValidatedLegacyJson:async()=>{ throw Error('NO_PROVIDER_ALLOWED') } })
    const data = await (await post({mode:'advance',sessionId:'session',examId:'old-15'})).json()
    assert.equal(data.success,true,JSON.stringify(data))
    assert.match(data.exam.coverage,/cobertura directa no disponible/)
    assert.deepEqual(await store.getManifest(identity),manifest)
  } finally { Object.assign(__routeDeps,original) }
})
await test('recovery uses actual weak canonical concept, source pages and scored skill without another call', async () => {
  const original = { ...__routeDeps }
  try {
    const store = new InMemoryExamGenerationStore()
    const identity = examGenerationIdentity('session', selection.fingerprint, 'recovery')
    const slot = blueprint.slots.find(s => s.skill === 'application')!
    const q = authorSlotQuestion('recovery', blueprint, slot, { type:slot.type, sourceItemIds:slot.sourceItemIds, prompt:'Aplica la regla al caso de la reacción inversa y muestra los pasos.' })!
    assert.ok(q)
    await store.saveManifest(identity, { schemaVersion:2, identity, examId:'recovery', fingerprint:selection.fingerprint, sessionId:'session', blueprint, totalSlots:1, status:'ready', slots:{[slot.id]:{status:'ready',attempts:1,questionId:q.id}},providerAttemptsBudget:2,providerAttemptsUsed:1,createdAt:'',updatedAt:'' })
    await store.saveArtifact(identity,{examId:'recovery',fingerprint:selection.fingerprint,meta:{status:'ready',generatedAt:''},questions:[q]})
    let calls=0
    Object.assign(__routeDeps,{getServerSession:async()=>({user:{id:'user'}}),getAuthoritativeFreeSession:async()=>({id:'session',userId:'user',sourceSelection:selection}),gradingStore: new MemoryExamGradingStore(), examStore:store,generateValidatedLegacyJson:async()=>{calls++;throw Error('NO_PROVIDER')}})
    const data=await(await post({mode:'evaluate',sessionId:'session',examId:'recovery',answers:['']})).json()
    assert.equal(data.success,true,JSON.stringify(data))
    assert.deepEqual(data.evaluation.weakConcepts,['inverse'])
    assert.match(data.evaluation.recoveryPlan[0].detail,/20/)
    assert.match(data.evaluation.recoveryPlan[0].detail,/procedimiento/)
    assert.equal(data.evaluation.skillScores.explanation,null)
    assert.equal(calls,0)
  } finally {Object.assign(__routeDeps,original)}
})
await test('fresh identity includes generator version; explicit old-ID restore remains supported', () => {
  const route = readFileSync('app/api/alai-studyal-exam/route.ts','utf8')
  assert.ok(route.includes('requestedDurationMinutes, v: EXAM_ENJOYER_GENERATOR_VERSION'))
  assert.equal(EXAM_ENJOYER_GENERATOR_VERSION,'enjoyer-exam-evidence-4.0.0')
})
console.log(`exam-product-integrity-pass2: ${count} passed`)
}
main().catch(e=>{console.error(e);process.exitCode=1})
