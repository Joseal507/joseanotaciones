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
// quick_test. En producto quick_test significa SIN TECLADO: numeric_problem
// requiere introducir un valor y por tanto pertenece a WRITING_FORMATS.
const evaluationModeContractSource = readFileSync('lib/adaptive/evaluation/evaluationModeContract.ts', 'utf8')
assert.ok(
  /WRITING_FORMATS = \[[\s\S]*?'numeric_problem'[\s\S]*?\]/.test(evaluationModeContractSource),
  'evaluationModeContract.ts debe tratar numeric_problem como formato con input escrito',
)
assert.ok(
  /quick_test:.*SIN TECLADO.*NUNCA short_response ni numeric_problem/.test(routeSource),
  'el prompt vivo debe prohibir explícitamente short_response y numeric_problem en quick_test',
)
assert.ok(
  routeSource.includes('PROHIBIDO en quick_test'),
  'el catálogo del prompt debe marcar numeric_problem como prohibido en quick_test',
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

// Auditoría adversarial (Codex, misión REAL-SESSION QUALITY, D CONFIRMADO
// P1): el prompt vivo SIEMPRE ofreció/exigió numeric_problem (arriba), pero
// el canonicalizador LOCAL (CanonicalEvaluationFormat/
// CANONICAL_EVALUATION_FORMATS/factoryQuestions) no lo reconocía — una
// respuesta correcta del LLM con format="numeric_problem" caía en el
// `default`, perdía correctAnswer, y quedaba inválida (disparando repair
// evitable). Mismo patrón exacto que el bug de short_response de la
// misión anterior — fijado aquí para que no vuelva a desincronizarse.
assert.ok(
  /\|\s*'numeric_problem'/.test(routeSource),
  "BUG DE ORIGEN SI FALLA: 'numeric_problem' debe estar en el type CanonicalEvaluationFormat local",
)
assert.ok(
  /CANONICAL_EVALUATION_FORMATS = new Set<CanonicalEvaluationFormat>\(\[[\s\S]*?'numeric_problem',?\s*\]\)/.test(routeSource),
  "BUG DE ORIGEN SI FALLA: 'numeric_problem' debe estar en CANONICAL_EVALUATION_FORMATS — si no, canonicalizeEvaluationFormat() nunca lo reconoce como formato válido",
)
assert.ok(
  /case 'numeric_problem': \{/.test(routeSource),
  'BUG DE ORIGEN SI FALLA: factoryQuestions debe tener un case explícito para numeric_problem que preserve {value,tolerance,unit} — sin él, correctAnswer se pierde en el `default`',
)
assert.ok(
  routeSource.includes('NO incluyas matchingOptionOrder'),
  'D CONFIRMADO P1 (hallazgo #2): el ejemplo anterior del prompt (matchingOptionOrder=["match_1","match_2",...]) sugería literalmente el orden trivial que el validador rechaza — el prompt debe instruir explícitamente NO incluirlo o nunca usar el orden idéntico a los rightId',
)

console.log('session-teach-numeric-problem-prompt-contract: 12 contracts PASS')
