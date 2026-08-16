import type { StudySession } from './studySessions';
import { getSessionById, updateSessionById } from './studySessions';

// ═══════════════════════════════════════════════════════════════════
// MANUAL MODE — Herramientas durables
// Paralelo a DurableFreeTool pero con las 6 herramientas del Modo Manual.
// Persiste dentro de StudySession.notes.manualTools[tool] con contrato
// idéntico a FreeToolStateEnvelope.
// ═══════════════════════════════════════════════════════════════════

export type DurableManualTool = 'leer' | 'alai' | 'flashcards' | 'quizzes' | 'resumen' | 'examen';

export const MANUAL_TOOL_CAPS: Record<DurableManualTool, number> = {
  leer: 15,        // Leer el material
  alai: 10,        // ALAI Chat
  flashcards: 20,  // Crear flashcards manualmente
  quizzes: 20,     // Crear quizzes manualmente
  resumen: 20,     // Mi resumen (split view)
  examen: 15,      // Examen manual
};
// Total: 100

export const MANUAL_TOOL_IDS: DurableManualTool[] = ['leer', 'alai', 'flashcards', 'quizzes', 'resumen', 'examen'];

export interface ManualToolStateEnvelope<T = unknown> {
  version: 1;
  tool: DurableManualTool;
  sessionId: string;
  sourceSelectionFingerprint: string;
  revision: number;
  updatedAt: number;
  state: T;
}

function validOwner(
  session: StudySession | null,
  sessionId: string,
  fingerprint: string,
): session is StudySession {
  return Boolean(
    session
      && session.id === sessionId
      && session.processMode === 'manual'
      && session.sourceSelectionFingerprint === fingerprint,
  );
}

export function readManualToolState<T>(
  sessionId: string | null | undefined,
  fingerprint: string,
  tool: DurableManualTool,
): ManualToolStateEnvelope<T> | null {
  if (!sessionId || !fingerprint) return null;
  const session = getSessionById(sessionId);
  if (!validOwner(session, sessionId, fingerprint)) return null;
  const candidate = (session.notes as any)?.manualTools?.[tool] as ManualToolStateEnvelope<T> | undefined;
  if (
    !candidate
    || candidate.version !== 1
    || candidate.tool !== tool
    || candidate.sessionId !== sessionId
    || candidate.sourceSelectionFingerprint !== fingerprint
    || !Number.isFinite(candidate.revision)
  ) return null;
  return candidate;
}

export function writeManualToolState<T>(
  sessionId: string | null | undefined,
  fingerprint: string,
  tool: DurableManualTool,
  state: T,
): ManualToolStateEnvelope<T> | null {
  if (!sessionId || !fingerprint) return null;
  let written: ManualToolStateEnvelope<T> | null = null;
  updateSessionById(sessionId, session => {
    if (!validOwner(session, sessionId, fingerprint)) return session;
    const previous = (session.notes as any)?.manualTools?.[tool] as ManualToolStateEnvelope<T> | undefined;
    written = {
      version: 1,
      tool,
      sessionId,
      sourceSelectionFingerprint: fingerprint,
      revision: Math.max(0, Number(previous?.revision || 0)) + 1,
      updatedAt: Date.now(),
      state,
    };
    return {
      ...session,
      notes: {
        ...(session.notes || {}),
        manualTools: {
          ...((session.notes as any)?.manualTools || {}),
          [tool]: written,
        },
      },
    };
  });
  return written;
}
