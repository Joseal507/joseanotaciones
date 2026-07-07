// ═══════════════════════════════════════════════════════════════
// Intelligence Storage — Guardar/leer análisis en R2
// 
// El análisis del material se guarda UNA vez y se reutiliza.
// Se guarda como JSON en R2 con key predecible.
// ═══════════════════════════════════════════════════════════════

import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { r2 } from '../../../materials/storage'
import type { MaterialIntelligence } from '../types'

const BUCKET = process.env.R2_BUCKET ?? 'studyal'

// ═══════════════════════════════════════════════════════════════
// KEY GENERATION
// ═══════════════════════════════════════════════════════════════
function buildIntelligenceKey(userId: string, materialId: string): string {
  return `intelligence/${userId}/${materialId}/analysis.json`
}

function buildIntelligenceMetaKey(userId: string, materialId: string): string {
  return `intelligence/${userId}/${materialId}/meta.json`
}

// ═══════════════════════════════════════════════════════════════
// GUARDAR ANÁLISIS
// ═══════════════════════════════════════════════════════════════
export async function saveIntelligence(
  userId: string,
  materialId: string,
  intelligence: MaterialIntelligence,
): Promise<string> {
  const key = buildIntelligenceKey(userId, materialId)
  const metaKey = buildIntelligenceMetaKey(userId, materialId)

  const json = JSON.stringify(intelligence)
  const buffer = Buffer.from(json, 'utf-8')

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'application/json',
  }))

  // Guardar metadata pequeña para queries rápidas
  const meta = {
    userId,
    materialId,
    materialTitle: intelligence.materialTitle,
    subjectArea: intelligence.subjectArea,
    difficultyLevel: intelligence.difficultyLevel,
    totalTopics: intelligence.topics.length,
    totalFormulas: intelligence.formulas.length,
    totalProcedures: intelligence.procedures.length,
    analyzedAt: intelligence.analyzedAt,
    sizeBytes: buffer.length,
  }

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: metaKey,
    Body: Buffer.from(JSON.stringify(meta), 'utf-8'),
    ContentType: 'application/json',
  }))

  console.log(`✅ Intelligence guardado: ${key} (${(buffer.length / 1024).toFixed(1)} KB, ${intelligence.topics.length} topics)`)

  return key
}

// ═══════════════════════════════════════════════════════════════
// LEER ANÁLISIS
// ═══════════════════════════════════════════════════════════════
export async function loadIntelligence(
  userId: string,
  materialId: string,
): Promise<MaterialIntelligence | null> {
  const key = buildIntelligenceKey(userId, materialId)

  try {
    const response = await r2.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }))

    if (!response.Body) return null

    const chunks: Uint8Array[] = []
    for await (const chunk of response.Body as any) {
      chunks.push(chunk)
    }

    const buffer = Buffer.concat(chunks)
    const json = buffer.toString('utf-8')
    const intelligence: MaterialIntelligence = JSON.parse(json)

    console.log(`📖 Intelligence cargado: ${key} (${intelligence.topics.length} topics)`)
    return intelligence
  } catch (err: any) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return null
    }
    console.error(`[loadIntelligence] Error:`, err.message)
    return null
  }
}

// ═══════════════════════════════════════════════════════════════
// VERIFICAR SI EXISTE
// ═══════════════════════════════════════════════════════════════
export async function intelligenceExists(
  userId: string,
  materialId: string,
): Promise<boolean> {
  const key = buildIntelligenceKey(userId, materialId)
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

// ═══════════════════════════════════════════════════════════════
// LEER SOLO METADATA (rápido)
// ═══════════════════════════════════════════════════════════════
export interface IntelligenceMeta {
  userId: string
  materialId: string
  materialTitle: string
  subjectArea: string
  difficultyLevel: string
  totalTopics: number
  totalFormulas: number
  totalProcedures: number
  analyzedAt: number
  sizeBytes: number
}

export async function loadIntelligenceMeta(
  userId: string,
  materialId: string,
): Promise<IntelligenceMeta | null> {
  const metaKey = buildIntelligenceMetaKey(userId, materialId)

  try {
    const response = await r2.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: metaKey,
    }))
    if (!response.Body) return null

    const chunks: Uint8Array[] = []
    for await (const chunk of response.Body as any) {
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'))
  } catch {
    return null
  }
}

// ═══════════════════════════════════════════════════════════════
// ELIMINAR ANÁLISIS (útil para forzar reanálisis)
// ═══════════════════════════════════════════════════════════════
export async function deleteIntelligence(
  userId: string,
  materialId: string,
): Promise<void> {
  const key = buildIntelligenceKey(userId, materialId)
  const metaKey = buildIntelligenceMetaKey(userId, materialId)

  try {
    await Promise.all([
      r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })),
      r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: metaKey })),
    ])
    console.log(`🗑️ Intelligence eliminado: ${materialId}`)
  } catch (err: any) {
    console.error(`[deleteIntelligence]`, err.message)
  }
}

// ═══════════════════════════════════════════════════════════════
// LEER O CREAR CON CALLBACK (cache pattern)
// ═══════════════════════════════════════════════════════════════
export async function loadOrCreateIntelligence(
  userId: string,
  materialId: string,
  createFn: () => Promise<MaterialIntelligence>,
  forceRefresh: boolean = false,
): Promise<{ intelligence: MaterialIntelligence; fromCache: boolean }> {
  if (!forceRefresh) {
    const cached = await loadIntelligence(userId, materialId)
    if (cached) {
      return { intelligence: cached, fromCache: true }
    }
  }

  const fresh = await createFn()
  await saveIntelligence(userId, materialId, fresh)
  return { intelligence: fresh, fromCache: false }
}
