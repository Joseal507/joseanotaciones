import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { buildExamEnjoyerUniverse, composeEnjoyerExamBlueprint, extractFillBlankUnit } from '../../lib/materialBrain/examEnjoyerContext'
import { authorSlotQuestionWithDiagnostics, buildGroundedExamPrompt, toPublicExamQuestion, gradeObjectiveQuestion, fillBlankDistractorCompatible } from '../../app/api/alai-studyal-exam/route'
import { InMemoryExamGenerationStore, getOrBuildExamGeneration, advanceExamGeneration, restoreExamGeneration, deterministicallyRecomposeSlot, type GenerateExamSlotBatchFn } from '../../lib/materialBrain/examGenerationStore'

async function main() {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Network forbidden in Phase 1 contracts') }
  try {
    const selection = buildSourceSelectionSnapshot(['material'], { material: [1] })
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `date${i}`, kind: 'fact', name: `Año de publicación del volumen ${i}`,
      summary: `El volumen ${i} fue publicado en ${2000 + i}.`,
      importance: 80, difficulty: 'basic', bloomLevel: 'remember', examTypes: ['fill_blank'],
      materialId: 'material', pages: [1], topicId: `topic${i}`,
      sourceSpans: [{ page: 1, quote: `El volumen ${i} fue publicado en ${2000 + i}.`, certainty: 'supported' }],
      misconceptions: [`La publicación del volumen ${i} no coincide con su reedición.`],
      dependsOn: i === 0 ? ['date1'] : [],
      relations: i === 0 ? [{ type: 'contrast', targetId: 'date1-alias', targetLabel: 'Volumen 1' },
        { type: 'contrast', targetId: 'unknown', targetLabel: 'Desconocido' }] : [],
    }))
    const payload = { sourceSelectionFingerprint: selection.fingerprint, materialIds: ['material'],
      globalOrderedAnalysis: [...items, { ...items[1], id: 'date1-alias' }],
      topicsIndex: items.map((item, i) => ({ id: item.topicId, title: `Volumen ${i}` })) }
    const universe = buildExamEnjoyerUniverse(payload, selection)
    const relation = universe.relations.find(r => r.type === 'contrast')!
    assert.ok(relation)
    assert.equal(relation.fromSourceItemId, 'date0')
    assert.equal(relation.toSourceItemId, 'date1')
    assert.ok(!universe.relations.some(r => r.toSourceItemId === 'unknown'))
    assert.deepEqual(buildExamEnjoyerUniverse(payload, selection).relations, universe.relations)
    assert.ok(universe.relations.some(r => r.type === 'dependsOn'))
    const concept = { ...universe.targets[0], kind: 'definition', label: 'Cultura no material', content: 'La cultura no material se refiere al mundo intangible de las ideas.', sourceSpans: [] }
    assert.equal(extractFillBlankUnit(concept)?.unit.toLowerCase(), 'cultura no material')
    assert.equal(extractFillBlankUnit({ ...concept, kind: 'entity', label: 'Nombre propio', content: 'Nombre propio aparece en la fuente.' }), null, 'Unknown entity subtype must not be inferred')
    const blueprint = composeEnjoyerExamBlueprint(universe, 90, 'phase1', 'phase1')
    const prompt = buildGroundedExamPrompt(blueprint.slots)
    assert.match(prompt, /KIND: fact/)
    assert.match(prompt, /"certainty":"supported"/)
    assert.match(prompt, /MISCONCEPTIONS:/)
    assert.match(prompt, /SLOT_RELATIONS/)
    assert.match(prompt, /TOPIC:/)
    assert.ok(blueprint.slots.every(slot => slot.frozenSources.every(source => source.kind === 'fact')))
    const fills = blueprint.slots.filter(slot => slot.type === 'fill_blank')
    assert.ok(fills.length >= 2, 'Production composer must produce actual year fill slots')
    for (const slot of fills) {
      assert.equal(slot.answerAuthority.kind, 'single_text')
      if (slot.answerAuthority.kind !== 'single_text') throw new Error('Wrong authority')
      const target = universe.targets.find(t => t.id === slot.primaryTargetId)!
      assert.equal(slot.answerAuthority.answerUnit?.semanticClass, extractFillBlankUnit(target)?.semanticClass)
      assert.deepEqual(slot.answerAuthority.distractorPool, [])
    }
    const slot = fills[0]
    const raw = { type: 'fill_blank', prompt: 'El volumen se publicó en ___.', distractors: ['1980', '1981', '1982', '1983'] }
    const valid = authorSlotQuestionWithDiagnostics('phase1', blueprint, slot, raw)
    assert.ok(valid.question, valid.rejectionReason)
    assert.equal(valid.question.wordBank?.length, 5)
    assert.equal(gradeObjectiveQuestion(valid.question, '1980'), false)
    assert.equal(gradeObjectiveQuestion(valid.question, valid.question.expectedAnswer), true)
    const pub = JSON.stringify(toPublicExamQuestion(valid.question))
    for (const key of ['expectedAnswer', 'answerUnit', 'semanticClass', 'canonicalCriterion', 'misconceptions']) assert.ok(!pub.includes(key), key)
    const poisoned = structuredClone(slot)
    if (poisoned.answerAuthority.kind !== 'single_text') throw new Error('Wrong authority')
    poisoned.answerAuthority.distractorPool = ['1980', '1981', '1982', '1983']
    const insufficient = authorSlotQuestionWithDiagnostics('phase1', blueprint, poisoned, { ...raw, distractors: ['1980'] })
    assert.equal(insufficient.question, null)
    assert.match(insufficient.rejectionReason || '', /INSUFFICIENT_DISTRACTORS/)
    assert.ok(deterministicallyRecomposeSlot(poisoned, insufficient.rejectionReason), 'Existing recovery remains actionable')
    const fixture = authorSlotQuestionWithDiagnostics('phase1', blueprint, slot,
      { ...raw, distractors: ['distractor_A', 'distractor_B', 'distractor_C'] })
    assert.equal(fixture.question, null)
    assert.equal(fillBlankDistractorCompatible('2000', 'distractor_A'), false)

    // Frozen classification wins even when a legacy string classifier would disagree.
    const preserved = structuredClone(slot)
    if (preserved.answerAuthority.kind !== 'single_text' || !preserved.answerAuthority.answerUnit) throw new Error('Missing metadata')
    preserved.answerAuthority.answerUnit.semanticClass = 'term'
    const noReclassification = authorSlotQuestionWithDiagnostics('phase1', blueprint, preserved,
      { ...raw, distractors: ['primera edición', 'segunda edición', 'tercera edición'] })
    assert.ok(noReclassification.question, noReclassification.rejectionReason)

    const legacy = structuredClone(slot)
    delete legacy.authoringContractVersion
    if (legacy.answerAuthority.kind !== 'single_text') throw new Error('Wrong authority')
    delete legacy.answerAuthority.answerUnit
    legacy.answerAuthority.distractorPool = ['1980', '1981', '1982']
    const old = authorSlotQuestionWithDiagnostics('phase1', blueprint, legacy, { ...raw, distractors: [] })
    assert.ok(old.question, old.rejectionReason)
    assert.equal(gradeObjectiveQuestion(old.question, old.question.expectedAnswer), true)

    // Run actual generation acceptance, rejection, persistence and resume. No provider/network.
    const scoped = { ...blueprint, slots: fills.slice(0, 2) }
    type Question = NonNullable<typeof valid.question>
    const store = new InMemoryExamGenerationStore<Question>()
    const batches: string[][] = []
    let failSecond = true
    const author: GenerateExamSlotBatchFn<Question> = async (ids, frozen) => {
      batches.push([...ids])
      const questions = new Map<string, Question>()
      const rejections: Record<string, string> = {}
      for (const id of ids) {
        const current = frozen.slots.find(s => s.id === id)!
        const result = authorSlotQuestionWithDiagnostics('phase1', frozen, current,
          { ...raw, prompt: id === scoped.slots[0].id ? raw.prompt : 'La fecha de publicación del segundo tomo corresponde al año ___.',
            distractors: failSecond && id === scoped.slots[1].id ? [] : raw.distractors })
        if (result.question) questions.set(id, result.question)
        else rejections[id] = result.rejectionReason || 'invalid'
      }
      return { questions, rejections }
    }
    const initial = await getOrBuildExamGeneration('session', selection.fingerprint, 'phase1', scoped, store, author)
    assert.equal(batches[0].length, 2, 'Multi-slot batch, not one request per question')
    assert.equal(initial.artifact.questions.length, 1)
    const accepted = JSON.stringify(initial.artifact.questions[0])
    const restored = await restoreExamGeneration('session', selection.fingerprint, 'phase1', store)
    assert.ok(restored)
    assert.equal(JSON.stringify(restored.artifact.questions[0]), accepted)
    failSecond = false
    const resumed = await advanceExamGeneration('session', selection.fingerprint, 'phase1', store, author)
    assert.equal(resumed.status, 'ready')
    assert.deepEqual(batches[1], [scoped.slots[1].id])
    assert.equal(JSON.stringify(resumed.artifact.questions.find(q => q.id === initial.artifact.questions[0].id)), accepted)
    const calls = batches.length
    await getOrBuildExamGeneration('session', selection.fingerprint, 'phase1', scoped, store, author)
    assert.equal(batches.length, calls)
    const reopened = await restoreExamGeneration('session', selection.fingerprint, 'phase1', store)
    assert.deepEqual(reopened?.artifact.questions, resumed.artifact.questions)

    // =========================================================================
    // BLOCKER 1 REGRESSION: NESTED RELATION AUTHORITY
    // =========================================================================
    // 1. Conflicting explicit source in nested relation fails closed
    const itemWithConflictSource = {
      id: 'conflict_src_item', kind: 'fact', name: 'Source Conflict', summary: 'Resumen de prueba.',
      materialId: 'material', pages: [1], topicId: 'topic0',
      sourceSpans: [{ page: 1, quote: 'Resumen de prueba.', certainty: 'supported' }],
      relations: [{ type: 'contrast', fromSourceItemId: 'completely_different_owner', targetId: 'date1' }],
    }
    const payloadConflictSrc = {
      sourceSelectionFingerprint: selection.fingerprint, materialIds: ['material'],
      globalOrderedAnalysis: [items[0], items[1], itemWithConflictSource],
      topicsIndex: [{ id: 'topic0', title: 'Tema' }],
    }
    const uConflictSrc = buildExamEnjoyerUniverse(payloadConflictSrc, selection)
    assert.ok(!uConflictSrc.relations.some(r => r.fromSourceItemId === 'conflict_src_item'),
      'Nested relation specifying conflicting fromSourceItemId must fail closed')

    // 2. Conflicting explicit target endpoints in nested relation fail closed
    const itemWithConflictTarget = {
      id: 'conflict_tgt_item', kind: 'fact', name: 'Target Conflict', summary: 'Resumen de prueba.',
      materialId: 'material', pages: [1], topicId: 'topic0',
      sourceSpans: [{ page: 1, quote: 'Resumen de prueba.', certainty: 'supported' }],
      relations: [{ type: 'contrast', toSourceItemId: 'date0', targetId: 'date1' }],
    }
    const payloadConflictTgt = {
      sourceSelectionFingerprint: selection.fingerprint, materialIds: ['material'],
      globalOrderedAnalysis: [items[0], items[1], itemWithConflictTarget],
      topicsIndex: [{ id: 'topic0', title: 'Tema' }],
    }
    const uConflictTgt = buildExamEnjoyerUniverse(payloadConflictTgt, selection)
    assert.ok(!uConflictTgt.relations.some(r => r.fromSourceItemId === 'conflict_tgt_item'),
      'Nested relation specifying conflicting toSourceItemId vs targetId must fail closed')

    // 3. Duplicate block cannot inject nested relations through alias resolution
    const duplicateWithRelations = {
      ...items[1],
      id: 'date1-duplicate-with-relations',
      relations: [{ type: 'cause', targetId: 'date0' }],
      dependsOn: ['date0'],
    }
    const payloadDupInject = {
      sourceSelectionFingerprint: selection.fingerprint, materialIds: ['material'],
      globalOrderedAnalysis: [items[0], items[1], duplicateWithRelations],
      topicsIndex: [{ id: 'topic0', title: 'Tema' }],
    }
    const uDupInject = buildExamEnjoyerUniverse(payloadDupInject, selection)
    assert.ok(!uDupInject.relations.some(r => r.type === 'cause'),
      'Duplicate block must NEVER inject relations through alias resolution')
    assert.equal(uDupInject.relations.filter(r => r.type === 'dependsOn' && r.fromSourceItemId === 'date1').length, 0,
      'Duplicate block must NEVER inject dependsOn through alias resolution')

    // 4. Self edges fail closed
    const itemWithSelfEdge = {
      id: 'self_edge_item', kind: 'fact', name: 'Self Edge', summary: 'Resumen de prueba.',
      materialId: 'material', pages: [1], topicId: 'topic0',
      sourceSpans: [{ page: 1, quote: 'Resumen de prueba.', certainty: 'supported' }],
      relations: [{ type: 'contrast', targetId: 'self_edge_item' }],
    }
    const payloadSelfEdge = {
      sourceSelectionFingerprint: selection.fingerprint, materialIds: ['material'],
      globalOrderedAnalysis: [items[0], itemWithSelfEdge],
      topicsIndex: [{ id: 'topic0', title: 'Tema' }],
    }
    const uSelfEdge = buildExamEnjoyerUniverse(payloadSelfEdge, selection)
    assert.ok(!uSelfEdge.relations.some(r => r.fromSourceItemId === 'self_edge_item' && r.toSourceItemId === 'self_edge_item'),
      'Self edges must fail closed')

    // 5. Relation type is preserved, never inferred
    const itemWithNoType = {
      id: 'no_type_item', kind: 'fact', name: 'No Type', summary: 'Resumen de prueba.',
      materialId: 'material', pages: [1], topicId: 'topic0',
      sourceSpans: [{ page: 1, quote: 'Resumen de prueba.', certainty: 'supported' }],
      relations: [{ targetId: 'date0' }], // Missing type and kind!
    }
    const payloadNoType = {
      sourceSelectionFingerprint: selection.fingerprint, materialIds: ['material'],
      globalOrderedAnalysis: [items[0], itemWithNoType],
      topicsIndex: [{ id: 'topic0', title: 'Tema' }],
    }
    const uNoType = buildExamEnjoyerUniverse(payloadNoType, selection)
    assert.ok(!uNoType.relations.some(r => r.fromSourceItemId === 'no_type_item'),
      'Relations without explicit type must fail closed; never infer "related"')

    // 6. TargetLabel is never authority
    const itemWithLabelOnly = {
      id: 'label_only_item', kind: 'fact', name: 'Label Only', summary: 'Resumen de prueba.',
      materialId: 'material', pages: [1], topicId: 'topic0',
      sourceSpans: [{ page: 1, quote: 'Resumen de prueba.', certainty: 'supported' }],
      relations: [{ type: 'contrast', targetLabel: items[0].name }], // No targetId!
    }
    const payloadLabelOnly = {
      sourceSelectionFingerprint: selection.fingerprint, materialIds: ['material'],
      globalOrderedAnalysis: [items[0], itemWithLabelOnly],
      topicsIndex: [{ id: 'topic0', title: 'Tema' }],
    }
    const uLabelOnly = buildExamEnjoyerUniverse(payloadLabelOnly, selection)
    assert.ok(!uLabelOnly.relations.some(r => r.fromSourceItemId === 'label_only_item'),
      'TargetLabel must NEVER authorize a relation endpoint')

    // =========================================================================
    // BLOCKER 2 REGRESSION: SOURCE SELECTION LEAK
    // =========================================================================
    // selection = page 1
    // Enjoyer sourceSpans = page 1 + page 99
    // rendered authoring prompt MUST contain page-1 authorized evidence
    // and MUST NOT contain page-99 evidence.
    const itemWithLeakedSpan = {
      id: 'page_leak_item', kind: 'fact', name: 'Page Leak Test',
      summary: 'El texto autorizado de la página 1 sobre mecánica cuántica.',
      importance: 85, difficulty: 'medium', bloomLevel: 'remember', examTypes: ['short_answer'],
      materialId: 'material', pages: [1], topicId: 'topic0',
      sourceSpans: [
        { page: 1, quote: 'EVIDENCIA_AUTORIZADA_PAGINA_1: Constante de Planck es h.', certainty: 'supported' },
        { page: 99, quote: 'EVIDENCIA_NO_AUTORIZADA_PAGINA_99: Dato filtrado de página no seleccionada.', certainty: 'supported' },
      ],
    }
    const payloadLeak = {
      sourceSelectionFingerprint: selection.fingerprint, materialIds: ['material'],
      globalOrderedAnalysis: [itemWithLeakedSpan, ...items.slice(1)],
      topicsIndex: [{ id: 'topic0', title: 'Física' }],
    }
    const uLeak = buildExamEnjoyerUniverse(payloadLeak, selection)
    const targetLeak = uLeak.targets.find(t => t.sourceItemId === 'page_leak_item')!
    assert.ok(targetLeak, 'Target must be created')
    // Target sourceSpans must only contain page 1
    assert.ok(targetLeak.sourceSpans.every(s => s.page === 1), 'Only page 1 spans survive into universe target')
    assert.ok(!targetLeak.sourceSpans.some(s => s.page === 99), 'Page 99 span must be discarded')

    const bpLeak = composeEnjoyerExamBlueprint(uLeak, 30, 'leak-test', 'seed-leak')
    const promptLeak = buildGroundedExamPrompt(bpLeak.slots)
    assert.match(promptLeak, /EVIDENCIA_AUTORIZADA_PAGINA_1/, 'Prompt must contain page-1 authorized evidence')
    assert.doesNotMatch(promptLeak, /EVIDENCIA_NO_AUTORIZADA_PAGINA_99/, 'Prompt MUST NOT contain page-99 evidence')
    assert.doesNotMatch(promptLeak, /PAGES:.*99/, 'Prompt MUST NOT list page 99 in material pages')

    // =========================================================================
    // BLOCKER 3 REGRESSION: AUTHORING CONTEXT BOUNDS
    // =========================================================================
    // Codex reproduced approximately 100k prompt growth from a giant misconception value.
    // Adversarial tests with huge metadata proving prompt size remains bounded.
    const hugeMisconception = 'M'.repeat(100_000)
    const hugeContent = 'C'.repeat(50_000)
    const hugeQuote = 'Q'.repeat(50_000)
    const itemHuge = {
      id: 'huge_metadata_item', kind: 'concept', name: 'Huge Concept',
      summary: hugeContent,
      importance: 90, difficulty: 'advanced', bloomLevel: 'understand', examTypes: ['short_answer'],
      materialId: 'material', pages: [1], topicId: 'topic0',
      sourceSpans: [{ page: 1, quote: hugeQuote, certainty: 'supported' }],
      misconceptions: [hugeMisconception, 'Misconception 2: ' + 'X'.repeat(5000)],
    }
    const payloadHuge = {
      sourceSelectionFingerprint: selection.fingerprint, materialIds: ['material'],
      globalOrderedAnalysis: [itemHuge, ...items.slice(1)],
      topicsIndex: [{ id: 'topic0', title: 'Bounds' }],
    }
    const uHuge = buildExamEnjoyerUniverse(payloadHuge, selection)
    const bpHuge = composeEnjoyerExamBlueprint(uHuge, 30, 'huge-test', 'seed-huge')
    const promptHuge = buildGroundedExamPrompt(bpHuge.slots)

    // Prove prompt size remains strictly bounded despite 200k+ adversarial inputs
    assert.ok(promptHuge.length < 30_000, `Prompt size must remain bounded; got ${promptHuge.length} chars (expected < 30,000)`)
    const singleSlotPrompt = buildGroundedExamPrompt([bpHuge.slots[0]])
    assert.ok(singleSlotPrompt.length < 8_000, `Single slot prompt must remain bounded; got ${singleSlotPrompt.length} chars (expected < 8,000)`)
    // Prove misconception was bounded deterministically without dropping
    assert.match(promptHuge, /MISCONCEPTIONS: \["M{240}"/, 'Misconceptions must be deterministically bounded to 240 chars each')
    // Prove content was bounded
    assert.match(promptHuge, /CONTENT: C{500}/, 'Content must be deterministically bounded to 500 chars')
    // Prove quote was bounded
    assert.match(promptHuge, /"quote":"Q{240}"/, 'Quote must be deterministically bounded to 240 chars')

    // Canonical grading authority remains completely intact and uncorrupted
    const hugeSlot = bpHuge.slots.find(s => s.primaryTargetId === 'exam_target:huge_metadata_item')!
    assert.ok(hugeSlot)
    // Frozen source content retains original full content for provenance/authority
    assert.equal(hugeSlot.frozenSources[0].content.length, 50_000, 'Original private source content preserved in blueprint')
    assert.equal(hugeSlot.frozenSources[0].misconceptions?.[0].length, 100_000, 'Original private misconception preserved in blueprint')

    console.log('exam-enjoyer-authoring-phase1-contracts: ALL PASS (metadata, relations, banks, privacy, legacy, batching, persistence/retry, blockers 1-3)')
  } finally { globalThis.fetch = originalFetch }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
