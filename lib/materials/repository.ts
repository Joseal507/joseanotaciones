import type {
  Material,
  MaterialText,
  MaterialResult,
  MaterialJob,
  MaterialKind,
  TextStatus,
  ConversionStatus,
  EnfoqueType,
  ResultType,
} from './types';

import { workerAuthHeaders } from '../worker/auth';

const API = process.env.STUDYAL_API_URL || '';

async function apiGet(path: string) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(`${API}${path}`, { cache: 'no-store', headers: workerAuthHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost(path: string, body: any) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: workerAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function rethrowQuizPersistenceError(error: unknown, code: string): never {
  const message = error instanceof Error ? error.message : String(error);
  let workerCode = '';
  try {
    const parsed = JSON.parse(message) as { error?: unknown };
    workerCode = String(parsed?.error || '');
  } catch {
    workerCode = /^not found$/i.test(message.trim()) ? 'not_found' : '';
  }
  if (workerCode === 'not_found') throw new Error(`${code}:WORKER_ROUTE_NOT_DEPLOYED`);
  throw error;
}

function normalizeMaterialText(row: any): MaterialText | null {
  if (!row) return null;
  return {
    ...row,
    raw_text: row.raw_text ?? row.text ?? '',
  };
}

// ═══ MATERIALS ═══

export async function createMaterial(data: {
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
  source_url?: string;
  fetched_at?: string;
  upload_status?: string;
  text_status?: string;
  normalized_kind?: MaterialKind;
  conversion_status?: ConversionStatus;
}): Promise<Material> {
  const res = await apiPost('/materials/upsert', {
    upload_status: 'pending',
    text_status: 'pending',
    ...data,
  });

  if (!res.material) throw new Error('DB createMaterial: material vacío');
  return res.material;
}

export async function getMaterial(
  id: string,
  userId: string,
): Promise<Material | null> {
  const res = await apiGet(`/materials/by-user?userId=${encodeURIComponent(userId)}&id=${encodeURIComponent(id)}`);
  return res.material || null;
}

export async function getMaterialsByTema(
  temaId: string,
  userId: string,
): Promise<Material[]> {
  const res = await apiGet(`/materials/by-user?userId=${encodeURIComponent(userId)}&temaId=${encodeURIComponent(temaId)}`);
  return res.materials || [];
}

export async function updateMaterialTextStatus(
  id: string,
  userId: string,
  status: TextStatus,
  extra?: {
    extracted_chars?: number;
    pages_count?: number;
    last_error?: string;
  },
): Promise<void> {
  // El Worker exige id+user_id (ownership) en /materials/update — sin
  // user_id el endpoint devuelve 400 y esta llamada nunca actualiza nada.
  await apiPost('/materials/update', {
    id,
    user_id: userId,
    text_status: status,
    ...(extra || {}),
  });
}

export async function updateMaterialConversion(
  id: string,
  userId: string,
  update: {
    conversion_status: ConversionStatus;
    normalized_kind?: MaterialKind;
    normalized_storage_key?: string;
    converted_at?: string;
    conversion_error?: string;
    content_hash?: string;
  },
): Promise<void> {
  await apiPost('/materials/update', { id, user_id: userId, ...update });
}

export function resolveStudyKind(material: Pick<Material, 'kind' | 'normalized_kind'>): MaterialKind {
  return material.normalized_kind || material.kind;
}

export function resolveStudyStorageKey(material: Pick<Material, 'storage_key' | 'normalized_storage_key'>): string {
  return material.normalized_storage_key || material.storage_key;
}

export async function softDeleteMaterial(
  id: string,
  userId: string,
): Promise<void> {
  await apiPost('/materials/delete', { id, user_id: userId });
}

export async function markMaterialUploaded(id: string, userId: string): Promise<void> {
  await apiPost('/materials/update', { id, user_id: userId, upload_status: 'uploaded' });
}

// ═══ MATERIAL TEXTS ═══

export async function getMaterialText(
  materialId: string,
): Promise<MaterialText | null> {
  const res = await apiGet(`/material-texts/by-material?materialId=${encodeURIComponent(materialId)}`);
  return normalizeMaterialText(res.text || null);
}

export async function saveMaterialText(
  materialId: string,
  rawText: string,
): Promise<void> {
  await apiPost('/material-texts/upsert', {
    material_id: materialId,
    raw_text: rawText,
    text: rawText,
  });
}

// ═══ MATERIAL RESULTS ═══

export async function getMaterialResult(
  materialId: string,
  enfoque: EnfoqueType,
  resultType: ResultType,
): Promise<MaterialResult | null> {
  const res = await apiGet(
    `/material-results/by-material?materialId=${encodeURIComponent(materialId)}&enfoque=${encodeURIComponent(enfoque)}&resultType=${encodeURIComponent(resultType)}`
  );

  const result = res.result || null;
  if (!result) return null;

  return {
    ...result,
    payload: typeof result.payload === 'string'
      ? (() => { try { return JSON.parse(result.payload); } catch { return result.payload; } })()
      : result.payload,
  };
}

export async function getMaterialResults(
  materialId: string,
  enfoque: EnfoqueType,
  resultType: ResultType,
): Promise<MaterialResult[]> {
  let res;
  try {
    res = await apiGet(
      `/material-results/by-scope?materialId=${encodeURIComponent(materialId)}&enfoque=${encodeURIComponent(enfoque)}&resultType=${encodeURIComponent(resultType)}`
    );
  } catch (error) {
    rethrowQuizPersistenceError(error, 'QUIZ_COVERAGE_STORE_UNAVAILABLE');
  }
  const results = Array.isArray(res.results) ? res.results : [];
  return results.map((result: MaterialResult) => ({
    ...result,
    payload: typeof result.payload === 'string'
      ? (() => { try { return JSON.parse(result.payload); } catch { return result.payload; } })()
      : result.payload,
  }));
}

export async function insertImmutableQuizResult(data: {
  id: string;
  material_id: string;
  payload: any;
  content_hash: string;
}): Promise<{ applied: boolean; result: any }> {
  let res;
  try {
    res = await apiPost('/material-results/quiz-result-insert', data);
  } catch (error) {
    rethrowQuizPersistenceError(error, 'QUIZ_COMPLETION_STORE_UNAVAILABLE');
  }
  const result = res.result;
  if (!result) throw new Error('DB insertImmutableQuizResult: result vacío');
  return {
    applied: res.applied === true,
    result: typeof result.payload === 'string'
      ? (() => { try { return JSON.parse(result.payload); } catch { return result.payload; } })()
      : result.payload,
  };
}

export interface QuizGenerationCasPayload {
  identity: string;
  expectedArtifactRevision: string | null;
  expectedManifestRevision: string | null;
  revision: string;
  artifact: Record<string, unknown>;
  manifest: Record<string, unknown>;
}

/** Atomically advances the frozen Quiz artifact and its manifest under one revision. */
export async function compareAndSwapQuizGeneration(
  data: QuizGenerationCasPayload,
): Promise<{ applied: boolean }> {
  let res;
  try {
    res = await apiPost('/material-results/quiz-generation-cas', data);
  } catch (error) {
    rethrowQuizPersistenceError(error, 'QUIZ_GENERATION_STORE_UNAVAILABLE');
  }
  return { applied: res.applied === true };
}

export async function saveMaterialResult(data: {
  /**
   * Optional STABLE row id. The Worker's upsert conflicts on `id` alone
   * (`ON CONFLICT(id) DO UPDATE`) — omitting it makes the server mint a
   * fresh random id on every call, so repeated saves for the SAME
   * logical record (material_id+enfoque+result_type) accumulate as
   * separate rows instead of updating one. Callers that save the same
   * logical record more than once (e.g. Material Brain, which persists
   * a placeholder, checkpoint flushes, and a final result for the same
   * fingerprint) MUST pass a deterministic id derived from that logical
   * identity so every save updates the SAME row.
   */
  id?: string;
  material_id: string;
  enfoque: EnfoqueType;
  result_type: ResultType;
  payload: any;
  content_hash?: string;
}): Promise<MaterialResult> {
  const res = await apiPost('/material-results/upsert', data);
  const result = res.result;

  if (!result) throw new Error('DB saveMaterialResult: result vacío');

  return {
    ...result,
    payload: typeof result.payload === 'string'
      ? (() => { try { return JSON.parse(result.payload); } catch { return result.payload; } })()
      : result.payload,
  };
}

// ═══ JOBS ═══

export async function createJob(
  materialId: string,
  type: 'extract_text',
): Promise<MaterialJob> {
  const res = await apiPost('/material-jobs/upsert', {
    material_id: materialId,
    type,
    status: 'queued',
    attempts: 0,
  });

  if (!res.job) throw new Error('DB createJob: job vacío');
  return res.job;
}

export async function getJob(id: string): Promise<MaterialJob | null> {
  return null;
}

export async function updateJob(
  id: string,
  updates: Partial<Pick<MaterialJob, 'status' | 'error' | 'attempts'>>,
): Promise<void> {
  await apiPost('/material-jobs/upsert', {
    id,
    material_id: 'unknown',
    type: 'extract_text',
    ...updates,
  });
}

// ═══ HARD DELETE =====
export async function hardDeleteMaterial(
  id: string,
  userId: string,
): Promise<void> {
  await softDeleteMaterial(id, userId);
}
