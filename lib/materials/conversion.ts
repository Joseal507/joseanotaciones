// Orquesta la normalización a PDF de formatos convertibles (docx/pptx/
// odt/rtf) vía el servicio document-converter (services/document-converter,
// LibreOffice headless en Cloud Run).
//
// Separación deliberada request→job/result: requestConversion() hoy
// ejecuta todo de forma síncrona dentro del request de
// upload/complete/route.ts y devuelve el resultado final. El día que esto
// se mueva a una cola (Cloud Tasks/Queues), el caller solo cambia CÓMO se
// invoca esto (encolar un job en vez de await), no la lógica interna.
import { createHash } from 'crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { Material } from './types';
import { CONVERTIBLE_KINDS } from './types';
import { downloadFromR2, generateNormalizedStorageKey, r2 } from './storage';
import { updateMaterialConversion } from './repository';
import { convertToPdf, ConverterError } from './converterClient';

const BUCKET = process.env.R2_BUCKET ?? 'studyal';

export function needsConversion(kind: unknown): boolean {
  return (CONVERTIBLE_KINDS as readonly string[]).includes(String(kind || ''));
}

export interface ConversionJobResult {
  ok: boolean;
  normalizedStorageKey?: string;
  errorCode?: string;
  errorMessage?: string;
}

export async function requestConversion(
  material: Pick<Material, 'id' | 'user_id' | 'storage_key' | 'kind' | 'nombre'>,
): Promise<ConversionJobResult> {
  try {
    await updateMaterialConversion(material.id, material.user_id, { conversion_status: 'processing' });

    const original = await downloadFromR2(material.storage_key);
    // Hash guardado como groundwork de dedupe (userId+sha256) — la
    // reutilización real (saltar conversión si ya existe un match) queda
    // deferida: compartir un mismo normalized_storage_key entre dos
    // materiales acopla su borrado (si se elimina el material "dueño" del
    // PDF, el otro quedaría apuntando a un objeto R2 ya borrado). Documentado
    // en el reporte como riesgo pendiente, no implementado en esta fase.
    const contentHash = createHash('sha256').update(original).digest('hex');

    const { pdf } = await convertToPdf(original, material.nombre);

    const normalizedKey = generateNormalizedStorageKey(material.user_id, material.id);
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: normalizedKey,
      Body: pdf,
      ContentType: 'application/pdf',
    }));

    await updateMaterialConversion(material.id, material.user_id, {
      conversion_status: 'ready',
      normalized_kind: 'pdf',
      normalized_storage_key: normalizedKey,
      converted_at: new Date().toISOString(),
      content_hash: contentHash,
    });

    return { ok: true, normalizedStorageKey: normalizedKey };
  } catch (e: any) {
    const errorCode = e instanceof ConverterError ? e.code : 'CONVERSION_FAILED';
    const errorMessage = e?.message || 'Error de conversión desconocido';
    console.error(`conversion failed for ${material.id}:`, errorCode, errorMessage);
    try {
      await updateMaterialConversion(material.id, material.user_id, {
        conversion_status: 'failed',
        conversion_error: errorMessage.slice(0, 500),
      });
    } catch (updateErr) {
      console.error('conversion: no se pudo persistir el estado failed:', updateErr);
    }
    return { ok: false, errorCode, errorMessage };
  }
}
