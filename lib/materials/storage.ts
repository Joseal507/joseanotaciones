import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = process.env.R2_BUCKET ?? 'studyal';
const ENDPOINT = process.env.R2_ENDPOINT ?? '';

export const r2 = new S3Client({
  region: 'auto',
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// ─── Generar key única para el archivo ───
export function generateStorageKey(
  userId: string,
  materialId: string,
  extension: string,
): string {
  return `materials/${userId}/${materialId}/source.${extension}`;
}

// ─── Presigned URL para subir (el frontend sube directo a R2) ───
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 300,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2, command, { expiresIn });
}

// ─── Presigned URL para descargar (acceso temporal privado) ───
export async function getPresignedDownloadUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });
  return getSignedUrl(r2, command, { expiresIn });
}

// ─── Verificar que el objeto existe en R2 ───
export async function objectExists(key: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// ─── Descargar archivo como Buffer ───
export async function downloadFromR2(key: string): Promise<Buffer> {
  const response = await r2.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
  );
  if (!response.Body) throw new Error('R2: respuesta vacía');
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ─── Eliminar archivo de R2 ───
export async function deleteFromR2(key: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
