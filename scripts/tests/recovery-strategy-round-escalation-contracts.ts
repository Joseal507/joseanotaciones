import assert from 'node:assert/strict'
import { detectErrorType } from '../../lib/adaptive/evaluation/pedagogicalFormatSelector'
import { buildReteachStrategyInstructions } from '../../lib/adaptive/evaluation/recoveryStrategyEngine'

// P3 — AUDITORÍA DE CALIDAD PEDAGÓGICA — Recovery strategy quality
//
// Hallazgo real (lectura de código, sin necesidad de LLM): session-reteach
// llama a detectErrorType con consecutiveFailures=Math.max(0, verificationRound-1),
// y buildReteachStrategyInstructions selecciona su estrategia (approach, tono,
// mustInclude/mustAvoid) únicamente a partir de errorType+contentSignal. Con el
// umbral anterior (consecutiveFailures>=2 para escalar a memory/false_confidence),
// la ronda 1 (consecutiveFailures=0) y la ronda 2 (consecutiveFailures=1) del
// MISMO recovery item —contentSignal y cognitiveLevel sin cambiar— producían el
// mismo errorType y por tanto EXACTAMENTE la misma instrucción de estrategia
// (mismo approach/tono/mustInclude/mustAvoid), arriesgando que la segunda
// reexplicación sea solo una paráfrasis de la primera. Fix: el umbral baja a
// consecutiveFailures>=1, así la ronda 2 ya usa una estrategia distinta.

const contentSignal = 'formula' as const
const cognitiveLevel = 'comprehension' as const
const questionFormat = 'multiple_choice'

const round1ErrorType = detectErrorType({ questionFormat, contentSignal, cognitiveLevel, consecutiveFailures: 0 })
const round2ErrorType = detectErrorType({ questionFormat, contentSignal, cognitiveLevel, consecutiveFailures: 1 })
assert.notEqual(round1ErrorType, round2ErrorType, 'ronda 1 (0 fallos previos) y ronda 2 (1 fallo previo) del mismo target deben producir errorType distinto — antes ambas caían en la misma rama basada en contentSignal')
assert.equal(round1ErrorType, 'procedure', 'ronda 1 sigue el mapeo original por contentSignal (regresión: no debe cambiar el comportamiento de la primera ronda)')
assert.equal(round2ErrorType, 'false_confidence', 'ronda 2 escala a false_confidence (cognitiveLevel!=recognition) en el segundo fallo consecutivo, no solo en el tercero')

const round1Instructions = buildReteachStrategyInstructions({
  errorType: round1ErrorType, contentSignal, studentAnswerSummary: 'respuesta 1', correctAnswerSummary: 'correcta', consecutiveFailures: 0,
})
const round2Instructions = buildReteachStrategyInstructions({
  errorType: round2ErrorType, contentSignal, studentAnswerSummary: 'respuesta 2', correctAnswerSummary: 'correcta', consecutiveFailures: 1,
})
const strategyLine = (text: string) => text.split('\n').find(line => line.startsWith('ESTRATEGIA PRIMARIA:')) || ''
assert.notEqual(
  strategyLine(round1Instructions), strategyLine(round2Instructions),
  'la estrategia primaria enviada al prompt de reexplicación debe diferir entre ronda 1 y ronda 2 del mismo recovery item',
)

// Un tercer fallo consecutivo (recognition esta vez) sigue escalando de forma estable.
const round3ErrorTypeRecognition = detectErrorType({ questionFormat, contentSignal, cognitiveLevel: 'recognition', consecutiveFailures: 2 })
assert.equal(round3ErrorTypeRecognition, 'memory', 'fallos repetidos en recognition deben mapear a memory, no a false_confidence')

console.log('recovery-strategy-round-escalation-contracts: 4 contracts PASS')
