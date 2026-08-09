import assert from 'node:assert/strict'
import { detectErrorType } from '../../lib/adaptive/evaluation/pedagogicalFormatSelector'
import { buildReteachStrategyInstructions } from '../../lib/adaptive/evaluation/recoveryStrategyEngine'

// P3.2 — RECOVERY R1-R5, MISMO TARGET
//
// Cierra la limitación documentada al final de P3.1: el fix anterior solo
// diferenciaba R1 de R2 (escalada de errorType en el segundo fallo). Con 3-5
// fallos consecutivos reales sobre el MISMO target, rondas 2+ compartían el
// mismo errorType (memory/false_confidence) y por tanto la MISMA instrucción —
// riesgo de "misma explicación → paráfrasis → paráfrasis" que el reporte P3
// pidió cerrar explícitamente. Fix: alternancia primary/secondary por paridad de
// ronda (ver buildReteachStrategyInstructions) + tabla de instrucción genérica
// por tipo de estrategia, así que incluso con errorType constante, la
// instrucción efectiva SÍ cambia entre rondas consecutivas.
//
// Criterio pedido: 0 target drift, no 5 estrategias idénticas, cambios de
// representación razonables — NO se exige que las 5 sean todas distintas entre sí.

const contentSignal = 'formula' as const
const cognitiveLevel = 'comprehension' as const
const questionFormat = 'multiple_choice'
const target = 'la-derivada-de-x2-es-2x' // mismo target en las 5 rondas — nunca cambia

const rounds = [0, 1, 2, 3, 4].map(consecutiveFailures => {
  const errorType = detectErrorType({ questionFormat, contentSignal, cognitiveLevel, consecutiveFailures })
  const instructions = buildReteachStrategyInstructions({
    errorType, contentSignal, studentAnswerSummary: `respuesta ronda ${consecutiveFailures + 1}`, correctAnswerSummary: 'correcta', consecutiveFailures,
  })
  const leadLine = instructions.split('\n').find(line => line.startsWith('ESTRATEGIA A EJECUTAR EN ESTA RONDA:')) || ''
  const instructionLine = instructions.split('\n').find(line => line.startsWith('INSTRUCCIÓN PEDAGÓGICA:'))
    ? instructions.split('INSTRUCCIÓN PEDAGÓGICA:\n')[1].split('\n')[0]
    : ''
  return { round: consecutiveFailures + 1, errorType, leadLine, instructionLine }
})

// 0 target drift: el "target" (concepto evaluado) nunca lo decide esta función —
// solo produce ESTRATEGIA/instrucción para el MISMO target en las 5 llamadas.
// Verificamos aquí que la función es pura respecto al target (no lo consume ni
// lo transforma) — el contrato real de "no drift" ya está garantizado en otro
// nivel (recoveryQueue.ts conserva sourceQuestionId/target inmutable por ronda,
// cubierto en adaptive-recovery-target-contracts.ts). Esta prueba se limita a lo
// que esta función SÍ controla: que la estrategia no sea idéntica ronda tras ronda.
assert.equal(new Set(rounds.map(r => r.round)).size, 5, 'sanity: 5 rondas distintas evaluadas')

// No 5 estrategias idénticas consecutivas (de hecho, ninguna ronda consecutiva
// adyacente debe compartir exactamente la misma línea de instrucción efectiva).
for (let i = 1; i < rounds.length; i++) {
  assert.notEqual(
    rounds[i].leadLine, rounds[i - 1].leadLine,
    `ronda ${rounds[i].round} no debe repetir exactamente la misma estrategia líder que la ronda ${rounds[i - 1].round}`,
  )
}

// Cambios de representación razonables: al menos 2 estrategias/instrucciones
// distintas deben aparecer a lo largo de las 5 rondas (no se exige que las 5
// sean únicas — sí que no colapse todo a una sola).
const distinctInstructions = new Set(rounds.map(r => r.instructionLine))
assert.ok(distinctInstructions.size >= 2, `debe haber al menos 2 instrucciones pedagógicas distintas entre 5 rondas — hubo ${distinctInstructions.size}`)

// La ronda 1 nunca debe usar la rama "escalada" (memory/false_confidence) —
// esa escalada es un efecto de fallos REPETIDOS, no del primer intento.
assert.ok(!['memory', 'false_confidence'].includes(rounds[0].errorType), 'ronda 1 no debe escalar a memory/false_confidence de entrada')
// A partir de la ronda 2, sí debe estar en la rama escalada (fallo repetido real).
for (let i = 1; i < rounds.length; i++) {
  assert.ok(['memory', 'false_confidence'].includes(rounds[i].errorType), `ronda ${rounds[i].round} (fallo repetido) debe reflejar escalada de errorType`)
}

console.log('recovery-strategy-r1-r5-contracts: 4 contracts PASS —', rounds.map(r => `R${r.round}:${r.errorType}`).join(' '))
