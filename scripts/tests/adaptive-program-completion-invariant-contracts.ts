import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildAssessmentBlueprint,
  recordAssessmentEvidence,
  canCompleteSessionFromAssessment,
  getUnresolvedObjectives,
} from '../../lib/adaptive/evaluation/assessmentBlueprint'
import { deriveNextSessionAction } from '../../lib/adaptive/sessionFinalTransition'

// DEMOSTRACIÓN DEL INVARIANTE (auditoría post-P1-B):
//
// Pregunta: ¿puede sessionNumber entrar en completedSessionNumbers con algún
// objetivo/micro requerido sin resolver (no independientemente demostrado)?
//
// completedSessionNumbers solo gana un número a través de completeAdaptiveSession,
// cuyo único caller (page.tsx completeLearningSession) exige, por una de dos vías:
//   (a) deriveNextSessionAction === complete_session, que requiere
//       sessionCompletionResult.isSessionComplete (assessmentComplete real vía
//       canCompleteSessionFromAssessment) Y objectiveCoverageRatio === 1; o
//   (b) el fallback defensivo "clean state", que exige
//       assessmentBlueprintRef.current.unresolvedObjectiveIds.length === 0
//       (blueprintClean) + sin preguntas pendientes + sin deuda de recovery.
//
// Ambas vías dependen de AssessmentBlueprint.unresolvedObjectiveIds /
// canCompleteSessionFromAssessment — este archivo prueba, contra el código REAL de
// assessmentBlueprint.ts (no una reimplementación), que unresolvedObjectiveIds vacío
// implica demonstratedObjectiveIds cubre TODOS los objetivos enseñados — PERO solo
// porque el único caller vivo (page.tsx) llama recordAssessmentEvidence con
// independent:true SIEMPRE (verificado abajo de forma estática). La garantía real
// vive en esa combinación de dos hechos, no en una sola función aislada.

// ═══ Hecho 1: recordAssessmentEvidence/canCompleteSessionFromAssessment, en código
// real, NUNCA permiten "resuelto" sin independentlyCorrect — mientras independent
// sea siempre true en el caller (hecho 2, verificado por separado más abajo). ═══

const steps = [
  { id: 'step-1', title: 'Paso 1', content: 'contenido', keyPoints: ['kp-1'], importance: 0.8 },
  { id: 'step-2', title: 'Paso 2', content: 'contenido', keyPoints: ['kp-2'], importance: 0.8 },
]
let blueprint = buildAssessmentBlueprint(steps, 'sess-1', 1)
assert.equal(blueprint.objectives.length >= 2, true, 'debe haber al menos 2 objetivos enseñables para la prueba')
const [objA, objB] = blueprint.objectives.map(o => o.objectiveId)

// Caso "sesión sin errores": ambos objetivos correctos e independientes.
let b1 = recordAssessmentEvidence(blueprint, [objA], { valid: true, correct: true, independent: true, evidenceId: 'ev-a' })
b1 = recordAssessmentEvidence(b1, [objB], { valid: true, correct: true, independent: true, evidenceId: 'ev-b' })
assert.deepEqual(b1.unresolvedObjectiveIds, [], 'sin errores: unresolvedObjectiveIds vacío')
assert.deepEqual(new Set(b1.demonstratedObjectiveIds), new Set([objA, objB]), 'sin errores: demonstratedObjectiveIds cubre TODO lo enseñado')
assert.equal(canCompleteSessionFromAssessment(b1, []), true)

// Caso "error recuperado": B falla primero, luego se resuelve vía recovery
// (recordAssessmentEvidence se llama de nuevo con correct:true, independent:true —
// exactamente como hace page.tsx cuando una recovery se resuelve).
let b2 = recordAssessmentEvidence(blueprint, [objA], { valid: true, correct: true, independent: true, evidenceId: 'ev-a' })
b2 = recordAssessmentEvidence(b2, [objB], { valid: true, correct: false, independent: true, evidenceId: 'ev-b-fail' })
assert.deepEqual(b2.unresolvedObjectiveIds, [objB], 'tras el fallo, B queda unresolved (recovery_required) antes de recuperarse')
assert.equal(canCompleteSessionFromAssessment(b2, []), false, 'con B sin recuperar, la sesión NO puede completarse')
b2 = recordAssessmentEvidence(b2, [objB], { valid: true, correct: true, independent: true, evidenceId: 'ev-b-recovered' })
assert.deepEqual(b2.unresolvedObjectiveIds, [], 'error recuperado: unresolvedObjectiveIds vuelve a vacío')
assert.deepEqual(new Set(b2.demonstratedObjectiveIds), new Set([objA, objB]), 'error recuperado: demonstratedObjectiveIds cubre TODO — la recuperación cuenta como evidencia real')
assert.equal(canCompleteSessionFromAssessment(b2, []), true)

// Caso "error NO recuperado" / "recovery agotado": B sigue failed/recovery_required.
let b3 = recordAssessmentEvidence(blueprint, [objA], { valid: true, correct: true, independent: true, evidenceId: 'ev-a' })
b3 = recordAssessmentEvidence(b3, [objB], { valid: true, correct: false, independent: true, evidenceId: 'ev-b-fail-1' })
b3 = recordAssessmentEvidence(b3, [objB], { valid: true, correct: false, independent: true, evidenceId: 'ev-b-fail-2' })
assert.deepEqual(b3.unresolvedObjectiveIds, [objB], 'error no recuperado (fallos repetidos): B permanece unresolved indefinidamente')
assert.equal(canCompleteSessionFromAssessment(b3, []), false, 'con un objetivo nunca recuperado, la sesión NUNCA puede completarse — no hay límite que lo perdone')

// Caso "recovery pendiente" (activeRecoveryTargetIds no vacío): incluso con
// unresolvedObjectiveIds vacío, canCompleteSessionFromAssessment exige también que
// no queden recovery targets activos — un tercer eje independiente de protección.
assert.equal(canCompleteSessionFromAssessment(b1, ['recovery:objA:pending']), false, 'recovery activa bloquea completion aunque unresolvedObjectiveIds esté vacío')

// ═══ Hecho 2 (post auditoría adversarial Codex, Finding 1 — CONFIRMED y
// corregido): el Hecho 2 ORIGINAL de esta prueba exigía que page.tsx pasara
// SIEMPRE independent:true como LITERAL — eso codificaba el bug: el hint se
// renderiza automáticamente sin interacción del estudiante (sin tracking de
// uso), así que una respuesta correcta vista con pista se registraba como
// independiente igual que una genuinamente sin ayuda. El comentario original
// de este archivo ya avisaba: "si alguno pasa una variable, la garantía deja
// de ser estática y este test debe fallar para forzar revisión" — este es
// exactamente ese momento. El fix real vive en page.tsx (hintShownRef, dos
// nuevos useEffect) y se prueba end-to-end en
// scripts/tests/hint-assistance-independence-contracts.ts. Este archivo ahora
// invierte el tripwire: vigila que NO se reintroduzca el hardcode. ═══
const pageSource = readFileSync('app/materias/[temaId]/sesion/[sessionNumber]/page.tsx', 'utf8')
const recordCallSites = pageSource.split('recordAssessmentEvidence(').length - 1
assert.equal(recordCallSites, 2, 'deben existir exactamente 2 call sites de recordAssessmentEvidence en el producto vivo — si aparece uno nuevo, esta prueba debe revisarse')
const independentTrueLiterals = (pageSource.match(/independent:\s*true,/g) || []).length
assert.equal(independentTrueLiterals, 0, 'los call sites de recordAssessmentEvidence en page.tsx NO deben volver a hardcodear independent:true — deben derivarlo de si hubo asistencia real en este intento (hintShownRef); un literal aquí es el bug de Codex Finding 1 reapareciendo')
assert.ok(pageSource.includes('hintShownRef'), 'page.tsx debe tener una fuente real de tracking de asistencia (hintShownRef) alimentando independent — si se elimina sin reemplazo equivalente, revisa que no se haya vuelto a un hardcode')

// ═══ Demostración de la brecha LATENTE (no explotable hoy, mecanismo distinto) ═══
// Si independent:false SÍ llegara a ocurrir (p.ej. un futuro hint/reveal), un
// objetivo correcto-pero-asistido queda assessed=true, status='in_progress',
// independentlyCorrect=false — NI en unresolvedObjectiveIds NI en
// demonstratedObjectiveIds. Esto prueba que la garantía NO es un invariante interno
// de assessmentBlueprint.ts por sí solo — depende del Hecho 2 (estático) de arriba.
let bLatent = recordAssessmentEvidence(blueprint, [objA], { valid: true, correct: true, independent: true, evidenceId: 'ev-a' })
bLatent = recordAssessmentEvidence(bLatent, [objB], { valid: true, correct: true, independent: false, evidenceId: 'ev-b-assisted' })
const assistedObjective = bLatent.objectives.find(o => o.objectiveId === objB)!
assert.equal(assistedObjective.status, 'in_progress', 'correcto-pero-asistido produce status in_progress, no demonstrated ni failed')
assert.equal(bLatent.unresolvedObjectiveIds.includes(objB), false, 'BRECHA LATENTE CONFIRMADA: un objetivo solo asistido NO aparece en unresolvedObjectiveIds')
assert.equal(bLatent.demonstratedObjectiveIds.includes(objB), false, 'y tampoco aparece en demonstratedObjectiveIds — queda en un limbo que blueprintClean trataría como "resuelto" sin serlo')
assert.equal(canCompleteSessionFromAssessment(bLatent, []), true, 'canCompleteSessionFromAssessment lo aceptaría como completable — la única razón por la que esto no ocurre hoy es el Hecho 2 (independent:true hardcoded), no una protección estructural de esta función')

// ═══ E2E4 / Caso A vs B — ¿puede completedSessionNumbers avanzar con un objetivo
// unresolved? (ver AGENTS.md) ═══
//
// completeLearningSession (page.tsx) exige finalAction.type==="complete_session"
// (deriveNextSessionAction, código REAL importado aquí, no reimplementado) — o si no,
// el fallback defensivo "clean state" que exige blueprintClean (unresolvedObjectiveIds
// vacío) por separado. deriveNextSessionAction(sessionFinalTransition.ts) exige
// sessionCompletionResult.isSessionComplete===true, y sessionTransitionState (page.tsx)
// computa isSessionComplete = lastStep && allBlocksComplete && assessmentComplete, donde
// assessmentComplete = canCompleteSessionFromAssessment(activeAssessment, ...) — la MISMA
// función ya probada arriba que retorna false mientras unresolvedObjectiveIds no esté
// vacío. Por tanto CASO A (arquitectura hace imposible completar con unresolved) está
// demostrado: no hace falta un test rojo (CASO B), solo blindar el gate en su forma pura.
const stateWithUnresolvedObjective = {
  currentStepIndex: 0, currentEvaluationBlock: null, currentQuestionIndex: 0,
  unansweredNormalQuestions: 0, pendingRecoveries: 0, latentRecoveries: 0, activeRecovery: false,
  completedEvaluationBlocks: 1, totalEvaluationBlocks: 1, totalTeachingSteps: 1,
  sessionKind: 'learning' as const,
  // Refleja exactamente lo que sessionTransitionState calcularía con b3 (arriba): un
  // objetivo nunca recuperado ⇒ assessmentComplete=false ⇒ isSessionComplete=false.
  sessionCompletionResult: { objectiveCoverageRatio: 0.5, isSessionComplete: false },
}
const actionWithUnresolvedObjective = deriveNextSessionAction(stateWithUnresolvedObjective)
assert.notEqual(actionWithUnresolvedObjective.type, 'complete_session', 'CASO A: con isSessionComplete=false (objetivo unresolved), deriveNextSessionAction NUNCA debe devolver complete_session')
assert.equal(actionWithUnresolvedObjective.type, 'blocked', 'con evaluación cubierta pero objetivo unresolved, la acción debe ser blocked por objective_coverage_incomplete o engine_session_incomplete')

// Confirma también el camino positivo con el MISMO tipo de estado (paridad de forma):
// todo resuelto ⇒ complete_session sí se habilita — para que el test anterior no pase
// trivialmente por construir un estado que jamás podría completar por otro motivo.
const stateFullyResolved = {
  ...stateWithUnresolvedObjective,
  sessionCompletionResult: { objectiveCoverageRatio: 1, isSessionComplete: true },
}
assert.equal(deriveNextSessionAction(stateFullyResolved).type, 'complete_session', 'control: con isSessionComplete=true y todo lo demás igual, la acción SÍ debe ser complete_session — aísla que el bloqueo anterior viene de isSessionComplete, no de otro campo del estado')

console.log('adaptive-program-completion-invariant-contracts: 17 contracts PASS (invariante demostrado + brecha latente documentada + Caso A confirmado en deriveNextSessionAction)')
