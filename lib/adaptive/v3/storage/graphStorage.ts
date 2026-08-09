// ═══════════════════════════════════════════════════════════════
// Graph Storage — Guardar/leer KnowledgeGraph en R2
// ═══════════════════════════════════════════════════════════════

import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { r2 } from '../../../materials/storage'
import type { KnowledgeGraph } from '../types'

const BUCKET = process.env.R2_BUCKET ?? 'studyal'

function buildGraphKey(userId: string, materialId: string): string {
  return `graphs/${userId}/${materialId}/knowledge_graph.json`
}

export async function saveGraph(userId: string, materialId: string, graph: KnowledgeGraph): Promise<string> {
  const key = buildGraphKey(userId, materialId)
  const buffer = Buffer.from(JSON.stringify(graph), 'utf-8')

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'application/json',
  }))

  console.log(`✅ Graph guardado: ${key} (${(buffer.length / 1024).toFixed(1)} KB, ${graph.totalMicros} micros)`)
  return key
}

export async function loadGraph(userId: string, materialId: string): Promise<KnowledgeGraph | null> {
  const key = buildGraphKey(userId, materialId)
  try {
    const response = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    if (!response.Body) return null
    const chunks: Uint8Array[] = []
    for await (const chunk of response.Body as any) chunks.push(chunk)
    const graph: KnowledgeGraph = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
    console.log(`📖 Graph cargado: ${key} (${graph.totalMicros} micros)`)
    return graph
  } catch (err: any) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null
    console.error('[loadGraph]', err.message)
    return null
  }
}

export async function graphExists(userId: string, materialId: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({
      Bucket: BUCKET,
      Key: buildGraphKey(userId, materialId),
    }))
    return true
  } catch {
    return false
  }
}

export async function deleteGraph(userId: string, materialId: string): Promise<void> {
  try {
    await r2.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: buildGraphKey(userId, materialId),
    }))
    console.log(`🗑️ Graph eliminado: ${materialId}`)
  } catch (err: any) {
    console.error('[deleteGraph]', err.message)
  }
}
