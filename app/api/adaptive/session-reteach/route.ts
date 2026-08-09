import { NextRequest, NextResponse } from 'next/server'
import { alai, safeParseJson } from '../../../../lib/alai'
import { prepareReteachContent } from '../../../../lib/adaptive/evaluation/reteachContent'
import { runGenerationPipeline, type GenerationAttemptContext } from '../../../../lib/ai/generationPipeline'
import {
  normalizeGeneratedQuestion,
  questionSimilarity,
  validateQuestion,
  type CanonicalQuestion,
  type GenerationContext,
} from '../../../../lib/adaptive/evaluation/questionContract'
import { parsePreparedRecoveryRound, type RecoveryQuestion, type RecoveryRoundTarget } from '../../../../lib/adaptive/evaluation/preparedRecoveryRound'
import {
  detectContentSignal,
  detectErrorType,
} from '../../../../lib/adaptive/evaluation/pedagogicalFormatSelector'
import {
  buildReteachStrategyInstructions,
} from '../../../../lib/adaptive/evaluation/recoveryStrategyEngine'
import {
  createDeterministicRecoveryFallback,
  validateDeterministicRecoveryFallback,
} from '../../../../lib/adaptive/evaluation/recoveryFallback'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const reteachResponse = (
  reteachContent: string,
  recoveryStatus: string,
  remainingChecks: number,
  recoveryId?: string,
) => ({
  success: true,
  reteachContent,
  nextAction: 'generate_verification',
  recoveryStatus,
  remainingChecks,
  ...(recoveryId ? { recoveryId } : {}),
})

export async function POST(req: NextRequest) {
  let requestRecoveryId: string | undefined
  try {
    const body = await req.json()
    const {
      objective,
      studentAnswer,
      correctAnswer,
      correctAnswerDisplay,
      studentAnswerDisplay,
      questionText,
      materialTitle,
      sessionTitle,
      feedback,
      allStepsContent,
      recoveryStrategy,
      reteachAttempt,
      recoveryStatus,
      remainingChecks,
      latestErrorType,
      latestFactKeys,
      latestAssistanceLevel,
      previousReteachFingerprints,
      evaluationMode,
      recoveryId,
      includeVerificationQuestions,
      sourceQuestion,
      failedKeyPoints,
      recoveryRound,
      previousQuestions,
    } = body
    requestRecoveryId = typeof recoveryId === 'string' ? recoveryId : undefined

    const teachingContent = objective?.teachingContent
      || (Array.isArray(allStepsContent) ? allStepsContent.map((s: any) => `${s.title}:\n${s.content}`).join('\n\n') : '')

    if (!teachingContent || teachingContent.trim().length < 20) {
      return NextResponse.json({
        success: false,
        error: 'INSUFFICIENT_SOURCE_MATERIAL',
        retryable: true,
        recoveryStatus: 'reteaching',
        recoveryId: requestRecoveryId,
      }, { status: 422 })
    }

    if (includeVerificationQuestions === true && sourceQuestion && typeof sourceQuestion === 'object') {
      const exactKeyPoints = Array.isArray(failedKeyPoints)
        ? failedKeyPoints.map(String).filter(Boolean)
        : Array.isArray(sourceQuestion.factKeys) ? sourceQuestion.factKeys.map(String).filter(Boolean) : []
      const recoveryConceptId = String(sourceQuestion.conceptId || objective?.stepTitle || 'recovery')
      const context: GenerationContext = {
        activeConceptId: recoveryConceptId,
        activeConceptLabel: String(sourceQuestion.conceptLabel || objective?.conceptLabel || objective?.stepTitle || 'Concepto'),
        teachingBlockId: String(sourceQuestion.teachingBlockId || objective?.stepId || 'recovery_step'),
        targetDimension: sourceQuestion.targetDimension || 'comprehension',
        questionFamily: 'recovery_round',
        allowedConceptIds: [
          recoveryConceptId,
          String(sourceQuestion.conceptLabel || '').toLowerCase().replace(/\s+/g, '_'),
          String(objective?.stepTitle || '').toLowerCase().replace(/\s+/g, '_'),
          'recovery',
          'step',
        ].filter(Boolean),
        forbiddenConceptIds: [],
        evaluationMode,
        factKeys: exactKeyPoints,
      }
      const prior = Array.isArray(previousQuestions) ? previousQuestions as CanonicalQuestion[] : []

      // ── Estrategia pedagógica para el recovery round ──────────
      const roundContentSignal = detectContentSignal(teachingContent)
      const roundErrorType = detectErrorType({
        questionFormat: typeof sourceQuestion?.format === 'string' ? sourceQuestion.format : 'multiple_choice',
        contentSignal: roundContentSignal,
        cognitiveLevel: (sourceQuestion?.targetDimension || 'comprehension') as any,
        consecutiveFailures: Math.max(0, Number(recoveryRound || 1) - 1),
      })
      const roundStrategyInstructions = buildReteachStrategyInstructions({
        errorType: roundErrorType,
        contentSignal: roundContentSignal,
        studentAnswerSummary: typeof studentAnswerDisplay === 'string' ? studentAnswerDisplay : JSON.stringify(studentAnswer || ''),
        correctAnswerSummary: typeof correctAnswerDisplay === 'string' ? correctAnswerDisplay : JSON.stringify(correctAnswer || ''),
        consecutiveFailures: Math.max(0, Number(recoveryRound || 1) - 1),
      })

      const priorQuestionsSummary = prior.length > 0
        ? prior.map(q => `- [${q.format}] ${q.questionText}`).join('\n')
        : 'Ninguna — esta es la primera ronda.'

      const originalFormat = String(sourceQuestion?.format || 'multiple_choice')
      const formatPriority: Record<string, string[]> = {
        multiple_choice: ['true_false', 'matching', 'scenario'],
        true_false: ['multiple_choice', 'matching', 'scenario'],
        scenario: ['multiple_choice', 'true_false', 'matching'],
        matching: ['multiple_choice', 'true_false', 'scenario'],
        ordering: ['multiple_choice', 'true_false', 'matching'],
        word_bank: ['multiple_choice', 'true_false', 'matching'],
        multi_select: ['multiple_choice', 'true_false', 'scenario'],
        find_the_error: ['multiple_choice', 'true_false', 'matching'],
        classify: ['multiple_choice', 'true_false', 'ordering'],
      }
      const preferredFormats = (formatPriority[originalFormat] || ['true_false', 'matching'])
      const format1 = preferredFormats[0] || 'true_false'
      const format2 = preferredFormats[1] || 'multiple_choice'

      const formatTemplates: Record<string, string> = {
        multiple_choice: `{
  "variant": "mcq_best_answer",
  "questionText": "pregunta que requiere comprensión real del concepto",
  "options": [{"id":"a","text":"opción A"},{"id":"b","text":"opción B"},{"id":"c","text":"opción C"},{"id":"d","text":"opción D"}],
  "correctAnswer": "b",
  "explanation": "por qué la respuesta es correcta, usando el contenido enseñado",
  "hint": "pista sin dar la respuesta directamente"
}
REGLA: options SIEMPRE tiene exactamente 4 elementos con ids a,b,c,d. correctAnswer es uno de esos ids.`,

        true_false: `{
  "variant": "true_false_factual",
  "questionText": "afirmación específica sobre el concepto — verdadera o falsa",
  "options": null,
  "correctAnswer": true,
  "explanation": "por qué es verdadera o falsa, conectando con el error",
  "hint": "pista breve"
}
REGLA: options SIEMPRE es null. correctAnswer SIEMPRE es boolean (true o false, sin comillas).`,

        matching: `{
  "variant": "matching_concept_def",
  "matchingSemantics": "bijective",
  "questionText": "Empareja cada concepto con su descripción correcta",
  "options": [
    {"id":"p1","left":"Término A","rightId":"r1","right":"Descripción de A"},
    {"id":"p2","left":"Término B","rightId":"r2","right":"Descripción de B"},
    {"id":"p3","left":"Término C","rightId":"r3","right":"Descripción de C"}
  ],
  "correctAnswer": {"p1":"r1","p2":"r2","p3":"r3"},
  "explanation": "por qué cada par es correcto",
  "hint": "pista breve"
}
REGLA: cada par tiene id único, left único, rightId único, right único. correctAnswer mapea id→rightId exactamente.`,

        scenario: `{
  "variant": "scenario_choose_action",
  "questionText": "Situación concreta: [describe un caso real del concepto]. ¿Qué ocurre o qué harías?",
  "options": [{"id":"a","text":"opción A"},{"id":"b","text":"opción B"},{"id":"c","text":"opción C"},{"id":"d","text":"opción D"}],
  "correctAnswer": "a",
  "explanation": "por qué esta opción es correcta según el concepto enseñado",
  "hint": "pista sin revelar la respuesta"
}
REGLA: 4 opciones siempre. El escenario debe ser resoluble solo con el concepto enseñado.`,

        ordering: `{
  "variant": "ordering_steps",
  "questionText": "Ordena estos elementos en el orden correcto",
  "options": [{"id":"s1","text":"elemento 1"},{"id":"s2","text":"elemento 2"},{"id":"s3","text":"elemento 3"}],
  "correctAnswer": ["s2","s1","s3"],
  "explanation": "por qué este orden es correcto",
  "hint": "pista breve"
}
REGLA: correctAnswer es array de ids en el orden correcto. Los ids deben coincidir exactamente con los de options.`,
      }

      const template1 = formatTemplates[format1] || formatTemplates['true_false']
      const template2 = formatTemplates[format2] || formatTemplates['multiple_choice']

      const combinedPrompt = `Eres un evaluador pedagógico experto. Genera EXACTAMENTE 2 preguntas de verificación para una ronda de recuperación.

════ CONTEXTO ════
CONCEPTO: ${String(sourceQuestion.conceptLabel || '')}
RONDA DE RECUPERACIÓN: ${Number(recoveryRound || 1)}
MODO: ${String(evaluationMode || 'mix_everything')}

════ CONTENIDO ENSEÑADO ════
${teachingContent}

════ QUÉ FALLÓ ════
Pregunta original [${originalFormat}]: ${String(sourceQuestion.questionText || questionText || '')}
Respuesta del estudiante: ${String(studentAnswerDisplay || studentAnswer || '')}
Respuesta correcta: ${String(correctAnswerDisplay || correctAnswer || '')}
Explicación del error: ${String(sourceQuestion.explanation || feedback || '')}

════ PUNTOS QUE DEBEN EVALUARSE ════
${exactKeyPoints.map((point: string) => `- ${point}`).join('\n')}

════ PREGUNTAS YA HECHAS — ABSOLUTAMENTE PROHIBIDO REPETIR ════
${priorQuestionsSummary}

${roundStrategyInstructions}

════ INSTRUCCIÓN ════
Genera 2 preguntas que evalúen el concepto "${String(sourceQuestion.conceptLabel || '')}" desde ángulos distintos.
Ambas deben ser completamente diferentes a las preguntas ya hechas listadas arriba.

PREGUNTA 1 — formato ${format1.toUpperCase()}:
${template1}

PREGUNTA 2 — formato ${format2.toUpperCase()}:
${template2}

CAMPOS OBLIGATORIOS EN CADA PREGUNTA:
- variant: string (el identificador del formato)
- targetDimension: "${context.targetDimension}"
- difficulty: "medium"
- questionText: string (la pregunta completa)
- options: según el formato (ver template)
- correctAnswer: según el formato (ver template)
- explanation: string (por qué es correcta, usando el contenido)
- hint: string (pista sin revelar la respuesta)
- coveredKeyPoints: ${JSON.stringify(exactKeyPoints)}

PROHIBIDO:
- Repetir cualquier pregunta ya hecha
- Mencionar "Paso 1", "Step 2" o números de paso
- Mezclar formatos (si es true_false, options debe ser null)
- Preguntar sobre conceptos distintos al señalado

Devuelve SOLO JSON sin markdown ni fences:
{
  "explanation": "reexplicación directa del error en máximo 3 oraciones",
  "questions": [ { pregunta 1 }, { pregunta 2 } ]
}`

      const roundNumber = Math.max(1, Number(recoveryRound || 1))
      const recoveryTargetId = String(body.recoveryTargetId || requestRecoveryId || '')
      const roundId = String(body.roundId || `${requestRecoveryId}:round:${roundNumber}`)
      const generationKey = String(body.generationKey || `${recoveryTargetId}:${roundId}`)
      const requestedTarget = body.target && typeof body.target === 'object' ? body.target : {}
      const target: RecoveryRoundTarget = {
        sourceQuestionId: String(requestedTarget.sourceQuestionId || sourceQuestion.id || ''),
        sourceStepIds: Array.isArray(requestedTarget.sourceStepIds) ? requestedTarget.sourceStepIds.map(String) : Array.isArray(sourceQuestion.coveredStepIds) ? sourceQuestion.coveredStepIds.map(String) : [context.teachingBlockId],
        sourceKeyPointIds: Array.isArray(requestedTarget.sourceKeyPointIds) ? requestedTarget.sourceKeyPointIds.map(String) : Array.isArray(sourceQuestion.coveredKeyPointIds) ? sourceQuestion.coveredKeyPointIds.map(String) : [],
        sourceFactKeys: Array.isArray(requestedTarget.sourceFactKeys) ? requestedTarget.sourceFactKeys.map(String) : Array.isArray(sourceQuestion.factKeys) ? sourceQuestion.factKeys.map(String) : [sourceQuestion.factKey].filter(Boolean),
        microId: String(requestedTarget.microId || sourceQuestion.conceptId || ''),
        cognitiveTarget: String(requestedTarget.cognitiveTarget || sourceQuestion.targetDimension || 'comprehension'),
      }
      const sourceKeyPointTexts = Array.isArray(sourceQuestion.coveredKeyPoints) ? sourceQuestion.coveredKeyPoints.map(String) : exactKeyPoints

      type Candidate = { explanation: string; questions: RecoveryQuestion[]; provider: string; model: string; raw: string; validationErrors: string[] }

      const buildCandidate = (parsed: unknown, provider: string, model: string, raw: string, offset = 0): Candidate => {
        const object = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
        const explanation = String(object.explanation || object.reteachContent || '')
        const rawQuestions = Array.isArray(object.questions) ? object.questions : []
        const normalizedQuestions = rawQuestions.map((rawQuestion, index) => {
          const normalized = normalizeGeneratedQuestion(rawQuestion, context, `${requestRecoveryId}:round:${roundNumber}:q${offset + index + 1}`)
          if (!normalized) return null
          // Este endpoint no le pide al modelo que declare conceptId/factKeys de vuelta
          // (se le entregan como dato fijo a copiar), así que no hay señal cruda que
          // contrastar para esos campos. targetDimension SÍ es una señal real: si el
          // modelo escribe un nivel cognitivo válido distinto del instruido,
          // normalizeGeneratedQuestion lo conserva tal cual (no lo corrige) — es la única
          // contradicción detectable de forma determinista en este punto. Debe comprobarse
          // ANTES de sobrescribirlo con el valor canónico más abajo.
          if (normalized.targetDimension !== target.cognitiveTarget) {
            console.warn('[adaptive-recovery]', JSON.stringify({
              event: 'recovery_target_drift_detected',
              stage: 'session_reteach_normalize',
              recoveryId: requestRecoveryId, recoveryTargetId, roundId,
              generatedTargetDimension: normalized.targetDimension,
              expectedCognitiveTarget: target.cognitiveTarget,
            }))
            return null
          }
          return {
            ...normalized,
            conceptId: target.microId,
            targetDimension: target.cognitiveTarget as CanonicalQuestion['targetDimension'],
            factKey: target.sourceFactKeys[0] || normalized.factKey,
            factKeys: target.sourceFactKeys,
            coveredStepIds: target.sourceStepIds,
            coveredKeyPointIds: target.sourceKeyPointIds,
            coveredKeyPoints: sourceKeyPointTexts,
          } as RecoveryQuestion
        }).filter((q): q is RecoveryQuestion => Boolean(q))

        const validationErrors: string[] = []
        const prepared = prepareReteachContent(explanation, '')
        if (prepared.usedFallback || !prepared.content.trim()) validationErrors.push('INVALID_ACADEMIC_FRAGMENT:explanation')
        const questions = normalizedQuestions.filter((question, index) => {
          const validation = validateQuestion(question, context, prior)
          validationErrors.push(...validation.errors.map(error => `question_${index + 1}:${error}`))
          return validation.valid
        })
        if (questions.length !== 2) validationErrors.push(`MISSING_ITEMS:expected_2_received_${questions.length}`)
        if (questions.length === 2 && questionSimilarity(questions[0], questions[1]) >= 0.95) validationErrors.push('SEMANTIC_DUPLICATION')
        return { explanation: prepared.content || explanation, questions, provider, model, raw, validationErrors: [...new Set(validationErrors)] }
      }

      const call = async (stage: 'normal' | 'targeted_repair', content: string) => {
        const started = Date.now()
        const result = await alai({
          messages: [{ role: 'user', content }],
          temperature: stage === 'normal' ? 0.4 : 0.7,
          maxTokens: 1600,
          json: true,
          taskType: 'recovery_question',
          stage,
        })
        const parsed = safeParseJson(result.text)
        console.info('[adaptive-recovery]', JSON.stringify({
          event: 'recovery_round_response_received',
          recoveryId: requestRecoveryId, recoveryTargetId, roundId, roundNumber,
          sourceQuestionId: target.sourceQuestionId, generationKey,
          provider: result.provider, model: result.model,
          durationMs: Date.now() - started,
          jsonParsed: Boolean(parsed),
        }))
        return buildCandidate(parsed, result.provider, result.model, result.text)
      }

      let candidate = await call('normal', combinedPrompt.replace(/"reteachContent"/g, '"explanation"'))
      if (candidate.validationErrors.length) {
        console.warn('[adaptive-recovery]', JSON.stringify({
          event: 'recovery_round_response_invalid',
          recoveryId: requestRecoveryId, recoveryTargetId, roundId, roundNumber, generationKey,
          validationErrors: candidate.validationErrors,
          acceptedExplanation: Boolean(candidate.explanation),
          acceptedQuestionCount: candidate.questions.length,
        }))
        const acceptedExplanation = candidate.explanation
        const acceptedQuestions = candidate.questions.slice(0, 1)
        const missing = 2 - acceptedQuestions.length
        const repairPrompt = acceptedExplanation && acceptedQuestions.length === 1
          ? `Genera SOLO la segunda pregunta faltante para esta recuperación. Devuelve JSON sin markdown y sin explanation, exactamente con este shape: {"questions":[{"variant":"true_false_factual","difficulty":"medium","targetDimension":"${target.cognitiveTarget}","questionText":"afirmación clara","correctAnswer":false,"explanation":"feedback específico","hint":"pista breve","factKey":"${target.sourceFactKeys[0]}","factKeys":${JSON.stringify(target.sourceFactKeys)}}]}. Usa exactamente el mismo conocimiento. Debe ser cerrada y distinta de la original y de la aceptada.\nPREGUNTA ORIGINAL=${String(sourceQuestion.questionText || '')}\nPREGUNTA ACEPTADA=${JSON.stringify(acceptedQuestions[0])}\nERRORES=${JSON.stringify(candidate.validationErrors)}\nCONTENIDO=${teachingContent}`
          : `Repara la ronda completa y devuelve SOLO {"explanation":"...","questions":[... exactamente 2]}. Cada pregunta requiere variant,difficulty,targetDimension,questionText,options cuando aplique,correctAnswer,explanation,hint,factKey,factKeys.\nTARGET=${JSON.stringify(target)}\nERRORES=${JSON.stringify(candidate.validationErrors)}\n${combinedPrompt}`
        const repaired = await call('targeted_repair', repairPrompt)
        candidate = acceptedExplanation && acceptedQuestions.length === 1
          ? { ...repaired, explanation: acceptedExplanation, questions: [...acceptedQuestions, ...repaired.questions.slice(0, missing)] }
          : { ...repaired }
        candidate = buildCandidate({ explanation: candidate.explanation, questions: candidate.questions }, candidate.provider, candidate.model, candidate.raw)
      }

      const payload = {
        success: true,
        recoveryId: String(requestRecoveryId || ''),
        recoveryTargetId, roundId, roundNumber,
        explanation: candidate.explanation,
        questions: candidate.questions,
        target,
        provider: candidate.provider,
        model: candidate.model,
        generationKey,
        preparedAt: Date.now(),
      }
      const canonical = parsePreparedRecoveryRound(payload)
      if (canonical.success === false) {
        // ── Fallback determinístico ───────────────────────────────────
        // El LLM falló tras normal + repair. Activar generador local
        // que nunca falla y siempre produce 2 preguntas válidas.
        console.warn('[adaptive-recovery]', JSON.stringify({
          event: 'recovery_round_deterministic_fallback_activated',
          errorCode: canonical.errorCode,
          validationErrors: [...candidate.validationErrors, ...canonical.validationErrors],
          recoveryId: requestRecoveryId, recoveryTargetId, roundId, roundNumber,
          reason: 'llm_budget_exhausted',
        }))
        try {
          const fallbackQuestions = createDeterministicRecoveryFallback({
            sourceQuestion: sourceQuestion as CanonicalQuestion,
            studentAnswer: body.studentAnswer,
            evaluationMode: body.evaluationMode || 'mix_everything',
            roundNumber,
            teachingContent,
          })
          // Adaptar al formato RecoveryQuestion con los campos de target
          const fallbackRecoveryQuestions = fallbackQuestions.map(q => ({
            ...q,
            conceptId: target.microId || q.conceptId,
            targetDimension: (target.cognitiveTarget || q.targetDimension) as CanonicalQuestion['targetDimension'],
            factKey: target.sourceFactKeys[0] || q.factKey,
            factKeys: target.sourceFactKeys.length ? target.sourceFactKeys : q.factKeys || [],
            coveredStepIds: target.sourceStepIds,
            coveredKeyPointIds: target.sourceKeyPointIds,
            coveredKeyPoints: sourceKeyPointTexts,
          })) as RecoveryQuestion[]

          const fallbackExplanation = candidate.explanation || sourceQuestion.explanation || teachingContent.slice(0, 400)
          const fallbackPayload = {
            success: true,
            recoveryId: String(requestRecoveryId || ''),
            recoveryTargetId, roundId, roundNumber,
            explanation: fallbackExplanation,
            questions: fallbackRecoveryQuestions,
            target,
            provider: 'deterministic_fallback',
            model: 'local',
            generationKey,
            preparedAt: Date.now(),
          }
          const fallbackCanonical = parsePreparedRecoveryRound(fallbackPayload)
          if (fallbackCanonical.success) {
            console.info('[adaptive-recovery]', JSON.stringify({
              event: 'recovery_round_deterministic_fallback_succeeded',
              recoveryId: requestRecoveryId, recoveryTargetId, roundId, roundNumber,
              questionCount: fallbackRecoveryQuestions.length,
            }))
            return NextResponse.json(fallbackCanonical.value)
          }
          const fallbackValidationErrors = fallbackCanonical.success === false ? fallbackCanonical.validationErrors : []
          console.error('[adaptive-recovery]', JSON.stringify({
            event: 'recovery_round_deterministic_fallback_failed',
            validationErrors: fallbackValidationErrors,
            recoveryId: requestRecoveryId,
          }))
        } catch (fallbackError) {
          console.error('[adaptive-recovery]', JSON.stringify({
            event: 'recovery_round_deterministic_fallback_threw',
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            recoveryId: requestRecoveryId,
          }))
        }
        // Si el fallback también falla (no debería), devolver 503 con partial
        const canonicalErrors = canonical.success === false ? canonical.validationErrors : []
        return NextResponse.json({
          success: false,
          errorCode: canonical.success === false ? canonical.errorCode : 'RECOVERY_ROUND_RESPONSE_INVALID',
          validationErrors: [...new Set([...candidate.validationErrors, ...canonicalErrors])],
          recoveryId: requestRecoveryId, recoveryTargetId, roundId, roundNumber, generationKey,
          retryable: true, technicalStatus: 'technical_retry_required',
          partial: canonical.success === false ? canonical.partial : undefined,
        }, { status: 503 })
      }
      console.info('[adaptive-recovery]', JSON.stringify({
        event: 'recovery_round_generation_ready',
        recoveryId: requestRecoveryId, recoveryTargetId, roundId, roundNumber,
        sourceQuestionId: target.sourceQuestionId, generationKey,
        questionCount: 2,
      }))
      return NextResponse.json(canonical.value)
    }

    // ── Reteach simple (sin verification questions) ───────────────

    const correctDisplay = typeof correctAnswerDisplay === 'string' && correctAnswerDisplay.trim()
      ? correctAnswerDisplay
      : typeof correctAnswer === 'boolean'
        ? (correctAnswer ? 'Verdadero' : 'Falso')
        : typeof correctAnswer === 'string'
          ? correctAnswer
          : Array.isArray(correctAnswer)
            ? correctAnswer.join(', ')
            : JSON.stringify(correctAnswer)

    const studentDisplay = typeof studentAnswerDisplay === 'string' && studentAnswerDisplay.trim()
      ? studentAnswerDisplay
      : typeof studentAnswer === 'boolean'
        ? (studentAnswer ? 'Verdadero' : 'Falso')
        : typeof studentAnswer === 'string'
          ? studentAnswer
          : Array.isArray(studentAnswer)
            ? studentAnswer.join(', ')
            : JSON.stringify(studentAnswer)

    // ── Detección pedagógica de señal y tipo de error ──────────
    const contentSignal = detectContentSignal(teachingContent)
    const cognitiveLevel = (
      typeof sourceQuestion?.targetDimension === 'string'
        ? sourceQuestion.targetDimension
        : typeof objective?.cognitiveLevel === 'string'
          ? objective.cognitiveLevel
          : 'comprehension'
    ) as import('../../../../lib/adaptive/evaluation/pedagogicalFormatSelector').CognitiveLevel

    const errorType = detectErrorType({
      questionFormat: typeof sourceQuestion?.format === 'string' ? sourceQuestion.format : 'multiple_choice',
      contentSignal,
      cognitiveLevel,
      consecutiveFailures: typeof reteachAttempt === 'number' ? Math.max(0, reteachAttempt - 1) : 0,
    })

    const strategyInstructions = buildReteachStrategyInstructions({
      errorType,
      contentSignal,
      studentAnswerSummary: studentDisplay,
      correctAnswerSummary: correctDisplay,
      consecutiveFailures: typeof reteachAttempt === 'number' ? Math.max(0, reteachAttempt - 1) : 0,
    })

    // Detectar si el error fue de tipo procedimental/matemático
    const isProceduralError = (() => {
      const qt = (questionText || '').toLowerCase()
      const tc = (teachingContent || '').toLowerCase()
      const keywords = [
        'calcula', 'calcul', 'resuelve', 'halla', 'determina',
        'n=', 'energía', 'fórmula', 'formula', 'ecuación', 'equation',
        'n^2', '13.6', 'ev', 'solve', 'compute', 'nivel',
      ]
      return keywords.some(k => qt.includes(k) || tc.includes(k))
    })()

    const proceduralSteps = isProceduralError
      ? `3. **Ejemplo resuelto paso a paso** — Resuelve un ejemplo NUMÉRICAMENTE DIFERENTE al de la pregunta fallada. Muestra cada paso numerado con el resultado intermedio. Usa LaTeX correcto ($...$ o $$...$$).
4. **Ahora aplícalo** — Conecta el ejemplo resuelto con la respuesta correcta "${correctDisplay}" y explica exactamente qué paso se omitió o aplicó mal.`
      : `3. **Ejemplo nuevo** — Da un ejemplo específico y concreto (diferente al del material original) que demuestre el concepto correctamente.
4. **La respuesta correcta explicada** — Conecta todo con la respuesta correcta y explica POR QUÉ es correcta.`

    const prompt = `Eres un tutor personal experto en ${materialTitle || 'esta materia'}. El estudiante FALLÓ una pregunta y necesitas reenseñarle el concepto.

SESIÓN: "${sessionTitle || ''}"
CONCEPTO FALLADO: ${objective?.conceptLabel || objective?.stepTitle || 'ver abajo'}
ESTRATEGIA DE RECUPERACIÓN: ${typeof recoveryStrategy === 'string' ? recoveryStrategy : 'alternative_explanation'}
INTENTO DE REENSEÑANZA: ${typeof reteachAttempt === 'number' ? reteachAttempt : 1}
TIPO DEL FALLO MÁS RECIENTE: ${typeof latestErrorType === 'string' ? latestErrorType : 'no_clasificado'}
EVIDENCIA OBJETIVO MÁS RECIENTE: ${Array.isArray(latestFactKeys) ? latestFactKeys.join(', ') : 'no_especificada'}
NIVEL DE AYUDA EN EL FALLO: ${typeof latestAssistanceLevel === 'string' ? latestAssistanceLevel : 'independent'}
MODO DE EVALUACIÓN: ${typeof evaluationMode === 'string' ? evaluationMode : 'mix_everything'}
EVITA REPETIR ESTAS EXPLICACIONES PREVIAS:
${Array.isArray(previousReteachFingerprints) ? previousReteachFingerprints.join('\n---\n') : 'No hay explicaciones previas.'}

════ CONTENIDO QUE SE ENSEÑÓ ════
${teachingContent}
${objective?.keyPoint ? '\nIDEA CLAVE: ' + objective.keyPoint : ''}

════ LO QUE PASÓ ════
Pregunta: ${questionText || ''}
El estudiante respondió: ${studentDisplay}
La respuesta correcta era: ${correctDisplay}
${feedback ? 'Feedback previo: ' + feedback : ''}

${strategyInstructions}

════ TU TAREA ════
Escribe una reexplicación clara y pedagógica usando la estrategia indicada arriba. Sigue esta estructura:

1. **Tu error específico** — Explica qué razonamiento fallido llevó a la respuesta "${studentDisplay}" en lugar de la correcta.
2. **El concepto desde otro ángulo** — Reexplica usando la estrategia pedagógica indicada (máximo 3 oraciones).
${proceduralSteps}

REGLAS:
- Segunda persona singular (tú)
- Directo y claro, sin rodeos
- Usa **negrita** para resaltar ideas clave
- Longitud proporcional al error: si el error fue una palabra o detalle menor, máximo 120 palabras. Si fue conceptual, máximo 250 palabras.
- NO copies el texto original textualmente
- NO uses bullet points genéricos — escribe en párrafos fluidos
- Escribe SOLO el texto de reenseñanza (sin JSON, sin comillas, sin títulos de sección)
- Si hay fórmulas: usa SIEMPRE \\frac{}{}, NUNCA \\rac. Todos los símbolos dentro de $...$ o $$...$$.

REGLA CRÍTICA DE FIDELIDAD AL ERROR:
- SOLO reenseña lo que el estudiante falló.
- Si falló una propiedad concreta, reenseña SOLO eso. No reexpliques toda la clase.
- Si falló una fórmula, reenseña SOLO esa fórmula con un ejemplo nuevo.
- Ataca el error ESPECÍFICO: por qué su respuesta fue incorrecta y por qué la correcta es correcta.
- PROHIBIDO reexplicar conceptos que el estudiante ya demostró dominar.

Si el contenido tiene fórmulas matemáticas, úsalas correctamente en LaTeX con $...$ para inline y $$...$$ para display.`

    const stageInstruction = (context: GenerationAttemptContext): string => {
      const failures = context.validationErrors.map(error => `- ${error}`).join('\n')
      if (context.stage === 'format_repair') return `Repara únicamente formato y delimitadores. Errores:\n${failures}`
      if (context.stage === 'targeted_repair') return `La explicación anterior fue rechazada. Usa otra estrategia pedagógica y evita literalmente las explicaciones previas. Errores:\n${failures}`
      if (context.stage === 'simplified') return 'Simplifica: explica el error actual en dos párrafos breves, con un contraste y un ejemplo nuevo.'
      if (context.stage === 'split_individual') return 'Genera solo una parte autocontenida de la reexplicación, sin repetir contenido.'
      if (context.stage === 'alternate_provider') return 'Reconstruye la reexplicación desde el material fuente con una estrategia completamente distinta.'
      return ''
    }

    const previousFingerprints = Array.isArray(previousReteachFingerprints)
      ? previousReteachFingerprints.map(value => String(value).toLowerCase().replace(/\W+/g, ' ').trim())
      : []

    const pipeline = await runGenerationPipeline<string>({
      taskType: 'reteach',
      failurePath: 'single_repair',
      totalTimeoutMs: 90_000,
      generate: async context => {
        const result = await alai({
          messages: [{ role: 'user', content: `${prompt}\n\n${stageInstruction(context)}` }],
          temperature: context.stage === 'targeted_repair' ? 0.65 : 0.5,
          maxTokens: 650,
          fallbackError: context.providerError,
          taskType: 'reteach',
          stage: context.stage,
        })
        return { value: result.text.trim(), provider: result.provider, model: result.model }
      },
      validate: value => {
        const errors: string[] = []
        if (value.length < 30) errors.push('LOW_QUALITY_RETEACH:too_short')
        const prepared = prepareReteachContent(value, '')
        if (prepared.usedFallback || !prepared.content.trim()) {
          errors.push(prepared.validationReason || 'INVALID_ACADEMIC_FRAGMENT')
        }
        const fingerprint = value.toLowerCase().replace(/\W+/g, ' ').trim()
        if (previousFingerprints.includes(fingerprint)) errors.push('LOW_QUALITY_RETEACH:duplicate_explanation')
        return { valid: errors.length === 0, errors }
      },
      telemetry: (event, payload) => console.info('[ai-generation]', JSON.stringify({
        event,
        taskType: 'reteach',
        recoveryId: requestRecoveryId,
        sessionId: sessionTitle,
        errorType,
        contentSignal,
        ...payload,
      })),
    })

    if (pipeline.status !== 'validated' || !pipeline.content) {
      return NextResponse.json({
        success: false,
        error: 'RETEACH_GENERATION_BUDGET_EXHAUSTED',
        retryable: true,
        recoveryStatus: 'reteaching',
        recoveryId: requestRecoveryId,
        attempts: pipeline.attempts.length,
      }, { status: 503 })
    }

    const prepared = prepareReteachContent(pipeline.content, '')
    return NextResponse.json(reteachResponse(
      prepared.content,
      typeof recoveryStatus === 'string' ? recoveryStatus : 'reteaching',
      Number.isFinite(remainingChecks) ? remainingChecks : 2,
      typeof recoveryId === 'string' ? recoveryId : undefined,
    ))

  } catch (err: any) {
    console.error('[session-reteach] Error:', err?.message)
    return NextResponse.json({
      success: false,
      error: err?.message || 'RETEACH_GENERATION_FAILED',
      retryable: true,
      recoveryStatus: 'reteaching',
      remainingChecks: 2,
      ...(requestRecoveryId ? { recoveryId: requestRecoveryId } : {}),
    }, { status: 503 })
  }
}
