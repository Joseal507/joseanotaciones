import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIMES,
  MAX_FILE_SIZE,
  getMaxSizeForKind,
  formatFileSize,
  MaterialKind,
} from './types';

export interface ValidationResult {
  ok: boolean;
  error?: string;
  kind?: MaterialKind;
  extension?: string;
}

export function validateFile(
  name: string,
  size: number,
  mime: string,
): ValidationResult {
  // Tamaño
  // Determinar límite por tipo (se evalúa después de determinar el kind)
  const kindForSize = (() => {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (['pdf'].includes(ext)) return 'pdf';
    if (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext)) return 'image';
    if (['doc','docx'].includes(ext)) return 'docx';
    if (['ppt','pptx'].includes(ext)) return 'pptx';
    if (['txt','md'].includes(ext)) return 'txt';
    if (['mp3','wav','m4a','ogg','webm'].includes(ext)) return 'audio';
    return 'other';
  })();
  const maxForThisKind = getMaxSizeForKind(kindForSize);
  if (size > maxForThisKind) {
    const maxMB = Math.round(maxForThisKind / (1024 * 1024));
    const fileMB = (size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `"${name}" pesa ${fileMB}MB. El límite para este tipo es ${maxMB}MB.`,
    };
  }

  if (size === 0) {
    return { ok: false, error: `El archivo "${name}" está vacío.` };
  }

  // Extensión
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const kind = ALLOWED_EXTENSIONS[ext];

  if (!kind) {
    return {
      ok: false,
      error: `Formato no soportado: .${ext}. Usa PDF, Word, PPTX, TXT o imagen.`,
    };
  }

  // MIME
  if (!ALLOWED_MIMES.has(mime)) {
    return {
      ok: false,
      error: `Tipo de archivo no permitido: ${mime}`,
    };
  }

  return { ok: true, kind, extension: ext };
}

export function sanitizeFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 200);
}
