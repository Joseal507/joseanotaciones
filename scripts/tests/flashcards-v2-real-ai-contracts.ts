import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { normalizeSemanticText } from '../../lib/materialBrain/identity'
import {
  getOrBuildFlashcardDeck,
  type GenerationContext,
} from '../../lib/materialBrain/flashcards'
import type { BrainScope, KnowledgeRelation, KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'

// ============================================================
// Flashcards V2 — contratos con IA real.
//
// Estos tests SÍ llaman al proveedor de IA (a través de alaiJson)
// para generar mazos completos. Requieren variables de entorno /
// credenciales configuradas. Si no hay claves, la ejecución fallará
// con el error del provider — eso es el comportamiento esperado y
// auditado.
//
// Diseño: se prueban dos perfiles representativos de contenido real:
// - Falcons-like: narrativo corto (facts/conceptos/eventos).
// - Ácidos/Bases-like: definiciones + fórmula + proceso + relación.
// ============================================================

function prov(materialId: string, page: number) {
  return { materialId, page, quote: 'quote', chunkId: 'chunk-1' }
}

function makeUnit(
  id: string,
  kind: KnowledgeUnit['kind'],
  label: string,
  statement: string,
  overrides: Partial<KnowledgeUnit> & { variables?: { symbol: string; meaning: string }[]; steps?: { order: number; text: string }[]; illustrates?: string; term?: string; aliases?: string[]; value?: string } = {},
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
    provenance: overrides.provenance || [prov('mat_real', 1)],
    domainTags: [],
  }
  switch (kind) {
    case 'formula':
      return { ...base, expression: 'V = I * R', variables: overrides.variables || [{ symbol: 'V', meaning: 'voltaje' }] }
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
    provenance: [prov('mat_real', 1)],
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

class InMemoryDeckStore {
  private map = new Map<string, any>()
  async get(fingerprint: string) { return this.map.get(fingerprint) || null }
  async set(fingerprint: string, deck: any) { this.map.set(fingerprint, deck) }
}

async function main() {
  console.log('\n--- Flashcards V2 Real-AI Contracts ---\n')

  // ----------------------------------------------------------
  // 1. Falcons-like: narrativo corto → deck completo y denso
  // ----------------------------------------------------------
  {
    const scope = buildSourceSelectionSnapshot(['mat_falcons'], {})
    const units: KnowledgeUnit[] = [
      makeUnit('u-fundacion', 'fact', 'Fundación 1965', 'Fundados en 1965 como franquicia 15 de la NFL'),
      makeUnit('u-simbolo', 'concept', 'Símbolo del halcón', 'El halcón representa velocidad y resiliencia'),
      makeUnit('u-stadium', 'event_or_data', 'Mercedes-Benz Stadium', 'Inaugurado en 2017', { value: '2017' }),
      makeUnit('u-28-3', 'event_or_data', 'Super Bowl LI', 'Ventaja 28-3 y derrota en tiempo extra'),
    ]
    const brain = makeBrain(scope, units, [])

    const result = await getOrBuildFlashcardDeck(brain, new InMemoryDeckStore(), { language: 'es' })

    assert.equal(result.status, 'ready')
    assert.ok(result.deck)
    assert.ok(
      result.deck.cards.length >= units.length,
      'debe generar al menos una card por unidad targeteada',
    )
    assert.equal(result.deck.coverage.status, 'complete')
    assert.ok(
      result.deck.cards.every(c => c.question.trim() && c.answer.trim()),
      'ninguna card puede tener question/answer vacíos',
    )

    const normalizedQuestions = result.deck.cards.map(c => normalizeSemanticText(c.question))
    assert.equal(
      new Set(normalizedQuestions).size,
      normalizedQuestions.length,
      'las preguntas generadas deben ser distintas entre sí',
    )

    console.log(`✅ Falcons-like: ${result.deck.cards.length} cards, cobertura completa, todas distintas`)
  }

  // ----------------------------------------------------------
  // 2. Ácidos/Bases-like: definiciones + fórmula + proceso + comparación
  // ----------------------------------------------------------
  {
    const scope = buildSourceSelectionSnapshot(['mat_acidos'], {})
    const arrhenius = makeUnit('u-arrhenius', 'definition', 'Ácido de Arrhenius', 'Libera H+ en agua', {
      identity: { canonicalSubject: 'acido', semanticKey: 'acido', qualifiers: ['arrhenius'] },
    })
    const bronsted = makeUnit('u-bronsted', 'definition', 'Ácido de Brønsted-Lowry', 'Dona un protón', {
      identity: { canonicalSubject: 'acido', semanticKey: 'acido', qualifiers: ['bronsted-lowry'] },
    })
    const ph = makeUnit('u-ph', 'formula', 'pH', 'pH = -log[H+]', {
      variables: [{ symbol: 'H', meaning: 'concentración de iones hidrógeno' }],
    })
    const proceso = makeUnit('u-proc-ph', 'process', 'Calcular pH', 'Procedimiento para calcular pH', {
      steps: [
        { order: 1, text: 'Determinar [H+]' },
        { order: 2, text: 'Aplicar pH = -log[H+]' },
      ],
    })
    const rel = makeRelation('r-1', 'contrasts_with', arrhenius.id, bronsted.id)

    const brain = makeBrain(scope, [arrhenius, bronsted, ph, proceso], [rel])
    const result = await getOrBuildFlashcardDeck(brain, new InMemoryDeckStore(), { language: 'es' })

    assert.equal(result.status, 'ready')
    assert.ok(result.deck)
    assert.ok(result.deck.cards.length >= 6, 'debe generar al menos 6 cards (2 defs + formula recall/app + proceso + comparación)')
    assert.equal(result.deck.coverage.status, 'complete')

    const types = new Set(result.deck.cards.map(c => c.cognitiveType))
    assert.ok(types.has('comparison'), 'debe incluir al menos una card de comparación (relación contrasts_with)')
    assert.ok(types.has('application'), 'debe incluir al menos una card de aplicación (fórmula/proceso)')

    const normalizedQuestions = result.deck.cards.map(c => normalizeSemanticText(c.question))
    assert.equal(
      new Set(normalizedQuestions).size,
      normalizedQuestions.length,
      'las preguntas generadas deben ser distintas entre sí',
    )

    console.log(`✅ Ácidos/Bases-like: ${result.deck.cards.length} cards, tipos=${[...types].join(',')}`)
  }

  console.log('\n✅ Todos los contratos con IA real de Flashcards V2 pasaron.')
}

main().catch(error => {
  console.error('❌ flashcards-v2-real-ai-contracts falló:', error)
  process.exit(1)
})
