import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  planFlashcards,
  plannedCardIdentity,
  getOrBuildFlashcardDeck,
  WorkerFlashcardDeckStore,
  validateDeck,
  computeDeckCoverage,
  type FlashcardDeck,
  type FlashcardDeckStore,
  type GeneratedFlashcard,
  FLASHCARD_GENERATOR_VERSION,
  FLASHCARD_PLANNER_VERSION,
} from '../../lib/materialBrain/flashcards'
import type { BrainScope, KnowledgeRelation, KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import type { MaterialResult } from '../../lib/materials/types'

// ============================================================
// Flashcards V2 — contratos determinísticos (sin LLM ni red).
//
// Cubre: planner identity, multi-card por unidad, Falcons/Ácidos/
// Bases/multi-material sintéticos, restore-first, invalidación por
// versión, coverage con fallos parciales, payload corrupto y
// regresión de Material Brain (scope inmutable, no fugas).
// ============================================================

class InMemoryDeckStore implements FlashcardDeckStore {
  private map = new Map<string, FlashcardDeck>()
  async get(fingerprint: string): Promise<FlashcardDeck | null> {
    return this.map.get(fingerprint) || null
  }
  async set(fingerprint: string, deck: FlashcardDeck): Promise<void> {
    this.map.set(fingerprint, deck)
  }
}

function scopeFor(materialIds: string[], selectedPages: Record<string, number[]> = {}): BrainScope {
  return buildSourceSelectionSnapshot(materialIds, selectedPages)
}

function prov(materialId: string, page: number) {
  return { materialId, page, quote: 'quote', chunkId: 'chunk-1' }
}

function makeUnit(
  id: string,
  kind: KnowledgeUnit['kind'],
  label: string,
  statement: string,
  overrides: Partial<KnowledgeUnit> & {
    variables?: { symbol: string; meaning: string }[]
    expression?: string
    steps?: { order: number; text: string }[]
    illustrates?: string
    term?: string
    aliases?: string[]
    value?: string
  } = {},
): KnowledgeUnit {
  const base: any = {
    id,
    kind,
    identity: {
      canonicalSubject: label,
      semanticKey: label.toLowerCase().replace(/\s+/g, '_'),
      qualifiers: overrides.identity?.qualifiers || [],
    },
    label,
    statement,
    importance: { tier: 'critical', signals: ['declared_in_material'], confidence: 1 },
    provenance: overrides.provenance || [prov('mat_a', 1)],
    domainTags: [],
  }
  switch (kind) {
    case 'formula':
      return { ...base, expression: overrides.expression || 'V=I*R', variables: overrides.variables || [{ symbol: 'V', meaning: 'voltaje' }] }
    case 'process':
      return { ...base, steps: overrides.steps || [{ order: 1, text: 'Paso 1' }] }
    case 'example':
      return { ...base, illustrates: overrides.illustrates || 'concepto' }
    case 'definition':
      return { ...base, term: overrides.term || label }
    case 'terminology':
      return { ...base, aliases: overrides.aliases || [] }
    case 'event_or_data':
      return { ...base, value: overrides.value }
    default:
      return base
  }
}

function makeRelation(
  id: string,
  type: KnowledgeRelation['type'],
  fromUnitId: string,
  toUnitId: string,
): KnowledgeRelation {
  return {
    id,
    type,
    fromUnitId,
    toUnitId,
    statement: `${fromUnitId} ${type.replace(/_/g, ' ')} ${toUnitId}`,
    importance: { tier: 'supporting', signals: ['prerequisite_for'], confidence: 0.9 },
    provenance: [prov('mat_a', 1)],
  }
}

function makeBrain(scope: BrainScope, units: KnowledgeUnit[], relations: KnowledgeRelation[]): MaterialBrain {
  return {
    scope,
    meta: {
      version: '1.0.0',
      builderVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      chunking: { strategy: 'synthetic', chunkSizeChars: 0, chunkCount: 0 },
      llmCallsUsed: 0,
      retries: 0,
      status: 'ready',
    },
    units,
    relations,
    sourceCoverage: {
      requested: scope.materialIds.flatMap(mid => (scope.selectedPages[mid] || []).map(page => ({ materialId: mid, page }))),
      processed: [],
      missing: [],
      suspiciouslyEmpty: [],
      status: 'complete',
    },
    knowledgeExtraction: {
      chunksAttempted: 0,
      chunksFailed: 0,
      failedChunkIds: [],
      unitsExtractedRaw: units.length,
      unitsWithoutValidProvenance: 0,
      invalidStructural: 0,
      droppedAmbiguousRelations: 0,
      warnings: [],
    },
    mergeLog: [],
  }
}

const QUESTION_TEMPLATE_BY_COGNITIVE_TYPE = {
  recall: (label: string) => `Con base en el material autorizado, ¿qué establece la evidencia verificada sobre ${label}?`,
  application: (label: string) => `Con base en el material autorizado, ¿cómo se aplica en un caso concreto lo que el material establece sobre ${label}?`,
  comparison: (label: string) => `Con base en el material autorizado, ¿qué diferencia o contraste establece el material respecto a ${label}?`,
  procedure: (label: string) => `Con base en el material autorizado, ¿qué procedimiento establece el material para ${label}?`,
  comprehension: (label: string) => `Con base en el material autorizado, ¿qué implica o por qué es así lo que el material establece sobre ${label}?`,
} as const

function topicSnippet(sourceUnits: KnowledgeUnit[], card: { id: string }): string {
  const unit = sourceUnits[0]
  if (!unit) return card.id
  // Avoid embedding bare numbers in the question (would falsely read as
  // an ungrounded quantitative "given" for application cards, or as a
  // self-containedness violation for event_or_data units) — strip any
  // digit-bearing token before using the statement as a topic phrase.
  const words = unit.statement.split(/\s+/).filter(w => !/\d/.test(w))
  // A very short statement can't safely donate any of its own words to
  // the question without the question ending up as (near) the entire
  // statement — fall back to the (typically different-wording) label so
  // the answer, grounded in the full statement, still carries real
  // novel content the question doesn't already contain.
  if (words.length <= 3) return unit.label
  // Otherwise cap at half the statement's own words: the answer below
  // is grounded in the FULL statement, so the question must never
  // consume all of it — otherwise question and answer become
  // near-identical restatements of each other (echoing exactly the
  // vacuous-answer shape objectiveRecovery is designed to reject).
  const cap = Math.max(2, Math.min(4, Math.floor(words.length / 2)))
  const snippet = words.slice(0, cap).join(' ').replace(/[.,;:]+$/, '')
  return snippet.length > 3 ? snippet : unit.label
}

function deterministicGenerate(validIds = new Set<string>()): (card: import('../../lib/materialBrain/flashcards/types').PlannedCard, context?: { units?: KnowledgeUnit[]; relations?: KnowledgeRelation[] }) => Promise<GeneratedFlashcard> {
  return async (card, context) => {
    const sourceUnits = (context?.units || []).filter(u => card.sourceUnitIds.includes(u.id))
    const unitProvs = sourceUnits.flatMap(u => u.provenance)
    // Grounded in the real KnowledgeUnit statement(s), NOT retrievalObjective
    // (retrievalObjective is the planner's internal scaffold text, never a
    // legitimate stand-in for an actual answer — Source-Objective
    // Satisfaction correctly treats an answer with none of the source
    // unit's real content as unsupported/ambiguous).
    const groundedContent = sourceUnits.length > 0
      ? sourceUnits.map(u => {
          const parts = [u.statement]
          if (u.kind === 'process') parts.push(...u.steps.map(s => s.text))
          return parts.join(' ')
        }).join(' ')
      : card.retrievalObjective
    return {
      ...card,
      // Answer must NOT be a verbatim restatement of the question (the
      // circularity/leakage gate in validate.ts correctly rejects that)
      // — append distinguishing content so aNorm is never a substring of
      // qNorm and exceeds the short-answer token-overlap floor. The
      // question is deliberately phrased DIFFERENTLY from
      // retrievalObjective's own wording (not a verbatim/near-verbatim
      // echo of it) so it doesn't trip the template-leakage gate, which
      // rejects generated questions that merely paraphrase the
      // planner's internal scaffold text.
      // Deliberately NOT a short WH-opener question (would trip the
      // naked-value-question self-containedness check for event_or_data
      // units with no qualifiers in this generic fixture) and
      // deliberately NOT an echo of retrievalObjective (would trip
      // template-leakage). Uses the source unit's label rather than
      // card.id: a raw internal id is never visible in a real generated
      // question, and an opaque hash id can itself contain bare digit
      // runs that a quantitative-safety check would (correctly) flag as
      // an unsupported "given" — that's a fixture-realism issue, not a
      // product bug.
      // Phrased per cognitiveType (not just per unit label) — recall and
      // application cards over the SAME unit are legitimately distinct
      // pedagogical targets, not duplicate questions. Uses a snippet of
      // the unit's own statement (not just its label) as the "topic":
      // two DIFFERENT units that happen to share a label (e.g. two
      // paraphrased near-duplicates) must not collide into one literal
      // question string before they even reach generation/dedup.
      question: QUESTION_TEMPLATE_BY_COGNITIVE_TYPE[card.cognitiveType as keyof typeof QUESTION_TEMPLATE_BY_COGNITIVE_TYPE]?.(topicSnippet(sourceUnits, card))
        ?? `Con base en el material autorizado, ¿qué establece la evidencia verificada sobre ${topicSnippet(sourceUnits, card)}?`,
      // Deliberately avoids reusing the question template's own scaffold
      // vocabulary ("material", "evidencia", "autorizado/a") — otherwise
      // objectiveRecovery would (correctly) read that shared boilerplate
      // as echo rather than substantive novel content.
      answer: `Así lo documenta la fuente: ${groundedContent}`,
      provenance: unitProvs.length > 0 ? [unitProvs[0]] : [prov('mat_a', 1)],
      generatorVersion: FLASHCARD_GENERATOR_VERSION,
      generatedAt: new Date().toISOString(),
      validated: false,
      validationErrors: validIds.size > 0 && !validIds.has(card.id) ? ['generation_failed:fixture'] : [],
    }
  }
}

async function main() {
  console.log('\n--- Flashcards V2 Contracts ---\n')

  // ----------------------------------------------------------
  // 1. Planner identity es determinística y estable entre pasadas
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    const unit = makeUnit('u-1', 'concept', 'Ley de Ohm', 'V = I * R')
    const brain = makeBrain(scope, [unit], [])
    const plan1 = planFlashcards(brain)
    const plan2 = planFlashcards(brain)

    assert.deepEqual(
      plan1.plannedCards.map(c => c.id),
      plan2.plannedCards.map(c => c.id),
      'planner identity debe ser determinística',
    )
    assert.ok(plan1.plannedCards.length > 0, 'debe planear al menos una card')
    assert.ok(plan1.targetedUnitIds.includes('u-1'), 'debe targetear la unidad')
    console.log('✅ planner identity determinística')
  }

  // ----------------------------------------------------------
  // 2. Una fórmula simple produce recall + aplicación directa
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    const unit = makeUnit('u-ph', 'formula', 'pH', 'pH = -log[H+]', {
      expression: 'pH = -log[H+]',
      variables: [{ symbol: 'H', meaning: 'concentración de iones hidrógeno' }],
    })
    const plan = planFlashcards(makeBrain(scope, [unit], []))

    const ids = plan.plannedCards.map(c => c.id)
    assert.equal(new Set(ids).size, ids.length, 'cada planned card debe tener identidad única')
    assert.equal(plan.plannedCards.length, 2, 'una fórmula con una variable útil genera recall + application')
    const types = new Set(plan.plannedCards.map(c => c.cognitiveType))
    assert.ok(types.has('recall'))
    assert.ok(types.has('application'))
    console.log('✅ fórmula simple genera recall + aplicación directa')
  }

  // ----------------------------------------------------------
  // 3. Falcons-like: narrativo corto → deck completo sin inflación
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_falcons'])
    const units: KnowledgeUnit[] = [
      makeUnit('u-fundacion', 'fact', 'Fundación 1965', 'Fundados en 1965 como franquicia 15 de la NFL'),
      makeUnit('u-simbolo', 'concept', 'Símbolo del halcón', 'El halcón representa velocidad y resiliencia'),
      // FASE C fix (self-containedness): event_or_data is inherently
      // instance-bound by design (a measured/observed value) — these two
      // now need a real qualifier, exactly like any other event_or_data
      // fixture in this codebase (previously this fixture accidentally
      // depended on generateFn's question NOT being naked-value-shaped
      // to dodge the check — see deterministicGenerate's own comment —
      // a real gap, not a legitimate exemption).
      { ...makeUnit('u-stadium', 'event_or_data', 'Mercedes-Benz Stadium', 'Inaugurado en 2017', { value: '2017', identity: { canonicalSubject: 'Mercedes-Benz Stadium', semanticKey: 'mercedes-benz_stadium', qualifiers: ['Mercedes-Benz Stadium'] } } as any), displayQualifiers: ['Mercedes-Benz Stadium'] } as any,
      { ...makeUnit('u-28-3', 'event_or_data', 'Super Bowl LI', 'Ventaja 28-3 y derrota en tiempo extra', { identity: { canonicalSubject: 'Super Bowl LI', semanticKey: 'super_bowl_li', qualifiers: ['Super Bowl LI'] } } as any), displayQualifiers: ['Super Bowl LI'] } as any,
    ]
    const brain = makeBrain(scope, units, [])
    const store = new InMemoryDeckStore()
    const result = await getOrBuildFlashcardDeck(brain, store, { generateFn: deterministicGenerate() })

    assert.equal(result.status, 'ready')
    assert.ok(result.deck)
    assert.equal(result.deck.cards.length, units.length, 'cada unidad targeteada genera una card')
    assert.equal(result.deck.coverage.status, 'complete')
    assert.deepEqual(result.deck.coverage.coveredUnitIds.sort(), units.map(u => u.id).sort())
    console.log(`✅ Falcons-like: ${result.deck.cards.length} cards, cobertura completa`)
  }

  // ----------------------------------------------------------
  // 4. Ácidos/Bases-like: definiciones + fórmula + proceso
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_acidos'])
    const arrhenius = makeUnit('u-arrhenius', 'definition', 'Ácido de Arrhenius', 'Libera H+ en agua', {
      identity: { canonicalSubject: 'acido', semanticKey: 'acido', qualifiers: ['arrhenius'] },
    })
    const bronsted = makeUnit('u-bronsted', 'definition', 'Ácido de Brønsted-Lowry', 'Dona un protón', {
      identity: { canonicalSubject: 'acido', semanticKey: 'acido', qualifiers: ['bronsted-lowry'] },
    })
    const formula = makeUnit('u-ph', 'formula', 'pH', 'pH = -log[H+]', {
      expression: 'pH = -log[H+]',
      variables: [{ symbol: 'H', meaning: 'concentración de iones hidrógeno' }],
    })
    const proceso = makeUnit('u-proc-ph', 'process', 'Calcular pH', 'Procedimiento para calcular pH', {
      steps: [
        { order: 1, text: 'Conocer [H+]' },
        { order: 2, text: 'Aplicar pH = -log[H+]' },
      ],
    })
    const rel = makeRelation('r-1', 'contrasts_with', arrhenius.id, bronsted.id)

    const plan = planFlashcards(makeBrain(scope, [arrhenius, bronsted, formula, proceso], [rel]))
    assert.equal(plan.plannedCards.length, 6, '4 units (definiciónx2 recall, fórmula recall+app, proceso procedure) + 1 relación = 6')

    const store = new InMemoryDeckStore()
    const result = await getOrBuildFlashcardDeck(makeBrain(scope, [arrhenius, bronsted, formula, proceso], [rel]), store, {
      generateFn: deterministicGenerate(),
    })
    assert.equal(result.status, 'ready')
    assert.equal(result.deck.coverage.status, 'complete')
    assert.ok(result.deck.cards.every(c => c.validated), 'todas las cards determinísticas deben validar')
    console.log('✅ Ácidos/Bases-like: definiciones, fórmula, proceso y comparación')
  }

  // ----------------------------------------------------------
  // 4b. Process complexity scales card count: simple vs structured
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_process'])
    const simple = makeUnit('u-simple', 'process', 'Preparar café', 'Hacer una taza de café', {
      steps: [
        { order: 1, text: 'Hervir agua' },
        { order: 2, text: 'Verter sobre el café molido' },
      ],
    })
    const complex = makeUnit('u-complex', 'process', 'Diagnosticar un motor', 'Procedimiento de diagnóstico', {
      steps: [
        { order: 1, text: 'Escuchar ruidos anormales al arrancar' },
        { order: 2, text: 'Verificar niveles de aceite y refrigerante' },
        { order: 3, text: 'Conectar el escáner y leer códigos de fallo' },
        { order: 4, text: 'Evaluar los datos en ralentí y acelerado' },
        { order: 5, text: 'Revisar conectores y sensores si hay códigos' },
        { order: 6, text: 'Decidir si se repara o se reemplaza la pieza' },
      ],
    })

    const simplePlan = planFlashcards(makeBrain(scope, [simple], []))
    const complexPlan = planFlashcards(makeBrain(scope, [complex], []))

    assert.ok(simplePlan.plannedCards.length >= 1, 'un proceso simple genera al menos la card de procedimiento')
    assert.ok(complexPlan.plannedCards.length > simplePlan.plannedCards.length, 'un proceso más estructurado genera más cards')
    assert.ok(
      complexPlan.plannedCards.some(c => c.retrievalObjective.toLowerCase().includes('order') || c.retrievalObjective.toLowerCase().includes('orden')),
      'el proceso complejo genera una card de ordenamiento estructural',
    )
    console.log(`✅ densidad de proceso escala con estructura: simple=${simplePlan.plannedCards.length}, complejo=${complexPlan.plannedCards.length}`)
  }

  // ----------------------------------------------------------
  // 4c. Formula complexity: richer structure → more distinct objectives
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_formula'])
    const simple = makeUnit('u-ph', 'formula', 'pH', 'pH = -log[H+]', {
      expression: 'pH = -log[H+]',
      variables: [{ symbol: 'H', meaning: 'concentración de iones hidrógeno' }],
    })
    const rich = makeUnit('u-density', 'formula', 'Densidad', 'D = m / V', {
      expression: 'D = m / V',
      variables: [
        { symbol: 'D', meaning: 'densidad' },
        { symbol: 'm', meaning: 'masa' },
        { symbol: 'V', meaning: 'volumen' },
      ],
    })

    const simplePlan = planFlashcards(makeBrain(scope, [simple], []))
    const richPlan = planFlashcards(makeBrain(scope, [rich], []))

    // P0 fix: a formula's structural richness (more variables) must NOT
    // automatically explode into one "solve for X" card per variable —
    // that was exactly the reported despeje-explosion bug (Kc producing
    // a separate card for every symbol). A multi-variable formula still
    // gets bounded, meaningful cards (recall + compute-output-from-
    // inputs) — never more than that just because it's "algebraically
    // simple" and has more symbols.
    assert.ok(richPlan.plannedCards.length <= simplePlan.plannedCards.length + 1,
      'a richer formula must NOT explode into one card per variable (no automatic despeje generation)')
    assert.ok(!richPlan.plannedCards.some(c => /rearrange.*solve for/i.test(c.retrievalObjective)),
      'no automatic "rearrange to solve for X" card may be generated without explicit material evidence')

    const objectives = new Set(richPlan.plannedCards.map(c => c.retrievalObjective))
    assert.equal(objectives.size, richPlan.plannedCards.length, 'cada card rica tiene un retrievalObjective distinto')

    const ids = new Set(richPlan.plannedCards.map(c => c.id))
    assert.equal(ids.size, richPlan.plannedCards.length, 'cada card rica tiene identity determinística distinta')

    const cognitiveTypes = new Set(richPlan.plannedCards.map(c => c.cognitiveType))
    assert.ok(cognitiveTypes.has('recall') && cognitiveTypes.has('application'), 'las cards adicionales representan objetivos cognitivos distintos')

    console.log(`✅ densidad de fórmula escala con estructura: simple=${simplePlan.plannedCards.length}, rica=${richPlan.plannedCards.length}`)
  }

  // ----------------------------------------------------------
  // 4d. Formula no-overfragmentation: variables triviales/redundantes no inflan
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_formula'])
    const unit = makeUnit('u-over', 'formula', 'Densidad', 'D = m / V', {
      expression: 'D = m / V',
      variables: [
        { symbol: 'D', meaning: 'densidad' },
        { symbol: 'm', meaning: 'masa' },
        { symbol: 'V', meaning: 'volumen' },
        { symbol: 'X', meaning: 'factor mágico irrelevante' },
        { symbol: 'Y', meaning: 'constante de relleno' },
      ],
    })

    const plan = planFlashcards(makeBrain(scope, [unit], []))
    // recall + compute-output-from-inputs — no automatic per-variable
    // despeje (P0 fix), so trivial variables can't inflate this either.
    assert.equal(plan.plannedCards.length, 2, 'solo las variables que aparecen en la expresión generan objetivos; las triviales se ignoran')
    assert.ok(
      plan.plannedCards.every(c => !c.retrievalObjective.includes('factor mágico') && !c.retrievalObjective.includes('relleno')),
      'ninguna card debe referirse a variables que no participan en la fórmula',
    )
    console.log('✅ fórmula no genera cards por variables redundantes fuera de la expresión')
  }

  // ----------------------------------------------------------
  // 4e. Process language independence: mismo comportamiento en español e inglés
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_lang'])
    const spanish = makeUnit('u-es', 'process', 'Hacer té', 'Preparar una taza de té', {
      steps: [
        { order: 1, text: 'Hervir agua' },
        { order: 2, text: 'Verter sobre la bolsa de té' },
      ],
    })
    const english = makeUnit('u-en', 'process', 'Make tea', 'Prepare a cup of tea', {
      steps: [
        { order: 1, text: 'Boil water' },
        { order: 2, text: 'Pour over the teabag' },
      ],
    })

    const esPlan = planFlashcards(makeBrain(scope, [spanish], []))
    const enPlan = planFlashcards(makeBrain(scope, [english], []))

    assert.equal(esPlan.plannedCards.length, enPlan.plannedCards.length, 'misma estructura de steps → mismo número de cards')
    assert.deepEqual(
      esPlan.plannedCards.map(c => c.cognitiveType).sort(),
      enPlan.plannedCards.map(c => c.cognitiveType).sort(),
      'misma estructura de steps → mismos tipos cognitivos',
    )
    console.log('✅ planificación de procesos es independiente del idioma')
  }

  // ----------------------------------------------------------
  // 5. Multi-material: unidad compartida aparece una sola vez
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_multi_a', 'mat_multi_b'])
    const ohm = makeUnit('u-ohm-shared', 'formula', 'Ley de Ohm', 'V = I*R', {
      provenance: [prov('mat_multi_a', 1), prov('mat_multi_b', 1)],
    })
    const serie = makeUnit('u-serie', 'concept', 'Circuito en serie', 'Componentes uno tras otro', { provenance: [prov('mat_multi_a', 2)] })
    const paralelo = makeUnit('u-paralelo', 'concept', 'Circuito en paralelo', 'Componentes comparten nodos', { provenance: [prov('mat_multi_b', 2)] })
    const brain = makeBrain(scope, [ohm, serie, paralelo], [])

    const plan = planFlashcards(brain)
    assert.equal(plan.plannedCards.filter(c => c.sourceUnitIds.includes(ohm.id)).length, 2, 'unidad compartida (fórmula) → 2 cards')
    assert.ok(plan.targetedUnitIds.includes(ohm.id))

    const result = await getOrBuildFlashcardDeck(brain, new InMemoryDeckStore(), { generateFn: deterministicGenerate() })
    assert.equal(result.status, 'ready')
    assert.ok(ohm.provenance.length >= 2, 'la unidad compartida debe conservar provenance de ambos materiales')
    assert.ok(
      result.deck.cards.some(c => ohm.provenance.some(p => p.materialId === c.provenance[0]?.materialId)),
      'las cards deben anclarse a provenance de la unidad compartida',
    )
    console.log('✅ multi-material: unidad compartida con provenance dual')
  }

  // ----------------------------------------------------------
  // 6. Selección parcial de páginas: scope del deck respeta selectedPages
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'], { mat_a: [1, 3] })
    const unit = makeUnit('u-partial', 'concept', 'Concepto parcial', 'Solo páginas 1 y 3')
    const brain = makeBrain(scope, [unit], [])
    const result = await getOrBuildFlashcardDeck(brain, new InMemoryDeckStore(), { generateFn: deterministicGenerate() })

    assert.deepEqual(result.deck.scope.selectedPages, { mat_a: [1, 3] })
    assert.equal(result.deck.scope.materialIds.length, 1)
    console.log('✅ deck conserva selectedPages parciales del scope')
  }

  // ----------------------------------------------------------
  // 7. Restore-first: segundo getOrBuild devuelve deck cacheado
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    const unit = makeUnit('u-1', 'concept', 'Concepto A', 'Definición A')
    const brain = makeBrain(scope, [unit], [])
    const store = new InMemoryDeckStore()
    let gens = 0
    const gen = async (card: any, context: any) => {
      gens++
      const base = await deterministicGenerate()(card, context)
      return { ...base, question: `Generación ${gens}: ¿qué establece el material respecto al elemento ${card.id}?` } as GeneratedFlashcard
    }

    const r1 = await getOrBuildFlashcardDeck(brain, store, { generateFn: gen })
    assert.equal(r1.status, 'ready')
    assert.equal(gens, 1)

    const r2 = await getOrBuildFlashcardDeck(brain, store, { generateFn: gen })
    assert.equal(r2.status, 'ready')
    assert.equal(gens, 1, 'restore-first: no debe regenerar')
    assert.equal(r1.deck.cards[0].question, r2.deck.cards[0].question)
    console.log('✅ restore-first: segunda llamada usa deck cacheado')
  }

  // ----------------------------------------------------------
  // 8. Invalidación por plannerVersion/generatorVersion distinta
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    const unit = makeUnit('u-1', 'concept', 'Concepto A', 'Definición A')
    const brain = makeBrain(scope, [unit], [])
    const store = new InMemoryDeckStore()
    const staleDeck: FlashcardDeck = {
      scope,
      meta: {
        schemaVersion: '1.0.0',
        plannerVersion: '0.0.1-stale',
        generatorVersion: FLASHCARD_GENERATOR_VERSION,
        status: 'ready',
        generatedAt: new Date().toISOString(),
        llmCallsUsed: 1,
        retries: 0,
      },
      cards: [],
      coverage: {
        targetedUnitIds: [],
        targetedRelationIds: [],
        coveredUnitIds: [],
        coveredRelationIds: [],
        status: 'failed',
        metrics: { plannedCards: 0, validCards: 0, failedCards: 0, targetedUnits: 0, coveredUnits: 0, targetedRelations: 0, coveredRelations: 0 },
      },
    }
    await store.set(scope.fingerprint, staleDeck)

    let gens = 0
    const result = await getOrBuildFlashcardDeck(brain, store, {
      generateFn: async (card, context) => {
        gens++
        return deterministicGenerate()(card, context)
      },
    })
    assert.equal(result.status, 'ready')
    assert.equal(gens, 1, 'debe reconstruir tras detectar plannerVersion obsoleta')
    console.log('✅ invalidación por plannerVersion obsoleta')
  }

  // ----------------------------------------------------------
  // 9. Coverage parcial cuando algunas cards fallan
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    const units: KnowledgeUnit[] = [
      makeUnit('u-ok-1', 'concept', 'OK 1', 'Bien'),
      makeUnit('u-ok-2', 'concept', 'OK 2', 'Bien'),
      makeUnit('u-fail', 'concept', 'Fallo', 'Fallo.'), // short/self-referential: keeps the deterministic fallback candidate circular (rejected) too, so this target genuinely stays unresolved — preserving this test's intent of a permanently-failing card, not accidentally rescued by the guaranteed-final-attempt fallback
    ]
    const brain = makeBrain(scope, units, [])
    const plan = planFlashcards(brain)
    const failId = plan.plannedCards.find(c => c.sourceUnitIds.includes('u-fail'))!.id

    const result = await getOrBuildFlashcardDeck(brain, new InMemoryDeckStore(), {
      generateFn: async (card, context) => {
        const base = await deterministicGenerate()(card, context)
        if (card.id === failId) {
          return { ...base, question: '', answer: '', validationErrors: ['generation_failed:fixture'] }
        }
        return base
      },
    })

    assert.equal(result.status, 'partial')
    assert.ok(result.deck.cards.some(c => !c.validated), 'debe haber cards marcadas como inválidas')
    assert.ok(result.deck.coverage.metrics.failedCards > 0, 'metrics.failedCards debe reflejar cards inválidas')
    assert.equal(result.deck.coverage.status, 'partial')
    console.log('✅ coverage parcial ante fallos de generación')
  }

  // ----------------------------------------------------------
  // 10. Building reciente → poll (sin segunda construcción)
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    const unit = makeUnit('u-1', 'concept', 'Concepto A', 'Definición A')
    const brain = makeBrain(scope, [unit], [])
    const store = new InMemoryDeckStore()

    let builds = 0
    const slowGen = async (card: any, context: any) => {
      builds++
      await new Promise(r => setTimeout(r, 50))
      return deterministicGenerate()(card, context)
    }

    // Esperamos a que el primer llamado escriba el placeholder 'building'
    // antes de lanzar la segunda llamada — así ejercitamos el camino en el
    // que la segunda lectura encuentra un building reciente y no reconstruye.
    let placeholderResolved = false
    let resolvePlaceholder: (() => void) | undefined
    const placeholderPromise = new Promise<void>(resolve => { resolvePlaceholder = resolve })
    const originalSet = store.set.bind(store)
    store.set = async (fingerprint: string, deck: FlashcardDeck) => {
      await originalSet(fingerprint, deck)
      if (deck.meta.status === 'building' && !placeholderResolved) {
        placeholderResolved = true
        resolvePlaceholder?.()
      }
    }

    const p1 = getOrBuildFlashcardDeck(brain, store, { generateFn: slowGen })
    await placeholderPromise

    const p2 = getOrBuildFlashcardDeck(brain, store, { generateFn: slowGen })

    const r2 = await p2
    assert.equal(r2.status, 'building', 'llamada concurrente debe ver building reciente y no reconstruir')

    const r1 = await p1
    assert.equal(r1.status, 'ready')
    assert.equal(builds, 1, 'solo el primer build debe haberse iniciado')
    console.log('✅ anti-duplicado de builds concurrentes')
  }

  // ----------------------------------------------------------
  // 11. Worker payload corrupto → error explícito, no rebuild
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    const unit = makeUnit('u-1', 'concept', 'Concepto A', 'Definición A')
    const brain = makeBrain(scope, [unit], [])

    const corruptedResult: MaterialResult = {
      id: 'res-corrupt',
      material_id: `flashcards_deck:${scope.fingerprint}`,
      enfoque: 'mixto' as any,
      result_type: 'flashcards_deck' as any,
      payload: 'not-a-deck-json',
      created_at: new Date().toISOString(),
    }

    const store = new WorkerFlashcardDeckStore({
      getMaterialResult: async () => corruptedResult,
      saveMaterialResult: async () => corruptedResult,
    })

    try {
      await getOrBuildFlashcardDeck(brain, store, { generateFn: deterministicGenerate() })
      assert.fail('debe lanzar FLASHCARD_DECK_CORRUPTED_PAYLOAD')
    } catch (err: any) {
      assert.ok(
        String(err?.message || err).includes(`FLASHCARD_DECK_CORRUPTED_PAYLOAD:${scope.fingerprint}`),
        'debe incluir fingerprint en el error',
      )
    }
    console.log('✅ payload corrupto en Worker se reporta como error')
  }

  // ----------------------------------------------------------
  // 12. Regresión Material Brain: deck no muta el brain ni filtra páginas
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'], { mat_a: [1, 2] })
    const unit = makeUnit('u-1', 'concept', 'Concepto A', 'Definición A')
    const brain = makeBrain(scope, [unit], [])
    const brainBefore = JSON.stringify(brain)

    const result = await getOrBuildFlashcardDeck(brain, new InMemoryDeckStore(), { generateFn: deterministicGenerate() })
    assert.equal(JSON.stringify(brain), brainBefore, 'el builder no debe mutar el brain')
    assert.deepEqual(result.deck.scope.selectedPages, { mat_a: [1, 2] })
    assert.equal(result.deck.cards.length, 1)
    console.log('✅ no hay mutación de Material Brain ni fuga de páginas')
  }

  // ----------------------------------------------------------
  // 12b. Cobertura con cero targets es vacuamente completa
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    const brain = makeBrain(scope, [], [])
    const result = await getOrBuildFlashcardDeck(brain, new InMemoryDeckStore(), { generateFn: deterministicGenerate() })

    assert.equal(result.status, 'ready')
    assert.equal(result.deck.cards.length, 0)
    assert.equal(result.deck.coverage.status, 'complete')
    assert.deepEqual(result.deck.coverage.targetedUnitIds, [])
    assert.deepEqual(result.deck.coverage.targetedRelationIds, [])
    console.log('✅ cobertura vacuamente completa con cero targets')
  }

  // ----------------------------------------------------------
  // 13. Duplicados semánticos son detectados; objetivos distintos coexisten
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    const unit = makeUnit('u-1', 'formula', 'Ley de Ohm', 'V=IR', {
      variables: [
        { symbol: 'V', meaning: 'voltaje' },
        { symbol: 'I', meaning: 'corriente' },
      ],
    })
    const plan = planFlashcards(makeBrain(scope, [unit], []))
    const cards: GeneratedFlashcard[] = await Promise.all(
      plan.plannedCards.map(async c => deterministicGenerate()(c)),
    )
    // Forzar pregunta idéntica en dos objetivos distintos para activar guardrail semántico.
    cards[1].question = cards[0].question
    cards[1].answer = cards[0].answer

    const validated = validateDeck(cards, plan)
    assert.ok(validated.some(c => c.validationErrors.includes('semantic_duplicate_question')), 'debe marcar duplicado semántico')
    assert.ok(validated.some(c => c.validated), 'debe conservar al menos una card válida')
    console.log('✅ dedupe semántico protege objetivos distintos')
  }


  // ----------------------------------------------------------
  // TEST A — same label / different knowledge → distinct objectives
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_falcons'])
    const units: KnowledgeUnit[] = [
      makeUnit('u-fund', 'fact', 'Atlanta Falcons', 'Fundados en 1965 como la decimoquinta franquicia de la NFL'),
      makeUnit('u-iden', 'concept', 'Atlanta Falcons', 'La identidad del equipo se basa en pasión y resiliencia cultural'),
      makeUnit('u-cult', 'concept', 'Atlanta Falcons', 'El equipo es un símbolo deportivo y cultural de la ciudad de Atlanta'),
    ]
    const plan = planFlashcards(makeBrain(scope, units, []))

    const objectives = plan.plannedCards.map(c => c.retrievalObjective)
    const uniqueObjectives = new Set(objectives)
    assert.equal(
      uniqueObjectives.size,
      objectives.length,
      'TEST A: 3 units con mismo label pero distinto knowledge deben tener retrievalObjectives distintos. Got: ' + JSON.stringify(objectives),
    )

    const ids = plan.plannedCards.map(c => c.id)
    const uniqueIds = new Set(ids)
    assert.equal(uniqueIds.size, ids.length, 'TEST A: cada planned card debe tener identity distinta')

    console.log('✅ TEST A: mismo label / distinto knowledge → objectives distintos')
    console.log('   Objectives:', objectives.map(o => o.slice(0, 70)))
  }

  // ----------------------------------------------------------
  // TEST B — UI partial útil (simulado con plan+deck partial)
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    // Distinct real content per unit — a templated "Nth idea/fact of the
    // material" placeholder (the previous fixture) shares almost all of
    // its vocabulary across every unit, which is itself exactly the
    // near-duplicate shape the P0 cross-unit semantic dedup is designed
    // to catch (see flashcards-coverage-quality-contracts.ts TEST D) —
    // it isn't a realistic stand-in for 5 genuinely distinct facts.
    const units: KnowledgeUnit[] = [
      makeUnit('u-ok-1', 'concept', 'Fotosíntesis', 'Las plantas convierten luz solar en energía química mediante clorofila'),
      makeUnit('u-ok-2', 'fact', 'Velocidad de la luz', 'La luz viaja a aproximadamente 300000 kilómetros por segundo en el vacío'),
      makeUnit('u-ok-3', 'definition', 'Mitosis', 'Proceso de división celular que produce dos células hijas idénticas'),
      makeUnit('u-ok-4', 'concept', 'Tectónica de placas', 'La corteza terrestre está dividida en placas que se desplazan lentamente'),
      makeUnit('u-ok-5', 'fact', 'Punto de ebullición del agua', 'El agua hierve a cien grados Celsius al nivel del mar'),
      // Short/self-referential: keeps the deterministic fallback candidate
      // circular (rejected) too, so THIS target genuinely stays
      // unresolved — the other 5 units above have real distinguishing
      // statements the guaranteed-final-attempt fallback would otherwise
      // rescue, which would defeat this test's intent (a target that
      // permanently fails, to exercise partial-coverage reporting).
      makeUnit('u-broken', 'concept', 'Roto', 'Roto.'),
    ]
    const brain = makeBrain(scope, units, [])
    const plan = planFlashcards(brain)
    const failId = plan.plannedCards.find(c => c.sourceUnitIds.includes('u-broken'))!.id

    const result = await getOrBuildFlashcardDeck(brain, new InMemoryDeckStore(), {
      generateFn: async (card, context) => {
        const base = await deterministicGenerate()(card, context)
        if (card.id === failId) {
          return { ...base, question: '', answer: '', validated: false, validationErrors: ['generation_failed'] }
        }
        return { ...base, validated: true, validationErrors: [] }
      },
    })

    assert.equal(result.status, 'partial', 'TEST B: deck con algunas cards fallidas debe ser partial')
    const validCards = result.deck.cards.filter(c => c.validated)
    assert.ok(validCards.length >= 4, 'TEST B: las cards válidas deben estar presentes, got ' + validCards.length)
    assert.ok(result.deck.coverage.metrics.failedCards > 0, 'TEST B: failedCards debe ser > 0')
    assert.ok(result.deck.coverage.metrics.validCards > 0, 'TEST B: validCards debe ser > 0')
    assert.equal(result.deck.coverage.status, 'partial')

    console.log('✅ TEST B: deck partial con ' + validCards.length + ' cards válidas y ' + result.deck.coverage.metrics.failedCards + ' fallidas')
  }

  // ----------------------------------------------------------
  // TEST C — same label / different qualifiers → distinct objectives
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_acidos'])
    const arrhenius = makeUnit('u-arrh', 'definition', 'Ácido', 'Sustancia que libera H+ al disolverse en agua según Arrhenius', {
      identity: { canonicalSubject: 'acido', semanticKey: 'acido', qualifiers: ['arrhenius'] },
    })
    const bronsted = makeUnit('u-bron', 'definition', 'Ácido', 'Sustancia capaz de donar un protón según Brønsted-Lowry', {
      identity: { canonicalSubject: 'acido', semanticKey: 'acido', qualifiers: ['bronsted-lowry'] },
    })
    const lewis = makeUnit('u-lewis', 'definition', 'Ácido', 'Sustancia aceptora de pares de electrones según Lewis', {
      identity: { canonicalSubject: 'acido', semanticKey: 'acido', qualifiers: ['lewis'] },
    })

    const plan = planFlashcards(makeBrain(scope, [arrhenius, bronsted, lewis], []))
    const objectives = plan.plannedCards.map(c => c.retrievalObjective)
    const uniqueObjectives = new Set(objectives)

    assert.equal(uniqueObjectives.size, 3, 'TEST C: 3 definiciones con mismo label pero qualifiers distintos deben tener 3 objectives únicos. Got: ' + JSON.stringify(objectives))

    const ids = new Set(plan.plannedCards.map(c => c.id))
    assert.equal(ids.size, 3, 'TEST C: 3 planned IDs distintos')

    console.log('✅ TEST C: mismo label / qualifiers distintos → 3 objectives distintos')
  }

  // ----------------------------------------------------------
  // TEST D — semantically equivalent units → semantic duplicate validator keeps deck useful
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    const unit1 = makeUnit('u-eq1', 'concept', 'Ley de Ohm', 'La ley de Ohm establece que el voltaje es proporcional a la corriente y a la resistencia')
    const unit2 = makeUnit('u-eq2', 'concept', 'Ley de Ohm', 'La relación entre voltaje, corriente y resistencia se expresa por la ley de Ohm')

    const brain = makeBrain(scope, [unit1, unit2], [])
    const plan = planFlashcards(brain)

    // FASE 2 mission ("UNA SOLA autoridad de dedup") — RECLASIFICADO:
    // this test originally asserted an IMPLEMENTATION DETAIL ("resolved
    // at PLAN time via a Tier-2 provider judge", semanticDedup.ts, now
    // removed). The real PRODUCT contract it was protecting — "a
    // moderate-overlap same-label pair is never blindly auto-merged, and
    // the final deck ends up with exactly one useful valid card for it"
    // — is unchanged and still enforced, just by the single remaining
    // dedup authority (reconcilePedagogicalDuplicates, post-generation,
    // over real question/answer text) instead of a plan-time judge.
    assert.equal(plan.plannedCards.length, 2, 'TEST D: moderate-overlap same-label pair is never blindly auto-merged at plan time')
    assert.equal(plan.ambiguousDuplicateGroups.length, 1, 'TEST D: the pair is still flagged as plan-time ambiguity (informational) — both proceed to generation')

    const result = await getOrBuildFlashcardDeck(brain, new InMemoryDeckStore(), {
      generateFn: deterministicGenerate(),
      // Mock the ONE dedup judge left in the pipeline (post-generation,
      // pedagogicalDedup.ts) to confirm the merge deterministically in
      // this test (no real network) — exercises the FULL resolution
      // pipeline end-to-end, not just the planner's own flagging.
      pedagogicalJudgeFn: async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: true })),
    })

    const validCards = result.deck.cards.filter(c => c.validated)

    assert.equal(result.status, 'ready', 'TEST D: with the duplicate resolved post-generation, the single remaining target is fully covered')
    assert.equal(validCards.length, 1, 'TEST D: exactly 1 valid card for the merged claim')
    assert.ok(validCards[0].question.trim().length > 0 && validCards[0].answer.trim().length > 0, 'TEST D: the deck stays useful with 1 valid card')
    assert.equal(result.deck.coverage.metrics.validCards, 1, 'TEST D: coverage.metrics.validCards must reflect 1 valid')

    console.log('✅ TEST D: cross-unit semantic duplicate is resolved post-generation (single dedup authority), deck stays useful with 1 card')
  }

  console.log('\n✅ Todos los contratos determinísticos de Flashcards V2 pasaron.')
}

main().catch(error => {
  console.error('❌ flashcards-v2-contracts falló:', error)
  process.exit(1)
})
