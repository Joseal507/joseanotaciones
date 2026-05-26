import crypto from 'crypto';
import { r2Client } from './r2';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const R2_BUCKET = process.env.R2_BUCKET || 'studyal';
const CACHE_PREFIX = 'cache/';

export function getContentHash(content: string): string {
  return crypto.createHash('md5').update(content.trim().toLowerCase()).digest('hex');
}

export async function getCachedContent(content: string) {
  const hash = getContentHash(content);
  const key = `${CACHE_PREFIX}${hash}.json`;

  try {
    const response = await r2Client.send(new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    }));

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }

    const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    console.log(`🚀 Cache HIT → ${hash.slice(0, 8)}... (R2)`);
    return data;
  } catch (e: any) {
    // NoSuchKey = no existe en caché, es normal
    if (e?.name !== 'NoSuchKey') {
      console.warn('Cache read error:', e?.message);
    }
    return null;
  }
}

export async function saveToCache(
  content: string,
  data: { flashcards?: any; analysis?: any }
) {
  const hash = getContentHash(content);
  const key = `${CACHE_PREFIX}${hash}.json`;
  const wordCount = content.split(/\s+/).length;

  const payload = {
    content_hash: hash,
    word_count: wordCount,
    created_at: new Date().toISOString(),
    flashcards: data.flashcards || null,
    analysis: data.analysis || null,
  };

  try {
    await r2Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: Buffer.from(JSON.stringify(payload)),
      ContentType: 'application/json',
    }));
    console.log(`💾 Cache GUARDADO → ${hash.slice(0, 8)}... (R2)`);
  } catch (e: any) {
    console.warn('Cache write error:', e?.message);
  }
}
