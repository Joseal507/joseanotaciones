import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  buildExamEnjoyerUniverse, composeEnjoyerExamBlueprint, computeExamEnjoyerTimeBounds,
  EXAM_ENJOYER_AUTHORITY_TYPE, EXAM_ENJOYER_GENERATOR_VERSION,
} from '../../lib/materialBrain/examEnjoyerContext'

const selection = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3, 4] }), fingerprint: 'fp-exam' }
const baseItems = [
  { id: 'concept', kind: 'concept', name: 'Concepto', content: 'Contenido conceptual', importance: 'high', difficulty: 'medium', examTypes: ['short_answer'], topicId: 't1', materialId: 'mat-a', pages: [1], sourceSpans: [{ page: 1, quote: 'a' }] },
  { id: 'formula', kind: 'formula', name: 'Fórmula', content: 'E = mc²', importance: 'high', difficulty: 'advanced', examTypes: ['fill_blank'], topicId: 't1', materialId: 'mat-a', pages: [2], sourceSpans: [{ page: 2, quote: 'b' }] },
  { id: 'process', kind: 'process', name: 'Proceso', content: 'Proceso académico', importance: 'medium', difficulty: 'medium', examTypes: ['matching'], topicId: 't2', materialId: 'mat-a', pages: [3], sourceSpans: [{ page: 3, quote: 'c' }] },
  { id: 'data', kind: 'data', name: 'Dato único', content: 'Dato académico de baja importancia', importance: 'low', difficulty: 'basic', examTypes: ['true_false'], topicId: 't2', materialId: 'mat-a', pages: [4], sourceSpans: [{ page: 4, quote: 'd' }] },
]

function payload(items = baseItems) {
  return {
    sourceSelectionFingerprint: 'fp-exam', materialIds: ['mat-a'], selectedPages: { 'mat-a': [1, 2, 3, 4] },
    topicsIndex: [{ id: 't1', title: 'Tema uno' }, { id: 't2', title: 'Tema dos' }],
    globalOrderedAnalysis: items, uniqueConceptsIndex: [items[0]],
  }
}

function main() {
  const universe = buildExamEnjoyerUniverse(payload(), selection)
  assert.equal(universe.authorityType, EXAM_ENJOYER_AUTHORITY_TYPE)
  assert.equal(universe.targets.length, 4, 'identical persisted ID does not double the denominator')
  assert.deepEqual(universe.targets.map(target => target.kind), ['concept', 'formula', 'process', 'data'])
  assert.ok(universe.targets.some(target => target.sourceItemId === 'data'), 'unique low-importance knowledge survives')
  assert.deepEqual(universe.targets[1].pages, [2])
  assert.equal(universe.targets[1].sourceSpans[0].quote, 'b')

  assert.throws(() => buildExamEnjoyerUniverse({ ...payload(), sourceSelectionFingerprint: 'wrong' }, selection), /SOURCE_SELECTION_MISMATCH/)
  assert.throws(() => buildExamEnjoyerUniverse(payload([{ ...baseItems[0], pages: [99] }]), selection), /SOURCE_SELECTION_MISMATCH/)

  const bounds = computeExamEnjoyerTimeBounds(universe)
  const compressed = composeEnjoyerExamBlueprint(universe, bounds.minimumViableDurationMinutes, 'exam-a', 'seed')
  const repeated = composeEnjoyerExamBlueprint(universe, bounds.minimumViableDurationMinutes, 'exam-a', 'seed')
  assert.deepEqual(compressed, repeated, 'duration design and slot order are deterministic')
  assert.equal(compressed.authorityType, EXAM_ENJOYER_AUTHORITY_TYPE)
  assert.equal(compressed.generatorVersion, EXAM_ENJOYER_GENERATOR_VERSION)
  assert.ok(compressed.slots.every(slot => ['multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer'].includes(slot.type)))
  assert.ok(compressed.slots.every(slot => slot.frozenSources.every(source => source.materialId === 'mat-a' && source.pages.length > 0)))

  const largeItems = Array.from({ length: 40 }, (_, index) => ({
    ...baseItems[index % baseItems.length], id: `item-${index}`, name: `Elemento ${index}`, content: `Contenido único ${index}`,
    topicId: index % 2 ? 't1' : 't2', pages: [(index % 4) + 1], sourceSpans: [{ page: (index % 4) + 1, quote: `q${index}` }],
  }))
  const large = buildExamEnjoyerUniverse(payload(largeItems), selection)
  const largeBounds = computeExamEnjoyerTimeBounds(large)
    const scoped = composeEnjoyerExamBlueprint(large, 15, 'short', 'seed')
    assert.ok(scoped.slots.length > 0)
    assert.ok(scoped.coverage.notAssessedDueToScopeTargetIds.length > 0)
    assert.ok(scoped.expectedCompletionSeconds <= 15 * 60 * .85)
  const full = composeEnjoyerExamBlueprint(large, largeBounds.idealDurationMinutes, 'exam-full', 'seed')
  assert.equal(full.coverage.assessedTargetIds.length, 40, 'full duration assesses all 40 targets (100% coverage)')
  assert.equal(full.coverage.notAssessedDueToScopeTargetIds.length, 0, 'nothing omitted')
  assert.equal(full.coverage.coverageStatus, 'complete')
  assert.equal(full.requestedDurationMinutes, largeBounds.idealDurationMinutes)
  assert.equal(full.durationMinutes, largeBounds.idealDurationMinutes)

  const route = fs.readFileSync('app/api/alai-studyal-exam/route.ts', 'utf8')
  assert.ok(route.includes('lookupStudyalMaterialEnjoyer'))
  assert.ok(!route.includes('restoreMaterialBrain'))
  assert.ok(!route.includes('MATERIAL_BRAIN_BUILDER_VERSION'))
  assert.ok(!route.includes('KnowledgeUnit'))
  assert.ok(route.includes("const RAW_SOURCE_AUTHORITY_KEYS = ['materialText', 'content', 'combinedText', 'rawText']"))
  assert.ok(route.includes('restoreExamGeneration('), 'evaluation restores the frozen server artifact')
  assert.ok(route.includes('provider cannot override') || route.includes('objectiveResults'), 'deterministic grading remains authoritative')
  console.log('exam-enjoyer-migration-contracts: ALL PASS')
}

main()
