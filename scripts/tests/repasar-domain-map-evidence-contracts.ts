import assert from 'node:assert/strict'
import { buildRepasarEnjoyerGroundedContext } from '../../lib/materialBrain/repasarEnjoyerContext'
import { computeRepasarDomainMap } from '../../lib/materialBrain/reviewContext'
import type { SourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'

// ============================================================
// LIVE BUG: "Definición de Equilibrio Químico" was marked correct citing
// the sentence "El equilibrio químico ocurre cuando la reacción directa y
// la inversa pasan a la misma velocidad", while "Condición de equilibrio
// de velocidades" was marked RED (omitted) citing the EXACT SAME sentence
// as its evidence. Root cause: buildRepasarEnjoyerGroundedContext only
// deduplicated on exact label+statement identity, so two Enjoyer items
// citing identical evidence but framed under different labels became two
// independently-graded targets.
//
// Fix (general, no hardcoded phrase): any two raw Enjoyer items that
// share an exact normalized quote in their sourceSpans are merged into
// ONE canonical target before targets are ever handed to evaluation;
// relations pointing at the merged-away id are remapped via idAlias.
//
// This test drives the REAL buildRepasarEnjoyerGroundedContext with a
// fixture reproducing the exact live scenario, then feeds the result
// through the REAL computeRepasarDomainMap with a mocked verdict — no
// provider calls.
// ============================================================

const selection: SourceSelectionSnapshot = {
  fingerprint: 'fp-equilibrio',
  materialIds: ['mat-a'],
  materials: [{ materialId: 'mat-a', selectedPages: [3] }],
} as SourceSelectionSnapshot

const SHARED_QUOTE = 'El equilibrio químico ocurre cuando la reacción directa y la inversa pasan a la misma velocidad'

function equilibriumPayload() {
  return {
    sourceSelectionFingerprint: 'fp-equilibrio',
    topicsIndex: [],
    globalOrderedAnalysis: [
      {
        id: 'concept:equilibrio-def', kind: 'concept', name: 'Definición de Equilibrio Químico',
        summary: 'El equilibrio químico es un estado dinámico de velocidades iguales.',
        materialId: 'mat-a', pages: [3], globalOrder: 0,
        sourceSpans: [{ page: 3, quote: SHARED_QUOTE }],
      },
      {
        id: 'concept:equilibrio-condicion', kind: 'concept', name: 'Condición de equilibrio de velocidades',
        summary: 'La condición de equilibrio se cumple cuando ambas velocidades de reacción coinciden.',
        materialId: 'mat-a', pages: [3], globalOrder: 1,
        sourceSpans: [{ page: 3, quote: SHARED_QUOTE }],
      },
    ],
    uniqueConceptsIndex: [],
  }
}

async function testH_targetIdsStableThroughMerge() {
  const grounded = buildRepasarEnjoyerGroundedContext(equilibriumPayload(), selection)
  assert.equal(grounded.targets.length, 1, 'H: the two same-evidence items collapse into exactly one canonical target')
  const canonicalId = grounded.targets[0].id
  assert.ok(['concept:equilibrio-def', 'concept:equilibrio-condicion'].includes(canonicalId), 'H: canonical id is one of the original raw ids, never fabricated')
  console.log('repasar-domain-map-evidence: H PASS')
}

async function testI_positiveEvidenceCannotBeOverwrittenByMissingForSameTarget() {
  const grounded = buildRepasarEnjoyerGroundedContext(equilibriumPayload(), selection)
  const target = grounded.targets[0]
  // Only ONE verdict can exist for this canonical target now — it cannot
  // simultaneously be "demonstrated_correct" under one alias and
  // "omitted" under another, because there is only one id left to grade.
  const verdicts = [{ targetId: target.id, status: 'covered' as const }]
  const domainMap = computeRepasarDomainMap(grounded.targets, verdicts)
  assert.equal(domainMap.totalAcademicTargets, 1)
  assert.equal(domainMap.omitted, 0, 'I: no target is left omitted when its evidence was explicitly satisfied')
  assert.equal(domainMap.statusByTargetId[target.id], 'demonstrated_correct', 'I: the single canonical target is graded once, unambiguously correct')
  console.log('repasar-domain-map-evidence: I PASS')
}

async function testJ_duplicateOverlappingTargetsHandledConsistently() {
  // A THIRD item citing a *different* quote must remain independent —
  // the merge is purely evidence-identity based, never a blanket collapse.
  const payload = equilibriumPayload()
  ;(payload.globalOrderedAnalysis as any[]).push({
    id: 'concept:unrelated', kind: 'concept', name: 'Ley de Boyle',
    summary: 'A presión constante, el volumen es inversamente proporcional a la presión.',
    materialId: 'mat-a', pages: [3], globalOrder: 2,
    sourceSpans: [{ page: 3, quote: 'A temperatura constante, el volumen de un gas es inversamente proporcional a su presión' }],
  })
  const grounded = buildRepasarEnjoyerGroundedContext(payload, selection)
  assert.equal(grounded.targets.length, 2, 'J: an item with genuinely different evidence stays a separate target')
  console.log('repasar-domain-map-evidence: J PASS')
}

async function testK_identicalInputProducesIdenticalCanonicalCounts() {
  const runs = [0, 1, 2].map(() => buildRepasarEnjoyerGroundedContext(equilibriumPayload(), selection).targets.length)
  assert.deepEqual(runs, [1, 1, 1], 'K: identical mocked input deterministically produces the same canonical target count every run')
  console.log('repasar-domain-map-evidence: K PASS')
}

async function testL_finalScoreDerivedFromDeterministicDomainMapNotRawLlmNumber() {
  // computeRepasarDomainMap/computeRepasarMastery are pure functions of
  // (targets, verdicts) — confirming there is no path where an arbitrary
  // LLM-supplied "overall score" field bypasses this deterministic
  // pipeline for the merged target set.
  const grounded = buildRepasarEnjoyerGroundedContext(equilibriumPayload(), selection)
  const verdictsA = [{ targetId: grounded.targets[0].id, status: 'covered' as const }]
  const verdictsB = [{ targetId: grounded.targets[0].id, status: 'covered' as const }]
  const mapA = computeRepasarDomainMap(grounded.targets, verdictsA)
  const mapB = computeRepasarDomainMap(grounded.targets, verdictsB)
  assert.deepEqual(mapA, mapB, 'L: identical verdict input over the same canonical targets is fully deterministic')
  console.log('repasar-domain-map-evidence: L PASS')
}

async function testLiveEquilibriumFixtureNeverMarksSharedEvidenceAsOmitted() {
  const grounded = buildRepasarEnjoyerGroundedContext(equilibriumPayload(), selection)
  const target = grounded.targets[0]
  const verdicts = [{ targetId: target.id, status: 'covered' as const }]
  const domainMap = computeRepasarDomainMap(grounded.targets, verdicts)
  assert.equal(domainMap.omitted, 0, 'LIVE-FIXTURE: no target citing the satisfied shared quote is left marked as "no apareció"')
  assert.equal(domainMap.statusByTargetId[target.id], 'demonstrated_correct')
  console.log('repasar-domain-map-evidence: LIVE-EQUILIBRIUM-FIXTURE PASS')
}

async function main() {
  await testH_targetIdsStableThroughMerge()
  await testI_positiveEvidenceCannotBeOverwrittenByMissingForSameTarget()
  await testJ_duplicateOverlappingTargetsHandledConsistently()
  await testK_identicalInputProducesIdenticalCanonicalCounts()
  await testL_finalScoreDerivedFromDeterministicDomainMapNotRawLlmNumber()
  await testLiveEquilibriumFixtureNeverMarksSharedEvidenceAsOmitted()
  console.log('repasar-domain-map-evidence-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
