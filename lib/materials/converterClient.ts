// Cliente HTTP hacia el servicio document-converter (services/document-converter).
//
// Auth: Cloud Run IAM/OIDC nativo — el converter se despliega con
// --no-allow-unauthenticated, así que Cloud Run mismo rechaza cualquier
// request sin un ID token válido de una identidad con role run.invoker,
// ANTES de que llegue al container. StudyAL (en Vercel, fuera de GCP) usa
// una Service Account dedicada (GOOGLE_CONVERTER_SA_KEY, JSON, server-only,
// NUNCA NEXT_PUBLIC_*) para pedirle a Google un ID token de corta vida con
// audience = URL del converter, vía google-auth-library. El container NO
// tiene ni necesita código de auth propio.
//
// En dev local (DOCUMENT_CONVERTER_URL apunta a localhost) se salta el
// OIDC — el container local no está protegido por IAM.
import { GoogleAuth } from 'google-auth-library';

const CONVERTER_URL = (process.env.DOCUMENT_CONVERTER_URL || '').replace(/\/$/, '');
const TIMEOUT_MS = 55_000;

export class ConverterError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch {
    return true;
  }
}

let authClientPromise: Promise<any> | null = null;
async function getAuthHeaders(): Promise<Record<string, string>> {
  if (isLocalUrl(CONVERTER_URL)) return {};

  const saKey = process.env.GOOGLE_CONVERTER_SA_KEY;
  if (!saKey) {
    throw new ConverterError('GOOGLE_CONVERTER_SA_KEY no configurado — requerido para llamar al converter fuera de dev local.', 'AUTH_NOT_CONFIGURED');
  }
  if (!authClientPromise) {
    const credentials = JSON.parse(saKey);
    const auth = new GoogleAuth({ credentials });
    authClientPromise = auth.getIdTokenClient(CONVERTER_URL);
  }
  const client = await authClientPromise;
  const headers = await client.getRequestHeaders();
  return { Authorization: headers.get?.('Authorization') || headers.Authorization };
}

export interface ConvertResult {
  pdf: Buffer;
}

export async function isConverterConfigured(): Promise<boolean> {
  return !!CONVERTER_URL;
}

// Prueba de auth server-to-server: /health no hace nada especial en el
// container, pero pasar por Cloud Run con el ID token real confirma que la
// Service Account tiene run.invoker y que el token se genera bien.
export async function pingConverterHealth(): Promise<{ status: number; ok: boolean }> {
  if (!CONVERTER_URL) throw new ConverterError('DOCUMENT_CONVERTER_URL no configurado.', 'NOT_CONFIGURED');
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${CONVERTER_URL}/health`, { headers: authHeaders });
  return { status: res.status, ok: res.ok };
}

export async function convertToPdf(
  buffer: Buffer,
  filename: string,
): Promise<ConvertResult> {
  if (!CONVERTER_URL) {
    throw new ConverterError('DOCUMENT_CONVERTER_URL no configurado.', 'NOT_CONFIGURED');
  }

  const authHeaders = await getAuthHeaders();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${CONVERTER_URL}/convert`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/octet-stream',
        'X-Filename': encodeURIComponent(filename),
      },
      body: new Uint8Array(buffer),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new ConverterError(
        errBody?.error || `El servicio de conversión respondió ${res.status}.`,
        errBody?.code || 'CONVERTER_HTTP_ERROR',
      );
    }

    const arrayBuf = await res.arrayBuffer();
    return { pdf: Buffer.from(arrayBuf) };
  } catch (e: any) {
    if (e instanceof ConverterError) throw e;
    if (e?.name === 'AbortError') throw new ConverterError('Tiempo de espera agotado convirtiendo el documento.', 'CONVERTER_TIMEOUT');
    throw new ConverterError(e?.message || 'No se pudo conectar con el servicio de conversión.', 'CONVERTER_UNREACHABLE');
  } finally {
    clearTimeout(timeout);
  }
}
