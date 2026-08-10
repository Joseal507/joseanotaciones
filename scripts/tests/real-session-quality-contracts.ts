import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detectUnsupportedQuestionDimension } from '../../lib/adaptive/evaluation/questionDimensionGuard'
import { detectAnswerLeak } from '../../lib/adaptive/evaluation/answerLeakGuard'
import {
  createRecoveryQueue,
  nextRecoveryItem,
  beginRecoveryReteach,
  MAX_RECOVERY_ROUNDS,
} from '../../lib/adaptive/evaluation/recoveryQueue'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

// Misión REAL-SESSION QUALITY — caso real: QUIMICA SEGUNDO SEMESTRE 1.pdf,
// never_seen/quick_test. Fixes: A1 (cobertura visual), A2 (retry técnico),
// B1/B4 (drift semántico), B2 (answer leak), B3 (bounded recovery), C1
// (feedback duplicado), C2 (ALAI durante feedback), D (numeric_problem +
// matching order). Revisión final de Codex encontró y corrigió 3 hallazgos
// adicionales (self-authorization del dimension guard, false-positive del
// true_false leak check, nextRecoveryItem reofreciendo un item agotado) —
// cubiertos aquí explícitamente.

// ═══ A1. Visual coverage: batch, no total drop ═══
const blueprintSource = readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
assert.doesNotMatch(blueprintSource, /const MAX_VISION_PAGES/, 'BUG DE ORIGEN SI FALLA: el cap total de páginas visuales (MAX_VISION_PAGES) debe haberse eliminado — nunca se puede descartar cobertura por un cap fijo')
assert.doesNotMatch(blueprintSource, /poorPages\.slice\(0, MAX_VISION_PAGES\)/, 'BUG DE ORIGEN SI FALLA: no debe existir un slice que descarte candidatas más allá de un cap fijo')
assert.match(blueprintSource, /VISION_BATCH_SIZE/, 'debe existir un tamaño de batch que controle concurrencia sin descartar candidatas')
assert.match(blueprintSource, /for \(const \[pageNum, text\] of fullPageMap\.entries\(\)\) \{\s*if \(text && text !== pageMap\.get\(pageNum\)\) pageMap\.set\(pageNum, text\)/, 'BUG DE ORIGEN SI FALLA: el contenido visual enriquecido debe sincronizarse de vuelta a pageMap antes de extractDocumentStructure, o las páginas puramente visuales nunca reciben topic')

// ═══ A2. Transient provider failure enters technical retry ═══
const pipelineSource = readFileSync('lib/ai/sessionContentGenerationPipeline.ts', 'utf8')
assert.match(pipelineSource, /isTransientError\?:/, 'withTechnicalJsonRetry debe aceptar un clasificador de transitoriedad')
assert.match(pipelineSource, /try \{\s*raw = await params\.attempt/, 'BUG DE ORIGEN SI FALLA: params.attempt() debe estar dentro de un try/catch — si no, un throw del proveedor escapa el loop en el primer intento sin usar el resto de maxAttempts')
const teachSource = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
assert.match(teachSource, /isTransientProviderError/, 'session-teach debe clasificar errores de proveedor para el retry técnico de remote()')
assert.match(teachSource, /catch\(providerErr:any\)\{const providerReason=providerErr\?\.providerError/, 'BUG DE ORIGEN SI FALLA: generateTeachingStrict tenía su propio loop manual con el mismo bug — su alai() también debe estar en try/catch')

// ═══ D. numeric_problem canonicalizer + matching order ═══
assert.match(teachSource, /case 'numeric_problem': \{/, 'factoryQuestions debe preservar {value,tolerance,unit} para numeric_problem')
assert.match(teachSource, /NO incluyas matchingOptionOrder/, 'el prompt no debe sugerir el orden trivial de matchingOptionOrder que el validador rechaza')

// ═══ B1/B4. Recovery dimension drift guard ═══
function fact(text: string) { return [text] }

// Caso adversarial original del reporte real.
assert.equal(
  detectUnsupportedQuestionDimension({
    questionText: 'Ordena estos compuestos con carbono de menor a mayor complejidad estructural.',
    allowedText: fact('Algunos compuestos con carbono son inorgánicos.'),
  }).unsupported,
  true,
  'BUG DE ORIGEN SI FALLA: una dimensión de ranking/complejidad nunca enseñada debe rechazarse',
)
assert.equal(
  detectUnsupportedQuestionDimension({
    questionText: 'Clasifica estos compuestos según su origen mineral.',
    allowedText: fact('Algunos compuestos con carbono son inorgánicos.'),
  }).unsupported,
  true,
)
assert.equal(
  detectUnsupportedQuestionDimension({
    questionText: '¿Cuál de estos compuestos con carbono es inorgánico?',
    allowedText: fact('Algunos compuestos con carbono son inorgánicos.'),
  }).unsupported,
  false,
  'una pregunta legítima que reutiliza el hecho enseñado no debe rechazarse',
)
assert.equal(
  detectUnsupportedQuestionDimension({
    questionText: 'Clasifica estos ejemplos como orgánico o inorgánico.',
    allowedText: fact('Algunos compuestos con carbono son inorgánicos.'),
  }).unsupported,
  false,
)

// Revisión final Codex, P0 hallazgo #1: el guard no debe poder
// auto-autorizarse si la MISMA generación inventa la dimensión tanto en la
// pregunta como en su propia explicación — por eso session-reteach/route.ts
// NO debe incluir la `explanation` recién generada en allowedText.
assert.doesNotMatch(
  readFileSync('app/api/adaptive/session-reteach/route.ts', 'utf8'),
  /allowedText: \[\s*sourceKeyPointTexts\.join\(' '\),\s*String\(sourceQuestion\.questionText \|\| ''\),\s*String\(sourceQuestion\.explanation \|\| ''\),\s*teachingContent,\s*explanation,/,
  'BUG DE ORIGEN SI FALLA: la explanation recién generada en esta ronda NO debe estar en el allowedText del dimension guard — permite auto-autorizar el mismo drift que debe rechazar',
)

// Revisión final Codex, P0 hallazgo #1, segunda observación: una palabra
// genérica compartida (p.ej. "origen") no debe "blanquear" una dimensión
// multi-palabra completa cuyo término distintivo nunca se enseñó.
assert.equal(
  detectUnsupportedQuestionDimension({
    questionText: 'Clasifica estos compuestos según su origen mineral.',
    allowedText: fact('El origen de estos compuestos se remonta a procesos biológicos.'), // contiene "origen" genérico
  }).unsupported,
  true,
  'BUG DE ORIGEN SI FALLA: "origen" genérico en el material no debe blanquear la dimensión completa "origen mineral" nunca enseñada',
)

// ═══ B2. Answer leak guard ═══
assert.equal(
  detectAnswerLeak({
    format: 'short_response',
    questionText: 'Explica por qué el CO2 es inorgánico pese a contener carbono en su estructura.',
    correctAnswer: 'el CO2 es inorgánico pese a contener carbono en su estructura',
  }).leaked,
  true,
  'BUG DE ORIGEN SI FALLA: un short_response que repite literalmente su propia respuesta modelo en el enunciado debe rechazarse',
)
// Revisión final Codex, P1 hallazgo #2: fraseología convencional de
// true_false ("¿Verdadero o falso? ...") NO debe rechazarse — no existe ya
// ninguna rama true_false en este guard (retirada por ser un falso positivo
// masivo: presentAnswer(_, true) devuelve literalmente "Verdadero", que
// SIEMPRE aparece en un enunciado formulado convencionalmente).
assert.equal(
  detectAnswerLeak({
    format: 'true_false',
    questionText: '¿Verdadero o falso? El carbono puede formar cuatro enlaces.',
    correctAnswer: true,
  }).leaked,
  false,
  'BUG DE ORIGEN SI FALLA: la fraseología convencional "¿Verdadero o falso?" no debe marcarse como leak',
)

// ═══ B3. Bounded recovery — round cap + nextRecoveryItem no reofrece agotados ═══
const question = (id: string): CanonicalQuestion => ({
  id, conceptId: 'c1', conceptLabel: 'Concepto', teachingBlockId: 'step_1',
  questionFamily: 'source', variant: 'mcq_best_answer', format: 'multiple_choice',
  difficulty: 'medium', targetDimension: 'comprehension', questionText: 'Pregunta fuente',
  options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctAnswer: 'a',
  explanation: 'Explicación', hint: 'Pista', estimatedSeconds: 20,
  evidencesNeeded: 1, factKey: 'fact-1', factKeys: ['fact-1'],
  targetObjectiveIds: ['objective-1'], coveredStepIds: ['step_1'], coveredKeyPoints: ['Punto'],
} as CanonicalQuestion)

let queueItem = createRecoveryQueue([{
  question: question('source'), answer: 'b',
  result: { outcome: 'incorrect', correct: false, errorType: 'conceptual' },
}])[0]
for (let round = 1; round <= MAX_RECOVERY_ROUNDS; round++) {
  queueItem = beginRecoveryReteach(queueItem, `strategy-${round}`)
  // beginRecoveryReteach deja status='reteaching'; simular el ciclo real
  // (recordRecoveryReteachContent → beginRecoveryVerification → check
  // fallido) sin ejecutar el flujo completo — solo se necesita volver a
  // 'pending_reteach' para poder iniciar la siguiente ronda.
  queueItem = { ...queueItem, status: 'pending_reteach' }
}
// Ronda MAX_RECOVERY_ROUNDS+1: debe agotarse.
const exhausted = beginRecoveryReteach(queueItem, 'strategy-exhausted')
assert.equal(exhausted.status, 'unresolved')

// Revisión final Codex, P1 hallazgo #3 (causa raíz): nextRecoveryItem()
// gobierna TODO el flujo (page.tsx la usa en ~8 sitios) — antes seguía
// devolviendo un item 'unresolved' como "el siguiente a intentar"
// indefinidamente, reenviando al estudiante a un loop sin salida real,
// pese a que beginRecoveryReteach() nunca produce una ronda nueva para un
// item ya agotado.
assert.equal(
  nextRecoveryItem([exhausted]),
  null,
  'BUG DE ORIGEN SI FALLA: nextRecoveryItem() no debe reofrecer un item unresolved como el siguiente a intentar — genera un loop sin salida',
)

// ═══ C2. ALAI hidden through feedback while block/recovery still active ═══
const pageSource = readFileSync('app/materias/[temaId]/sesion/[sessionNumber]/page.tsx', 'utf8')
assert.match(
  pageSource,
  /if \(sessionPhase === "feedback" && Boolean\(currentQuestion\)\) \{\s*if \(pendingQuestions\.length > 0\) return true/,
  'BUG DE ORIGEN SI FALLA: isIndependentEvaluationActive debe seguir ocultando ALAI durante feedback si quedan más preguntas en el bloque',
)
assert.match(
  pageSource,
  /if \(activeRecoveryId\) \{\s*const recoveryItem = recoveryQueueRef\.current\.find\(item => item\.recoveryId === activeRecoveryId\)\s*if \(recoveryItem && recoveryItem\.status !== "resolved"\) return true/,
  'BUG DE ORIGEN SI FALLA: isIndependentEvaluationActive debe seguir ocultando ALAI durante feedback de recovery si la recovery no está resuelta',
)

console.log('real-session-quality-contracts: PASS (visual coverage batching, transient retry, numeric_problem/matching order, recovery dimension drift guard + no self-authorization + no generic-word leak-through, answer leak guard sin falso positivo true_false, bounded recovery + nextRecoveryItem no reofrece agotados, ALAI oculto durante feedback de bloque/recovery activos)')
