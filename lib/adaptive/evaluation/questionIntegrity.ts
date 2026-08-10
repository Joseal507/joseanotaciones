import { createHmac, timingSafeEqual } from 'node:crypto'
import type { CanonicalQuestion } from './questionContract'

// AUDITORÍA ADVERSARIAL CODEX — Finding 2 (P0, CONFIRMED, dos mitades: grading
// authority + evidence-target authority, misma causa raíz): session-check
// recibía `question` directo del cliente (correctAnswer, targetObjectiveIds,
// factKeys incluidos) sin ningún cotejo contra lo que el servidor generó
// realmente. Repro real: forjar correctAnswer en el payload -> el servidor
// devolvía correct:true para una respuesta objetivamente incorrecta; forjar
// targetObjectiveIds/factKeys -> recordAssessmentEvidence (cliente) acredita
// evidencia a objetivos arbitrarios. Ambas mitades comparten la misma raíz:
// session-check no tiene ninguna fuente de verdad más allá del propio
// payload del cliente.
//
// SERVER-AUTHORITATIVE QUESTION CONTRACT (fix mínimo, sin rediseño):
// cada pregunta que sale del servidor (session-teach, session-eval,
// session-reteach) se firma con un HMAC-SHA256 sobre sus campos
// pedagógicamente decisivos (id, format, correctAnswer, targetObjectiveIds,
// factKeys) usando NEXTAUTH_SECRET (secreto ya existente, server-only, sin
// necesidad de nueva credencial ni de auth/DB nuevos — funciona igual para
// sesiones anónimas y autenticadas). La firma viaja como question.integrity,
// un campo más del objeto — el cliente la transporta sin poder recalcularla,
// exactamente como transporta el resto de la pregunta. session-check
// verifica la firma ANTES de confiar en correctAnswer/targetObjectiveIds/
// factKeys; si no coincide (o falta), la pregunta se trata como inválida —
// mismo camino de degradación ya usado para cualquier otro fallo de
// validación, fail-closed, sin nueva superficie de error.
//
// No se firma questionText/explanation/hint (afectan presentación, no
// grading ni evidence-targeting) — mantiene el payload firmado mínimo y
// evita invalidar firmas por sanitización de texto (LaTeX, etc.) posterior.

interface IntegrityFields {
  id: string
  format: string
  correctAnswer: unknown
  targetObjectiveIds: string[]
  factKeys: string[]
}

function integrityFields(question: CanonicalQuestion): IntegrityFields {
  const withTargets = question as CanonicalQuestion & { targetObjectiveIds?: string[]; factKeys?: string[] }
  return {
    id: question.id,
    format: question.format,
    correctAnswer: question.correctAnswer,
    targetObjectiveIds: [...(withTargets.targetObjectiveIds || [])].sort(),
    factKeys: [...(withTargets.factKeys || [])].sort(),
  }
}

function integritySecret(): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET no configurado — requerido para firmar preguntas (server-authoritative question contract)')
  return secret
}

export function signQuestionIntegrity(question: CanonicalQuestion): string {
  return createHmac('sha256', integritySecret())
    .update(JSON.stringify(integrityFields(question)))
    .digest('hex')
}

// Muta y devuelve el mismo array — conveniencia para el patrón repetido en
// cada ruta de generación: firmar todas las preguntas justo antes de
// serializar la respuesta final al cliente.
export function signQuestionsInPlace<T extends CanonicalQuestion>(questions: T[]): T[] {
  for (const question of questions) {
    (question as CanonicalQuestion & { integrity?: string }).integrity = signQuestionIntegrity(question)
  }
  return questions
}

export function verifyQuestionIntegrity(question: CanonicalQuestion): boolean {
  const signature = (question as CanonicalQuestion & { integrity?: unknown }).integrity
  if (typeof signature !== 'string' || !signature) return false
  const expected = signQuestionIntegrity(question)
  const expectedBuffer = Buffer.from(expected, 'hex')
  const signatureBuffer = Buffer.from(signature, 'hex')
  if (expectedBuffer.length !== signatureBuffer.length) return false
  return timingSafeEqual(expectedBuffer, signatureBuffer)
}
