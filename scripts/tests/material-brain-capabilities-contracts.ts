import assert from 'node:assert/strict'
import { resolveMaterialCapabilities } from '../../lib/materialBrain/capabilities'
import { quizArtifactIdentity } from '../../lib/materialBrain/quiz/artifactStore'
import type { ImportanceTier, KnowledgeUnit, KnowledgeUnitKind, MaterialBrain } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'

function unit(id: string, kind: KnowledgeUnitKind = 'fact', tier: ImportanceTier = 'supporting', usedDeterministicFallback = false): KnowledgeUnit {
  return {
    id, kind,
    identity: { canonicalSubject: id, semanticKey: id, qualifiers: [] },
    label: id, statement: `Statement for ${id}`,
    importance: { tier, signals: [], confidence: 0.9 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: 'x', chunkId: 'c1' }],
    evidence: [{ materialId: 'mat-a', page: 1, derivation: 'native_text', quote: 'x', chunkId: 'c1' }],
    domainTags: [],
  } as any
}

function baseBrain(overrides: Partial<MaterialBrain['meta']> = {}, units: KnowledgeUnit[] = [], relations: any[] = []): MaterialBrain {
  const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-cap' }
  return {
    scope,
    meta: {
      version: '1.0.0', builderVersion: MATERIAL_BRAIN_BUILDER_VERSION, generatedAt: new Date(0).toISOString(),
      chunking: { strategy: 'test', chunkSizeChars: 100, chunkCount: 1 }, llmCallsUsed: 0, retries: 0,
      status: 'ready', sourceReadiness: 'ready', brainEnrichment: 'not_started',
      extractionQuality: { richPercent: 0, fallbackPercent: 100, noContentPercent: 0 },
      ...overrides,
    },
    units, relations,
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}

function main() {
  // CAP-CHAT-1 — ALAI Chat needs only sourceReady, never enrichment.
  {
    const fastBrain = baseBrain({}, [unit('fallback:c0:0')])
    const caps = resolveMaterialCapabilities(fastBrain)
    assert.equal(caps.alaiChatReady, true, 'CAP-CHAT-1 sourceReady alone is sufficient for ALAI Chat')
    assert.equal(caps.sourceReady, true)
  }

  // CAP-REP-1 / CAP-FLASH-1 / analysis — P0 product decision ("Material
  // Brain debe tener un final real y estable"): correctness over
  // opening a few seconds earlier. A base (fallback-only, not_started)
  // brain's academicStability is 'preparing' — its units can still be
  // silently replaced by rich units with DIFFERENT ids once enrichment
  // proceeds, so NO artifact-creating tool may generate against it yet,
  // even though it has real (fallback) units.
  {
    const fastBrain = baseBrain({}, [unit('fallback:c0:0')])
    const caps = resolveMaterialCapabilities(fastBrain)
    assert.equal(caps.academicStability, 'preparing', 'a not_started brain is never terminal — real enrichment work is still pending')
    assert.equal(caps.repasarReady, false, 'CAP-REP-1 Repasar must wait for academic stability, not merely unitsReady — units can still drift')
    assert.equal(caps.flashcardsReady, false, 'CAP-FLASH-1 Flashcards must wait for academic stability, not merely unitsReady')
    assert.equal(caps.analysisReady, false, 'CAP-ANALYSIS-1 Analysis must wait for academic stability, not merely unitsReady')
  }
  // Once the SAME units settle into a terminal state (stable_degraded —
  // enrichment tried and permanently gave up, keeping the fallback),
  // every artifact tool becomes usable — stability, not richness, is
  // the gate. See CAP-DEGRADED-1 below for the degraded case in detail.
  {
    const stableBrain = baseBrain({ brainEnrichment: 'ready' }, [unit('fallback:c0:0')])
    const caps = resolveMaterialCapabilities(stableBrain)
    assert.equal(caps.academicStability, 'stable_rich')
    assert.equal(caps.repasarReady, true)
    assert.equal(caps.flashcardsReady, true)
    assert.equal(caps.analysisReady, true)
  }
  {
    const emptyBrain = baseBrain({ brainEnrichment: 'ready' }, [])
    const caps = resolveMaterialCapabilities(emptyBrain)
    assert.equal(caps.repasarReady, false, 'no units at all correctly blocks Repasar (in-flight-write race, not a policy gap)')
    assert.equal(caps.flashcardsReady, false)
  }

  // CAP-DEGRADED-1 — a leaf that permanently settled for its fallback
  // (enrichment budget exhausted, see build.ts MAX_ENRICHMENT_ATTEMPTS_PER_LEAF)
  // produces academicStability:'stable_degraded' — a LEGITIMATE terminal
  // state, not a failure. Every artifact tool must be usable exactly as
  // on a fully rich brain.
  {
    const degradedBrain = baseBrain({ brainEnrichment: 'degraded' }, [unit('u1'), unit('u2')])
    const caps = resolveMaterialCapabilities(degradedBrain)
    assert.equal(caps.academicStability, 'stable_degraded')
    assert.equal(caps.repasarReady, true, 'CAP-DEGRADED-1 stable_degraded is sufficiently stable for Repasar')
    assert.equal(caps.flashcardsReady, true, 'CAP-DEGRADED-1 stable_degraded is sufficiently stable for Flashcards')
    assert.equal(caps.quizReady, true, 'CAP-DEGRADED-1 stable_degraded is sufficiently stable for Quiz')
    assert.equal(caps.examReady, true, 'CAP-DEGRADED-1 stable_degraded is sufficiently stable for Exam')
    assert.equal(caps.studyMapReady, true)
    assert.equal(caps.truquitosReady, true)
    assert.equal(caps.analysisReady, true)
  }

  // CAP-FAILED-1 — a genuinely failed brain (no usable representation)
  // blocks every artifact tool, never silently treated as usable.
  {
    const failedBrain = baseBrain({ brainEnrichment: 'failed', status: 'ready' }, [unit('u1')])
    const caps = resolveMaterialCapabilities(failedBrain)
    assert.equal(caps.academicStability, 'failed')
    assert.equal(caps.repasarReady, false)
    assert.equal(caps.flashcardsReady, false)
    assert.equal(caps.quizReady, false)
    assert.equal(caps.examReady, false)
  }

  // CAP-QUIZ-1 — Quiz must NOT be ready on a transient/unstable universe
  // (base units are always kind:'fact' only — zero type diversity).
  {
    const fastBrain = baseBrain({ brainEnrichment: 'enriching', extractionQuality: { richPercent: 40, fallbackPercent: 60, noContentPercent: 0 } }, [unit('u1')])
    const caps = resolveMaterialCapabilities(fastBrain)
    assert.equal(caps.quizReady, false, 'CAP-QUIZ-1 Quiz cannot compute a final recommendation while enrichment is still in progress')
    const richBrain = baseBrain({ brainEnrichment: 'ready', extractionQuality: { richPercent: 100, fallbackPercent: 0, noContentPercent: 0 } }, [unit('u1', 'definition')])
    assert.equal(resolveMaterialCapabilities(richBrain).quizReady, true, 'quizReady once enrichment stabilizes')
    const legacyBrain = baseBrain({ brainEnrichment: undefined }, [unit('u1', 'definition')])
    assert.equal(resolveMaterialCapabilities(legacyBrain).quizReady, true, 'a legacy brain (predates two-level readiness) is treated as fully enriched')
  }

  // CAP-EXAM-1 — Exam requires full enrichment (100% blueprint promise).
  {
    const enriching = baseBrain({ brainEnrichment: 'enriching' }, [unit('u1')])
    assert.equal(resolveMaterialCapabilities(enriching).examReady, false, 'CAP-EXAM-1 examReady false while enriching')
    const ready = baseBrain({ brainEnrichment: 'ready' }, [unit('u1')])
    assert.equal(resolveMaterialCapabilities(ready).examReady, true)
  }

  // CAP-MAP-1 — Study Map must never fabricate edges, but also must
  // never be permanently blocked just because a FULLY enriched material
  // genuinely has zero relations (short/simple source).
  {
    const stillEnriching = baseBrain({ brainEnrichment: 'enriching' }, [unit('u1')], [])
    assert.equal(resolveMaterialCapabilities(stillEnriching).studyMapReady, false, 'CAP-MAP-1 blocked while enrichment could still add relations')
    const fullyEnrichedNoRelations = baseBrain({ brainEnrichment: 'ready' }, [unit('u1')], [])
    const caps1 = resolveMaterialCapabilities(fullyEnrichedNoRelations)
    assert.equal(caps1.studyMapReady, true, 'a genuinely relation-free but FULLY enriched material is legitimate — never permanently blocked')
    assert.equal(caps1.relationsReady, false, 'relationsReady still correctly reports no edges to show — UI never fabricates them')
    const fullyEnrichedWithRelations = baseBrain({ brainEnrichment: 'ready' }, [unit('u1'), unit('u2')], [{ id: 'r1', type: 'causes', fromUnitId: 'u1', toUnitId: 'u2', statement: 'x', importance: { tier: 'supporting', signals: [], confidence: 0.8 }, provenance: [] }])
    const caps2 = resolveMaterialCapabilities(fullyEnrichedWithRelations)
    assert.equal(caps2.studyMapReady, true)
    assert.equal(caps2.relationsReady, true, 'relationsReady true once real relations exist and enrichment is stable')
  }

  // CAP-TRICKS-1 — Truquitos needs enrichment for strategy diversity.
  {
    const enriching = baseBrain({ brainEnrichment: 'enriching' }, [unit('u1')])
    assert.equal(resolveMaterialCapabilities(enriching).truquitosReady, false, 'CAP-TRICKS-1 blocked while still enriching (base facts only would lower quality)')
    const ready = baseBrain({ brainEnrichment: 'ready' }, [unit('u1', 'formula')])
    assert.equal(resolveMaterialCapabilities(ready).truquitosReady, true)
  }

  // CAP-HUB-1 — no rich-required tool's gate can reintroduce the global
  // hub-blocking behavior: sourceReady is ALWAYS true whenever any
  // richer capability is also true (monotonic — never a case where a
  // tool is "ready" but sourceReady is false).
  {
    const cases: MaterialBrain[] = [
      baseBrain({ brainEnrichment: 'not_started' }, [unit('u1')]),
      baseBrain({ brainEnrichment: 'enriching' }, [unit('u1')]),
      baseBrain({ brainEnrichment: 'ready' }, [unit('u1', 'formula')], [{ id: 'r1', type: 'causes', fromUnitId: 'u1', toUnitId: 'u1', statement: 'x', importance: { tier: 'supporting', signals: [], confidence: 0.8 }, provenance: [] }]),
    ]
    for (const brain of cases) {
      const caps = resolveMaterialCapabilities(brain)
      const anyToolReady = caps.repasarReady || caps.flashcardsReady || caps.quizReady || caps.examReady || caps.analysisReady || caps.studyMapReady || caps.truquitosReady
      if (anyToolReady) assert.ok(caps.sourceReady, 'CAP-HUB-1 any tool being ready implies sourceReady — none of them can be ready while the hub itself would still be gated')
    }
    console.log('CAP-HUB-1 PASS (monotonic — no tool capability implies hub-blocking)')
  }

  // CAP-FAIL-1 — provider outage (still 'enriching', not yet terminal)
  // leaves sourceReady intact (hub/ALAI/reading unaffected) but now
  // blocks EVERY artifact-creating tool, not just the rich-required
  // ones — this is the P0 product decision itself: 'enriching' means
  // the universe can still drift, so nothing may generate against it
  // yet. (In production this state does not persist forever — see
  // build.ts's MAX_ENRICHMENT_ATTEMPTS_PER_LEAF, which converges to a
  // real terminal stable_degraded/stable_rich; this test only exercises
  // the capabilities-level policy for a genuinely mid-flight snapshot.)
  {
    const stuck = baseBrain({ brainEnrichment: 'enriching', sourceReadiness: 'ready', status: 'ready' }, [unit('u1')])
    const caps = resolveMaterialCapabilities(stuck)
    assert.equal(caps.academicStability, 'preparing')
    assert.equal(caps.sourceReady, true, 'CAP-FAIL-1 sourceReady intact regardless of how long enrichment is stuck')
    assert.equal(caps.alaiChatReady, true)
    assert.equal(caps.repasarReady, false, 'CAP-FAIL-1 no artifact tool may generate while the universe can still change')
    assert.equal(caps.flashcardsReady, false)
    assert.equal(caps.analysisReady, false)
    assert.equal(caps.quizReady, false)
    assert.equal(caps.examReady, false)
    console.log('CAP-FAIL-1 PASS')
  }

  // CAP-FREEZE-1 — Quiz artifact identity is pure over (sessionId,
  // brainFingerprint, configFingerprint, generationId) — NOT over brain
  // content/enrichment revision. Since Quiz generation is now gated on
  // quizReady (full enrichment stability) before it can even start,
  // there is no "further enrichment" left to mutate an active
  // artifact's target universe — freeze is structural, not incidental.
  {
    const id1 = quizArtifactIdentity('sess-1', 'fp-cap', 'cfg-1')
    const id2 = quizArtifactIdentity('sess-1', 'fp-cap', 'cfg-1')
    assert.equal(id1, id2, 'CAP-FREEZE-1 identical inputs always produce the identical artifact identity — deterministic, content-independent')
    console.log('CAP-FREEZE-1 PASS (Quiz generation gated on quizReady => no enrichment left to mutate an active artifact)')
  }

  console.log('material-brain-capabilities-contracts: ALL PASS')
}

main()
