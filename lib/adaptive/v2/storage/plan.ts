// ═══════════════════════════════════════════════════════════════
// Plan Storage — Guardar/leer plan de sesiones en R2
// 
// El plan es por usuario+material (cada estudiante tiene el suyo).
// Se guarda cuando se crea, se actualiza cuando se completa una sesión.
// ═══════════════════════════════════════════════════════════════

import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { r2 } from '../../../materials/storage'
import type { SessionBlueprint } from '../types'

const BUCKET = process.env.R2_BUCKET ?? 'studyal'

export interface StoredPlan {
  planId: string
  userId: string
  materialId: string
  materialTitle: string
  sessions: SessionBlueprint[]
  strategy: {
    reasoning: string
    goals: string[]
    projectedProgress: number[]
    warnings: string[]
  }
  createdAt: number
  updatedAt: number
  currentSessionIndex: number
  completedSessionIds: string[]
}

function buildPlanKey(userId: string, materialId: string): string {
  return `plans/${userId}/${materialId}/plan.json`
}

// ═══════════════════════════════════════════════════════════════
// GUARDAR PLAN
// ═══════════════════════════════════════════════════════════════
export async function savePlan(plan: StoredPlan): Promise<string> {
  const key = buildPlanKey(plan.userId, plan.materialId)
  const buffer = Buffer.from(JSON.stringify(plan), 'utf-8')

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'application/json',
  }))

  console.log(`✅ Plan guardado: ${key} (${(buffer.length / 1024).toFixed(1)} KB, ${plan.sessions.length} sesiones)`)
  return key
}

// ═══════════════════════════════════════════════════════════════
// CARGAR PLAN
// ═══════════════════════════════════════════════════════════════
export async function loadPlan(userId: string, materialId: string): Promise<StoredPlan | null> {
  const key = buildPlanKey(userId, materialId)

  try {
    const response = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    if (!response.Body) return null

    const chunks: Uint8Array[] = []
    for await (const chunk of response.Body as any) {
      chunks.push(chunk)
    }
    const plan: StoredPlan = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
    console.log(`📖 Plan cargado: ${key} (${plan.sessions.length} sesiones)`)
    return plan
  } catch (err: any) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null
    console.error(`[loadPlan]`, err.message)
    return null
  }
}

// ═══════════════════════════════════════════════════════════════
// VERIFICAR SI EXISTE
// ═══════════════════════════════════════════════════════════════
export async function planExists(userId: string, materialId: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({
      Bucket: BUCKET,
      Key: buildPlanKey(userId, materialId),
    }))
    return true
  } catch {
    return false
  }
}

// ═══════════════════════════════════════════════════════════════
// ELIMINAR PLAN
// ═══════════════════════════════════════════════════════════════
export async function deletePlan(userId: string, materialId: string): Promise<void> {
  try {
    await r2.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: buildPlanKey(userId, materialId),
    }))
    console.log(`🗑️ Plan eliminado: ${materialId}`)
  } catch (err: any) {
    console.error(`[deletePlan]`, err.message)
  }
}

// ═══════════════════════════════════════════════════════════════
// ACTUALIZAR ESTADO DE UNA SESIÓN
// ═══════════════════════════════════════════════════════════════
export async function markSessionCompleted(
  userId: string,
  materialId: string,
  sessionId: string,
): Promise<void> {
  const plan = await loadPlan(userId, materialId)
  if (!plan) return

  const session = plan.sessions.find(s => s.sessionId === sessionId)
  if (session) session.status = 'completed'

  if (!plan.completedSessionIds.includes(sessionId)) {
    plan.completedSessionIds.push(sessionId)
  }

  // Desbloquear la siguiente
  const currentIdx = plan.sessions.findIndex(s => s.sessionId === sessionId)
  const nextSession = plan.sessions[currentIdx + 1]
  if (nextSession && nextSession.status === 'locked') {
    nextSession.status = 'ready'
    plan.currentSessionIndex = currentIdx + 1
  }

  plan.updatedAt = Date.now()
  await savePlan(plan)
}
