import assert from 'node:assert/strict'
import {
  buildExamEnjoyerUniverse,
  composeEnjoyerExamBlueprint,
  extractFillBlankUnit,
  isMetadataLabel,
  META_LABEL_PREFIX_RE,
  type ExamEnjoyerTarget,
} from '../../lib/materialBrain/examEnjoyerContext'
import {
  authorSlotQuestionWithDiagnostics,
  toPublicExamQuestion,
  gradeObjectiveQuestion,
  gradeDeterministicCriterion,
  fillBlankSemanticClass,
  fillBlankDistractorCompatible,
  shortAnswerStemIsSpecific,
  examTaskMatchesOperation,
  __routeDeps,
} from '../../app/api/alai-studyal-exam/route'
import {
  WorkerExamGenerationStore,
  examGenerationIdentity,
  type ExamGenerationManifest,
} from '../../lib/materialBrain/examGenerationStore'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'

function makeItem(
  id: string,
  materialId: string,
  page: number,
  kind = 'concept',
  label = `Concepto ${id}`,
  content = `Contenido autorizado y verificable de ${id} con longitud adecuada para pruebas académicas.`,
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
    sourceSpans: [{ materialId, page, quote: content.slice(0, 40) }],
  }
}

function makeUniverse(items: any[], relations: any[] = []) {
  const snapshot = {
    ...buildSourceSelectionSnapshot(['mat-1'], { 'mat-1': [1, 2, 3] }),
    fingerprint: 'fp-quality-test',
  }
  const payload = {
    sourceSelectionFingerprint: 'fp-quality-test',
    materialIds: ['mat-1'],
    selectedPages: { 'mat-1': [1, 2, 3] },
    topicsIndex: [{ id: 'topic-1', title: 'Tema 1', sourceOrder: 0 }],
    globalOrderedAnalysis: items,
    uniqueConceptsIndex: [],
    relations,
  }
  return buildExamEnjoyerUniverse(payload, snapshot)
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT A: FILL METADATA AUTHORITY
// ─────────────────────────────────────────────────────────────────────────────
function testContractAFillMetadata() {
  console.log('Contract A: Testing fill_blank metadata stripping and evidence verification...')

  // Case 1: Label has metadata prefix "Definición de etnocentrismo" and source supports "etnocentrismo"
  const itemCase1 = makeItem(
    't_etno',
    'mat-1',
    1,
    'concept',
    'Definición de etnocentrismo',
    'El etnocentrismo es la tendencia a juzgar otras culturas según los propios patrones culturales.',
    ['multiple_choice'],
    'remember',
  )
  const u1 = makeUniverse([itemCase1])
  const target1 = u1.targets[0]
  const unit1 = extractFillBlankUnit(target1)
  assert.ok(unit1, 'Unit must be extracted when term is present in evidence')
  assert.equal(unit1.unit, 'etnocentrismo', 'Canonical unit must be stripped term, NEVER metadata label')
  assert.notEqual(unit1.unit, 'Definición de etnocentrismo')

  // Case 2: Source does not contain the stripped term
  const itemCase2 = makeItem(
    't_unsupported',
    'mat-1',
    1,
    'concept',
    'Definición de etnocentrismo',
    'La antropología estudia las diferentes manifestaciones sociales y prácticas comunitarias.',
    ['multiple_choice'],
    'remember',
  )
  const u2 = makeUniverse([itemCase2])
  const target2 = u2.targets[0]
  const unit2 = extractFillBlankUnit(target2)
  assert.equal(unit2, null, 'Fill blank must be ineligible when term is not in source evidence')

  // Case 3: Unprefixed label term NOT in evidence
  const itemCase3 = makeItem(
    't_unprefixed_no',
    'mat-1',
    1,
    'concept',
    'etnocentrismo',
    'La antropología estudia diversas sociedades humanas y sus dinámicas grupales.',
    ['fill_blank'],
  )
  assert.equal(extractFillBlankUnit(makeUniverse([itemCase3]).targets[0]), null, 'Unprefixed unsupported term must be rejected')

  // Case 4: "Definición de H2O" where "H2O" is NOT in evidence
  const itemCase4 = makeItem(
    't_h2o_no',
    'mat-1',
    1,
    'formula',
    'Definición de H2O',
    'El agua es un recurso vital en la naturaleza.',
    ['fill_blank'],
  )
  assert.equal(extractFillBlankUnit(makeUniverse([itemCase4]).targets[0]), null, 'Definición de H2O must be rejected when H2O not in evidence')

  // Case 5: "Definición de H2O" where "H2O" IS in evidence
  const itemCase5 = makeItem(
    't_h2o_yes',
    'mat-1',
    1,
    'formula',
    'Definición de H2O',
    'El agua tiene la fórmula molecular H2O en química.',
    ['fill_blank'],
  )
  const unit5 = extractFillBlankUnit(makeUniverse([itemCase5]).targets[0])
  assert.ok(unit5, 'H2O must be extracted when supported by evidence')
  assert.equal(unit5.unit, 'H2O')

  // Case 6: Pure metadata labels rejected
  const itemCase6a = makeItem('t_pure_meta1', 'mat-1', 1, 'concept', 'Concepto', 'Contenido del concepto en la lección.', ['fill_blank'])
  assert.equal(extractFillBlankUnit(makeUniverse([itemCase6a]).targets[0]), null, 'Standalone Concepto label must be rejected')
  const itemCase6b = makeItem('t_pure_meta2', 'mat-1', 1, 'concept', 'Definición', 'Contenido de la definición en la lección.', ['fill_blank'])
  assert.equal(extractFillBlankUnit(makeUniverse([itemCase6b]).targets[0]), null, 'Standalone Definición label must be rejected')

  // Case 7: Unsupported label year
  const itemCase7 = makeItem('t_year_no', 'mat-1', 1, 'concept', '1913', 'Bohr presentó su modelo atómico en Europa.', ['fill_blank'])
  assert.equal(extractFillBlankUnit(makeUniverse([itemCase7]).targets[0]), null, 'Unsupported label year must be rejected')

  // Case 8: Ambiguous source dates
  const itemCase8 = makeItem('t_year_ambig', 'mat-1', 1, 'concept', 'Año de presentación', 'Nació en 1885 y presentó su modelo en 1913.', ['fill_blank'])
  assert.equal(extractFillBlankUnit(makeUniverse([itemCase8]).targets[0]), null, 'Ambiguous source dates must be rejected')

  // Case 9: Valid source-supported year
  const itemCase9 = makeItem('t_year_valid', 'mat-1', 1, 'concept', 'Año de presentación', 'Bohr presentó su modelo en 1913 ante la comunidad científica.', ['fill_blank'])
  const unit9 = extractFillBlankUnit(makeUniverse([itemCase9]).targets[0])
  assert.ok(unit9, 'Valid source-supported year must be accepted')
  assert.equal(unit9.unit, '1913')
  assert.equal(unit9.semanticClass, 'year')

  // Additional short metadata labels
  assert.ok(isMetadataLabel('Concepto de cultura'))
  assert.ok(isMetadataLabel('Características de la sociedad'))
  assert.ok(isMetadataLabel('Definición de símbolo cultural'))
  assert.ok(isMetadataLabel('Resumen de la lección'))
  assert.ok(isMetadataLabel('Importancia del átomo'))
  assert.equal(isMetadataLabel('etnocentrismo'), false)
  assert.equal(isMetadataLabel('modelo atómico'), false)

  console.log('Contract A PASS: Fill metadata prefixes stripped and strictly verified against source evidence')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT B: FILL DISTRACTORS
// ─────────────────────────────────────────────────────────────────────────────
function testContractBFillDistractors() {
  console.log('Contract B: Testing fill_blank distractor filtering (no metadata labels, bounded units)...')

  const items = [
    makeItem('fb1', 'mat-1', 1, 'concept', 'Definición de etnocentrismo', 'El etnocentrismo define la visión propia.', ['fill_blank'], 'remember'),
    makeItem('fb2', 'mat-1', 1, 'concept', 'Definición de relativismo', 'El relativismo promueve comprensión contextual.', ['fill_blank'], 'remember'),
    makeItem('fb3', 'mat-1', 1, 'concept', 'Definición de aculturación', 'La aculturación describe el intercambio cultural.', ['fill_blank'], 'remember'),
    makeItem('fb4', 'mat-1', 1, 'concept', 'Definición de endogamia', 'La endogamia regula el matrimonio grupal.', ['fill_blank'], 'remember'),
    makeItem('meta_bad', 'mat-1', 1, 'concept', 'Resumen del capítulo', 'Texto explicativo general del capítulo.', ['multiple_choice']),
  ]
  const universe = makeUniverse(items)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-fb-bank', 'seed-fb-bank')
  const slot = bp.slots.find(s => s.type === 'fill_blank' && (s.answerAuthority as any).canonicalValue === 'etnocentrismo')
  assert.ok(slot, 'Fill blank slot for etnocentrismo must exist')

  for (const d of slot.answerAuthority.distractorPool) {
    assert.equal(isMetadataLabel(d), false, `Distractor "${d}" must not be a metadata label`)
    assert.ok(d.split(/\s+/).length <= 5, `Distractor "${d}" must be <= 5 words`)
    assert.ok(d.length <= 40, `Distractor "${d}" must be <= 40 chars`)
  }

  // Author question and verify word bank product rule (exactly 4-5 items)
  const authored = authorSlotQuestionWithDiagnostics('exam-fb-bank', bp, slot, {
    type: 'fill_blank',
    prompt: 'El ___ es la visión propia.',
    distractors: ['relativismo', 'aculturación', 'endogamia'],
  })
  assert.ok(authored.question, authored.rejectionReason)
  const bank = authored.question.wordBank || []
  assert.ok(bank.length >= 4 && bank.length <= 5, `Bank must have exactly 4-5 entries (got ${bank.length})`)
  for (const word of bank) {
    assert.equal(isMetadataLabel(word), false, `Bank word "${word}" must not be a metadata label`)
    assert.ok(word.split(/\s+/).length <= 5, `Bank word "${word}" must be <= 5 words`)
    assert.ok(word.length <= 40, `Bank word "${word}" must be <= 40 chars`)
    assert.ok(!/[.!?]$/.test(word), `Bank word "${word}" must not end with sentence-terminal punctuation`)
  }

  // Insufficient distractors (< 3) rejection
  const slotNoDistractors = {
    ...slot,
    answerAuthority: {
      ...slot.answerAuthority,
      distractorPool: [],
    },
  }
  const authoredFail = authorSlotQuestionWithDiagnostics('exam-fb-fail', bp, slotNoDistractors as any, {
    type: 'fill_blank',
    prompt: 'El ___ es la visión propia.',
    distractors: ['solo un distractor'],
  })
  assert.equal(authoredFail.question, null, 'Must reject authoring with < 3 distractors')
  assert.ok(authoredFail.rejectionReason?.includes('INSUFFICIENT_DISTRACTORS'), 'Rejection reason must indicate insufficient distractors')

  console.log('Contract B PASS: Fill distractors adhere to bounded academic units without metadata leaks')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT C: MATCHING GENERIC RELATION
// ─────────────────────────────────────────────────────────────────────────────
function testContractCMatchingGenericRelation() {
  console.log('Contract C: Testing generic same-topic / related / association edges rejection...')

  // 3 pairs of generic concepts connected by 'related' edges with no complementary shape
  const items = [
    makeItem('c1', 'mat-1', 1, 'concept', 'Concepto Alfa', 'Descripción del concepto alfa.'),
    makeItem('c2', 'mat-1', 1, 'concept', 'Concepto Beta', 'Descripción del concepto beta.'),
    makeItem('c3', 'mat-1', 1, 'concept', 'Concepto Gamma', 'Descripción del concepto gamma.'),
    makeItem('c4', 'mat-1', 1, 'concept', 'Concepto Delta', 'Descripción del concepto delta.'),
    makeItem('c5', 'mat-1', 1, 'concept', 'Concepto Épsilon', 'Descripción del concepto épsilon.'),
    makeItem('c6', 'mat-1', 1, 'concept', 'Concepto Zeta', 'Descripción del concepto zeta.'),
  ]
  const relations = [
    { id: 'gr1', fromSourceItemId: 'c1', toSourceItemId: 'c2', type: 'related' },
    { id: 'gr2', fromSourceItemId: 'c3', toSourceItemId: 'c4', type: 'related' },
    { id: 'gr3', fromSourceItemId: 'c5', toSourceItemId: 'c6', type: 'related' },
  ]
  const universe = makeUniverse(items, relations)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-match-generic', 'seed-mg')
  assert.equal(bp.typeDistribution.matching, 0, 'Generic concept->concept related edges must NOT produce matching')

  // Check that 'association' and 'associated_with' are also rejected
  const relationsAssoc = [
    { id: 'ga1', fromSourceItemId: 'c1', toSourceItemId: 'c2', type: 'association' },
    { id: 'ga2', fromSourceItemId: 'c3', toSourceItemId: 'c4', type: 'associated_with' },
    { id: 'ga3', fromSourceItemId: 'c5', toSourceItemId: 'c6', type: 'association' },
  ]
  const universeAssoc = makeUniverse(items, relationsAssoc)
  const bpAssoc = composeEnjoyerExamBlueprint(universeAssoc, 30, 'exam-match-assoc', 'seed-assoc')
  assert.equal(bpAssoc.typeDistribution.matching, 0, 'Generic association/associated_with edges must NOT produce matching')

  console.log('Contract C PASS: Generic same-topic / related / association edges correctly rejected for matching')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT D: MATCHING HINT ONLY
// ─────────────────────────────────────────────────────────────────────────────
function testContractDMatchingHintOnly() {
  console.log('Contract D: Testing matching hints without explicit pair semantics rejection...')

  const items = [
    makeItem('h1', 'mat-1', 1, 'concept', 'Hint Concept 1', 'Texto del concepto 1.', ['matching']),
    makeItem('h2', 'mat-1', 1, 'concept', 'Hint Concept 2', 'Texto del concepto 2.', ['matching']),
    makeItem('h3', 'mat-1', 1, 'concept', 'Hint Concept 3', 'Texto del concepto 3.', ['matching']),
    makeItem('h4', 'mat-1', 1, 'concept', 'Hint Concept 4', 'Texto del concepto 4.', ['matching']),
  ]
  // NO relations in universe
  const universe = makeUniverse(items, [])
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-match-hints', 'seed-mh')
  assert.equal(bp.typeDistribution.matching, 0, 'Matching hints without explicit relation semantics must NOT produce matching')

  console.log('Contract D PASS: Hint-only matching without explicit pair semantics is ineligible')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT E: MATCHING VALID EXPLICIT ASSOCIATION
// ─────────────────────────────────────────────────────────────────────────────
function testContractEMatchingValidExplicitAssociation() {
  console.log('Contract E: Testing valid explicit 1:1 matching associations and public DTO privacy...')

  const items = [
    makeItem('scientist_1', 'mat-1', 1, 'entity', 'Isaac Newton', 'Físico inglés del siglo XVII.'),
    makeItem('scientist_2', 'mat-1', 1, 'entity', 'James Clerk Maxwell', 'Físico escocés del siglo XIX.'),
    makeItem('scientist_3', 'mat-1', 1, 'entity', 'Albert Einstein', 'Físico alemán del siglo XX.'),
    makeItem('theory_1', 'mat-1', 1, 'concept', 'Mecánica Clásica', 'Teoría del movimiento basada en tres leyes dinámicas.'),
    makeItem('theory_2', 'mat-1', 1, 'concept', 'Electromagnetismo', 'Teoría unificada de campos eléctricos y magnéticos.'),
    makeItem('theory_3', 'mat-1', 1, 'concept', 'Relatividad General', 'Teoría geométrica de la gravitación y espacio-tiempo.'),
  ]
  const relations = [
    { id: 'rel1', fromSourceItemId: 'scientist_1', toSourceItemId: 'theory_1', type: 'contribution' },
    { id: 'rel2', fromSourceItemId: 'scientist_2', toSourceItemId: 'theory_2', type: 'contribution' },
    { id: 'rel3', fromSourceItemId: 'scientist_3', toSourceItemId: 'theory_3', type: 'contribution' },
  ]
  const universe = makeUniverse(items, relations)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-match-valid', 'seed-mv')
  assert.ok(bp.typeDistribution.matching >= 1, 'Valid explicit 1:1 associations must produce matching')

  const slot = bp.slots.find(s => s.type === 'matching')!
  assert.ok(slot, 'Matching slot must exist')
  assert.equal(slot.answerAuthority.kind, 'pairs')
  assert.equal(slot.answerAuthority.pairs.length, 3)

  // Author question and verify private vs public DTO
  const authored = authorSlotQuestionWithDiagnostics('exam-match-valid', bp, slot, {
    type: 'matching',
    prompt: 'Relaciona cada científico con su teoría.',
  })
  assert.ok(authored.question, authored.rejectionReason)
  const question = authored.question

  // Private fields exist on authored question
  assert.ok(question.matchingCorrectMap, 'Private matchingCorrectMap must exist on authored question')
  assert.ok(question.pairs, 'Private pairs must exist on authored question')

  // Public DTO strips private authority
  const pub = toPublicExamQuestion(question)
  assert.equal((pub as any).matchingCorrectMap, undefined, 'matchingCorrectMap must NOT be in public DTO')
  assert.equal((pub as any).pairs, undefined, 'pairs must NOT be in public DTO')
  assert.equal((pub as any).correctAnswer, undefined, 'correctAnswer must NOT be in public DTO')
  assert.ok(pub.matchingLeftTexts && pub.matchingLeftTexts.length === 3, 'matchingLeftTexts must exist in public DTO')
  assert.ok(pub.matchingRightTexts && pub.matchingRightTexts.length === 3, 'matchingRightTexts must exist in public DTO')

  console.log('Contract E PASS: Valid explicit matching produced, private map intact, public DTO sanitized')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT F: MATCHING AMBIGUITY
// ─────────────────────────────────────────────────────────────────────────────
function testContractFMatchingAmbiguity() {
  console.log('Contract F: Testing matching ambiguity rejection (near-duplicate right semantics, 1:N and N:1 collisions)...')

  // Case 1: Near-duplicate right side semantics
  const items = [
    makeItem('t1', 'mat-1', 1, 'entity', 'Termómetro', 'Instrumento de medición.'),
    makeItem('t2', 'mat-1', 1, 'entity', 'Pirómetro', 'Instrumento de medición térmica.'),
    makeItem('t3', 'mat-1', 1, 'entity', 'Barómetro', 'Instrumento de presión.'),
    makeItem('d1', 'mat-1', 1, 'definition', 'Medición de Temperatura', 'Instrumento que cuantifica magnitudes térmicas corporales.'),
    makeItem('d2', 'mat-1', 1, 'definition', 'Medición Térmica', 'Instrumento que cuantifica magnitudes térmicas corporales.'), // Near duplicate!
    makeItem('d3', 'mat-1', 1, 'definition', 'Presión', 'Instrumento que mide presión barométrica.'),
  ]
  const relations = [
    { id: 'ra1', fromSourceItemId: 't1', toSourceItemId: 'd1', type: 'definition' },
    { id: 'ra2', fromSourceItemId: 't2', toSourceItemId: 'd2', type: 'definition' },
    { id: 'ra3', fromSourceItemId: 't3', toSourceItemId: 'd3', type: 'definition' },
  ]
  const universe = makeUniverse(items, relations)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-match-ambig', 'seed-ma')
  assert.equal(bp.typeDistribution.matching, 0, 'Near-duplicate right side semantics must reject matching')

  // Case 2: 1:N collision (one left endpoint connects to multiple right endpoints)
  const items1N = [
    makeItem('s1', 'mat-1', 1, 'entity', 'Isaac Newton', 'Físico inglés.'),
    makeItem('s2', 'mat-1', 1, 'entity', 'Albert Einstein', 'Físico alemán.'),
    makeItem('s3', 'mat-1', 1, 'entity', 'Niels Bohr', 'Físico danés.'),
    makeItem('th1', 'mat-1', 1, 'concept', 'Mecánica Clásica', 'Teoría del movimiento.'),
    makeItem('th2', 'mat-1', 1, 'concept', 'Óptica Clásica', 'Teoría de la luz y reflexión.'),
    makeItem('th3', 'mat-1', 1, 'concept', 'Relatividad General', 'Teoría del espacio-tiempo.'),
  ]
  const relations1N = [
    { id: 'r1n_1', fromSourceItemId: 's1', toSourceItemId: 'th1', type: 'contribution' },
    { id: 'r1n_2', fromSourceItemId: 's1', toSourceItemId: 'th2', type: 'contribution' }, // s1 connects to th1 AND th2!
    { id: 'r1n_3', fromSourceItemId: 's2', toSourceItemId: 'th3', type: 'contribution' },
  ]
  const u1N = makeUniverse(items1N, relations1N)
  const bp1N = composeEnjoyerExamBlueprint(u1N, 30, 'exam-match-1n', 'seed-1n')
  assert.equal(bp1N.typeDistribution.matching, 0, '1:N matching edges must be rejected as ambiguous (leaving < 3 pairs)')

  // Case 3: N:1 collision (multiple left endpoints connect to the same right endpoint)
  const relationsN1 = [
    { id: 'rn1_1', fromSourceItemId: 's1', toSourceItemId: 'th1', type: 'contribution' },
    { id: 'rn1_2', fromSourceItemId: 's2', toSourceItemId: 'th1', type: 'contribution' }, // both s1 and s2 connect to th1!
    { id: 'rn1_3', fromSourceItemId: 's3', toSourceItemId: 'th3', type: 'contribution' },
  ]
  const uN1 = makeUniverse(items1N, relationsN1)
  const bpN1 = composeEnjoyerExamBlueprint(uN1, 30, 'exam-match-n1', 'seed-n1')
  assert.equal(bpN1.typeDistribution.matching, 0, 'N:1 matching edges must be rejected as ambiguous (leaving < 3 pairs)')

  console.log('Contract F PASS: Ambiguous 1:N, N:1, and near-duplicate matching pairs rejected')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT G: MULTI_SELECT TRUE-BUT-OFF-STEM
// ─────────────────────────────────────────────────────────────────────────────
function testContractGMultiSelectTrueButOffStem() {
  console.log('Contract G: Testing multi_select predicate membership vs off-predicate truths...')

  const focal = makeItem('focal_pilares', 'mat-1', 1, 'concept', 'Pilares del Islam', 'Fundamentos de la práctica islámica.')
  const m1 = makeItem('m1', 'mat-1', 1, 'concept', 'Profesión de Fe (Shahada)', 'Testimonio de fe islámica.')
  const m2 = makeItem('m2', 'mat-1', 1, 'concept', 'Oración Diaria (Salat)', 'Rezo preceptivo cinco veces al día.')
  const offStem = makeItem('off1', 'mat-1', 1, 'concept', 'Etnocentrismo Cultural', 'Concepto antropológico no islámico.')
  const offStem2 = makeItem('off2', 'mat-1', 1, 'concept', 'Revolución Científica', 'Cambio de paradigma en la física.')

  // Heterogeneous predicates test:
  const relationsMixed = [
    { id: 'rm1', fromSourceItemId: 'm1', toSourceItemId: 'focal_pilares', type: 'pillar' },
    { id: 'rm2', fromSourceItemId: 'm2', toSourceItemId: 'focal_pilares', type: 'property' }, // Mixed predicate!
  ]
  const uMixed = makeUniverse([focal, m1, m2, offStem, offStem2], relationsMixed)
  const bpMixed = composeEnjoyerExamBlueprint(uMixed, 30, 'exam-ms-mixed', 'seed-mixed')
  assert.equal(bpMixed.typeDistribution.multi_select, 0, 'Mixed predicates to same focal must NOT form multi_select')

  const relations = [
    { id: 'r_m1', fromSourceItemId: 'm1', toSourceItemId: 'focal_pilares', type: 'pillar' },
    { id: 'r_m2', fromSourceItemId: 'm2', toSourceItemId: 'focal_pilares', type: 'pillar' },
  ]
  const universe = makeUniverse([focal, m1, m2, offStem, offStem2], relations)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-ms-truth', 'seed-ms-t')
  const slot = bp.slots.find(s => s.type === 'multi_select')
  assert.ok(slot, 'Multi-select slot must exist')
  assert.equal(slot.answerAuthority.kind, 'multi_text')
  assert.equal(slot.setPredicate, 'pillar', 'slot.setPredicate must freeze the relation predicate')

  const canonical = slot.answerAuthority.canonicalValues
  assert.equal(canonical.length, 2, 'Exactly the 2 explicit members must be canonical answers')
  assert.ok(canonical.some(v => v.includes('fe islámica')), 'Shahada must be in canonical')
  assert.ok(canonical.some(v => v.includes('cinco veces')), 'Salat must be in canonical')
  assert.ok(!canonical.some(v => v.includes('antropológico')), 'Off-stem truth must NOT be in canonical')

  // Authored question prompt stem must state predicate ("pilares")
  const authored = authorSlotQuestionWithDiagnostics('exam-ms-truth', bp, slot, { type: 'multi_select' })
  assert.ok(authored.question)
  assert.ok(authored.question.prompt.toLowerCase().includes('pilares'), 'Multi-select prompt stem must explicitly state predicate "pilares"')

  console.log('Contract G PASS: Single predicate enforced; prompt stem bound to predicate; off-stem truths excluded')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT H: MULTI_SELECT GENERIC DEPENDENCY
// ─────────────────────────────────────────────────────────────────────────────
function testContractHMultiSelectGenericDependency() {
  console.log('Contract H: Testing shared generic dependsOn without coherent set predicate...')

  const focal = makeItem('generic_focal', 'mat-1', 1, 'concept', 'Idea General', 'Una idea abstracta sin conjunto definido.')
  const d1 = makeItem('dep1', 'mat-1', 1, 'concept', 'Dato 1', 'Un dato auxiliar sin relación de conjunto.')
  const d2 = makeItem('dep2', 'mat-1', 1, 'concept', 'Dato 2', 'Otro dato auxiliar sin relación de conjunto.')

  const relations = [
    { id: 'rg1', fromSourceItemId: 'dep1', toSourceItemId: 'generic_focal', type: 'dependsOn' },
    { id: 'rg2', fromSourceItemId: 'dep2', toSourceItemId: 'generic_focal', type: 'dependsOn' },
  ]
  const universe = makeUniverse([focal, d1, d2], relations)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-ms-generic', 'seed-ms-g')
  assert.equal(bp.typeDistribution.multi_select, 0, 'Generic dependsOn without set semantics must NOT produce multi_select')

  // Even when focal has set-like keywords (e.g. "Sistema", "Modelo", "Estructura"), dependsOn is NEVER set membership
  const focalKeywords = makeItem('kw_focal', 'mat-1', 1, 'concept', 'Sistema y Modelo Atómico', 'Estructura general del modelo.')
  const relKw = [
    { id: 'rkw1', fromSourceItemId: 'dep1', toSourceItemId: 'kw_focal', type: 'dependsOn' },
    { id: 'rkw2', fromSourceItemId: 'dep2', toSourceItemId: 'kw_focal', type: 'dependsOn' },
  ]
  const uKw = makeUniverse([focalKeywords, d1, d2], relKw)
  const bpKw = composeEnjoyerExamBlueprint(uKw, 30, 'exam-ms-kw', 'seed-kw')
  assert.equal(bpKw.typeDistribution.multi_select, 0, 'dependsOn with keyword heuristic MUST NOT produce multi_select')

  console.log('Contract H PASS: Generic dependsOn unconditionally rejected for multi_select')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT I: MULTI_SELECT HINT ONLY
// ─────────────────────────────────────────────────────────────────────────────
function testContractIMultiSelectHintOnly() {
  console.log('Contract I: Testing multi_select hints without coherent set...')

  const items = [
    makeItem('ms1', 'mat-1', 1, 'concept', 'Item MS 1', 'Texto del item 1.', ['multi_select']),
    makeItem('ms2', 'mat-1', 1, 'concept', 'Item MS 2', 'Texto del item 2.', ['multi_select']),
    makeItem('ms3', 'mat-1', 1, 'concept', 'Item MS 3', 'Texto del item 3.', ['multi_select']),
  ]
  const universe = makeUniverse(items, [])
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-ms-hints', 'seed-ms-h')
  assert.equal(bp.typeDistribution.multi_select, 0, 'Multi-select hints without explicit set must NOT produce multi_select')

  console.log('Contract I PASS: Hint-only multi_select without set semantics is ineligible')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT J: MULTI_SELECT POSITION ORDER (PRIVATE SHUFFLE)
// ─────────────────────────────────────────────────────────────────────────────
function testContractJMultiSelectPositionOrder() {
  console.log('Contract J: Testing private shuffle eliminates positional authority leak...')

  const focal = makeItem('focal_postulates', 'mat-1', 1, 'entity', 'Modelo Atómico de Bohr', 'Postulados atómicos fundamentales.')
  const p1 = makeItem('post_1', 'mat-1', 1, 'concept', 'Postulado de Órbitas Estacionarias', 'Los electrones giran en órbitas discretas sin radiar energía.')
  const p2 = makeItem('post_2', 'mat-1', 1, 'concept', 'Postulado de Saltos Cuánticos', 'La radiación se emite únicamente durante transiciones entre niveles.')
  const d1 = makeItem('dist_1', 'mat-1', 1, 'concept', 'Modelo de Thomson', 'Cargas en esfera uniforme.')
  const d2 = makeItem('dist_2', 'mat-1', 1, 'concept', 'Modelo de Rutherford', 'Núcleo denso con electrones inestables.')

  const relations = [
    { id: 'rp1', fromSourceItemId: 'post_1', toSourceItemId: 'focal_postulates', type: 'postulate' },
    { id: 'rp2', fromSourceItemId: 'post_2', toSourceItemId: 'focal_postulates', type: 'postulate' },
  ]
  const universe = makeUniverse([focal, p1, p2, d1, d2], relations)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-ms-pos', 'seed-ms-pos')
  const slot = bp.slots.find(s => s.type === 'multi_select')!
  assert.ok(slot, 'Multi-select slot must exist')

  const authored = authorSlotQuestionWithDiagnostics('exam-ms-pos', bp, slot, {
    type: 'multi_select',
    prompt: 'Selecciona los postulados de Bohr.',
  })
  assert.ok(authored.question, authored.rejectionReason)
  const q = authored.question
  const options = q.options || []
  const correctAnswers = q.correctAnswers || []

  assert.ok(options.length >= 3, `Must have >= 3 options (got ${options.length})`)
  assert.equal(correctAnswers.length, 2, 'Must have 2 correct answers')

  // Verify that correct answers accurately point to the canonical texts in options
  const canonicalTexts = slot.answerAuthority.canonicalValues
  for (let cIdx = 0; cIdx < canonicalTexts.length; cIdx++) {
    const expectedOptIdx = correctAnswers[cIdx]
    assert.equal(options[expectedOptIdx], canonicalTexts[cIdx], `correctAnswers[${cIdx}] must index canonical value`)
  }

  // Across different examId/slot seeds, verify positions are not systematically [0, 1]
  const seeds = ['alpha-1', 'beta-2', 'gamma-3', 'delta-4', 'epsilon-5']
  const firstIndices = seeds.map(s => {
    const a = authorSlotQuestionWithDiagnostics(s, bp, slot, { type: 'multi_select' })
    return a.question?.correctAnswers?.[0]
  })
  const uniquePositions = new Set(firstIndices)
  assert.ok(uniquePositions.size > 1, 'Options must be privately shuffled across different seeds')

  console.log('Contract J PASS: Multi-select options privately shuffled; criterion correspondence preserved')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT K: REOPEN DETERMINISM
// ─────────────────────────────────────────────────────────────────────────────
async function testContractKReopen() {
  console.log('Contract K: Testing frozen multi-select persistence and reopen idempotency...')

  let storage = new Map<string, any>()
  const oldFetch = globalThis.fetch
  const oldApi = process.env.STUDYAL_API_URL
  process.env.STUDYAL_API_URL = 'https://offline.invalid'
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body))
    storage.set(body.id, {
      id: body.id,
      material_id: body.id,
      enfoque: 'exam',
      result_type: body.resultType,
      payload: body.payload,
      content_hash: body.revision,
    })
    return Response.json({ ok: true, applied: true })
  }
  try {
    const getMaterialResult = async (id: string) => storage.get(id) || null
    const store = new WorkerExamGenerationStore({ getMaterialResult })

  const focal = makeItem('focal_k', 'mat-1', 1, 'entity', 'Pilares Académicos', 'Estructura principal.')
  const m1 = makeItem('m1_k', 'mat-1', 1, 'concept', 'Pilar Uno', 'Primer elemento estructural.')
  const m2 = makeItem('m2_k', 'mat-1', 1, 'concept', 'Pilar Dos', 'Segundo elemento estructural.')
  const d1 = makeItem('d1_k', 'mat-1', 1, 'concept', 'Distractor Uno', 'Elemento externo a la estructura.')
  const d2 = makeItem('d2_k', 'mat-1', 1, 'concept', 'Distractor Dos', 'Otro elemento externo.')

  const relations = [
    { id: 'rk1', fromSourceItemId: 'm1_k', toSourceItemId: 'focal_k', type: 'pillar' },
    { id: 'rk2', fromSourceItemId: 'm2_k', toSourceItemId: 'focal_k', type: 'pillar' },
  ]
  const universe = makeUniverse([focal, m1, m2, d1, d2], relations)
  const examId = 'exam-ms-reopen'
  const bp = composeEnjoyerExamBlueprint(universe, 30, examId, 'seed-k')
  const slot = bp.slots.find(s => s.type === 'multi_select')!
  assert.ok(slot, 'Multi-select slot must exist')

  const authored = authorSlotQuestionWithDiagnostics(examId, bp, slot, { type: 'multi_select' })
  assert.ok(authored.question, authored.rejectionReason)
  const originalQ = authored.question!

  const identity = examGenerationIdentity('session-k', 'fp-quality-test', examId)
  const manifest: ExamGenerationManifest = {
    schemaVersion: 2,
    identity,
    examId,
    fingerprint: 'fp-quality-test',
    sessionId: 'session-k',
    blueprint: bp,
    totalSlots: 1,
    status: 'ready',
    slots: { [slot.id]: { status: 'ready', attempts: 1 } },
    providerAttemptsBudget: 5,
    providerAttemptsUsed: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await store.saveManifest(identity, manifest)
  await store.saveArtifact(identity, {
    examId,
    fingerprint: 'fp-quality-test',
    meta: { status: 'ready', generatedAt: new Date().toISOString() },
    questions: [originalQ],
  })

  // Reopen from store
  const reopenedArtifact = await store.getArtifact(identity)
  assert.ok(reopenedArtifact && reopenedArtifact.questions.length === 1)
  const reopenedQ = reopenedArtifact.questions[0]

  assert.equal(reopenedQ.id, originalQ.id)
  assert.deepEqual(reopenedQ.options, originalQ.options, 'Option order must be identical on reopen')
  assert.deepEqual(reopenedQ.correctAnswers, originalQ.correctAnswers, 'Private correctAnswers must be identical on reopen')

    console.log('Contract K PASS: Frozen multi-select perfectly preserved on reopen (0 regeneration)')
  } finally {
    process.env.STUDYAL_API_URL = oldApi
    globalThis.fetch = oldFetch
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT L: GRADING EVALUATION
// ─────────────────────────────────────────────────────────────────────────────
function testContractLGrading() {
  console.log('Contract L: Testing production grading invocation, exact-set semantics, and public DTO non-leakage...')

  const question = {
    id: 'q_grading',
    type: 'multi_select' as const,
    prompt: 'Selecciona las opciones correctas.',
    options: ['Distractor A', 'Correct Option 1', 'Distractor B', 'Correct Option 2'],
    correctAnswers: [1, 3], // Option 1 and Option 3 are correct
    assessmentCriteria: [
      { criterionId: 'c1', componentIndex: 0, points: 6, gradingMode: 'deterministic' as const },
      { criterionId: 'c2', componentIndex: 1, points: 6, gradingMode: 'deterministic' as const },
    ],
  }

  // 1. Exact selected correct set -> 100% score on both criteria via production helpers
  const exactAnswer = [1, 3]
  assert.equal(gradeObjectiveQuestion(question as any, exactAnswer), true, 'gradeObjectiveQuestion must return true for exact selection')
  for (const criterion of question.assessmentCriteria) {
    const res = gradeDeterministicCriterion(question as any, criterion as any, exactAnswer, true)
    assert.equal(res.scorePercent, 100, 'Exact correct answer must yield 100% score')
    assert.equal(res.status, 'correct', 'Exact correct answer must yield status correct')
  }

  // 2. Extra wrong selection -> 0% score (fails exact-set policy)
  const extraAnswer = [1, 3, 0]
  assert.equal(gradeObjectiveQuestion(question as any, extraAnswer), false, 'gradeObjectiveQuestion must return false for extra selection')
  for (const criterion of question.assessmentCriteria) {
    const res = gradeDeterministicCriterion(question as any, criterion as any, extraAnswer, true)
    assert.equal(res.scorePercent, 0, 'Extra wrong selection must yield 0% score')
    assert.equal(res.status, 'incorrect', 'Extra wrong selection must yield status incorrect')
  }

  // 3. Partial selection -> 0% score
  const partialAnswer = [1]
  assert.equal(gradeObjectiveQuestion(question as any, partialAnswer), false, 'gradeObjectiveQuestion must return false for partial selection')
  const resPart = gradeDeterministicCriterion(question as any, question.assessmentCriteria[0] as any, partialAnswer, true)
  assert.equal(resPart.scorePercent, 0, 'Partial selection must yield 0% score')
  assert.equal(resPart.status, 'incorrect')

  // 4. Matching question evaluation via production helpers
  const matchingQ = {
    id: 'q_matching',
    type: 'matching' as const,
    prompt: 'Empareja los términos.',
    matchingLeftTexts: ['A', 'B', 'C'],
    matchingRightTexts: ['Beta', 'Gamma', 'Alfa'],
    matchingCorrectMap: { 0: 2, 1: 0, 2: 1 },
    assessmentCriteria: [
      { criterionId: 'cm1', componentIndex: 0, points: 5, gradingMode: 'deterministic' as const },
      { criterionId: 'cm2', componentIndex: 1, points: 5, gradingMode: 'deterministic' as const },
    ],
  }
  const matchingExactAns = { 0: 2, 1: 0, 2: 1 }
  assert.equal(gradeObjectiveQuestion(matchingQ as any, matchingExactAns), true, 'gradeObjectiveQuestion must return true for exact matching')
  const resMatch0 = gradeDeterministicCriterion(matchingQ as any, matchingQ.assessmentCriteria[0] as any, matchingExactAns, true)
  assert.equal(resMatch0.scorePercent, 100)
  assert.equal(resMatch0.status, 'correct')

  const matchingWrongAns = { 0: 1, 1: 0, 2: 1 }
  assert.equal(gradeObjectiveQuestion(matchingQ as any, matchingWrongAns), false, 'gradeObjectiveQuestion must return false for wrong matching')
  const resMatchWrong = gradeDeterministicCriterion(matchingQ as any, matchingQ.assessmentCriteria[0] as any, matchingWrongAns, true)
  assert.equal(resMatchWrong.scorePercent, 0)
  assert.equal(resMatchWrong.status, 'incorrect')

  // 5. Public DTO verification
  const pub = toPublicExamQuestion(question as any)
  assert.equal((pub as any).correctAnswers, undefined, 'correctAnswers must be stripped from public question')
  assert.equal((pub as any).assessmentCriteria, undefined, 'assessmentCriteria must be stripped from public question')
  assert.ok(pub.options && pub.options.length === 4, 'Public question retains presentation options')

  const pubMatch = toPublicExamQuestion(matchingQ as any)
  assert.equal((pubMatch as any).matchingCorrectMap, undefined, 'matchingCorrectMap must be stripped from public question')
  assert.equal((pubMatch as any).pairs, undefined, 'pairs must be stripped from public question')
  assert.ok(pubMatch.matchingLeftTexts && pubMatch.matchingLeftTexts.length === 3, 'matchingLeftTexts preserved in public question')
  assert.ok(pubMatch.matchingRightTexts && pubMatch.matchingRightTexts.length === 3, 'matchingRightTexts preserved in public question')

  console.log('Contract L PASS: Production grading invocation certified; exact-set semantics verified; no authority leaks to public DTO')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT M: FILL SEMANTIC CLASS — PERSON DOMAIN (Person vs Place/Venue)
// ─────────────────────────────────────────────────────────────────────────────
function testContractMFillPersonVsTeam() {
  console.log('Contract M: Person domain (Michael Vick / Matt Ryan = compatible, Michael Vick / Mercedes-Benz Stadium = incompatible)...')

  // Canonical: person name
  assert.equal(fillBlankSemanticClass('Michael Vick'), 'person')
  assert.equal(fillBlankSemanticClass('Deion Sanders'), 'person')
  assert.equal(fillBlankSemanticClass('Matt Ryan'), 'person')
  assert.equal(fillBlankSemanticClass('Julio Jones'), 'person')

  // Stadium/venue must NOT classify as person
  assert.equal(fillBlankSemanticClass('Mercedes-Benz Stadium'), 'place')
  assert.equal(fillBlankSemanticClass('Atlanta Falcons'), 'organization')

  // Compatibility: person canonical + place/org distractor = rejected
  assert.equal(fillBlankDistractorCompatible('Michael Vick', 'Mercedes-Benz Stadium'), false,
    'Stadium/place distractor must be rejected for person canonical')
  assert.equal(fillBlankDistractorCompatible('Michael Vick', 'Atlanta Falcons'), false,
    'Team/org distractor must be rejected for person canonical')
  assert.equal(fillBlankDistractorCompatible('Michael Vick', 'Matt Ryan'), true,
    'Person distractor must be accepted for person canonical')
  assert.equal(fillBlankDistractorCompatible('Michael Vick', 'Deion Sanders'), true,
    'Person distractor must be accepted for person canonical')

  console.log('Contract M PASS: Person domain correctly enforces person-to-person compatibility and rejects venues/organizations.')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT N: FILL SEMANTIC CLASS — EVENT DOMAIN (Event vs Organization)
// ─────────────────────────────────────────────────────────────────────────────
function testContractNFillEventVsTeam() {
  console.log('Contract N: Event domain (Super Bowl LI / Super Bowl LII = compatible, Super Bowl LI / Atlanta Falcons = incompatible)...')

  assert.equal(fillBlankSemanticClass('Super Bowl LI'), 'event')
  assert.equal(fillBlankSemanticClass('Super Bowl LII'), 'event')
  assert.equal(fillBlankSemanticClass('Super Bowl L'), 'event')
  assert.equal(fillBlankSemanticClass('Super Bowl XLIX'), 'event')

  // Organization names are not events
  assert.equal(fillBlankSemanticClass('Atlanta Falcons'), 'organization')

  // Event canonical + org distractor = rejected
  assert.equal(fillBlankDistractorCompatible('Super Bowl LI', 'Atlanta Falcons'), false,
    'Team/org distractor must be rejected for event canonical')

  // Event canonical + other event distractor = accepted
  assert.equal(fillBlankDistractorCompatible('Super Bowl LI', 'Super Bowl LII'), true,
    'Same-class event distractor must be accepted')
  assert.equal(fillBlankDistractorCompatible('Super Bowl LI', 'Super Bowl XLIX'), true,
    'Same-class event distractor must be accepted')

  console.log('Contract N PASS: Event domain rejects organization distractors, accepts event distractors.')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT O: FILL SEMANTIC CLASS — DATES DOMAIN (Date vs Person)
// ─────────────────────────────────────────────────────────────────────────────
function testContractOFillYearVsNonYear() {
  console.log('Contract O: Dates domain (1913 / 1922 = compatible, 1913 / Niels Bohr = incompatible)...')

  assert.equal(fillBlankSemanticClass('1913'), 'year')
  assert.equal(fillBlankSemanticClass('1922'), 'year')
  assert.equal(fillBlankSemanticClass('1965'), 'year')

  // Person/place/event names rejected for year canonical
  assert.equal(fillBlankDistractorCompatible('1913', 'Niels Bohr'), false,
    'Person name (Niels Bohr) rejected for year canonical (1913)')
  assert.equal(fillBlankDistractorCompatible('1965', 'Atlanta'), false,
    'City name rejected for year canonical')
  assert.equal(fillBlankDistractorCompatible('1965', 'Michael Vick'), false,
    'Person name rejected for year canonical')
  assert.equal(fillBlankDistractorCompatible('1965', 'Super Bowl'), false,
    'Event name rejected for year canonical')

  // Year-class distractors accepted for year canonical
  assert.equal(fillBlankDistractorCompatible('1913', '1922'), true,
    'Year distractor (1922) accepted for year canonical (1913)')
  assert.equal(fillBlankDistractorCompatible('1965', '1966'), true, 'Year distractor accepted for year canonical')
  assert.equal(fillBlankDistractorCompatible('1965', '1964'), true, 'Year distractor accepted for year canonical')

  console.log('Contract O PASS: Dates domain rejects people, places, and events for year canonicals.')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT P: FILL SEMANTIC CLASS — CHEMISTRY DOMAIN (Formula vs Process)
// ─────────────────────────────────────────────────────────────────────────────
function testContractPFillFormulaVsProse() {
  console.log('Contract P: Chemistry domain (H2O / CO2 = compatible, H2O / photosynthesis = incompatible)...')

  assert.equal(fillBlankSemanticClass('H2O'), 'formula')
  assert.equal(fillBlankSemanticClass('CO2'), 'formula')
  assert.equal(fillBlankSemanticClass('NaCl'), 'formula')
  assert.equal(fillBlankSemanticClass('E=mc2'), 'formula')
  assert.equal(fillBlankSemanticClass('F=ma'), 'formula')
  assert.equal(fillBlankSemanticClass('En=-13.6/n^2'), 'formula')

  // Processes are not formulas
  assert.equal(fillBlankSemanticClass('photosynthesis'), 'process')
  assert.equal(fillBlankSemanticClass('fotosíntesis'), 'process')
  assert.equal(fillBlankSemanticClass('respiración celular'), 'process')

  // Chemistry: H2O / CO2 = compatible, H2O / photosynthesis = incompatible
  assert.equal(fillBlankDistractorCompatible('H2O', 'CO2'), true,
    'H2O / CO2 = compatible where the blank expects a chemical formula')
  assert.equal(fillBlankDistractorCompatible('H2O', 'photosynthesis'), false,
    'H2O / photosynthesis = incompatible')

  // Generic identifiers are NOT formulas
  assert.equal(fillBlankSemanticClass('d1'), 'term')
  assert.equal(fillBlankSemanticClass('d2'), 'term')
  assert.equal(fillBlankSemanticClass('item1'), 'term')
  assert.equal(fillBlankSemanticClass('x2'), 'term')

  // Formula canonical + prose concept distractor = rejected
  assert.equal(fillBlankDistractorCompatible('E=mc2', 'relatividad'), false,
    'Prose concept rejected for formula canonical')
  assert.equal(fillBlankDistractorCompatible('H2O', 'energía cinética'), false,
    'Prose concept rejected for formula canonical')

  // Formula canonical + formula distractor = accepted
  assert.equal(fillBlankDistractorCompatible('E=mc2', 'E=hf'), true,
    'Formula distractor accepted for formula canonical')

  console.log('Contract P PASS: Chemistry formulas enforce same-class compatibility, reject biological processes and generic prose.')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT V: FILL SEMANTIC CLASS — HISTORY DOMAIN (Person vs Event)
// ─────────────────────────────────────────────────────────────────────────────
function testContractVFillHistoryPersonVsEvent() {
  console.log('Contract V: History domain (Napoleon / Julius Caesar = compatible, Napoleon / Battle of Waterloo = incompatible)...')

  assert.equal(fillBlankSemanticClass('Napoleon'), 'person')
  assert.equal(fillBlankSemanticClass('Julius Caesar'), 'person')
  assert.equal(fillBlankSemanticClass('Battle of Waterloo'), 'event')

  assert.equal(fillBlankDistractorCompatible('Napoleon', 'Julius Caesar'), true,
    'Napoleon / Julius Caesar = compatible')
  assert.equal(fillBlankDistractorCompatible('Napoleon', 'Battle of Waterloo'), false,
    'Napoleon / Battle of Waterloo = incompatible')

  console.log('Contract V PASS: History domain rejects event distractors for person blanks.')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT W: FILL SEMANTIC CLASS — SCIENCE / BIOLOGY DOMAIN (Structure vs Person / Process)
// ─────────────────────────────────────────────────────────────────────────────
function testContractWFillScienceStructureVsOthers() {
  console.log('Contract W: Science domain (mitochondria / nucleus = compatible, mitochondria / Albert Einstein = incompatible)...')

  assert.equal(fillBlankSemanticClass('mitochondria'), 'structure')
  assert.equal(fillBlankSemanticClass('nucleus'), 'structure')
  assert.equal(fillBlankSemanticClass('Albert Einstein'), 'person')
  assert.equal(fillBlankSemanticClass('photosynthesis'), 'process')

  assert.equal(fillBlankDistractorCompatible('mitochondria', 'nucleus'), true,
    'mitochondria / nucleus = compatible when the blank expects an organelle')
  assert.equal(fillBlankDistractorCompatible('mitochondria', 'Albert Einstein'), false,
    'mitochondria / Albert Einstein = incompatible')
  assert.equal(fillBlankDistractorCompatible('mitochondria', 'photosynthesis'), false,
    'mitochondria / photosynthesis = incompatible')

  console.log('Contract W PASS: Science domain preserves organelle homogeneity, rejecting people and processes.')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT Q: FILL SEMANTIC CLASS — only 2 same-class distractors remain → fill ineligible
// ─────────────────────────────────────────────────────────────────────────────
function testContractQFillInsufficientAfterClassFilter() {
  console.log('Contract Q: After semantic class filtering, <3 distractors remain → fill ineligible...')

  const items = [
    makeItem('fb_person', 'mat-1', 1, 'entity', 'Matt Ryan',
      'Matt Ryan es el mariscal de campo de los Falcons de Atlanta.', ['fill_blank'], 'remember'),
    makeItem('fb2', 'mat-1', 1, 'entity', 'Deion Sanders', 'Deion Sanders es un jugador.', ['fill_blank'], 'remember'),
    makeItem('fb3', 'mat-1', 1, 'entity', 'Julio Jones', 'Julio Jones es un receptor.', ['fill_blank'], 'remember'),
  ]
  const universe = makeUniverse(items)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-class-filter', 'seed-cf')
  const slot = bp.slots.find(s => s.type === 'fill_blank' && (s.answerAuthority as any).canonicalValue === 'Matt Ryan')

  if (!slot) {
    console.log('Contract Q PASS: fill_blank not composed when same-class distractors insufficient.')
    return
  }

  // Try authoring with only team names as distractors (should be rejected)
  const authored = authorSlotQuestionWithDiagnostics('exam-class-filter', bp, slot, {
    type: 'fill_blank',
    prompt: '___ es el mariscal de campo.',
    distractors: ['Atlanta Falcons', 'New England Patriots', 'Dallas Cowboys'],
    wordBank: ['Atlanta Falcons', 'New England Patriots', 'Dallas Cowboys'],
  })
  // All 3 are teams, canonical is a person → all 3 rejected → INSUFFICIENT_DISTRACTORS
  assert.equal(authored.question, null, 'Must reject authoring when all distractors are wrong semantic class')
  assert.ok(authored.rejectionReason?.includes('INSUFFICIENT_DISTRACTORS'),
    `Rejection must be INSUFFICIENT_DISTRACTORS, got: ${authored.rejectionReason}`)

  console.log('Contract Q PASS: Insufficient same-class distractors after filtering → fill ineligible.')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT R: FILL SEMANTIC CLASS — valid same-class 5-option bank accepted
// ─────────────────────────────────────────────────────────────────────────────
function testContractRFillValidSameClassBank() {
  console.log('Contract R: Valid same-class 5-option fill bank accepted...')

  const items = [
    makeItem('fb_bowl', 'mat-1', 1, 'entity', 'Super Bowl LI',
      'El Super Bowl LI fue el campeonato de la temporada 2016 de la NFL.', ['fill_blank'], 'remember'),
    makeItem('fb2', 'mat-1', 1, 'entity', 'Super Bowl LII', 'El Super Bowl LII fue en 2018.', ['fill_blank'], 'remember'),
    makeItem('fb3', 'mat-1', 1, 'entity', 'Super Bowl L', 'El Super Bowl L fue en 2016.', ['fill_blank'], 'remember'),
    makeItem('fb4', 'mat-1', 1, 'entity', 'Super Bowl XLIX', 'El Super Bowl XLIX fue en 2015.', ['fill_blank'], 'remember'),
  ]
  const universe = makeUniverse(items)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-class-valid', 'seed-cv')
  const slot = bp.slots.find(s => s.type === 'fill_blank')
  if (!slot) {
    console.log('Contract R PASS: (fill_blank not composed from this universe — ok)')
    return
  }

  // Author with all event-class distractors (should succeed)
  const authored = authorSlotQuestionWithDiagnostics('exam-class-valid', bp, slot, {
    type: 'fill_blank',
    prompt: 'El ___ fue el campeonato de la temporada 2016 de la NFL.',
    distractors: ['Super Bowl LII', 'Super Bowl L', 'Super Bowl XLIX'],
    wordBank: ['Super Bowl LII', 'Super Bowl L', 'Super Bowl XLIX'],
  })
  assert.ok(authored.question, `Valid same-class bank must be accepted, got: ${authored.rejectionReason}`)
  const bank = authored.question.wordBank || []
  assert.ok(bank.length >= 4 && bank.length <= 5, `Bank must have 4-5 entries, got ${bank.length}`)
  for (const item of bank) {
    const cls = fillBlankSemanticClass(item)
    assert.equal(cls, 'event', `Bank item "${item}" must be event-class, got ${cls}`)
  }

  console.log('Contract R PASS: Valid same-class event bank (4-5 entries) accepted correctly.')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT S: QUESTION COMPLETENESS — CROSS-DOMAIN UNAMBIGUOUS EVIDENCE COMMUNICATED
// ─────────────────────────────────────────────────────────────────────────────
function testContractSShortAnswerBroadStemRejected() {
  console.log('Contract S: Cross-domain question completeness: generic unanchored stems rejected for narrow criteria...')

  // 1. History Domain: narrow fact (birth date/place)
  const historySlot: any = {
    type: 'short_answer',
    cognitiveOperation: 'retrieve',
    assessmentCriteria: [{
      canonicalCriterion: 'Napoleón nació en Ajaccio, Córcega, en 1769.',
      gradingMode: 'deterministic',
    }],
  }
  assert.equal(shortAnswerStemIsSpecific(historySlot, '¿Qué información clave se proporciona sobre Napoleón en el material de estudio?'), false,
    'History: generic "qué información sobre" must be rejected')
  assert.equal(shortAnswerStemIsSpecific(historySlot, 'Describe a Napoleón.'), false,
    'History: generic "Describe X" must be rejected')
  assert.equal(shortAnswerStemIsSpecific(historySlot, '¿Cuándo y dónde nació Napoleón Bonaparte?'), true,
    'History: prompt with cuándo/dónde inquiry axes must be accepted')

  // 2. Biology / Science Domain: narrow fact (organelle function)
  const bioSlot: any = {
    type: 'short_answer',
    cognitiveOperation: 'retrieve',
    assessmentCriteria: [{
      canonicalCriterion: 'La mitocondria genera la mayor parte del ATP celular mediante la fosforilación oxidativa.',
      gradingMode: 'deterministic',
    }],
  }
  assert.equal(shortAnswerStemIsSpecific(bioSlot, '¿Qué información se proporciona sobre las mitocondrias?'), false,
    'Biology: generic "qué información sobre" must be rejected')
  assert.equal(shortAnswerStemIsSpecific(bioSlot, '¿Cuál es la función principal de las mitocondrias en la respiración celular?'), true,
    'Biology: prompt with function/role inquiry axis must be accepted')

  // 3. Sports Domain: narrow fact (foundation date/place)
  const sportsSlot: any = {
    type: 'short_answer',
    cognitiveOperation: 'retrieve',
    assessmentCriteria: [{
      canonicalCriterion: 'Los Atlanta Falcons son una franquicia fundada en 1965 en Atlanta.',
      gradingMode: 'deterministic',
    }],
  }
  assert.equal(shortAnswerStemIsSpecific(sportsSlot, '¿Qué información clave se proporciona sobre los Atlanta Falcons en el material de estudio?'), false,
    'Sports: generic "qué información sobre" must be rejected')
  assert.equal(shortAnswerStemIsSpecific(sportsSlot, '¿Cuándo y dónde fueron fundados los Atlanta Falcons?'), true,
    'Sports: prompt with cuándo/dónde inquiry axes must be accepted')

  console.log('Contract S PASS: Cross-domain question completeness verified across History, Biology, and Sports without domain hardcoding.')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT T: QUESTION COMPLETENESS — UNIVERSAL INQUIRY AXES ACCEPTED
// ─────────────────────────────────────────────────────────────────────────────
function testContractTShortAnswerSpecificStemAccepted() {
  console.log('Contract T: Universal interrogative inquiry axes uniquely communicate requested evidence...')

  const narrowSlot: any = {
    type: 'short_answer',
    cognitiveOperation: 'retrieve',
    assessmentCriteria: [{
      canonicalCriterion: 'Dato específico puntual.',
      gradingMode: 'deterministic',
    }],
  }

  // Temporal inquiry axis
  assert.equal(shortAnswerStemIsSpecific(narrowSlot, '¿En qué año ocurrió el descubrimiento?'), true)
  assert.equal(shortAnswerStemIsSpecific(narrowSlot, 'When was the treaty signed?'), true)

  // Spatial/location inquiry axis
  assert.equal(shortAnswerStemIsSpecific(narrowSlot, '¿Dónde se encuentra la sede principal?'), true)
  assert.equal(shortAnswerStemIsSpecific(narrowSlot, 'Where does cellular respiration take place?'), true)

  // Identity/entity inquiry axis
  assert.equal(shortAnswerStemIsSpecific(narrowSlot, '¿Quién propuso la teoría de la relatividad?'), true)
  assert.equal(shortAnswerStemIsSpecific(narrowSlot, 'Who discovered penicillin?'), true)

  // Function/role inquiry axis
  assert.equal(shortAnswerStemIsSpecific(narrowSlot, '¿Cuál es la función del ribosoma?'), true)
  assert.equal(shortAnswerStemIsSpecific(narrowSlot, 'What is the function of the cell wall?'), true)

  // Mechanism/cause inquiry axis
  assert.equal(shortAnswerStemIsSpecific(narrowSlot, '¿Por qué ocurre la mitosis en las células somáticas?'), true)
  assert.equal(shortAnswerStemIsSpecific(narrowSlot, 'How does enzyme inhibition work?'), true)

  console.log('Contract T PASS: Universal inquiry axes universally communicate specific evidence across all disciplines.')
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT U: SHORT ANSWER STEM — genuinely broad explanatory criterion allows open question
// ─────────────────────────────────────────────────────────────────────────────
function testContractUShortAnswerBroadCriterionAllowsBroadStem() {
  console.log('Contract U: Genuinely broad explanatory criterion → broad stem allowed...')

  const broadExplainSlot: any = {
    id: 'slot-sa-explain',
    type: 'short_answer',
    cognitiveOperation: 'explain',
    skill: 'explanation',
    difficulty: 'medium',
    assessmentFocus: 'impacto de la relatividad',
    assessmentCriteria: [{
      criterionId: 'crit-sa-explain',
      targetIds: ['t1'],
      operation: 'explain',
      // Long canonical (>= 8 words) with explain operation → exempt from narrow stem rule
      canonicalCriterion: 'La teoría de la relatividad especial cambió la comprensión del espacio, el tiempo y la energía al demostrar que son interdependientes.',
      gradingMode: 'semantic',
      points: 10,
      skill: 'explanation',
      label: 'Relatividad',
      sourceItemId: 'item-rel',
      pages: [1],
      materialId: 'mat-1',
    }],
    frozenSources: [{ sourceItemId: 'item-rel', label: 'Relatividad', content: 'La teoría de la relatividad de Einstein.', materialId: 'mat-1', pages: [1], sourceSpans: [] }],
    answerAuthority: { kind: 'single_text', canonicalValue: 'espacio, tiempo y energía interdependientes', distractorPool: [] },
    assessedTargetIds: ['t1'],
    targetIds: ['t1'],
    contextTargetIds: [],
    primaryTargetId: 't1',
    sourceItemIds: ['item-rel'],
    topicId: 'topic-1',
    topicTitle: 'Tema 1',
    order: 0,
    readingBudgetWords: 50,
    estimatedSeconds: 120,
  }

  // Broad explanatory question: allowed when criterion is genuinely explanatory
  const broadExplanatoryQ = 'Explica cómo la teoría de la relatividad especial transformó la comprensión del espacio y el tiempo.'
  assert.equal(shortAnswerStemIsSpecific(broadExplainSlot, broadExplanatoryQ), true,
    'Broad explanatory question must be allowed for genuinely broad explanatory criterion')

  // Even "Describe X" style is ok when criterion is genuinely long/explanatory (exempt)
  const describeQ = 'Describe el impacto de la relatividad.'
  assert.equal(shortAnswerStemIsSpecific(broadExplainSlot, describeQ), true,
    'Describe-style question must be allowed for genuinely explanatory criterion (long canonical, explain op)')

  // Multi-criteria slots are exempt by definition (multi-criterion path handles sub-questions)
  const multiCriteriaSlot: any = {
    ...broadExplainSlot,
    assessmentCriteria: [
      broadExplainSlot.assessmentCriteria[0],
      { ...broadExplainSlot.assessmentCriteria[0], criterionId: 'crit-2', label: 'Part 2' },
    ],
  }
  assert.equal(shortAnswerStemIsSpecific(multiCriteriaSlot, 'Explica X.'), true,
    'Multi-criteria slot is exempt from single-criterion stem rule')

  console.log('Contract U PASS: Genuinely broad explanatory criteria preserve open questions.')
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN TEST RUNNER
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n── RUNNING EXAM INTERACTION ACADEMIC QUALITY ADVERSARIAL CONTRACTS ──\n')

  testContractAFillMetadata()
  testContractBFillDistractors()
  testContractCMatchingGenericRelation()
  testContractDMatchingHintOnly()
  testContractEMatchingValidExplicitAssociation()
  testContractFMatchingAmbiguity()
  testContractGMultiSelectTrueButOffStem()
  testContractHMultiSelectGenericDependency()
  testContractIMultiSelectHintOnly()
  testContractJMultiSelectPositionOrder()
  await testContractKReopen()
  testContractLGrading()
  testContractMFillPersonVsTeam()
  testContractNFillEventVsTeam()
  testContractOFillYearVsNonYear()
  testContractPFillFormulaVsProse()
  testContractVFillHistoryPersonVsEvent()
  testContractWFillScienceStructureVsOthers()
  testContractQFillInsufficientAfterClassFilter()
  testContractRFillValidSameClassBank()
  testContractSShortAnswerBroadStemRejected()
  testContractTShortAnswerSpecificStemAccepted()
  testContractUShortAnswerBroadCriterionAllowsBroadStem()

  console.log('\nALL 23 ACADEMIC QUALITY ADVERSARIAL CONTRACTS PASSED!\n')
}

main().catch(err => {
  console.error('\nADVERSARIAL CONTRACTS FAILED:', err)
  process.exit(1)
})
