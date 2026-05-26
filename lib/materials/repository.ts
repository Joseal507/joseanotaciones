import { createClient } from '@supabase/supabase-js';
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

function getDB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
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
  const db = getDB();
  const { data: material, error } = await db
    .from('materials')
    .insert(data)
    .select()
    .single();
  if (error) throw new Error(`DB createMaterial: ${error.message}`);
  return material;
}

export async function getMaterial(
  id: string,
  userId: string,
): Promise<Material | null> {
  const db = getDB();
  const { data, error } = await db
    .from('materials')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  if (error) return null;
  return data;
}

export async function getMaterialsByTema(
  temaId: string,
  userId: string,
): Promise<Material[]> {
  const db = getDB();
  const { data, error } = await db
    .from('materials')
    .select('*')
    .eq('tema_id', temaId)
    .eq('user_id', userId)
    .eq('upload_status', 'uploaded')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`DB getMaterialsByTema: ${error.message}`);
  return data ?? [];
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
  const db = getDB();
  const { error } = await db
    .from('materials')
    .update({ text_status: status, ...extra })
    .eq('id', id);
  if (error) throw new Error(`DB updateTextStatus: ${error.message}`);
}

export async function softDeleteMaterial(
  id: string,
  userId: string,
): Promise<void> {
  const db = getDB();
  const { error } = await db
    .from('materials')
    .update({ upload_status: 'deleted' })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw new Error(`DB softDelete: ${error.message}`);
}

// ═══ MATERIAL TEXTS ═══

export async function getMaterialText(
  materialId: string,
): Promise<MaterialText | null> {
  const db = getDB();
  const { data, error } = await db
    .from('material_texts')
    .select('*')
    .eq('material_id', materialId)
    .single();
  if (error) return null;
  return data;
}

export async function saveMaterialText(
  materialId: string,
  rawText: string,
): Promise<void> {
  const db = getDB();
  const { error } = await db
    .from('material_texts')
    .upsert({
      material_id: materialId,
      raw_text: rawText,
      updated_at: new Date().toISOString(),
    });
  if (error) throw new Error(`DB saveMaterialText: ${error.message}`);
}

// ═══ MATERIAL RESULTS ═══

export async function getMaterialResult(
  materialId: string,
  enfoque: EnfoqueType,
  resultType: ResultType,
): Promise<MaterialResult | null> {
  const db = getDB();
  const { data, error } = await db
    .from('material_results')
    .select('*')
    .eq('material_id', materialId)
    .eq('enfoque', enfoque)
    .eq('result_type', resultType)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data;
}

export async function saveMaterialResult(data: {
  material_id: string;
  enfoque: EnfoqueType;
  result_type: ResultType;
  payload: any;
  content_hash?: string;
}): Promise<MaterialResult> {
  const db = getDB();
  const id = 'res_' + Date.now() + Math.random().toString(36).slice(2, 8);
  const { data: result, error } = await db
    .from('material_results')
    .insert({ id, ...data })
    .select()
    .single();
  if (error) throw new Error(`DB saveMaterialResult: ${error.message}`);
  return result;
}

// ═══ JOBS ═══

export async function createJob(
  materialId: string,
  type: 'extract_text',
): Promise<MaterialJob> {
  const db = getDB();
  const id = 'job_' + Date.now() + Math.random().toString(36).slice(2, 8);
  const { data, error } = await db
    .from('material_jobs')
    .insert({ id, material_id: materialId, type })
    .select()
    .single();
  if (error) throw new Error(`DB createJob: ${error.message}`);
  return data;
}

export async function getJob(id: string): Promise<MaterialJob | null> {
  const db = getDB();
  const { data, error } = await db
    .from('material_jobs')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return null;
  return data;
}

export async function updateJob(
  id: string,
  updates: Partial<Pick<MaterialJob, 'status' | 'error' | 'attempts'>>,
): Promise<void> {
  const db = getDB();
  const { error } = await db
    .from('material_jobs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`DB updateJob: ${error.message}`);
}

// ═══ HARD DELETE (borra filas, cascadea textos y resultados) ═══
export async function hardDeleteMaterial(
  id: string,
  userId: string,
): Promise<void> {
  const db = getDB();
  const { error } = await db
    .from('materials')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw new Error(`DB hardDelete: ${error.message}`);
}
