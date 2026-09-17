import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot, filterTextToSelectedPages } from '../../lib/adaptive/sourceSelection'
import { buildMaterialBrain, MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import { extractChunk, type RawExtractedUnit, type RawExtractedRelation, type ChunkExtractionResult } from '../../lib/materialBrain/extraction'
import { decideMerge, buildIdentity, mergeKindGroup } from '../../lib/materialBrain/identity'
import { mergeExtractions } from '../../lib/materialBrain/merge'
import { FileMaterialBrainStore, InMemoryMaterialBrainStore, lookupMaterialBrain } from '../../lib/materialBrain/cache'
import { sourceRefKey } from '../../lib/materialBrain/types'
import type { MaterialBrain, PageChunk, ResolvedSourceMaterial } from '../../lib/materialBrain/types'
import {
  FALCONS_MATERIAL, ACIDS_BASES_MATERIAL,
  MULTI_MATERIAL_A, MULTI_MATERIAL_B,
  CONFLICT_MATERIAL_A, CONFLICT_MATERIAL_B,
  FORMULA_MATERIAL, PROCESS_MATERIAL,
  RESONANCE_PHYSICS_MATERIAL, RESONANCE_CHEMISTRY_MATERIAL,
  MULTI_EXPANDED_1_MECHANICS, MULTI_EXPANDED_2_THERMO,
  MULTI_EXPANDED_3_ELECTRO, MULTI_EXPANDED_4_OPTICS,
  generateLargeScaleSyntheticExtractions,
} from '../materialBrain/fixtures'

// ============================================================
// Harness de validación del núcleo de Material Brain — Fase 1.
// Corre casos A-H con LLM real (no mockeado — mismo criterio que
// otros *-contracts.ts del repo que ejercen generación real).
// Imprime métricas completas por caso y ejemplos de merges.
// ============================================================

function scopeFor(materials: { materialId: string; pages?: number[] }[]) {
  const materialIds = materials.map(m => m.materialId)
  const selectedPages = Object.fromEntries(materials.map(m => [m.materialId, m.pages || []]))
  return buildSourceSelectionSnapshot(materialIds, selectedPages)
}

function printMetrics(caseName: string, brain: MaterialBrain) {
  const byKind: Record<string, number> = {}
  const byTier: Record<string, number> = {}
  for (const u of brain.units) {
    byKind[u.kind] = (byKind[u.kind] || 0) + 1
    byTier[u.importance.tier] = (byTier[u.importance.tier] || 0) + 1
  }
  const merged = brain.mergeLog.filter(e => e.kind === 'merged').length
  const notMerged = brain.mergeLog.filter(e => e.kind === 'not_merged').length
  const unitsWithoutProvenance = brain.units.filter(u => u.provenance.length === 0).length

  console.log(`\n=== ${caseName} ===`)
  console.log(`materiales: ${brain.scope.materialIds.join(', ')}`)
  console.log(`páginas solicitadas (materialId:page): ${brain.sourceCoverage.requested.map(r => `${r.materialId}:${r.page}`).join(', ')}`)
  console.log(`páginas procesadas: ${brain.sourceCoverage.processed.map(r => `${r.materialId}:${r.page}`).join(', ')}`)
  console.log(`páginas faltantes: ${brain.sourceCoverage.missing.map(r => `${r.materialId}:${r.page}`).join(', ') || '(ninguna)'}`)
  console.log(`sourceCoverage.status: ${brain.sourceCoverage.status}`)
  console.log(`units antes de merge (raw): ${brain.knowledgeExtraction.unitsExtractedRaw}`)
  console.log(`units después de merge: ${brain.units.length}`)
  console.log(`duplicates merged (mergeLog): ${merged} | not_merged deliberado: ${notMerged}`)
  console.log(`units por kind: ${JSON.stringify(byKind)}`)
  console.log(`importance (critical/supporting/contextual): ${JSON.stringify(byTier)}`)
  console.log(`relations: ${brain.relations.length}`)
  console.log(`relaciones descartadas por ambigüedad: ${brain.knowledgeExtraction.droppedAmbiguousRelations}`)
  console.log(`units sin provenance: ${unitsWithoutProvenance}`)
  console.log(`invalid provenance descartado (extracción): ${brain.knowledgeExtraction.unitsWithoutValidProvenance}`)
  console.log(`inválido estructural descartado (extracción): ${brain.knowledgeExtraction.invalidStructural}`)
  console.log(`chunks: ${brain.meta.chunking.chunkCount} | retries: ${brain.meta.retries} | llmCalls: ${brain.meta.llmCallsUsed}`)
  console.log(`warnings: ${brain.knowledgeExtraction.warnings.length}`)
  console.log(`status final: ${brain.meta.status}`)

  const mergedSamples = brain.mergeLog.filter(e => e.kind === 'merged').slice(0, 3)
  for (const entry of mergedSamples) console.log(`  MERGED: ${entry.reason}`)
  const notMergedSamples = brain.mergeLog.filter(e => e.kind === 'not_merged').slice(0, 3)
  for (const entry of notMergedSamples) console.log(`  NOT MERGED: ${entry.reason}`)
}

function assertProvenanceIntegrity(brain: MaterialBrain, validMaterialIds: Set<string>) {
  for (const unit of brain.units) {
    assert.ok(unit.provenance.length > 0, `unidad ${unit.id} sin provenance`)
    for (const prov of unit.provenance) {
      assert.ok(validMaterialIds.has(prov.materialId), `provenance con materialId ajeno al scope: ${prov.materialId}`)
      assert.ok(prov.quote.trim().length > 0, `provenance sin quote en unidad ${unit.id}`)
      assert.ok(Number.isInteger(prov.page) && prov.page > 0, `provenance con page inválida en unidad ${unit.id}`)
    }
  }
}

async function main() {
  const results: Record<string, MaterialBrain> = {}

  // ============================================================
  // UNIT TESTS DETERMINÍSTICOS — Task A, B, C (sin llamadas LLM)
  // ============================================================
  console.log('\n--- UNIT TESTS DETERMINÍSTICOS: Identity & Relation Ambiguity ---')

  // A. decideMerge() conflicting_qualifiers
  {
    const idA = buildIdentity('concept', 'Resonancia', ['fisica', 'mecanica'])
    const idB = buildIdentity('concept', 'Resonancia', ['quimica', 'organica'])
    const statementA = 'La resonancia ocurre cuando una fuerza periódica coincide con la frecuencia natural de oscilación.'
    const statementB = 'La resonancia describe la deslocalización de electrones en moléculas con estructuras de Lewis resonantes.'
    const decision = decideMerge('concept', idA, statementA, 'concept', idB, statementB)

    console.log(`  Unit test decideMerge conflicting_qualifiers: reason=${decision.reason} merge=${decision.merge}`)
    assert.equal(decision.merge, false, 'decideMerge debe devolver merge: false ante calificadores disjuntos')
    assert.equal(decision.reason, 'conflicting_qualifiers', 'decideMerge debe devolver reason: conflicting_qualifiers')
  }

  // B & C. resolveRelations() determinismo y descarte por ambigüedad
  {
    const synthChunk: PageChunk = {
      id: 'chunk_unit_test',
      materialId: 'mat_test',
      pages: [1],
      order: 1,
      text: '[Pagina 1] Texto de prueba unitaria.',
    }

    const mockExtraction = {
      units: [
        {
          kind: 'concept' as const,
          canonicalSubject: 'Resonancia',
          qualifiers: ['mecanica'],
          label: 'Resonancia mecánica',
          statement: 'Resonancia en sistemas oscilatorios mecánicos.',
          quote: 'Texto de prueba',
          page: 1,
          domainTags: ['fisica'],
          modelSuggestedTier: 'supporting' as const,
        },
        {
          kind: 'concept' as const,
          canonicalSubject: 'Resonancia',
          qualifiers: ['quimica'],
          label: 'Resonancia química',
          statement: 'Resonancia por deslocalización electrónica.',
          quote: 'Texto de prueba',
          page: 1,
          domainTags: ['quimica'],
          modelSuggestedTier: 'supporting' as const,
        },
        {
          kind: 'concept' as const,
          canonicalSubject: 'Frecuencia natural',
          qualifiers: [],
          label: 'Frecuencia natural',
          statement: 'Frecuencia propia a la que oscila un sistema.',
          quote: 'Texto de prueba',
          page: 1,
          domainTags: ['fisica'],
          modelSuggestedTier: 'supporting' as const,
        },
      ],
      relations: [
        // Relación 1: contextualizada hacia 'mecanica' -> debe resolverse a la unidad de física
        {
          type: 'depends_on' as const,
          fromSubject: 'Resonancia mecanica',
          toSubject: 'Frecuencia natural',
          statement: 'La resonancia mecánica depende de la frecuencia natural',
          quote: 'Texto de prueba',
          page: 1,
        },
        // Relación 2: totalmente ambigua ("Resonancia" genérica sin contexto diferencial) -> debe descartarse
        {
          type: 'causes' as const,
          fromSubject: 'Resonancia',
          toSubject: 'Frecuencia natural',
          statement: 'La resonancia general produce efectos',
          quote: 'Texto de prueba',
          page: 1,
        },
      ],
      warnings: [],
      droppedInvalidProvenance: 0,
      droppedStructural: 0,
    }

    const mergeRes = mergeExtractions([{ chunk: synthChunk, extraction: mockExtraction }])
    console.log(`  Unit test resolveRelations: relations=${mergeRes.relations.length}, droppedAmbiguous=${mergeRes.droppedAmbiguousRelations}`)
    assert.equal(mergeRes.relations.length, 1, 'debe resolver exactamente 1 relación con desempate claro')
    assert.equal(mergeRes.droppedAmbiguousRelations, 1, 'debe registrar exactamente 1 relación descartada por ambigüedad')
    assert.ok(
      mergeRes.relationWarnings.some(w => w.includes('relación descartada (ambigua entre 2 candidatas)')),
      'debe incluir warning auditable con formato exacto',
    )
  }

  // ---------- CASE A — Falcons ----------
  {
    const scope = scopeFor([{ materialId: FALCONS_MATERIAL.materialId }])
    const brain = await buildMaterialBrain(scope, [FALCONS_MATERIAL], { chunkSizeChars: 900 })
    results.A = brain
    printMetrics('CASE A — Falcons', brain)

    assert.equal(brain.sourceCoverage.status, 'complete', 'Falcons: sourceCoverage debe ser complete')
    assert.equal(brain.meta.status, 'ready')
    assertProvenanceIntegrity(brain, new Set([FALCONS_MATERIAL.materialId]))
    assert.ok(
      brain.units.length < 40,
      `Falcons: ${brain.units.length} unidades — no debe inflarse artificialmente para 2 páginas narrativas cortas`,
    )
    assert.ok(brain.units.length > 0, 'Falcons: debe extraer al menos algo de conocimiento real')
  }

  // ---------- CASE B — Ácidos/Bases ----------
  {
    const scope = scopeFor([{ materialId: ACIDS_BASES_MATERIAL.materialId }])
    const brain = await buildMaterialBrain(scope, [ACIDS_BASES_MATERIAL], { chunkSizeChars: 900 })
    results.B = brain
    printMetrics('CASE B — Ácidos/Bases', brain)

    assert.equal(brain.sourceCoverage.status, 'complete', 'Ácidos/Bases: sourceCoverage debe ser complete')
    assertProvenanceIntegrity(brain, new Set([ACIDS_BASES_MATERIAL.materialId]))
    assert.ok(
      brain.units.length > results.A.units.length,
      `Ácidos/Bases (${brain.units.length}) debe tener más unidades que Falcons (${results.A.units.length}) — hay más conocimiento real`,
    )

    const arrhenius = brain.units.filter(u => u.identity.qualifiers.some(q => q.includes('arrhenius')))
    const brønstedLowry = brain.units.filter(u => u.identity.qualifiers.some(q => q.includes('bronsted') || q.includes('lowry')))
    console.log(`  unidades con qualifier arrhenius: ${arrhenius.length} | bronsted-lowry: ${brønstedLowry.length}`)
    if (arrhenius.length && brønstedLowry.length) {
      const overlap = arrhenius.filter(a => brønstedLowry.some(b => b.id === a.id))
      assert.equal(overlap.length, 0, 'Arrhenius y Brønsted-Lowry no deben terminar en la misma unidad')
    }

    const formulaUnits = brain.units.filter(u => u.kind === 'formula')
    const processUnits = brain.units.filter(u => u.kind === 'process')
    console.log(`  formula units: ${formulaUnits.length} | process units: ${processUnits.length}`)
    assert.ok(formulaUnits.length > 0, 'Ácidos/Bases debe preservar al menos una fórmula (Kw, pH, etc.)')
    assert.ok(processUnits.length > 0, 'Ácidos/Bases debe preservar el procedimiento de cálculo de pH como process')
  }

  // ---------- CASE C — multi-material ----------
  {
    const scope = scopeFor([{ materialId: MULTI_MATERIAL_A.materialId }, { materialId: MULTI_MATERIAL_B.materialId }])
    const brain = await buildMaterialBrain(scope, [MULTI_MATERIAL_A, MULTI_MATERIAL_B], { chunkSizeChars: 900 })
    results.C = brain
    printMetrics('CASE C — Multi-material', brain)

    assert.equal(brain.sourceCoverage.status, 'complete')
    assertProvenanceIntegrity(brain, new Set([MULTI_MATERIAL_A.materialId, MULTI_MATERIAL_B.materialId]))

    assert.equal(brain.sourceCoverage.requested.length, 4, 'debe pedir exactamente 4 fuentes: 2 materiales x 2 páginas')
    const page2A = sourceRefKey({ materialId: MULTI_MATERIAL_A.materialId, page: 2 })
    const page2B = sourceRefKey({ materialId: MULTI_MATERIAL_B.materialId, page: 2 })
    assert.notEqual(page2A, page2B, 'page 2 de A y page 2 de B deben ser claves de cobertura distintas')
    assert.ok(brain.sourceCoverage.requested.some(r => sourceRefKey(r) === page2A))
    assert.ok(brain.sourceCoverage.requested.some(r => sourceRefKey(r) === page2B))

    const ohmUnits = brain.units.filter(u => u.identity.semanticKey.includes('ley') && u.identity.semanticKey.includes('ohm'))
    console.log(`  unidades "ley de ohm": ${ohmUnits.length}`)
    const ohmWithBothMaterials = ohmUnits.find(u => {
      const materialIds = new Set(u.provenance.map(p => p.materialId))
      return materialIds.has(MULTI_MATERIAL_A.materialId) && materialIds.has(MULTI_MATERIAL_B.materialId)
    })
    assert.ok(ohmWithBothMaterials, 'la ley de Ohm (compartida por A y B) debe fusionarse en una unidad con provenance de ambos materiales')

    const serieUnit = brain.units.find(u => u.identity.semanticKey.includes('serie'))
    const paraleloUnit = brain.units.find(u => u.identity.semanticKey.includes('paralelo'))
    assert.ok(serieUnit, 'el concepto exclusivo de Material A (circuito en serie) debe sobrevivir')
    assert.ok(paraleloUnit, 'el concepto exclusivo de Material B (circuito en paralelo) debe sobrevivir')
  }

  // ---------- CASE D — conflicto (no fusionar) ----------
  {
    const scope = scopeFor([{ materialId: CONFLICT_MATERIAL_A.materialId }, { materialId: CONFLICT_MATERIAL_B.materialId }])
    const brain = await buildMaterialBrain(scope, [CONFLICT_MATERIAL_A, CONFLICT_MATERIAL_B], { chunkSizeChars: 900 })
    results.D = brain
    printMetrics('CASE D — Conflicto', brain)

    assert.equal(brain.sourceCoverage.status, 'complete')
    const boilingUnits = brain.units.filter(u => u.identity.semanticKey.includes('ebullicion') || u.identity.semanticKey.includes('hierve'))
    console.log(`  unidades "punto de ebullición": ${boilingUnits.length}`)
    assert.ok(
      boilingUnits.length >= 2,
      `las dos afirmaciones sobre punto de ebullición (nivel del mar vs. altitud) deben permanecer SEPARADAS, encontradas: ${boilingUnits.length}`,
    )
  }

  // ---------- CASE E — fórmulas ----------
  {
    const scope = scopeFor([{ materialId: FORMULA_MATERIAL.materialId }])
    const brain = await buildMaterialBrain(scope, [FORMULA_MATERIAL], { chunkSizeChars: 900 })
    results.E = brain
    printMetrics('CASE E — Fórmulas', brain)

    assert.equal(brain.sourceCoverage.status, 'complete')
    assertProvenanceIntegrity(brain, new Set([FORMULA_MATERIAL.materialId]))
    const formulaUnits = brain.units.filter(u => u.kind === 'formula')
    assert.ok(formulaUnits.length >= 1, 'debe extraer al menos la fórmula F = m·a')
    const withVariables = formulaUnits.filter(u => u.kind === 'formula' && (u as any).variables?.length >= 2)
    assert.ok(withVariables.length >= 1, 'la fórmula debe traer al menos 2 variables (m, a)')
  }

  // ---------- CASE F — proceso ----------
  {
    const scope = scopeFor([{ materialId: PROCESS_MATERIAL.materialId }])
    const brain = await buildMaterialBrain(scope, [PROCESS_MATERIAL], { chunkSizeChars: 900 })
    results.F = brain
    printMetrics('CASE F — Proceso', brain)

    assert.equal(brain.sourceCoverage.status, 'complete')
    const processUnits = brain.units.filter(u => u.kind === 'process')
    assert.equal(processUnits.length, 1, `debe haber EXACTAMENTE 1 unidad process (los 5 pasos no deben fragmentarse), encontradas: ${processUnits.length}`)
    const steps = (processUnits[0] as any).steps as { order: number; text: string }[]
    console.log(`  pasos extraídos: ${steps.length}`)
    assert.ok(steps.length >= 3, 'el proceso debe conservar varios pasos ordenados')
    const orders = steps.map(s => s.order)
    assert.deepEqual(orders, [...orders].sort((a, b) => a - b), 'los pasos deben quedar en orden')
  }

  // ---------- CASE G — selección parcial ----------
  {
    const fullScope = scopeFor([{ materialId: ACIDS_BASES_MATERIAL.materialId }])
    const partialPages = [1, 2]
    const partialScope = scopeFor([{ materialId: ACIDS_BASES_MATERIAL.materialId, pages: partialPages }])
    assert.notEqual(fullScope.fingerprint, partialScope.fingerprint, 'la selección parcial debe tener un fingerprint distinto al documento completo')

    const filteredText = filterTextToSelectedPages(ACIDS_BASES_MATERIAL.text, partialPages)
    const partialMaterial: ResolvedSourceMaterial = { ...ACIDS_BASES_MATERIAL, text: filteredText, knownPages: partialPages }
    const brain = await buildMaterialBrain(partialScope, [partialMaterial], { chunkSizeChars: 900 })
    results.G = brain
    printMetrics('CASE G — Selección parcial (páginas 1-2)', brain)

    assert.equal(brain.sourceCoverage.status, 'complete')
    assert.equal(brain.sourceCoverage.requested.length, 2, 'solo deben pedirse las 2 páginas seleccionadas, no las 5 del documento completo')
    for (const unit of brain.units) {
      for (const prov of unit.provenance) {
        assert.ok(prov.page <= 2, `unidad ${unit.id} tiene provenance de página ${prov.page}, fuera de la selección parcial [1,2]`)
      }
    }
    const mentionsKw = brain.units.some(u => u.identity.semanticKey.includes('kw') || u.label.toLowerCase().includes('autoionizacion'))
    assert.ok(!mentionsKw, 'contenido de la página 3 (autoionización/Kw) no debe aparecer — no estaba en la selección')
  }

  // ---------- CASE H — fallo parcial / retry dirigido ----------
  {
    let attempts = 0
    const flakyOnceFn: typeof extractChunk = async (chunk: PageChunk, label: string) => {
      attempts++
      if (attempts === 1) {
        return { extraction: { units: [], relations: [], warnings: [`chunk ${chunk.id} falló extracción tras agotar reintentos: fallo simulado (H1)`], droppedInvalidProvenance: 0, droppedStructural: 0 } }
      }
      return extractChunk(chunk, label)
    }
    const scope = scopeFor([{ materialId: FORMULA_MATERIAL.materialId }])
    const brainRecovered = await buildMaterialBrain(scope, [FORMULA_MATERIAL], { chunkSizeChars: 900, extractFn: flakyOnceFn, maxDirectedRetries: 2 })
    printMetrics('CASE H1 — Fallo transitorio (se recupera)', brainRecovered)
    assert.equal(brainRecovered.meta.status, 'ready', 'H1: tras el reintento dirigido, debe quedar ready')
    assert.ok(brainRecovered.meta.retries >= 1, 'H1: debe haber al menos 1 reintento registrado')
    assert.equal(brainRecovered.sourceCoverage.missing.length, 0)

    const alwaysFailSecondChunk: typeof extractChunk = async (chunk: PageChunk, label: string) => {
      if (chunk.pages.includes(2)) {
        return { extraction: { units: [], relations: [], warnings: [`chunk ${chunk.id} falló extracción tras agotar reintentos: fallo simulado (H2, permanente)`], droppedInvalidProvenance: 0, droppedStructural: 0 } }
      }
      return extractChunk(chunk, label)
    }
    const scopeH2 = scopeFor([{ materialId: MULTI_MATERIAL_A.materialId }])
    const brainPartial = await buildMaterialBrain(scopeH2, [MULTI_MATERIAL_A], { chunkSizeChars: 400, extractFn: alwaysFailSecondChunk, maxDirectedRetries: 1 })
    printMetrics('CASE H2 — Fallo permanente (queda partial)', brainPartial)
    assert.equal(brainPartial.meta.status, 'partial', 'H2: debe quedar partial, nunca ready falso')
    assert.equal(brainPartial.sourceCoverage.status, 'partial')
    assert.ok(
      brainPartial.sourceCoverage.missing.some(r => r.materialId === MULTI_MATERIAL_A.materialId && r.page === 2),
      'H2: la página 2 (la que falló) debe listarse explícitamente en missing',
    )
    assert.ok(
      brainPartial.sourceCoverage.processed.some(r => r.materialId === MULTI_MATERIAL_A.materialId && r.page === 1),
      'H2: la página 1 (la que NO falló) sí debe quedar procesada',
    )
    assert.ok(brainPartial.units.length > 0, 'H2: el conocimiento de la página que sí funcionó debe sobrevivir')
  }

  // ---------- CASE I — Colisión de identidad LLM real (Task A) ----------
  {
    const scope = scopeFor([
      { materialId: RESONANCE_PHYSICS_MATERIAL.materialId },
      { materialId: RESONANCE_CHEMISTRY_MATERIAL.materialId },
    ])
    const brain = await buildMaterialBrain(scope, [RESONANCE_PHYSICS_MATERIAL, RESONANCE_CHEMISTRY_MATERIAL], { chunkSizeChars: 900 })
    printMetrics('CASE I — Colisión de identidad real (Resonancia Física vs Química)', brain)

    assert.equal(brain.sourceCoverage.status, 'complete')
    assertProvenanceIntegrity(brain, new Set([RESONANCE_PHYSICS_MATERIAL.materialId, RESONANCE_CHEMISTRY_MATERIAL.materialId]))

    const resonanceUnits = brain.units.filter(u => u.identity.semanticKey.includes('resonancia'))
    console.log(`  unidades con semanticKey "resonancia": ${resonanceUnits.length}`)
    assert.ok(
      resonanceUnits.length >= 2,
      `debe mantener al menos 2 unidades de resonancia separadas (física vs química), encontradas: ${resonanceUnits.length}`,
    )

    const physicsUnit = resonanceUnits.find(u => u.provenance.some(p => p.materialId === RESONANCE_PHYSICS_MATERIAL.materialId))
    const chemistryUnit = resonanceUnits.find(u => u.provenance.some(p => p.materialId === RESONANCE_CHEMISTRY_MATERIAL.materialId))
    assert.ok(physicsUnit, 'la unidad de resonancia física debe existir con provenance del material de física')
    assert.ok(chemistryUnit, 'la unidad de resonancia química debe existir con provenance del material de química')
    assert.notEqual(physicsUnit?.id, chemistryUnit?.id, 'las dos unidades de resonancia deben tener IDs distintos')
  }

  // ---------- CASE J — Escala / Performance del Merge (Task D) ----------
  {
    console.log('\n=== CASE J — Benchmark de Escala del Merge (60 páginas sintéticas) ===')
    const syntheticData = generateLargeScaleSyntheticExtractions(60)
    const rawUnitCount = syntheticData.reduce((sum, d) => sum + d.extraction.units.length, 0)
    console.log(`  Páginas sintéticas: ${syntheticData.length} | Unidades raw extraídas: ${rawUnitCount}`)

    const t0 = performance.now()
    const mergeResult = mergeExtractions(syntheticData)
    const elapsedMs = performance.now() - t0

    console.log(`  Tiempo de ejecución mergeExtractions(): ${elapsedMs.toFixed(2)} ms`)
    console.log(`  Unidades finales consolidadas: ${mergeResult.units.length} | Relaciones resueltas: ${mergeResult.relations.length}`)
    console.log(`  Merges realizados: ${mergeResult.mergeLog.filter(m => m.kind === 'merged').length} | Not-merged: ${mergeResult.mergeLog.filter(m => m.kind === 'not_merged').length}`)

    assert.ok(mergeResult.units.length > 0, 'debe generar unidades consolidadas')
    assert.ok(mergeResult.units.length < rawUnitCount, 'debe consolidar unidades repetidas en los buckets')
    assert.ok(elapsedMs < 2000, `el tiempo de merge (${elapsedMs.toFixed(2)} ms) debe ser inferior a 2000 ms`)
  }

  // ---------- CASE K — Multi-material agresivo (4 materiales) (Task E) ----------
  {
    const multiMaterials = [
      MULTI_EXPANDED_1_MECHANICS,
      MULTI_EXPANDED_2_THERMO,
      MULTI_EXPANDED_3_ELECTRO,
      MULTI_EXPANDED_4_OPTICS,
    ]
    const scope = scopeFor(multiMaterials.map(m => ({ materialId: m.materialId })))
    const brain = await buildMaterialBrain(scope, multiMaterials, { chunkSizeChars: 900 })
    printMetrics('CASE K — Multi-material agresivo (4 materiales, 8 páginas)', brain)

    assert.equal(brain.sourceCoverage.status, 'complete')
    assert.equal(brain.sourceCoverage.requested.length, 8, 'debe pedir exactamente 8 fuentes: 4 materiales x 2 páginas')
    assert.equal(brain.sourceCoverage.processed.length, 8, 'debe haber procesado las 8 páginas')
    assertProvenanceIntegrity(brain, new Set(multiMaterials.map(m => m.materialId)))

    // Verificar que un concepto compartido (Ley de Ohm, presente en Mecánica y
    // Termodinámica con redacción distinta) une materiales — confirmado por el
    // propio mergeLog de este caso ("Ley de Ohm" -> "Ley de Ohm").
    const ohmUnitsK = brain.units.filter(u => u.identity.semanticKey.includes('ley') && u.identity.semanticKey.includes('ohm'))
    console.log(`  unidades "ley de ohm" en CASE K: ${ohmUnitsK.length}`)
    const sharedOhm = ohmUnitsK.find(u => {
      const matIds = new Set(u.provenance.map(p => p.materialId))
      return matIds.has(MULTI_EXPANDED_1_MECHANICS.materialId) && matIds.has(MULTI_EXPANDED_2_THERMO.materialId)
    })
    assert.ok(sharedOhm, 'la Ley de Ohm (compartida por Mecánica y Termodinámica) debe tener provenance de ambos materiales')

    // Segundo concepto compartido: "conservación de la energía" — el caso que
    // originalmente reveló que 'definition' (Mecánica) y 'concept'
    // (Termodinámica) con IDÉNTICO canonicalSubject/semanticKey no se
    // fusionaban por diferir solo en kind. Corregido en identity.ts
    // (mergeKindGroup: concept/fact/definition comparten shape, se agrupan
    // para merge; formula/process/example/event_or_data/terminology
    // permanecen aislados por conservar payload estructurado propio).
    const energyUnitsK = brain.units.filter(u => u.identity.semanticKey.includes('conservacion') && u.identity.semanticKey.includes('energia'))
    console.log(`  unidades "conservación de energía" en CASE K: ${energyUnitsK.length}`)
    const sharedEnergy = energyUnitsK.find(u => {
      const matIds = new Set(u.provenance.map(p => p.materialId))
      return matIds.has(MULTI_EXPANDED_1_MECHANICS.materialId) && matIds.has(MULTI_EXPANDED_2_THERMO.materialId)
    })
    assert.ok(sharedEnergy, 'la conservación de la energía (definition en Mecánica, concept en Termodinámica) debe fusionarse con provenance de ambos materiales')

    // Verificar que conceptos exclusivos mantienen su provenance aislado
    const snellUnit = brain.units.find(u => u.identity.semanticKey.includes('snell'))
    assert.ok(snellUnit, 'la ley de Snell debe sobrevivir')
    const snellMats = [...new Set(snellUnit.provenance.map(p => p.materialId))]
    assert.deepEqual(snellMats, [MULTI_EXPANDED_4_OPTICS.materialId], 'la ley de Snell debe pertenecer únicamente a Óptica')
  }

  // ---------- CASE L — Cache & Fingerprint Isolation (Task F) ----------
  {
    console.log('\n=== CASE L — Aislamiento de Caché y Fingerprint (FileMaterialBrainStore) ===')
    const store = new FileMaterialBrainStore()

    // Brain A: páginas [1, 2]
    const scopeA = scopeFor([{ materialId: ACIDS_BASES_MATERIAL.materialId, pages: [1, 2] }])
    const brainA = await buildMaterialBrain(scopeA, [ACIDS_BASES_MATERIAL], { chunkSizeChars: 900 })
    await store.set(scopeA.fingerprint, brainA)

    // Lookup 1: mismo fingerprint -> debe encontrarlo
    const foundA = await lookupMaterialBrain(store, scopeA.fingerprint)
    console.log(`  Lookup con fingerprint exacto: status=${foundA.status}`)
    assert.equal(foundA.status, 'ready')
    assert.equal(foundA.brain?.scope.fingerprint, scopeA.fingerprint)

    // Lookup 2: fingerprint distinto (páginas [1, 2, 3]) -> debe dar missing, NUNCA servir el Brain más chico
    const scopeB = scopeFor([{ materialId: ACIDS_BASES_MATERIAL.materialId, pages: [1, 2, 3] }])
    const missingResult = await lookupMaterialBrain(store, scopeB.fingerprint)
    console.log(`  Lookup con fingerprint ampliado ([1,2,3]): status=${missingResult.status}`)
    assert.equal(missingResult.status, 'missing', 'un fingerprint no cacheado debe dar status missing')
    assert.equal(missingResult.brain, null)

    // Lookup 3: builderVersion desactualizada -> debe tratarse como missing
    const staleBrain: MaterialBrain = {
      ...brainA,
      meta: { ...brainA.meta, builderVersion: '0.0.1-stale' },
    }
    await store.set(scopeA.fingerprint, staleBrain)
    const staleResult = await lookupMaterialBrain(store, scopeA.fingerprint)
    console.log(`  Lookup con builderVersion vieja: status=${staleResult.status}`)
    assert.equal(staleResult.status, 'missing', 'un brain con builderVersion vieja debe tratarse como missing')
    assert.equal(staleResult.brain, null)
  }

  // ---------- CASE M — Invariantes ready / partial / failed (Task G) ----------
  {
    console.log('\n=== CASE M — Invariantes ready / partial / failed y Store Integrity ===')

    // 1. Todo falla -> 'failed'
    const allFailExtractFn: typeof extractChunk = async (chunk: PageChunk) => ({
      extraction: {
        units: [],
        relations: [],
        warnings: [`chunk ${chunk.id} falló extracción: fallo simulado total`],
        droppedInvalidProvenance: 0,
        droppedStructural: 0,
      },
    })
    const scopeFail = scopeFor([{ materialId: FORMULA_MATERIAL.materialId }])
    const brainFailed = await buildMaterialBrain(scopeFail, [FORMULA_MATERIAL], { extractFn: allFailExtractFn, maxDirectedRetries: 0 })
    console.log(`  Todo falla: sourceCoverage=${brainFailed.sourceCoverage.status}, meta.status=${brainFailed.meta.status}`)
    assert.equal(brainFailed.sourceCoverage.status, 'failed')
    assert.equal(brainFailed.meta.status, 'failed')

    // 2. Fallo parcial -> 'partial'
    const partialFailExtractFn: typeof extractChunk = async (chunk: PageChunk, label: string) => {
      if (chunk.pages.includes(2)) {
        return { extraction: { units: [], relations: [], warnings: [`chunk ${chunk.id} falló extracción tras agotar reintentos: fallo simulado (CASE M, parcial)`], droppedInvalidProvenance: 0, droppedStructural: 0 } }
      }
      return extractChunk(chunk, label)
    }
    const scopePartial = scopeFor([{ materialId: MULTI_MATERIAL_A.materialId }])
    const brainPartial = await buildMaterialBrain(scopePartial, [MULTI_MATERIAL_A], { chunkSizeChars: 400, extractFn: partialFailExtractFn, maxDirectedRetries: 0 })
    console.log(`  Fallo parcial: sourceCoverage=${brainPartial.sourceCoverage.status}, meta.status=${brainPartial.meta.status}`)
    assert.equal(brainPartial.sourceCoverage.status, 'partial')
    assert.equal(brainPartial.meta.status, 'partial')

    // 3. Todo tiene éxito -> 'ready'
    const scopeReady = scopeFor([{ materialId: FORMULA_MATERIAL.materialId }])
    const brainReady = await buildMaterialBrain(scopeReady, [FORMULA_MATERIAL])
    console.log(`  Todo éxito: sourceCoverage=${brainReady.sourceCoverage.status}, meta.status=${brainReady.meta.status}`)
    assert.equal(brainReady.sourceCoverage.status, 'complete')
    assert.equal(brainReady.meta.status, 'ready')

    // 4. lookupMaterialBrain nunca sube de categoría un 'partial' cacheado
    const store = new InMemoryMaterialBrainStore()
    await store.set(scopePartial.fingerprint, brainPartial)
    const lookupPartial = await lookupMaterialBrain(store, scopePartial.fingerprint)
    console.log(`  lookupMaterialBrain sobre partial cacheado: status=${lookupPartial.status}`)
    assert.equal(lookupPartial.status, 'partial', 'lookupMaterialBrain debe reportar partial, nunca subirlo a ready')
    assert.equal(lookupPartial.brain?.meta.status, 'partial')
  }

  // ---------- helpers deterministas (sin LLM) para CASE N y CASE O ----------
  function fakeChunk(id: string, materialId: string, pages: number[]): PageChunk {
    return { id, materialId, pages, order: 0, text: '' }
  }
  function fakeUnit(overrides: Partial<RawExtractedUnit> & Pick<RawExtractedUnit, 'kind' | 'canonicalSubject' | 'page'>): RawExtractedUnit {
    return {
      qualifiers: [], label: overrides.canonicalSubject, statement: `Statement sobre ${overrides.canonicalSubject}`,
      quote: `cita sobre ${overrides.canonicalSubject}`, domainTags: [], modelSuggestedTier: null,
      ...overrides,
    }
  }
  function fakeRelation(overrides: Partial<RawExtractedRelation> & Pick<RawExtractedRelation, 'fromSubject' | 'toSubject'>): RawExtractedRelation {
    return {
      type: 'depends_on', statement: `${overrides.fromSubject} se relaciona con ${overrides.toSubject}`,
      quote: 'cita de relación', page: 1,
      ...overrides,
    }
  }
  function fakeExtraction(units: RawExtractedUnit[], relations: RawExtractedRelation[] = []): ChunkExtractionResult {
    return { units, relations, warnings: [], droppedInvalidProvenance: 0, droppedStructural: 0 }
  }

  // ---------- CASE N — Convergencia semántica cross-kind (determinístico, sin LLM) ----------
  // Cierra el riesgo 1 (Case K): 'definition' y 'concept' comparten shape
  // (KnowledgeUnitBase puro) y deben poder fusionarse cuando semanticKey +
  // qualifiers coinciden — 'formula' NUNCA debe fusionarse con ellos
  // (carga payload estructurado propio: expression/variables).
  {
    console.log('\n=== CASE N — mergeKindGroup / decideMerge determinístico ===')
    const idA = buildIdentity('definition', 'Principio de conservación de la energía', ['mecanica'])
    const idB = buildIdentity('concept', 'Principio de conservación de la energía', [])
    const decision1 = decideMerge(
      'definition', idA, 'En un sistema aislado la energía mecánica total permanece constante.',
      'concept', idB, 'La energía total de un sistema aislado permanece constante, transformándose entre formas.',
    )
    console.log(`  definition vs concept (mismo semanticKey): merge=${decision1.merge} reason=${decision1.reason}`)
    assert.equal(decision1.merge, true, 'definition y concept con mismo semanticKey/qualifiers compatibles deben fusionarse (Case K)')
    assert.equal(mergeKindGroup('definition'), mergeKindGroup('concept'))
    assert.equal(mergeKindGroup('fact'), mergeKindGroup('concept'))

    const idFormula = buildIdentity('formula', 'Principio de conservación de la energía', [])
    const decision2 = decideMerge(
      'formula', idFormula, 'ΔE = 0 en un sistema aislado.',
      'concept', idB, 'La energía total de un sistema aislado permanece constante.',
    )
    console.log(`  formula vs concept (mismo semanticKey): merge=${decision2.merge} reason=${decision2.reason}`)
    assert.equal(decision2.merge, false, 'formula NUNCA debe fusionarse con concept/fact/definition — payload estructurado distinto')
    assert.equal(decision2.reason, 'kind_mismatch')
    assert.notEqual(mergeKindGroup('formula'), mergeKindGroup('concept'))

    // conflicting_qualifiers sigue ganando dentro del grupo narrativo
    const idArrhenius = buildIdentity('definition', 'Ácido', ['arrhenius'])
    const idBronsted = buildIdentity('concept', 'Ácido', ['bronsted-lowry'])
    const decision3 = decideMerge(
      'definition', idArrhenius, 'Un ácido de Arrhenius libera H+ en agua.',
      'concept', idBronsted, 'Un ácido de Brønsted-Lowry dona protones.',
    )
    console.log(`  definition(arrhenius) vs concept(bronsted-lowry): merge=${decision3.merge} reason=${decision3.reason}`)
    assert.equal(decision3.merge, false)
    assert.equal(decision3.reason, 'conflicting_qualifiers', 'qualifiers conflictivos deben seguir ganando aunque el kind ahora sea compatible')
  }

  // ---------- CASE O — resolveSubjectWithContext determinístico (sin LLM) ----------
  {
    console.log('\n=== CASE O — resolveSubjectWithContext determinístico ===')

    // O1 — match exacto
    {
      const chunk = fakeChunk('c1', 'matO', [1])
      const units = [fakeUnit({ kind: 'concept', canonicalSubject: 'Fotosíntesis', page: 1 })]
      const relations = [fakeRelation({ fromSubject: 'Fotosíntesis', toSubject: 'Fotosíntesis', type: 'part_of' })]
      const result = mergeExtractions([{ chunk, extraction: fakeExtraction(units, relations) }])
      console.log(`  O1 exact match: relations=${result.relations.length}`)
      assert.equal(result.relations.length, 1, 'O1: match exacto debe resolver la relación')
    }

    // O2 — match contextual por qualifier (2 candidatas con MISMO semanticKey, distintos qualifiers)
    {
      const chunk = fakeChunk('c2', 'matO', [1])
      const units = [
        fakeUnit({ kind: 'definition', canonicalSubject: 'Ácido', qualifiers: ['arrhenius'], page: 1 }),
        fakeUnit({ kind: 'definition', canonicalSubject: 'Ácido', qualifiers: ['bronsted-lowry'], page: 1 }),
        fakeUnit({ kind: 'concept', canonicalSubject: 'Base fuerte', page: 1 }),
      ]
      const relations = [fakeRelation({
        fromSubject: 'Ácido', toSubject: 'Base fuerte', type: 'contrasts_with',
        statement: 'El ácido de Arrhenius contrasta con una base fuerte.',
        quote: 'según Arrhenius, el ácido libera H+',
      })]
      const result = mergeExtractions([{ chunk, extraction: fakeExtraction(units, relations) }])
      console.log(`  O2 contextual by qualifier: relations=${result.relations.length}`)
      assert.equal(result.relations.length, 1, 'O2: debe resolver usando el contexto de la relación para desambiguar por qualifier')
      const arrheniusUnit = result.units.find(u => u.identity.qualifiers.includes('arrhenius'))
      assert.ok(arrheniusUnit)
      assert.equal(result.relations[0].fromUnitId, arrheniusUnit!.id, 'O2: debe resolver al candidato Arrhenius, no al Brønsted-Lowry, por el contexto de la cita')
    }

    // O3 — substring inequívoco (un solo semanticKey candidato matchea por inclusión)
    {
      const chunk = fakeChunk('c3', 'matO', [1])
      const units = [fakeUnit({ kind: 'concept', canonicalSubject: 'Ciclo de Krebs', page: 1 })]
      const relations = [fakeRelation({ fromSubject: 'El ciclo de Krebs completo', toSubject: 'Ciclo de Krebs', type: 'part_of' })]
      const result = mergeExtractions([{ chunk, extraction: fakeExtraction(units, relations) }])
      console.log(`  O3 substring inequívoco: relations=${result.relations.length}`)
      assert.equal(result.relations.length, 1, 'O3: substring inequívoco (un solo candidato posible) debe resolver')
    }

    // O4 — substring con MÚLTIPLES candidatos -> debe DESCARTAR, nunca elegir arbitrariamente
    {
      const chunk = fakeChunk('c4', 'matO', [1])
      const units = [
        fakeUnit({ kind: 'concept', canonicalSubject: 'Ciclo de Krebs', page: 1 }),
        fakeUnit({ kind: 'concept', canonicalSubject: 'Ciclo de Calvin', page: 1 }),
      ]
      // "ciclo" es substring de ambos semanticKey ("ciclo krebs" / "ciclo calvin")
      // y ninguno de los dos es substring de "ciclo" ni viceversa en sentido
      // inverso completo -> fuerza el camino de múltiples matchingKeys.
      const relations = [fakeRelation({ fromSubject: 'el ciclo', toSubject: 'Ciclo de Krebs', type: 'part_of' })]
      const result = mergeExtractions([{ chunk, extraction: fakeExtraction(units, relations) }])
      console.log(`  O4 substring ambiguo: relations=${result.relations.length} droppedAmbiguousRelations=${result.mergeLog.filter(e => e.kind === 'not_merged').length}`)
      assert.equal(result.relations.length, 0, 'O4: substring ambiguo entre 2+ candidatos distintos debe descartarse, nunca elegir el primero arbitrariamente')
    }

    // O5 — qualifiers conflictivos / empate de score -> nunca resolver al candidato incorrecto
    {
      const chunk = fakeChunk('c5', 'matO', [1])
      const units = [
        fakeUnit({ kind: 'definition', canonicalSubject: 'Base', qualifiers: ['arrhenius'], page: 1 }),
        fakeUnit({ kind: 'definition', canonicalSubject: 'Base', qualifiers: ['bronsted-lowry'], page: 1 }),
      ]
      // Contexto neutro: no menciona ninguno de los dos qualifiers -> empate 0-0.
      const relations = [fakeRelation({
        fromSubject: 'Base', toSubject: 'Base', type: 'contrasts_with',
        statement: 'Una base es una sustancia con propiedades específicas.',
        quote: 'una base tiene propiedades específicas',
      })]
      const result = mergeExtractions([{ chunk, extraction: fakeExtraction(units, relations) }])
      console.log(`  O5 empate sin contexto: relations=${result.relations.length}`)
      assert.equal(result.relations.length, 0, 'O5: sin señal de contexto que desempate, NUNCA debe resolver al candidato incorrecto — se descarta')
    }
  }

  console.log('\n✅ Todos los casos A-O del núcleo de Material Brain pasaron exitosamente.')
}

main().catch(error => {
  console.error('❌ material-brain-core-contracts falló:', error)
  process.exit(1)
})

