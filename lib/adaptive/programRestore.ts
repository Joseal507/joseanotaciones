import type { StudySession } from '../studySessions'

export type ProgramRestoreState =
  | 'UNKNOWN'
  | 'RESTORING'
  | 'RESTORE_ERROR'
  | 'FOUND_VALID_PROGRAM'
  | 'FOUND_PARTIAL_PROGRAM'
  | 'NOTHING_EXISTS'

export function classifyPersistedAdaptiveProgram(session: StudySession | null | undefined): ProgramRestoreState {
  if (!session) return 'NOTHING_EXISTS'
  const hasSetup = Boolean(session.adaptiveSetup?.completedAt)
  const hasBlueprint = Boolean(session.blueprint)
  const hasJourney = Boolean(session.journey && Array.isArray(session.journey.chapters) && session.journey.chapters.length)
  if (hasSetup && hasBlueprint && hasJourney) return 'FOUND_VALID_PROGRAM'
  if (hasSetup || hasBlueprint || hasJourney || session.adaptiveState === 'generating' || session.adaptiveState === 'ready') {
    return 'FOUND_PARTIAL_PROGRAM'
  }
  return 'NOTHING_EXISTS'
}

export function mayGenerateAfterRestore(state: ProgramRestoreState): boolean {
  return state === 'NOTHING_EXISTS'
}

export function shouldResumePreparation(state: ProgramRestoreState): boolean {
  return state === 'FOUND_PARTIAL_PROGRAM'
}

export interface PersistedProgramLookup<T> {
  status: 'FOUND' | 'ABSENT' | 'ERROR'
  sessions: T[]
  error?: string
}

export function restoreStateFromLookup<T extends StudySession>(
  lookup: PersistedProgramLookup<T>,
  session: T | null | undefined,
): ProgramRestoreState {
  if (lookup.status === 'ERROR') return 'RESTORE_ERROR'
  return classifyPersistedAdaptiveProgram(session)
}

export function selectPersistedAdaptiveProgram<T extends StudySession>(
  sessions: T[],
  criteria: { sessionId?: string; materialIds?: string[]; sourceSelectionFingerprint?: string },
): T | null {
  const adaptive = sessions.filter(session => session.processMode === 'adaptive')
  if (criteria.sessionId) {
    return adaptive.find(session => session.id === criteria.sessionId) || null
  }
  const requestedIds = new Set((criteria.materialIds || []).map(String).filter(Boolean))
  const candidates = adaptive.filter(session => {
    if (criteria.sourceSelectionFingerprint) {
      return session.sourceSelectionFingerprint === criteria.sourceSelectionFingerprint
    }
    if (!requestedIds.size) return true
    const persistedIds = new Set(session.materialIds || [])
    return [...requestedIds].every(id => persistedIds.has(id))
  })
  const score = (session: T) => {
    const classification = classifyPersistedAdaptiveProgram(session)
    const completeness = classification === 'FOUND_VALID_PROGRAM' ? 100 : classification === 'FOUND_PARTIAL_PROGRAM' ? 50 : 0
    return completeness + Number(session.lastOpenedAt || 0) / 1e15
  }
  return candidates.sort((left, right) => score(right) - score(left))[0] || null
}
