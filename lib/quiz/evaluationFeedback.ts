export interface QuizEvaluationFeedback {
  nivel: string
  porcentaje: number | null
  analisis: string
  respuestaCorrecta: string
  explicacion: string
  consejo?: string
  evaluationMode?: string
  providerAttempts?: number
}

export function safeUngradedEvaluation(expected: string, explanation = '') {
  return {
    nivel: 'sin_evaluar' as const, porcentaje: null,
    analisis: 'No pude evaluar esta respuesta con suficiente confianza.',
    respuestaCorrecta: expected, explicacion: explanation,
    consejo: 'Puedes reintentar o revisar la respuesta esperada. Tu progreso no se verá afectado.',
    evaluationMode: 'safe_ungraded' as const,
  }
}

/** Validate the HTTP boundary before history, score or mastery receives a result. */
export function isGradedQuizEvaluation(value: unknown): value is QuizEvaluationFeedback {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  const pct = result.porcentaje
  return result.evaluationMode !== 'safe_ungraded' && result.evaluationMode !== 'safe_fallback'
    && typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= 100
    && (result.nivel === 'correcta' ? pct >= 85
      : result.nivel === 'medio_correcta' ? pct > 0 && pct < 85
        : result.nivel === 'incorrecta' && pct < 50)
    && typeof result.analisis === 'string' && !!result.analisis.trim()
    && typeof result.respuestaCorrecta === 'string' && typeof result.explicacion === 'string'
}
