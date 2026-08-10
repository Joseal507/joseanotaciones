// Auditoría adversarial (Codex, misión nocturna FASE 1-2): el grader anterior
// de short_response (evaluateWithAI en session-check/route.ts) delegaba el
// veredicto ENTERO a un booleano/score que el LLM devolvía sin ninguna
// estructura intermedia verificable — "correct"/"score" no tenían ninguna
// relación auditable con requisitos CORE vs OPTIONAL, y nada en el prompt
// obligaba a rechazar contradicción, keyword stuffing, vaguedad o
// razonamiento críticamente incorrecto (findings P0 confirmados).
//
// Fix: el LLM ya NO decide el veredicto final. Solo extrae SEÑALES
// estructuradas (qué requisitos centrales cumplió, si hay contradicción,
// etc.) — deriveWrittenGradingVerdict, una función PURA y determinista, es
// la ÚNICA fuente de verdad para verdict/score/correct. Esto también hace
// el contrato 100% testeable sin LLM real (ver
// scripts/tests/written-grading-contracts.ts).

export interface CoreRequirementResult {
  requirement: string
  met: boolean
}

export interface WrittenGradingSignals {
  coreResults: CoreRequirementResult[]
  optionalDetailsMissing: string[]
  contradiction: boolean
  keywordStuffingOnly: boolean
  vague: boolean
  reasoningRequired: boolean
  reasoningValid: boolean
  whatWasRight: string
  whatWasWrong: string
  feedback: string
}

export type WrittenGradingVerdict = 'correct' | 'partial' | 'incorrect'

export interface WrittenGradingDecision {
  verdict: WrittenGradingVerdict
  correct: boolean
  score: number
}

// REGLA (FASE 2, requisito explícito del usuario): human-tolerant ≠
// academically lax.
//
// Descalificadores fail-closed — ninguno de estos puede compensarse con
// requisitos centrales cumplidos: una respuesta con contradicción interna,
// keyword stuffing sin relación coherente, o genuinamente vaga NUNCA es
// "correct", sin importar qué términos correctos contenga.
//
// Razonamiento: si la pregunta EXIGE razonamiento (reasoningRequired) y ese
// razonamiento es críticamente incorrecto, la conclusión correcta NO basta
// — se evalúa el razonamiento, no solo el resultado final.
//
// Requisitos OPTIONAL/enrichment: NUNCA reducen el score por debajo de 100
// cuando TODOS los requisitos CORE están satisfechos — omitir un detalle
// secundario no es lo mismo que fallar el requisito central de la pregunta.
export function deriveWrittenGradingVerdict(signals: WrittenGradingSignals): WrittenGradingDecision {
  if (signals.contradiction) return { verdict: 'incorrect', correct: false, score: 10 }
  if (signals.keywordStuffingOnly) return { verdict: 'incorrect', correct: false, score: 10 }
  if (signals.vague) return { verdict: 'incorrect', correct: false, score: 5 }
  if (signals.reasoningRequired && !signals.reasoningValid) return { verdict: 'incorrect', correct: false, score: 20 }

  const coreTotal = signals.coreResults.length
  const coreMetCount = signals.coreResults.filter(r => r.met).length
  const allCoreMet = coreTotal === 0 || coreMetCount === coreTotal

  if (allCoreMet) {
    // Detalles opcionales ausentes NUNCA bajan de 100 — el requisito central
    // es lo único que la pregunta exige demostrar.
    return { verdict: 'correct', correct: true, score: 100 }
  }
  if (coreMetCount > 0) {
    const score = Math.round((coreMetCount / coreTotal) * 60) + 20
    return { verdict: 'partial', correct: false, score }
  }
  return { verdict: 'incorrect', correct: false, score: 10 }
}
