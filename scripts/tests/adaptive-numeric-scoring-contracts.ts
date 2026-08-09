import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { scoreQuestion } from '../../lib/adaptive/evaluation/scoring'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

// P0 — numeric_problem debe evaluarse con el scorer determinista (tolerance/unit reales),
// NUNCA con un juicio de LLM sin restricciones. lib/adaptive/evaluation/scoring.ts ya
// implementa esa lógica correctamente; el bug estaba en que session-check/route.ts la
// desviaba a evaluateWithAI (isOpenFormat incluía 'numeric_problem').

const numericQuestion = {
  id: 'q-numeric', format: 'numeric_problem',
  correctAnswer: { value: 4.2, tolerance: 0.1, unit: 'mol/L' },
} as unknown as CanonicalQuestion

assert.equal(scoreQuestion(numericQuestion, { value: 4.2, unit: 'mol/L' } as any).correct, true, 'valor exacto dentro de tolerancia debe ser correcto')
assert.equal(scoreQuestion(numericQuestion, { value: 4.25, unit: 'mol/L' } as any).correct, true, 'valor dentro de tolerancia (0.05 <= 0.1) debe ser correcto')
assert.equal(scoreQuestion(numericQuestion, { value: 4.5, unit: 'mol/L' } as any).correct, false, 'valor fuera de tolerancia debe ser incorrecto')
assert.equal(scoreQuestion(numericQuestion, { value: 4.2, unit: 'kg' } as any).correct, false, 'unidad distinta debe ser incorrecto aunque el valor coincida')

const sessionCheckSource = readFileSync('app/api/adaptive/session-check/route.ts', 'utf8')
assert.doesNotMatch(
  sessionCheckSource,
  /isOpenFormat\s*=\s*\[[^\]]*'numeric_problem'[^\]]*\]/,
  'numeric_problem no debe enrutarse a evaluateWithAI (LLM sin tolerance/unit) — debe usar scoreQuestion, el scorer determinista real',
)

console.log('adaptive-numeric-scoring-contracts: 5 contracts PASS')
