import assert from 'node:assert/strict'
import { buildAnalysisEnjoyerContext } from '../../lib/materialBrain/analysisEnjoyerContext'
import { compileStudyNotes, planStudyNoteTopics, studyNotesPrompts, validateStudyNotes } from '../../lib/materialBrain/analysisStudyNotes'
import { buildPayload, KEYS, F } from './five-material-fixture'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { prepareAcademicContentForDelivery } from '../../lib/academic-content/validation'

const { payload, selection } = buildPayload(KEYS)
const context = buildAnalysisEnjoyerContext(payload, selection)
function valid(ctx = context) {
  return { title: ctx.targets[0].label, overview: ctx.targets[0].content, topics: planStudyNoteTopics(ctx).map(topic => ({
    title: topic.title, sourceTopicIds: [topic.id], points: [{ representation: 'explanation',
      content: topic.targets.map(target => target.content).join('\n\n'), targetIds: topic.targets.map(target => target.id),
      evidence: topic.targets.map(target => ({ targetId: target.id, quote: target.content, summaryAnchor: target.content })),
    }],
  })) }
}

async function main() {
  const checked = validateStudyNotes(valid(), context)
  assert.deepEqual(checked.issues, [])
  const notes = checked.notes!
  assert.equal(notes.topics.length, 5)
  assert.equal(notes.grounding.coveragePercent, 100)
  assert.equal(notes.grounding.coveredBlockIds.length, context.targets.length)
  assert.equal(new Set(notes.topics.flatMap(topic => topic.sources.map(s => s.materialId))).size, 5)
  for (const topic of notes.topics) {
    assert.ok(topic.points.length < topic.coveredBlockIds.length)
    for (const source of topic.sources) assert.ok(source.sourceSpans.every(span => source.pages.includes(span.page)))
  }
  const polluted = structuredClone(payload)
  polluted.blueprint.globalOrderedAnalysis.push({ ...polluted.blueprint.globalOrderedAnalysis[0], id: 'sixth', materialId: F.id, summary: F.fact })
  assert.throws(() => buildAnalysisEnjoyerContext(polluted, selection), /SOURCE_SELECTION_MISMATCH/)
  const badSpan = structuredClone(payload)
  badSpan.blueprint.globalOrderedAnalysis[0].sourceSpans.push({ page: 99, quote: 'Unselected page' })
  assert.throws(() => buildAnalysisEnjoyerContext(badSpan, selection), /SOURCE_SELECTION_MISMATCH/)
  const orphan = structuredClone(payload)
  orphan.blueprint.topicsIndex.push({ id: 'unblocked-topic', title: 'Additional authorized topic', order: 10,
    description: 'This authorized topic describes a process absent from the extracted blocks.', materialId: selection.materialIds[0], pages: [1],
  } as typeof orphan.blueprint.topicsIndex[number])
  const orphanContext = buildAnalysisEnjoyerContext(orphan, selection)
  assert.equal(orphanContext.targets.length, context.targets.length + 1)
  assert.ok(validateStudyNotes(valid(orphanContext), orphanContext).notes!.topics.some(topic => topic.sources.some(source => source.coveredTopicIds.includes('unblocked-topic'))))
  const collision = structuredClone(payload)
  collision.blueprint.globalOrderedAnalysis[3].id = collision.blueprint.globalOrderedAnalysis[0].id
  const collisionContext = buildAnalysisEnjoyerContext(collision, selection)
  assert.equal(new Set(collisionContext.targets.map(t => t.id)).size, collisionContext.targets.length)
  assert.equal(new Set(collisionContext.targets.filter(t => t.sourceItemId === collision.blueprint.globalOrderedAnalysis[0].id).map(t => t.materialId)).size, 2)

  for (const [language, content] of Object.entries({ en: 'Photosynthesis converts light energy into chemical energy. Chlorophyll absorbs light.', es: 'La fotosíntesis convierte la energía luminosa en energía química. La clorofila absorbe la luz.', zh: '光合作用将光能转化为化学能。叶绿素吸收光，植物利用这些能量合成有机物。' })) {
    const sel = buildSourceSelectionSnapshot(['mat'], { mat: [1] })
    const ctx = buildAnalysisEnjoyerContext({ materialLanguage: language, sourceSelectionFingerprint: sel.fingerprint,
      topicsIndex: [{ id: 'topic', title: content }], globalOrderedAnalysis: [{ id: 'block', topicId: 'topic', label: content, content, pages: [1], materialId: 'mat', sourceSpans: [{ page: 1, quote: content }] }],
      uniqueConceptsIndex: [{ id: 'concept', topicId: 'topic', label: content, content, pages: [1], materialId: 'mat', sourceSpans: [{ page: 1, quote: content }] }],
    }, sel)
    const result = validateStudyNotes(valid(ctx), ctx).notes!
    assert.equal(result.materialLanguage, language)
    assert.deepEqual(result.grounding.coveredConceptIds, ['concept'])
    assert.deepEqual(result.grounding.coveredBlockIds, ['block'])
    assert.equal(JSON.parse(JSON.stringify(result)).topics[0].points[0].content, content)
    assert.ok(studyNotesPrompts(ctx, 'universidad').system.includes(language))
    if (language === 'en') assert.doesNotMatch(JSON.stringify(result.topics), /Respuesta correcta|Explicación|Tu respuesta|Concepto clave/)
  }

  const incomplete = valid(); incomplete.topics.pop()
  assert.ok(validateStudyNotes(incomplete, context).missingTargetIds.length)
  const fakeEvidence = valid(); fakeEvidence.topics[0].points[0].evidence[0].quote = 'This claim was never in the material.'
  assert.match(validateStudyNotes(fakeEvidence, context).issues.join(), /unverified evidence/)
  const outsideExample = valid(); outsideExample.topics[1].points[0].representation = 'example'; outsideExample.topics[1].points[0].content = 'Carbon-14 is used for radiometric dating.'
  assert.match(validateStudyNotes(outsideExample, context).issues.join(), /exact source excerpt/)
  const duplicate = valid(); duplicate.topics.push(duplicate.topics[0])
  assert.match(validateStudyNotes(duplicate, context).issues.join(), /Duplicate topic|repeated target/)
  const dump = valid(); dump.topics[1].points = planStudyNoteTopics(context)[1].targets.map(t => ({ representation: 'explanation', content: t.content, targetIds: [t.id], evidence: [{ targetId: t.id, quote: t.content, summaryAnchor: t.content }] }))
  assert.match(validateStudyNotes(dump, context).issues.join(), /concept dump/)
  const structured = '| Type | Formula |\n| --- | --- |\n| Force | $F=ma$ |'
  const document = prepareAcademicContentForDelivery(structured)
  assert.ok(document.document.nodes.some(node => node.type === 'table'))
  assert.ok(JSON.stringify(document.document).includes('F=ma'))
  assert.equal(document.degraded, false)

  let calls = 0
  const repaired = await compileStudyNotes(context, 'universidad', async request => {
    calls++
    assert.ok(request.system.includes('SOURCE SUMMARY'))
    assert.ok(!request.prompt.includes(F.fact))
    if (request.review) return { approved: true, issues: [], scopeCheck: 'No ambiguous diagram labels in this fixture', contradictionCheck: 'No contradictory source claims in this fixture' }
    if (request.repair) assert.match(request.prompt, /Missing targets/)
    return calls === 1 ? incomplete : valid()
  })
  assert.equal(calls, 3); assert.equal(repaired.generation.repairCalls, 1)
  assert.equal(repaired.generation.reviewCalls, 1)
  await assert.rejects(compileStudyNotes(context, 'universidad', async request => request.review ? { approved: false, issues: ['Unsupported strengthening of source claim'] } : valid()), /Unsupported strengthening/)
  calls = 0
  await assert.rejects(compileStudyNotes(context, 'universidad', async () => { calls++; throw new Error('offline') }), /ANALYSIS_NOTES_INCOMPLETE/)
  assert.equal(calls, 2)
  console.log('PASS analysis-study-notes: topic synthesis, complete coverage, original IDs, 5 materials, sixth/page exclusion, en/es/zh, Unicode, source examples, duplicates, tables/math, bounded repair and truthful failure')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
