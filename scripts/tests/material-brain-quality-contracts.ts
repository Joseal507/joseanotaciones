import assert from 'node:assert/strict'
import { isDocumentBoilerplateText } from '../../lib/materialBrain/academicRole'
import { mergeRichWithFallbackCoverage } from '../../lib/materialBrain/coverageMerge'
import { buildDeterministicFallbackExtraction } from '../../lib/materialBrain/deterministicFallback'
import type { ChunkExtractionResult, RawExtractedUnit } from '../../lib/materialBrain/extraction'
import { mergeExtractions } from '../../lib/materialBrain/merge'
import { buildIdentity } from '../../lib/materialBrain/identity'
import { classifyUnitEligibility } from '../../lib/materialBrain/eligibility'
import type { KnowledgeUnit, PageChunk } from '../../lib/materialBrain/types'
import type { RawExtractedRelation } from '../../lib/materialBrain/extraction'

function chunk(id: string, page: number, text: string): PageChunk {
  return { id, materialId: 'mat-quality', pages: [page], order: page, text, sourceKind: 'text' }
}

function unit(overrides: Partial<RawExtractedUnit> & Pick<RawExtractedUnit, 'kind' | 'canonicalSubject' | 'statement' | 'page'>): RawExtractedUnit {
  return {
    qualifiers: [],
    label: overrides.canonicalSubject,
    quote: overrides.statement,
    domainTags: [],
    modelSuggestedTier: null,
    ...overrides,
  }
}

function extraction(units: RawExtractedUnit[], relations: RawExtractedRelation[] = []): ChunkExtractionResult {
  return { units, relations, warnings: [], droppedInvalidProvenance: 0, droppedStructural: 0 }
}

console.log('Material Brain quality contracts')

{
  const fallback = buildDeterministicFallbackExtraction(chunk(
    'boilerplate',
    1,
    '[Página 1] © 2009 Example Publishing Inc. Todos los derechos reservados. QuickTime™ and a Photo - JPEG decompressor are needed to see this picture.',
  ))
  assert.equal(fallback.units.length, 0, 'repeated copyright/viewer artifacts must not become academic fallback units')
  assert.equal(isDocumentBoilerplateText('La protección del derecho de autor dura setenta años.'), false, 'real taught copyright content must remain eligible')
  console.log('  ✓ boilerplate is rejected without filtering legitimate academic propositions')
}

{
  const richFormula = unit({
    kind: 'formula', canonicalSubject: 'Constante de equilibrio Kc', page: 7,
    statement: 'Kc = ([C]^c * [D]^d) / ([A]^a * [B]^b)',
    expression: 'Kc=([C]^c*[D]^d)/([A]^a*[B]^b)',
  })
  const rawFallback = unit({
    kind: 'fact', canonicalSubject: 'fallback:leaf:0', page: 7,
    statement: 'K c = ([C]^c * [D]^d) / ([A]^a * [B]^b)', origin: 'fallback',
  })
  const merged = mergeRichWithFallbackCoverage(extraction([richFormula]), extraction([rawFallback]))
  assert.deepEqual(merged.units, [richFormula], 'formula-equivalent raw fallback must not survive beside the rich formula')
  console.log('  ✓ rich formula removes semantically equivalent raw fallback')
}

{
  const rich = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 2,
    statement: 'En el equilibrio las velocidades directa e inversa son iguales.',
  })
  const uncovered = unit({
    kind: 'fact', canonicalSubject: 'fallback:leaf:1', page: 2,
    statement: 'Un catalizador acelera por igual las reacciones directa e inversa.', origin: 'fallback',
  })
  const merged = mergeRichWithFallbackCoverage(extraction([rich]), extraction([uncovered]))
  assert.equal(merged.units.length, 2, 'fallback must survive when it is the only representative of relevant content')
  assert.equal(merged.units[1], uncovered)
  console.log('  ✓ uncovered academic fallback remains represented')
}

{
  const first = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 2,
    statement: 'El equilibrio químico es dinámico y mantiene iguales las velocidades directa e inversa.',
  })
  const second = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 36,
    statement: 'Cuando Q es mayor que K, el sistema se desplaza hacia los reactivos.',
  })
  const result = mergeExtractions([
    { chunk: chunk('semantic-a', 2, first.statement), extraction: extraction([first]) },
    { chunk: chunk('semantic-b', 36, second.statement), extraction: extraction([second]) },
  ])
  assert.equal(result.units.length, 2, 'same broad canonical subject must not merge different academic propositions')
  assert.equal(new Set(result.units.map(item => item.id)).size, 2, 'non-equivalent propositions need distinct stable unit IDs')
  assert.deepEqual(result.units.map(item => item.provenance.map(ref => ref.page)), [[2], [36]])
  console.log('  ✓ semantic collision remains separate with precise provenance')
}

{
  const first = unit({
    kind: 'definition', canonicalSubject: 'Principio de conservación de la energía', page: 4,
    statement: 'En un sistema aislado, la energía total permanece constante.', term: 'Conservación de la energía',
  })
  const second = unit({
    kind: 'concept', canonicalSubject: 'Principio de conservación de la energía', page: 9,
    statement: 'En un sistema aislado la energía total permanece constante',
  })
  const result = mergeExtractions([
    { chunk: chunk('equivalent-a', 4, first.statement), extraction: extraction([first]) },
    { chunk: chunk('equivalent-b', 9, second.statement), extraction: extraction([second]) },
  ])
  assert.equal(result.units.length, 1, 'minor punctuation/kind variation may merge the same proposition')
  assert.deepEqual(result.units[0].provenance.map(ref => ref.page), [4, 9], 'equivalent units may union provenance')
  console.log('  ✓ equivalent propositions merge and union provenance')
}

{
  const kc = unit({
    kind: 'formula', canonicalSubject: 'Constante de equilibrio', page: 10,
    statement: 'Kc relaciona concentraciones de equilibrio.', expression: 'Kc=[C]/[A]', variables: [],
  })
  const kp = unit({
    kind: 'formula', canonicalSubject: 'Constante de equilibrio', page: 11,
    statement: 'Kp relaciona presiones parciales de equilibrio.', expression: 'Kp=P(C)/P(A)', variables: [],
  })
  const result = mergeExtractions([
    { chunk: chunk('formula-kc', 10, kc.statement), extraction: extraction([kc]) },
    { chunk: chunk('formula-kp', 11, kp.statement), extraction: extraction([kp]) },
  ])
  assert.equal(result.units.length, 2, 'Kc and Kp must remain distinct even under the same canonical subject')
  assert.deepEqual(result.units.map(item => item.provenance.map(ref => ref.page)), [[10], [11]])
  console.log('  ✓ formula identity distinguishes Kc from Kp')
}

{
  const a = buildIdentity('concept', 'Concepto de equilibrio químico', [])
  const b = buildIdentity('concept', 'Equilibrio químico', [])
  const c = buildIdentity('concept', 'Equilibrio Químico', [])
  assert.equal(a.semanticKey, b.semanticKey, 'generic "Concepto de" wrapper must not fragment the entity')
  assert.equal(b.semanticKey, c.semanticKey, 'capitalization must not fragment the entity')
  console.log('  ✓ cosmetic title/prefix variants normalize to the same entity/topic')
}

{
  // Same entity ("Equilibrio químico"), four DIFFERENT propositions —
  // must consolidate under one entity/topic without collapsing into a
  // single unit (atomicity) and without cosmetic duplicates surviving.
  const definicion = unit({
    kind: 'concept', canonicalSubject: 'Concepto de equilibrio químico', page: 2,
    statement: 'El equilibrio químico es el estado en que las concentraciones permanecen constantes.',
  })
  const igualdadVelocidades = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 3,
    statement: 'En el equilibrio, la velocidad de la reacción directa iguala a la velocidad de la reacción inversa.',
  })
  const estadoDinamico = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio Químico', page: 4,
    statement: 'El equilibrio químico es dinámico: ambas reacciones continúan ocurriendo simultáneamente.',
  })
  const cosmeticDuplicateOfDefinicion = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 2,
    statement: 'El equilibrio químico es el estado en que las concentraciones permanecen constantes',
  })
  const result = mergeExtractions([
    { chunk: chunk('eq-def', 2, definicion.statement), extraction: extraction([definicion, cosmeticDuplicateOfDefinicion]) },
    { chunk: chunk('eq-vel', 3, igualdadVelocidades.statement), extraction: extraction([igualdadVelocidades]) },
    { chunk: chunk('eq-din', 4, estadoDinamico.statement), extraction: extraction([estadoDinamico]) },
  ])
  const sameEntity = result.units.filter(u => u.identity.semanticKey === 'equilibrio quimico')
  assert.equal(sameEntity.length, 3, 'three distinct propositions of the same entity must all survive (atomicity)')
  assert.equal(new Set(sameEntity.map(u => u.id)).size, 3, 'each distinct proposition keeps its own stable id')
  console.log('  ✓ same entity, distinct propositions → consolidated entity, preserved atomicity, cosmetic dup removed')
}

{
  // Relation ambiguity caused PURELY by cosmetic title fragmentation
  // must now resolve — the same entity-normalization fix that
  // consolidates duplicated concepts also lets resolveSubjectWithContext
  // find the single real candidate instead of pooling several
  // cosmetic variants into a false "ambiguous" rejection.
  const target = unit({
    kind: 'concept', canonicalSubject: 'Concepto de equilibrio químico', page: 5,
    statement: 'El equilibrio químico es el estado en que las concentraciones permanecen constantes.',
  })
  const source = unit({
    kind: 'concept', canonicalSubject: 'Constante de equilibrio Kc', page: 6,
    statement: 'Kc se define a partir del equilibrio químico del sistema.',
  })
  const relation: RawExtractedRelation = {
    type: 'depends_on', fromSubject: 'Constante de equilibrio Kc', toSubject: 'Equilibrio químico',
    statement: 'Kc depende de que el sistema esté en equilibrio químico.', quote: source.statement, page: 6,
  }
  const result = mergeExtractions([
    { chunk: chunk('rel-target', 5, target.statement), extraction: extraction([target]) },
    { chunk: chunk('rel-source', 6, source.statement), extraction: extraction([source], [relation]) },
  ])
  assert.equal(result.droppedAmbiguousRelations, 0, 'an unambiguous normalized relation must resolve, not be dropped')
  assert.equal(result.relations.length, 1)
  console.log('  ✓ unambiguous normalized relation resolves once cosmetic title fragmentation is removed')
}

{
  // A relation that is GENUINELY ambiguous (two real, distinct
  // propositions sharing the same entity, neither identifiable from
  // context) must still be rejected rather than guessed.
  const propositionA = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 7,
    statement: 'El equilibrio químico es dinámico.',
  })
  const propositionB = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 8,
    statement: 'El equilibrio químico depende de la temperatura del sistema.',
  })
  const relation: RawExtractedRelation = {
    type: 'depends_on', fromSubject: 'Algo externo', toSubject: 'Equilibrio químico',
    statement: 'Algo externo depende del equilibrio químico, sin más contexto.', page: 9,
  }
  const externalUnit = unit({ kind: 'concept', canonicalSubject: 'Algo externo', page: 9, statement: 'Algo externo es un concepto de prueba.' })
  const result = mergeExtractions([
    { chunk: chunk('amb-a', 7, propositionA.statement), extraction: extraction([propositionA]) },
    { chunk: chunk('amb-b', 8, propositionB.statement), extraction: extraction([propositionB]) },
    { chunk: chunk('amb-ext', 9, externalUnit.statement), extraction: extraction([externalUnit], [relation]) },
  ])
  assert.ok(result.droppedAmbiguousRelations >= 1, 'a genuinely ambiguous relation between two real distinct propositions must be rejected, not guessed')
  console.log('  ✓ genuinely ambiguous relation is rejected rather than invented')
}

{
  const richUnit: KnowledgeUnit = {
    id: 'u1', kind: 'concept',
    identity: { canonicalSubject: 'X', semanticKey: 'x', qualifiers: [] },
    label: 'X', statement: 'X es un concepto central del material.',
    importance: { tier: 'critical', signals: ['declared_in_material'], confidence: 0.9 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: 'X', chunkId: 'c0' }],
    domainTags: [],
  }
  const supportingUnit: KnowledgeUnit = { ...richUnit, id: 'u2', importance: { ...richUnit.importance, tier: 'contextual' } }
  const fallbackUnit: KnowledgeUnit = { ...richUnit, id: 'u3', origin: 'fallback', importance: { ...richUnit.importance, tier: 'critical' } }
  assert.equal(classifyUnitEligibility(richUnit), 'core_academic_unit')
  assert.equal(classifyUnitEligibility(supportingUnit), 'contextual_supporting_unit')
  assert.equal(classifyUnitEligibility(fallbackUnit), 'low_confidence_fallback', 'fallback origin always demotes eligibility regardless of tier')
  console.log('  ✓ downstream eligibility is derived deterministically from existing signals')
}

{
  // Root-cause regression for the live-evidence residual ambiguity
  // ("Equilibrio químico ambiguous among 6 candidates" persisting after
  // the entity-normalization fix): several REAL, genuinely distinct
  // propositions of one entity, none with qualifiers (a proposition
  // being universal rather than instance-bound is exactly why it has
  // none) — qualifier-overlap scoring alone ties every candidate at 0
  // and always rejects. Statement/proposition-token overlap between the
  // relation's own text and each candidate must let a relation that
  // clearly echoes ONE specific proposition resolve to it.
  const definicion = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 2,
    statement: 'El equilibrio químico es el estado en que las concentraciones permanecen constantes.',
  })
  const velocidades = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 3,
    statement: 'En el equilibrio, la velocidad de la reacción directa iguala a la velocidad de la reacción inversa.',
  })
  const dinamico = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 4,
    statement: 'El equilibrio químico es dinámico porque ambas reacciones continúan ocurriendo.',
  })
  const kc = unit({
    kind: 'formula', canonicalSubject: 'Constante de equilibrio Kc', page: 5,
    statement: 'Kc se calcula únicamente cuando el sistema alcanza el equilibrio y las velocidades de reacción directa e inversa se igualan.',
  })
  const relation: RawExtractedRelation = {
    type: 'depends_on', fromSubject: 'Constante de equilibrio Kc', toSubject: 'Equilibrio químico',
    statement: 'Kc solo aplica cuando la velocidad de la reacción directa iguala a la velocidad de la reacción inversa.',
    quote: kc.statement, page: 5,
  }
  const result = mergeExtractions([
    { chunk: chunk('prop-def', 2, definicion.statement), extraction: extraction([definicion]) },
    { chunk: chunk('prop-vel', 3, velocidades.statement), extraction: extraction([velocidades]) },
    { chunk: chunk('prop-din', 4, dinamico.statement), extraction: extraction([dinamico]) },
    { chunk: chunk('prop-kc', 5, kc.statement), extraction: extraction([kc], [relation]) },
  ])
  assert.equal(result.units.length, 4, 'all four distinct real propositions/entities must survive')
  assert.equal(result.droppedAmbiguousRelations, 0, 'proposition-content overlap must resolve the relation to the one candidate it actually echoes')
  assert.equal(result.relations.length, 1)
  const target = result.units.find(u => u.id === result.relations[0].toUnitId)
  assert.equal(target?.statement, velocidades.statement, 'must resolve to the proposition the relation text actually echoes, not an arbitrary same-entity candidate')
  console.log('  ✓ proposition-content overlap disambiguates among several real qualifier-less propositions of one entity')
}

{
  // Live-evidence regression: an ENTITY-level relation ("X part_of
  // Equilibrio químico") whose text does not echo any ONE of the
  // entity's several real propositions. Architecturally, forcing this
  // onto an arbitrarily-picked proposition would assert a specificity
  // the source text never stated. The fix resolves it to the entity's
  // own 'definition' unit (the closest real, non-fabricated proxy for
  // "the topic as a whole") and marks the relation as such — never
  // silently indistinguishable from a precise proposition match.
  const definicion = unit({
    kind: 'definition', canonicalSubject: 'Equilibrio químico', page: 2, term: 'Equilibrio químico',
    statement: 'El equilibrio químico es el estado en que las concentraciones permanecen constantes.',
  })
  const velocidades = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 3,
    statement: 'En el equilibrio, la velocidad de la reacción directa iguala a la velocidad de la reacción inversa.',
  })
  const dinamico = unit({
    kind: 'fact', canonicalSubject: 'Equilibrio químico', page: 4,
    statement: 'El equilibrio químico es dinámico porque ambas reacciones continúan ocurriendo simultáneamente.',
  })
  const condiciones = unit({
    kind: 'fact', canonicalSubject: 'Equilibrio químico', page: 5,
    statement: 'El equilibrio químico depende de la temperatura y la presión del sistema considerado.',
  })
  const catalizador = unit({
    kind: 'concept', canonicalSubject: 'Catalizador', page: 6,
    statement: 'Un catalizador acelera una reacción sin ser consumido en el proceso.',
  })
  const entityLevelRelation: RawExtractedRelation = {
    type: 'part_of', fromSubject: 'Catalizador', toSubject: 'Equilibrio químico',
    statement: 'El uso de catalizadores es parte del estudio general del equilibrio químico en el material.',
    page: 6,
  }
  const result = mergeExtractions([
    { chunk: chunk('ent-def', 2, definicion.statement), extraction: extraction([definicion]) },
    { chunk: chunk('ent-vel', 3, velocidades.statement), extraction: extraction([velocidades]) },
    { chunk: chunk('ent-din', 4, dinamico.statement), extraction: extraction([dinamico]) },
    { chunk: chunk('ent-cond', 5, condiciones.statement), extraction: extraction([condiciones]) },
    { chunk: chunk('ent-cat', 6, catalizador.statement), extraction: extraction([catalizador], [entityLevelRelation]) },
  ])
  assert.equal(result.units.length, 5, 'all five distinct real units must survive (four propositions of one entity + one unrelated concept)')
  assert.equal(result.droppedAmbiguousRelations, 0, 'an entity-level relation must not be discarded merely because the entity has several valid propositions')
  assert.equal(result.relations.length, 1)
  const resolved = result.relations[0]
  assert.equal(resolved.toResolution, 'entity_representative', 'must be explicitly marked as an entity-level resolution, never silently indistinguishable from a precise match')
  const target = result.units.find(u => u.id === resolved.toUnitId)
  assert.equal(target?.kind, 'definition', 'must resolve to the entity\'s own definition unit, the closest real non-fabricated proxy for the topic as a whole')
  console.log('  ✓ entity-level relation resolves to the entity\'s definition unit, explicitly marked, instead of being dropped or guessed')
}

{
  // The entity-representative fallback must NOT fire when the entity
  // itself has more than one candidate of the representative kind
  // (e.g. two real 'definition' units) — that is still genuinely
  // undecidable even at entity granularity.
  const definicionA = unit({ kind: 'definition', canonicalSubject: 'Ósmosis', page: 1, term: 'Ósmosis', statement: 'La ósmosis es el paso de solvente a través de una membrana semipermeable.' })
  const definicionB = unit({ kind: 'definition', canonicalSubject: 'Ósmosis', page: 10, term: 'Ósmosis', statement: 'La ósmosis describe el movimiento neto de agua entre dos soluciones de distinta concentración.' })
  const external = unit({ kind: 'concept', canonicalSubject: 'Presión osmótica', page: 11, statement: 'La presión osmótica se relaciona con el fenómeno general.' })
  const relation: RawExtractedRelation = {
    type: 'depends_on', fromSubject: 'Presión osmótica', toSubject: 'Ósmosis',
    statement: 'La presión osmótica depende del fenómeno general, sin más contexto distintivo.', page: 11,
  }
  const result = mergeExtractions([
    { chunk: chunk('osm-a', 1, definicionA.statement), extraction: extraction([definicionA]) },
    { chunk: chunk('osm-b', 10, definicionB.statement), extraction: extraction([definicionB]) },
    { chunk: chunk('osm-ext', 11, external.statement), extraction: extraction([external], [relation]) },
  ])
  assert.ok(result.droppedAmbiguousRelations >= 1, 'two equally-plausible definition units must still be rejected as genuinely ambiguous, never guessed')
  console.log('  ✓ entity-representative fallback still rejects when even the representative kind is itself ambiguous')
}

// ============================================================
// LIVE SHAPE REGRESSIONS — reproduce the 5 material_brain_relation_
// ambiguous cases from the real CLUTCH 2 regeneration after c25709f/
// 1d91040. Root cause: the relation subject text itself often carries
// rich, discriminating content (bracket-annotated qualifiers, full
// rule descriptions) that the previous fix's subject-token exclusion
// discarded WHOLESALE (it excluded every token of the raw subject
// string, not just the short entity/semanticKey anchor actually
// shared by every candidate) — starving the proposition-overlap
// scorer of exactly the evidence it needed for cases where a specific
// proposition genuinely IS identifiable (case A), while only a true
// entity-level reference with no such evidence should ever reach the
// entity_representative fallback (case B), and a target where even
// that is undecidable must still reject (case C).
// ============================================================

{
  // LIVE SHAPE 1 — causes: rich bracket-annotated subjects on BOTH
  // sides; the target's own bracket content ("reacción generalizada
  // aA + bB <=> cC + dD... presiones parciales") specifically echoes
  // ONE of two "Expresión de equilibrio" propositions → case A.
  const general = unit({
    kind: 'concept', canonicalSubject: 'Expresión de equilibrio', page: 8,
    statement: 'La expresión de equilibrio para la reacción generalizada aA + bB se escribe en términos de presiones parciales para gases en un sistema cerrado.',
  })
  const specific = unit({
    kind: 'concept', canonicalSubject: 'Expresión de equilibrio', page: 9,
    statement: 'La expresión de equilibrio para la reacción 2NO2(g) se escribe en términos de concentraciones molares en disolución acuosa.',
  })
  const pressureFact = unit({
    kind: 'fact', canonicalSubject: 'Presión y concentración', page: 8,
    statement: 'La presión y la concentración de gases en un sistema cerrado determinan el estado del equilibrio.',
  })
  const relation: RawExtractedRelation = {
    type: 'causes',
    fromSubject: 'Presión y concentración [para gases en un sistema cerrado]',
    toSubject: 'Expresión de equilibrio [para la reacción generalizada aA + bB <=> cC + dD, en términos de presiones parciales, para gases en un sistema cerrado]',
    statement: 'La presión y concentración de gases en un sistema cerrado determinan la expresión de equilibrio para la reacción generalizada en términos de presiones parciales.',
    page: 8,
  }
  const result = mergeExtractions([
    { chunk: chunk('live1-gen', 8, general.statement), extraction: extraction([general]) },
    { chunk: chunk('live1-spec', 9, specific.statement), extraction: extraction([specific]) },
    { chunk: chunk('live1-fact', 8, pressureFact.statement), extraction: extraction([pressureFact], [relation]) },
  ])
  assert.equal(result.droppedAmbiguousRelations, 0, 'LIVE SHAPE 1: bracket-annotated content specific to one proposition must resolve it (case A)')
  const target = result.units.find(u => u.id === result.relations[0]?.toUnitId)
  assert.equal(target?.statement, general.statement, 'must resolve to the proposition the bracket content actually echoes (the generalized reaction), not the specific one')
  assert.equal(result.relations[0]?.toResolution, undefined, 'a case-A precise match must NOT be marked entity_representative')
  console.log('  ✓ LIVE SHAPE 1 (causes, bracket-annotated subjects): resolves to the specifically-echoed proposition')
}

{
  // LIVE SHAPE 2 — precedes: target "Presión [derivada de la ley de
  // los gases ideales]" among 2 "Presión" propositions → the bracket
  // content specifically identifies the ideal-gas-law-derived one.
  const derived = unit({
    kind: 'fact', canonicalSubject: 'Presión', page: 11,
    statement: 'La presión de un gas puede derivarse directamente de la ley de los gases ideales, PV = nRT.',
  })
  const measured = unit({
    kind: 'fact', canonicalSubject: 'Presión', page: 12,
    statement: 'La presión se mide experimentalmente con un manómetro conectado al sistema cerrado.',
  })
  const idealGasLaw = unit({
    kind: 'formula', canonicalSubject: 'Ley de los gases ideales', page: 11,
    statement: 'La ley de los gases ideales se expresa como PV = nRT.', expression: 'PV=nRT', variables: [],
  })
  const relation: RawExtractedRelation = {
    type: 'precedes', fromSubject: 'Ley de los gases ideales', toSubject: 'Presión [derivada de la ley de los gases ideales]',
    statement: 'La ley de los gases ideales permite derivar la presión del sistema.', page: 11,
  }
  const result = mergeExtractions([
    { chunk: chunk('live2-derived', 11, derived.statement), extraction: extraction([derived]) },
    { chunk: chunk('live2-measured', 12, measured.statement), extraction: extraction([measured]) },
    { chunk: chunk('live2-law', 11, idealGasLaw.statement), extraction: extraction([idealGasLaw], [relation]) },
  ])
  assert.equal(result.droppedAmbiguousRelations, 0, 'LIVE SHAPE 2: bracket content identifying "derived from ideal gas law" must resolve to that specific proposition')
  const target = result.units.find(u => u.id === result.relations[0]?.toUnitId)
  assert.equal(target?.statement, derived.statement)
  console.log('  ✓ LIVE SHAPE 2 (precedes): resolves to the specifically-identified proposition among two peers')
}

{
  // LIVE SHAPES 3 & 4 — example_of: target is a full RULE description
  // ("Constante de equilibrio de una reacción multiplicada por un
  // número") among several "Constante de equilibrio"-topic candidates
  // (concepts + formula instances) — the rule text itself must
  // identify the ONE unit stating that specific rule (case A), not an
  // arbitrary formula instance.
  const kcGeneral = unit({
    kind: 'concept', canonicalSubject: 'Constante de equilibrio', page: 14,
    statement: 'La constante de equilibrio Kc relaciona las concentraciones de productos y reactivos en el equilibrio.',
  })
  const kcMultiplicationRule = unit({
    kind: 'concept', canonicalSubject: 'Constante de equilibrio', page: 15,
    statement: 'Cuando una reacción se multiplica por un número, la constante de equilibrio de la reacción resultante es la original elevada a ese número.',
  })
  const kcAdditionRule = unit({
    kind: 'concept', canonicalSubject: 'Constante de equilibrio', page: 16,
    statement: 'Cuando dos reacciones se suman, la constante de equilibrio de la reacción resultante es el producto de las constantes individuales.',
  })
  const kcFormulaExample1 = unit({
    kind: 'formula', canonicalSubject: 'Fórmula de Kc para 2N2O4(g) <=> 4NO2(g)', page: 17,
    statement: 'Para 2N2O4(g) ⇌ 4NO2(g), Kc = [NO2]^4/[N2O4]^2.', expression: 'Kc=[NO2]^4/[N2O4]^2', variables: [],
  })
  const kcValueExample = unit({
    kind: 'event_or_data', canonicalSubject: 'Valor de Kc para 2N2O4(g) <=> 4NO2(g) a 100 °C', page: 17,
    statement: 'A 100°C, el valor de Kc para 2N2O4(g) ⇌ 4NO2(g) es 47.9.', value: '47.9',
  })
  const relationFormula: RawExtractedRelation = {
    type: 'example_of', fromSubject: 'Fórmula de Kc para 2N2O4(g) <=> 4NO2(g)',
    toSubject: 'Constante de equilibrio de una reacción multiplicada por un número',
    statement: 'La fórmula de Kc para 2N2O4(g) ⇌ 4NO2(g) ilustra que al multiplicar la reacción original por dos, la constante de equilibrio de la reacción resultante es la original elevada al cuadrado.',
    page: 17,
  }
  const relationValue: RawExtractedRelation = {
    type: 'example_of', fromSubject: 'Valor de Kc para 2N2O4(g) <=> 4NO2(g) a 100 °C',
    toSubject: 'Constante de equilibrio de una reacción multiplicada por un número',
    statement: 'El valor de Kc a 100°C ejemplifica la regla de que multiplicar una reacción por un número eleva la constante de equilibrio de la reacción resultante a ese número.',
    page: 17,
  }
  const result = mergeExtractions([
    { chunk: chunk('live34-general', 14, kcGeneral.statement), extraction: extraction([kcGeneral]) },
    { chunk: chunk('live34-mult', 15, kcMultiplicationRule.statement), extraction: extraction([kcMultiplicationRule]) },
    { chunk: chunk('live34-add', 16, kcAdditionRule.statement), extraction: extraction([kcAdditionRule]) },
    { chunk: chunk('live34-formula', 17, kcFormulaExample1.statement), extraction: extraction([kcFormulaExample1], [relationFormula]) },
    { chunk: chunk('live34-value', 17, kcValueExample.statement), extraction: extraction([kcValueExample], [relationValue]) },
  ])
  assert.equal(result.droppedAmbiguousRelations, 0, 'LIVE SHAPES 3&4: the rule text embedded in the relation must identify the one proposition stating that exact rule')
  for (const rel of result.relations) {
    const target = result.units.find(u => u.id === rel.toUnitId)
    assert.equal(target?.statement, kcMultiplicationRule.statement, `relation "${rel.statement.slice(0, 40)}..." must resolve to the multiplication-rule proposition, not the addition rule or the general concept`)
    assert.equal(rel.toResolution, undefined, 'a case-A precise rule match must not be marked entity_representative')
  }
  console.log('  ✓ LIVE SHAPES 3&4 (example_of, rich rule-description targets among 5/2 peers): both resolve to the one matching rule proposition')
}

{
  // LIVE SHAPE 5 — applies_formula: "Cálculo de la constante de
  // equilibrio Kc" → "Constante de equilibrio Kc" among 3 candidates
  // with NO distinguishing content in the relation text — a genuine
  // entity-level reference. Must resolve via entity_representative to
  // the entity's own concept/definition unit (never an arbitrary
  // formula instance), and be explicitly marked as such.
  const kcConcept = unit({
    kind: 'concept', canonicalSubject: 'Constante de equilibrio Kc', page: 20,
    statement: 'Kc es la constante de equilibrio expresada en términos de concentraciones molares.',
  })
  const kcFormulaA = unit({
    kind: 'formula', canonicalSubject: 'Constante de equilibrio Kc', page: 21,
    statement: 'Para la reacción A ⇌ B, Kc = [B]/[A].', expression: 'Kc=[B]/[A]', variables: [],
  })
  const kcFormulaB = unit({
    kind: 'formula', canonicalSubject: 'Constante de equilibrio Kc', page: 22,
    statement: 'Para la reacción 2C ⇌ D, Kc = [D]/[C]^2.', expression: 'Kc=[D]/[C]^2', variables: [],
  })
  const calculationProcess = unit({
    kind: 'process', canonicalSubject: 'Cálculo de la constante de equilibrio Kc', page: 23,
    statement: 'El cálculo de Kc requiere conocer las concentraciones molares de todas las especies en el equilibrio.',
    steps: [{ order: 1, text: 'Escribir la expresión de Kc' }, { order: 2, text: 'Sustituir las concentraciones de equilibrio' }],
  })
  const relation: RawExtractedRelation = {
    type: 'applies_formula', fromSubject: 'Cálculo de la constante de equilibrio Kc', toSubject: 'Constante de equilibrio Kc',
    statement: 'El cálculo de la constante de equilibrio Kc aplica la fórmula de la constante de equilibrio Kc.', page: 23,
  }
  const result = mergeExtractions([
    { chunk: chunk('live5-concept', 20, kcConcept.statement), extraction: extraction([kcConcept]) },
    { chunk: chunk('live5-formA', 21, kcFormulaA.statement), extraction: extraction([kcFormulaA]) },
    { chunk: chunk('live5-formB', 22, kcFormulaB.statement), extraction: extraction([kcFormulaB]) },
    { chunk: chunk('live5-process', 23, calculationProcess.statement), extraction: extraction([calculationProcess], [relation]) },
  ])
  assert.equal(result.droppedAmbiguousRelations, 0, 'LIVE SHAPE 5: a genuine entity-level reference among 3 peers with no distinguishing content must resolve via entity_representative, not be dropped')
  const resolved = result.relations[0]
  assert.equal(resolved?.toResolution, 'entity_representative', 'must be explicitly marked as entity-level, never silently indistinguishable from a precise match')
  const target = result.units.find(u => u.id === resolved.toUnitId)
  assert.equal(target?.kind, 'concept', 'must resolve to the entity\'s own concept unit, never an arbitrary specific formula instance')
  console.log('  ✓ LIVE SHAPE 5 (applies_formula, no distinguishing content among 3 peers): resolves via entity_representative to the concept unit')
}

// ============================================================
// LIVE VERIFICATION #2 REGRESSIONS — commit 9839ae0's live CLUTCH 2
// regeneration surfaced two further defects: (1) a generic short
// phrase ("en equilibrio") pooling 33 unrelated candidates via the
// fuzzy substring branch, and (2) entity_representative still
// rejecting a genuine entity-level target ("Equilibrio químico") that
// has SEVERAL real 'concept' propositions (the common case for a
// well-developed topic, not an edge case) because kind-priority alone
// requires kind-level uniqueness.
// ============================================================

{
  // LIVE SHAPE 6 — a short, generic relation subject ("en equilibrio")
  // must NOT fuzzy-match every entity whose semanticKey merely
  // contains the common word "equilibrio". Reproduces the reported
  // 33-candidate pool with a smaller but structurally identical set:
  // several UNRELATED real entities that all happen to contain
  // "equilibrio" somewhere in their name.
  const units = [
    unit({ kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 1, statement: 'El equilibrio químico es un estado dinámico.' }),
    unit({ kind: 'concept', canonicalSubject: 'Constante de equilibrio', page: 2, statement: 'La constante de equilibrio relaciona concentraciones.' }),
    unit({ kind: 'concept', canonicalSubject: 'Expresión de equilibrio', page: 3, statement: 'La expresión de equilibrio se escribe con presiones parciales.' }),
    unit({ kind: 'process', canonicalSubject: 'Cálculos de equilibrio', page: 4, statement: 'Los cálculos de equilibrio requieren una tabla ICE.' }),
    unit({ kind: 'fact', canonicalSubject: 'PbCl2', page: 5, statement: 'El PbCl2 es una sal poco soluble en equilibrio con sus iones.' }),
  ]
  const directRelation: RawExtractedRelation = {
    type: 'part_of', fromSubject: 'Reacciones directa e inversa', toSubject: 'en equilibrio',
    statement: 'Las reacciones directa e inversa ocurren en equilibrio.', page: 1,
  }
  const inverseRelation: RawExtractedRelation = {
    type: 'part_of', fromSubject: 'en equilibrio', toSubject: 'Reacciones directa e inversa',
    statement: 'En equilibrio, las reacciones directa e inversa continúan.', page: 1,
  }
  const reactionsUnit = unit({ kind: 'concept', canonicalSubject: 'Reacciones directa e inversa', page: 1, statement: 'Las reacciones directa e inversa ocurren a la misma velocidad.' })
  const result = mergeExtractions([
    { chunk: chunk('live6-eq', 1, units[0].statement), extraction: extraction([units[0], reactionsUnit], [directRelation, inverseRelation]) },
    { chunk: chunk('live6-kc', 2, units[1].statement), extraction: extraction([units[1]]) },
    { chunk: chunk('live6-expr', 3, units[2].statement), extraction: extraction([units[2]]) },
    { chunk: chunk('live6-calc', 4, units[3].statement), extraction: extraction([units[3]]) },
    { chunk: chunk('live6-pbcl2', 5, units[4].statement), extraction: extraction([units[4]]) },
  ])
  assert.equal(result.relations.length, 0, 'a generic single-token phrase must not resolve to ANY specific entity in either direction')
  assert.equal(result.droppedAmbiguousRelations, 0, 'this is "no confident match", not a false pooled-ambiguous rejection across unrelated entities — must not be reported as if 33 real candidates were genuinely ambiguous')
  console.log('  ✓ LIVE SHAPE 6 (generic short subject "en equilibrio"): does not pool unrelated multi-entity candidates')
}

{
  // Verify the mechanism directly: "en equilibrio" alone must not even
  // reach a >1 pooled-ambiguous state — it must resolve to NO match at
  // all (unit: null, no ambiguousCount) rather than silently picking
  // one of many, or reporting a misleadingly large "ambiguous" pool.
  const units = [
    unit({ kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 1, statement: 'stmt a' }),
    unit({ kind: 'concept', canonicalSubject: 'Constante de equilibrio', page: 2, statement: 'stmt b' }),
  ]
  const relation: RawExtractedRelation = { type: 'part_of', fromSubject: 'X', toSubject: 'en equilibrio', statement: 'X ocurre en equilibrio.', page: 1 }
  const xUnit = unit({ kind: 'concept', canonicalSubject: 'X', page: 1, statement: 'X es un concepto de prueba.' })
  const result = mergeExtractions([
    { chunk: chunk('live6b-eq', 1, units[0].statement), extraction: extraction([units[0], xUnit], [relation]) },
    { chunk: chunk('live6b-kc', 2, units[1].statement), extraction: extraction([units[1]]) },
  ])
  assert.equal(result.relations.length, 0, 'must not resolve a generic single-token subject to any specific entity')
  assert.equal(result.droppedAmbiguousRelations, 0, 'this is "no confident match", not "genuinely ambiguous between real candidates" — must not inflate the ambiguous-relation count either')
  console.log('  ✓ generic single-token subject resolves to no match, neither guessed nor falsely reported as ambiguous')
}

{
  // LIVE SHAPE 7 — entity-level target ("Equilibrio químico") with
  // SEVERAL real 'concept' propositions (the common, not edge, case
  // for a well-developed topic) — kind-priority alone cannot uniquely
  // identify a representative here. When exactly ONE of them is also
  // tier:'critical' (an existing, already model-assigned signal — see
  // importance.ts, never invented here), it is used as the
  // representative.
  const foundational = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 2,
    statement: 'El equilibrio químico es el estado en que las concentraciones permanecen constantes.',
    modelSuggestedTier: 'critical',
  })
  const velocidades = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 3,
    statement: 'En el equilibrio, la velocidad directa iguala a la velocidad inversa.',
    modelSuggestedTier: 'supporting',
  })
  const condiciones = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 4,
    statement: 'El equilibrio químico depende de la temperatura y la presión.',
    modelSuggestedTier: 'supporting',
  })
  const catalizadores = unit({
    kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 5,
    statement: 'Los catalizadores no desplazan la posición del equilibrio.',
    modelSuggestedTier: 'contextual',
  })
  const experimento3 = unit({ kind: 'example', canonicalSubject: 'Experimento 3', page: 6, statement: 'El experimento 3 mide la constante de equilibrio a distintas temperaturas.' })
  const relation: RawExtractedRelation = {
    type: 'part_of', fromSubject: 'Experimento 3', toSubject: 'Equilibrio químico',
    statement: 'El experimento 3 forma parte del estudio general del equilibrio químico.', page: 6,
  }
  const result = mergeExtractions([
    { chunk: chunk('live7-found', 2, foundational.statement), extraction: extraction([foundational]) },
    { chunk: chunk('live7-vel', 3, velocidades.statement), extraction: extraction([velocidades]) },
    { chunk: chunk('live7-cond', 4, condiciones.statement), extraction: extraction([condiciones]) },
    { chunk: chunk('live7-cat', 5, catalizadores.statement), extraction: extraction([catalizadores]) },
    { chunk: chunk('live7-exp3', 6, experimento3.statement), extraction: extraction([experimento3], [relation]) },
  ])
  assert.equal(result.droppedAmbiguousRelations, 0, 'LIVE SHAPE 7: an entity with several real concept propositions but exactly one critical-tier unit must still resolve via entity_representative')
  const resolved = result.relations[0]
  assert.equal(resolved?.toResolution, 'entity_representative')
  const target = result.units.find(u => u.id === resolved.toUnitId)
  assert.equal(target?.statement, foundational.statement, 'must resolve to the critical-tier proposition, not an arbitrary peer')
  console.log('  ✓ LIVE SHAPE 7 (Experimento 3/4-style, 4 real concept propositions): resolves via the unique critical-tier representative')
}

{
  // When tier ALSO fails to uniquely disambiguate (two propositions
  // both tier:'critical'), entity_representative must still correctly
  // reject rather than guess between them.
  const criticalA = unit({ kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 2, statement: 'El equilibrio químico es el estado en que las concentraciones permanecen constantes.', modelSuggestedTier: 'critical' })
  const criticalB = unit({ kind: 'concept', canonicalSubject: 'Equilibrio químico', page: 3, statement: 'El equilibrio químico se alcanza cuando la velocidad directa iguala a la velocidad inversa.', modelSuggestedTier: 'critical' })
  const experimento4 = unit({ kind: 'example', canonicalSubject: 'Experimento 4', page: 4, statement: 'stmt exp4' })
  const relation: RawExtractedRelation = { type: 'part_of', fromSubject: 'Experimento 4', toSubject: 'Equilibrio químico', statement: 'El experimento 4 forma parte del equilibrio químico.', page: 4 }
  const result = mergeExtractions([
    { chunk: chunk('live7b-a', 2, criticalA.statement), extraction: extraction([criticalA]) },
    { chunk: chunk('live7b-b', 3, criticalB.statement), extraction: extraction([criticalB]) },
    { chunk: chunk('live7b-exp4', 4, experimento4.statement), extraction: extraction([experimento4], [relation]) },
  ])
  assert.ok(result.droppedAmbiguousRelations >= 1, 'two equally-critical propositions must still be rejected as genuinely ambiguous, never guessed')
  console.log('  ✓ entity-representative still rejects when even the critical-tier signal is itself ambiguous')
}

console.log('Material Brain quality contracts: PASS')
