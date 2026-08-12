import assert from 'node:assert/strict'
import fs from 'node:fs'
import { normalizeGeneratedQuestion, type CanonicalQuestion, type GenerationContext } from '../../lib/adaptive/evaluation/questionContract'
import { scoreQuestion } from '../../lib/adaptive/evaluation/scoring'
import { buildDevCanonicalAnswer, buildDevCanonicalVisualResponse } from '../../lib/adaptive/dev/devCanonicalAnswer'
import { gradeVisualInteraction } from '../../lib/adaptive/visual/visualGrading'
import { isDevToolsEnabled } from '../../lib/dev/devTools'
import type { VisualSpec } from '../../lib/adaptive/visual/visualContract'

// Herramienta DEV-ONLY de recorrido rápido (misión: botón "⏭ Omitir/responder
// correctamente" para QA/UX). Estos tests prueban que buildDevCanonicalAnswer/
// buildDevCanonicalVisualResponse producen respuestas que el GRADER REAL
// (scoreQuestion/gradeVisualInteraction, los mismos que /api/adaptive/session-check
// y /api/adaptive/visual-check usan server-side) califica como correctas — nunca
// se asume corrección, se PRUEBA contra el mismo código que califica a un
// estudiante real.

// ===========================================================================
// 1/2 — visibilidad dev-only (nivel de lógica; el nivel de DOM/build se prueba en
// tests/e2e/dev-skip-tool.spec.ts y con el grep sobre el build de producción).
// ===========================================================================
const originalNodeEnv = process.env.NODE_ENV
const originalDevFlag = process.env.NEXT_PUBLIC_STUDYAL_DEV_TOOLS
process.env.NODE_ENV = 'development'
assert.equal(isDevToolsEnabled(), true, '1: debe estar habilitado en development')
process.env.NODE_ENV = 'production'
delete process.env.NEXT_PUBLIC_STUDYAL_DEV_TOOLS
assert.equal(isDevToolsEnabled(), false, '2: debe estar deshabilitado en production sin flag')
process.env.NEXT_PUBLIC_STUDYAL_DEV_TOOLS = 'true'
assert.equal(isDevToolsEnabled(), true, 'flag explícito debe habilitarlo incluso en production')
process.env.NODE_ENV = originalNodeEnv
if (originalDevFlag === undefined) delete process.env.NEXT_PUBLIC_STUDYAL_DEV_TOOLS
else process.env.NEXT_PUBLIC_STUDYAL_DEV_TOOLS = originalDevFlag

// Las rutas auxiliares del browser E2E se compilan junto con la app, pero todos
// sus handlers públicos deben cerrar inequívocamente con 404 en producción.
// Este contrato cubre cada método exportado para evitar que un método nuevo o un
// contador de diagnóstico quede accesible por omisión.
const reliabilityRouteSource = fs.readFileSync(new URL('../../app/api/e2e-session-reliability/route.ts', import.meta.url), 'utf8')
const showcaseRouteSource = fs.readFileSync(new URL('../../app/api/e2e-visual-showcase/route.ts', import.meta.url), 'utf8')
for (const [routeName, source, methods] of [
  ['e2e-session-reliability', reliabilityRouteSource, ['GET', 'POST']],
  ['e2e-visual-showcase', showcaseRouteSource, ['GET']],
] as const) {
  for (const method of methods) {
    const handler = source.match(new RegExp(`export\\s+async\\s+function\\s+${method}\\s*\\([^]*?(?=export\\s+async\\s+function|$)`))?.[0] || ''
    assert.match(handler, /process\.env\.NODE_ENV\s*===\s*['"]production['"]/, `${routeName} ${method}: debe tener gate explícito de production`)
    assert.match(handler, /status\s*:\s*404/, `${routeName} ${method}: production debe responder 404`)
  }
}

// ===========================================================================
// 10 — no bypass de mastery: prueba ESTRUCTURAL de que el módulo que construye
// las respuestas canónicas nunca importa ni referencia ninguna API de
// mutación de evidencia/mastery — es puro por construcción, no solo por
// convención. Si alguien añadiera una de estas llamadas aquí, este test falla.
// ===========================================================================
const devToolSource = fs.readFileSync(new URL('../../lib/adaptive/dev/devCanonicalAnswer.ts', import.meta.url), 'utf8')
// Código real únicamente — descarta líneas de comentario para que la documentación
// (que legítimamente MENCIONA estas APIs para explicar el pipeline real) no
// dispare falsos positivos en este check estructural.
const devToolCodeOnly = devToolSource.split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
for (const forbiddenCall of ['recordAssessmentEvidence(', 'persistAssessmentBlueprint(', 'isMicroMastered(', 'calculateMasteryScore(', 'setUserAnswer(']) {
  assert.ok(!devToolCodeOnly.includes(forbiddenCall), `10: devCanonicalAnswer.ts no debe LLAMAR "${forbiddenCall}" — debe ser puro, sin tocar mastery/evidence/UI state directamente`)
}
assert.ok(!/correct\s*[:=]\s*true/.test(devToolCodeOnly), '10: devCanonicalAnswer.ts no debe hardcodear correct=true en ningún lado')
assert.ok(!/import[^;]*from ['"][^'"]*assessmentBlueprint['"]/.test(devToolCodeOnly), '10: no debe importar el módulo de mastery/evidence en absoluto — prueba estructural más fuerte que solo evitar llamadas')

// ===========================================================================
// 3-7 — construcción de canonical dev answer por formato, verificada CONTRA EL
// GRADER REAL (scoreQuestion) — nunca contra una copia paralela de la lógica.
// ===========================================================================
const context = (variant: string, dimension: GenerationContext['targetDimension'] = 'comprehension'): GenerationContext => ({
  activeConceptId: 'c1', activeConceptLabel: 'Concepto', teachingBlockId: 's1', targetDimension: dimension,
  questionFamily: variant, allowedConceptIds: ['c1'], forbiddenConceptIds: [], factKeys: ['f1'], targetObjectiveIds: ['o1'],
})
const base = { conceptId: 'c1', conceptLabel: 'Concepto', difficulty: 'medium', targetDimension: 'comprehension', questionText: 'Pregunta suficientemente clara para el fixture', explanation: 'Explicación', hint: 'Pista' }
const make = (raw: Record<string, unknown>): CanonicalQuestion => {
  const question = normalizeGeneratedQuestion({ ...base, ...raw }, context(String(raw.variant), (raw.targetDimension || 'comprehension') as GenerationContext['targetDimension']), String(raw.id || raw.variant))
  assert.ok(question, `fixture inválido para variant=${raw.variant}`)
  return question as CanonicalQuestion
}

const fixtures: CanonicalQuestion[] = [
  make({ variant: 'mcq_best_answer', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], correctAnswer: 'b' }),
  make({ variant: 'scenario_predict', options: [{ id: 'x', text: 'X' }, { id: 'y', text: 'Y' }], correctAnswer: 'x' }),
  make({ variant: 'find_error_reasoning', options: [{ id: 'p', text: 'P' }, { id: 'q', text: 'Q' }], correctAnswer: 'q' }),
  make({ variant: 'multi_select_correct', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], correctAnswer: ['a', 'c'] }),
  make({ variant: 'true_false_relationship', options: null, correctAnswer: false }),
  make({ variant: 'word_bank_process', questionText: '___ luego ___ y finalmente ___', options: [{ id: 'w1', text: 'A' }, { id: 'w2', text: 'B' }, { id: 'w3', text: 'C' }, { id: 'd', text: 'X' }], correctAnswer: ['w1', 'w2', 'w3'] }),
  make({ variant: 'ordering_steps', options: [{ id: 's1', text: '1' }, { id: 's2', text: '2' }, { id: 's3', text: '3' }], correctAnswer: ['s3', 's1', 's2'] }),
  make({ variant: 'matching_term_function', options: [{ id: 'l1', left: 'L1', rightId: 'r1', right: 'R1' }, { id: 'l2', left: 'L2', rightId: 'r2', right: 'R2' }, { id: 'l3', left: 'L3', rightId: 'r3', right: 'R3' }], correctAnswer: { l1: 'r1', l2: 'r2', l3: 'r3' } }),
  make({ variant: 'classify_examples', options: { categories: ['A', 'B', 'C'], items: [{ id: 'i1', text: 'I1', category: 'A' }, { id: 'i2', text: 'I2', category: 'B' }, { id: 'i3', text: 'I3', category: 'C' }] }, correctAnswer: { i1: 'A', i2: 'B', i3: 'C' } }),
  make({ variant: 'problem_solve', targetDimension: 'application', options: null, correctAnswer: { value: -0.0051, tolerance: 0.00001, unit: 'mol' } }),
  make({ variant: 'problem_solve', targetDimension: 'application', options: null, correctAnswer: { value: 42, tolerance: 0.5 } }),
  make({ variant: 'short_answer_define', options: null, correctAnswer: 'Definición canónica esperada de la respuesta' }),
]

for (const question of fixtures) {
  const canonical = buildDevCanonicalAnswer(question)
  const result = scoreQuestion(question, canonical)
  assert.equal(result.correct, true, `formato=${question.format} — buildDevCanonicalAnswer debe calificar CORRECTO vía scoreQuestion real, obtuvo: ${JSON.stringify(canonical)}, score=${result.score}`)
}

// Guard contra un builder degenerado ("siempre igual"): dos preguntas del MISMO
// formato con correctAnswer distinto deben producir canonical answers distintos,
// y CADA uno debe fallar contra la pregunta del otro (prueba de que realmente lee
// question.correctAnswer, no un valor fijo).
const mcqA = make({ variant: 'mcq_best_answer', id: 'mcqA', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctAnswer: 'a' })
const mcqB = make({ variant: 'mcq_best_answer', id: 'mcqB', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctAnswer: 'b' })
assert.notEqual(buildDevCanonicalAnswer(mcqA), buildDevCanonicalAnswer(mcqB), 'canonical answers de dos preguntas con distinta correctAnswer deben diferir')
assert.equal(scoreQuestion(mcqA, buildDevCanonicalAnswer(mcqB)).correct, false, 'la respuesta canónica de B no debe calificar correcto contra A')

// Formato no soportado (defensivo, nunca debería alcanzarse en producción real):
// debe LANZAR, nunca degradar a una respuesta inventada silenciosa.
assert.throws(() => buildDevCanonicalAnswer({ ...mcqA, format: 'unsupported_future_format' } as unknown as CanonicalQuestion), /DEV_CANONICAL_ANSWER_UNSUPPORTED_FORMAT/)

// ===========================================================================
// 8 — visual required: canonical response verificado contra gradeVisualInteraction
// REAL (el mismo que /api/adaptive/visual-check ejecuta server-side).
// ===========================================================================
const visualFixtures: VisualSpec[] = [
  { id: 'v1', requirementId: 'r1', microId: 'm1', engine: 'graph_2d', representation: 'graph', conceptual: false, sourceGrounding: { sourceSpans: [], factKeys: [] }, data: { expression: '2x+1', domain: [-5, 5], points: [{ x: 2, y: 5 }] } },
  { id: 'v2', requirementId: 'r2', microId: 'm2', engine: 'structured_grid', representation: 'ice', conceptual: false, sourceGrounding: { sourceSpans: [], factKeys: [] }, data: { reaction: 'A ⇌ B', species: ['A', 'B'], initial: { A: 1, B: 0 }, change: { A: '-x', B: '+x' }, equilibrium: { A: '1-x', B: 'x' } } },
  { id: 'v3', requirementId: 'r3', microId: 'm3', engine: 'spatial_vector', representation: 'fbd', conceptual: false, sourceGrounding: { sourceSpans: [], factKeys: [] }, data: { body: 'bloque', forces: [{ id: 'f1', label: 'Peso', magnitude: 50, angleDeg: 270, unit: 'N' }], axes: { x: 'horizontal', y: 'vertical' } } },
  { id: 'v4', requirementId: 'r4', microId: 'm4', engine: 'chemistry_2d', representation: 'skeletal', conceptual: false, sourceGrounding: { sourceSpans: [], factKeys: [] }, data: { atoms: [{ id: 'C1', element: 'C', x: 0, y: 0 }, { id: 'O1', element: 'O', x: 60, y: 0 }], bonds: [{ from: 'C1', to: 'O1', order: 2 }] } },
  { id: 'v5', requirementId: 'r5', microId: 'm5', engine: 'code_execution', representation: 'trace', conceptual: false, sourceGrounding: { sourceSpans: [], factKeys: [] }, data: { language: 'python', code: 'x = 3\nprint(x)', steps: [{ line: 1, variables: { x: 3 } }, { line: 2, variables: { x: 3 }, output: '3' }] } },
  { id: 'v6', requirementId: 'r6', microId: 'm6', engine: 'timeline', representation: 'timeline', conceptual: false, sourceGrounding: { sourceSpans: [], factKeys: [] }, data: { events: [{ id: 'e1', label: 'Primero', order: 1 }, { id: 'e2', label: 'Segundo', order: 2 }, { id: 'e3', label: 'Tercero', order: 3 }] } },
]

for (const spec of visualFixtures) {
  const { verb, response } = buildDevCanonicalVisualResponse(spec)
  const result = gradeVisualInteraction(spec, { visualSpecId: spec.id, verb, response })
  assert.equal(result.correct, true, `engine=${spec.engine} — buildDevCanonicalVisualResponse debe calificar CORRECTO vía gradeVisualInteraction real, obtuvo: ${JSON.stringify(response)}, score=${result.score}, feedback=${result.feedback}`)
}

// motor no soportado: debe lanzar, nunca degradar a "aprobado" silencioso.
assert.throws(() => buildDevCanonicalVisualResponse({ ...visualFixtures[0], engine: 'unsupported_future_engine' } as unknown as VisualSpec), /DEV_CANONICAL_VISUAL_RESPONSE_UNSUPPORTED_ENGINE/)

console.log(`dev-tool-canonical-answer-contracts: PASS (${fixtures.length} formatos de pregunta + ${visualFixtures.length} engines visuales, todos verificados contra el grader real; visibilidad dev/prod verificada; pureza estructural verificada)`)
