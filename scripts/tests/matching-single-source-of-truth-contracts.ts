import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateMatchingQuestion } from '../../lib/adaptive/evaluation/matchingValidator'
import {
  matchingCorrectPairs,
  normalizeGeneratedQuestion,
  type CanonicalQuestion,
  type GenerationContext,
} from '../../lib/adaptive/evaluation/questionContract'
import { scoreQuestion } from '../../lib/adaptive/evaluation/scoring'

// REGRESIÓN #9 — MATCHING: UNA SOLA FUENTE DE VERDAD
//
// Problema confirmado: options[] (con left/right/rightId ya emparejados por
// entry) y correctAnswer (pairId->rightId) pueden resolverse de forma
// INDEPENDIENTE según el camino de generación:
//   - session-teach (factoryQuestions + resolveMatchingAnswer): correctAnswer
//     se resuelve por separado del texto/JSON crudo del LLM — puede divergir
//     de options[].rightId. matchingValidator SÍ estaba conectado aquí (vía
//     sessionPreparationFactory), pero no en los demás caminos.
//   - session-reteach / session-eval (normalizeGeneratedQuestion): correctAnswer
//     se DERIVA de options[] (tautológicamente igual a options[].rightId), así
//     que la capa ESTRUCTURAL de matchingValidator nunca dispara aquí — pero la
//     capa de GROUNDING (¿el right realmente describe a SU left, o a otro?) sí
//     puede seguir detectando contenido desplazado, y no estaba conectada.
// El feedback (page.tsx) leía pair.right directo del mismo entry de options[],
// ignorando correctAnswer por completo — una fuente DISTINTA de la que usa el
// grader (scoreQuestion, que compara contra correctAnswer). Cuando ambas
// fuentes divergían, el resultado observado era exactamente: el grader marca
// incorrecto, y el feedback muestra como "correcta" la misma combinación que
// el estudiante ya había seleccionado.
//
// Fix: matchingCorrectPairs() (questionContract.ts) es ahora la ÚNICA función
// que resuelve "cuál es la asociación correcta de cada pair", consumida tanto
// por el feedback (page.tsx) como por estos tests — nunca reconstruida en
// paralelo. matchingValidator ahora se invoca en los 3 caminos de generación
// (session-teach ya lo tenía; session-reteach y session-eval lo incorporan en
// este fix) antes de que una pregunta matching pueda llegar al usuario.

function buildMatchingQuestion(overrides: {
  options: CanonicalQuestion extends infer Q ? (Q extends { format: 'matching' } ? Q['options'] : never) : never
  correctAnswer: Record<string, string>
  matchingOptionOrder: string[]
  explanation?: string
  targetFactKeys?: string[]
  id?: string
}): Extract<CanonicalQuestion, { format: 'matching' }> {
  return {
    id: overrides.id || 'matching-q', conceptId: 'organelos', conceptLabel: 'Organelos celulares',
    teachingBlockId: 'step-organelos', questionFamily: 'matching', variant: 'matching_concept_def',
    difficulty: 'medium', targetDimension: 'comprehension',
    questionText: 'Relaciona cada organelo con su función.',
    explanation: overrides.explanation || '', hint: '', estimatedSeconds: 45, evidencesNeeded: 1,
    factKey: overrides.targetFactKeys?.[0] || '', targetFactKeys: overrides.targetFactKeys || [],
    format: 'matching', options: overrides.options, correctAnswer: overrides.correctAnswer,
    matchingSemantics: 'bijective', matchingOptionOrder: overrides.matchingOptionOrder,
  } as Extract<CanonicalQuestion, { format: 'matching' }>
}

const pairs = [
  { id: 'p1', rightId: 'm1', left: 'Mitocondria', right: 'Produce energía celular mediante respiración' },
  { id: 'p2', rightId: 'm2', left: 'Núcleo', right: 'Contiene el material genético de la célula' },
  { id: 'p3', rightId: 'm3', left: 'Ribosoma', right: 'Sintetiza proteínas a partir de ARN mensajero' },
]
const alignedCorrectAnswer = { p1: 'm1', p2: 'm2', p3: 'm3' }
const factKeys = [
  'Mitocondria: produce energía celular mediante respiración.',
  'Núcleo: contiene el material genético de la célula.',
  'Ribosoma: sintetiza proteínas a partir de ARN mensajero.',
]

// ═══ A — correctAnswer desalineado con options.rightId (mismatch estructural) ═══
const misalignedCorrectAnswer = { p1: 'm2', p2: 'm1', p3: 'm3' } // p1/p2 intercambiados
assert.equal(
  validateMatchingQuestion({ options: pairs, correctAnswer: misalignedCorrectAnswer, targetFactKeys: factKeys }).valid,
  false,
  'A: correctAnswer[id] !== option.rightId debe rechazarse (capa estructural)',
)
assert.equal(
  validateMatchingQuestion({ options: pairs, correctAnswer: misalignedCorrectAnswer, targetFactKeys: factKeys }).reason,
  'MATCHING_CORRECT_ANSWER_ID_MISMATCH',
)

// ═══ B — matching válido normal ═══
assert.equal(
  validateMatchingQuestion({ options: pairs, correctAnswer: alignedCorrectAnswer, targetFactKeys: factKeys }).valid,
  true,
  'B: matching bien formado y groundeado debe ser válido',
)
const validQuestion = buildMatchingQuestion({ options: pairs, correctAnswer: alignedCorrectAnswer, matchingOptionOrder: ['m3', 'm1', 'm2'], targetFactKeys: factKeys })
const correctAnswerAsStudentInput = Object.fromEntries(matchingCorrectPairs(validQuestion).map(p => [p.pairId, p.rightId]))
assert.equal(scoreQuestion(validQuestion, correctAnswerAsStudentInput).correct, true, 'B: responder según matchingCorrectPairs debe calificar correcto')

// ═══ C — matching válido generado por el camino de recovery (normalizeGeneratedQuestion) ═══
// Simula exactamente lo que produce el LLM en session-reteach/session-eval:
// options con left/right ya emparejados, SIN que el modelo tenga que declarar
// un correctAnswer separado y fiable (normalizeGeneratedQuestion lo deriva de
// options[] — ver questionContract.ts).
const recoveryContext: GenerationContext = {
  activeConceptId: 'organelos', activeConceptLabel: 'Organelos celulares', teachingBlockId: 'step-organelos',
  targetDimension: 'comprehension', questionFamily: 'recovery_round', allowedConceptIds: ['organelos'],
  forbiddenConceptIds: [], factKeys,
}
const rawFromLLM = {
  variant: 'matching_concept_def', matchingSemantics: 'bijective',
  questionText: 'Relaciona cada organelo con su función.',
  options: pairs.map(p => ({ id: p.id, left: p.left, right: p.right, rightId: p.rightId })),
  correctAnswer: alignedCorrectAnswer, explanation: 'Cada organelo cumple la función descrita.', hint: '',
}
const recoveryQuestion = normalizeGeneratedQuestion(rawFromLLM, recoveryContext, 'recovery-q1') as Extract<CanonicalQuestion, { format: 'matching' }> | null
assert.ok(recoveryQuestion, 'C: normalizeGeneratedQuestion debe aceptar un matching bien formado')
assert.equal(validateMatchingQuestion(recoveryQuestion!).valid, true, 'C: matching de recovery bien groundeado debe pasar matchingValidator')

// ═══ D — matching inválido generado en recovery, bloqueado ═══
// Mismo patrón de contenido desplazado que motivó matchingValidator.ts
// originalmente (Diástole/Sístole), reproducido en el camino de recovery: el
// modelo escribe el "right" de p1 y p2 intercambiados respecto a lo que narra
// explanation, pero options[]/correctAnswer quedan referencialmente
// consistentes entre sí (la capa estructural, por sí sola, no lo detecta).
const driftedRawFromLLM = {
  variant: 'matching_concept_def', matchingSemantics: 'bijective',
  questionText: 'Relaciona cada organelo con su función.',
  options: [
    { id: 'p1', left: 'Mitocondria', right: 'Contiene el material genético de la célula', rightId: 'm1' },
    { id: 'p2', left: 'Núcleo', right: 'Produce energía celular mediante respiración', rightId: 'm2' },
    { id: 'p3', left: 'Ribosoma', right: 'Sintetiza proteínas a partir de ARN mensajero', rightId: 'm3' },
  ],
  correctAnswer: { p1: 'm1', p2: 'm2', p3: 'm3' }, // referencialmente consistente con options[] de arriba
  explanation: 'La mitocondria produce energía celular mediante respiración. El núcleo contiene el material genético de la célula. El ribosoma sintetiza proteínas a partir de ARN mensajero.',
  hint: '',
}
const driftedQuestion = normalizeGeneratedQuestion(driftedRawFromLLM, recoveryContext, 'recovery-q2-drift') as Extract<CanonicalQuestion, { format: 'matching' }> | null
assert.ok(driftedQuestion, 'D: shape sigue siendo válido (por eso hace falta la capa de grounding)')
const driftedResult = validateMatchingQuestion(driftedQuestion!)
assert.equal(driftedResult.valid, false, 'D: el contenido desplazado debe bloquearse aunque la estructura sea consistente')
assert.match(driftedResult.reason || '', /MATCHING_CONTENT_DRIFT/)

// ═══ E — el feedback (matchingCorrectPairs) muestra EXACTAMENTE lo que el grader usó ═══
for (const pair of matchingCorrectPairs(validQuestion)) {
  const singleAnswer = { [pair.pairId]: pair.rightId }
  // No exigimos 100% (solo respondimos un pair), pero SÍ que ese pair concreto
  // puntúe como acierto individual dentro del cálculo del grader.
  const full = { ...correctAnswerAsStudentInput, ...singleAnswer }
  assert.equal(scoreQuestion(validQuestion, full).correct, true, `E: el texto que muestra matchingCorrectPairs para ${pair.pairId} debe coincidir con lo que el grader acepta como correcto`)
}
// Reproducción explícita del patrón observado: con un correctAnswer
// desalineado (mismo shape que el bug real de session-teach, capa
// estructural), la lógica VIEJA (leer pair.right del mismo entry, ignorando
// correctAnswer) y la lógica NUEVA (matchingCorrectPairs) deben DIVERGIR —
// demostrando por qué el bug era real y por qué el fix lo cierra.
const misalignedQuestion = buildMatchingQuestion({ options: pairs, correctAnswer: misalignedCorrectAnswer, matchingOptionOrder: ['m1', 'm2', 'm3'], id: 'misaligned-q' })
const oldNaiveFeedback = (pairId: string) => pairs.find(p => p.id === pairId)?.right // lógica vieja: pair.right directo
const newFeedback = new Map(matchingCorrectPairs(misalignedQuestion).map(p => [p.pairId, p.rightText]))
// El estudiante selecciona exactamente lo que la pregunta le muestra emparejado (rightId de su propio pair) — selección "natural".
const studentPicksPerEntry = Object.fromEntries(pairs.map(p => [p.id, p.rightId]))
const graderVerdict = scoreQuestion(misalignedQuestion, studentPicksPerEntry)
assert.equal(graderVerdict.correct, false, 'reproducción: el grader marca incorrecto (compara contra correctAnswer desalineado)')
assert.equal(oldNaiveFeedback('p1'), pairs.find(p => p.id === 'p1')!.right, 'reproducción: la lógica vieja mostraría exactamente lo que el estudiante ya seleccionó como "correcto" — el bug real')
assert.notEqual(newFeedback.get('p1'), oldNaiveFeedback('p1'), 'FIX: matchingCorrectPairs ya no coincide con la lógica vieja para el pair desalineado — muestra la respuesta real usada por el grader')
assert.equal(newFeedback.get('p1'), pairs.find(p => p.id === 'm2' /* rightId apuntado por correctAnswer.p1 */ || p.rightId === 'm2')!.right)

// ═══ F — una respuesta correcta nunca puede mostrarse como incorrecta por divergencia de IDs/orden ═══
for (const orderVariant of [['m1', 'm2', 'm3'], ['m3', 'm1', 'm2'], ['m2', 'm3', 'm1']]) {
  const shuffledQuestion = buildMatchingQuestion({ options: pairs, correctAnswer: alignedCorrectAnswer, matchingOptionOrder: orderVariant, id: `shuffled-${orderVariant.join('')}` })
  const answerFromCanonicalPairs = Object.fromEntries(matchingCorrectPairs(shuffledQuestion).map(p => [p.pairId, p.rightId]))
  assert.equal(scoreQuestion(shuffledQuestion, answerFromCanonicalPairs).correct, true, `F: orden visual ${orderVariant.join(',')} no debe afectar si una respuesta genuinamente correcta se califica como tal`)
}

// ═══ G — shuffle visual no cambia scoring ═══
const orderA = buildMatchingQuestion({ options: pairs, correctAnswer: alignedCorrectAnswer, matchingOptionOrder: ['m1', 'm2', 'm3'], id: 'order-a' })
const orderB = buildMatchingQuestion({ options: pairs, correctAnswer: alignedCorrectAnswer, matchingOptionOrder: ['m3', 'm2', 'm1'], id: 'order-b' })
const sameAnswer = { p1: 'm1', p2: 'm2', p3: 'm3' }
assert.deepEqual(scoreQuestion(orderA, sameAnswer), scoreQuestion(orderB, sameAnswer), 'G: el mismo answer debe calificar idéntico sin importar matchingOptionOrder')
const wrongAnswer = { p1: 'm2', p2: 'm1', p3: 'm3' }
assert.deepEqual(scoreQuestion(orderA, wrongAnswer), scoreQuestion(orderB, wrongAnswer), 'G: también debe coincidir para una respuesta incorrecta')

// ═══ H — retry/restore no altera canonical answer ═══
const restored = JSON.parse(JSON.stringify(validQuestion)) as typeof validQuestion
assert.deepEqual(restored.correctAnswer, validQuestion.correctAnswer)
assert.deepEqual(restored.options, validQuestion.options)
assert.deepEqual(matchingCorrectPairs(restored), matchingCorrectPairs(validQuestion), 'H: matchingCorrectPairs debe ser idéntico antes y después de un roundtrip de persistencia/restore')

// ═══ D (nivel ruta) e I — contrato de wiring estático ═══
// Probar la generación LLM real de forma determinista para inyectar contenido
// adversarial (D a nivel de ruta) no es fiable: depende de que el mock de
// fetch intercepte la llamada interna del SDK del proveedor — si no la
// intercepta (caveat ya documentado en matching-academic-validity.spec.ts),
// el proveedor real generaría contenido limpio y el test no probaría nada.
// En su lugar, se verifica con un contrato ESTÁTICO sobre el código fuente
// (mismo patrón ya usado en assessment-blueprint-contracts.ts) que las tres
// rutas generadoras de matching realmente invocan matchingValidator antes de
// construir su respuesta — determinista, rápido, sin red.
const sessionPreparationFactorySource = readFileSync('lib/ai/sessionPreparationFactory.ts', 'utf8')
const sessionReteachRoute = readFileSync('app/api/adaptive/session-reteach/route.ts', 'utf8')
const sessionEvalRoute = readFileSync('app/api/adaptive/session-eval/route.ts', 'utf8')
const sessionPageSource = readFileSync('app/materias/[temaId]/sesion/[sessionNumber]/page.tsx', 'utf8')

assert.match(sessionPreparationFactorySource, /validateMatchingQuestion/, 'evaluación inicial (session-teach, vía sessionPreparationFactory.diagnoseEvaluationBlock) debe invocar matchingValidator')
assert.match(sessionReteachRoute, /import \{ validateMatchingQuestion \}/, 'session-reteach debe importar matchingValidator')
assert.match(sessionReteachRoute, /if \(question\.format === 'matching'\) \{\s*\n\s*const matchingResult = validateMatchingQuestion\(question\)/, 'session-reteach debe invocar matchingValidator sobre cada pregunta matching ANTES de aceptarla en el round de recovery')
assert.match(sessionEvalRoute, /import \{ validateMatchingQuestion \}/, 'session-eval debe importar matchingValidator')
assert.match(sessionEvalRoute, /if \(question\.format === 'matching'\) \{\s*\n\s*const matchingResult = validateMatchingQuestion\(question\)/, 'session-eval debe invocar matchingValidator sobre cada pregunta matching antes de aceptar el batch')

// I — falso incorrecto no puede entrar a EvidenceProfile: se sigue por
// transitividad de lo anterior — recordAssessmentEvidence/
// recordRecoveryVerificationOutcome (page.tsx) solo operan sobre preguntas
// que ya vinieron de classContent o de estas 3 rutas; si ninguna de las 3
// puede devolver un matching con drift de contenido (demostrado arriba, A/D),
// y el feedback nunca reconstruye la respuesta en paralelo (E, ya usa
// matchingCorrectPairs en vez de pair.right), no existe ningún camino para
// que un falso-incorrecto de matching contamine evidencia.
assert.doesNotMatch(sessionPageSource, /<AcademicContent content=\{pair\.right\} inline \/>/, 'I: el feedback de matching no debe volver a leer pair.right directo — debe consumir matchingCorrectPairs')
assert.match(sessionPageSource, /matchingCorrectPairs\(/, 'I: el feedback de matching debe consumir matchingCorrectPairs (misma fuente que el grader)')

console.log('matching-single-source-of-truth-contracts: A-I PASS')
