// Server-only: resolve which temaIds belong to a materia, straight from the
// canonical materias blob in D1 — never trusts a client-supplied tema list,
// so a materia cascade can't be tricked into skipping (or targeting) temas.
import { workerAuthHeaders } from './worker/auth';

const API = process.env.STUDYAL_API_URL || '';

export async function getMateriaTemaIdsServer(
  materiaId: string,
  userId: string,
): Promise<string[]> {
  if (!API) return [];
  const res = await fetch(
    `${API}/materias/by-user?userId=${encodeURIComponent(userId)}`,
    { cache: 'no-store', headers: workerAuthHeaders() },
  );
  if (!res.ok) throw new Error(`MATERIAS_BY_USER_FAILED:${res.status}`);
  const json = await res.json().catch(() => ({}));
  if (json?.ok === false) {
    throw new Error(`MATERIAS_BY_USER_REJECTED:${json?.error || 'unknown'}`);
  }
  const materias = Array.isArray(json.materias) ? json.materias : [];
  const materia = materias.find((m: any) => String(m?.id || '') === materiaId);
  if (!materia) return [];
  const temas = Array.isArray(materia.temas) ? materia.temas : [];
  return temas.map((t: any) => String(t?.id || '')).filter(Boolean);
}
