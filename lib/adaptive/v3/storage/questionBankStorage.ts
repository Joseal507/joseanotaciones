// ═══════════════════════════════════════════════════════════════
// Question Bank Storage — Guardar/leer el banco en R2
// ═══════════════════════════════════════════════════════════════

import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { r2 } from '../../../materials/storage'
import type { QuestionBank } from '../graph/questionBank'

const BUCKET = process.env.R2_BUCKET ?? 'studyal'

function buildKey(userId: string, materialId: string): string {
  return `question_banks/${userId}/${materialId}/bank.json`
}

export async function saveQuestionBank(
  userId: string,
  materialId: string,
  banks: Record<string, QuestionBank>,
): Promise<void> {
  const key = buildKey(userId, materialId)
  const buffer = Buffer.from(JSON.stringify(banks), 'utf-8')
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'application/json',
  }))
  const totalQ = Object.values(banks).reduce((s, b) => s + b.totalQuestions, 0)
  console.log(`✅ Question bank guardado: ${key} (${(buffer.length/1024).toFixed(1)} KB, ${totalQ} preguntas)`)
}

export async function loadQuestionBank(
  userId: string,
  materialId: string,
): Promise<Record<string, QuestionBank> | null> {
  const key = buildKey(userId, materialId)
  try {
    const response = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    if (!response.Body) return null
    const chunks: Uint8Array[] = []
    for await (const chunk of response.Body as any) chunks.push(chunk)
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'))
  } catch (err: any) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null
    console.error('[questionBankStorage]', err.message)
    return null
  }
}
