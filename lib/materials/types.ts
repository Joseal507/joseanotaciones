// ═══════════════════════════════════════════════
// TIPOS DEL SISTEMA DE MATERIALES
// ═══════════════════════════════════════════════

export type MaterialKind =
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'txt'
  | 'image'
  | 'audio';

export type UploadStatus = 'uploaded' | 'deleted';

export type TextStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'error';

export type JobStatus = 'queued' | 'processing' | 'done' | 'error';

export type EnfoqueType = 'teorico' | 'matematico' | 'mixto';

export type ResultType = 'flashcards' | 'quiz' | 'summary' | 'analysis';

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
  created_at: string;
}

// ─── Validación de archivos ───
export const ALLOWED_EXTENSIONS: Record<string, MaterialKind> = {
  'pdf':  'pdf',
  'docx': 'docx',
  'doc':  'docx',
  'txt':  'txt',
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
  'text/plain',
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
