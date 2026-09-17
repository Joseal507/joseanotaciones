import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { buildExamEnjoyerUniverse, composeEnjoyerExamBlueprint, computeExamEnjoyerTimeBounds } from '../../lib/materialBrain/examEnjoyerContext'

// EXAM_PRODUCT_CORRECTION: reproduces the exact live-reported incident
// shape — a 51-target canonical universe assessed at several durations.
// The PREVIOUS version of this fixture required 100% coverage at EVERY
// duration and rewarded multi-target compression to get there — exactly
// the audit-identified defect (EXAM_PRODUCT_AUDIT_RECOMMENDATION §5/§10:
// "the 51-target fixture requires 100% at every tested duration and
// rewards multi-target compression"). THE USER CHOOSES THE DURATION — it
// is still never overridden — but a fixed, short duration now legitimately
// assesses FEWER than all 51 targets, with every omission honestly
// accounted for as `notAssessedDueToScopeTargetIds`, never disguised as
// complete or dropped silently.

const selection = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3, 4, 5, 6] }), fingerprint: 'fp-51' }
const kinds = ['concept', 'formula', 'process', 'data', 'fact']
const types = ['multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer']

const items = Array.from({ length: 51 }, (_, index) => ({
  id: `target-${index}`,
  kind: kinds[index % kinds.length],
  name: `Elemento ${index}`,
  content: `Contenido académico autorizado número ${index}`,
  importance: index % 7 === 0 ? 'high' : index % 3 === 0 ? 'low' : 'medium',
  difficulty: index % 5 === 0 ? 'advanced' : 'medium',
  examTypes: [types[index % types.length]],
  topicId: `topic-${index % 4}`,
  materialId: 'mat-a',
  pages: [(index % 6) + 1],
  sourceSpans: [{ page: (index % 6) + 1, quote: `evidencia ${index}` }],
}))

const payload = {
  sourceSelectionFingerprint: 'fp-51', materialIds: ['mat-a'], selectedPages: { 'mat-a': [1, 2, 3, 4, 5, 6] },
  topicsIndex: [
    { id: 'topic-0', title: 'Tema 0' }, { id: 'topic-1', title: 'Tema 1' },
    { id: 'topic-2', title: 'Tema 2' }, { id: 'topic-3', title: 'Tema 3' },
  ],
  globalOrderedAnalysis: items,
  uniqueConceptsIndex: [],
}

function assertFullCoverage(universe: ReturnType<typeof buildExamEnjoyerUniverse>, minutes: number) {
  const blueprint = composeEnjoyerExamBlueprint(universe, minutes, `exam-${minutes}`, `seed-${minutes}`)
  const { assessedTargetIds, contextOnlyTargetIds, notAssessedDueToScopeTargetIds, totalUniverseTargets, coverageStatus, assessedCoveragePercent } = blueprint.coverage

  assert.equal(totalUniverseTargets, 51)
  const accounted = [...assessedTargetIds, ...contextOnlyTargetIds, ...notAssessedDueToScopeTargetIds]
  assert.equal(accounted.length, 51)
  assert.equal(new Set(accounted).size, 51)
  assert.equal(assessedCoveragePercent, Math.round(assessedTargetIds.length / 51 * 10000) / 100)
  assert.equal(coverageStatus, assessedTargetIds.length === 51 ? 'complete' : 'scoped_sample')

  // Slots validation: every single-decision slot caps context at 2
  for (const slot of blueprint.slots) {
    if (slot.type === 'matching' || slot.type === 'multi_select') {
      assert.ok(slot.assessedTargetIds.length >= 2, 'matching/multi-select must assess multiple targets')
    } else if (slot.assessedTargetIds.length === 1) {
      assert.ok(slot.contextTargetIds.length <= 2, `slot ${slot.id} must cap context targets at 2`)
    }
  }

  // Duration is respected
  assert.equal(blueprint.requestedDurationMinutes, minutes)
  assert.equal(blueprint.durationMinutes, minutes)
  assert.equal(blueprint.effectiveDurationMinutes, minutes)
  const totalEstimatedSeconds = blueprint.slots.reduce((sum, slot) => sum + slot.estimatedSeconds, 0)
  assert.ok(totalEstimatedSeconds <= minutes * 60 * 0.85, `sum(estimatedSeconds)=${totalEstimatedSeconds}s must fit within ${minutes}min * 0.85 budget`)
  return blueprint
}

function main() {
  const universe = buildExamEnjoyerUniverse(payload, selection)
  assert.equal(universe.targets.length, 51, 'canonical universe size = 51')

  const blueprints = [15,30,45,60,90].map(minutes => assertFullCoverage(universe, minutes))
  assert.ok(blueprints[0].coverage.assessedTargetIds.length < 51)
  assert.equal(blueprints[4].coverage.consideredTargetIds?.length, 51)
  console.log('exam-coverage-51-fixture-contracts: ALL PASS (all five durations, honest evidence accounting)')
}
main()
