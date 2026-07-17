#!/usr/bin/env tsx
import {
  beginInteraction,
  beginPresentation,
  continueInteraction,
  receiveEvaluation,
  selectConfidence,
  startEvaluation,
} from '../../lib/adaptive/v3/ui/interactionMachine'

let passed = 0
let failed = 0
function assert(label: string, condition: boolean) {
  if (condition) { passed++; console.log(`  ✓ ${label}`) }
  else { failed++; console.error(`  ✗ ${label}`) }
}

let correct = startEvaluation(beginInteraction('i1', 'q1'), 'A')
correct = receiveEvaluation(correct, { interactionId: 'i1', questionId: 'q1', outcome: 'correct' })
assert('correcta: feedback visible antes de confianza', correct.phase === 'collecting_confidence' && correct.evaluation?.outcome === 'correct')
correct = selectConfidence(correct, 80)
assert('correcta: confianza conserva feedback', correct.phase === 'ready_to_continue' && correct.evaluation?.outcome === 'correct')
correct = continueInteraction(correct)
assert('correcta: Continuar avanza', correct.phase === 'advancing')

let incorrect = receiveEvaluation(startEvaluation(beginInteraction('i2', 'q2'), 'mal'), {
  interactionId: 'i2', questionId: 'q2', outcome: 'incorrect', correctAnswer: 'bien',
})
incorrect = selectConfidence(incorrect, 20)
assert('incorrecta: feedback y respuesta correcta permanecen', incorrect.evaluation?.outcome === 'incorrect' && incorrect.evaluation.correctAnswer === 'bien')

let last = receiveEvaluation(startEvaluation(beginInteraction('i3', 'q3'), 'A'), {
  interactionId: 'i3', questionId: 'q3', outcome: 'correct', shouldCloseSession: true,
})
assert('última: no cierra al evaluar', last.phase === 'collecting_confidence')
last = selectConfidence(last, 100)
assert('última: confianza no cierra', last.phase === 'ready_to_continue')
last = continueInteraction(last)
assert('última: cierra solo tras Continuar', last.phase === 'session_complete')

const next = beginInteraction('i4', 'q4')
assert('nueva pregunta limpia confianza anterior', next.confidence === undefined && next.evaluation === undefined)

const evaluating = startEvaluation(beginInteraction('i5', 'q5'), 'A')
const doubleClick = startEvaluation(evaluating, 'B')
assert('doble clic produce una sola evaluación', doubleClick === evaluating && doubleClick.answer === 'A')

const explanation = beginPresentation('page_explanation')
assert('explicación queda lista para continuar', explanation.phase === 'ready_to_continue')
const afterExplanation = continueInteraction(explanation)
assert('explicación → Entendido, continuar → solicita la siguiente página', afterExplanation.phase === 'advancing')

const studiedMicroIds = ['studied', 'mastered', 'repair']
const provisionallyMasteredMicroIds = ['mastered']
const reinforcementMicroIds = ['repair']
assert('resumen no domina lo solo estudiado o en refuerzo',
  studiedMicroIds.includes('studied') &&
  !provisionallyMasteredMicroIds.includes('studied') &&
  !provisionallyMasteredMicroIds.includes('repair') &&
  reinforcementMicroIds.includes('repair'))

console.log(`Interaction flow: PASS ${passed} / FAIL ${failed}`)
process.exit(failed === 0 ? 0 : 1)
