import type { StudySession } from './studySessions';
import { getSessionById, updateSessionById } from './studySessions';

export type DurableFreeTool = 'quiz' | 'exam' | 'flashcards' | 'repasar' | 'alai' | 'analysis' | 'studymap' | 'truquitos';

// ═══════════════════════════════════════════════════════════════
// FREE MODE PROGRESS — canonical contract (2026 simplification).
//
// "¿Qué parte del ecosistema Free ya utilizó el estudiante para esta
// selección de fuente exacta?" — NOT mastery, NOT score, NOT completion.
//
// A tool contributes its FULL cap the first time it is used successfully
// (a valid envelope with genuinely-generated content exists for THIS exact
// session + sourceSelectionFingerprint), or 0 if it hasn't. There is no
// partial credit and no separate "quality" axis — deliberately simple.
//
// Idempotent and leak-free BY CONSTRUCTION: this reads the SAME
// FreeToolStateEnvelope authority used for durable continuity restore —
// there is no separate counter to accidentally increment, and envelopes
// are already scoped to the exact (sessionId, sourceSelectionFingerprint)
// pair via validOwner(), so a different page selection of the same
// materials (different fingerprint => different session) never shares
// progress. Regenerating/reopening/refreshing just re-reads the same
// envelope — the percentage cannot change without a genuinely NEW tool
// being used for the first time.
export const FREE_PROCESS_TOOL_CAPS: Record<DurableFreeTool, number> = {
  alai: 5,
  studymap: 7,
  truquitos: 8,
  analysis: 10,
  repasar: 15,
  quiz: 16,
  flashcards: 18,
  exam: 21,
};

const FREE_PROCESS_TOOL_ORDER: DurableFreeTool[] = Object.keys(FREE_PROCESS_TOOL_CAPS) as DurableFreeTool[];

function isToolEnvelopeMeaningfullyUsed(tool: DurableFreeTool, state: any): boolean {
  switch (tool) {
    case 'flashcards':
      return Array.isArray(state?.cards) && state.cards.length > 0;
    case 'quiz':
      return Array.isArray(state?.questions) && state.questions.length > 0;
    case 'exam':
      return Boolean(state?.exam);
    case 'repasar':
      return Boolean(state?.phase) && state.phase !== 'preview';
    case 'studymap':
      return Boolean(state?.mapData);
    case 'truquitos':
      return Array.isArray(state?.cards) && state.cards.length > 0;
    case 'analysis': {
      const byType = state?.resultsByType && typeof state.resultsByType === 'object' ? state.resultsByType : {};
      return Object.values(byType).some((entry: any) => entry?.status === 'completed');
    }
    case 'alai': {
      const messages = Array.isArray(state?.messages) ? state.messages : [];
      const hasUserQuestion = messages.some((m: any) => m?.role === 'user');
      const hasRealAnswer = messages.some((m: any) => m?.role === 'assistant' && m?.id !== 'alai-welcome-v1');
      return hasUserQuestion && hasRealAnswer;
    }
    default:
      return false;
  }
}

export interface FreeProcessProgress {
  totalPercent: number;
  byTool: Record<DurableFreeTool, boolean>;
}

export function computeFreeProcessProgress(
  session: StudySession | null | undefined,
): FreeProcessProgress {
  const byTool = {} as Record<DurableFreeTool, boolean>;
  let total = 0;
  for (const tool of FREE_PROCESS_TOOL_ORDER) {
    const envelope = session?.notes?.freeTools?.[tool] as FreeToolStateEnvelope | undefined;
    const owned = Boolean(
      envelope
        && envelope.version === 1
        && envelope.tool === tool
        && session
        && envelope.sessionId === session.id
        && envelope.sourceSelectionFingerprint === session.sourceSelectionFingerprint,
    );
    const used = owned && isToolEnvelopeMeaningfullyUsed(tool, (envelope as FreeToolStateEnvelope).state);
    byTool[tool] = used;
    if (used) total += FREE_PROCESS_TOOL_CAPS[tool];
  }
  return { totalPercent: Math.min(100, total), byTool };
}

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
