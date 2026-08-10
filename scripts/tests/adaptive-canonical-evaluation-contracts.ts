import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  beginRecoveryReteach,
  beginRecoveryVerification,
  createRecoveryQueue,
  persistRecoveryVerificationQuestions,
  presentRecoveryVerificationQuestion,
  recordRecoveryCheck,
  recordRecoveryReteachContent,
  selectRecoveryStrategy,
  hasUntriedRecoveryStrategy,
  REQUIRED_INDEPENDENT_RECOVERY_CHECKS,
} from '../../lib/adaptive/evaluation/recoveryQueue'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

const question = (id: string, family: string): CanonicalQuestion => ({
  id, conceptId: 'micro-1', conceptLabel: 'Objetivo exacto', teachingBlockId: 'step_1',
  questionFamily: family, variant: 'mcq_best_answer', format: 'multiple_choice',
  difficulty: 'medium', targetDimension: 'comprehension', questionText: family.endsWith('-a')
    ? `Selecciona la consecuencia que demuestra el objetivo ${id}`
    : family.endsWith('-b')
      ? `Distingue el contraejemplo incompatible con el objetivo ${id}`
      : `Pregunta fuente ${id}`,
  options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctAnswer: 'a',
  explanation: 'Explicación específica', hint: 'Pista', estimatedSeconds: 20,
  evidencesNeeded: 1, factKey: 'fact-1', factKeys: ['fact-1'],
  targetObjectiveIds: ['objective-1'],
  coveredStepIds: ['step_1'], coveredKeyPoints: ['Punto exacto'],
} as CanonicalQuestion)

assert.equal(REQUIRED_INDEPENDENT_RECOVERY_CHECKS, 2)

let item = createRecoveryQueue([{
  question: question('source', 'source-family'), answer: 'b',
  result: { outcome: 'incorrect', correct: false, errorType: 'conceptual' },
}])[0]

// Auditoría de producto (reproducción real, BUG 1 CONFIRMADO): un límite
// FIJO de rondas (el fix anterior de esta misma misión, MAX_RECOVERY_ROUNDS
// =4) conflaba "se agotó ESTA estrategia" con "hay que abandonar el
// micro" — un estudiante activamente participando veía su micro declarado
// unresolved tras solo 4 intentos, con 5+ estrategias pedagógicas
// genuinamente distintas nunca probadas. Este bucle ahora corre hasta que
// hasUntriedRecoveryStrategy() sea genuinamente false (catálogo agotado,
// acotado por su tamaño FIJO — nunca un contador arbitrario), usando
// selectRecoveryStrategy() REAL en cada ronda, igual que el caller real
// (page.tsx). errorType='conceptual' produce un catálogo de 9 estrategias
// distintas (candidateStrategiesFor) antes de agotarse genuinamente.
let round = 0
let previousStrategy: string | null = null
while (hasUntriedRecoveryStrategy(item)) {
  round += 1
  assert.ok(round <= 20, 'BUG DE ORIGEN SI FALLA: el catálogo de estrategias debe ser finito y pequeño — si esto no converge, algo está mal en candidateStrategiesFor')
  const strategy = selectRecoveryStrategy(item)!
  assert.notEqual(strategy, previousStrategy, `BUG DE ORIGEN SI FALLA: la ronda ${round} no debe repetir la estrategia inmediatamente anterior mientras queden estrategias sin probar`)
  previousStrategy = strategy
  item = beginRecoveryReteach(item, strategy)
  assert.equal(item.status, 'reteaching', `BUG DE ORIGEN SI FALLA: con una estrategia genuinamente sin probar disponible, la ronda ${round} debe abrir un nuevo ciclo, nunca declarar unresolved prematuramente`)
  item = recordRecoveryReteachContent(item, `Reexplicación específica nueva ${round} — estrategia ${strategy}`)
  item = beginRecoveryVerification(item)
  item = persistRecoveryVerificationQuestions(item, [
    question(`round-${round}-v1`, `deterministic_recovery_${round}-a`),
    question(`round-${round}-v2`, `deterministic_recovery_${round}-b`),
  ])
  let presented = presentRecoveryVerificationQuestion(item)
  assert.ok(presented.question)
  item = recordRecoveryCheck(presented.item, presented.question!, { outcome: 'correct', correct: true }).item
  assert.notEqual(item.status, 'resolved', 'V1 correcta nunca resuelve la ronda')
  presented = presentRecoveryVerificationQuestion(item)
  assert.ok(presented.question)
  item = recordRecoveryCheck(presented.item, presented.question!, { outcome: 'incorrect', correct: false }, 'independent', 'b').item
  assert.equal(item.status, 'pending_reteach', 'V2 incorrecta reinicia toda la ronda')
  assert.equal(item.successfulIndependentChecks, 1, 'el crédito parcial queda histórico, no resuelve')
}
assert.equal(item.totalStudentFailureRounds, round)
assert.equal(item.status, 'pending_reteach')
assert.ok(round >= 9, `BUG DE ORIGEN SI FALLA: con errorType='conceptual' deben existir al menos 9 estrategias distintas antes de agotarse genuinamente — se agotó en la ronda ${round}`)

// BUG DE ORIGEN SI FALLA: SOLO tras agotar genuinamente el catálogo de
// estrategias, un intento adicional de reteach debe marcar 'unresolved' —
// nunca abrir una ronda más allá de eso, y nunca antes.
const exhausted = beginRecoveryReteach(item, `strategy-${round + 1}`)
assert.equal(exhausted.status, 'unresolved', 'BUG DE ORIGEN SI FALLA: agotado el catálogo de estrategias, debe marcar unresolved en vez de abrir otra ronda')
assert.equal(exhausted.reason, 'recovery_strategies_exhausted')
// El guard downstream (beginRecoveryVerification) NUNCA debe deshacer este
// límite auto-reparándose a pending_reteach — mismo patrón de fragilidad
// que el guard de duplicados (Reteach 3.1).
assert.equal(beginRecoveryVerification(exhausted).status, 'pending_reteach', 'beginRecoveryVerification debe rechazar un item que no está en reteaching (incluye unresolved)')

const teach = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
assert.doesNotMatch(teach, /NO incluyas evaluationBlocks ni preguntas/)
assert.match(teach, /const evaluationBlocks = session\.kind === 'learning'\s*\? preparedSession\.session\.evaluationBlocks/)
assert.doesNotMatch(teach.slice(teach.indexOf('export async function POST')), /nextAction:\s*["']skip_recovery["']/)
const reteach = readFileSync('app/api/adaptive/session-reteach/route.ts', 'utf8')
assert.doesNotMatch(reteach, /nextAction:\s*["']skip_recovery["']/)
assert.match(reteach, /exactamente dos|EXACTAMENTE 2/i)

console.log('adaptive-canonical-evaluation-contracts: PASS')
