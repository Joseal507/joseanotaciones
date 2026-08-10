import assert from 'node:assert/strict'
import {
  buildAssessmentBlueprint,
  calculateAssessmentCoverage,
  canCompleteSessionFromAssessment,
  getUnresolvedObjectives,
  recordAssessmentEvidence,
  validateQuestionAgainstAssessmentBlueprint,
  type AssessmentBlueprint,
  type AssessmentStepDeclaration,
} from '../../lib/adaptive/evaluation/assessmentBlueprint'

// REGRESIÓN #7 — un factKey enseñado podía quedar sin representación
// evaluable estable (sin objectiveId, sin AssessmentObjective, imposible de
// targetear/evaluar) cuando step.factKeys.length > step.objectiveIds.length
// (equivalente en producción a factKeys.length > keyPoints.length, ver
// session-teach/route.ts:1098 — objectiveIds se dimensiona por keyPoints, no
// por factKeys). La sesión podía declararse canCompleteSessionFromAssessment
// === true respecto a los objectives EXISTENTES sin que ese factKey hubiera
// sido jamás evaluado.
//
// Relación canónica establecida por el fix: un AssessmentObjective sigue
// representando exactamente 1 keyPoint (sin cambio de taxonomía — el
// keyPoint ya es la unidad de cobertura 100% garantizada por el STRICT
// COVERAGE BLOCKER de sessionEvaluation.ts). Cada factKey del step pertenece
// a EXACTAMENTE UN objective (distribución round-robin sobre declaredIds) —
// así ningún factKey enseñado queda sin pertenecer a algún objective
// evaluable, sin importar cuántos keyPoints tenga el step.
//
// NOTA (revisión Fase 2 — Demonstration Coverage): la versión original de
// este fix asignaba TODOS los factKeys del step a CADA objective. Bajo
// Demonstration Coverage (regla 1: solo la intersección real entre lo que
// una pregunta targetea y lo que el objective requiere puede demostrarse)
// eso volvía un objective permanentemente irresoluble en cuanto
// factKeys.length > keyPoints.length: sus factKeys "prestados" de un
// keyPoint hermano solo los targetea la pregunta de ESE hermano, que aporta
// evidencia al objectiveId del hermano, nunca a este. Reproducido en
// session-completion-edge-cases.spec.ts (E2E). Se cambió a distribución
// EXCLUSIVA — sigue garantizando #7 sin crear esa irresolubilidad.

function everyFactKeyRepresented(steps: AssessmentStepDeclaration[], blueprint: AssessmentBlueprint): boolean {
  return steps.every(step => {
    const taughtFacts = step.factKeys?.length ? step.factKeys : [step.id]
    const stepObjectives = blueprint.objectives.filter(objective => objective.stepId === step.id)
    const representedFacts = new Set(stepObjectives.flatMap(objective => objective.factKeys))
    return taughtFacts.every(factKey => representedFacts.has(factKey))
  })
}

// A — factKeys.length > keyPoints.length (objectiveIds dimensionado por
// keyPoints, como en producción real).
const stepMoreFacts: AssessmentStepDeclaration = {
  id: 'step_a', type: 'concept', microId: 'm_a',
  factKeys: ['fact-a1', 'fact-a2', 'fact-a3'],
  objectiveIds: ['obj-a1', 'obj-a2'], // solo 2 keyPoints
  cognitiveTarget: 'comprehension', importance: 0.8,
}
const blueprintA = buildAssessmentBlueprint([stepMoreFacts], 'session-a')
assert.equal(blueprintA.objectives.length, 2, 'sigue habiendo 1 objective por keyPoint (sin inventar unidades nuevas)')
assert.ok(everyFactKeyRepresented([stepMoreFacts], blueprintA), 'fact-a1/a2/a3 deben pertenecer a algún objective')
assert.equal(blueprintA.objectives.filter(objective => objective.factKeys.includes('fact-a3')).length, 1, 'fact-a3 (el que antes desaparecía) debe pertenecer a EXACTAMENTE un objective — no a todos (eso lo volvería irresoluble bajo demonstration coverage)')
let resolvedA = blueprintA
for (const objective of blueprintA.objectives) {
  resolvedA = recordAssessmentEvidence(resolvedA, [objective.objectiveId], objective.factKeys, { valid: true, correct: true, independent: true, evidenceId: `ev:${objective.objectiveId}` })
}
assert.equal(calculateAssessmentCoverage(resolvedA), 1)
assert.equal(canCompleteSessionFromAssessment(resolvedA), true)
// Ahora, a diferencia del bug original, esto es seguro: fact-a3 SÍ estaba
// representado en los objectives que se resolvieron — no desapareció.
assert.ok(everyFactKeyRepresented([stepMoreFacts], resolvedA))

// B — keyPoints.length > factKeys.length (más objectiveIds que factKeys
// declarados) — no debe romper nada ni perder objectives.
const stepMoreKeyPoints: AssessmentStepDeclaration = {
  id: 'step_b', type: 'concept', microId: 'm_b',
  factKeys: ['fact-b1'],
  objectiveIds: ['obj-b1', 'obj-b2', 'obj-b3'], // 3 keyPoints, solo 1 factKey
  cognitiveTarget: 'comprehension', importance: 0.8,
}
const blueprintB = buildAssessmentBlueprint([stepMoreKeyPoints], 'session-b')
assert.equal(blueprintB.objectives.length, 3, 'los 3 keyPoints siguen generando 3 objectives')
assert.ok(blueprintB.objectives.every(objective => objective.factKeys.includes('fact-b1')))
assert.ok(everyFactKeyRepresented([stepMoreKeyPoints], blueprintB))

// C — múltiples factKeys legítimamente pertenecientes al mismo keyPoint: una
// pregunta que targetea UN objective con VARIOS factKeys de ese step ya no
// debe rechazarse por ASSESSMENT_FACT_KEY_MISMATCH (antes del fix, solo el
// factKey zipeado por posición era válido para ese objective).
const stepSharedFacts: AssessmentStepDeclaration = {
  id: 'step_c', type: 'concept', microId: 'm_c',
  factKeys: ['fact-c1', 'fact-c2'],
  objectiveIds: ['obj-c1'], // 1 keyPoint que resume 2 factKeys relacionados
  cognitiveTarget: 'comprehension', importance: 0.8,
}
const blueprintC = buildAssessmentBlueprint([stepSharedFacts], 'session-c')
assert.equal(blueprintC.objectives.length, 1)
const objectiveC = blueprintC.objectives[0]
assert.deepEqual(new Set(objectiveC.factKeys), new Set(['fact-c1', 'fact-c2']))
const questionUsingBothFacts = {
  targetObjectiveIds: [objectiveC.objectiveId],
  microId: objectiveC.microId,
  factKeys: ['fact-c1', 'fact-c2'],
  cognitiveTarget: objectiveC.cognitiveTarget,
  questionText: '¿Qué relación conecta fact-c1 y fact-c2 en este contenido?',
}
assert.equal(validateQuestionAgainstAssessmentBlueprint(questionUsingBothFacts, blueprintC).valid, true, 'una pregunta que cubre ambos factKeys de un mismo keyPoint debe ser válida')

// D — restore (roundtrip JSON, igual que la persistencia real vía
// cd?.assessmentBlueprint en page.tsx) conserva el mapping factKey->objective.
const blueprintD = buildAssessmentBlueprint([stepMoreFacts, stepSharedFacts], 'session-d')
const restoredD = JSON.parse(JSON.stringify(blueprintD)) as AssessmentBlueprint
assert.deepEqual(restoredD.objectives.map(o => ({ objectiveId: o.objectiveId, factKeys: o.factKeys })),
  blueprintD.objectives.map(o => ({ objectiveId: o.objectiveId, factKeys: o.factKeys })))
assert.ok(everyFactKeyRepresented([stepMoreFacts, stepSharedFacts], restoredD), 'el mapping debe sobrevivir intacto a un restore')

// F — regresión E2E (session-completion-edge-cases.spec.ts): con
// factKeys.length > keyPoints.length, resolver un objective con SU PROPIO
// factKey nunca resuelve a un objective hermano del mismo step (nada de
// false mastery por asociación amplia), y cada objective SÍ puede resolverse
// de forma independiente con evidencia dirigida a su propio factKey — antes
// del fix de distribución exclusiva, obj-a2 exigía también fact-a3 (que solo
// obj-a1 puede demostrar) y quedaba permanentemente irresoluble.
const [objA1, objA2] = blueprintA.objectives
let onlyA1Resolved = recordAssessmentEvidence(blueprintA, [objA1.objectiveId], objA1.factKeys, { valid: true, correct: true, independent: true, evidenceId: 'f-ev-a1' })
assert.equal(getUnresolvedObjectives(onlyA1Resolved).some(o => o.objectiveId === objA2.objectiveId), true, 'obj-a2 sigue unresolved: la evidencia de obj-a1 no lo demostró por asociación')
let bothResolvedF = recordAssessmentEvidence(onlyA1Resolved, [objA2.objectiveId], objA2.factKeys, { valid: true, correct: true, independent: true, evidenceId: 'f-ev-a2' })
assert.equal(canCompleteSessionFromAssessment(bothResolvedF), true, 'con evidencia PROPIA para cada objective (incl. el que recibió fact-a3 en la distribución exclusiva), ambos se resuelven — no hay irresolubilidad estructural')

// E — la cobertura final NO puede dar complete si queda un factKey requerido
// sin representación evaluable. Con el fix, esto es estructuralmente
// imposible mientras el step tenga al menos 1 keyPoint (garantizado por
// TEACHING_CONTENT_INVALID en session-teach/route.ts, que exige
// keyPoints.length>=1) — se verifica aquí como propiedad sobre varias
// combinaciones de longitudes, no solo el caso puntual de A.
const combinations: Array<{ factKeys: string[]; objectiveIds: string[] }> = [
  { factKeys: ['f1'], objectiveIds: ['o1'] },
  { factKeys: ['f1', 'f2', 'f3', 'f4'], objectiveIds: ['o1'] },
  { factKeys: ['f1'], objectiveIds: ['o1', 'o2', 'o3', 'o4'] },
  { factKeys: ['f1', 'f2'], objectiveIds: ['o1', 'o2', 'o3'] },
  { factKeys: ['f1', 'f2', 'f3'], objectiveIds: ['o1', 'o2'] },
]
for (const [index, combo] of combinations.entries()) {
  const step: AssessmentStepDeclaration = {
    id: `step_e${index}`, type: 'concept', microId: `m_e${index}`,
    factKeys: combo.factKeys, objectiveIds: combo.objectiveIds,
    cognitiveTarget: 'comprehension', importance: 0.8,
  }
  const blueprint = buildAssessmentBlueprint([step], `session-e${index}`)
  assert.ok(everyFactKeyRepresented([step], blueprint), `combinación #${index} (${combo.factKeys.length} facts / ${combo.objectiveIds.length} objectiveIds): todo factKey debe pertenecer a algún objective`)
  // La exclusividad (cada factKey en UN solo objective) solo aplica cuando
  // hay suficientes facts para repartir 1:1 (factKeys.length >= objectiveIds.length)
  // — el round-robin logra exclusividad real en ese régimen. Cuando hay MENOS
  // facts que objectives, varios objectives comparten el mismo (único) fact
  // vía fallback — eso es correcto: cada uno tiene su propia pregunta
  // dedicada que puede suplir ese mismo fact compartido, no hay
  // irresolubilidad (a diferencia de A, donde el fact "prestado" solo la
  // pregunta del objective QUE LO RECIBIÓ podría suplir).
  if (combo.factKeys.length >= combo.objectiveIds.length) {
    for (const factKey of combo.factKeys) {
      const owners = blueprint.objectives.filter(objective => objective.factKeys.includes(factKey))
      assert.equal(owners.length, 1, `combinación #${index}: ${factKey} debe pertenecer a EXACTAMENTE un objective (distribución exclusiva), tiene ${owners.length}`)
    }
  }
  let resolved = blueprint
  for (const objective of blueprint.objectives) {
    resolved = recordAssessmentEvidence(resolved, [objective.objectiveId], objective.factKeys, { valid: true, correct: true, independent: true, evidenceId: `ev:${objective.objectiveId}` })
  }
  // Si canCompleteSessionFromAssessment da true, TODOS los factKeys deben
  // estar representados en los objectives ya resueltos — nunca puede haber
  // un factKey "huérfano" fuera del conjunto que se acaba de evaluar.
  if (canCompleteSessionFromAssessment(resolved)) {
    const representedInResolved = new Set(resolved.objectives.flatMap(o => o.factKeys))
    assert.ok(combo.factKeys.every(factKey => representedInResolved.has(factKey)),
      `combinación #${index}: no puede haber completion sin que todos los factKeys estén representados`)
  }
}

console.log('assessment-blueprint-factkey-objective-contracts: A-E PASS')
