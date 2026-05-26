import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const R2_BUCKET = process.env.R2_BUCKET || 'studyal';
const MAX_STORAGE_BYTES = 9.5 * 1024 * 1024 * 1024; // 🛡️ 9.5GB = Candado antes de llegar a 10GB

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// ── Verificar cuánto espacio se está usando ──
export const getStorageUsed = async (): Promise<number> => {
  try {
    let totalBytes = 0;
    let continuationToken: string | undefined;

    do {
      const response = await r2Client.send(new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        ContinuationToken: continuationToken,
      }));

      for (const obj of response.Contents || []) {
        totalBytes += obj.Size || 0;
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return totalBytes;
  } catch (e) {
    console.error('Error calculando espacio R2:', e);
    return 0;
  }
};

// ── Verificar si hay espacio disponible ──
export const checkStorageAvailable = async (fileSize: number): Promise<{ ok: boolean; used: number; available: number }> => {
  const used = await getStorageUsed();
  const available = MAX_STORAGE_BYTES - used;
  const ok = (used + fileSize) < MAX_STORAGE_BYTES;

  const usedGB = (used / 1024 / 1024 / 1024).toFixed(2);
  const availableGB = (available / 1024 / 1024 / 1024).toFixed(2);

  console.log(`📦 R2 Storage → Usado: ${usedGB}GB | Disponible: ${availableGB}GB`);

  if (!ok) {
    console.warn(`🚨 ALMACENAMIENTO CASI LLENO: ${usedGB}GB usados de 10GB`);
  }

  return { ok, used, available };
};

// ── Subir archivo a R2 ──
export const uploadToR2 = async (
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> => {
  // 🛡️ Verificar espacio antes de subir
  const { ok, used } = await checkStorageAvailable(buffer.length);

  if (!ok) {
    const usedGB = (used / 1024 / 1024 / 1024).toFixed(2);
    throw new Error(`⚠️ Almacenamiento lleno (${usedGB}GB/10GB). No se pueden subir más archivos.`);
  }

  await r2Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));

  const url = `${process.env.R2_ENDPOINT}/${R2_BUCKET}/${key}`;
  console.log(`✅ Archivo subido a R2: ${key} (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);
  return url;
};

// ── Descargar archivo de R2 ──
export const downloadFromR2 = async (key: string): Promise<Buffer> => {
  const response = await r2Client.send(new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  }));

  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
};

// ── Generar key única para el archivo ──
export const generateR2Key = (userId: string, fileName: string): string => {
  const timestamp = Date.now();
  const extension = fileName.split('.').pop();
  return `uploads/${userId}/${timestamp}.${extension}`;
};


// ── Presigned URL para upload directo desde el cliente ──
export const getPresignedUploadUrl = async (
  key: string,
  contentType: string,
  expiresIn = 300, // 5 minutos
): Promise<string> => {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2Client, command, { expiresIn });
};

export const getPublicUrl = (key: string): string => {
  const endpoint = process.env.R2_ENDPOINT || '';
  return `${endpoint}/${R2_BUCKET}/${key}`;
};
