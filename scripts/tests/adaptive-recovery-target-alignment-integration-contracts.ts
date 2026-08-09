import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createRecoveryQueue,
  validateRecoveryTargetAlignment,
  recordRecoveryCheck,
  beginRecoveryReteach,
  recordRecoveryReteachContent,
  beginRecoveryVerification,
  type RecoveryFailure,
  type RecoveryItem,
} from '../../lib/adaptive/evaluation/recoveryQueue'
import { validateRecoveryAlignment, type AssessmentQuestionTarget } from '../../lib/adaptive/evaluation/assessmentBlueprint'
import type { SessionEvaluationQuestion } from '../../lib/adaptive/evaluation/sessionEvaluation'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

// P1-A — RECOVERY TARGET ALIGNMENT REAL
//
// validateRecoveryTargetAlignment/validateRecoveryAlignment son correctas como funciones
// puras (ya probado en adaptive-recovery-target-contracts.ts / assessment-blueprint-contracts.ts).
// El bug real era DÓNDE y CUÁNDO se llamaban: en los tres sitios que generan preguntas de
// recovery, el código sobrescribía conceptId/targetDimension/coveredStepIds/coveredKeyPoints/
// factKeys con los valores canónicos del RecoveryItem ANTES de validar — así que la
// validación comparaba el target contra una copia de sí mismo y nunca podía fallar.
//
// Este archivo prueba A-E contra las funciones puras reales (documentan el contrato
// correcto), F como verificación ESTRUCTURAL de que la validación ahora ocurre ANTES de
// la sobrescritura en los tres sitios reales (rojo antes del fix, verde después), y G/H
// contra el flujo real de avance de ronda / colas paralelas.

function question(id: string, stepId: string, keyPoint: string, factKey: string, overrides: Partial<SessionEvaluationQuestion> = {}): SessionEvaluationQuestion {
  return {
    id, conceptId: 'micro-1', conceptLabel: 'Concepto objetivo', teachingBlockId: stepId,
    questionFamily: `family-${id}`, variant: 'mcq_best_answer', difficulty: 'medium',
    targetDimension: 'comprehension', format: 'multiple_choice',
    questionText: `¿Qué afirmación demuestra ${keyPoint}?`,
    options: [{ id: 'a', text: 'Correcta' }, { id: 'b', text: 'Incorrecta' }], correctAnswer: 'a',
    explanation: `Explicación académica de ${keyPoint}.`, hint: 'Contrasta ambas opciones.',
    estimatedSeconds: 30, evidencesNeeded: 1, factKey, factKeys: [factKey],
    targetObjectiveIds: [`objective-${keyPoint}`], coveredStepIds: [stepId], coveredKeyPoints: [keyPoint],
    ...overrides,
  } as SessionEvaluationQuestion
}

function failure(source: SessionEvaluationQuestion): RecoveryFailure {
  return { question: source, answer: 'b', result: { outcome: 'incorrect', correct: false, errorType: 'conceptual' } }
}

const sourceQuestion = question('q-original', 'step-1', 'kp-1', 'fact-1')
const [item] = createRecoveryQueue([failure(sourceQuestion)])

// ═══ A. generated target correcto → acepta ═══
const alignedGenerated = { ...sourceQuestion, id: 'gen-1' } as unknown as CanonicalQuestion
assert.equal(validateRecoveryTargetAlignment(item, alignedGenerated).valid, true, 'A: target generado alineado debe aceptarse')

// ═══ B. generated sourceStepIds incorrectos → detecta ═══
const wrongSteps = { ...sourceQuestion, id: 'gen-2', coveredStepIds: ['step-OTHER'] } as unknown as CanonicalQuestion
const bResult = validateRecoveryTargetAlignment(item, wrongSteps)
assert.equal(bResult.valid, false, 'B: sourceStepIds distintos deben detectarse')
assert.deepEqual(bResult.errors, ['RECOVERY_TARGET_DRIFT'])

// ═══ C. generated sourceFactKeys incorrectos → detecta ═══
const wrongFactKeys = { ...sourceQuestion, id: 'gen-3', factKeys: ['fact-OTHER'], factKey: 'fact-OTHER' } as unknown as CanonicalQuestion
const cResult = validateRecoveryTargetAlignment(item, wrongFactKeys)
assert.equal(cResult.valid, false, 'C: factKeys distintos deben detectarse')
assert.deepEqual(cResult.errors, ['RECOVERY_TARGET_DRIFT'])

// ═══ D. generated cognitiveTarget incorrecto → detecta ═══
const wrongDimension = { ...sourceQuestion, id: 'gen-4', targetDimension: 'application' } as unknown as CanonicalQuestion
const dResult = validateRecoveryTargetAlignment(item, wrongDimension)
assert.equal(dResult.valid, false, 'D: targetDimension distinto debe detectarse')
assert.deepEqual(dResult.errors, ['RECOVERY_TARGET_DRIFT'])

// ═══ E. generated metadata ausente → comportamiento explícito y conservador ═══
// Ausencia de coveredStepIds/coveredKeyPoints/factKeys — el fallback de questionTargets()
// NO debe pasar silenciosamente cuando el item objetivo tiene targets no triviales.
const missingMetadata = {
  ...sourceQuestion, id: 'gen-5', coveredStepIds: undefined, coveredKeyPoints: undefined,
  factKeys: undefined, factKey: 'fact-1', teachingBlockId: 'step-DIFFERENT',
} as unknown as CanonicalQuestion
const eResult = validateRecoveryTargetAlignment(item, missingMetadata)
assert.equal(eResult.valid, false, 'E: metadata ausente con fallback que no coincide con el target real debe rechazarse, no pasar por defecto')

// Misma prueba A-E contra validateRecoveryAlignment (la validación real que usa el servidor)
const expectedTarget: AssessmentQuestionTarget = {
  targetObjectiveIds: ['obj-1'], microId: 'micro-1', factKeys: ['fact-1'], cognitiveTarget: 'comprehension',
}
assert.equal(validateRecoveryAlignment(expectedTarget, { ...expectedTarget }).valid, true, 'A(server): target alineado se acepta')
assert.equal(validateRecoveryAlignment(expectedTarget, { ...expectedTarget, factKeys: ['fact-OTHER'] }).valid, false, 'C(server): factKeys distintos se detectan')
assert.equal(validateRecoveryAlignment(expectedTarget, { ...expectedTarget, cognitiveTarget: 'application' }).valid, false, 'D(server): cognitiveTarget distinto se detecta')
assert.equal(validateRecoveryAlignment(expectedTarget, { ...expectedTarget, microId: 'micro-OTHER' }).valid, false, 'B(server): microId distinto se detecta')
assert.equal(validateRecoveryAlignment(expectedTarget, { ...expectedTarget, factKeys: [] }).valid, false, 'E(server): factKeys ausentes contra un target no vacío se rechazan')

// ═══ F. metadata sobrescrita antes del validator → el fix debe demostrar que ya no puede
//        ocultar el error. Verificación ESTRUCTURAL: en los tres sitios reales que generan
//        preguntas de recovery, la llamada de validación debe aparecer ANTES (en el texto
//        fuente) de la sobrescritura de conceptId/targetDimension/coveredStepIds/factKeys
//        con los valores canónicos — nunca después. ═══

// Sitio 1 — page.tsx generateRecoveryQuestions (consumidor del resultado de session-eval)
const pageSource = readFileSync('app/materias/[temaId]/sesion/[sessionNumber]/page.tsx', 'utf8')
const pageValidateIdx = pageSource.indexOf('validateRecoveryTargetAlignment(workingItem, received)')
const pageOverwriteIdx = pageSource.indexOf('conceptId: workingItem.microId,')
assert.ok(pageValidateIdx >= 0, 'F(page.tsx): debe existir una llamada a validateRecoveryTargetAlignment sobre el dato crudo (received), no sobre el normalizado')
assert.ok(pageOverwriteIdx >= 0, 'F(page.tsx): debe seguir existiendo la normalización canónica tras validar')
assert.ok(pageValidateIdx < pageOverwriteIdx, 'F(page.tsx): la validación debe ocurrir ANTES de sobrescribir conceptId con el valor canónico — si no, siempre pasa por construcción')

// Sitio 2 — session-eval/route.ts normalizeBatch (genera preguntas para recovery vía LLM)
const sessionEvalSource = readFileSync('app/api/adaptive/session-eval/route.ts', 'utf8')
const evalValidateIdx = sessionEvalSource.indexOf('validateRecoveryAlignment(sourceRecoveryTarget,')
const evalOverwriteIdx = sessionEvalSource.indexOf('const conceptId = sourceRecoveryTarget?.microId')
assert.ok(evalValidateIdx >= 0, 'F(session-eval): debe existir una llamada a validateRecoveryAlignment')
assert.ok(evalOverwriteIdx >= 0, 'F(session-eval): debe seguir existiendo la normalización canónica de conceptId')
assert.ok(evalValidateIdx < evalOverwriteIdx, 'F(session-eval): la validación debe ocurrir ANTES de derivar conceptId del target canónico — si no, siempre pasa por construcción')

// Sitio 3 — session-reteach/route.ts buildCandidate (ruta principal: prefetch + reteach)
const sessionReteachSource = readFileSync('app/api/adaptive/session-reteach/route.ts', 'utf8')
const reteachValidateIdx = sessionReteachSource.indexOf('normalized.targetDimension !== target.cognitiveTarget')
const reteachOverwriteIdx = sessionReteachSource.indexOf('factKey: target.sourceFactKeys[0] || normalized.factKey,')
assert.ok(reteachValidateIdx >= 0, 'F(session-reteach): debe existir una comprobación del targetDimension generado contra el target canónico — única señal cruda que este endpoint preserva (el prompt no solicita conceptId/factKeys de vuelta)')
assert.ok(reteachOverwriteIdx >= 0, 'F(session-reteach): debe seguir existiendo la normalización canónica')
assert.ok(reteachValidateIdx < reteachOverwriteIdx, 'F(session-reteach): la comprobación debe ocurrir ANTES de sobrescribir targetDimension con el valor canónico')

// ═══ G. ronda 2 mantiene exactamente el mismo recovery target canónico ═══
assert.equal(item.status, 'pending_reteach', 'un recovery recién creado empieza pending_reteach (ronda 0 ya perdida)')
const reteaching = beginRecoveryReteach(item, 'alternative_representation')
const withContent = recordRecoveryReteachContent(reteaching, 'Nueva explicación.')
const round2 = beginRecoveryVerification(withContent)
assert.equal(round2.verificationRound, 1, 'debe avanzar a la ronda 2 (índice 1)')
assert.deepEqual(round2.sourceStepIds, item.sourceStepIds, 'G: sourceStepIds no cambia entre rondas')
assert.deepEqual(round2.sourceKeyPoints, item.sourceKeyPoints, 'G: sourceKeyPoints no cambia entre rondas')
assert.deepEqual(round2.sourceFactKeys, item.sourceFactKeys, 'G: sourceFactKeys no cambia entre rondas')
assert.equal(round2.microId, item.microId, 'G: microId no cambia entre rondas')
assert.equal(round2.cognitiveTarget, item.cognitiveTarget, 'G: cognitiveTarget no cambia entre rondas')
assert.equal(round2.recoveryTargetId, item.recoveryTargetId, 'G: recoveryTargetId (identidad canónica) no cambia entre rondas')

// ═══ H. dos recoveries simultáneos no intercambian targets ═══
const questionA = question('q-a', 'step-A', 'kp-A', 'fact-A')
const questionB = question('q-b', 'step-B', 'kp-B', 'fact-B')
const [itemA, itemB] = createRecoveryQueue([failure(questionA), failure(questionB)])
assert.notEqual(itemA.recoveryTargetId, itemB.recoveryTargetId, 'H: dos recoveries distintos tienen recoveryTargetId distintos')
assert.deepEqual(itemA.sourceStepIds, ['step-A']); assert.deepEqual(itemB.sourceStepIds, ['step-B'])
assert.deepEqual(itemA.sourceFactKeys, ['fact-A']); assert.deepEqual(itemB.sourceFactKeys, ['fact-B'])
// Avanzar A a través de una ronda no debe tocar B en absoluto.
const recordedA = recordRecoveryCheck(itemA, question('va-1', 'step-A', 'kp-A', 'fact-A'), { outcome: 'incorrect', correct: false }, 'independent', 'b')
assert.deepEqual(itemB.sourceStepIds, ['step-B'], 'H: procesar A no debe mutar el target de B (inmutabilidad de RecoveryItem)')
assert.notEqual(recordedA.item.recoveryTargetId, itemB.recoveryTargetId, 'H: el recoveryTargetId de A tras avanzar sigue sin coincidir con B')
// Una pregunta generada con el target de B jamás debe validar contra el item A.
const crossedQuestion = { ...questionB } as unknown as CanonicalQuestion
assert.equal(validateRecoveryTargetAlignment(itemA, crossedQuestion).valid, false, 'H: una pregunta generada para el target de B debe rechazarse contra el recovery A')

console.log('adaptive-recovery-target-alignment-integration-contracts: 21 contracts PASS (A-H)')
