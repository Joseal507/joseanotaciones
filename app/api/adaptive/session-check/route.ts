import { NextRequest, NextResponse } from 'next/server'
import { scoreQuestion } from '../../../../lib/adaptive/evaluation/scoring'
import { alaiJson } from '../../../../lib/alai'
import type { CanonicalQuestion, CanonicalUserAnswer } from '../../../../lib/adaptive/evaluation/questionContract'
import { presentAnswer, stripOptionSelfReferences } from '../../../../lib/adaptive/evaluation/answerPresentation'
import { validateQuestion } from '../../../../lib/adaptive/evaluation/questionContract'
import {
  EVALUATION_MODE_VIOLATION,
  normalizeEvaluationMode,
  validateQuestionTypeForMode,
} from '../../../../lib/adaptive/evaluation/evaluationModeContract'
import { verifyQuestionIntegrity } from '../../../../lib/adaptive/evaluation/questionIntegrity'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

interface SessionCheckRequest {
  question: CanonicalQuestion
  answer: CanonicalUserAnswer
  teachingContent: string
  mode: string
  materialTitle: string
}

async function evaluateWithAI(
  question: CanonicalQuestion,
  answer: CanonicalUserAnswer,
  teachingContent: string,
  materialTitle: string
): Promise<{
  correct: boolean
  score: number
  feedback: string
  needsReteaching: boolean
  errorType: string | null
  whatWasRight: string
  whatWasWrong: string
}> {
  const prompt = `Eres un evaluador pedagógico experto y justo.

MATERIAL: "${materialTitle}"

PREGUNTA: ${question.questionText}

RESPUESTA CORRECTA ESPERADA: ${JSON.stringify(question.correctAnswer)}

RESPUESTA DEL ESTUDIANTE: ${JSON.stringify(answer)}

CONTENIDO ENSEÑADO:
${(teachingContent || '').slice(0, 800)}

EXPLICACIÓN DE LA RESPUESTA CORRECTA:
${question.explanation || 'No disponible'}

EVALÚA con estas reglas:
1. Si la respuesta es correcta o equivalente semánticamente → correct: true, score: 85-100
2. Si la respuesta tiene la idea correcta pero con errores menores (ortografía, sinónimos, frase incompleta) → correct: true, score: 70-84
3. Si la respuesta tiene parte de la idea pero le falta algo importante → correct: false, score: 40-69
4. Si la respuesta está relacionada pero incorrecta → correct: false, score: 15-39
5. Si la respuesta no tiene relación o es vacía → correct: false, score: 0-14

Para CADA caso genera:
- whatWasRight: qué parte de la respuesta estuvo bien (si algo)
- whatWasWrong: qué falló exactamente (si algo)
- feedback: explicación completa y educativa

IMPORTANTE:
- No seas demasiado estricto con sinónimos o variaciones válidas
- "rápido" y "veloz" son equivalentes
- Una respuesta parcial que demuestre comprensión merece crédito parcial
- El tono debe ser de tutor personal, segunda persona singular

Devuelve SOLO JSON:
{
  "correct": true,
  "score": 85,
  "whatWasRight": "Identificaste correctamente que...",
  "whatWasWrong": "",
  "feedback": "Feedback completo y educativo",
  "needsReteaching": false,
  "errorType": null
}`

  try {
    const result = await alaiJson({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 500,
      json: true,
    })

    return {
      correct: result?.correct === true,
      score: typeof result?.score === 'number' ? Math.min(100, Math.max(0, result.score)) : (result?.correct ? 85 : 20),
      feedback: result?.feedback || (result?.correct ? 'Correcto.' : 'Incorrecto.'),
      needsReteaching: result?.needsReteaching !== false && !result?.correct,
      errorType: result?.correct ? null : (result?.errorType || 'comprehension'),
      whatWasRight: result?.whatWasRight || '',
      whatWasWrong: result?.whatWasWrong || '',
    }
  } catch {
    return {
      correct: false,
      score: 0,
      feedback: 'No se pudo evaluar la respuesta. Inténtalo de nuevo.',
      needsReteaching: true,
      errorType: 'evaluation_error',
      whatWasRight: '',
      whatWasWrong: '',
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as SessionCheckRequest
    const { question, answer, teachingContent, materialTitle } = body
    const mode = normalizeEvaluationMode(body.mode)

    if (!question || answer === undefined || answer === null) {
      return NextResponse.json({ success: false, error: 'question y answer son requeridos' }, { status: 400 })
    }

    // Codex Finding 2 — server-authoritative question contract (P0,
    // CONFIRMED por reproducción real: correctAnswer/targetObjectiveIds/
    // factKeys forjados en el payload eran aceptados tal cual). `question`
    // llega directo del cliente, sin ningún cotejo — antes de confiar en
    // correctAnswer para calificar o en targetObjectiveIds/factKeys para que
    // el cliente acredite evidencia, la firma HMAC puesta por el servidor al
    // generar la pregunta (session-teach/session-eval/session-reteach) debe
    // verificar. Sin firma válida, se trata exactamente igual que cualquier
    // otro fallo de validación — fail-closed, mismo camino ya existente,
    // ninguna superficie de error nueva.
    if (!verifyQuestionIntegrity(question)) {
      console.info('[adaptive-evaluation]', JSON.stringify({
        event: 'evaluation_question_integrity_rejected',
        questionId: question.id,
        microId: question.conceptId,
        recoveryStatus: 'answer_check',
      }))
      return NextResponse.json({
        success: true,
        result: {
          outcome: 'invalid',
          correct: false,
          score: 0,
          errorType: null,
          needsReteaching: false,
          feedback: 'No pudimos validar esta actividad. Tu progreso no se modificó.',
          whatWasRight: '',
          whatWasWrong: '',
          invalidReason: 'QUESTION_INTEGRITY_INVALID',
        },
      })
    }

    const validation = validateQuestion(question, {
      activeConceptId: question.conceptId,
      activeConceptLabel: question.conceptLabel,
      teachingBlockId: question.teachingBlockId,
      targetDimension: question.targetDimension,
      questionFamily: question.questionFamily,
      allowedConceptIds: [question.conceptId],
      forbiddenConceptIds: [],
      evaluationMode: mode,
    })
    const modeValidation = validateQuestionTypeForMode(mode, question.format)
    if (!validation.valid || !modeValidation.valid) {
      if (!modeValidation.valid) {
        console.info('[adaptive-evaluation]', JSON.stringify({
          event: 'evaluation_question_rejected_by_mode',
          reason: EVALUATION_MODE_VIOLATION,
          mode,
          rejectedQuestionType: question.format,
          microId: question.conceptId,
          recoveryStatus: 'answer_check',
        }))
      }
      return NextResponse.json({
        success: true,
        result: {
          outcome: 'invalid',
          correct: false,
          score: 0,
          errorType: null,
          needsReteaching: false,
          feedback: 'No pudimos validar esta actividad. Tu progreso no se modificó.',
          whatWasRight: '',
          whatWasWrong: '',
          invalidReason: !modeValidation.valid ? EVALUATION_MODE_VIOLATION : 'QUESTION_VALIDATION_FAILED',
        },
      })
    }

    const isOpenFormat = ['short_response'].includes(question.format)

    let result

    if (isOpenFormat) {
      result = await evaluateWithAI(question, answer, teachingContent, materialTitle || 'Material')
    } else {
      const scoreResult = scoreQuestion(question, answer)

      let feedback: string
      let whatWasRight = ''
      let whatWasWrong = ''

      const sanitizedExplanation = stripOptionSelfReferences(question.explanation)

      if (scoreResult.correct) {
        feedback = sanitizedExplanation || 'Correcto.'
        whatWasRight = 'Seleccionaste la respuesta correcta.'
      } else {
        const correctDisplay = presentAnswer(question, question.correctAnswer)

        feedback = sanitizedExplanation || `La respuesta correcta era: **${correctDisplay}**.`
        whatWasWrong = `La respuesta correcta era: **${correctDisplay}**.`
      }

      result = {
        ...scoreResult,
        feedback,
        whatWasRight,
        whatWasWrong,
      }
    }

    return NextResponse.json({
      success: true,
      result: {
        ...result,
        conceptLabel: question.conceptLabel,
        questionFormat: question.format,
        correctAnswerDisplay: presentAnswer(question, question.correctAnswer),
        explanation: question.explanation,
      }
    })
  } catch (err: any) {
    console.error('[session-check] Error:', err?.message)
    return NextResponse.json({ success: false, error: err?.message || 'Error' }, { status: 500 })
  }
}
