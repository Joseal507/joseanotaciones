import assert from 'node:assert/strict'
import { adaptiveBlockSizeOptions, PAGE_STUDY_BLOCK_PRESETS, PAGE_STUDY_DEFAULT_BLOCK_SIZE } from '../../lib/pageStudy/ui'

/**
 * Phase 6I/J: block-size options adapt to the actual selected materials' page counts, via an
 * explicit bucketed progression (small documents get few choices, large documents get more
 * granularity, full material always included) — superseding Phase 5's "fixed presets filtered
 * and unioned with the full length" rule, which produced e.g. [5,10,15,20] for a 20-page
 * document instead of the cleaner [5,10,20]. Custom is removed entirely (Phase 6J): once the
 * bucketed choices always include the exact full-document size, Custom had no remaining value.
 */

// 2 pages — tiny material collapses to "full material", no meaningless choice.
{
  const plan = adaptiveBlockSizeOptions([2])
  assert.equal(plan.mode, 'full'); assert.equal(plan.recommended, 2); assert.deepEqual(plan.choices.map(c => c.size), []); assert.equal(plan.showCustom, false)
  assert.equal(plan.fullLabel, '2 páginas · material completo')
}

// 4 pages — still tiny, still full material.
{
  const plan = adaptiveBlockSizeOptions([4])
  assert.equal(plan.mode, 'full'); assert.equal(plan.recommended, 4)
}

// 8 pages → [5, 8]
{
  const plan = adaptiveBlockSizeOptions([8])
  assert.equal(plan.mode, 'choices')
  assert.deepEqual(plan.choices.map(c => c.size), [5, 8])
  assert.equal(plan.showCustom, false, 'no meaningless Custom option')
  assert.equal(plan.choices.find(c => c.size === 8)!.label.includes('completo'), true)
}

// 10 pages → [5, 10]
{
  const plan = adaptiveBlockSizeOptions([10])
  assert.deepEqual(plan.choices.map(c => c.size), [5, 10])
}

// 15 pages → [5, 10, 15]
{
  const plan = adaptiveBlockSizeOptions([15])
  assert.deepEqual(plan.choices.map(c => c.size), [5, 10, 15])
  assert.equal(plan.recommended, PAGE_STUDY_DEFAULT_BLOCK_SIZE)
}

// 20 pages → [5, 10, 20] (NOT [5,10,15,20] — 20 is itself the full-material choice, 15 is dropped
// once it's no longer a distinct meaningful step below the bucket's own granularity)
{
  const plan = adaptiveBlockSizeOptions([20])
  assert.deepEqual(plan.choices.map(c => c.size), [5, 10, 20])
}

// 25 pages → [5, 10, 15, 25]
{
  const plan = adaptiveBlockSizeOptions([25])
  assert.deepEqual(plan.choices.map(c => c.size), [5, 10, 15, 25])
}

// 30 pages → [5, 10, 15, 30]
{
  const plan = adaptiveBlockSizeOptions([30])
  assert.deepEqual(plan.choices.map(c => c.size), [5, 10, 15, 30])
}

// 50 pages → [5, 10, 15, 20, 25, 50]
{
  const plan = adaptiveBlockSizeOptions([50])
  assert.deepEqual(plan.choices.map(c => c.size), [5, 10, 15, 20, 25, 50])
}

// No option ever exceeds the document's own page count; full material is always present.
for (const pages of [8, 10, 15, 20, 25, 30, 50]) {
  const plan = adaptiveBlockSizeOptions([pages])
  assert.ok(plan.choices.every(c => c.size <= pages), `no option exceeds ${pages} pages`)
  assert.ok(plan.choices.some(c => c.size === pages), `full material (${pages}) is always present`)
  assert.equal(plan.showCustom, false, `no meaningless Custom for ${pages} pages`)
}

// Multi-PDF, mixed lengths (2 + 20): bucketed by the LARGEST selected material — the 2-page
// material still resolves to its own single block automatically (planMaterialBlocks: block size
// >= a material's length collapses it to one block), never a phantom page range.
{
  const plan = adaptiveBlockSizeOptions([2, 20])
  assert.equal(plan.mode, 'choices')
  assert.deepEqual(plan.choices.map(c => c.size), [5, 10, 20], 'bucketed by the largest (20), not the smallest (2)')
}
{
  // All-small selection (2 + 4 pages): prefers simple full-material behavior.
  const plan = adaptiveBlockSizeOptions([2, 4])
  assert.equal(plan.mode, 'full'); assert.equal(plan.recommended, 4)
}

// >5 PDFs: the algorithm itself is agnostic to material COUNT (that constraint lives in the
// internal <=5 authority-batch rule, untouched) — bucketed by the largest of the >5 selected.
{
  const plan = adaptiveBlockSizeOptions([2, 4, 8, 15, 16, 42, 30])
  assert.equal(plan.mode, 'choices')
  assert.deepEqual(plan.choices.map(c => c.size), [5, 10, 15, 20, 25, 42])
}

// Unknown/missing page-count data (not loaded yet, or a kind Page Study can't page-count):
// degrade to the original fixed preset behavior — never a false "full material" claim.
{
  const plan = adaptiveBlockSizeOptions([undefined, null, 0, NaN])
  assert.equal(plan.mode, 'choices')
  assert.deepEqual(plan.choices.map(c => c.size), [...PAGE_STUDY_BLOCK_PRESETS])
  assert.equal(plan.recommended, PAGE_STUDY_DEFAULT_BLOCK_SIZE)
}

console.log('PASS page-study-adaptive-block-size: 2/4/8/10/15/20/25/30/50-page materials, mixed multi-PDF, >5 PDFs, no Custom, unknown-data fallback — deterministic bucketed progression bounded by real document length')
