// ═══════════════════════════════════════════════
// TIPOS DEL SISTEMA DE MATERIALES
// ═══════════════════════════════════════════════

export type MaterialKind =
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'odt'
  | 'rtf'
  | 'txt'
  | 'image'
  | 'audio'
  | 'web';

// Formatos que pasan por el servicio de normalización (LibreOffice) antes
// de poder estudiarse — se convierten a normalized.pdf y de ahí en más
// siguen el pipeline PDF de siempre. 'kind' (arriba) sigue siendo el
// formato ORIGINAL, solo para mostrarle al usuario "Clase.pptx" — nunca
// se usa para decidir cómo extraer/seleccionar una vez convertido.
export const CONVERTIBLE_KINDS: readonly MaterialKind[] = ['docx', 'pptx', 'odt', 'rtf'];

export type ConversionStatus = 'processing' | 'ready' | 'failed';

export type UploadStatus = 'pending' | 'uploaded' | 'deleted';

export type TextStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'error';

export type JobStatus = 'queued' | 'processing' | 'done' | 'error';

export type EnfoqueType = 'teorico' | 'matematico' | 'mixto';

export type ResultType = 'alai_chat_turn' | 'flashcards' | 'quiz' | 'quiz_history' | 'quiz_manifest' | 'quiz_report' | 'quiz_result' | 'summary' | 'analysis' | 'material_brain' | 'flashcards_deck' | 'visual_page_analysis' | 'exam_manifest' | 'exam_artifact' | 'exam_result' | 'repasar_snapshot' | 'material_enjoyer' | 'repaso_artifact' | 'analysis_enjoyer_artifact' | 'truquitos_artifact';

// ─── Material completo de la DB ───
export interface Material {
  id: string;
  user_id: string;
  tema_id: string;
  materia_id: string;
  nombre: string;
  extension: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  kind: MaterialKind;
  upload_status: UploadStatus;
  text_status: TextStatus;
  extracted_chars: number;
  pages_count?: number;
  content_hash?: string;
  last_error?: string;
  // Solo materiales kind==='web': procedencia + cuándo se tomó el snapshot.
  // La URL es procedencia, NO se vuelve a descargar en cada sesión — el
  // contenido cacheado en material_texts es la fuente académica autorizada.
  source_url?: string;
  fetched_at?: string;
  // Normalización a PDF (solo CONVERTIBLE_KINDS). normalized_kind/
  // normalized_storage_key quedan NULL cuando no aplica (PDF nativo,
  // imagen, audio, txt, web) — el código de lectura hace
  // `normalized_storage_key || storage_key` y `normalized_kind || kind`.
  normalized_kind?: MaterialKind;
  normalized_storage_key?: string;
  conversion_status?: ConversionStatus;
  conversion_error?: string;
  converted_at?: string;
  created_at: string;
  updated_at: string;
}

export interface MaterialText {
  material_id: string;
  raw_text: string;
  created_at: string;
  updated_at: string;
}

export interface MaterialResult {
  id: string;
  material_id: string;
  enfoque: EnfoqueType;
  result_type: ResultType;
  content_hash?: string;
  payload: any;
  created_at: string;
}

export interface MaterialJob {
  id: string;
  material_id: string;
  type: 'extract_text';
  status: JobStatus;
  attempts: number;
  error?: string;
  created_at: string;
  updated_at: string;
}

// ─── Para el frontend ───
export interface MaterialUI {
  id: string;
  nombre: string;
  extension: string;
  kind: MaterialKind;
  size_bytes: number;
  text_status: TextStatus;
  conversion_status?: ConversionStatus;
  created_at: string;
}

// ─── Validación de archivos ───
export const ALLOWED_EXTENSIONS: Record<string, MaterialKind> = {
  'pdf':  'pdf',
  'docx': 'docx',
  'doc':  'docx',
  'pptx': 'pptx',
  'ppt':  'pptx',
  'odt':  'odt',
  'rtf':  'rtf',
  'txt':  'txt',
  'md':   'txt',
  'jpg':  'image',
  'jpeg': 'image',
  'png':  'image',
  'webp': 'image',
  'mp3':  'audio',
  'wav':  'audio',
  'm4a':  'audio',
};

export const ALLOWED_MIMES: Set<string> = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'text/rtf',
  'text/plain',
  'text/markdown',
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/mpeg',
  'audio/wav',
  'audio/mp4',
  'audio/m4a',
]);

export const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB global fallback

// Límites por tipo de archivo
export const MAX_FILE_SIZE_BY_KIND: Record<string, number> = {
  pdf:   30 * 1024 * 1024, // 30MB - PDFs académicos
  image: 10 * 1024 * 1024, // 10MB - imágenes
  docx:  20 * 1024 * 1024, // 20MB - Word
  pptx:  20 * 1024 * 1024, // 20MB - PowerPoint
  odt:   20 * 1024 * 1024, // 20MB - OpenDocument
  rtf:   20 * 1024 * 1024, // 20MB - RTF
  txt:    5 * 1024 * 1024, //  5MB - texto plano
  audio: 25 * 1024 * 1024, // 25MB - audio
};

export function getMaxSizeForKind(kind: string): number {
  return MAX_FILE_SIZE_BY_KIND[kind] ?? MAX_FILE_SIZE;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
}

// ─── Respuestas de API ───
export interface InitUploadRequest {
  temaId: string;
  materiaId: string;
  requestId: string;
  files: {
    name: string;
    size: number;
    type: string;
  }[];
}

export interface InitUploadResponse {
  uploads: {
    materialId: string;
    uploadUrl: string;
    key: string;
    expiresIn: number;
  }[];
}

export interface CompleteUploadRequest {
  materialId: string;
}

export interface CompleteUploadResponse {
  success: boolean;
  material: MaterialUI;
}
