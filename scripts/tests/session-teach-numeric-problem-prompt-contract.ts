import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// P3 — AUDITORÍA DE CALIDAD PEDAGÓGICA
//
// Hallazgo real (reproducido con generación real vía OpenRouter en 6 dominios,
// incluyendo mathematics y physics_quantitative — ver conversación): el prompt
// vivo de generateEvaluationBlock (session-teach/route.ts) nunca ofrecía
// "numeric_problem" como variant disponible ni definía su contrato de options —
// solo lo mencionaba para PROHIBIRLO en quick_test, dando a entender que existía
// para otros modos sin nunca definirlo. Resultado empírico: en dominios
// cuantitativos con fórmulas y ejemplos numéricos resueltos en el material
// (regla de la cadena, torque), CERO preguntas de aplicación numérica —
// solo reconocimiento/comprensión conceptual (mismatch cognitiveTarget vs
// contenido). numeric_problem está IMPLEMENTED (scoring real en
// lib/adaptive/evaluation/scoring.ts, render real en la página de sesión) y
// RENDERABLE, pero no era SELECTABLE en la ruta de generación viva — por tanto
// nunca ACTUALLY USED. Este test fija estáticamente que el catálogo de variants
// del prompt vivo incluye numeric_problem con su contrato de options, evitando
// una regresión silenciosa si alguien reordena o recorta el prompt.
const routeSource = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')

assert.ok(
  /numeric_problem\s*→\s*problem_solve/.test(routeSource),
  'el catálogo VARIANTS DISPONIBLES del prompt vivo debe ofrecer numeric_problem — si no, el generador nunca lo produce sin importar el dominio',
)
assert.ok(
  /numeric_problem:\s*NO incluyas options;\s*correctAnswer=\{"value"/.test(routeSource),
  'el prompt debe definir el contrato exacto de options/correctAnswer de numeric_problem ({value,tolerance,unit}) — coincide con el scorer real en lib/adaptive/evaluation/scoring.ts',
)
assert.ok(
  routeSource.includes('APLICACIÓN: numeric_problem calculando con la fórmula y datos del material'),
  'la guía por tipo de paso "formula" debe preferir numeric_problem para aplicación, no solo scenario_predict — el material trae ejemplos numéricos resueltos que deben ejercitarse, no solo reconocerse',
)
// P3.2: evaluationModeContract.ts es la autoridad real de qué formatos admite
// quick_test — numeric_problem está en CLOSED_FORMATS ahí (respuesta corta
// cerrada, no escritura abierta). El prompt vivo prohibía numeric_problem en
// quick_test sin base en ese contrato; ya no debe hacerlo.
const evaluationModeContractSource = readFileSync('lib/adaptive/evaluation/evaluationModeContract.ts', 'utf8')
assert.ok(
  /CLOSED_FORMATS = \[[\s\S]*?'numeric_problem'[\s\S]*?\]/.test(evaluationModeContractSource),
  'evaluationModeContract.ts debe seguir tratando numeric_problem como CLOSED_FORMATS — si esto cambia, el prompt vivo debe revisarse en consecuencia',
)
assert.ok(
  !/quick_test:.*NUNCA short_response ni numeric_problem/.test(routeSource),
  'el prompt vivo ya no debe prohibir numeric_problem en quick_test — evaluationModeContract.ts (la autoridad real) sí lo permite',
)
assert.ok(
  routeSource.includes('numeric_problem SÍ está permitido en quick_test'),
  'el prompt vivo debe declarar explícitamente que numeric_problem SÍ está permitido en quick_test, alineado con evaluationModeContract.ts',
)

// El contrato de scoring real que justifica el shape exigido en el prompt.
const scoringSource = readFileSync('lib/adaptive/evaluation/scoring.ts', 'utf8')
assert.ok(
  scoringSource.includes("question.format === 'numeric_problem'") &&
  scoringSource.includes('question.correctAnswer.value') &&
  scoringSource.includes('question.correctAnswer.tolerance'),
  'el scorer real de numeric_problem espera correctAnswer.value/tolerance — el prompt debe pedir exactamente ese shape',
)

// Hallazgo real #2 (mismo lote de generación real, dominio "conceptual"): una
// pregunta matching_concept_def generada realmente por el modelo tenía sus 3
// pares CÍCLICAMENTE desplazados — options[i].right describía options[i-1].left,
// no options[i].left — y sin embargo correctAnswer marcaba ese desplazamiento
// como "correcto" (contradiciendo el propio campo `explanation` de la misma
// pregunta, que sí listaba las relaciones reales). No es determinista (depende
// del LLM), así que no se puede fijar con un test de contenido exacto — se deja
// documentado como limitación real en el reporte P3. Mitigación mínima aplicada:
// instrucción explícita en el contrato de options de matching_* pidiendo
// verificar cada par contra el contenido del paso antes de responder.
assert.ok(
  routeSource.includes('CADA "right" debe describir ÚNICAMENTE a su propio "left"'),
  'el contrato de options de matching_* debe advertir explícitamente contra reasignar descripciones entre pares — mitigación del hallazgo real de un matching con pares desplazados cíclicamente',
)

console.log('session-teach-numeric-problem-prompt-contract: 8 contracts PASS')
