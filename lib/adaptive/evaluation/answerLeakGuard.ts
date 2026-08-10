import type { CanonicalQuestion } from './questionContract'

// Auditoría adversarial (Codex, misión REAL-SESSION QUALITY, B2 CONFIRMADO
// P0, corregido tras revisión final P1): el fallback determinista podía
// producir un true_false que literalmente afirma la respuesta canónica
// completa en el enunciado y la marca correctAnswer=true — adivinable con
// 0% de comprensión real. Ese caso concreto ya está corregido
// separadamente en recoveryFallback.ts (stableHashIsOdd alterna
// verdadero/falso de forma determinista). Este guard originalmente incluía
// TAMBIÉN una rama true_false genérica que comparaba el enunciado contra
// presentAnswer(question, true) — pero para format='true_false',
// presentAnswer(_, true) devuelve literalmente la palabra "Verdadero", así
// que esa rama rechazaba CUALQUIER pregunta convencionalmente formulada
// como "¿Verdadero o falso? ..." (la palabra "Verdadero" del enunciado
// SIEMPRE "contenía" la palabra "Verdadero" presentada) — falso positivo
// masivo sobre la fraseología estándar, no un leak real. Retirada esa rama
// por completo (revisión final, P1 CONFIRMADO); se conserva únicamente el
// check de short_response, donde comparar el enunciado contra el texto
// literal de correctAnswer sí es una señal válida de leak.

export interface AnswerLeakResult {
  leaked: boolean
  reason?: 'ANSWER_LEAK_STEM_CONTAINS_MODEL_ANSWER'
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function detectAnswerLeak(question: Pick<CanonicalQuestion, 'format' | 'questionText' | 'correctAnswer'>): AnswerLeakResult {
  const stem = normalize(question.questionText || '')
  if (question.format === 'short_response' && typeof question.correctAnswer === 'string') {
    const modelAnswer = normalize(question.correctAnswer)
    if (modelAnswer.length >= 12 && stem.includes(modelAnswer)) {
      return { leaked: true, reason: 'ANSWER_LEAK_STEM_CONTAINS_MODEL_ANSWER' }
    }
  }
  return { leaked: false }
}
