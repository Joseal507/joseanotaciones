import assert from 'node:assert/strict'
import { computeGenerationHistorySignals } from '../../lib/adaptive/evaluation/generationHistorySignals'

// P3.2 — SEÑALES REALES DE HISTORIAL (no inventadas)
//
// Extrae recentFormats/recentVariants/recentFactKeys/priorCognitiveLevelByFactKey
// de sessionContent YA persistido (sesiones anteriores del mismo journey) — función
// pura, sin IA, sin heurística inventada. Ver wiring real en
// app/materias/[temaId]/sesion/[sessionNumber]/page.tsx (requestBody.generationHistory)
// y en app/api/adaptive/session-teach/route.ts (prompt de generateEvaluationBlock).

const sessionContent = {
  '1': {
    evaluationBlocks: [{
      questions: [
        { format: 'true_false', variant: 'true_false_factual', targetFactKeys: ['fact-a'], targetDimension: 'recognition' },
        { format: 'multiple_choice', variant: 'mcq_best_answer', targetFactKeys: ['fact-b'], targetDimension: 'comprehension' },
      ],
    }],
  },
  '2': {
    evaluationBlocks: [{
      questions: [
        { format: 'matching', variant: 'matching_concept_def', targetFactKeys: ['fact-c'], targetDimension: 'comprehension' },
      ],
    }],
  },
  // sesión 3 es la que se está generando ahora — debe excluirse de su propio historial.
  '3': {
    evaluationBlocks: [{ questions: [{ format: 'scenario', variant: 'scenario_predict', targetFactKeys: ['fact-d'], targetDimension: 'application' }] }],
  },
}

const result = computeGenerationHistorySignals(sessionContent, { excludeSessionNumber: 3 })

assert.deepEqual(result.recentFormats, ['matching', 'true_false', 'multiple_choice'], 'debe listar formatos de sesiones anteriores, más reciente primero, excluyendo la sesión actual')
assert.deepEqual(result.recentVariants, ['matching_concept_def', 'true_false_factual', 'mcq_best_answer'])
assert.ok(!result.recentFormats.includes('scenario'), 'la sesión 3 (actual, excluida) no debe aparecer en el historial')
assert.deepEqual(result.priorCognitiveLevelByFactKey, { 'fact-a': 'recognition', 'fact-b': 'comprehension', 'fact-c': 'comprehension' })
assert.ok(!('fact-d' in result.priorCognitiveLevelByFactKey), 'factKeys de la sesión excluida no deben aparecer')

// Escalada: si el mismo factKey aparece dos veces con niveles distintos, se
// conserva el MÁS ALTO (nunca degradar el nivel ya demostrado).
const escalating = {
  '1': { evaluationBlocks: [{ questions: [{ format: 'true_false', variant: 'true_false_factual', targetFactKeys: ['fact-x'], targetDimension: 'recognition' }] }] },
  '2': { evaluationBlocks: [{ questions: [{ format: 'scenario', variant: 'scenario_apply_rule', targetFactKeys: ['fact-x'], targetDimension: 'application' }] }] },
}
const escalatingResult = computeGenerationHistorySignals(escalating)
assert.equal(escalatingResult.priorCognitiveLevelByFactKey['fact-x'], 'application', 'debe conservar el nivel cognitivo MÁS ALTO demostrado para un factKey, no el más reciente ni el más bajo')

// Sin historial (primera sesión del journey, o sessionContent vacío) → señales vacías, sin error.
assert.deepEqual(computeGenerationHistorySignals(null), { recentFormats: [], recentVariants: [], recentFactKeys: [], recentCognitiveTargets: [], priorCognitiveLevelByFactKey: {} })
assert.deepEqual(computeGenerationHistorySignals({}), { recentFormats: [], recentVariants: [], recentFactKeys: [], recentCognitiveTargets: [], priorCognitiveLevelByFactKey: {} })

// recentLimit respeta el límite (no acumula todo el journey indefinidamente).
const manySessions: Record<string, unknown> = {}
for (let i = 1; i <= 20; i++) {
  manySessions[String(i)] = { evaluationBlocks: [{ questions: [{ format: `format-${i}`, variant: `variant-${i}`, targetFactKeys: [`fact-${i}`], targetDimension: 'comprehension' }] }] }
}
const limited = computeGenerationHistorySignals(manySessions, { recentLimit: 5 })
assert.equal(limited.recentFormats.length, 5, 'recentLimit debe acotar la ventana de recencia')
assert.equal(limited.recentFormats[0], 'format-20', 'el más reciente (sesión más alta) debe ir primero')

console.log('generation-history-signals-contracts: 9 contracts PASS')
