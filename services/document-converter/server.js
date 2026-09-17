'use strict';

// ═══════════════════════════════════════════════════════════════
// document-converter — servicio mínimo, sin estado, contenedorizado.
// Convierte documentos de oficina a PDF vía LibreOffice headless.
//
// Auth: NINGUNA acá adentro a propósito. En producción este servicio se
// despliega en Cloud Run con --no-allow-unauthenticated — Cloud Run mismo
// rechaza cualquier request sin un ID token OIDC válido de una identidad
// con role run.invoker, antes de que llegue a este proceso. No hay
// secreto compartido que imprimir ni validar acá.
//
// Seguridad:
// - whitelist estricta de extensiones + validación de magic bytes real
//   (no solo la extensión que dice el nombre del archivo)
// - execFile (nunca exec/shell) — argv como array, cero superficie de
//   shell injection
// - nombre de archivo generado internamente (uuid); el nombre original
//   solo se usa para derivar la extensión, nunca como parte de un path
// - cada conversión corre en su propio directorio temporal + perfil de
//   LibreOffice aislado (-env:UserInstallation), y ambos se borran SIEMPRE
//   (try/finally), incluso si la conversión falla
// - límite de tamaño de request (enforced mientras se lee el stream, no
//   solo Content-Length) y timeout del subproceso de conversión
// - 1 conversión por request — sin colas ni estado compartido
// ═══════════════════════════════════════════════════════════════

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 8080);
const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024); // 25MB
const CONVERT_TIMEOUT_MS = Number(process.env.CONVERT_TIMEOUT_MS || 60_000);
const SOFFICE_BIN = process.env.SOFFICE_BIN || 'soffice';

// Formatos activos. xlsx queda preparado (parser reconoce la extensión y
// el motor la soporta) pero DESHABILITADO — no probamos todavía cómo
// pagina hojas grandes, así que no lo activamos sin esa validación.
const ACTIVE_EXTENSIONS = new Set(['doc', 'docx', 'ppt', 'pptx', 'odt', 'rtf']);
const PREPARED_NOT_ACTIVE = new Set(['xls', 'xlsx']);

// Magic bytes reales por familia de formato — nunca confiar solo en la
// extensión del nombre de archivo declarado por el cliente.
function magicBytesOk(buf, ext) {
  if (buf.length < 8) return false;
  const zipSig = buf[0] === 0x50 && buf[1] === 0x4b; // PK.. — docx/pptx/odt (todos son ZIP)
  const oleSig = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0; // OLE2 — doc/ppt legacy
  const rtfSig = buf[0] === 0x7b && buf[1] === 0x5c && buf[2] === 0x72 && buf[3] === 0x74 && buf[4] === 0x66; // {\rtf

  switch (ext) {
    case 'docx':
    case 'pptx':
    case 'odt':
      return zipSig;
    case 'doc':
    case 'ppt':
      return oleSig;
    case 'rtf':
      return rtfSig;
    default:
      return false;
  }
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readBodyWithLimit(req, limit) {
  // OJO: req y res comparten el mismo socket TCP. destruir req antes de
  // mandar la respuesta de error mata la conexión y el cliente nunca ve
  // el 413 — solo se marca `settled` acá y se deja que el caller mande la
  // respuesta; el socket se cierra recién después (ver 'TOO_LARGE' abajo).
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > limit) {
        settled = true;
        reject(Object.assign(new Error('El archivo excede el tamaño máximo permitido.'), { code: 'TOO_LARGE', status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', () => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error('Error de red leyendo el archivo.'), { code: 'STREAM_ERROR', status: 400 }));
    });
  });
}

function extractExtension(filenameHeader) {
  let name = '';
  try {
    name = decodeURIComponent(filenameHeader || '');
  } catch {
    name = String(filenameHeader || '');
  }
  const ext = name.split('.').pop();
  return (ext || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function convertOne(buffer, ext) {
  const jobId = crypto.randomUUID();
  const workDir = path.join(os.tmpdir(), `conv-${jobId}`);
  const profileDir = path.join(os.tmpdir(), `lo-profile-${jobId}`);
  // Nombre de archivo interno generado por nosotros — nunca derivado del
  // input del cliente, así que no hay superficie de path traversal.
  const inputPath = path.join(workDir, `input.${ext}`);

  try {
    await fsp.mkdir(workDir, { recursive: true });
    await fsp.mkdir(profileDir, { recursive: true });
    await fsp.writeFile(inputPath, buffer);

    await new Promise((resolve, reject) => {
      execFile(
        SOFFICE_BIN,
        [
          '--headless',
          '--invisible',
          '--nocrashreport',
          '--nodefault',
          '--nologo',
          '--norestore',
          `-env:UserInstallation=file://${profileDir}`,
          '--convert-to', 'pdf',
          '--outdir', workDir,
          inputPath,
        ],
        { timeout: CONVERT_TIMEOUT_MS, killSignal: 'SIGKILL' },
        (error, stdout, stderr) => {
          if (error) {
            const timedOut = error.killed || error.signal === 'SIGKILL';
            reject(Object.assign(
              new Error(timedOut ? 'La conversión excedió el tiempo máximo.' : 'LibreOffice no pudo convertir el archivo.'),
              { code: timedOut ? 'CONVERT_TIMEOUT' : 'CONVERT_FAILED', status: timedOut ? 504 : 422 },
            ));
            return;
          }
          resolve();
        },
      );
    });

    const outputPath = path.join(workDir, 'input.pdf');
    const pdf = await fsp.readFile(outputPath);
    if (pdf.length < 4 || pdf.slice(0, 4).toString('latin1') !== '%PDF') {
      throw Object.assign(new Error('La conversión no produjo un PDF válido.'), { code: 'CONVERT_INVALID_OUTPUT', status: 422 });
    }
    return pdf;
  } finally {
    // Stateless de verdad: nada sobrevive a esta request, ni en éxito ni
    // en error.
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && req.url === '/convert') {
      const ext = extractExtension(req.headers['x-filename']);

      if (PREPARED_NOT_ACTIVE.has(ext)) {
        sendJson(res, 415, { error: 'Formato preparado pero no habilitado todavía.', code: 'FORMAT_NOT_ACTIVE' });
        return;
      }
      if (!ACTIVE_EXTENSIONS.has(ext)) {
        sendJson(res, 415, { error: 'Formato no soportado.', code: 'FORMAT_UNSUPPORTED' });
        return;
      }

      let buffer;
      try {
        buffer = await readBodyWithLimit(req, MAX_BYTES);
      } catch (e) {
        sendJson(res, e.status || 400, { error: e.message, code: e.code || 'BODY_ERROR' });
        // Recién ahora es seguro cortar la conexión — la respuesta ya se
        // encoló para salir. Evita que el cliente siga mandando bytes de
        // un upload que ya rechazamos.
        req.destroy();
        return;
      }
      if (buffer.length === 0) {
        sendJson(res, 400, { error: 'Archivo vacío.', code: 'EMPTY_FILE' });
        return;
      }
      if (!magicBytesOk(buffer, ext)) {
        sendJson(res, 415, { error: 'El contenido del archivo no coincide con la extensión declarada.', code: 'MAGIC_BYTES_MISMATCH' });
        return;
      }

      try {
        const pdf = await convertOne(buffer, ext);
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Length': pdf.length,
        });
        res.end(pdf);
      } catch (e) {
        console.error('convert error:', e.code || 'UNKNOWN', e.message);
        sendJson(res, e.status || 500, { error: e.message || 'Error de conversión.', code: e.code || 'CONVERT_FAILED' });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found', code: 'NOT_FOUND' });
  } catch (e) {
    console.error('unhandled server error:', e.message);
    sendJson(res, 500, { error: 'Error interno.', code: 'INTERNAL_ERROR' });
  }
});

server.listen(PORT, () => {
  console.log(`document-converter listening on :${PORT}`);
});
