import assert from 'node:assert/strict'
import {
  createRecoveryQueue,
  beginRecoveryReteach,
  recordRecoveryReteachContent,
  beginRecoveryVerification,
  persistRecoveryVerificationQuestions,
  presentRecoveryVerificationQuestion,
  recordRecoveryCheck,
  selectRecoveryStrategy,
  hasUntriedRecoveryStrategy,
  nextRecoveryItem,
  hasPendingRecovery,
  normalizeRestoredRecoveryItem,
  MAX_RECOVERY_TECHNICAL_SAFETY_ROUNDS,
  type RecoveryItem,
} from '../../lib/adaptive/evaluation/recoveryQueue'
import {
  deriveNextSessionAction,
  getPrimaryActionLabel,
  type SessionTransitionState,
} from '../../lib/adaptive/sessionFinalTransition'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

// Reproducción real de producción, Adaptive V3 — dos bugs concretos:
//
// BUG 1 (pedagogical recovery exhaustion): un límite FIJO de rondas
// conflaba "se agotó esta estrategia" con "abandona el micro" — un
// estudiante activamente participando veía "No se pudo resolver este
// punto..." tras solo 4 rondas, con 5+ estrategias pedagógicas
// genuinamente distintas nunca probadas. Corregido separando STRATEGY
// EXHAUSTION (abre un nuevo ciclo con otra estrategia) de MICRO
// ABANDONMENT (unresolved — solo cuando el catálogo REAL se agota).
//
// BUG 2 (CTA muerto): el botón "Continuar sesión →" en el estado
// unresolved llamaba advanceToNextTeachingStep(), que solo sabe avanzar
// currentStepIndex — si el micro se agota en el ÚLTIMO paso ("Paso 45 de
// 45", el caso real), la función no hacía NADA. Corregido: el botón ahora
// ejecuta el motor de transición completo (deriveNextSessionAction), que
// SIEMPRE deriva una acción real — incluida una nueva distinción entre
// pendingRecoveries (autoridad de completion, sin cambios) y
// actionableRecoveries (autoridad de routing, excluye 'unresolved').
//
// Genérico para cualquier materia/micro — nada aquí depende de química,
// sp², ni de ningún dominio académico específico.

function question(id: string, factKey = 'fact-1'): CanonicalQuestion {
  return {
    id, conceptId: 'micro-hibridacion', conceptLabel: 'Micro genérico', teachingBlockId: 'step_1',
    questionFamily: 'source', variant: 'mcq_best_answer', format: 'multiple_choice',
    difficulty: 'medium', targetDimension: 'comprehension', questionText: `Pregunta fuente ${id}`,
    options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctAnswer: 'a',
    explanation: 'Explicación', hint: 'Pista', estimatedSeconds: 20,
    evidencesNeeded: 1, factKey, factKeys: [factKey],
    targetObjectiveIds: ['objective-1'], coveredStepIds: ['step_1'], coveredKeyPoints: ['Punto'],
  } as CanonicalQuestion
}

// questionSimilarity compara solapamiento real de palabras/trigramas — dos
// enunciados que solo difieren en un id/etiqueta puntual puntúan como
// "repetidos" (>=0.92), correctamente. Cada slot usa una oración
// estructuralmente distinta (no solo un token distinto) para representar
// preguntas de verificación genuinamente diferentes, como en producción.
const DISTINCT_SENTENCES = [
  'Explica por qué el primer enfoque aplicado al micro no coincide con la evidencia enseñada',
  'Identifica cuál de las siguientes opciones representa correctamente la relación central del micro',
  'Compara el caso presentado con el ejemplo original y señala la diferencia clave',
  'Aplica el criterio enseñado a una situación nueva relacionada con el micro',
  'Describe la consecuencia directa de aplicar incorrectamente el concepto evaluado',
  'Determina si la afirmación dada es consistente con el mecanismo real explicado',
  'Clasifica el ejemplo mostrado según el criterio distintivo del micro',
  'Justifica por qué la alternativa seleccionada demuestra comprensión real del micro',
  'Reconoce el patrón subyacente en la situación descrita para este micro',
  'Evalúa si el razonamiento propuesto sigue correctamente la lógica enseñada',
  'Selecciona el ejemplo que mejor ilustra la excepción discutida en clase',
  'Contrasta la interpretación errónea habitual con la explicación correcta',
  'Predice el resultado esperado si se aplica correctamente el procedimiento',
  'Diferencia entre dos casos límite que suelen confundirse en este micro',
  'Resume en tus propias palabras la idea central que debes dominar aquí',
  'Detecta el error específico presente en el razonamiento mostrado',
  'Ordena los pasos necesarios para resolver correctamente este tipo de caso',
  'Vincula la causa mencionada con su efecto correspondiente en este micro',
  'Verifica si el ejemplo dado cumple todas las condiciones necesarias',
  'Deduce la conclusión correcta a partir de los datos presentados aquí',
]
let sentenceCursor = 0
function verificationQuestion(id: string, _roundLabel: string, factKey = 'fact-1'): CanonicalQuestion {
  const sentence = DISTINCT_SENTENCES[sentenceCursor % DISTINCT_SENTENCES.length]
  sentenceCursor += 1
  return {
    ...question(id, factKey),
    questionFamily: `verification-${id}`,
    questionText: sentence,
  }
}

function freshItem(): RecoveryItem {
  sentenceCursor = 0 // cada test empieza su propio item con el pool completo disponible
  return createRecoveryQueue([{
    question: question('source'), answer: 'b',
    result: { outcome: 'incorrect', correct: false, errorType: 'conceptual' },
  }])[0]
}

// Simula UNA ronda completa fallida (2 verificaciones, la segunda
// incorrecta) devolviendo el item en status='pending_reteach', listo para
// la siguiente ronda — igual que produce el flujo real.
function runFailedRound(item: RecoveryItem, round: number): RecoveryItem {
  const strategy = selectRecoveryStrategy(item)!
  let next = beginRecoveryReteach(item, strategy)
  next = recordRecoveryReteachContent(next, `Reexplicación real y distinta de la ronda ${round}, estrategia ${strategy}`)
  next = beginRecoveryVerification(next)
  next = persistRecoveryVerificationQuestions(next, [
    verificationQuestion(`r${round}-v1`, `${round}-a`),
    verificationQuestion(`r${round}-v2`, `${round}-b`),
  ])
  let presented = presentRecoveryVerificationQuestion(next)
  next = recordRecoveryCheck(presented.item, presented.question!, { outcome: 'correct', correct: true }).item
  presented = presentRecoveryVerificationQuestion(next)
  next = recordRecoveryCheck(presented.item, presented.question!, { outcome: 'incorrect', correct: false }, 'independent', 'b').item
  return next
}

// ═══ A. Estudiante falla un micro repetidamente ═══
function testA_RepeatedFailures() {
  let item = freshItem()
  item = runFailedRound(item, 1)
  assert.equal(item.status, 'pending_reteach')
  assert.equal(item.totalStudentFailureRounds, 1)
  item = runFailedRound(item, 2)
  assert.equal(item.totalStudentFailureRounds, 2, 'A: fallos repetidos deben acumularse, no reiniciarse')
}

// ═══ B. Agota UNA estrategia ═══
function testB_ExhaustsOneStrategy() {
  let item = freshItem()
  const firstStrategy = selectRecoveryStrategy(item)!
  item = runFailedRound(item, 1)
  assert.ok(item.strategyHistory.includes(firstStrategy), 'B: la estrategia usada en la ronda 1 debe quedar registrada como agotada')
}

// ═══ C. El micro sigue unresolved (abierto, no abandonado) tras agotar UNA estrategia ═══
function testC_StillOpenAfterOneStrategyFails() {
  let item = freshItem()
  item = runFailedRound(item, 1)
  assert.notEqual(item.status, 'unresolved', 'C: BUG DE ORIGEN SI FALLA: agotar UNA estrategia no debe abandonar el micro')
  assert.notEqual(item.status, 'resolved')
  assert.equal(hasPendingRecovery([item]), true, 'C: el micro sigue bloqueando completion — correcto, sigue abierto')
}

// ═══ D. StudyAL cambia de estrategia en vez de abandonar ═══
function testD_ChangesStrategyInsteadOfAbandoning() {
  let item = freshItem()
  const usedStrategies: string[] = []
  for (let round = 1; round <= 4; round++) {
    const strategy = selectRecoveryStrategy(item)!
    assert.ok(!usedStrategies.includes(strategy), `D: BUG DE ORIGEN SI FALLA: la ronda ${round} repite una estrategia ya usada (${strategy}) mientras quedan otras sin probar`)
    usedStrategies.push(strategy)
    item = runFailedRound(item, round)
    assert.equal(item.status, 'pending_reteach', `D: BUG DE ORIGEN SI FALLA: tras 4 fallos con 4 estrategias DISTINTAS, el micro real (9 estrategias con errorType='conceptual') no debe abandonarse todavía`)
  }
}

// ═══ E. Evidencia anterior se preserva a través de cambios de estrategia ═══
function testE_PriorEvidencePreserved() {
  let item = freshItem()
  item = runFailedRound(item, 1)
  const checksAfterRound1 = item.checks.length
  const failuresAfterRound1 = item.failures.length
  const historyAfterRound1 = item.failureHistory.length
  item = runFailedRound(item, 2)
  assert.ok(item.checks.length > checksAfterRound1, 'E: BUG DE ORIGEN SI FALLA: los checks de la ronda 1 no deben perderse ni quedar sin acumular en la ronda 2')
  assert.ok(item.failures.length > failuresAfterRound1, 'E: los fallos históricos deben preservarse')
  assert.ok(item.failureHistory.length > historyAfterRound1, 'E: el historial de evidencia debe preservarse')
  assert.equal(item.checks.slice(0, checksAfterRound1).length, checksAfterRound1, 'E: los checks de rondas previas no deben mutarse retroactivamente')
}

// ═══ F. Preguntas/factKeys no entran en loop (no se repiten como evidencia válida) ═══
function testF_NoQuestionOrFactKeyLoop() {
  let item = freshItem()
  const strategy = selectRecoveryStrategy(item)!
  item = beginRecoveryReteach(item, strategy)
  item = recordRecoveryReteachContent(item, 'Explicación real ronda 1')
  item = beginRecoveryVerification(item)
  const dupeId = 'source' // mismo id que la pregunta fuente original — debe detectarse como repetida
  item = persistRecoveryVerificationQuestions(item, [
    { ...verificationQuestion(dupeId, '1-a') },
    verificationQuestion('r1-v2', '1-b'),
  ])
  const presented = presentRecoveryVerificationQuestion(item)
  const afterCheck = recordRecoveryCheck(presented.item, presented.question!, { outcome: 'correct', correct: true }).item
  const check = afterCheck.checks.at(-1)!
  assert.equal(check.repeatedQuestion, true, 'F: BUG DE ORIGEN SI FALLA: reutilizar el id de la pregunta fuente original debe detectarse como repetida')
  assert.equal(check.counted, false, 'F: una pregunta repetida nunca debe contar como evidencia válida — evita el loop de "evidencia" ficticia')
}

// ═══ G. Tras evidencia independiente suficiente → mastered (resolved) ═══
function testG_ResolvesAfterSufficientIndependentEvidence() {
  let item = freshItem()
  item = runFailedRound(item, 1) // ronda 1 fallida — no debe impedir resolver después
  const strategy = selectRecoveryStrategy(item)!
  item = beginRecoveryReteach(item, strategy)
  item = recordRecoveryReteachContent(item, 'Explicación real ronda 2, ángulo distinto')
  item = beginRecoveryVerification(item)
  item = persistRecoveryVerificationQuestions(item, [
    verificationQuestion('r2-v1', '2-a'),
    verificationQuestion('r2-v2', '2-b'),
  ])
  let presented = presentRecoveryVerificationQuestion(item)
  item = recordRecoveryCheck(presented.item, presented.question!, { outcome: 'correct', correct: true }, 'independent').item
  assert.notEqual(item.status, 'resolved', 'G: 1 de 2 checks independientes no debe resolver todavía')
  presented = presentRecoveryVerificationQuestion(item)
  item = recordRecoveryCheck(presented.item, presented.question!, { outcome: 'correct', correct: true }, 'independent').item
  assert.equal(item.status, 'resolved', 'G: BUG DE ORIGEN SI FALLA: 2 checks independientes correctos en la misma ronda deben resolver el micro, incluso tras un fallo previo')
  assert.equal(hasPendingRecovery([item]), false, 'G: un item resuelto no debe seguir bloqueando completion')
}

// ═══ H. Solo entonces (resolved) puede completarse la sesión ═══
function testH_SessionCanOnlyCompleteWhenResolved() {
  const baseState: SessionTransitionState = {
    currentStepIndex: 0, currentEvaluationBlock: { id: 'b1', completed: true }, currentQuestionIndex: 0,
    unansweredNormalQuestions: 0, pendingRecoveries: 0, actionableRecoveries: 0, latentRecoveries: 0,
    activeRecovery: false, completedEvaluationBlocks: 1, totalEvaluationBlocks: 1, totalTeachingSteps: 1,
    sessionKind: 'learning', sessionCompletionResult: { isSessionComplete: true, objectiveCoverageRatio: 1 },
  }
  assert.deepEqual(deriveNextSessionAction(baseState), { type: 'complete_session' }, 'H: con todo resuelto (pendingRecoveries=0), la sesión SÍ debe poder completarse')
  assert.deepEqual(
    deriveNextSessionAction({ ...baseState, pendingRecoveries: 1, actionableRecoveries: 1 }),
    { type: 'show_next_recovery' },
    'H: BUG DE ORIGEN SI FALLA: con un micro aún pendiente (no resuelto), la sesión NUNCA debe derivar complete_session',
  )
}

// ═══ I. Último paso de contenido + micro unresolved != session complete ═══
function testI_LastContentStepWithUnresolvedMicroNeverCompletesSession() {
  // "Paso 45 de 45" — último paso de CONTENIDO, pero con un micro
  // 'unresolved' (catálogo agotado) todavía en la cola.
  const state: SessionTransitionState = {
    currentStepIndex: 44, currentEvaluationBlock: { id: 'final', completed: true }, currentQuestionIndex: 0,
    unansweredNormalQuestions: 0,
    pendingRecoveries: 1, // el micro unresolved sigue contando para completion
    actionableRecoveries: 0, // pero no hay nada a lo que enrutar (está 'unresolved', no abierto)
    latentRecoveries: 0, activeRecovery: false,
    completedEvaluationBlocks: 1, totalEvaluationBlocks: 1, totalTeachingSteps: 45,
    sessionKind: 'learning', sessionCompletionResult: { isSessionComplete: true, objectiveCoverageRatio: 1 },
  }
  const action = deriveNextSessionAction(state)
  assert.notEqual(action.type, 'complete_session', 'I: BUG DE ORIGEN SI FALLA: llegar al último paso de contenido con un micro unresolved NUNCA debe declararse "complete_session" — content traversal != mastery')
  assert.deepEqual(action, { type: 'blocked', reason: 'unresolved_recovery_gap' }, 'I: debe derivar un estado bloqueado honesto, no una falsa completion')
}

// ═══ J. La UI de recovery nunca queda con un CTA muerto ═══
function testJ_RecoveryUINeverDeadEnd() {
  // Exactamente el estado del bug real: último paso, único pendiente es el
  // micro 'unresolved' — antes, esto llevaba a un handler (show_next_recovery
  // -> nextRecoveryItem que excluye 'unresolved') que no hacía NADA.
  const state: SessionTransitionState = {
    currentStepIndex: 44, currentEvaluationBlock: null, currentQuestionIndex: 0,
    unansweredNormalQuestions: 0, pendingRecoveries: 1, actionableRecoveries: 0, latentRecoveries: 0,
    activeRecovery: false, completedEvaluationBlocks: 1, totalEvaluationBlocks: 1, totalTeachingSteps: 45,
    sessionKind: 'learning', sessionCompletionResult: { isSessionComplete: true, objectiveCoverageRatio: 1 },
  }
  const action = deriveNextSessionAction(state)
  // BUG DE ORIGEN SI FALLA: la acción derivada debe ser SIEMPRE una de las
  // variantes conocidas con una etiqueta real — nunca "show_next_recovery"
  // cuando actionableRecoveries=0 (ese handler real no encuentra nada que
  // enrutar y no hace nada — CTA muerto).
  assert.notEqual(action.type, 'show_next_recovery', 'J: BUG DE ORIGEN SI FALLA: no debe derivarse show_next_recovery cuando no hay nada accionable — el handler real no haría nada')
  const label = getPrimaryActionLabel(action)
  assert.ok(typeof label === 'string' && label.length > 0, 'J: SIEMPRE debe existir una etiqueta de acción real y no vacía — nunca un botón sin comportamiento definido')
  assert.notEqual(label, 'Continuar →', 'J: el mensaje debe ser específico al hueco de recuperación no resuelta, no un genérico ambiguo')
}

// ═══ K. Reload/restore durante recovery conserva correctamente el estado ═══
function testK_RestorePreservesUnresolvedState() {
  let item = freshItem()
  // Agotar el catálogo completo para llegar a un 'unresolved' genuino.
  while (hasUntriedRecoveryStrategy(item)) {
    item = runFailedRound(item, item.reteachAttempt + 1)
  }
  const exhausted = beginRecoveryReteach(item, 'strategy-final')
  assert.equal(exhausted.status, 'unresolved')
  const strategyHistoryBeforeRestore = [...exhausted.strategyHistory]

  const restored = normalizeRestoredRecoveryItem(exhausted)
  assert.equal(restored.status, 'unresolved', 'K: BUG DE ORIGEN SI FALLA: restaurar la sesión no debe reabrir un micro genuinamente agotado a pending_reteach — desperdiciaría una llamada y produciría un parpadeo de estado inconsistente')
  assert.deepEqual(restored.strategyHistory, strategyHistoryBeforeRestore, 'K: el historial de estrategias probadas debe preservarse exactamente tras el restore')
  assert.equal(restored.reteachAttempt, exhausted.reteachAttempt, 'K: el contador de intentos debe preservarse')
  assert.equal(hasUntriedRecoveryStrategy(restored), false, 'K: tras restore, sigue sin haber estrategias sin probar — coherente con el status preservado')

  // Un item NO agotado (pending_reteach normal) debe seguir restaurándose
  // con su historial y evidencia intactos — no solo el caso unresolved.
  let openItem = freshItem()
  openItem = runFailedRound(openItem, 1)
  const openRestored = normalizeRestoredRecoveryItem(openItem)
  assert.equal(openRestored.status, 'pending_reteach')
  assert.deepEqual(openRestored.strategyHistory, openItem.strategyHistory, 'K: un item abierto (no agotado) también debe preservar su strategyHistory tras restore')
  assert.equal(openRestored.checks.length, openItem.checks.length, 'K: la evidencia (checks) debe preservarse tras restore')
}

// ═══ L. Múltiples strategy changes siguen siendo bounded individualmente ═══
function testL_MultipleStrategyChangesRemainBounded() {
  let item = freshItem()
  let rounds = 0
  while (hasUntriedRecoveryStrategy(item)) {
    rounds += 1
    assert.ok(rounds <= MAX_RECOVERY_TECHNICAL_SAFETY_ROUNDS, 'L: BUG DE ORIGEN SI FALLA: el número de rondas antes de agotar el catálogo debe quedar por debajo del techo técnico de seguridad — nunca crecer sin límite')
    item = runFailedRound(item, rounds)
  }
  const exhausted = beginRecoveryReteach(item, 'strategy-after-catalog')
  assert.equal(exhausted.status, 'unresolved', 'L: tras agotar genuinamente el catálogo, debe marcarse unresolved — bounded, no infinito')
  assert.equal(exhausted.reason, 'recovery_strategies_exhausted')
  assert.ok(rounds < MAX_RECOVERY_TECHNICAL_SAFETY_ROUNDS, 'L: el catálogo real (errorType=conceptual, 9 estrategias) debe agotarse MUY por debajo del techo técnico — confirma que el bounding es por catálogo, no por el techo de seguridad')

  // Un NUEVO fallo tras esto (fuera de este test) no debe poder reabrir
  // rondas infinitas — beginRecoveryReteach en un item ya 'unresolved'
  // sigue evaluando hasUntriedRecoveryStrategy, que sigue siendo false.
  const secondAttempt = beginRecoveryReteach(exhausted, 'strategy-retry')
  assert.equal(secondAttempt.status, 'unresolved', 'L: reintentar sobre un item ya agotado debe mantenerse unresolved de forma estable, nunca reabrir un ciclo')
  assert.equal(secondAttempt.reteachAttempt, exhausted.reteachAttempt, 'L: un intento sobre un item agotado no debe incrementar el contador de rondas — no hay ronda nueva que abrir')
}

// ═══ Regresión: nextRecoveryItem sigue excluyendo 'unresolved' del routing,
// isOpen()/hasPendingRecovery() siguen contándolo para completion ═══
function testRegression_RoutingVsCompletionAuthorityStillSeparate() {
  let item = freshItem()
  while (hasUntriedRecoveryStrategy(item)) item = runFailedRound(item, item.reteachAttempt + 1)
  const exhausted = beginRecoveryReteach(item, 'final')
  assert.equal(nextRecoveryItem([exhausted]), null, 'nextRecoveryItem no debe reofrecer un item unresolved')
  assert.equal(hasPendingRecovery([exhausted]), true, 'hasPendingRecovery debe seguir bloqueando completion para un item unresolved')
}

async function run() {
  testA_RepeatedFailures()
  testB_ExhaustsOneStrategy()
  testC_StillOpenAfterOneStrategyFails()
  testD_ChangesStrategyInsteadOfAbandoning()
  testE_PriorEvidencePreserved()
  testF_NoQuestionOrFactKeyLoop()
  testG_ResolvesAfterSufficientIndependentEvidence()
  testH_SessionCanOnlyCompleteWhenResolved()
  testI_LastContentStepWithUnresolvedMicroNeverCompletesSession()
  testJ_RecoveryUINeverDeadEnd()
  testK_RestorePreservesUnresolvedState()
  testL_MultipleStrategyChangesRemainBounded()
  testRegression_RoutingVsCompletionAuthorityStillSeparate()
  console.log('recovery-strategy-exhaustion-vs-abandonment-contracts: PASS (A-L: fallos repetidos, estrategia agotada != micro abandonado, cambio real de estrategia, evidencia preservada, sin loop de pregunta/factKey, resolución tras evidencia independiente suficiente, completion solo tras resolved, último paso != session complete, CTA nunca muerto, restore preserva unresolved, bounded por catálogo no por contador arbitrario)')
}

run()
