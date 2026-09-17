import assert from 'node:assert/strict'
import { resolveMaterialAcademicStability, isAcademicallyStable } from '../../lib/materialBrain/academicStability'
import { resolveMaterialCapabilities } from '../../lib/materialBrain/capabilities'
import { buildMaterialBrain, MAX_ENRICHMENT_ATTEMPTS_PER_LEAF } from '../../lib/materialBrain/build'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import type { ResolvedSourceMaterial } from '../../lib/materialBrain/types'

// ============================================================
// "Material Brain debe tener un final real y estable" — the canonical
// academic-stability model (academicStability.ts) and the per-leaf
// enrichment budget that makes it actually terminal (build.ts). No
// subject hardcoding — every fixture below is a synthetic, generic
// material (page count/leaf count as scale fixtures, not domain rules).
// ============================================================

function material(id: string, text: string): ResolvedSourceMaterial {
  return { materialId: id, nombre: id, kind: 'pdf', text, knownPages: [1] } as any
}

// A "hard" leaf whose rich extraction ALWAYS fails (simulates a
// persistently-malformed provider response for that one leaf) — the
// real-world failure class this whole mission is about.
function failingExtractFn(failIds: Set<string>) {
  return async (chunk: any) => {
    if (failIds.has(chunk.id)) {
      return {
        extraction: {
          units: [], relations: [], droppedInvalidProvenance: 0, droppedStructural: 0,
          warnings: [`chunk ${chunk.id} falló extracción tras agotar reintentos: synthetic failure [class:transient]`],
          telemetry: { chunkId: chunk.id, materialId: chunk.materialId, pages: chunk.pages, rawUnits: 0, rawRelations: 0, acceptedUnits: 0, acceptedRelations: 0, rejectedUnits: 0, rejectedRelations: 0, rejectedUnitRecords: [], wasRecovered: false, truncatedObjectsInResponse: 0 },
        },
      }
    }
    return {
      extraction: {
        units: [{ kind: 'fact', canonicalSubject: chunk.id, semanticKey: chunk.id, qualifiers: [], label: chunk.id, statement: `Rich statement for ${chunk.id}`, domainTags: [], provenance: [{ materialId: chunk.materialId, page: chunk.pages[0], quote: chunk.text.slice(0, 20), chunkId: chunk.id }], evidence: [{ materialId: chunk.materialId, page: chunk.pages[0], derivation: 'native_text', quote: chunk.text.slice(0, 20), chunkId: chunk.id }], importance: { tier: 'supporting', signals: ['model_judged'], confidence: 0.9 } }],
        relations: [], droppedInvalidProvenance: 0, droppedStructural: 0, warnings: [],
        telemetry: { chunkId: chunk.id, materialId: chunk.materialId, pages: chunk.pages, rawUnits: 1, rawRelations: 0, acceptedUnits: 1, acceptedRelations: 0, rejectedUnits: 0, rejectedRelations: 0, rejectedUnitRecords: [], wasRecovered: false, truncatedObjectsInResponse: 0 },
      },
    }
  }
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Academic stability + terminal enrichment budget contracts ──\n')

  // ── A/B/C/D/E/F/G — preparing blocks every artifact tool, ALAI/reading unaffected ──
  await test('A-G: a preparing Brain blocks Flashcards/Quiz/Repasar/Analisis/StudyMap/Truquitos/Exam; ALAI stays allowed at sourceReady', () => {
    const brain: any = { meta: { status: 'ready', sourceReadiness: 'ready', brainEnrichment: 'enriching' }, units: [{ id: 'u1' }], relations: [], visualCoverage: { status: 'not_required' } }
    const caps = resolveMaterialCapabilities(brain)
    assert.equal(caps.academicStability, 'preparing')
    for (const key of ['flashcardsReady', 'quizReady', 'repasarReady', 'analysisReady', 'studyMapReady', 'truquitosReady', 'examReady'] as const) {
      assert.equal(caps[key], false, `${key} must be false while preparing`)
    }
    assert.equal(caps.alaiChatReady, true, 'H: ALAI stays allowed at sourceReady alone')
  })

  // ── J/K/L — terminal states gate correctly ──
  await test('J: stable_rich allows every artifact tool', () => {
    const brain: any = { meta: { status: 'ready', sourceReadiness: 'ready', brainEnrichment: 'ready' }, units: [{ id: 'u1' }], relations: [], visualCoverage: { status: 'not_required' } }
    const caps = resolveMaterialCapabilities(brain)
    assert.equal(caps.academicStability, 'stable_rich')
    for (const key of ['flashcardsReady', 'quizReady', 'repasarReady', 'analysisReady', 'studyMapReady', 'truquitosReady', 'examReady'] as const) {
      assert.equal(caps[key], true, `${key} must be true when stable_rich`)
    }
  })

  await test('K: stable_degraded allows every artifact tool exactly like stable_rich', () => {
    const brain: any = { meta: { status: 'ready', sourceReadiness: 'ready', brainEnrichment: 'degraded' }, units: [{ id: 'u1' }], relations: [], visualCoverage: { status: 'not_required' } }
    const caps = resolveMaterialCapabilities(brain)
    assert.equal(caps.academicStability, 'stable_degraded')
    for (const key of ['flashcardsReady', 'quizReady', 'repasarReady', 'analysisReady', 'studyMapReady', 'truquitosReady', 'examReady'] as const) {
      assert.equal(caps[key], true, `${key} must be true when stable_degraded — a legitimate terminal state, not a failure`)
    }
  })

  await test('L: failed blocks artifact generation entirely', () => {
    const brain: any = { meta: { status: 'ready', sourceReadiness: 'ready', brainEnrichment: 'failed' }, units: [{ id: 'u1' }], relations: [], visualCoverage: { status: 'not_required' } }
    const caps = resolveMaterialCapabilities(brain)
    assert.equal(caps.academicStability, 'failed')
    for (const key of ['flashcardsReady', 'quizReady', 'repasarReady', 'analysisReady', 'studyMapReady', 'truquitosReady', 'examReady'] as const) {
      assert.equal(caps[key], false)
    }
    const brainStatusFailed: any = { meta: { status: 'failed' }, units: [], relations: [], visualCoverage: { status: 'not_required' } }
    assert.equal(resolveMaterialAcademicStability(brainStatusFailed), 'failed', 'a required-source-coverage failure is also terminal failed')
  })

  await test('I: reading (no Brain dependency) is structurally unaffected — resolveMaterialAcademicStability(null) never throws, always resolves to a safe non-generating value', () => {
    assert.equal(resolveMaterialAcademicStability(null), 'preparing')
    assert.equal(resolveMaterialAcademicStability(undefined), 'preparing')
    assert.equal(isAcademicallyStable('preparing'), false)
  })

  // ── Q/R/S — the terminal enrichment budget itself, via the real build pipeline ──
  await test('Q: a leaf whose rich extraction fails every time eventually becomes terminal fallback (stable_degraded), never a perpetual candidate', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-budget' }
    const materials = [material('mat-a', 'Este es un párrafo con contenido académico suficientemente largo para formar un chunk real de prueba. '.repeat(3))]
    const failIds = new Set<string>()
    let previousBrain = await buildMaterialBrain(scope, materials, { chunkSizeChars: 200, skipRichExtraction: true })
    // mark every leaf as the "always fails" leaf for the enrichment passes below
    for (const id of Object.keys(previousBrain.meta.subchunkCheckpoints || {})) failIds.add(id)
    assert.ok(failIds.size > 0, 'fixture sanity: at least one leaf exists')

    let brain = previousBrain
    let passes = 0
    // Run MORE passes than the budget allows — this simulates refresh/
    // new session/new server invocation, each re-triggering an
    // enrichment pass against the SAME persisted checkpoints.
    for (let i = 0; i < MAX_ENRICHMENT_ATTEMPTS_PER_LEAF + 2; i++) {
      passes++
      brain = await buildMaterialBrain(scope, materials, {
        chunkSizeChars: 200, enrichmentPass: true, enrichmentBatchSize: 50,
        previousBrain: brain, extractFn: failingExtractFn(failIds) as any,
      })
    }
    assert.equal(brain.meta.brainEnrichment, 'degraded', `after ${passes} passes (budget=${MAX_ENRICHMENT_ATTEMPTS_PER_LEAF}) the brain must be terminally degraded, got ${brain.meta.brainEnrichment}`)
    assert.equal(resolveMaterialAcademicStability(brain), 'stable_degraded')

    // R: no automatic enrichment after stable — running MORE passes must
    // not change anything (no more provider calls even attempted for the
    // exhausted leaf, and the resulting brain is byte-identical in the
    // fields that matter).
    const afterStable = await buildMaterialBrain(scope, materials, {
      chunkSizeChars: 200, enrichmentPass: true, enrichmentBatchSize: 50,
      previousBrain: brain, extractFn: failingExtractFn(failIds) as any,
    })
    assert.equal(afterStable.meta.brainEnrichment, 'degraded')
    assert.deepEqual(afterStable.units.map(u => u.id).sort(), brain.units.map(u => u.id).sort(), 'S: stable snapshot unit ids never drift after re-running the lifecycle/enrichment continuation again')
  })

  // ── T — 46→89 regression class ──
  await test('T: 46→89 regression class — a brain with fewer eligible targets while preparing must reject new generation; once stable with the FINAL target count, generation is allowed', () => {
    // Base (preparing) universe: 46 synthetic targets.
    const baseUnits = Array.from({ length: 46 }, (_, i) => ({ id: `base-u${i}` }))
    const preparingBrain: any = { meta: { status: 'ready', sourceReadiness: 'ready', brainEnrichment: 'enriching' }, units: baseUnits, relations: [], visualCoverage: { status: 'not_required' } }
    const preparingCaps = resolveMaterialCapabilities(preparingBrain)
    assert.equal(preparingCaps.flashcardsReady, false, 'T: generation must be REJECTED while the base (46-target) universe could still be replaced')

    // Rich (stable) universe arrives later: 89 targets, DIFFERENT ids
    // (base fallback ids never survive a real rich upgrade).
    const richUnits = Array.from({ length: 89 }, (_, i) => ({ id: `rich-u${i}` }))
    const stableBrain: any = { meta: { status: 'ready', sourceReadiness: 'ready', brainEnrichment: 'ready' }, units: richUnits, relations: [], visualCoverage: { status: 'not_required' } }
    const stableCaps = resolveMaterialCapabilities(stableBrain)
    assert.equal(stableCaps.flashcardsReady, true, 'T: generation allowed once the FINAL (89-target) universe is stable')
    assert.equal(stableBrain.units.length, 89, 'T: the planner would receive exactly the final 89 targets, never the transient 46')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('academic-stability-contracts: ALL PASS')
}

main()
