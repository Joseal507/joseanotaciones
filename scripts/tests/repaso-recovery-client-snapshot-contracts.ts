import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Client-side atomic group-snapshot fix. applyRecoveryGroupSnapshot lives in
// the client component (not exported from the route module); this contract
// re-implements it in lockstep with source assertions, matching the pattern
// already used by repaso-recovery-feedback-restore-contracts.ts for this
// same file.

const ui = readFileSync('components/materias/ALAIStudyALRepasar.tsx', 'utf8')

function testHelperExistsAndIsUsedAtSubmit() {
  assert.match(ui, /function applyRecoveryGroupSnapshot\(/)
  const submitSection = ui.slice(ui.indexOf('const submitRecovery = async'), ui.indexOf('const continueAfterRecoveryFeedback'))
  assert.match(submitSection, /const snapshot = applyRecoveryGroupSnapshot\(view, next\)/,
    'submitRecovery must route the response through the atomic snapshot helper, never a raw {...view, ...next} merge')
  assert.match(submitSection, /setView\(\{ \.\.\.next, \.\.\.snapshot \}\)/)
}

function testServerContractDocumentedInline() {
  // The server-side fix this depends on: the answer response snapshots the
  // ANSWERED group, and nextGroupId is a separate signal.
  const routeFile = readFileSync('app/api/alai-studyal-repasar/route.ts', 'utf8')
  const answerSection = routeFile.slice(routeFile.indexOf("body?.kind === 'repaso-recovery-answer'"), routeFile.indexOf("body?.kind === 'repaso-final-open'"))
  assert.match(answerSection, /groupId: targetGroup\.groupId,/, 'answer response must snapshot the answered group, not nextCurrent')
  assert.match(answerSection, /question: targetGroup\.question,/)
  assert.match(answerSection, /nextGroupId: nextCurrent\?\.groupId \|\| null,/)
}

/* ------------------------------------------------------------------ */
/* Behavioral re-implementation, exercised directly                    */
/* ------------------------------------------------------------------ */

interface Snapshot {
  groupId?: string
  question?: string
  pagesToReview?: number[]
  recoveryMaterialId?: string
}

function applyRecoveryGroupSnapshot(previous: Snapshot | null | undefined, incoming: Snapshot): Snapshot {
  const hasGroupIdentity = Boolean(incoming.groupId)
  const hasQuestion = Boolean(incoming.question)
  if (hasGroupIdentity && !hasQuestion) {
    return {
      groupId: previous?.groupId,
      question: previous?.question,
      pagesToReview: previous?.pagesToReview,
      recoveryMaterialId: previous?.recoveryMaterialId,
    }
  }
  return {
    groupId: incoming.groupId,
    question: incoming.question,
    pagesToReview: incoming.pagesToReview,
    recoveryMaterialId: incoming.recoveryMaterialId,
  }
}

function testConsistentResponseIsApplied() {
  const prev: Snapshot = { groupId: 'A', question: 'Question A', pagesToReview: [7], recoveryMaterialId: 'm1' }
  const incoming: Snapshot = { groupId: 'A', question: 'Question A', pagesToReview: [7], recoveryMaterialId: 'm1' }
  const result = applyRecoveryGroupSnapshot(prev, incoming)
  assert.deepEqual(result, incoming)
}

function testGroupIdWithoutQuestionIsRefused() {
  // The exact regression shape: an incoming payload carries a DIFFERENT
  // groupId (B) but no matching question — this must NEVER be allowed to
  // pair with the previous (A) question, and must NEVER silently adopt B's
  // id while keeping A's stale question either. The only safe move is to
  // keep the last fully-consistent snapshot untouched.
  const prev: Snapshot = { groupId: 'A', question: 'Question A', pagesToReview: [7], recoveryMaterialId: 'm1' }
  const malformed: Snapshot = { groupId: 'B', question: undefined, pagesToReview: [9], recoveryMaterialId: 'm1' }
  const result = applyRecoveryGroupSnapshot(prev, malformed)
  assert.equal(result.groupId, 'A', 'must not adopt the new groupId without its matching question')
  assert.equal(result.question, 'Question A', 'must not silently keep the old question paired with a new groupId either — snapshot stays fully on A')
  assert.deepEqual(result.pagesToReview, [7], 'pages must also stay from the last consistent snapshot, not the malformed payload')
}

function testGroupResolvedButNextGroupIdMustNotLeakIntoSnapshot() {
  // Exact scenario from the task: prev = Group A; the answer response
  // reports groupResolved:true and nextGroupId:B, but its OWN
  // groupId/question snapshot must still be A's (per the server contract).
  const prev: Snapshot = { groupId: 'A', question: 'Question A', pagesToReview: [7], recoveryMaterialId: 'm1' }
  const response = { groupId: 'A', question: 'Question A', pagesToReview: [7], recoveryMaterialId: 'm1', groupResolved: true, nextGroupId: 'B' } as Snapshot & { groupResolved: boolean; nextGroupId: string }
  const result = applyRecoveryGroupSnapshot(prev, response)
  assert.equal(result.groupId, 'A')
  assert.equal(result.question, 'Question A')
  assert.notEqual(result.groupId, 'B', 'nextGroupId must never leak into the active groupId before Continue')
}

function testContinueAppliesGroupBAtomically() {
  // Once Continue calls repaso-recovery-open, the WHOLE new group unit
  // (id + question + pages) comes from ONE response and replaces the
  // previous snapshot atomically.
  const prev: Snapshot = { groupId: 'A', question: 'Question A', pagesToReview: [7], recoveryMaterialId: 'm1' }
  const openBResponse: Snapshot = { groupId: 'B', question: 'Question B', pagesToReview: [9], recoveryMaterialId: 'm1' }
  const result = applyRecoveryGroupSnapshot(prev, openBResponse)
  assert.deepEqual(result, openBResponse)
}

function main() {
  testHelperExistsAndIsUsedAtSubmit()
  testServerContractDocumentedInline()
  testConsistentResponseIsApplied()
  testGroupIdWithoutQuestionIsRefused()
  testGroupResolvedButNextGroupIdMustNotLeakIntoSnapshot()
  testContinueAppliesGroupBAtomically()
  console.log('repaso-recovery-client-snapshot-contracts: ALL PASS')
}

main()
