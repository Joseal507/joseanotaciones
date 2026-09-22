import assert from 'node:assert/strict'
import { adaptiveBlockSizeOptions, PAGE_STUDY_BLOCK_PRESETS, PAGE_STUDY_DEFAULT_BLOCK_SIZE } from '../../lib/pageStudy/ui'

/**
 * Phase 5I: block-size options must adapt to the actual selected materials' page counts —
 * a 2-page PDF must never be asked to choose between 5/10/15/20, all of which resolve to the
 * exact same one-block plan as "study the whole thing".
 */

// 2 pages — tiny material collapses to "full material", no meaningless choice.
{
  const plan = adaptiveBlockSizeOptions([2])
  assert.equal(plan.mode, 'full'); assert.equal(plan.recommended, 2); assert.equal(plan.choices.length, 0); assert.equal(plan.showCustom, false)
  assert.equal(plan.fullLabel, '2 páginas · material completo')
}

// 4 pages — still tiny, still full material (never offers choices larger than the document).
{
  const plan = adaptiveBlockSizeOptions([4])
  assert.equal(plan.mode, 'full'); assert.equal(plan.recommended, 4)
  assert.ok(!PAGE_STUDY_BLOCK_PRESETS.some(size => size === plan.recommended && size > 4))
}

// 8 pages — medium: a real subdivision (half) plus the whole material, never the mechanical 5/10/15/20 set.
{
  const plan = adaptiveBlockSizeOptions([8])
  assert.equal(plan.mode, 'choices')
  assert.deepEqual(plan.choices.map(c => c.size), [5, 8])
  assert.ok(plan.choices.every(c => c.size <= 8), '8-page material never offers a block size larger than itself')
  assert.equal(plan.choices.find(c => c.size === 8)!.label.includes('completo'), true)
}

// 15 pages — larger material: sensible preset choices bounded by the document, including the default.
{
  const plan = adaptiveBlockSizeOptions([15])
  assert.deepEqual(plan.choices.map(c => c.size), [5, 10, 15])
  assert.equal(plan.recommended, PAGE_STUDY_DEFAULT_BLOCK_SIZE)
  assert.equal(plan.showCustom, true)
}

// 16 pages — the 20 preset doesn't fit; the material's own length (16) is offered explicitly instead.
{
  const plan = adaptiveBlockSizeOptions([16])
  assert.deepEqual(plan.choices.map(c => c.size), [5, 10, 15, 16])
  assert.ok(plan.choices.every(c => c.size <= 16))
}

// 42 pages — every fixed preset fits; still bounded (no size > document) with Custom available.
{
  const plan = adaptiveBlockSizeOptions([42])
  assert.deepEqual(plan.choices.map(c => c.size), [5, 10, 15, 20, 42])
  assert.equal(plan.showCustom, true)
}

// Multi-PDF, mixed lengths: the choice is bucketed by the LARGEST selected material — smaller
// materials in the same selection still resolve to their own single block automatically via
// planMaterialBlocks (block size >= a material's length collapses it to one block), so bucketing
// on the max is the only choice that stays meaningful for every material in the selection.
{
  const plan = adaptiveBlockSizeOptions([2, 15, 42])
  assert.equal(plan.mode, 'choices')
  assert.deepEqual(plan.choices.map(c => c.size), [5, 10, 15, 20, 42], 'bucketed by the largest (42), not the smallest (2) or a naive average')
}
{
  // All tiny materials together still collapse to "full material" for the whole selection.
  const plan = adaptiveBlockSizeOptions([2, 3, 4])
  assert.equal(plan.mode, 'full'); assert.equal(plan.recommended, 4)
}

// >5 PDFs: the algorithm itself is agnostic to material COUNT (that constraint lives in the
// internal <=5 authority-batch rule, untouched) — it must not choke or special-case a long list.
{
  const plan = adaptiveBlockSizeOptions([2, 4, 8, 15, 16, 42, 30])
  assert.equal(plan.mode, 'choices')
  assert.deepEqual(plan.choices.map(c => c.size), [5, 10, 15, 20, 42], 'bucketed by the largest of the >5 selected materials (42)')
}

// Unknown/missing page-count data (not loaded yet, or a kind Page Study can't page-count):
// degrade to the original fixed preset behavior — never a false "full material" claim.
{
  const plan = adaptiveBlockSizeOptions([undefined, null, 0, NaN])
  assert.equal(plan.mode, 'choices')
  assert.deepEqual(plan.choices.map(c => c.size), [...PAGE_STUDY_BLOCK_PRESETS])
  assert.equal(plan.recommended, PAGE_STUDY_DEFAULT_BLOCK_SIZE)
}

console.log('PASS page-study-adaptive-block-size: 2/4/8/15/16/42-page materials, mixed-length multi-PDF, >5 PDFs, unknown-data fallback — deterministic, bounded by real document length')
