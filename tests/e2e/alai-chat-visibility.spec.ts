import { expect, test, type Page } from '@playwright/test'
import { buildAssessmentBlueprint } from '../../lib/adaptive/evaluation/assessmentBlueprint'

// OBJETIVO A (post-319a5bc): "Preguntar a ALAI" no debe EXISTIR en el DOM
// (nunca solo oculto/deshabilitado visualmente) durante ninguna actividad
// cuyo estado pedagógico sea evaluación o reevaluación independiente. Fuente
// única de verdad usada en page.tsx: isIndependentEvaluationActive() —
// sessionPhase === 'evaluating' && hay pregunta activa. Es la MISMA
// condición que ya decidía si un mensaje de chat cuenta como asistencia
// (Finding 1), no una heurística nueva de texto/título.
//
// Este test recorre una única sesión real de punta a punta y verifica, en
// cada punto, presencia (toBeVisible) o AUSENCIA TOTAL (toHaveCount(0), no
// "not.toBeVisible()" — el requisito es "no renderizado", no "oculto") del
// botón flotante y del diálogo:
//
//   1. hidden durante evaluation      (pregunta normal activa)
//   2. hidden durante reevaluation    (verificación de recovery activa)
//   3. visible durante teaching
//   4. hidden durante feedback SI el bloque evaluativo sigue activo (misión
//      REAL-SESSION QUALITY, C2 CONFIRMADO P1: la evidencia de ESA pregunta
//      ya quedó capturada de forma síncrona antes de esta fase — eso sigue
//      siendo cierto — pero el riesgo real no es alterar retroactivamente
//      esa evidencia, es que el estudiante use el chat en esta pantalla
//      para obtener ayuda sobre el MISMO concepto justo antes de la
//      SIGUIENTE pregunta del mismo bloque. isIndependentEvaluationActive()
//      ahora cubre sessionPhase==='feedback' mientras pendingQuestions.length
//      > 0 o la recovery activa no esté resuelta — solo reaparece en el
//      feedback de la ÚLTIMA pregunta de un bloque ya completado)
//   5. visible durante recovery cuando corresponde (reteaching: la
//      explicación de recuperación — "recovery con asistencia" — el
//      estudiante aún no está respondiendo nada)
//   6. restore/refresh no puede hacerlo reaparecer incorrectamente durante
//      assessment (refresh a mitad de una pregunta de evaluación activa) —
//      cubierto aquí con refresh a mitad de una verificación de recovery
//      activa. OBSERVACIÓN NO RELACIONADA (fuera de alcance de OBJETIVO A):
//      refrescar la primera pregunta true_false de un bloque recién
//      generado, sin ninguna respuesta previa en la sesión, revierte a la
//      fase de teaching en vez de restaurar la pregunta — no investigado
//      aquí porque no involucra al chat de ALAI.

const temaId = 'e2e-alai-visibility-tema'
const sessionId = 'e2e-alai-visibility-session'
const stepId = 'node-alai-visibility'

function trueFalseQuestion(id: string, objectiveId: string, keyPoint: string) {
  return {
    id, conceptId: stepId, conceptLabel: keyPoint, teachingBlockId: stepId,
    questionFamily: id, variant: 'true_false_factual', difficulty: 'easy',
    targetDimension: 'comprehension', format: 'true_false',
    questionText: `${keyPoint} forma parte del contenido enseñado.`, options: null,
    correctAnswer: true, explanation: 'Coincide con el contenido.', hint: 'Usa el contenido visible.',
    estimatedSeconds: 15, evidencesNeeded: 1, factKey: `${stepId}:${id}`, factKeys: [`${stepId}:${id}`],
    targetObjectiveIds: [objectiveId], evidenceProduced: [objectiveId],
    coveredStepIds: [stepId], coveredKeyPoints: [keyPoint],
  }
}

// q-correct usa MCQ (en vez de true_false) porque es la forma exacta ya
// probada para "refresh a mitad de la primera pregunta de un bloque, sin
// ninguna respuesta previa" en finding1-assistance-refresh.spec.ts — evita
// depurar aquí una posible divergencia de restore no relacionada con
// OBJETIVO A.
function mcqQuestion(id: string, objectiveId: string, keyPoint: string) {
  return {
    id, conceptId: stepId, conceptLabel: keyPoint, teachingBlockId: stepId,
    questionFamily: 'mcq_best_answer', variant: 'mcq_best_answer', difficulty: 'medium',
    targetDimension: 'comprehension', questionText: `Pregunta ${id}.`,
    explanation: 'Explicación.', hint: 'Pista visible para q-correct.',
    estimatedSeconds: 30, evidencesNeeded: 1, factKey: `${stepId}:${id}`, factKeys: [`${stepId}:${id}`],
    targetObjectiveIds: [objectiveId], evidenceProduced: [objectiveId], coveredStepIds: [stepId], coveredKeyPoints: [keyPoint],
    format: 'multiple_choice', options: [{ id: 'a', text: 'Opción correcta' }, { id: 'b', text: 'Opción incorrecta' }],
    correctAnswer: 'a',
  }
}

async function installVisibilitySession(page: Page) {
  const title = 'Concepto de prueba'
  const keyPoints = [`${title}: punto 1`, `${title}: punto 2`]
  const assessment = buildAssessmentBlueprint(
    [{ id: stepId, title, content: `Contenido persistido de ${title}.`, keyPoints, factKeys: [`${stepId}:q-correct`, `${stepId}:q-fail`], importance: 0.8 }],
    'chapter-alai-visibility', 2,
  )
  const objectiveIds = assessment.objectives.map(o => o.objectiveId)
  const questions = [
    mcqQuestion('q-correct', objectiveIds[0], keyPoints[0]),
    trueFalseQuestion('q-fail', objectiveIds[1], keyPoints[1]),
  ]
  const failFactKey = `${stepId}:q-fail`
  const failObjectiveId = objectiveIds[1]

  const learning = {
    sessionId: 'chapter-alai-visibility', sessionTitle: `${title} — aprendizaje`, sessionNumber: 2,
    sessionKind: 'learning', materialType: 'general_conceptual', academicDomain: 'general_conceptual',
    sessionIntro: `Aprendizaje de ${title}.`,
    steps: [{ id: stepId, type: 'concept', title, content: `Explicación verificable de ${title}.`, keyPoints, importance: 'critical', relatedBlockIds: ['block-real'] }],
    sessionClosing: 'Integración terminada.', totalSteps: 1, assessmentBlueprint: assessment,
    evaluationBlocks: [{ id: 'block-real', afterStepId: stepId, coveredStepIds: [stepId], coveredKeyPoints: keyPoints, questions }],
    evaluationProgress: {}, recoveryQueue: [],
  }

  const counters = { reteach: 0 }
  await page.route('**/api/study-sessions**', route =>
    route.fulfill({ json: route.request().method() === 'GET' ? { success: true, sessions: [] } : { success: true } }))
  await page.route('**/api/adaptive/session-teach', route => route.fulfill({ json: { success: true, classContent: learning } }))
  await page.route('**/api/adaptive/session-check', route => {
    const body = route.request().postDataJSON()
    const correct = body.answer === body.question.correctAnswer
    return route.fulfill({ json: { success: true, result: { outcome: correct ? 'correct' : 'incorrect', correct, score: correct ? 100 : 0, feedback: correct ? 'Respuesta correcta.' : 'Respuesta incorrecta.', errorType: correct ? null : 'conceptual' } } })
  })
  await page.route('**/api/adaptive/session-chat', route => {
    const body = route.request().postDataJSON()
    return route.fulfill({ json: { success: true, reply: `ALAI responde: "${body.message}"`, references: [], usedExternalKnowledge: false } })
  })
  await page.route('**/api/adaptive/session-reteach', route => {
    counters.reteach += 1
    const body = route.request().postDataJSON()
    const round = counters.reteach
    const sourceFactKey = body.target.sourceFactKeys?.[0] || failFactKey
    const recoveryQuestion = (n: number) => ({
      id: `recovery-${round}-${n}`, conceptId: stepId, conceptLabel: keyPoints[1], teachingBlockId: stepId,
      questionFamily: `deterministic_recovery_${round}_${n}`, variant: 'mcq_best_answer', difficulty: 'easy',
      targetDimension: 'comprehension', format: 'multiple_choice',
      questionText: `Ronda ${round}: verificación ${n}.`,
      options: [{ id: 'a', text: 'Aplicación alineada' }, { id: 'b', text: 'Aplicación incompatible' }], correctAnswer: 'a',
      explanation: 'Explicación.', hint: 'Pista.',
      estimatedSeconds: 30, evidencesNeeded: 1, factKey: sourceFactKey, factKeys: body.target.sourceFactKeys || [sourceFactKey],
      targetObjectiveIds: [failObjectiveId], evidenceProduced: [failObjectiveId],
      coveredStepIds: [stepId], coveredKeyPoints: body.target.sourceKeyPoints || [keyPoints[1]],
      coveredKeyPointIds: body.target.sourceKeyPointIds,
    })
    return route.fulfill({ json: {
      success: true, recoveryId: body.recoveryId, recoveryTargetId: body.recoveryTargetId,
      roundId: body.roundId, roundNumber: round,
      explanation: `**Reexplicación ronda ${round}.**`,
      questions: [recoveryQuestion(1), recoveryQuestion(2)], target: body.target,
      provider: 'openrouter', model: 'google/gemini-2.5-flash', generationKey: body.generationKey, preparedAt: Date.now(),
    } })
  })
  await page.addInitScript(({ sessionId, temaId, learning }) => {
    const existingSessions = JSON.parse(localStorage.getItem('studyal_sessions_v4') || '{}')
    if (existingSessions[sessionId]) return
    const journey = { id: 'journey_alai_visibility_e2e', version: 4, chapters: [{ id: 'chapter-alai-visibility', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['block-real'], unitIds: ['unit-real'] }], totalChapters: 1 }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['material-alai-visibility'], primaryMaterialId: 'material-alai-visibility', materialNames: ['Concepto de prueba'],
      selectedPages: {}, adaptiveSetup: { knowledgeLevel: 'want_review', examDateType: 'just_studying', targetScore: 80, evalPreference: 'mix_everything', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: 'general', blocks: [{ id: 'block-real' }], topics: [] },
      journey, currentSessionNumber: 2, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [], sessionContent: { '2': learning }, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId, learning })
}

async function assertChatAbsent(page: Page, why: string) {
  await expect(page.getByRole('button', { name: 'Preguntar a ALAI' }), `${why}: el botón no debe existir en el DOM`).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Chat con ALAI' }), `${why}: el diálogo no debe existir en el DOM`).toHaveCount(0)
}

async function assertChatVisible(page: Page, why: string) {
  await expect(page.getByRole('button', { name: 'Preguntar a ALAI' }), `${why}: el botón debe existir y estar disponible`).toBeVisible()
}

test('Preguntar a ALAI: presente solo donde pedagógicamente corresponde, nunca en evaluación/reevaluación independiente, ni siquiera tras refresh', async ({ page }) => {
  await installVisibilitySession(page)
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 1 de 1')).toBeVisible()

  // 3. visible durante teaching
  await assertChatVisible(page, '3. teaching')

  // 1. hidden durante evaluation (pregunta normal activa)
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await expect(page.getByText('Pregunta q-correct.')).toBeVisible()
  await assertChatAbsent(page, '1. evaluation (q-correct activa)')

  // 4. hidden durante feedback: el bloque sigue activo — todavía queda
  // q-fail sin responder en este mismo bloque (misión REAL-SESSION
  // QUALITY, C2 CONFIRMADO P1).
  await page.getByRole('button', { name: 'Opción correcta' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()
  await assertChatAbsent(page, '4. feedback tras responder, con más preguntas pendientes en el bloque')

  // De vuelta a evaluation con la segunda pregunta (q-fail, se fallará
  // deliberadamente) — sigue oculto.
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await expect(page.getByText('punto 2 forma parte del contenido enseñado.')).toBeVisible()
  await assertChatAbsent(page, '1b. evaluation (q-fail activa, antes de fallar)')

  await page.getByRole('button', { name: 'Falso' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Revisar conceptos →' }).click()
  await expect(page.getByText('📖 Reexplicación')).toBeVisible()

  // 5. visible durante recovery cuando corresponde (reteaching: la
  // explicación de recuperación — "recovery con asistencia" — todavía no
  // hay ninguna pregunta de verificación activa).
  await assertChatVisible(page, '5. reteaching (explicación de recovery)')

  // 2. hidden durante reevaluation (verificación de recovery activa).
  await page.getByRole('button', { name: 'Verificar comprensión →' }).click()
  await expect(page.getByText('Ronda 1: verificación 1.')).toBeVisible()
  await assertChatAbsent(page, '2. reevaluation (verificación de recovery activa)')

  // 6. restore/refresh no puede hacerlo reaparecer incorrectamente durante
  // assessment/reevaluación — refresh a mitad de la verificación activa.
  await page.reload()
  await expect(page.getByText('Ronda 1: verificación 1.')).toBeVisible()
  await assertChatAbsent(page, '6. tras refresh, sigue en reevaluation (verificación restaurada)')
})
