import { checkSimpleRoute } from './truquitos-simple-route-fixture'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import type { ImportanceTier, KnowledgeUnit, KnowledgeUnitKind, MaterialBrain } from '../../lib/materialBrain/types'
import {
  buildTruquitoTargets, buildTruquitosGroundedContext, computeTruquitosCoverage,
  dedupeTruquitosByTargetIdentity, selectTruquitoTargetsForBatch,
} from '../../lib/materialBrain/truquitosContext'
import { POST, __routeDeps } from '../../app/api/alai-studyal-cheat-codes/route'

function unit(
  id: string, materialId: string, page: number, derivation: 'native_text' | 'vision',
  kind: KnowledgeUnitKind = 'fact', tier: ImportanceTier = 'supporting', extra: any = {},
): KnowledgeUnit {
  const base: any = {
    id, kind,
    identity: { canonicalSubject: id, semanticKey: id, qualifiers: [] },
    label: `Concepto ${id}`, statement: `Contenido autorizado de ${id}`,
    importance: { tier, signals: ['model_judged'], confidence: 0.9 },
    provenance: derivation === 'vision' ? [] : [{ materialId, page, quote: `Cita de ${id}`, chunkId: `c-${page}` }],
    evidence: derivation === 'vision'
      ? [{ materialId, page, derivation: 'vision', pageFingerprint: `pf-${id}`, analyzerVersion: '1.0', promptVersion: '1.0', description: `Descripción visual de ${id}` }]
      : [{ materialId, page, derivation: 'native_text', quote: `Cita de ${id}`, chunkId: `c-${page}` }],
    domainTags: [],
    ...extra,
  }
  return base
}

function relation(id: string, type: string, fromUnitId: string, toUnitId: string) {
  return {
    id, type, fromUnitId, toUnitId, statement: `${fromUnitId} ${type} ${toUnitId}`,
    importance: { tier: 'supporting', signals: [], confidence: 0.8 }, provenance: [],
  }
}

function brain(
  fingerprint: string, units: KnowledgeUnit[], relations: any[] = [], materialIds: string[] = ['mat-a'],
  builderVersion = MATERIAL_BRAIN_BUILDER_VERSION, status: 'ready' | 'partial' | 'failed' = 'ready',
): MaterialBrain {
  const selectedPages = Object.fromEntries(materialIds.map(id => [id, [1, 2, 3]]))
  return {
    scope: { ...buildSourceSelectionSnapshot(materialIds, selectedPages), fingerprint },
    meta: {
      version: '1.0.0', builderVersion, generatedAt: new Date(0).toISOString(),
      chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 1 },
      llmCallsUsed: 0, retries: 0, status,
    },
    units, relations,
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}

// ============================================================
// TRICK-TARGET-1/2/3 — pure truquitosContext.ts target model
// ============================================================
function testTargetModel() {
  const b = brain('fp-target', [
    unit('u-term', 'mat-a', 1, 'native_text', 'terminology'),
    unit('u-fact', 'mat-a', 2, 'native_text', 'fact'),               // no strategy — plain, non-critical fact
    { ...unit('u-dead', 'mat-a', 3, 'native_text', 'terminology'), supersededBy: 'u-term' } as any,
  ])
  const targets = buildTruquitoTargets(b)
  assert.ok(targets.some(t => t.id === 'unit:u-term'), 'TRICK-TARGET-1 eligible unit-level target derives from the Brain')
  assert.ok(!targets.some(t => t.id === 'unit:u-fact'), 'a plain non-critical fact with no relation gets NO strategy — not every unit is eligible')
  assert.ok(!targets.some(t => t.unitIds.includes('u-dead')), 'TRICK-TARGET-2 superseded units excluded')
  console.log('truquitos-material-brain-contracts: TRICK-TARGET-1/2 PASS')
}

// TRICK-TARGET-3: strategy eligibility is a deterministic function of kind/tier/relations.
function testStrategyEligibilityDeterministic() {
  const terminology = unit('u1', 'mat-a', 1, 'native_text', 'terminology')
  const formula = unit('u2', 'mat-a', 1, 'native_text', 'formula')
  const process2Steps = unit('u3', 'mat-a', 1, 'native_text', 'process', 'supporting', { steps: [{ order: 1, text: 'a' }, { order: 2, text: 'b' }] })
  const processNoSteps = unit('u4', 'mat-a', 1, 'native_text', 'process', 'supporting', { steps: [{ order: 1, text: 'a' }] })
  const criticalFact = unit('u5', 'mat-a', 1, 'native_text', 'fact', 'critical')

  const b = brain('fp-strat', [terminology, formula, process2Steps, processNoSteps, criticalFact])
  const targets = buildTruquitoTargets(b)
  const byId = Object.fromEntries(targets.map(t => [t.id, t]))

  assert.deepEqual([...byId['unit:u1'].strategyOpportunities].sort(), ['association', 'mnemonic'], 'terminology → mnemonic+association')
  assert.deepEqual(byId['unit:u2'].strategyOpportunities, ['formula_memory'], 'formula → formula_memory')
  assert.deepEqual(byId['unit:u3'].strategyOpportunities, ['step_memory'], 'process with >=2 real steps → step_memory')
  assert.ok(!byId['unit:u4'], 'TRICK-TARGET-3 process with <2 steps is NOT eligible for step_memory (no ordered chain)')
  assert.deepEqual(byId['unit:u5'].strategyOpportunities, ['exam_cue'], 'critical tier → exam_cue')

  // Determinism: rebuilding from the same Brain produces the identical result.
  const targetsAgain = buildTruquitoTargets(b)
  assert.deepEqual(targetsAgain.map(t => t.strategyOpportunities), targets.map(t => t.strategyOpportunities))
  console.log('truquitos-material-brain-contracts: TRICK-TARGET-3 PASS')
}

// relation-derived opportunities: contrast, pattern, formula_application, association
function testRelationOpportunities() {
  const a = unit('a', 'mat-a', 1, 'native_text', 'concept')
  const b2 = unit('b', 'mat-a', 2, 'native_text', 'concept')
  const b = brain('fp-relop', [a, b2], [relation('r1', 'contrasts_with', 'a', 'b'), relation('r-self', 'causes', 'a', 'a')])
  const targets = buildTruquitoTargets(b)
  const contrastTarget = targets.find(t => t.id === 'relation:r1')
  assert.ok(contrastTarget, 'contrasts_with relation produces an eligible target')
  assert.deepEqual(contrastTarget!.strategyOpportunities.sort(), ['contrast', 'error_warning'])
  assert.deepEqual(contrastTarget!.unitIds.sort(), ['a', 'b'])
  assert.ok(!targets.some(t => t.id === 'relation:r-self'), 'self-relation never becomes a Truquito target')
  console.log('truquitos-material-brain-contracts: relation opportunities PASS')
}

// ============================================================
// TRICK-COV-1/2 — deterministic coverage over the ELIGIBLE universe only
// ============================================================
function testCoverage() {
  const b = brain('fp-cov', [
    unit('u1', 'mat-a', 1, 'native_text', 'terminology'),
    unit('u2', 'mat-a', 2, 'native_text', 'formula'),
    unit('u3', 'mat-a', 3, 'native_text', 'fact'), // NOT eligible — must not count in denominator
  ])
  const targets = buildTruquitoTargets(b)
  assert.equal(targets.length, 2, 'TRICK-COV-1 denominator is the ELIGIBLE set (2), not all 3 Brain units')
  const full = computeTruquitosCoverage(targets, targets.map(t => t.id))
  assert.equal(full.coveragePercent, 100)
  const partial = computeTruquitosCoverage(targets, [targets[0].id])
  assert.equal(partial.representedEligibleTargets, 1, 'TRICK-COV-2 represented target ids compute coverage')
  assert.deepEqual(partial.missingTargetIds, [targets[1].id])
  console.log('truquitos-material-brain-contracts: TRICK-COV-1/2 PASS')
}

// ============================================================
// TRICK-VISION-1 — vision-derived target works with 0 vision calls
// ============================================================
function testVision() {
  const b = brain('fp-vision', [unit('u-vision', 'mat-a', 2, 'vision', 'terminology')])
  const targets = buildTruquitoTargets(b)
  assert.equal(targets[0].evidence[0].derivation, 'vision')
  assert.equal(targets[0].evidence[0].evidenceText, 'Descripción visual de u-vision', 'TRICK-VISION-1 vision evidence reaches the target — 0 vision calls (no such dep exists)')
  console.log('truquitos-material-brain-contracts: TRICK-VISION-1 PASS')
}

// ============================================================
// TRICK-DUPE-1 — semantic duplicate tricks (same target identity) deduped
// ============================================================
function testDedup() {
  const cards = [
    { type: 'cheat_code', title: 'A', content: 'x', targetIds: ['unit:u1'], relationIds: [] },
    { type: 'cheat_code', title: 'B (wording distinto)', content: 'y', targetIds: ['unit:u1'], relationIds: [] },
    { type: 'analogia', title: 'C', content: 'z', targetIds: ['unit:u1'], relationIds: [] },
    { type: 'cheat_code', title: 'D', content: 'w', targetIds: ['unit:u2'], relationIds: [] },
  ]
  const deduped = dedupeTruquitosByTargetIdentity(cards)
  assert.equal(deduped.length, 3, 'TRICK-DUPE-1 same (type,targetIds) combo deduped; different type or target survives')
  assert.deepEqual(deduped.map(c => c.title), ['A', 'C', 'D'])
  console.log('truquitos-material-brain-contracts: TRICK-DUPE-1 PASS')
}

// ============================================================
// Route-level contracts (TRICK-BRAIN-*, TRICK-GROUND-*, TRICK-PERF-*, TRICK-SOURCE-1)
// ============================================================
async function testBrainAuthorityAndGrounding() {
 await checkSimpleRoute('authority'); await checkSimpleRoute('grounding'); await checkSimpleRoute('variant')
}

// ============================================================
// TRICK-SOURCE-1 — 0 page leakage: targets only ever trace to materials
// within the SourceSelection scope (Material Brain itself already
// scoped units at build time; this proves the Truquitos layer adds none).
// ============================================================
function testSourcePageAuthority() {
  const b = brain('fp-source', [
    unit('u-mat-a', 'mat-a', 1, 'native_text', 'terminology'),
    unit('u-mat-b', 'mat-b', 2, 'native_text', 'formula'),
  ], [], ['mat-a', 'mat-b'])
  const context = buildTruquitosGroundedContext(b)
  assert.ok(context.targets.every(t => b.scope.materialIds.includes(t.materialId!)), 'TRICK-SOURCE-1 every target materialId is within SourceSelection — 0 leakage')
  console.log('truquitos-material-brain-contracts: TRICK-SOURCE-1 PASS')
}

// ============================================================
// TRICK-PERF-1/TRICK-RESUME-1/2 — persistence + reopen contract
// ============================================================
async function testResumeAndPerf() {
 await checkSimpleRoute('resume')
}

// ============================================================
// Real-shape acceptance: batch selection is diversity/tier ordered and
// bounded (a real token-budget constraint documented in the code).
// ============================================================
function testBatchSelectionRealShape() {
  const units = Array.from({ length: 40 }, (_, i) => unit(`u${i}`, 'mat-a', (i % 5) + 1, 'native_text', 'terminology', i % 8 === 0 ? 'critical' : 'supporting'))
  const b = brain('fp-large', units)
  const targets = buildTruquitoTargets(b)
  assert.equal(targets.length, 40, 'all 40 terminology units are eligible')
  const batch = selectTruquitoTargetsForBatch(targets, 24)
  assert.equal(batch.length, 24, 'batch respects the token-budget cap')
  assert.ok(batch.slice(0, 5).every(t => t.importanceTier === 'critical'), 'critical-tier targets are prioritized first in the batch')
  console.log(`truquitos-material-brain-contracts: real-shape batch selection PASS (eligible=${targets.length}, batch=${batch.length})`)
}

async function main() {
  testTargetModel()
  testStrategyEligibilityDeterministic()
  testRelationOpportunities()
  testCoverage()
  testVision()
  testDedup()
  testBatchSelectionRealShape()
  await testBrainAuthorityAndGrounding()
  testSourcePageAuthority()
  await testResumeAndPerf()
  console.log('truquitos-material-brain-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
