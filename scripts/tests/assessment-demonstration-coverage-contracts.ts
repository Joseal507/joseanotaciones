import assert from 'node:assert/strict'
import {
  buildAssessmentBlueprint,
  canCompleteSessionFromAssessment,
  isFullyDemonstrated,
  normalizeAssessmentBlueprint,
  normalizeAssessmentObjective,
  recordAssessmentEvidence,
  unresolvedFactKeys,
  type AssessmentBlueprint,
  type AssessmentStepDeclaration,
} from '../../lib/adaptive/evaluation/assessmentBlueprint'
import { createRecoveryQueue, mergeRecoveryFailures, type RecoveryFailure } from '../../lib/adaptive/evaluation/recoveryQueue'
import type { SessionEvaluationQuestion } from '../../lib/adaptive/evaluation/sessionEvaluation'

// FASE 2 — Demonstration Coverage. Un objective solo se considera demostrado
// cuando requiredFactKeys (objective.factKeys) ⊆ demonstratedFactKeys, y
// demonstratedFactKeys SOLO crece por la intersección real entre lo que una
// pregunta targeteó y lo que el objective requiere — nunca por pertenencia
// amplia al mismo objective. Este archivo prueba las 10 reglas explícitas.

function question(id: string, factKey: string, sourceFactKeys?: string[]): SessionEvaluationQuestion {
  return {
    id,
    conceptId: 'micro-1',
    conceptLabel: 'Concepto objetivo',
    teachingBlockId: 'step-1',
    questionFamily: `family-${id}`,
    variant: 'mcq_best_answer',
    difficulty: 'medium',
    targetDimension: 'comprehension',
    format: 'multiple_choice',
    questionText: `¿Qué afirmación demuestra ${factKey}?`,
    options: [{ id: 'a', text: 'Correcta' }, { id: 'b', text: 'Incorrecta' }],
    correctAnswer: 'a',
    explanation: `Explicación académica de ${factKey}.`,
    hint: 'Contrasta ambas opciones.',
    estimatedSeconds: 30,
    evidencesNeeded: 1,
    factKey,
    factKeys: [factKey],
    targetObjectiveIds: ['objective-multi'],
    coveredStepIds: ['step-1'],
    coveredKeyPoints: ['kp-multi'],
    sourceFactKeys: sourceFactKeys ?? [factKey],
  } as SessionEvaluationQuestion
}

function failure(source: SessionEvaluationQuestion): RecoveryFailure {
  return { question: source, answer: 'b', result: { outcome: 'incorrect', correct: false, errorType: 'conceptual' } }
}

const stepMulti: AssessmentStepDeclaration = {
  id: 'step-multi', type: 'concept', microId: 'm-multi',
  factKeys: ['F1', 'F2', 'F3'],
  objectiveIds: ['objective-multi'],
  cognitiveTarget: 'comprehension', importance: 0.8,
}
const baseBlueprint = buildAssessmentBlueprint([stepMulti], 'session-demo')
const objectiveId = baseBlueprint.objectives[0].objectiveId
assert.deepEqual(new Set(baseBlueprint.objectives[0].factKeys), new Set(['F1', 'F2', 'F3']))

// ═══ Regla 1 — F1 correcto NO puede demostrar F5 (aquí F2/F3) solo por
// compartir objective. Una pregunta que SOLO targetea F1 solo puede demostrar F1. ═══
let b1 = recordAssessmentEvidence(baseBlueprint, [objectiveId], ['F1'], {
  valid: true, correct: true, independent: true, evidenceId: 'ev-f1',
})
const objAfterF1 = b1.objectives.find(o => o.objectiveId === objectiveId)!
assert.deepEqual(objAfterF1.demonstratedFactKeys, ['F1'], 'regla 1: solo F1 (el realmente targeteado) entra en demonstratedFactKeys')
assert.deepEqual(new Set(unresolvedFactKeys(objAfterF1)), new Set(['F2', 'F3']), 'regla 1: F2/F3 siguen sin demostrar pese a compartir objective con F1')
assert.equal(isFullyDemonstrated(objAfterF1), false)
assert.equal(canCompleteSessionFromAssessment(b1), false, 'regla 1: con F2/F3 pendientes, la sesión no puede completarse')

// ═══ Regla 2 — una pregunta que genuinamente targetea F1+F2 puede demostrar ambos. ═══
let b2 = recordAssessmentEvidence(baseBlueprint, [objectiveId], ['F1', 'F2'], {
  valid: true, correct: true, independent: true, evidenceId: 'ev-f1-f2',
})
const objAfterF1F2 = b2.objectives.find(o => o.objectiveId === objectiveId)!
assert.deepEqual(new Set(objAfterF1F2.demonstratedFactKeys), new Set(['F1', 'F2']), 'regla 2: una pregunta que targetea F1+F2 demuestra ambos')
assert.deepEqual(unresolvedFactKeys(objAfterF1F2), ['F3'])

// ═══ Regla 3 — una respuesta incorrecta nunca agrega a demonstratedFactKeys. ═══
let b3 = recordAssessmentEvidence(baseBlueprint, [objectiveId], ['F1'], {
  valid: true, correct: false, independent: true, evidenceId: 'ev-f1-wrong',
})
const objAfterWrong = b3.objectives.find(o => o.objectiveId === objectiveId)!
assert.deepEqual(objAfterWrong.demonstratedFactKeys, [], 'regla 3: incorrecto no demuestra nada')
assert.equal(objAfterWrong.failedAttempts, 1)
assert.equal(objAfterWrong.status, 'recovery_required')

// ═══ Regla 4 — la recuperación solo resuelve los factKeys que REALMENTE
// targeteó, no todo el objective. Una recovery que solo verifica F1 no puede
// demostrar F2/F3 aunque el objective completo esté en recovery. ═══
let b4 = recordAssessmentEvidence(baseBlueprint, [objectiveId], ['F1'], {
  valid: true, correct: false, independent: true, evidenceId: 'ev-f1-fail',
})
b4 = recordAssessmentEvidence(b4, [objectiveId], ['F1'], {
  valid: true, correct: true, independent: true, evidenceId: 'ev-f1-recovered',
})
const objAfterRecoveryF1 = b4.objectives.find(o => o.objectiveId === objectiveId)!
assert.deepEqual(objAfterRecoveryF1.demonstratedFactKeys, ['F1'], 'regla 4: la recovery de F1 solo demuestra F1')
assert.deepEqual(new Set(unresolvedFactKeys(objAfterRecoveryF1)), new Set(['F2', 'F3']), 'regla 4: F2/F3 siguen unresolved — la recovery no los tocó')
assert.equal(canCompleteSessionFromAssessment(b4), false)

// ═══ Regla 5 — RecoveryItem.sourceFactKeys preserva TODOS los factKeys
// reales de cada fallo fusionado, no solo el primero/singular. ═══
const qF1 = question('q-f1', 'F1')
const qF2 = question('q-f2', 'F2')
const initialQueue = createRecoveryQueue([failure(qF1)])
assert.deepEqual(initialQueue[0].sourceFactKeys, ['F1'], 'regla 5: creación inicial preserva el factKey real (vía sourceFactKeys de la pregunta)')
// Fuerza el mismo recoveryTargetId (mismo micro/question id) reusando qF1
// pero con un sourceFactKeys distinto simulando una pregunta regenerada que
// targeteó un factKey adicional del mismo cluster de recovery.
const qF1WithExtra = question('q-f1', 'F1', ['F1', 'F2'])
const mergedQueue = mergeRecoveryFailures(initialQueue, [failure(qF1WithExtra)])
assert.deepEqual(new Set(mergedQueue[0].sourceFactKeys), new Set(['F1', 'F2']), 'regla 5: el merge acumula TODOS los factKeys reales, no solo el primero')

// Caso createRecoveryQueue con 2 fallos que colapsan al mismo recoveryTargetId
// (mismo microId+questionId+cognitiveTarget+factKey inicial) — el branch
// "existing" de createRecoveryQueue también debe acumular con questionTargets().
const sharedFailureA: RecoveryFailure = failure(question('q-shared', 'F1', ['F1']))
const sharedFailureB: RecoveryFailure = failure(question('q-shared', 'F1', ['F1', 'F3']))
const collapsedQueue = createRecoveryQueue([sharedFailureA, sharedFailureB])
assert.equal(collapsedQueue.length, 1, 'mismo recoveryTargetId colapsa en un único RecoveryItem')
assert.deepEqual(new Set(collapsedQueue[0].sourceFactKeys), new Set(['F1', 'F3']), 'regla 5: el branch existing de createRecoveryQueue también preserva todos los factKeys reales')

// ═══ Regla 6 — restore (JSON roundtrip) preserva demonstratedFactKeys. ═══
const restored6 = JSON.parse(JSON.stringify(b2)) as AssessmentBlueprint
const restoredObjective6 = restored6.objectives.find(o => o.objectiveId === objectiveId)!
assert.deepEqual(new Set(restoredObjective6.demonstratedFactKeys), new Set(['F1', 'F2']), 'regla 6: demonstratedFactKeys sobrevive un roundtrip de persistencia')

// ═══ Regla 7 — retry no duplica evidencia ni inventa demonstratedFactKeys.
// Reenviar el MISMO evidenceId (p.ej. un reintento de red tras un 200 ya
// procesado) no debe reprocesar ni inflar failedAttempts/demonstratedFactKeys. ═══
let b7 = recordAssessmentEvidence(baseBlueprint, [objectiveId], ['F1'], {
  valid: true, correct: true, independent: true, evidenceId: 'ev-retry',
})
const afterFirst = b7.objectives.find(o => o.objectiveId === objectiveId)!
b7 = recordAssessmentEvidence(b7, [objectiveId], ['F1', 'F2'], {
  valid: true, correct: true, independent: true, evidenceId: 'ev-retry',
})
const afterRetry = b7.objectives.find(o => o.objectiveId === objectiveId)!
assert.deepEqual(afterRetry.demonstratedFactKeys, afterFirst.demonstratedFactKeys, 'regla 7: un evidenceId ya procesado no reprocesa (aunque el retry alegue targetear F2 también)')
assert.equal(afterRetry.evidenceIds.filter(id => id === 'ev-retry').length, 1, 'regla 7: el evidenceId no se duplica en evidenceIds')

// ═══ Regla 8 — estado viejo sin demonstratedFactKeys migra conservadoramente
// (nunca fabrica dominio desde independentlyCorrect==true de la semántica vieja). ═══
const legacyObjective = {
  objectiveId: 'legacy-obj', sessionId: 'sess', stepId: 'step-1', microId: 'm1',
  factKeys: ['F1', 'F2'],
  // shape viejo: sin demonstratedFactKeys, pero independentlyCorrect=true
  // (bajo la semántica vieja, "alguna vez correcto") y status='demonstrated'.
  cognitiveTarget: 'comprehension', importance: 0.8,
  taught: true, practiced: true, assessed: true,
  independentlyCorrect: true, assistedCorrect: false, failedAttempts: 0,
  evidenceIds: ['legacy-ev'], status: 'demonstrated',
}
const migrated = normalizeAssessmentObjective(legacyObjective)!
assert.deepEqual(migrated.demonstratedFactKeys, [], 'regla 8: sin demonstratedFactKeys persistido, migra a [] — nunca fabrica dominio')
assert.equal(migrated.independentlyCorrect, false, 'regla 8: independentlyCorrect se recalcula, no se hereda')
assert.equal(migrated.status, 'in_progress', 'regla 8: status demonstrated obsoleto se reabre a in_progress (assessed=true)')
assert.equal(isFullyDemonstrated(migrated), false)

const legacyBlueprintRaw = { sessionId: 'sess', version: 1, objectives: [legacyObjective] }
const migratedBlueprint = normalizeAssessmentBlueprint(legacyBlueprintRaw)!
assert.deepEqual(migratedBlueprint.unresolvedObjectiveIds, ['legacy-obj'], 'regla 8: el blueprint migrado exige evidencia nueva para legacy-obj')
assert.equal(canCompleteSessionFromAssessment(migratedBlueprint), false)

// ═══ Regla 9 — un objective está demostrado ÚNICAMENTE si
// requiredFactKeys ⊆ demonstratedFactKeys (probado ya arriba en reglas 1/2,
// aquí se verifica el caso frontera: demostrar TODOS los factKeys uno a uno). ═══
let b9 = baseBlueprint
for (const [index, factKey] of ['F1', 'F2'].entries()) {
  b9 = recordAssessmentEvidence(b9, [objectiveId], [factKey], {
    valid: true, correct: true, independent: true, evidenceId: `ev-b9-${index}`,
  })
}
const objAfterTwoOfThree = b9.objectives.find(o => o.objectiveId === objectiveId)!
assert.equal(isFullyDemonstrated(objAfterTwoOfThree), false, 'regla 9: con 2/3 factKeys demostrados, el objective NO está completamente demostrado')
b9 = recordAssessmentEvidence(b9, [objectiveId], ['F3'], {
  valid: true, correct: true, independent: true, evidenceId: 'ev-b9-last',
})
const objFullyDemonstrated = b9.objectives.find(o => o.objectiveId === objectiveId)!
assert.equal(isFullyDemonstrated(objFullyDemonstrated), true, 'regla 9: con 3/3 factKeys demostrados, el objective SÍ está completamente demostrado')
assert.equal(objFullyDemonstrated.status, 'demonstrated')

// ═══ Regla 10 — la finalización de sesión permanece bloqueada mientras
// falte cualquier requiredFactKey (independiente de cuántos objectives
// distintos existan en la sesión). ═══
const stepOther: AssessmentStepDeclaration = {
  id: 'step-other', type: 'concept', microId: 'm-other',
  factKeys: ['G1'], objectiveIds: ['objective-other'],
  cognitiveTarget: 'comprehension', importance: 0.8,
}
const multiObjectiveBlueprint = buildAssessmentBlueprint([stepMulti, stepOther], 'session-multi')
const [multiObjA, multiObjB] = multiObjectiveBlueprint.objectives.map(o => o.objectiveId)
let b10 = recordAssessmentEvidence(multiObjectiveBlueprint, [multiObjA], ['F1', 'F2', 'F3'], {
  valid: true, correct: true, independent: true, evidenceId: 'ev-b10-a',
})
assert.equal(canCompleteSessionFromAssessment(b10), false, 'regla 10: objective A completo pero B (G1) sin evidencia — sigue bloqueado')
b10 = recordAssessmentEvidence(b10, [multiObjB], ['G1'], {
  valid: true, correct: true, independent: true, evidenceId: 'ev-b10-b',
})
assert.equal(canCompleteSessionFromAssessment(b10), true, 'regla 10: con A y B completamente demostrados, la sesión puede completarse')

console.log('assessment-demonstration-coverage-contracts: reglas 1-10 PASS')
