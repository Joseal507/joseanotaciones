// ═══════════════════════════════════════════════════════════════
// FETCH SSRF-SAFE — la URL de un material Web es input NO confiable.
//
// Defensas:
// - solo http/https
// - DNS resuelto y CADA IP candidata clasificada con ipaddr.js; solo
//   range()==='unicast' (público) pasa — todo lo demás (loopback,
//   private, linkLocal — cubre el endpoint de metadata 169.254.169.254 —,
//   uniqueLocal, carrierGradeNat, multicast, reserved, unspecified) se
//   rechaza por allowlist, no por denylist parcial.
// - conexión pineada a la IP ya validada (host: safeIp), nunca se vuelve
//   a resolver DNS para el connect real → cierra la ventana de DNS
//   rebinding entre validación y fetch. TLS SNI/cert validation sigue
//   usando el hostname real vía `servername`.
// - cada redirect se seguido manualmente y revalidado desde cero
//   (protocolo + DNS + IP) — nunca se delega el follow a la librería.
// - límite de redirects, timeout, límite de bytes leídos en streaming
//   (no se bufferea sin límite), y Content-Type debe ser text/html.
// ═══════════════════════════════════════════════════════════════
import { promises as dns } from 'dns';
import * as https from 'https';
import * as http from 'http';
import ipaddr from 'ipaddr.js';

export class WebFetchError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_CONTENT_TYPE_PREFIXES = ['text/html', 'application/xhtml+xml'];

async function resolveSafeIp(hostname: string): Promise<string> {
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new WebFetchError('No se pudo resolver el dominio.', 'DNS_FAILED');
  }
  if (!addresses.length) {
    throw new WebFetchError('El dominio no resolvió a ninguna dirección.', 'DNS_EMPTY');
  }
  for (const { address } of addresses) {
    let range: string;
    try {
      range = ipaddr.process(address).range();
    } catch {
      throw new WebFetchError('Dirección IP inválida.', 'IP_INVALID');
    }
    if (range !== 'unicast') {
      throw new WebFetchError('La URL apunta a una dirección de red no permitida.', 'IP_BLOCKED');
    }
  }
  return addresses[0].address;
}

interface RawFetchResult {
  html: string;
  finalUrl: string;
  contentType: string;
}

function fetchOnce(targetUrl: URL, safeIp: string): Promise<{ redirectTo?: string; body?: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const client = targetUrl.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        host: safeIp,
        port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: 'GET',
        headers: {
          Host: targetUrl.hostname,
          'User-Agent': 'StudyAL-MaterialFetcher/1.0',
          Accept: 'text/html,application/xhtml+xml',
        },
        servername: targetUrl.protocol === 'https:' ? targetUrl.hostname : undefined,
        timeout: TIMEOUT_MS,
      } as https.RequestOptions,
      (res) => {
        const status = res.statusCode || 0;
        const contentType = String(res.headers['content-type'] || '').toLowerCase();

        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ redirectTo: res.headers.location, contentType });
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new WebFetchError(`El servidor respondió ${status}.`, 'HTTP_ERROR'));
          return;
        }
        if (!ALLOWED_CONTENT_TYPE_PREFIXES.some(p => contentType.startsWith(p))) {
          res.resume();
          reject(new WebFetchError(`Tipo de contenido no permitido: ${contentType || 'desconocido'}.`, 'CONTENT_TYPE_BLOCKED'));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_BYTES) {
            req.destroy();
            reject(new WebFetchError('La página excede el tamaño máximo permitido.', 'TOO_LARGE'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ body: Buffer.concat(chunks), contentType }));
        res.on('error', () => reject(new WebFetchError('Error de red leyendo la respuesta.', 'STREAM_ERROR')));
      },
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new WebFetchError('Tiempo de espera agotado.', 'TIMEOUT'));
    });
    req.on('error', () => reject(new WebFetchError('No se pudo conectar con el servidor.', 'CONNECT_FAILED')));
    req.end();
  });
}

export async function fetchPublicHtml(inputUrl: string): Promise<RawFetchResult> {
  let currentUrl: URL;
  try {
    currentUrl = new URL(inputUrl);
  } catch {
    throw new WebFetchError('URL inválida.', 'INVALID_URL');
  }

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (currentUrl.protocol !== 'http:' && currentUrl.protocol !== 'https:') {
      throw new WebFetchError('Solo se permiten URLs http/https.', 'PROTOCOL_BLOCKED');
    }

    const safeIp = await resolveSafeIp(currentUrl.hostname);
    const result = await fetchOnce(currentUrl, safeIp);

    if (result.redirectTo) {
      let next: URL;
      try {
        next = new URL(result.redirectTo, currentUrl);
      } catch {
        throw new WebFetchError('Redirección a una URL inválida.', 'INVALID_REDIRECT');
      }
      currentUrl = next; // se revalida protocolo + DNS + IP en la siguiente vuelta
      continue;
    }

    return {
      html: result.body!.toString('utf-8'),
      finalUrl: currentUrl.toString(),
      contentType: result.contentType,
    };
  }

  throw new WebFetchError('Demasiadas redirecciones.', 'TOO_MANY_REDIRECTS');
}
