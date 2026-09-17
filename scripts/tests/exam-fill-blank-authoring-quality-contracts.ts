import assert from 'node:assert/strict'
import {
  composeEnjoyerExamBlueprint,
  extractFillBlankUnit,
  ExamEnjoyerTarget,
  ExamComposedSlot,
  ExamBlueprint,
} from '../../lib/materialBrain/examEnjoyerContext'
import {
  authorSlotQuestionWithDiagnostics,
  promptContainsAnswer,
  toPublicExamQuestion,
} from '../../app/api/alai-studyal-exam/route'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'

function makeTarget(
  id: string,
  kind: string,
  label: string,
  content: string,
  examTypes: any[] = ['multiple_choice'],
  bloomLevel: string = 'remember',
): ExamEnjoyerTarget {
  return {
    id: `exam_target:${id}`,
    sourceItemId: id,
    kind,
    label,
    content,
    importance: 80,
    difficulty: 'medium',
    examTypes,
    rawExamTypeHints: examTypes,
    bloomLevel,
    topicId: 'topic-1',
    topicTitle: 'Tema Cuántica',
    sourceOrder: 1,
    materialId: 'mat-1',
    pages: [1],
    sourceSpans: [{ page: 1, quote: content }],
  }
}

function makeUniverse(targets: ExamEnjoyerTarget[]) {
  const selection = {
    ...buildSourceSelectionSnapshot(['mat-1'], { 'mat-1': [1] }),
    fingerprint: 'fp-fb-test',
  }
  return {
    blueprint: {
      sourceSelectionFingerprint: selection.fingerprint,
      materialIds: selection.materialIds,
      selectedPages: selection.selectedPages,
      materialLanguage: 'es' as const,
      topicsIndex: [{ id: 'topic-1', title: 'Tema Cuántica' }],
      globalOrderedAnalysis: targets.map(t => ({
        id: t.sourceItemId,
        name: t.label,
        content: t.content,
        kind: t.kind,
        importance: 'high',
        difficulty: 'medium',
        examTypes: t.examTypes,
        topicId: t.topicId,
        materialId: t.materialId,
        pages: t.pages,
        sourceSpans: t.sourceSpans,
      })),
      uniqueConceptsIndex: [],
    },
    targets,
    relations: [],
    materialLanguage: 'es' as const,
    selection,
    topics: [{ id: 'topic-1', title: 'Tema Cuántica', targetIds: targets.map(t => t.id) }],
    fingerprint: 'fp-fb-test',
  }
}

const dummyBlueprint: ExamBlueprint = {
  examId: 'exam_fb_cert',
  blueprintId: 'bp_fb_cert',
  mode: 'recommend',
  durationMinutes: 30,
  materialLanguage: 'es',
  representedTargetIds: [],
  slots: [],
  coverage: { assessedCount: 0, totalCount: 0, coveragePercent: 0, unassessedTargetIds: [] },
  sourceInventory: { totalSources: 1, primarySources: 1, contextSources: 0, totalReadingBudgetWords: 100 },
  quality: { completeness: 'complete', confidence: 100, warnings: [], requiresAttribution: true },
  certification: { certified: true, checkedAt: new Date().toISOString(), invariantsChecked: [] },
  fingerprint: 'fp_cert',
  authorityVersion: 'test-1.0',
}

// ── TEST 1: Feasibility Gating in Enjoyer Context ────────────────────────────
function testFeasibilityGating() {
  // A. Short concept/entity is feasible
  const entityTarget = makeTarget('ent_bohr', 'entity', 'Niels Bohr Institute', 'Niels Bohr fundó el Niels Bohr Institute en Copenhague.')
  const unitEntity = extractFillBlankUnit(entityTarget)
  assert.ok(unitEntity, 'Short entity must yield fillBlankUnit')
  assert.equal(unitEntity?.unit, 'Niels Bohr Institute')
  assert.equal(unitEntity?.semanticClass, 'term')

  // B. Specific year with date-focused label is feasible
  const yearTarget = makeTarget('date_bohr', 'fact', 'Fecha de Presentación del Modelo Atómico', 'El modelo atómico de Bohr fue presentado en el año 1913.')
  const unitYear = extractFillBlankUnit(yearTarget)
  assert.ok(unitYear, 'Year fact must yield fillBlankUnit')
  assert.equal(unitYear?.unit, '1913')
  assert.equal(unitYear?.semanticClass, 'year')

  // C. Concise formula expression is feasible
  const formulaTarget = makeTarget('form_bohr', 'formula', 'Ecuación de energía', '$E_n = -\\frac{13.6\\text{ eV}}{n^2}$')
  const unitFormula = extractFillBlankUnit(formulaTarget)
  assert.ok(unitFormula, 'Formula must yield fillBlankUnit')
  assert.equal(unitFormula?.semanticClass, 'formula')

  // D. Verbose/unbounded label (> 4 words, non-date, non-formula) is NOT feasible
  const verboseTarget = makeTarget('verb_1', 'concept', 'Impacto del Modelo en la Comprensión de la Realidad Cuántica', 'El modelo causó una profunda revolución en la física moderna.')
  assert.equal(extractFillBlankUnit(verboseTarget), null, 'Verbose target must NOT be feasible for fill_blank')

  // E. Meta-label prefix ("Importancia de...") is NOT feasible
  const metaTarget = makeTarget('meta_1', 'concept', 'Importancia del Modelo de Bohr', 'El modelo permitió comprender la estabilidad del átomo.')
  assert.equal(extractFillBlankUnit(metaTarget), null, 'Meta-label must NOT be feasible for fill_blank')

  console.log('✓ testFeasibilityGating passed')
}

// ── TEST 2: Answer Authority is Bounded, Never a Content Dump ───────────────
function testAnswerAuthorityBoundedSemantics() {
  const targets = [
    makeTarget('ent_bohr', 'entity', 'Niels Bohr Institute', 'Niels Bohr fundó el Niels Bohr Institute en Copenhague.', ['fill_blank']),
    makeTarget('ent_cavendish', 'entity', 'Laboratorio Cavendish', 'Rutherford dirigió el Laboratorio Cavendish durante años.'),
    makeTarget('ent_planck', 'entity', 'Instituto Max Planck', 'El Instituto Max Planck realizó aportes cuánticos cruciales.'),
    makeTarget('ent_cern', 'entity', 'CERN', 'El CERN es el mayor laboratorio de física de partículas.'),
    makeTarget('year_1913', 'fact', 'Fecha de Presentación del Modelo', 'El modelo atómico fue presentado en el año 1913.', ['fill_blank']),
    makeTarget('year_1922', 'fact', 'Fecha del Premio Nobel', 'Bohr recibió el Premio Nobel en el año 1922.'),
    makeTarget('year_1885', 'fact', 'Fecha de Nacimiento de Bohr', 'Niels Bohr nació en el año 1885.'),
  ]
  const universe = makeUniverse(targets)
  const bp = composeEnjoyerExamBlueprint(universe as any, 30, 'exam_fb_test', 'seed_fb_test')

  const fbSlots = bp.slots.filter(s => s.type === 'fill_blank')
  assert.ok(fbSlots.length > 0, 'Blueprint must contain fill_blank slots')

  for (const slot of fbSlots) {
    assert.equal(slot.answerAuthority.kind, 'single_text')
    const auth = slot.answerAuthority as { kind: 'single_text'; canonicalValue: string; distractorPool: string[] }

    // Invariant: canonicalValue must be a bounded unit, NEVER a long excerpt
    assert.ok(auth.canonicalValue.split(/\s+/).length <= 5, `canonicalValue '${auth.canonicalValue}' must be <= 5 words`)
    assert.ok(auth.canonicalValue.length <= 40, `canonicalValue '${auth.canonicalValue}' must be <= 40 chars`)

    // Invariant: distractorPool must not contain long content sentences
    for (const distractor of auth.distractorPool) {
      assert.ok(distractor.split(/\s+/).length <= 5, `distractor '${distractor}' must not be a sentence`)
      assert.ok(distractor.length <= 40, `distractor '${distractor}' must be <= 40 chars`)
      assert.ok(!distractor.endsWith('.'), `distractor '${distractor}' must not end with a sentence period`)
    }
  }

  console.log('✓ testAnswerAuthorityBoundedSemantics passed')
}

// ── TEST 3: promptContainsAnswer Edge Cases ──────────────────────────────────
function testPromptContainsAnswer() {
  // Alphanumeric terms
  assert.equal(promptContainsAnswer('El modelo fue presentado en el año   .', '1913'), false)
  assert.equal(promptContainsAnswer('1913, Niels Bohr presentó su modelo atómico  .', '1913'), true)
  assert.equal(promptContainsAnswer('En 19130 ocurrió algo  .', '1913'), false, 'Partial number match must not trigger')

  // Concept terms
  assert.equal(promptContainsAnswer('Los electrones ocupan órbitas con niveles de   definidos.', 'energía'), false)
  assert.equal(promptContainsAnswer('Los electrones con energía ocupan niveles de  .', 'energía'), true)

  // Entity terms
  assert.equal(promptContainsAnswer('Bohr fundó el   en Copenhague.', 'Niels Bohr Institute'), false)
  assert.equal(promptContainsAnswer('Bohr fundó el Niels Bohr Institute en Copenhague  .', 'Niels Bohr Institute'), true)

  console.log('✓ testPromptContainsAnswer passed')
}

// ── TEST 4: authorSlotQuestionWithDiagnostics Rejections ─────────────────────
function testAuthoringRejections() {
  const baseSlot: ExamComposedSlot = {
    id: 'slot_fb_rej',
    primaryTargetId: 't1',
    targetIds: ['t1'],
    assessedTargetIds: ['t1'],
    sourceItemIds: ['t1'],
    type: 'fill_blank',
    cognitiveLevel: 'recall',
    skill: 'retention',
    cognitiveOperation: 'retrieve',
    assessmentFocus: 'Niels Bohr Institute',
    difficulty: 'medium',
    estimatedSeconds: 45,
    readingBudgetWords: 20,
    answerAuthority: {
      kind: 'single_text',
      canonicalValue: 'Niels Bohr Institute',
      distractorPool: ['Laboratorio Cavendish', 'Instituto Max Planck', 'CERN'],
    },
    frozenSources: [{
      sourceItemId: 't1',
      label: 'Niels Bohr Institute',
      content: 'Niels Bohr fundó el Niels Bohr Institute en Copenhague.',
      materialId: 'mat-1',
      pages: [1],
      sourceSpans: [],
    }],
    order: 0,
  }

  // A. Reject: Complete statement with trailing blank (live Bohr bug)
  const rejTrailing = authorSlotQuestionWithDiagnostics('exam_1', dummyBlueprint, baseSlot, {
    type: 'fill_blank',
    prompt: 'Bohr fundó el Niels Bohr Institute, el cual se estableció como centro mundial. ___',
    distractors: ['Laboratorio Cavendish', 'Instituto Max Planck', 'CERN'],
  })
  assert.equal(rejTrailing.question, null)
  assert.match(rejTrailing.rejectionReason || '', /TRAILING_BLANK|PROMPT_CONTAINS_CANONICAL_ANSWER/)

  // B. Reject: Prompt missing any blank
  const rejNoBlank = authorSlotQuestionWithDiagnostics('exam_1', dummyBlueprint, baseSlot, {
    type: 'fill_blank',
    prompt: 'Bohr fundó el instituto en Copenhague',
    distractors: ['Laboratorio Cavendish', 'Instituto Max Planck', 'CERN'],
  })
  assert.equal(rejNoBlank.question, null)
  assert.match(rejNoBlank.rejectionReason || '', /MISSING_BLANK/)

  // C. Reject: Multiple blanks
  const rejMultiBlank = authorSlotQuestionWithDiagnostics('exam_1', dummyBlueprint, baseSlot, {
    type: 'fill_blank',
    prompt: 'Bohr fundó el ___ en ___',
    distractors: ['Laboratorio Cavendish', 'Instituto Max Planck', 'CERN'],
  })
  assert.equal(rejMultiBlank.question, null)
  assert.match(rejMultiBlank.rejectionReason || '', /AMBIGUOUS_BLANKS/)

  // D. Reject: Canonical answer too long (> 6 words)
  const longCanonicalSlot: ExamComposedSlot = {
    ...baseSlot,
    answerAuthority: {
      kind: 'single_text',
      canonicalValue: 'Este es un enunciado de respuesta canónica sumamente largo que no es una unidad acotada',
      distractorPool: ['d1', 'd2', 'd3'],
    },
  }
  const rejLongCanonical = authorSlotQuestionWithDiagnostics('exam_1', dummyBlueprint, longCanonicalSlot, {
    type: 'fill_blank',
    prompt: 'El modelo propone ___',
    distractors: ['d1', 'd2', 'd3'],
  })
  assert.equal(rejLongCanonical.question, null)
  assert.match(rejLongCanonical.rejectionReason || '', /CANONICAL_TOO_LONG/)

  // E. Reject: Distractors that are complete sentences (> 6 words or ending with period)
  const rejSentenceBank = authorSlotQuestionWithDiagnostics('exam_1', dummyBlueprint, {
    ...baseSlot,
    answerAuthority: {
      kind: 'single_text',
      canonicalValue: '1913',
      distractorPool: [],
    },
  }, {
    type: 'fill_blank',
    prompt: 'El modelo atómico de Bohr fue presentado en el año ___',
    distractors: [
      'Bohr colaboró con Ernest Rutherford en Inglaterra durante varios años.',
      'El modelo atómico de Bohr logró explicar el espectro de emisión del hidrógeno.',
      'Niels Bohr recibió el Premio Nobel de Física en reconocimiento a su trayectoria.',
    ],
  })
  assert.equal(rejSentenceBank.question, null)
  assert.match(rejSentenceBank.rejectionReason || '', /INSUFFICIENT_DISTRACTORS/)

  console.log('✓ testAuthoringRejections passed')
}

// ── TEST 5: authorSlotQuestionWithDiagnostics Acceptances ────────────────────
function testAuthoringAcceptances() {
  // A. Valid Year Fill Blank
  const yearSlot: ExamComposedSlot = {
    id: 'slot_year',
    primaryTargetId: 't_y',
    targetIds: ['t_y'],
    assessedTargetIds: ['t_y'],
    sourceItemIds: ['t_y'],
    type: 'fill_blank',
    cognitiveLevel: 'recall',
    skill: 'retention',
    cognitiveOperation: 'retrieve',
    assessmentFocus: 'Fecha de Presentación',
    difficulty: 'medium',
    estimatedSeconds: 45,
    readingBudgetWords: 15,
    answerAuthority: {
      kind: 'single_text',
      canonicalValue: '1913',
      distractorPool: ['1922', '1885', '1911'],
    },
    frozenSources: [{
      sourceItemId: 't_y',
      label: 'Fecha de Presentación',
      content: 'El modelo atómico de Bohr fue presentado en el año 1913.',
      materialId: 'mat-1',
      pages: [1],
      sourceSpans: [],
    }],
    order: 0,
  }

  const resYear = authorSlotQuestionWithDiagnostics('exam_1', dummyBlueprint, yearSlot, {
    type: 'fill_blank',
    prompt: 'El modelo atómico de Bohr fue presentado en el año ___',
    distractors: ['1922', '1885', '1911'],
  })
  assert.ok(resYear.question, `Year question must be accepted, got error: ${resYear.rejectionReason}`)
  assert.equal(resYear.question!.expectedAnswer, '1913')
  assert.ok(Array.isArray(resYear.question!.wordBank))
  assert.equal(resYear.question!.wordBank!.length, 4)
  assert.ok(resYear.question!.wordBank!.includes('1913'))

  // B. Valid Concept Term Fill Blank
  const termSlot: ExamComposedSlot = {
    id: 'slot_term',
    primaryTargetId: 't_term',
    targetIds: ['t_term'],
    assessedTargetIds: ['t_term'],
    sourceItemIds: ['t_term'],
    type: 'fill_blank',
    cognitiveLevel: 'recall',
    skill: 'retention',
    cognitiveOperation: 'retrieve',
    assessmentFocus: 'Niveles de energía',
    difficulty: 'medium',
    estimatedSeconds: 45,
    readingBudgetWords: 15,
    answerAuthority: {
      kind: 'single_text',
      canonicalValue: 'energía',
      distractorPool: ['masa', 'velocidad', 'carga'],
    },
    frozenSources: [{
      sourceItemId: 't_term',
      label: 'Niveles de energía',
      content: 'Los electrones orbitan en niveles de energía definidos.',
      materialId: 'mat-1',
      pages: [1],
      sourceSpans: [],
    }],
    order: 1,
  }

  const resTerm = authorSlotQuestionWithDiagnostics('exam_1', dummyBlueprint, termSlot, {
    type: 'fill_blank',
    prompt: 'Los electrones ocupan órbitas con niveles de ___ definidos',
    distractors: ['masa', 'velocidad', 'carga'],
  })
  assert.ok(resTerm.question, `Term question must be accepted, got error: ${resTerm.rejectionReason}`)
  assert.equal(resTerm.question!.expectedAnswer, 'energía')
  assert.equal(resTerm.question!.wordBank!.length, 4)

  // C. Public DTO Privacy
  const pub = toPublicExamQuestion(resTerm.question!)
  assert.equal((pub as any).expectedAnswer, undefined, 'expectedAnswer must be stripped from public DTO')
  assert.ok(Array.isArray(pub.wordBank), 'wordBank must be present on public DTO')
  assert.equal(pub.wordBank!.length, 4)

  console.log('✓ testAuthoringAcceptances passed')
}

function runAll() {
  console.log('\n── RUNNING EXAM FILL_BLANK AUTHORING QUALITY CONTRACTS ──\n')
  testFeasibilityGating()
  testAnswerAuthorityBoundedSemantics()
  testPromptContainsAnswer()
  testAuthoringRejections()
  testAuthoringAcceptances()
  console.log('\nALL EXAM FILL_BLANK AUTHORING QUALITY CONTRACTS PASSED!\n')
}

runAll()
