// Single authority for "delete a tema and everything that belongs to it".
// Called only from app/api/materias/tema/[id]/route.ts with a server-derived
// userId (never a client-supplied one). Idempotent: safe to call again on a
// temaId whose materials/sessions are already gone — those simply resolve to
// empty lists and no-op deletes.
import { getMaterialsByTema, hardDeleteMaterial } from './repository';
import { deleteFromR2 } from './storage';
import { getSessionIdsByTemaServer, deleteStudySessionServer } from '../studySessions.server';
import { getMateriaTemaIdsServer } from '../materias.server';

export interface TemaCascadeResult {
  materialsTotal: number;
  materialsDeleted: number;
  sessionsTotal: number;
  sessionsDeleted: number;
  materialErrors: string[];
  sessionErrors: string[];
}

export async function deleteTemaCascade(
  temaId: string,
  userId: string,
): Promise<TemaCascadeResult> {
  const materials = await getMaterialsByTema(temaId, userId);
  const materialErrors: string[] = [];
  let materialsDeleted = 0;

  for (const material of materials) {
    try {
      // Metadata primero: si R2 falla después, queda un objeto huérfano
      // recuperable en R2, nunca metadata activa apuntando a un asset
      // borrado — mismo orden que app/api/materials/[id]/route.ts.
      await hardDeleteMaterial(material.id, userId);
      materialsDeleted++;
    } catch {
      materialErrors.push(material.id);
      continue;
    }
    if (!material.storage_key) continue; // materiales Web no tienen objeto R2
    try {
      await deleteFromR2(material.storage_key);
    } catch (e: any) {
      console.warn(`⚠️ tema cascade: R2 delete warning for ${material.storage_key}: ${e?.message}`);
    }
  }

  const sessionIds = await getSessionIdsByTemaServer(temaId, userId);
  const sessionErrors: string[] = [];
  let sessionsDeleted = 0;

  for (const id of sessionIds) {
    try {
      await deleteStudySessionServer(id, userId);
      sessionsDeleted++;
    } catch {
      sessionErrors.push(id);
    }
  }

  return {
    materialsTotal: materials.length,
    materialsDeleted,
    sessionsTotal: sessionIds.length,
    sessionsDeleted,
    materialErrors,
    sessionErrors,
  };
}

export interface MateriaCascadeResult {
  temasTotal: number;
  temaResults: Record<string, TemaCascadeResult>;
}

// Misma autoridad que deleteTemaCascade — una materia es solo "todos sus
// temas", así que borrar una materia es aplicar deleteTemaCascade a cada uno
// de sus temas. temaIds se resuelve server-side desde el blob canónico de
// materias (nunca desde una lista que mande el cliente).
export async function deleteMateriaCascade(
  materiaId: string,
  userId: string,
): Promise<MateriaCascadeResult> {
  const temaIds = await getMateriaTemaIdsServer(materiaId, userId);
  const temaResults: Record<string, TemaCascadeResult> = {};

  for (const temaId of temaIds) {
    temaResults[temaId] = await deleteTemaCascade(temaId, userId);
  }

  return { temasTotal: temaIds.length, temaResults };
}
