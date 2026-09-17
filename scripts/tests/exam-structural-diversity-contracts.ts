import assert from 'node:assert/strict'
import {
  buildExamEnjoyerUniverse,
  composeEnjoyerExamBlueprint,
  isRhetoricalConclusionTarget,
  filterRhetoricalRedundantTargets,
  requiresCompositeOpenEvidence,
} from '../../lib/materialBrain/examEnjoyerContext'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'

function makeItem(
  id: string,
  materialId: string,
  page: number,
  kind = 'concept',
  label = `Concepto ${id}`,
  content = `Contenido autorizado y verificable de ${id} con longitud adecuada para evaluación académica rigurosa.`,
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

function makeUniverse(items: any[], relations: any[] = [], topicTitle = 'Tema General') {
  const blueprint = {
    sourceSelectionFingerprint: 'fp-diversity-test',
    materialIds: ['mat-1'],
    selectedPages: { 'mat-1': [1, 2, 3, 4, 5] },
    topicsIndex: [{ id: 'topic-1', title: topicTitle, sourceOrder: 0 }],
    globalOrderedAnalysis: items,
    uniqueConceptsIndex: [],
    relations,
  }
  const snapshot = {
    ...buildSourceSelectionSnapshot(['mat-1'], { 'mat-1': [1, 2, 3, 4, 5] }),
    fingerprint: 'fp-diversity-test',
  }
  return buildExamEnjoyerUniverse(blueprint, snapshot)
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT 1: REACHABILITY CONTRACT
// Verify each of the six canonical types CAN be selected through production composer
// ─────────────────────────────────────────────────────────────────────────────
function testAllSixCanonicalTypesReachable() {
  console.log('Contract 1: Testing reachability of all 6 canonical question types...')

  const items = [
    // 1. Multiple choice candidate: length > 160 chars, normal concept
    makeItem(
      'mcq_1',
      'mat-1',
      1,
      'concept',
      'Principio de Superposición Cuántica',
      'El principio de superposición establece que un sistema físico cuántico puede encontrarse simultáneamente en una combinación lineal de múltiples estados cuánticos ortogonales hasta que ocurre una medición que colapsa su función de onda.',
      ['multiple_choice', 'open'],
      'understand',
    ),
    // 2. True / False candidate: short clear fact <= 160 chars
    makeItem(
      'tf_1',
      'mat-1',
      1,
      'fact',
      'Constante de Planck',
      'La constante de Planck relaciona la energía de los fotones con su frecuencia.',
      ['multiple_choice'],
      'remember',
    ),
    // 3. Fill Blank candidate: clean term / year / formula
    makeItem(
      'fb_1',
      'mat-1',
      1,
      'fact',
      'Año del modelo de Bohr',
      'Niels Bohr presentó su modelo atómico en el año 1913.',
      ['multiple_choice'],
      'remember',
    ),
    // 4. Short Answer candidate: explanation / analyze
    makeItem(
      'sa_1',
      'mat-1',
      2,
      'process',
      'Emisión de Fotones por Salto Cuántico',
      'Cuando un electrón desciende desde un nivel de energía superior a uno inferior, emite un fotón cuya frecuencia exacta es proporcional a la diferencia de energía.',
      ['open'],
      'analyze',
    ),
    // 5. Multi-select cluster: focal entity + 2 distinct dependent properties
    makeItem(
      'focal_atom',
      'mat-1',
      3,
      'entity',
      'Modelo Atómico de Bohr',
      'Modelo planetario cuantizado que describe los estados estacionarios del átomo de hidrógeno.',
      ['multiple_choice'],
    ),
    makeItem(
      'postulate_1',
      'mat-1',
      3,
      'concept',
      'Órbitas Cuantizadas Estacionarias',
      'Los electrones giran únicamente en órbitas circulares cuantizadas sin emitir radiación electromagnética de manera continua.',
      ['multiple_choice'],
    ),
    makeItem(
      'postulate_2',
      'mat-1',
      3,
      'concept',
      'Condición de Cuantización del Momento Angular',
      'El momento angular del electrón orbital está restringido a múltiplos enteros de la constante reducida de Planck.',
      ['multiple_choice'],
    ),
    // 6. Matching cluster: 3 distinct relation pairs
    makeItem('bot_a', 'mat-1', 4, 'entity', 'Cactus del Desierto', 'Planta adaptada al clima árido.'),
    makeItem('bot_b', 'mat-1', 4, 'entity', 'Orquídea Epífita', 'Planta que crece sobre ramas altas.'),
    makeItem('bot_c', 'mat-1', 4, 'entity', 'Manglar Costero', 'Árbol que habita aguas salobres mareales.'),
    makeItem('adapt_a', 'mat-1', 4, 'concept', 'Metabolismo Ácido CAM', 'Fija CO2 durante la noche en tallos suculentos.'),
    makeItem('adapt_b', 'mat-1', 4, 'concept', 'Raíces Aéreas con Velamen', 'Absorbe humedad atmosférica mediante tejido esponjoso.'),
    makeItem('adapt_c', 'mat-1', 4, 'concept', 'Neumatóforos y Filtro Salino', 'Estructuras radiculares que facilitan intercambio gaseoso.'),
  ]

  const relations = [
    // Multi-select relations pointing to focal_atom
    { id: 'r_multi_1', fromSourceItemId: 'postulate_1', toSourceItemId: 'focal_atom', type: 'postulate' },
    { id: 'r_multi_2', fromSourceItemId: 'postulate_2', toSourceItemId: 'focal_atom', type: 'postulate' },
    // Matching relations (3 distinct 1:1 pairs)
    { id: 'r_match_1', fromSourceItemId: 'bot_a', toSourceItemId: 'adapt_a', type: 'adaptation' },
    { id: 'r_match_2', fromSourceItemId: 'bot_b', toSourceItemId: 'adapt_b', type: 'adaptation' },
    { id: 'r_match_3', fromSourceItemId: 'bot_c', toSourceItemId: 'adapt_c', type: 'adaptation' },
  ]

  const universe = makeUniverse(items, relations)
  const bp = composeEnjoyerExamBlueprint(universe, 60, 'reachability-exam', 'reachability-seed')

  assert.ok(bp.slots.length >= 6, `Expected at least 6 slots, got ${bp.slots.length}`)
  assert.ok(bp.typeDistribution.multiple_choice >= 1, `MCQ must be selected (got ${bp.typeDistribution.multiple_choice})`)
  assert.ok(bp.typeDistribution.multi_select >= 1, `Multi-select must be selected (got ${bp.typeDistribution.multi_select})`)
  assert.ok(bp.typeDistribution.true_false >= 1, `True/false must be selected (got ${bp.typeDistribution.true_false})`)
  assert.ok(bp.typeDistribution.fill_blank >= 1, `Fill blank must be selected (got ${bp.typeDistribution.fill_blank})`)
  assert.ok(bp.typeDistribution.matching >= 1, `Matching must be selected (got ${bp.typeDistribution.matching})`)
  assert.ok(bp.typeDistribution.short_answer >= 1, `Short answer must be selected (got ${bp.typeDistribution.short_answer})`)

  console.log('Contract 1 PASS: All 6 canonical types are reachable through production composer')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT 2: MATCHING CONTRACT
// 2 pairs -> no matching
// >= 3 explicit compatible pairs -> matching selected
// same-topic unrelated items -> no matching
// duplicate right side -> no matching
// ─────────────────────────────────────────────────────────────────────────────
function testMatchingConstraintsAndReachability() {
  console.log('Contract 2: Testing matching constraints (strict bounds, no artificial quota)...')

  // Case A: 2 pairs -> strictly no matching (< 3)
  const items2 = [
    makeItem('m_left_1', 'mat-1', 1, 'entity', 'Newton', 'Formuló las leyes de la mecánica clásica.'),
    makeItem('m_left_2', 'mat-1', 1, 'entity', 'Maxwell', 'Unificó la electricidad y el magnetismo.'),
    makeItem('m_right_1', 'mat-1', 1, 'concept', 'Mecánica Clásica', 'Teoría del movimiento de cuerpos macroscópicos.'),
    makeItem('m_right_2', 'mat-1', 1, 'concept', 'Electromagnetismo', 'Teoría de campos eléctricos y magnéticos dinámicos.'),
  ]
  const rels2 = [
    { id: 'r1', fromSourceItemId: 'm_left_1', toSourceItemId: 'm_right_1', type: 'contribution' },
    { id: 'r2', fromSourceItemId: 'm_left_2', toSourceItemId: 'm_right_2', type: 'contribution' },
  ]
  const u2 = makeUniverse(items2, rels2)
  const bp2 = composeEnjoyerExamBlueprint(u2, 30, 'match-2pairs', 'seed-2')
  assert.equal(bp2.typeDistribution.matching, 0, '2 pairs must NOT yield matching')

  // Case B: >= 3 explicit compatible pairs -> matching selected
  const items3 = [
    ...items2,
    makeItem('m_left_3', 'mat-1', 1, 'entity', 'Einstein', 'Propuso la teoría de la relatividad general.'),
    makeItem('m_right_3', 'mat-1', 1, 'concept', 'Relatividad General', 'Teoría métrica de la gravitación y curvatura espacio-temporal.'),
  ]
  const rels3 = [
    ...rels2,
    { id: 'r3', fromSourceItemId: 'm_left_3', toSourceItemId: 'm_right_3', type: 'contribution' },
  ]
  const u3 = makeUniverse(items3, rels3)
  const bp3 = composeEnjoyerExamBlueprint(u3, 30, 'match-3pairs', 'seed-3')
  assert.ok(bp3.typeDistribution.matching >= 1, '>= 3 pairs must yield matching')
  const matchingSlot = bp3.slots.find(s => s.type === 'matching')
  assert.ok(matchingSlot, 'Matching slot must exist')
  assert.equal(matchingSlot.answerAuthority.kind, 'pairs')
  assert.equal(matchingSlot.answerAuthority.pairs.length, 3)
  // Strict 1:1 uniqueness
  const lefts = matchingSlot.answerAuthority.pairs.map(p => p.left.toLowerCase())
  const rights = matchingSlot.answerAuthority.pairs.map(p => p.right.toLowerCase())
  assert.equal(new Set(lefts).size, 3, 'All lefts must be distinct')
  assert.equal(new Set(rights).size, 3, 'All rights must be distinct')

  // Case C: Same-topic unrelated items -> no matching
  const unrelatedItems = [
    makeItem('u1', 'mat-1', 1, 'concept', 'Concepto Alfa', 'Descripción del concepto alfa.'),
    makeItem('u2', 'mat-1', 1, 'concept', 'Concepto Beta', 'Descripción del concepto beta.'),
    makeItem('u3', 'mat-1', 1, 'concept', 'Concepto Gamma', 'Descripción del concepto gamma.'),
    makeItem('u4', 'mat-1', 1, 'concept', 'Concepto Delta', 'Descripción del concepto delta.'),
  ]
  const uUnrelated = makeUniverse(unrelatedItems, []) // NO relations
  const bpUnrelated = composeEnjoyerExamBlueprint(uUnrelated, 30, 'match-unrelated', 'seed-unrelated')
  assert.equal(bpUnrelated.typeDistribution.matching, 0, 'Unrelated same-topic items must NOT produce matching')

  // Case D: Duplicate right side -> no matching
  const itemsDupRight = [
    makeItem('d_l1', 'mat-1', 1, 'entity', 'Termómetro', 'Mide temperatura.'),
    makeItem('d_l2', 'mat-1', 1, 'entity', 'Pirómetro', 'Mide radiación térmica superficial.'),
    makeItem('d_l3', 'mat-1', 1, 'entity', 'Barómetro', 'Mide presión atmosférica.'),
    makeItem('d_r1', 'mat-1', 1, 'definition', 'Medición Térmica', 'Instrumento que cuantifica magnitudes térmicas.'),
    makeItem('d_r2', 'mat-1', 1, 'definition', 'Medición Térmica Dup', 'Instrumento que cuantifica magnitudes térmicas.'), // duplicate content
    makeItem('d_r3', 'mat-1', 1, 'definition', 'Presión', 'Instrumento que mide presión barométrica.'),
  ]
  const relsDupRight = [
    { id: 'rd1', fromSourceItemId: 'd_l1', toSourceItemId: 'd_r1', type: 'function' },
    { id: 'rd2', fromSourceItemId: 'd_l2', toSourceItemId: 'd_r2', type: 'function' }, // same right content!
    { id: 'rd3', fromSourceItemId: 'd_l3', toSourceItemId: 'd_r3', type: 'function' },
  ]
  const uDupRight = makeUniverse(itemsDupRight, relsDupRight)
  const bpDupRight = composeEnjoyerExamBlueprint(uDupRight, 30, 'match-dupright', 'seed-dupright')
  assert.equal(bpDupRight.typeDistribution.matching, 0, 'Duplicate right side entries must NOT produce matching')

  console.log('Contract 2 PASS: Matching respects academic feasibility, 3-pair threshold, and strict uniqueness')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT 3: MULTI-SELECT CONTRACT
// >= 2 explicitly supported properties for focal X -> multi_select selected
// topical siblings without shared focal target -> not sufficient
// ─────────────────────────────────────────────────────────────────────────────
function testMultiSelectConstraintsAndReachability() {
  console.log('Contract 3: Testing multi-select constraints...')

  // Case A: >= 2 properties pointing to shared focal target X
  const focal = makeItem('focal_ent', 'mat-1', 1, 'entity', 'Fotosíntesis Oxigénica', 'Vía metabólica autotrófica.')
  const prop1 = makeItem('prop_1', 'mat-1', 1, 'process', 'Fase Luminosa', 'Generación de ATP y NADPH en tilacoides.')
  const prop2 = makeItem('prop_2', 'mat-1', 1, 'process', 'Ciclo de Calvin', 'Fijación de carbono mediada por RuBisCO.')
  const dist1 = makeItem('dist_1', 'mat-1', 1, 'concept', 'Glucólisis Anaeróbica', 'Degradación de glucosa a piruvato.')
  const dist2 = makeItem('dist_2', 'mat-1', 1, 'concept', 'Ciclo de Krebs', 'Oxidación mitocondrial del acetil-CoA.')
  const rels = [
    { id: 'rm1', fromSourceItemId: 'prop_1', toSourceItemId: 'focal_ent', type: 'phase' },
    { id: 'rm2', fromSourceItemId: 'prop_2', toSourceItemId: 'focal_ent', type: 'phase' },
  ]
  const u = makeUniverse([focal, prop1, prop2, dist1, dist2], rels)
  const bp = composeEnjoyerExamBlueprint(u, 30, 'ms-focal', 'seed-ms')
  assert.ok(bp.typeDistribution.multi_select >= 1, 'Shared focal target with >= 2 properties must yield multi_select')
  const slot = bp.slots.find(s => s.type === 'multi_select')
  assert.ok(slot, 'Multi-select slot must exist')
  assert.equal(slot.assessmentFocus, 'Fotosíntesis Oxigénica', 'Focus must be the focal target')
  assert.equal(slot.answerAuthority.kind, 'multi_text')
  assert.equal(slot.answerAuthority.canonicalValues.length, 2)

  // Case B: Topical siblings without shared focal target -> no multi-select
  const siblings = [
    makeItem('sib_1', 'mat-1', 1, 'concept', 'Mitosis', 'División celular ecuacional.'),
    makeItem('sib_2', 'mat-1', 1, 'concept', 'Meiosis', 'División celular reduccional.'),
    makeItem('sib_3', 'mat-1', 1, 'concept', 'Fisión Binaria', 'División procariota simple.'),
  ]
  const uSiblings = makeUniverse(siblings, [])
  const bpSiblings = composeEnjoyerExamBlueprint(uSiblings, 30, 'ms-siblings', 'seed-siblings')
  assert.equal(bpSiblings.typeDistribution.multi_select, 0, 'Topical siblings without shared focal target must NOT produce multi_select')

  console.log('Contract 3 PASS: Multi-select requires explicit shared focal relationship')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT 4: RELATION GROUPING CONTRACT
// dependsOn alone -> does not force composite short_answer
// genuine explanatory/process integration -> composite short_answer allowed
// ─────────────────────────────────────────────────────────────────────────────
function testRelationGroupingContract() {
  console.log('Contract 4: Testing relation grouping constraints...')

  // Case A: dependsOn alone without explanatory integration -> leaves targets atomic
  const itemA = makeItem('fact_a', 'mat-1', 1, 'fact', 'Descubrimiento del Electrón', 'Thomson identificó el electrón en 1897.', ['multiple_choice'])
  const itemB = makeItem('entity_b', 'mat-1', 1, 'entity', 'Modelo del Pudín', 'Modelo atómico temprano propuesto por Thomson.', ['multiple_choice'])
  const relDepends = [{ fromSourceItemId: 'fact_a', toSourceItemId: 'entity_b', type: 'dependsOn' }]
  const uAtomic = makeUniverse([itemA, itemB], relDepends)
  const bpAtomic = composeEnjoyerExamBlueprint(uAtomic, 30, 'exam-atomic', 'seed-atomic')

  // Both should remain atomic slots, NOT combined into a 2-target short_answer
  assert.equal(bpAtomic.slots.length, 2, 'dependsOn alone must NOT force composite question')
  assert.ok(bpAtomic.slots.every(s => s.targetIds.length === 1), 'All slots must be atomic for non-explanatory dependsOn')

  // Case B: Genuine explanatory/mechanism integration -> composite short_answer allowed
  const cause = makeItem('cause_1', 'mat-1', 1, 'process', 'Salto Cuántico Electrónico', 'Un electrón pasa de un nivel excitado a un estado fundamental.', ['open'], 'analyze')
  const effect = makeItem('effect_1', 'mat-1', 1, 'process', 'Emisión del Fotón', 'Se emite radiación electromagnética de frecuencia bien definida.', ['open'], 'analyze')
  const relExplains = [{ fromSourceItemId: 'cause_1', toSourceItemId: 'effect_1', type: 'explains' }]
  const uComposite = makeUniverse([cause, effect], relExplains)
  const bpComposite = composeEnjoyerExamBlueprint(uComposite, 30, 'exam-composite', 'seed-comp')

  const compositeSlot = bpComposite.slots.find(s => s.targetIds.length > 1)
  assert.ok(compositeSlot, 'explains relation must allow composite question')
  assert.equal(compositeSlot.type, 'short_answer')
  assert.equal(compositeSlot.assessmentCriteria.length, 2, 'Independent criteria for both integrated targets')

  console.log('Contract 4 PASS: dependsOn remains atomic while explanatory relations allow composite short_answer')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT 5: REDUNDANCY CONTRACT
// Rhetorical conclusion duplicates:
// exactly 1 consumes core slot
// omitted duplicates appear in notAssessedDueToScopeTargetIds
// distinct technical concepts on same page preserved
// ─────────────────────────────────────────────────────────────────────────────
function testRhetoricalRedundancyContract() {
  console.log('Contract 5: Testing rhetorical summary redundancy filter...')

  const rhetoricalTargets = [
    makeItem('rhet_1', 'mat-1', 5, 'concept', 'Importancia de Bohr', 'En conclusión, Bohr fue el arquitecto de la ciencia moderna que transformó la comprensión del universo.'),
    makeItem('rhet_2', 'mat-1', 5, 'concept', 'Legado de Bohr', 'El legado continúa inspirando una nueva era científica como pensador visionario.'),
    makeItem('rhet_3', 'mat-1', 5, 'concept', 'Grandeza de Bohr', 'Su verdadera grandeza radica en haber cambiado radicalmente los fundamentos de la física.'),
  ]
  const technicalTarget = makeItem('tech_1', 'mat-1', 5, 'concept', 'Efecto Túnel Cuántico', 'Fenómeno por el cual una partícula cuántica atraviesa una barrera de potencial mayor que su energía cinética.')

  // Direct unit check on classifier
  assert.ok(isRhetoricalConclusionTarget(rhetoricalTargets[0] as any), 'rhet_1 must be identified as rhetorical conclusion')
  assert.ok(isRhetoricalConclusionTarget(rhetoricalTargets[1] as any), 'rhet_2 must be identified as rhetorical conclusion')
  assert.ok(isRhetoricalConclusionTarget(rhetoricalTargets[2] as any), 'rhet_3 must be identified as rhetorical conclusion')
  assert.ok(!isRhetoricalConclusionTarget(technicalTarget as any), 'tech_1 must NOT be identified as rhetorical conclusion')

  // Composition check
  const allItems = [...rhetoricalTargets, technicalTarget]
  const u = makeUniverse(allItems)
  const bp = composeEnjoyerExamBlueprint(u, 30, 'exam-redundancy', 'seed-red')

  // Exactly 1 rhetorical target assessed in core slots
  const assessedRhetorical = bp.slots.filter(s => s.targetIds.some(id => id.includes('rhet_')))
  assert.equal(assessedRhetorical.length, 1, 'Exactly 1 rhetorical conclusion slot should be scheduled')

  // Technical target must be assessed
  const assessedTechnical = bp.slots.filter(s => s.targetIds.some(id => id.includes('tech_1')))
  assert.equal(assessedTechnical.length, 1, 'Distinct technical target on same page must be preserved')

  // The other 2 rhetorical targets must appear honestly in notAssessedDueToScopeTargetIds
  assert.equal(bp.coverage.notAssessedDueToScopeTargetIds.length, 2, '2 redundant rhetorical targets omitted due to scope')
  for (const id of bp.coverage.notAssessedDueToScopeTargetIds) {
    assert.ok(id.includes('rhet_'), `Omitted target ${id} must be a redundant rhetorical target`)
  }

  console.log('Contract 5 PASS: Rhetorical summary redundancy properly collapses duplicates while preserving technical targets')
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN TEST RUNNER
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  console.log('\n── RUNNING EXAM STRUCTURAL DIVERSITY CONTRACTS ──\n')
  testAllSixCanonicalTypesReachable()
  testMatchingConstraintsAndReachability()
  testMultiSelectConstraintsAndReachability()
  testRelationGroupingContract()
  testRhetoricalRedundancyContract()
  console.log('\nALL 5 STRUCTURAL DIVERSITY CONTRACTS PASSED!\n')
}

main()
