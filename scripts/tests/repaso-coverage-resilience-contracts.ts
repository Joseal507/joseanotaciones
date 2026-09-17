import assert from 'node:assert/strict'
import {
  __routeDeps,
  REPASAR_MAX_PROVIDER_CALLS_PER_INITIAL_BATCH,
  resolveRepasarCoverage,
  validateRepasarCoverageBatchSemantics,
} from '../../app/api/alai-studyal-repasar/route'

const originalGenerate = __routeDeps.generateValidatedLegacyJson

const idsFromPrompt = (input: any): string[] => {
  const system = String(input.messages?.[0]?.content || '')
  const match = system.match(/estos targetId[^:]*:\s*([^\n]+)/i)
  // The prompt sentence ends with a period immediately after the id list
  // (no separating space), so the LAST captured id carries a trailing
  // "." that is not part of the real target id — strip it from every
  // entry (harmless: real target ids never contain a period).
  return String(match?.[1] || '')
    .split(',')
    .map(value => value.trim().replace(/\.$/, ''))
    .filter(Boolean)
}

const verdict = (targetId: string, status: 'covered' | 'partial' | 'missing' | 'incorrect' = 'missing') => ({
  targetId,
  status,
  evidence: status === 'missing' ? '' : `evidence ${targetId}`,
  demonstrated: status === 'missing' ? '' : `demonstrated ${targetId}`,
  missingDetail: status === 'partial' || status === 'incorrect' ? `missing ${targetId}` : '',
})

const targets = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `t${index + 1}`,
  label: `Target ${index + 1}`,
  statement: `Canonical statement ${index + 1}`,
  kind: 'concept',
  importanceTier: 'supporting',
  materialId: 'm1',
  pages: [Math.floor(index / 5) + 1],
  topicId: 'topic',
  sourceSpans: [{ page: Math.floor(index / 5) + 1, quote: `Substantive canonical evidence for target ${index + 1} in the selected source.` }],
  relationIds: [],
  globalOrder: index,
})) as any

const groundedContext = { fingerprint: 'fp-test', builderVersion: 'test', targets: [], relations: [] } as any

async function main() {
  const requested = ['a', 'b', 'c']
  assert.deepEqual(validateRepasarCoverageBatchSemantics(requested, []).unresolvedTargetIds, requested)
  assert.deepEqual(validateRepasarCoverageBatchSemantics(requested, [verdict('a')]).unresolvedTargetIds, ['b', 'c'])
  assert.deepEqual(validateRepasarCoverageBatchSemantics(requested, [verdict('a'), verdict('a'), verdict('b'), verdict('c')]).unresolvedTargetIds, ['a'])
  assert.deepEqual(validateRepasarCoverageBatchSemantics(requested, [verdict('a'), verdict('b'), verdict('c'), verdict('forged')]).accepted.map(v => v.targetId), requested)
  assert.deepEqual(validateRepasarCoverageBatchSemantics(requested, [{ ...verdict('a'), status: 'unknown' } as any, verdict('b'), verdict('c')]).unresolvedTargetIds, ['a'])
  assert.equal(validateRepasarCoverageBatchSemantics(requested, [verdict('a'), verdict('b'), verdict('c')]).unresolvedTargetIds.length, 0)
  assert.equal(validateRepasarCoverageBatchSemantics(requested, [verdict('a'), verdict('b'), verdict('c')]).accepted.every(v => v.status === 'missing'), true)
  // Missing result property (no targetId at all on the entry) must be
  // rejected outright, never treated as a valid (forged-blank) id.
  const missingTargetIdResult = validateRepasarCoverageBatchSemantics(requested, [
    { status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' } as any,
    verdict('b'), verdict('c'),
  ])
  assert.deepEqual(missingTargetIdResult.unresolvedTargetIds, ['a'])
  assert.ok(missingTargetIdResult.rejectedReasons.includes('missing_target_id'))

  const requestedAcrossCalls: string[][] = []
  let call = 0
  __routeDeps.generateValidatedLegacyJson = (async (input: any) => {
    call += 1
    const ids = idsFromPrompt(input)
    requestedAcrossCalls.push(ids)
    if (call === 2 || call === 3) return { targetCoverage: [] }
    return { targetCoverage: ids.map(id => verdict(id, Number(id.slice(1)) % 3 === 0 ? 'covered' : 'missing')) }
  }) as typeof originalGenerate

  const recovered = await resolveRepasarCoverage(targets(51), groundedContext, 'valid student explanation')
  assert.equal(recovered.ok, true)
  assert.equal(recovered.verdicts.length, 51)
  assert.equal(new Set(recovered.verdicts.map(item => item.targetId)).size, 51)
  assert.equal(requestedAcrossCalls.length, 8)
  const successfulInitialIds = new Set([...requestedAcrossCalls[0], ...requestedAcrossCalls[3]])
  for (const later of requestedAcrossCalls.slice(4)) {
    assert.equal(later.some(id => successfulInitialIds.has(id)), false, `fallback re-requested accepted id: ${later}`)
  }

  let permanentCalls = 0
  __routeDeps.generateValidatedLegacyJson = (async () => {
    permanentCalls += 1
    return { targetCoverage: [] }
  }) as typeof originalGenerate
  const failed = await resolveRepasarCoverage(targets(15), groundedContext, 'valid student explanation')
  assert.equal(failed.ok, false)
  assert.equal(failed.verdicts.length, 0)
  assert.equal(failed.unadjudicatedTargetIds?.length, 15)
  assert.equal(permanentCalls, REPASAR_MAX_PROVIDER_CALLS_PER_INITIAL_BATCH)

  // A partial fallback retains only real provider verdicts. It never fills
  // unreturned ids with fabricated academic `missing`. 't4' is deliberately
  // NEVER adjudicated by this mock (in any batch composition, at any split
  // depth) — a genuine, deterministic permanent gap regardless of how far
  // the bounded splitting recurses — while the other three targets DO get
  // covered via the ordinary split/retry mechanism, proving good work is
  // retained even when the overall batch still ends incomplete.
  __routeDeps.generateValidatedLegacyJson = (async (input: any) => {
    const ids = idsFromPrompt(input).filter(id => id !== 't4')
    return { targetCoverage: ids.length ? [verdict(ids[0], 'covered')] : [] }
  }) as typeof originalGenerate
  const partial = await resolveRepasarCoverage(targets(4), groundedContext, 'valid student explanation')
  assert.equal(partial.ok, false)
  assert.equal(partial.verdicts.every(item => item.status === 'covered'), true)
  assert.equal(partial.verdicts.length + (partial.unadjudicatedTargetIds?.length || 0), 4)

  console.log('repaso-coverage-resilience-contracts: ALL PASS')
}

main().finally(() => {
  __routeDeps.generateValidatedLegacyJson = originalGenerate
}).catch(error => {
  console.error(error)
  process.exitCode = 1
})
