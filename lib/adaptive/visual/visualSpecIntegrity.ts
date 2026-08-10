import { createHmac, timingSafeEqual } from 'node:crypto'
import type { VisualSpec } from './visualContract'

// Mismo patrón server-authoritative que questionIntegrity.ts: el cliente transporta
// el VisualSpec (y por tanto el dataSpec — el equivalente aquí de correctAnswer) sin
// poder recalcular su firma. visual-check verifica ANTES de confiar en `data` para
// el grading — nunca confía en un dataSpec mutado por el cliente.

interface VisualIntegrityFields {
  id: string
  engine: string
  requirementId: string
  data: unknown
}

function integrityFields(spec: VisualSpec): VisualIntegrityFields {
  return { id: spec.id, engine: spec.engine, requirementId: spec.requirementId, data: spec.data }
}

function integritySecret(): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET no configurado — requerido para firmar VisualSpec (server-authoritative visual contract)')
  return secret
}

export function signVisualSpecIntegrity(spec: VisualSpec): string {
  return createHmac('sha256', integritySecret())
    .update(JSON.stringify(integrityFields(spec)))
    .digest('hex')
}

export function signVisualSpec<T extends VisualSpec>(spec: T): T {
  return { ...spec, integrity: signVisualSpecIntegrity(spec) }
}

export function verifyVisualSpecIntegrity(spec: VisualSpec): boolean {
  const signature = spec.integrity
  if (typeof signature !== 'string' || !signature) return false
  const expected = signVisualSpecIntegrity(spec)
  const expectedBuffer = Buffer.from(expected, 'hex')
  const signatureBuffer = Buffer.from(signature, 'hex')
  if (expectedBuffer.length !== signatureBuffer.length) return false
  return timingSafeEqual(expectedBuffer, signatureBuffer)
}
