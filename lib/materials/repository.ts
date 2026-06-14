import type {
  Material,
  MaterialText,
  MaterialResult,
  MaterialJob,
  MaterialKind,
  TextStatus,
  EnfoqueType,
  ResultType,
} from './types';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';

async function apiGet(path: string) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(`${API}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost(path: string, body: any) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
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
}): Promise<Material> {
  const res = await apiPost('/materials/upsert', {
    ...data,
    upload_status: 'uploaded',
    text_status: 'pending',
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
  status: TextStatus,
  extra?: {
    extracted_chars?: number;
    pages_count?: number;
    last_error?: string;
  },
): Promise<void> {
  await apiPost('/materials/update', {
    id,
    text_status: status,
    ...(extra || {}),
  });
}

export async function softDeleteMaterial(
  id: string,
  userId: string,
): Promise<void> {
  await apiPost('/materials/delete', { id, user_id: userId });
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

export async function saveMaterialResult(data: {
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
