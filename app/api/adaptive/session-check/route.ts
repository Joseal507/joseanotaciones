import { NextRequest, NextResponse } from 'next/server'
import { scoreQuestion } from '../../../../lib/adaptive/evaluation/scoring'
import { alaiJson } from '../../../../lib/alai'
import type { CanonicalQuestion, CanonicalUserAnswer } from '../../../../lib/adaptive/evaluation/questionContract'
import { presentAnswer, stripOptionSelfReferences } from '../../../../lib/adaptive/evaluation/answerPresentation'
import { validateQuestion } from '../../../../lib/adaptive/evaluation/questionContract'
import { deriveWrittenGradingVerdict, type WrittenGradingSignals } from '../../../../lib/adaptive/evaluation/writtenGrading'
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

// Auditoría adversarial (Codex, misión nocturna FASE 1): el veredicto ya NO
// lo decide el LLM directamente (antes "correct"/"score" no tenían ninguna
// relación auditable con requisitos CORE vs OPTIONAL, y nada obligaba a
// rechazar contradicción, keyword stuffing, vaguedad o razonamiento
// críticamente incorrecto). Ahora el LLM solo EXTRAE señales estructuradas;
// deriveWrittenGradingVerdict (función pura, testeada sin LLM) es la única
// fuente de verdad para el veredicto final.
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
  const prompt = `Eres un evaluador pedagógico experto y justo. Tu trabajo NO es decidir si la respuesta es correcta — es EXTRAER señales estructuradas verificables. Otro sistema determinista decide el veredicto final a partir de esas señales.

MATERIAL: "${materialTitle}"

PREGUNTA: ${question.questionText}

RESPUESTA MODELO / IDEA ESPERADA: ${JSON.stringify(question.correctAnswer)}

RESPUESTA DEL ESTUDIANTE: ${JSON.stringify(answer)}

CONTENIDO ENSEÑADO:
${(teachingContent || '').slice(0, 800)}

EXPLICACIÓN DE LA RESPUESTA CORRECTA:
${question.explanation || 'No disponible'}

PASO 1 — Identifica los REQUISITOS CENTRALES (CORE) que esta pregunta específica exige demostrar para considerarse respondida correctamente. Un requisito central es algo que, si falta, la respuesta NO puede considerarse correcta. NO incluyas como CORE detalles secundarios, ejemplos adicionales, terminología exacta si el concepto está claro, o información que la pregunta no pidió explícitamente.

PASO 2 — Para CADA requisito central, decide si la respuesta del estudiante lo satisface. Evalúa el CONTENIDO/SIGNIFICADO, nunca la fluidez, longitud, confianza o calidad de redacción como sustituto de corrección real — una respuesta bien escrita pero conceptualmente equivocada NO satisface el requisito.

PASO 3 — Identifica detalles OPCIONALES/de enriquecimiento que la respuesta modelo podría mencionar pero que esta pregunta específica NO exige — anota cuáles omitió el estudiante, pero esto NUNCA debe hacer que un requisito CORE se marque como no cumplido.

PASO 4 — Evalúa fail-closed, cada uno independiente de los requisitos CORE:
- contradiction: ¿la respuesta se contradice a sí misma (afirma X y también no-X, o afirma algo y luego lo opuesto)?
- keywordStuffingOnly: ¿la respuesta menciona términos correctos del tema pero SIN relacionarlos coherentemente entre sí ni con la pregunta (una lista de palabras sueltas, no una explicación)?
- vague: ¿la respuesta es tan vaga que no demuestra ninguna comprensión real ("porque sí", "no sé pero creo que...", una afirmación sin contenido verificable)?
- reasoningRequired: ¿esta pregunta exige explicar POR QUÉ o CÓMO, no solo dar una conclusión?
- reasoningValid (solo si reasoningRequired=true): ¿el razonamiento que dio el estudiante es correcto, aunque haya llegado a la conclusión correcta? Una conclusión correcta con un razonamiento críticamente equivocado NO es reasoningValid=true.

PASO 5 — Redacta whatWasRight/whatWasWrong/feedback usando SOLO lo que realmente escribió el estudiante — nunca inventes una confusión psicológica específica sin evidencia; si no puedes inferir la causa exacta con confianza, usa lenguaje como "tu respuesta no coincide con X porque..." en vez de afirmar una confusión concreta. Tono de tutor personal, segunda persona singular.

Tolera errores ortográficos, gramática imperfecta, frases incompletas si el significado es claro, abreviaciones comunes, símbolos equivalentes, singular/plural, reformulaciones, español/inglés técnico mezclado cuando el concepto sea inequívoco — estos NUNCA deben marcar un requisito CORE como no cumplido.

Devuelve SOLO JSON:
{
  "coreRequirements": ["requisito 1 en pocas palabras", "requisito 2"],
  "coreResults": [{"requirement": "requisito 1 en pocas palabras", "met": true}, {"requirement": "requisito 2", "met": false}],
  "optionalDetailsMissing": ["detalle opcional que omitió, si alguno"],
  "contradiction": false,
  "keywordStuffingOnly": false,
  "vague": false,
  "reasoningRequired": false,
  "reasoningValid": true,
  "whatWasRight": "qué parte de la respuesta estuvo bien, en base al contenido real del estudiante",
  "whatWasWrong": "qué faltó o falló exactamente, si algo",
  "feedback": "feedback completo y educativo, coherente con coreResults"
}`

  try {
    const raw = await alaiJson({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 700,
      json: true,
    })

    const signals: WrittenGradingSignals = {
      coreResults: Array.isArray(raw?.coreResults)
        ? raw.coreResults
          .filter((entry: any) => entry && typeof entry.requirement === 'string')
          .map((entry: any) => ({ requirement: entry.requirement, met: entry.met === true }))
        : [],
      optionalDetailsMissing: Array.isArray(raw?.optionalDetailsMissing) ? raw.optionalDetailsMissing.filter((v: unknown) => typeof v === 'string') : [],
      contradiction: raw?.contradiction === true,
      keywordStuffingOnly: raw?.keywordStuffingOnly === true,
      vague: raw?.vague === true,
      reasoningRequired: raw?.reasoningRequired === true,
      reasoningValid: raw?.reasoningValid !== false,
      whatWasRight: typeof raw?.whatWasRight === 'string' ? raw.whatWasRight : '',
      whatWasWrong: typeof raw?.whatWasWrong === 'string' ? raw.whatWasWrong : '',
      feedback: typeof raw?.feedback === 'string' ? raw.feedback : '',
    }

    // Fail-closed: sin ningún requisito CORE extraído (extracción degradada
    // o pregunta sin requisitos claros), nunca se asume "correct" por
    // defecto — se trata como si ningún requisito se hubiera cumplido.
    if (signals.coreResults.length === 0) {
      signals.coreResults = [{ requirement: 'requisito central de la pregunta', met: false }]
    }

    const decision = deriveWrittenGradingVerdict(signals)

    const missingOptionalNote = signals.optionalDetailsMissing.length > 0 && decision.verdict === 'correct'
      ? ` Como precisión adicional, podrías mencionar: ${signals.optionalDetailsMissing.join(', ')}.`
      : ''

    return {
      correct: decision.correct,
      score: decision.score,
      feedback: (signals.feedback || (decision.verdict === 'correct' ? 'Correcto.' : decision.verdict === 'partial' ? 'Parcialmente correcto.' : 'Incorrecto.')) + missingOptionalNote,
      needsReteaching: decision.verdict !== 'correct',
      errorType: decision.verdict === 'correct' ? null : (signals.contradiction ? 'contradiction' : signals.vague ? 'vague' : signals.keywordStuffingOnly ? 'keyword_stuffing' : (signals.reasoningRequired && !signals.reasoningValid) ? 'invalid_reasoning' : 'comprehension'),
      whatWasRight: signals.whatWasRight,
      whatWasWrong: signals.whatWasWrong,
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
      // Auditoría adversarial (Codex, misión nocturna FASE 1): el feedback
      // era completamente genérico ("Seleccionaste la respuesta correcta.")
      // y NUNCA llamaba presentAnswer(question, answer) — la respuesta
      // REAL del estudiante nunca aparecía en el texto visible, ni en el
      // caso correcto ni en el incorrecto. studentDisplay ahora se usa en
      // ambos casos, así que el feedback siempre puede mostrar qué
      // respondió el estudiante, no solo la respuesta correcta.
      const studentDisplay = presentAnswer(question, answer)

      if (scoreResult.correct) {
        whatWasRight = `Tu respuesta ("${studentDisplay}") es correcta.`
        feedback = sanitizedExplanation ? `${whatWasRight} ${sanitizedExplanation}` : whatWasRight
      } else {
        const correctDisplay = presentAnswer(question, question.correctAnswer)

        whatWasWrong = `Respondiste "${studentDisplay}". La respuesta correcta era "${correctDisplay}".`
        feedback = sanitizedExplanation
          ? `${whatWasWrong} ${sanitizedExplanation}`
          : `${whatWasWrong} Tu respuesta no coincide con "${correctDisplay}".`
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
