import assert from 'node:assert/strict'
import {
  beginRecoveryReteach,
  beginRecoveryVerification,
  createRecoveryQueue,
  persistRecoveryVerificationQuestions,
  presentRecoveryVerificationQuestion,
  recordRecoveryCheck,
  recordRecoveryReteachContent,
  recordVerificationGenerationAttempt,
  REQUIRED_INDEPENDENT_RECOVERY_CHECKS,
  type RecoveryFailure,
  type RecoveryItem,
} from '../../lib/adaptive/evaluation/recoveryQueue'
import { normalizeGeneratedQuestion, type CanonicalQuestion, type GenerationContext } from '../../lib/adaptive/evaluation/questionContract'

// AUDITORÍA ADVERSARIAL CODEX — Finding 1 (P0, CONFIRMED), mitad RECOVERY.
//
// page.tsx::recordRecoveryVerificationOutcome hardcodeaba el 4º argumento de
// recordRecoveryCheck como el literal "independent" — la ronda de
// verificación de recovery se resolvía como demostración independiente
// incluso si el estudiante vio la pista de la pregunta de verificación. El
// fix pasa ahora hintShownRef.current ? "minimal_hint" : "independent".
//
// Este archivo prueba, contra recordRecoveryCheck REAL (no una
// reimplementación), que la máquina de recovery YA distinguía correctamente
// assistanceLevel — el bug vivía enteramente en qué le pasaba page.tsx, no
// aquí. Confirma:
//  A. 1 check independiente-correcto + 1 check asistido-correcto (mismo
//     round, requiredIndependentChecks=2) NO resuelve la ronda — se agota sin
//     éxito y pasa a pending_reteach, aunque AMBOS checks fueran "correctos".
//  B. Una ronda posterior con 2 checks independientes-correctos SÍ resuelve.

assert.equal(REQUIRED_INDEPENDENT_RECOVERY_CHECKS, 2, 'esta prueba asume el valor real de producción; si cambia, revisar los conteos de abajo')

const context: GenerationContext = {
  activeConceptId: 'micro-hint', activeConceptLabel: 'Concepto', teachingBlockId: 'step-hint',
  targetDimension: 'comprehension', questionFamily: 'mcq_best_answer',
  allowedConceptIds: ['micro-hint'], forbiddenConceptIds: [],
}

// Contenido genuinamente distinto por pregunta — no un simple sufijo de id.
// recordRecoveryCheck aplica un guard real de duplicado SEMÁNTICO
// (questionSimilarity contra TODOS los checks/failures previos, incluso de
// rondas anteriores) — preguntas que solo difieren en el id serían marcadas
// repeatedQuestion=true y nunca contarían, invalidando la prueba sin que sea
// un bug (es el comportamiento correcto de anti-duplicados de recovery).
const TEXTS: Record<string, { q: string; correct: string; wrong: string }> = {
  'original-failure': { q: 'Identifica el proceso metabólico dominante en condiciones de reposo prolongado.', correct: 'Metabolismo basal predominante en reposo', wrong: 'Metabolismo anaeróbico predominante en reposo' },
  'round1-independent': { q: 'Clasifica el tipo de reacción química observada al mezclar un ácido fuerte con una base fuerte.', correct: 'Reacción de neutralización ácido-base', wrong: 'Reacción de combustión exotérmica' },
  'round1-hinted': { q: 'Determina qué principio explica el desplazamiento del equilibrio al aumentar la presión.', correct: 'Principio de Le Chatelier aplicado a presión', wrong: 'Ley de conservación de la masa aplicada a presión' },
  'round2-independent-1': { q: 'Explica por qué la velocidad de una reacción aumenta al elevar la temperatura del sistema.', correct: 'Mayor energía cinética de las partículas reactantes', wrong: 'Menor concentración de productos formados' },
  'round2-independent-2': { q: 'Justifica la elección de un catalizador adecuado para acelerar una reacción industrial específica.', correct: 'Reduce la energía de activación sin consumirse', wrong: 'Aumenta la energía de activación del sistema' },
}

function verificationQuestion(id: string): CanonicalQuestion {
  const t = TEXTS[id]
  const normalized = normalizeGeneratedQuestion({
    conceptId: 'micro-hint', conceptLabel: 'Concepto', variant: 'mcq_best_answer',
    targetDimension: 'comprehension', difficulty: 'medium',
    questionText: t.q,
    options: [{ id: 'yes', text: t.correct }, { id: 'no', text: t.wrong }],
    correctAnswer: 'yes', explanation: 'Explicación.', hint: 'Pista.', factKey: `fact:${id}`,
  }, context, id)
  assert(normalized)
  return normalized
}

function originalFailure(): RecoveryFailure {
  const q = verificationQuestion('original-failure')
  return { question: q, answer: 'no', result: { outcome: 'incorrect', correct: false, errorType: 'selection' } }
}

function checkAgainst(item: RecoveryItem, questionId: string, assistanceLevel: 'independent' | 'minimal_hint') {
  const roundId = `${item.recoveryId}:round:${item.verificationRound}`
  const q = verificationQuestion(questionId)
  const alreadyPersisted = item.verificationQuestions.some(entry => entry.roundId === roundId && entry.question.id === q.id && entry.answeredAt === null)
  let prepared = item
  if (!alreadyPersisted) {
    if (prepared.status === 'verification_active') prepared = { ...prepared, status: 'pending_verification' }
    prepared = persistRecoveryVerificationQuestions(prepared, [q], 1000 + prepared.verificationQuestions.length)
  }
  const presented = presentRecoveryVerificationQuestion(prepared, 2000 + prepared.verificationQuestions.length)
  assert(presented.question)
  return recordRecoveryCheck(presented.item, q, { outcome: 'correct', correct: true }, assistanceLevel, 'yes').item
}

// Auditoría adversarial (Codex, Reteach #3.1): recordRecoveryReteachContent
// ahora RECHAZA correctamente contenido duplicado entre rondas (antes lo
// dejaba pasar, permitiendo avanzar a verificación con la MISMA explicación
// — el bug real que motivó ese fix). Cada ronda real de producción genera
// una explicación distinta (nueva llamada al LLM); `explanation` aquí
// distingue las rondas de la misma forma, para no disparar por accidente el
// guard de duplicados en un test cuyo propósito es otro (independencia por
// assistanceLevel, no anti-repetición).
function beginRound(item: RecoveryItem, explanation: string): RecoveryItem {
  const reteaching = beginRecoveryReteach(item, 'contrastive_explanation')
  const explained = recordRecoveryReteachContent(reteaching, explanation)
  return recordVerificationGenerationAttempt(beginRecoveryVerification(explained), true)
}

// ═══ A: independiente + asistido (correcto ambos) NO resuelve la ronda ═══
let item = createRecoveryQueue([originalFailure()])[0]
item = beginRound(item, 'Reexplicación del concepto — ronda A.')
item = checkAgainst(item, 'round1-independent', 'independent')
assert.notEqual(item.status, 'resolved', 'tras 1 check independiente de 2 requeridos, la ronda no debe resolverse aún')
item = checkAgainst(item, 'round1-hinted', 'minimal_hint')
assert.notEqual(item.status, 'resolved', 'BUG DE CODEX SI FALLA: un check asistido-correcto NO puede completar la ronda como si fuera independiente')
assert.equal(item.status, 'pending_reteach', 'la ronda se agota (2/2 completados) sin alcanzar 2 ÉXITOS independientes -> pasa a pending_reteach, no a resolved')
assert.equal(item.successfulIndependentChecks, 1, 'solo el check independiente debe contar como éxito independiente — el asistido no suma')

// ═══ B: ronda posterior, 2 checks independientes-correctos SÍ resuelve ═══
item = beginRound(item, 'Reexplicación del concepto — ronda B, ángulo distinto.')
item = checkAgainst(item, 'round2-independent-1', 'independent')
assert.notEqual(item.status, 'resolved')
item = checkAgainst(item, 'round2-independent-2', 'independent')
assert.equal(item.status, 'resolved', 'una reevaluación posterior SIN ayuda, con 2 checks independientes-correctos, SÍ debe resolver la recovery')

console.log('hint-assistance-independence-contracts: PASS (A: asistido no resuelve independientemente, B: reevaluación sin ayuda sí resuelve)')
