import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { aggregateMaterialLanguage, resolveMaterialLanguage, academicLanguageInstruction } from '../../lib/materialLanguage'
import { buildPayload, selectionOf, KEYS, MATERIALS, F, type Key } from './five-material-fixture'
import { serializeEnjoyerForFlashcards } from '../../lib/materialBrain/flashcards/enjoyerAdapter'
import { buildEnjoyerFlashcardPrompt, generateEnjoyerFlashcardDeck } from '../../lib/materialBrain/flashcards/enjoyerGenerator'
import { buildEnjoyerAssessmentUniverse } from '../../lib/materialBrain/quiz/enjoyer'
import { buildExamEnjoyerUniverse, composeEnjoyerExamBlueprint, computeExamEnjoyerTimeBounds } from '../../lib/materialBrain/examEnjoyerContext'
import { buildRepasarEnjoyerGroundedContext } from '../../lib/materialBrain/repasarEnjoyerContext'
import { freezeRepasarEnjoyerSnapshot, snapshotGroundedContext } from '../../lib/materialBrain/repasarSnapshot'
import { renderRepasarGroundedContextForPrompt } from '../../lib/materialBrain/reviewContext'
import { buildAnalysisEnjoyerContext, renderAnalysisEnjoyerContext } from '../../lib/materialBrain/analysisEnjoyerContext'
import { buildChatEnjoyerContext, retrieveForChat, renderChatEnjoyerContext } from '../../lib/materialBrain/chatEnjoyerContext'
import { buildStudyMapEnjoyerContext, buildStudyMapNodeExplanationContext, renderStudyMapNodeExplanationContext } from '../../lib/materialBrain/studyMapEnjoyerContext'
import { buildTruquitosEnjoyerContext, renderTruquitosEnjoyerContext } from '../../lib/materialBrain/truquitosEnjoyerContext'
import { buildLearningJourney } from '../../lib/adaptive/journeyBuilder'
import { buildTeachingOnlyPrompt, } from '../../app/api/adaptive/session-teach/route'
import { certifyBlueprint } from '../../app/api/adaptive/blueprint/route'

const matOf = (letter: string) => `mat-${letter}`

type Tool = { name: string; build: (p: any, s: any) => { items: any[]; language: string } }
const tools: Tool[] = [
  { name: 'Flashcards', build: (p, s) => { const r = serializeEnjoyerForFlashcards(p, s.fingerprint, s); return { items: r.sourceItems, language: r.materialLanguage! } } },
  { name: 'Quiz', build: (p, s) => { const r = buildEnjoyerAssessmentUniverse(p, s); return { items: r.targets, language: r.materialLanguage! } } },
  { name: 'Exam', build: (p, s) => { const r = buildExamEnjoyerUniverse(p, s); return { items: r.targets, language: r.materialLanguage! } } },
  { name: 'Repasar', build: (p, s) => { const r = buildRepasarEnjoyerGroundedContext(p, s); return { items: r.targets, language: r.materialLanguage! } } },
  { name: 'Study Map', build: (p, s) => { const r = buildStudyMapEnjoyerContext(p, s); return { items: r.nodes, language: r.materialLanguage! } } },
  { name: 'Chat', build: (p, s) => { const r = buildChatEnjoyerContext(p, s); return { items: r.targets, language: r.materialLanguage! } } },
  { name: 'Truquitos', build: (p, s) => { const r = buildTruquitosEnjoyerContext(p, s); return { items: r.targets, language: r.language } } },
  { name: 'Analysis', build: (p, s) => { const r = buildAnalysisEnjoyerContext(p, s); return { items: r.targets, language: r.materialLanguage! } } },
]
const markerOf = (item: unknown) => /Marker ([A-E])(\d)/.exec(JSON.stringify(item))

async function main() {
  // ── 1. Identity ────────────────────────────────────────────────
  const five = selectionOf(KEYS)
  assert.equal(five.materialIds.length, 5)
  assert.deepEqual(five.selectedPages, { 'mat-A': [1, 2, 3], 'mat-B': [1, 2, 3, 4], 'mat-C': [1, 2], 'mat-D': [1, 2, 3], 'mat-E': [1, 2, 3] })
  const fps = new Set([
    five.fingerprint,
    selectionOf(['A', 'B', 'C', 'D']).fingerprint,                 // remove E
    selectionOf(KEYS, { C: [1] }).fingerprint,                     // change pages of C
    selectionOf(KEYS, { A: [1, 2] }).fingerprint,
  ])
  assert.equal(fps.size, 4, 'removing a material or changing one material\'s pages changes identity')
  const reversed = selectionOf([...KEYS].reverse())
  assert.equal(reversed.fingerprint, five.fingerprint, 'fingerprint is canonical (order-independent), per the existing snapshot contract')
  const six = buildSourceSelectionSnapshot([...five.materialIds, F.id], { ...five.selectedPages, [F.id]: [1] })
  assert.equal(six.materialIds.length, 5, 'snapshot never grows beyond 5 materials')
  assert.ok(!six.materialIds.includes(F.id))
  // same page numbers in different materials are different selections
  assert.notEqual(buildSourceSelectionSnapshot(['x', 'y'], { x: [2], y: [3] }).fingerprint, buildSourceSelectionSnapshot(['x', 'y'], { x: [3], y: [2] }).fingerprint)

  // ── 2..5. Every tool: 5 accepted, all represented, provenance, language ───
  const { payload, selection } = buildPayload(KEYS)
  assert.equal(resolveMaterialLanguage(payload), 'en')
  const metrics: string[] = []
  for (const tool of tools) {
    const { items, language } = tool.build(payload, selection)
    assert.equal(language, 'en', `${tool.name}: language authority`)
    assert.equal(items.length, 15, `${tool.name}: all 15 (material,page) sources present`)
    assert.deepEqual([...new Set(items.map(i => i.materialId))].sort(), ['mat-A', 'mat-B', 'mat-C', 'mat-D', 'mat-E'], `${tool.name}: all five materials represented`)
    const ids = items.map(i => i.id ?? i.sourceItemId)
    assert.equal(new Set(ids).size, ids.length, `${tool.name}: unique ids`)
    for (const item of items) { // page-number collision safety: marker letter+page must match materialId+page
      const m = markerOf(item)!
      assert.ok(m, `${tool.name}: marker present`)
      assert.equal(item.materialId, matOf(m[1]), `${tool.name}: ${m[0]} attributed to ${item.materialId}`)
      const pages: number[] = item.pages ?? (item.page ? [item.page] : [])
      if (pages.length) assert.ok(pages.includes(Number(m[2])), `${tool.name}: ${m[0]} page`)
    }
    // page 2 exists in all five materials and stays five independent sources
    const page2 = items.filter(i => markerOf(i)![2] === '2')
    assert.equal(new Set(page2.map(i => i.materialId)).size, 5, `${tool.name}: page-2 collision keeps 5 materials`)
    // sixth material: fail closed (or absent) when a foreign item is in the persisted payload
    const foreign = buildPayload(KEYS, { extra: [{ id: 'F-p1', kind: 'concept', label: 'Zorblax protocol', summary: F.fact, materialId: F.id, pages: [1], topicId: 'topic_A', globalOrder: 99, sourceSpans: [{ page: 1, quote: F.fact }] }] })
    let leaked = false
    try { leaked = JSON.stringify(tool.build(foreign.payload, foreign.selection).items).includes('Zorblax') } catch (e: any) { assert.match(e.message, /SOURCE_SELECTION_MISMATCH/, `${tool.name}: fail-closed reason`) }
    assert.equal(leaked, false, `${tool.name}: sixth material must never enter the universe`)
    // 4-material selection against a 5-material artifact must not silently serve it
    const four = selectionOf(['A', 'B', 'C', 'D'])
    assert.throws(() => tool.build(payload, four), undefined, `${tool.name}: changed selection rejects the other artifact`)
    // identical wording in two materials stays two sources (provenance not collapsed)
    const dup = buildPayload(KEYS); const a = dup.payload.blueprint.globalOrderedAnalysis
    a.push({ ...a[0], id: 'D-dup', materialId: 'mat-D', pages: [1], topicId: 'topic_D', globalOrder: 50, sourceSpans: [{ page: 1, quote: a[0].sourceSpans[0].quote }] })
    const dupItems = tool.build(dup.payload, dup.selection).items.filter(i => JSON.stringify(i).includes('Marker A1'))
    assert.deepEqual(dupItems.map(i => i.materialId).sort(), ['mat-A', 'mat-D'], `${tool.name}: duplicate concept keeps both materials`)
    metrics.push(`${tool.name}=${items.length}`)
  }

  // ── 6. Language across materials ───────────────────────────────
  assert.equal(aggregateMaterialLanguage([{ language: 'en', weight: 4000 }, { language: 'en', weight: 4000 }, { language: 'es', weight: 4000 }, { language: 'en', weight: 4000 }, { language: 'en', weight: 4000 }]), 'en')
  assert.equal(aggregateMaterialLanguage([{ language: 'und', weight: 9000 }, { language: 'es', weight: 1000 }]), 'es', 'und never outvotes a concrete language')
  assert.equal(aggregateMaterialLanguage([{ language: 'und', weight: 9 }]), 'und')
  const mixed = buildPayload(KEYS, { spanish: ['C'] })
  assert.equal(resolveMaterialLanguage(mixed.payload), 'en', 'English dominates 4 of 5 materials')
  for (const tool of tools) {
    const { items, language } = tool.build(mixed.payload, mixed.selection)
    assert.equal(language, 'en', `${tool.name}: mixed → dominant language`)
    const c = items.filter(i => i.materialId === 'mat-C')
    assert.equal(c.length, 2)
    assert.ok(c.every(i => JSON.stringify(i).includes('la idea principal es que la luz solar')), `${tool.name}: Spanish source text of C stays verbatim`)
  }
  assert.ok(academicLanguageInstruction('en').includes('Preserve quoted source excerpts verbatim, including multilingual quotations'))

  // ── 8. Chat retrieval scope ────────────────────────────────────
  const chat = buildChatEnjoyerContext(payload, selection)
  const mats = (q: string) => [...new Set((retrieveForChat({ query: q, context: chat }) as any).targets.map((t: any) => t.materialId))].sort()
  assert.deepEqual(mats('What is photosynthesis?'), ['mat-A'])
  assert.deepEqual(mats('What is sp3 hybridization?'), ['mat-B'])
  assert.deepEqual(mats('What does F = ma mean?'), ['mat-E'])
  const cross = mats('Compare the role of energy in photosynthesis and Newton second law.')
  assert.ok(cross.includes('mat-A') && cross.includes('mat-E'), 'cross-material query reaches both relevant materials')
  assert.ok(!cross.includes('mat-C') && !cross.includes('mat-D'), 'unrelated History/Math are not pulled in')
  assert.ok(!renderChatEnjoyerContext(retrieveForChat({ query: 'What is photosynthesis?', context: chat })).includes(MATERIALS.B.fact))
  assert.equal(chat.materialLanguage, 'en') // conversation cannot mutate canonical language/selection

  // ── 9. Study Map ───────────────────────────────────────────────
  const map = buildStudyMapEnjoyerContext(payload, selection)
  assert.equal(new Set(map.nodes.map(n => n.id)).size, map.nodes.length)
  const pick = map.nodes.filter(n => markerOf(n)![2] === '1')
  assert.equal(pick.length, 5)
  for (const n of pick) {
    const ex = buildStudyMapNodeExplanationContext(map, [n.id])!
    assert.equal(ex.nodes[0].materialId, matOf(markerOf(n)![1]))
    assert.ok(renderStudyMapNodeExplanationContext(ex).includes(`Marker ${markerOf(n)![1]}1`))
  }

  // ── 10-12. Flashcards / Quiz / Exam generation universe ────────
  const src = serializeEnjoyerForFlashcards(payload, selection.fingerprint, selection)
  let calls = 0; const prompts: string[] = []
  const deck = await generateEnjoyerFlashcardDeck(payload, selection, { provider: async request => {
    calls++; prompts.push(buildEnjoyerFlashcardPrompt(request))
    const items = src.sourceItems.filter(i => (request as any).sourceItems ? (request as any).sourceItems.some((s: any) => s.id === i.id) : true)
    if (calls === 1) return [] // force coverage repair
    return items.map(i => ({ question: `Q ${i.name}`, answer: i.content, sourceItemIds: [i.id], pages: i.pages, sourceSpans: [{ sourceItemId: i.id, page: i.pages[0], quote: i.content }] }))
  } })
  assert.ok(calls >= 2, 'repair path exercised')
  assert.deepEqual([...new Set(deck.cards.map(c => (c.provenance[0] as any).materialId))].sort(), ['mat-A', 'mat-B', 'mat-C', 'mat-D', 'mat-E'])
  for (const card of deck.cards) { const m = markerOf(card.answer)!; assert.equal((card.provenance[0] as any).materialId, matOf(m[1])) }
  assert.ok(prompts.every(p => p.includes('AUTHORITY: en.')), 'every generation/repair prompt carries the single canonical language')

  const universe = buildExamEnjoyerUniverse(payload, selection)
  const bounds = computeExamEnjoyerTimeBounds(universe)
  const blueprint = composeEnjoyerExamBlueprint(universe, 90, 'exam-5', 'seed') as any
  const slotMaterials = new Set<string>()
  const byId = new Map(universe.targets.map(t => [t.sourceItemId, t.materialId]))
  for (const slot of blueprint.slots || []) for (const id of slot.sourceItemIds || []) slotMaterials.add(byId.get(id) as string)
  assert.ok(bounds.minimumViableDurationMinutes > 0)
  assert.ok(slotMaterials.size >= 4, `exam composition draws from many materials, got ${[...slotMaterials]}`)

  // ── 13. Repasar freeze → serialize → restore ───────────────────
  const review = buildRepasarEnjoyerGroundedContext(payload, selection)
  const restored = snapshotGroundedContext(JSON.parse(JSON.stringify(freezeRepasarEnjoyerSnapshot(review))))
  assert.equal(restored.fingerprint, selection.fingerprint)
  assert.equal(restored.materialLanguage, 'en')
  assert.deepEqual([...new Set(restored.targets.map(t => t.materialId))].sort(), ['mat-A', 'mat-B', 'mat-C', 'mat-D', 'mat-E'])
  assert.equal(restored.targets.length, 15)

  // ── 16. Adaptive: journey keeps every block; block→material intact; partial failure honest ──
  const { blocks } = buildPayload(KEYS)
  const bp: any = { ...payload.blueprint, version: 2, blocks: blocks.map(b => ({ ...b, name: b.label })), topics: (payload.blueprint as any).topicsIndex.map((t: any) => ({ ...t, pages: [1] })), sourceSelection: selection, materials: selection.materialIds.map(id => ({ materialId: id, materialName: id })) }
  const journey: any = await buildLearningJourney(bp, { examDateType: 'none' } as any, 'Five materials')
  assert.deepEqual(journey.materialIds, selection.materialIds)
  const journeyBlocks = new Set<string>(journey.chapters.flatMap((c: any) => c.blockIds || []))
  assert.equal(journeyBlocks.size, 15, 'no selected material is dropped from the learning journey')
  assert.equal(journey.materialLanguage, 'en')
  const teachSession = { kind: 'learning', blockIds: ['E-p2'] }
  const prompt = buildTeachingOnlyPrompt({ session: teachSession, blueprint: { ...bp, blocks: bp.blocks, topics: bp.topics }, setup: {}, userProfile: {} } as any)
  assert.ok(prompt.includes('AUTHORITY: en.'))
  assert.ok(prompt.includes('Marker E2'), 'teaching prompt is grounded on the requested block of Material E')
  assert.ok(!prompt.includes(F.fact) && !prompt.includes('Marker A1'), 'teaching prompt does not pull unrelated materials')

  // ── 17. Partial failure: Material C analysis fails → never certified / never "100%" ──
  const okQuality = { status: 'ok', reasons: [] }
  const okAudit = { passed: true, issues: [], uncoveredFragments: [], status: 'passed' as const }
  const healthy = certifyBlueprint({ topics: bp.topics, blocks: bp.blocks }, okQuality, okAudit, [], {})
  assert.equal(healthy.coverageCertified, true)
  const partialBlocks = bp.blocks.filter((b: any) => b.materialId !== 'mat-C')
  const partial = certifyBlueprint({ topics: bp.topics, blocks: partialBlocks }, okQuality, okAudit, [], {
    pageDispositions: { 'mat-C:1': { status: 'uncovered_with_content', reason: 'analysis failed', charCount: 900 }, 'mat-C:2': { status: 'uncovered_with_content', reason: 'analysis failed', charCount: 900 }, 'mat-A:1': { status: 'represented', reason: 'ok', charCount: 900 } },
  })
  assert.equal(partial.coverageCertified, false)
  assert.equal(partial.planGenerationAllowed, false)
  assert.ok(partial.certificationReasons.some(r => /UNCOVERED_ACADEMIC_PAGE: mat-C:1/.test(r)), partial.certificationReasons.join('|'))
  assert.ok(partial.certificationReasons.some(r => /History/.test(r)), 'topic of the failed material is named')
  assert.ok(!partial.certificationReasons.some(r => /mat-[ABDE]:/.test(r)), 'healthy materials are not blamed')

  // ── 19. Scale: rendered context is bounded and linear (no per-material duplication) ──
  const chars = {
    chat: renderChatEnjoyerContext(retrieveForChat({ query: 'energy', context: chat })).length,
    repasar: renderRepasarGroundedContextForPrompt(review).length,
    analysis: renderAnalysisEnjoyerContext(buildAnalysisEnjoyerContext(payload, selection)).length,
    truquitos: renderTruquitosEnjoyerContext(buildTruquitosEnjoyerContext(payload, selection).targets).length,
  }
  const singleChars = renderRepasarGroundedContextForPrompt(buildRepasarEnjoyerGroundedContext(buildPayload(['A']).payload, selectionOf(['A']))).length
  assert.ok(chars.repasar < singleChars * 8, `repasar context grows ~linearly with materials (${chars.repasar} vs single ${singleChars})`)
  const repasarText = renderRepasarGroundedContextForPrompt(review)
  for (const m of ['A1', 'B4', 'C2', 'D3', 'E3']) assert.ok(repasarText.split(`Marker ${m}`).length - 1 <= 3, `Marker ${m} serialized more than 3 times`)
  console.log(`METRICS materials=5 sources=15 ${metrics.join(' ')} chars=${JSON.stringify(chars)} singleMaterialRepasarChars=${singleChars} languageDetectionProviderCalls=0`)
  console.log('PASS five-material authority: identity, provenance collisions, coverage, sixth-material exclusion, language, 8 Free contexts, Adaptive, partial failure')
}
main().catch(e => { console.error(e); process.exit(1) })
