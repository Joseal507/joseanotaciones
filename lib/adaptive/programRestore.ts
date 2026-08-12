import type { StudySession } from '../studySessions'

export type ProgramRestoreState =
  | 'UNKNOWN'
  | 'RESTORING'
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
