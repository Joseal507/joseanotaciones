import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isAdministrativeQuery } from '../../lib/adaptive/evaluation/chatAssistanceClassifier'
import {
  beginRecoveryReteach,
  beginRecoveryVerification,
  activateRecoveryVerification,
  createRecoveryQueue,
  persistRecoveryVerificationQuestions,
  presentRecoveryVerificationQuestion,
  recordRecoveryCheck as recordRecoveryCheckRaw,
  recordRecoveryReteachContent,
  recordVerificationGenerationAttempt,
  type RecoveryFailure,
  type RecoveryItem,
} from '../../lib/adaptive/evaluation/recoveryQueue'
import { normalizeGeneratedQuestion, type CanonicalQuestion, type GenerationContext } from '../../lib/adaptive/evaluation/questionContract'

// PARTE B — chat ALAI: seguridad pedagógica y wiring de AssistanceLevel.
// Este archivo cubre los puntos 9-14 de PARTE C que no requieren navegador
// real (el flujo completo con navegador está en
// tests/e2e/alai-session-chat.spec.ts):
//   9.  abrir chat durante assessment sin preguntar no contamina evidence
//   10. pedir ayuda académica durante assessment marca assisted
//   11. assisted correct != independent evidence
//   12. assisted recovery verification no resuelve recovery
//   13. posterior independent verification sí puede resolver
//   14. chat no puede alterar targets/answer key/mastery

// ═══ isAdministrativeQuery — heurística genérica, conservadora ═══

function testAdministrativeQueriesAreRecognized() {
  assert.equal(isAdministrativeQuery('¿Cuánto falta de la sesión?'), true)
  assert.equal(isAdministrativeQuery('¿Cuántas preguntas quedan?'), true)
  assert.equal(isAdministrativeQuery('¿En qué paso voy?'), true)
  assert.equal(isAdministrativeQuery('¿Cómo cierro la sesión?'), true)
  assert.equal(isAdministrativeQuery(''), true, 'un mensaje vacío no debe marcar asistencia (no hay contenido académico que preguntar)')
}

function testAcademicQueriesAreNotAdministrative() {
  // Reproducción textual de los ejemplos reales del enunciado de la feature.
  const academicExamples = [
    '¿Por qué?',
    'No entendí esto.',
    'Explícame esta fórmula.',
    '¿De dónde sale ese número?',
    'Dame otro ejemplo.',
    '¿Cuál es la diferencia entre X e Y?',
    'Explícame lo que acabas de enseñar.',
    '¿Cómo llegaste a 4.2×10^-3?',
    '¿Qué significa Ka?',
    '¿Esto entra en el examen?',
  ]
  for (const message of academicExamples) {
    assert.equal(isAdministrativeQuery(message), false, `"${message}" es una consulta académica real, NO debe clasificarse como administrativa`)
  }
}

function testClassifierIsGenericNotDomainSpecific() {
  const source = readFileSync('lib/adaptive/evaluation/chatAssistanceClassifier.ts', 'utf8')
  assert.doesNotMatch(source, /medicina|química|ácido|matemáticas|derecho|historia/i, 'la heurística administrativa NO debe mencionar ningún dominio/materia específico')
}

// ═══ page.tsx: wiring real de currentAssistanceLevel() ═══

function testPageWiresChatAssistedRefIntoEvidenceCallSites() {
  const source = readFileSync("app/materias/[temaId]/sesion/[sessionNumber]/page.tsx", 'utf8')

  // 9/10: chatAssistedRef solo se activa dentro de handleSendChatMessage
  // (mensaje efectivamente enviado), nunca al abrir el panel — onOpen del
  // componente nunca debe tocar chatAssistedRef.
  const onOpenLine = source.match(/onOpen=\{[^}]*\}/)?.[0] || ''
  assert.doesNotMatch(onOpenLine, /chatAssistedRef/, 'abrir el panel (onOpen) no debe tocar chatAssistedRef')

  const handleSendStart = source.indexOf('async function handleSendChatMessage')
  const handleSendEnd = source.indexOf('\n  }', source.indexOf('setChatSending(false)', handleSendStart))
  const handleSendSource = source.slice(handleSendStart, handleSendEnd)
  assert.match(handleSendSource, /isQuestionActive && !isAdministrativeQuery\(text\)/, 'el marcado de asistencia debe exigir pregunta activa Y mensaje no administrativo')
  assert.match(handleSendSource, /chatAssistedRef\.current = true/, 'debe existir un punto real donde chatAssistedRef se activa')

  // 11: los 3 call sites de evidencia deben leer de currentAssistanceLevel()
  // (que combina chat + hint) — nunca un literal hardcodeado.
  assert.doesNotMatch(source, /independent:\s*!hintShownRef\.current/, 'no debe quedar ningún call site leyendo solo hintShownRef — todos deben pasar por currentAssistanceLevel()')
  assert.doesNotMatch(source, /independent:\s*true\s*[,\n]/, 'NO debe hardcodearse independent:true en ningún punto (código real, no comentarios)')
  const independentSites = [...source.matchAll(/independent:\s*currentAssistanceLevel\(\)\s*===\s*"independent"/g)]
  assert.ok(independentSites.length >= 2, `debe haber al menos 2 call sites de evidencia normal/recovery derivando de currentAssistanceLevel(): encontrados ${independentSites.length}`)
  assert.match(source, /recordRecoveryCheck\(\s*[\s\S]{0,300}currentAssistanceLevel\(\)/, 'recordRecoveryCheck debe recibir currentAssistanceLevel(), no un literal ni solo hintShownRef')

  // El reset de chatAssistedRef debe vivir en el MISMO efecto/disparador que
  // hintShownRef (por currentQuestion?.id) — la asistencia de una pregunta
  // nunca debe filtrarse a la siguiente.
  assert.match(source, /chatAssistedRef\.current = false\s*\}, \[currentQuestion\?\.id\]\)/, 'chatAssistedRef debe resetear por currentQuestion?.id, igual que hintShownRef')
}

// ═══ 12/13: recordRecoveryCheck real — assisted no resuelve, independent posterior sí ═══

const context: GenerationContext = {
  activeConceptId: 'micro-chat', activeConceptLabel: 'Concepto chat', teachingBlockId: 'step-chat',
  targetDimension: 'comprehension', questionFamily: 'mcq_best_answer',
  allowedConceptIds: ['micro-chat'], forbiddenConceptIds: [],
}

// Textos deliberadamente DISTINTOS entre sí (no un template con solo el id
// cambiando) — questionSimilarity/RECOVERY_SEMANTIC_EQUIVALENCE_THRESHOLD
// marcarían preguntas casi-idénticas como "repeatedQuestion" y las
// descontarían (counted=false), impidiendo nunca alcanzar 'resolved' sin que
// eso tenga nada que ver con assistanceLevel.
const DISTINCT_QUESTION_TEXTS = [
  'Distingue la categoría aplicable en este escenario completamente nuevo sobre el concepto.',
  'Predice el resultado de aplicar el concepto bajo condiciones diferentes a las originales.',
  'Explica por qué esta variación del concepto produce un resultado distinto al material original.',
  'Selecciona la consecuencia correcta al modificar un parámetro clave del concepto enseñado.',
]

function question(id: string, factKey = `fact:${id}`, textIndex = 0): CanonicalQuestion {
  const normalized = normalizeGeneratedQuestion({
    conceptId: 'micro-chat', conceptLabel: 'micro-chat', variant: 'mcq_best_answer',
    targetDimension: 'comprehension', difficulty: 'medium',
    questionText: DISTINCT_QUESTION_TEXTS[textIndex % DISTINCT_QUESTION_TEXTS.length],
    options: [{ id: 'yes', text: `Solución específica ${id}` }, { id: 'no', text: `Alternativa distinta ${id}` }],
    correctAnswer: 'yes', explanation: 'Explicación', hint: 'Pista', factKey,
  }, context, id)
  assert(normalized)
  return normalized
}

const failure = (q: CanonicalQuestion): RecoveryFailure => ({
  question: q, answer: 'no',
  result: { outcome: 'incorrect', correct: false, errorType: 'selection' },
})

function preparedItem(): RecoveryItem {
  const source = question('source', 'fact:source', 0)
  const item = createRecoveryQueue([failure(source)])[0]
  const reteaching = beginRecoveryReteach(item, 'contrastive_explanation')
  const explained = recordRecoveryReteachContent(reteaching, 'Explicación de recovery para el test de chat.')
  return recordVerificationGenerationAttempt(beginRecoveryVerification(explained), true)
}

function recordRecoveryCheckLikePage(
  item: RecoveryItem,
  recoveryQuestion: CanonicalQuestion,
  result: { outcome: 'correct' | 'incorrect'; correct: boolean; errorType?: string | null },
  assistanceLevel: 'independent' | 'minimal_hint' | 'assisted',
) {
  const roundId = `${item.recoveryId}:round:${item.verificationRound}`
  const alreadyPersisted = item.verificationQuestions.some(entry =>
    entry.roundId === roundId && entry.question.id === recoveryQuestion.id && entry.answeredAt === null)
  let prepared = item
  if (!alreadyPersisted) {
    if (prepared.status === 'verification_active') prepared = { ...prepared, status: 'pending_verification' }
    prepared = persistRecoveryVerificationQuestions(prepared, [recoveryQuestion], 1000 + prepared.verificationQuestions.length)
  }
  const presented = presentRecoveryVerificationQuestion(prepared, 2000 + prepared.verificationQuestions.length)
  assert(presented.question)
  return recordRecoveryCheckRaw(presented.item, recoveryQuestion, result, assistanceLevel, '')
}

function testChatAssistedRecoveryVerificationDoesNotResolve() {
  // Reproduce exactamente lo que page.tsx ahora hace cuando chatAssistedRef
  // está activo: pasa 'assisted' (vía currentAssistanceLevel()) en vez de
  // 'independent' — recordRecoveryCheck (función REAL de producción) no debe
  // contar esto como successfulIndependentChecks ni resolver la recovery.
  let item = preparedItem()
  const before = item.successfulIndependentChecks
  const outcome = recordRecoveryCheckLikePage(
    item,
    question('verify-assisted', 'fact:verify-assisted', 1),
    { outcome: 'correct', correct: true },
    'assisted',
  )
  item = outcome.item
  assert.equal(item.successfulIndependentChecks, before, 'BUG DE ORIGEN SI FALLA: una verificación correcta pero assisted (ayuda del chat) no debe incrementar successfulIndependentChecks')
  assert.notEqual(item.status, 'resolved', 'una verificación assisted nunca debe resolver la recovery por sí sola')
}

function testSubsequentIndependentVerificationCanResolve() {
  let item = preparedItem()
  assert.ok(item.requiredIndependentChecks >= 1, 'sanity: la recovery debe exigir al menos 1 verificación independiente')
  // Primer intento: assisted (ayuda de chat) — no cuenta para el requisito.
  item = recordRecoveryCheckLikePage(item, question('verify-a', 'fact:verify-a', 1), { outcome: 'correct', correct: true }, 'assisted').item
  assert.notEqual(item.status, 'resolved')
  assert.equal(item.successfulIndependentChecks, 0)
  // Reintentos posteriores SIN ayuda — currentAssistanceLevel() volvería a
  // 'independent' porque chatAssistedRef se resetea por pregunta — hasta
  // completar exactamente los independientes que la recovery real exige.
  let questionIndex = 0
  const maxAttempts = item.requiredIndependentChecks + 2
  while (item.status !== 'resolved' && questionIndex < maxAttempts) {
    item = activateRecoveryVerification(item)
    item = recordRecoveryCheckLikePage(item, question(`verify-b-${questionIndex}`, `fact:verify-b-${questionIndex}`, questionIndex + 2), { outcome: 'correct', correct: true }, 'independent').item
    questionIndex += 1
  }
  assert.equal(item.status, 'resolved', 'una secuencia de verificaciones posteriores genuinamente independientes SÍ debe poder resolver la recovery')
  assert.equal(item.successfulIndependentChecks, item.requiredIndependentChecks, 'el intento assisted anterior no debe haber contribuido a este conteo')
}

// ═══ 14: seguridad — session-chat no puede alterar targets/answer key/mastery ═══

function testSessionChatRouteHasNoWriteAccessToEvidenceOrMastery() {
  const fullSource = readFileSync('app/api/adaptive/session-chat/route.ts', 'utf8')
  // Excluye comentarios (líneas que empiezan con //) del escaneo — este mismo
  // archivo documenta EN PROSA, a propósito, qué NO debe hacer, lo que haría
  // que un grep ingenuo sobre texto crudo se autoinvalidara.
  const source = fullSource.split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
  const forbidden = [
    'recordAssessmentEvidence', 'recordRecoveryCheck', 'completeAdaptiveSession',
    'buildAssessmentBlueprint', 'persistAssessmentBlueprint', 'demonstratedFactKeys',
    'targetObjectiveIds =', 'correctAnswer =',
  ]
  for (const token of forbidden) {
    assert.doesNotMatch(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `session-chat/route.ts NUNCA debe referenciar "${token}" — es una ruta de solo lectura respecto al estado académico`)
  }
  // Confirma explícitamente que la respuesta solo devuelve texto/referencias,
  // nunca campos de autoridad de evaluación. correctAnswerDisplay/
  // studentAnswerDisplay son texto YA PRESENTADO (presentAnswer(), resuelto
  // en el cliente) para que el chat pueda explicar un error de recovery —
  // el user spec lo permite explícitamente ("puede explicar el error") — no
  // son el correctAnswer crudo de autoridad de grading, así que se excluyen
  // deliberadamente de esta comprobación.
  assert.doesNotMatch(source, /\bcorrectAnswer\b(?!Display)|targetObjectiveIds|\bfactKeys\b/, 'la respuesta de session-chat no debe incluir ningún campo de autoridad de evaluación (correctAnswer crudo, targetObjectiveIds, factKeys)')
}

testAdministrativeQueriesAreRecognized()
testAcademicQueriesAreNotAdministrative()
testClassifierIsGenericNotDomainSpecific()
testPageWiresChatAssistedRefIntoEvidenceCallSites()
testChatAssistedRecoveryVerificationDoesNotResolve()
testSubsequentIndependentVerificationCanResolve()
testSessionChatRouteHasNoWriteAccessToEvidenceOrMastery()

console.log('chat-assistance-wiring-contracts: PASS (clasificador administrativo, wiring real de currentAssistanceLevel, recovery assisted no resuelve, independiente posterior sí resuelve, session-chat sin acceso de escritura)')
