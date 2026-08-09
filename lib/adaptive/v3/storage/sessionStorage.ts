// ═══════════════════════════════════════════════════════════════
// Session Storage — Guardar/cargar SessionState en R2
// ═══════════════════════════════════════════════════════════════

import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { r2 } from '../../../materials/storage'
import type { SessionState } from '../types'

const BUCKET = process.env.R2_BUCKET ?? 'studyal'

function buildSessionKey(userId: string, materialId: string, sessionId: string): string {
  return `sessions/${userId}/${materialId}/${sessionId}.json`
}

export async function saveSession(state: SessionState): Promise<string> {
  const key = buildSessionKey(state.userId, state.materialId, state.sessionId)
  const buffer = Buffer.from(JSON.stringify(state), 'utf-8')

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'application/json',
  }))

  return key
}

export async function loadSession(
  userId: string,
  materialId: string,
  sessionId: string,
): Promise<SessionState | null> {
  const key = buildSessionKey(userId, materialId, sessionId)
  try {
    const response = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    if (!response.Body) return null
    const chunks: Uint8Array[] = []
    for await (const chunk of response.Body as any) chunks.push(chunk)
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'))
  } catch (err: any) {
    if (err.name === 'NoSuchKey') return null
    return null
  }
}

export async function deleteSession(
  userId: string,
  materialId: string,
  sessionId: string,
): Promise<void> {
  try {
    await r2.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: buildSessionKey(userId, materialId, sessionId),
    }))
  } catch {}
}
