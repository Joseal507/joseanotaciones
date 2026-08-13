import assert from 'node:assert/strict'
import { mayGenerateAfterRestore, restoreStateFromLookup, selectPersistedAdaptiveProgram, type ProgramRestoreState } from '../../lib/adaptive/programRestore'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import type { StudySession } from '../../lib/studySessions'

const setup = { knowledgeLevel: 'never_seen' as const, examDateType: 'just_studying' as const, targetScore: 80, mainConcern: '', professorExamStyle: [], evalPreference: 'quick_test' as const, planView: 'book' as const, completedAt: 1 }

function program(count: number, suffix = ''): StudySession {
  const materialIds = Array.from({ length: count }, (_, index) => `material-${index + 1}`)
  const selectedPages = Object.fromEntries(materialIds.map((id, index) => [id, [index + 1, index + 3]]))
  const source = buildSourceSelectionSnapshot(materialIds, selectedPages)
  return {
    id: `program-${count}${suffix}`, userId: 'user-1', temaId: 'tema-1', enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
    materialIds: source.materialIds, materialNames: materialIds, selectedPages: source.selectedPages, sourceSelectionFingerprint: source.fingerprint,
    adaptiveSetup: setup, setupHash: 'setup-1', blueprint: { id: `blueprint-${count}`, version: 3, blocks: [{ id: 'block-1' }] },
    journey: { id: `journey-${count}`, chapters: [{ id: 'chapter-1', chapterNumber: 1 }] },
    sessionContent: { 1: { id: `content-${count}`, preparationStatus: 'ready' } }, sessionPreparation: { 2: { status: 'teaching_ready' } },
    currentSessionNumber: 1, currentStep: 3, adaptiveState: 'ready', status: 'in_progress', createdAt: 1, lastOpenedAt: 100 + count,
  }
}

for (const state of ['UNKNOWN', 'RESTORING', 'RESTORE_ERROR', 'FOUND_VALID_PROGRAM', 'FOUND_PARTIAL_PROGRAM'] as ProgramRestoreState[]) {
  assert.equal(mayGenerateAfterRestore(state), false, `${state} must never authorize generation`)
}
assert.equal(mayGenerateAfterRestore('NOTHING_EXISTS'), true)
for (const failure of ['timeout', 'network', '500', '503', 'malformed']) {
  assert.equal(restoreStateFromLookup({ status: 'ERROR', sessions: [], error: failure }, null), 'RESTORE_ERROR')
}

const programs = Array.from({ length: 5 }, (_, index) => program(index + 1))
for (let count = 1; count <= 5; count++) {
  const existing = programs[count - 1]
  const exact = selectPersistedAdaptiveProgram(programs, { sourceSelectionFingerprint: existing.sourceSelectionFingerprint })
  assert.equal(exact?.id, existing.id)
  assert.equal(exact?.journey.id, `journey-${count}`)
  assert.equal(exact?.blueprint.id, `blueprint-${count}`)
  assert.deepEqual(exact?.selectedPages, existing.selectedPages)
  assert.equal(exact?.currentStep, 3)
}

const multi = programs[4]
assert.equal(selectPersistedAdaptiveProgram([multi], { materialIds: ['material-1'] })?.id, multi.id)
assert.equal(selectPersistedAdaptiveProgram([multi], { sessionId: multi.id })?.id, multi.id)
assert.equal(selectPersistedAdaptiveProgram([multi], { sessionId: 'explicit-new-program' }), null)
const changed = buildSourceSelectionSnapshot(multi.materialIds, { ...multi.selectedPages, 'material-1': [1, 3, 7] })
assert.notEqual(changed.fingerprint, multi.sourceSelectionFingerprint)
assert.equal(selectPersistedAdaptiveProgram([multi], { sourceSelectionFingerprint: changed.fingerprint }), null)

const partial = { ...program(2, '-partial'), blueprint: undefined, adaptiveState: 'generating' as const }
assert.equal(restoreStateFromLookup({ status: 'FOUND', sessions: [partial] }, partial), 'FOUND_PARTIAL_PROGRAM')
assert.ok(selectPersistedAdaptiveProgram([partial], { sessionId: partial.id })?.sessionPreparation?.[2])
const complete = { ...program(2, '-complete'), status: 'completed' as const, adaptiveState: 'completed' as const, isProgramComplete: true }
assert.equal(selectPersistedAdaptiveProgram([complete], { sessionId: complete.id })?.isProgramComplete, true)

console.log('adaptive-existing-program-restore-contracts: A-W PASS; 1-5 materials; restore errors never become ABSENT; identities unchanged')
