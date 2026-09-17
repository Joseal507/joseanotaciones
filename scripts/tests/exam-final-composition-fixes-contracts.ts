import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildExamEnjoyerUniverse,
  composeEnjoyerExamBlueprint,
} from '../../lib/materialBrain/examEnjoyerContext'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { AcademicContent } from '../../components/academic/AcademicContent'
import { formatSkillScore } from '../../components/materias/ALAIStudyALExams'

function makeItem(
  id: string,
  materialId: string,
  page: number,
  kind = 'concept',
  label = `Concepto ${id}`,
  content = `Contenido autorizado y verificable de ${id} con longitud adecuada para pruebas.`,
  examTypes: string[] = ['multiple_choice'],
  bloomLevel?: string,
  topicId = 'topic-1',
) {
  return {
    id,
    kind,
    name: label,
    label,
    content,
    summary: content,
    importance: 80,
    difficulty: 'medium',
    examTypes,
    bloomLevel,
    topicId,
    materialId,
    pages: [page],
    sourceSpans: [{ materialId, page, quote: content.slice(0, 30) }],
  }
}

function makeUniverse(items: any[], relations: any[] = []) {
  const blueprint = {
    sourceSelectionFingerprint: 'fp-test',
    materialIds: ['mat-1'],
    selectedPages: { 'mat-1': [1, 2, 3] },
    topicsIndex: [{ id: 'topic-1', title: 'Tema 1', sourceOrder: 0 }],
    globalOrderedAnalysis: items,
    uniqueConceptsIndex: [],
    relations,
  }
  const snapshot = {
    ...buildSourceSelectionSnapshot(['mat-1'], { 'mat-1': [1, 2, 3] }),
    fingerprint: 'fp-test',
  }
  return buildExamEnjoyerUniverse(blueprint, snapshot)
}

// ── CONTRACT 1: Feasible true_false is not eliminated by mcq hint ────────────
function testFeasibleTrueFalseNotEliminatedByMcqHint() {
  const items = [
    makeItem('fact1', 'mat-1', 1, 'fact', 'Fecha 1', 'Niels Bohr nació en Copenhague en 1885.', ['multiple_choice']),
    makeItem('fact2', 'mat-1', 1, 'fact', 'Fecha 2', 'El modelo atómico fue presentado en el año 1913.', ['multiple_choice']),
    makeItem('fact3', 'mat-1', 1, 'fact', 'Premio 3', 'Bohr recibió el Premio Nobel de Física en 1922.', ['multiple_choice']),
  ]
  const universe = makeUniverse(items)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-tf', 'seed-tf')

  const types = bp.slots.map(s => s.type)
  assert.ok(
    types.includes('true_false'),
    `Contract 1 FAIL: true_false was eliminated despite being feasible. Slots: ${types.join(', ')}`,
  )
  console.log('Contract 1 PASS: Feasible true_false is not eliminated merely because Enjoyer hints only mcq')
}

// ── CONTRACT 2: Feasible fill_blank is not eliminated by mcq hint ────────────
function testFeasibleFillBlankNotEliminatedByMcqHint() {
  const items = [
    makeItem('ent1', 'mat-1', 1, 'entity', 'Niels Bohr', 'Niels Bohr fundó el instituto de física teórica en Copenhague.', ['multiple_choice'], 'remember'),
    makeItem('ent2', 'mat-1', 1, 'entity', 'Universidad de Copenhague', 'Bohr realizó sus estudios en la Universidad de Copenhague en Dinamarca.', ['multiple_choice'], 'remember'),
    makeItem('ent3', 'mat-1', 1, 'entity', 'Ernest Rutherford', 'Ernest Rutherford colaboró estrechamente con Bohr.', ['multiple_choice'], 'remember'),
  ]
  const universe = makeUniverse(items)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-fb', 'seed-fb')

  const types = bp.slots.map(s => s.type)
  assert.ok(
    types.includes('fill_blank'),
    `Contract 2 FAIL: fill_blank was eliminated despite being feasible. Slots: ${types.join(', ')}`,
  )
  console.log('Contract 2 PASS: Feasible fill_blank is not eliminated merely because Enjoyer hints only mcq')
}

// ── CONTRACT 3: Infeasible types remain excluded ─────────────────────────────
function testInfeasibleTypesRemainExcluded() {
  const longContent = 'Este es un contenido excesivamente largo diseñado intencionalmente para superar el umbral estricto de ciento sesenta caracteres permitido para preguntas de verdadero y falso en el examen, garantizando que el validador lo considere académicamente inviable.'
  assert.ok(longContent.length > 160, 'precondition: content > 160 chars')

  const items = [
    makeItem('long1', 'mat-1', 1, 'concept', 'Concepto sumamente complejo y detallado del modelo', longContent, ['multiple_choice'], 'remember'),
    makeItem('long2', 'mat-1', 1, 'concept', 'Otro concepto sumamente complejo y detallado del modelo', longContent, ['multiple_choice'], 'remember'),
  ]
  const universe = makeUniverse(items)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-inf', 'seed-inf')

  for (const slot of bp.slots) {
    assert.notEqual(slot.type, 'true_false', `Contract 3 FAIL: slot ${slot.id} has true_false despite content length ${longContent.length}`)
    assert.notEqual(slot.type, 'fill_blank', `Contract 3 FAIL: slot ${slot.id} has fill_blank despite long label and non-formula`)
  }
  console.log('Contract 3 PASS: Infeasible types remain excluded')
}

// ── CONTRACT 4: Hints do not override academic feasibility ───────────────────
function testHintsDoNotOverrideAcademicFeasibility() {
  const longContent = 'Texto de longitud media que forma una oracion completa para opcion multiple. Segunda oracion adicional que hace que el contenido total supere los ciento sesenta caracteres.'
  assert.ok(longContent.length > 160, 'precondition: content > 160 chars')

  const items = [
    makeItem('infeas_tf', 'mat-1', 1, 'concept', 'Concepto no apto para huecos ni verdadero', longContent, ['true_false'], 'remember'),
  ]
  const universe = makeUniverse(items)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-hint-override', 'seed-hint')

  assert.equal(bp.slots[0].type, 'multiple_choice', 'Contract 4 FAIL: hint should NOT force true_false when infeasible')
  console.log('Contract 4 PASS: Hints do not override academic feasibility')
}

// ── CONTRACT 5: Deterministic composition remains stable ─────────────────────
function testDeterministicCompositionStability() {
  const items = [
    makeItem('itemA', 'mat-1', 1, 'fact', 'Etiqueta A', 'Niels Bohr nació en 1885.', ['multiple_choice']),
    makeItem('itemB', 'mat-1', 1, 'concept', 'Etiqueta B', 'El átomo de hidrógeno tiene niveles discretos.', ['multiple_choice', 'short_answer']),
    makeItem('itemC', 'mat-1', 1, 'entity', 'Etiqueta C', 'Copenhague es la capital de Dinamarca.', ['multiple_choice']),
  ]
  const universe = makeUniverse(items)
  const bp1 = composeEnjoyerExamBlueprint(universe, 30, 'exam-stab', 'fixed-seed-42')
  const bp2 = composeEnjoyerExamBlueprint(universe, 30, 'exam-stab', 'fixed-seed-42')

  assert.equal(bp1.slots.length, bp2.slots.length)
  for (let i = 0; i < bp1.slots.length; i++) {
    assert.equal(bp1.slots[i].id, bp2.slots[i].id, `Slot id mismatch at ${i}`)
    assert.equal(bp1.slots[i].type, bp2.slots[i].type, `Slot type mismatch at ${i}`)
  }
  console.log('Contract 5 PASS: Deterministic composition remains stable across runs')
}

// ── CONTRACT 6: No type quotas exist ─────────────────────────────────────────
function testNoTypeQuotasExist() {
  const longContent = 'Explicación detallada del mecanismo de absorción y emisión de radiación cuando los electrones cambian de órbita en el átomo de hidrógeno, modificando la energía total del sistema.'
  const items = [
    makeItem('comp1', 'mat-1', 1, 'concept', 'Mecanismo uno', longContent, ['open'], 'understand'),
    makeItem('comp2', 'mat-1', 1, 'concept', 'Mecanismo dos', longContent, ['open'], 'understand'),
  ]
  const universe = makeUniverse(items)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-noquota', 'seed-noquota')

  assert.equal(bp.typeDistribution.true_false, 0)
  assert.equal(bp.typeDistribution.fill_blank, 0)
  assert.equal(bp.typeDistribution.matching, 0)
  console.log('Contract 6 PASS: No type quotas exist (0 is valid when infeasible)')
}

// ── CONTRACT 7: Matching constraints remain intact ───────────────────────────
function testMatchingConstraintsRemainIntact() {
  const itemsBelow = [
    makeItem('l1', 'mat-1', 1, 'entity', 'L1', 'Entidad 1'),
    makeItem('r1', 'mat-1', 1, 'concept', 'R1', 'Definición 1 corta.'),
    makeItem('l2', 'mat-1', 1, 'entity', 'L2', 'Entidad 2'),
    makeItem('r2', 'mat-1', 1, 'concept', 'R2', 'Definición 2 corta.'),
  ]
  const relsBelow = [
    { id: 'rel1', fromSourceItemId: 'l1', toSourceItemId: 'r1', type: 'definition' },
    { id: 'rel2', fromSourceItemId: 'l2', toSourceItemId: 'r2', type: 'definition' },
  ]
  const uBelow = makeUniverse(itemsBelow, relsBelow)
  const bpBelow = composeEnjoyerExamBlueprint(uBelow, 30, 'exam-match-below', 'seed-mb')
  assert.equal(bpBelow.typeDistribution.matching, 0, 'Contract 7: matching < 3 items must yield 0 matching slots')

  const itemsAt = [
    ...itemsBelow,
    makeItem('l3', 'mat-1', 1, 'entity', 'L3', 'Entidad 3'),
    makeItem('r3', 'mat-1', 1, 'concept', 'R3', 'Definición 3 corta.'),
  ]
  const relsAt = [
    ...relsBelow,
    { id: 'rel3', fromSourceItemId: 'l3', toSourceItemId: 'r3', type: 'definition' },
  ]
  const uAt = makeUniverse(itemsAt, relsAt)
  const bpAt = composeEnjoyerExamBlueprint(uAt, 30, 'exam-match-at', 'seed-mat')
  assert.ok(bpAt.typeDistribution.matching >= 1, 'Contract 7: matching >= 3 items must yield matching slot')

  console.log('Contract 7 PASS: Matching constraints remain academically intact')
}

// ── CONTRACT 8: Composite multi-target evidence independently gradable ────────
function testCompositeMultiTargetEvidenceGradable() {
  const items = [
    makeItem('rel_a', 'mat-1', 1, 'concept', 'Concepto A', 'Contenido del concepto A para relación.', ['short_answer']),
    makeItem('rel_b', 'mat-1', 1, 'concept', 'Concepto B', 'Contenido del concepto B para relación.', ['short_answer']),
  ]
  const relations = [{ fromSourceItemId: 'rel_a', toSourceItemId: 'rel_b', type: 'explains' }]
  const universe = makeUniverse(items, relations)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-comp', 'seed-comp')

  const compositeSlot = bp.slots.find(s => s.targetIds.length > 1)
  assert.ok(compositeSlot, 'composite slot must be created from relation edge')
  assert.equal(compositeSlot.type, 'short_answer')
  assert.equal(compositeSlot.assessmentCriteria.length, 2, 'both targets must have independent criteria')

  const [c1, c2] = compositeSlot.assessmentCriteria
  assert.notEqual(c1.criterionId, c2.criterionId)
  assert.equal(c1.gradingMode, 'semantic')
  assert.equal(c2.gradingMode, 'semantic')
  assert.ok(c1.points > 0 && c2.points > 0)
  assert.equal(c1.points + c2.points, 12)

  console.log('Contract 8 PASS: Composite multi-target evidence remains independently gradable')
}

// ── CONTRACT 9: AcademicContent renders math structurally with accessible label ─
function testKatexStructuralMathRendering() {
  const bohrExpressions = [
    { expr: 'E_n = -\\frac{13.6\\text{ eV}}{n^3}', hasFrac: true, hasSupSub: true, hasCdot: false, textPart: 'eV' },
    { expr: 'E_n = \\frac{13.6\\text{ eV}}{n}', hasFrac: true, hasSupSub: true, hasCdot: false, textPart: 'eV' },
    { expr: 'E_n = -13.6\\text{ eV} \\cdot n^2', hasFrac: false, hasSupSub: true, hasCdot: true, textPart: 'eV' },
    { expr: 'E_n = -\\frac{13.6\\text{ eV}}{n^2}', hasFrac: true, hasSupSub: true, hasCdot: false, textPart: 'eV' },
  ]

  for (const { expr, hasFrac, hasSupSub, hasCdot, textPart } of bohrExpressions) {
    const html = renderToStaticMarkup(React.createElement(AcademicContent, { inline: true, content: `$${expr}$` }))

    assert.ok(html.includes('role="math"'), `Contract 9 FAIL: missing role="math" in ${expr}`)
    assert.ok(html.includes(`aria-label="${expr}"`), `Contract 9 FAIL: missing accessible aria-label in ${expr}`)
    assert.ok(!html.includes('<math'), `Contract 9 FAIL: MathML tag emitted in ${expr}`)
    assert.ok(!html.includes('katex-mathml'), `Contract 9 FAIL: katex-mathml emitted in ${expr}`)

    if (hasFrac) {
      assert.ok(html.includes('class="mfrac"'), `Contract 9 FAIL: missing mfrac in ${expr}`)
      assert.ok(html.includes('class="frac-line"'), `Contract 9 FAIL: missing frac-line in ${expr}`)
    }

    if (hasSupSub) {
      assert.ok(html.includes('msupsub'), `Contract 9 FAIL: missing msupsub in ${expr}`)
    }

    if (hasCdot) {
      assert.ok(html.includes('⋅'), `Contract 9 FAIL: missing cdot glyph in ${expr}`)
    }

    assert.ok(html.includes(textPart), `Contract 9 FAIL: missing text part ${textPart} in ${expr}`)
  }

  console.log('Contract 9 PASS: AcademicContent renders representative fraction/subscript/superscript math structurally with accessibility')
}

// ── CONTRACT 10: Null skill renders "No evaluado" & real 0 renders "0%" ──────
function testSkillScoreSemantics() {
  const comp = formatSkillScore(0)
  assert.equal(comp.isAssessed, true, 'comprehension (0) must be assessed')
  assert.equal(comp.score, 0)
  assert.equal(comp.displayScore, '0%', 'comprehension must display 0%')
  assert.equal(comp.progressBarWidth, '0%')
  assert.equal(comp.progressBarBg, '#dc2626', 'real 0% must have red progress bar')
  assert.equal(comp.textColor, '#991b1b', 'real 0% must have red score text')

  const ret = formatSkillScore(11)
  assert.equal(ret.isAssessed, true)
  assert.equal(ret.score, 11)
  assert.equal(ret.displayScore, '11%')
  assert.equal(ret.progressBarBg, '#dc2626')

  const med = formatSkillScore(55)
  assert.equal(med.isAssessed, true)
  assert.equal(med.displayScore, '55%')
  assert.equal(med.progressBarBg, '#eab308')
  assert.equal(med.textColor, '#b45309')

  const high = formatSkillScore(85)
  assert.equal(high.isAssessed, true)
  assert.equal(high.displayScore, '85%')
  assert.equal(high.progressBarBg, '#16a34a')
  assert.equal(high.textColor, '#16a34a')

  for (const unassessedVal of [null, undefined]) {
    const result = formatSkillScore(unassessedVal)
    assert.equal(result.isAssessed, false, `unassessed value ${unassessedVal} must NOT be assessed`)
    assert.equal(result.displayScore, 'No evaluado', `unassessed must display "No evaluado"`)
    assert.equal(result.progressBarWidth, '0%')
    assert.equal(result.progressBarBg, 'transparent', `unassessed progress bar must be transparent, not red`)
    assert.equal(result.textColor, 'var(--text-faint, #666)', `unassessed must have neutral faint color`)
  }

  console.log('Contract 10 PASS: formatSkillScore renders "No evaluado" for null/undefined, and honest percentages/colors for numeric scores')
}

// ── CONTRACT 11: Duration suitability filters before type preference ─────────
function testDurationSuitabilityFiltersBeforeTypePreference() {
  // Budget: 15 min * 60s * 0.85 = 765s.
  // 8 short_answer items (bloomLevel: 'analyze' -> critical_thinking -> short_answer) at 90s each = 720s.
  // Remaining budget: 765 - 720 = 45s.
  // 9th item: fact with short content (<= 160) and label > 4 words (feasible: ['multiple_choice', 'true_false']).
  // Upstream hint: ['multiple_choice'].
  // multiple_choice costs 55s (> 45s remaining).
  // true_false costs 35s (<= 45s remaining).
  // Without duration filter before preference: picks MCQ (55s) -> does not fit -> target omitted.
  // With duration filter before preference: MCQ is filtered out, true_false (35s) fits -> target assessed!
  const items: any[] = []
  for (let i = 0; i < 8; i++) {
    items.push(makeItem(`sa_${i}`, 'mat-1', 1, 'concept', `Concepto SA ${i}`, `Contenido largo del concepto de comprension ${i} para evaluar en respuesta corta.`, ['short_answer'], 'analyze'))
  }
  items.push(makeItem('item_tight', 'mat-1', 1, 'fact', 'Etiqueta con mas de cuatro palabras largas', 'Bohr nació en Copenhague en 1885.', ['multiple_choice'], 'remember'))

  const universe = makeUniverse(items)
  const bp = composeEnjoyerExamBlueprint(universe, 15, 'exam-tight-budget', 'seed-tight')

  assert.equal(bp.slots.length, 9, `Contract 11 FAIL: expected 9 slots, got ${bp.slots.length}. Target was omitted instead of using feasible true_false!`)
  const slotTight = bp.slots.find(s => s.sourceItemIds.includes('item_tight'))
  assert.ok(slotTight, 'Contract 11 FAIL: tight item must be assessed')
  assert.equal(slotTight.type, 'true_false', `Contract 11 FAIL: expected true_false (35s) to fit 45s budget, got ${slotTight.type}`)
  console.log('Contract 11 PASS: Duration suitability filters before type preference (45s budget picks fitting true_false over oversized MCQ)')
}

// ── RUN ALL CONTRACTS ────────────────────────────────────────────────────────
function main() {
  console.log('\n── RUNNING EXAM FINAL COMPOSITION FIXES CONTRACTS ──\n')
  testFeasibleTrueFalseNotEliminatedByMcqHint()
  testFeasibleFillBlankNotEliminatedByMcqHint()
  testInfeasibleTypesRemainExcluded()
  testHintsDoNotOverrideAcademicFeasibility()
  testDeterministicCompositionStability()
  testNoTypeQuotasExist()
  testMatchingConstraintsRemainIntact()
  testCompositeMultiTargetEvidenceGradable()
  testKatexStructuralMathRendering()
  testSkillScoreSemantics()
  testDurationSuitabilityFiltersBeforeTypePreference()
  console.log('\nALL 11 COMPOSITION FIX CONTRACTS PASSED!\n')
}

main()
