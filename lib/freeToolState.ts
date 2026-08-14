import type { StudySession } from './studySessions';
import { getSessionById, updateSessionById } from './studySessions';

export type DurableFreeTool = 'quiz' | 'exam' | 'flashcards' | 'repasar' | 'alai' | 'analysis';

export interface FreeToolStateEnvelope<T = unknown> {
  version: 1;
  tool: DurableFreeTool;
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
      && session.processMode === 'free'
      && session.sourceSelectionFingerprint === fingerprint,
  );
}

export function readFreeToolState<T>(
  sessionId: string | null | undefined,
  fingerprint: string,
  tool: DurableFreeTool,
): FreeToolStateEnvelope<T> | null {
  if (!sessionId || !fingerprint) return null;
  const session = getSessionById(sessionId);
  if (!validOwner(session, sessionId, fingerprint)) return null;
  const candidate = session.notes?.freeTools?.[tool] as FreeToolStateEnvelope<T> | undefined;
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

export function writeFreeToolState<T>(
  sessionId: string | null | undefined,
  fingerprint: string,
  tool: DurableFreeTool,
  state: T,
): FreeToolStateEnvelope<T> | null {
  if (!sessionId || !fingerprint) return null;
  let written: FreeToolStateEnvelope<T> | null = null;
  updateSessionById(sessionId, session => {
    if (!validOwner(session, sessionId, fingerprint)) return session;
    const previous = session.notes?.freeTools?.[tool] as FreeToolStateEnvelope<T> | undefined;
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
        freeTools: {
          ...(session.notes?.freeTools || {}),
          [tool]: written,
        },
      },
    };
  });
  return written;
}
