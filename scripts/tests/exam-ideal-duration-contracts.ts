import assert from 'node:assert/strict'
import {
  buildExamEnjoyerUniverse,
  composeEnjoyerExamBlueprint,
  computeExamEnjoyerTimeBounds,
  normalizeSelectableDuration,
  EXAM_SELECTABLE_DURATIONS,
  type ExamSelectableDuration,
} from '../../lib/materialBrain/examEnjoyerContext'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'

function makeItem(
  id: string,
  materialId: string,
  page: number,
  kind = 'concept',
  label = `Concepto ${id}`,
  content = `Contenido autorizado y verificable para el concepto ${id} con longitud adecuada para evaluación.`,
  examTypes: string[] = ['multiple_choice'],
) {
  return {
    id,
    kind,
    name: label,
    label,
    content,
    summary: content,
    importance: 80,
    difficulty: 'medium',
    examTypes,
    topicId: 'topic-1',
    materialId,
    pages: [page],
    sourceSpans: [{ materialId, page, quote: content.slice(0, 30) }],
  }
}

function makeUniverse(items: any[]) {
  const pageNumbers = [...new Set(items.flatMap(item => item.pages))].sort((a, b) => a - b)
  const blueprint = {
    sourceSelectionFingerprint: 'fp-duration-test',
    materialIds: ['mat-1'],
    selectedPages: { 'mat-1': pageNumbers.length ? pageNumbers : [1] },
    topicsIndex: [{ id: 'topic-1', title: 'Tema Duración', sourceOrder: 0 }],
    globalOrderedAnalysis: items,
    uniqueConceptsIndex: [],
    relations: [],
  }
  const snapshot = {
    ...buildSourceSelectionSnapshot(['mat-1'], { 'mat-1': pageNumbers.length ? pageNumbers : [1] }),
    fingerprint: 'fp-duration-test',
  }
  return buildExamEnjoyerUniverse(blueprint, snapshot)
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT 1: Recommended duration domain
// Recommended duration is ALWAYS one of: 15, 30, 45, 60, 90
// ─────────────────────────────────────────────────────────────────────────────
function testRecommendedDurationDomain() {
  console.log('Contract 1: Testing recommended duration is strictly in supported domain [15, 30, 45, 60, 90]...')

  const allowedSet = new Set<number>(EXAM_SELECTABLE_DURATIONS)

  // Sweep raw minutes from -50 to 1000
  for (let raw = -50; raw <= 1000; raw += 5) {
    const normalized = normalizeSelectableDuration(raw)
    assert.ok(
      allowedSet.has(normalized),
      `normalizeSelectableDuration(${raw}) returned ${normalized}, which is not in [15, 30, 45, 60, 90]`,
    )
  }

  // Non-finite values
  assert.equal(normalizeSelectableDuration(NaN), 15)
  assert.equal(normalizeSelectableDuration(Infinity), 90)
  assert.equal(normalizeSelectableDuration(-Infinity), 15)

  console.log('Contract 1 PASS: Recommended duration is always one of [15, 30, 45, 60, 90]')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT 2: 385-minute workload cannot display or submit 385
// Workload that produced 385 min must normalize to 90 min
// ─────────────────────────────────────────────────────────────────────────────
function testWorkloadProducing385CannotDisplayOrSubmit385() {
  console.log('Contract 2: Testing workload that previously produced 385 min...')

  // Build a 26-page workload with 356 items that produces exact raw 385 minutes
  // 356 items * 55s = 19,580s / 0.85 = 23,035s / 60 = 383.9m -> roundToFive = 385m
  const items = Array.from({ length: 356 }, (_, i) =>
    makeItem(`item_${i}`, 'mat-1', (i % 26) + 1, 'concept', `Concepto ${i}`, `Contenido de concepto ${i} para examen.`),
  )

  const universe = makeUniverse(items)
  const bounds = computeExamEnjoyerTimeBounds(universe)

  // Prove that raw calculation indeed produces 385
  assert.equal(bounds.rawIdealDurationMinutes, 385, `Expected raw ideal to be 385, got ${bounds.rawIdealDurationMinutes}`)

  // Prove that bounds.idealDurationMinutes is normalized to 90
  assert.equal(bounds.idealDurationMinutes, 90, `idealDurationMinutes must be 90, got ${bounds.idealDurationMinutes}`)
  assert.equal(bounds.maximumUsefulDurationMinutes, 90, `maximumUsefulDurationMinutes must be 90, got ${bounds.maximumUsefulDurationMinutes}`)

  // Prove that even if raw 385 is passed to normalizeSelectableDuration, it yields 90
  const normalizedFromRaw = normalizeSelectableDuration(385)
  assert.equal(normalizedFromRaw, 90)

  // Prove that when composing with the normalized duration, composition succeeds at 90 min
  const bp = composeEnjoyerExamBlueprint(universe, normalizedFromRaw, 'exam-385-fix', 'seed-385')
  assert.equal(bp.requestedDurationMinutes, 90)
  assert.equal(bp.durationMinutes, 90)
  assert.ok(bp.expectedCompletionSeconds <= 90 * 60 * 0.85, 'Expected completion time must fit 90 min budget')
  assert.ok(bp.slots.length > 0)

  console.log('Contract 2 PASS: 385-min workload displays and submits as 90 min, never 385 min')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT 3: Low workloads map sensibly to lower supported duration
// ─────────────────────────────────────────────────────────────────────────────
function testLowWorkloadsMapSensibly() {
  console.log('Contract 3: Testing low workloads mapping...')

  // 1 item (55s / 0.85 = 65s -> ~2 min -> roundToFive = 5 min)
  const singleItem = [makeItem('single', 'mat-1', 1)]
  const uSingle = makeUniverse(singleItem)
  const boundsSingle = computeExamEnjoyerTimeBounds(uSingle)

  assert.equal(boundsSingle.rawIdealDurationMinutes, 5)
  assert.equal(boundsSingle.idealDurationMinutes, 15, 'Low workload must map to 15 min')

  // 12 items (12 * 55s = 660s / 0.85 = 776s -> 13 min -> roundToFive = 15 min)
  const items12 = Array.from({ length: 12 }, (_, i) => makeItem(`it_${i}`, 'mat-1', 1))
  const u12 = makeUniverse(items12)
  const bounds12 = computeExamEnjoyerTimeBounds(u12)
  assert.equal(bounds12.idealDurationMinutes, 15, '12 items workload must map to 15 min')

  // 18 items (18 * 55s = 990s / 0.85 = 1165s -> 19.4 min -> roundToFive = 20 min)
  const items18 = Array.from({ length: 18 }, (_, i) => makeItem(`it18_${i}`, 'mat-1', 1))
  const u18 = makeUniverse(items18)
  const bounds18 = computeExamEnjoyerTimeBounds(u18)
  assert.equal(bounds18.rawIdealDurationMinutes, 20)
  assert.equal(bounds18.idealDurationMinutes, 30, '20 min raw workload must map to 30 min')

  console.log('Contract 3 PASS: Low workloads map sensibly to 15 or 30 min')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT 4: High workloads cap at 90 rather than producing > 90
// ─────────────────────────────────────────────────────────────────────────────
function testHighWorkloadsCapAt90() {
  console.log('Contract 4: Testing high workloads capping at 90 min...')

  const highMinutes = [65, 70, 75, 80, 85, 90, 95, 100, 120, 150, 180, 240, 385, 600]
  for (const min of highMinutes) {
    const capped = normalizeSelectableDuration(min)
    assert.equal(capped, 90, `Workload of ${min} min must cap at 90 min, got ${capped}`)
  }

  console.log('Contract 4 PASS: High workloads strictly cap at 90 min')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT 5: Manually selected supported durations continue unchanged
// ─────────────────────────────────────────────────────────────────────────────
function testSupportedDurationsContinueUnchanged() {
  console.log('Contract 5: Testing supported durations continue unchanged...')

  const supported: ExamSelectableDuration[] = [15, 30, 45, 60, 90]
  for (const d of supported) {
    const normalized = normalizeSelectableDuration(d)
    assert.equal(normalized, d, `Supported duration ${d} must remain exactly ${d}`)
  }

  // Also verify that composeEnjoyerExamBlueprint respects each supported duration
  const items = Array.from({ length: 25 }, (_, i) => makeItem(`it_${i}`, 'mat-1', 1))
  const universe = makeUniverse(items)
  for (const d of supported) {
    const bp = composeEnjoyerExamBlueprint(universe, d, `exam-${d}`, `seed-${d}`)
    assert.equal(bp.requestedDurationMinutes, d)
    assert.equal(bp.durationMinutes, d)
    assert.ok(bp.expectedCompletionSeconds <= d * 60 * 0.85)
  }

  console.log('Contract 5 PASS: Manually selected supported durations [15, 30, 45, 60, 90] continue unchanged')
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN TEST RUNNER
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  console.log('\n── RUNNING EXAM IDEAL DURATION DOMAIN CONTRACTS ──\n')
  testRecommendedDurationDomain()
  testWorkloadProducing385CannotDisplayOrSubmit385()
  testLowWorkloadsMapSensibly()
  testHighWorkloadsCapAt90()
  testSupportedDurationsContinueUnchanged()
  console.log('\nALL EXAM IDEAL DURATION DOMAIN CONTRACTS PASSED!\n')
}

main()
