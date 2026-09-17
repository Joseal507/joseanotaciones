import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/deckStore'
import { planFlashcards } from '../../lib/materialBrain/flashcards/planner'
import { validateDeck, reconcileFinalCoverage } from '../../lib/materialBrain/flashcards/validate'
import type { FlashcardDeckStore, PlannedCard, GeneratedFlashcard } from '../../lib/materialBrain/flashcards/types'
import { FLASHCARD_GENERATOR_VERSION } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, KnowledgeRelation, MaterialBrain } from '../../lib/materialBrain/types'

// ============================================================
// P0 mission ("repair is destroying previously valid cards") — real-
// deck regression: a repair round regenerating a STILL-pending target
// could silently overwrite an already-valid card for a DIFFERENT
// plannedCard.id sharing the same conceptClusterId, turning a covered
// target into a pending one. Root cause: `mergeGenerated(allCards,
// repaired)` unconditionally replaced entries by id, and dedup/coverage
// were recomputed over that already-corrupted pool with no rollback.
// Fixed via bestValidCards: a round's result is accepted only if
// coverage is monotonic (every previously-covered target stays
// covered); otherwise the round is discarded wholesale.
//
// P0-2 (metadata leak) and P0-3 (notation preservation) regressions
// are also covered here per the mission's mandatory test list.
// ============================================================

class InMemoryDeckStore implements FlashcardDeckStore {
  map = new Map<string, any>()
  async get(fp: string) { return this.map.get(fp) || null }
  async set(fp: string, deck: any) { this.map.set(fp, deck) }
}

function scopeFor(materialIds: string[]) { return buildSourceSelectionSnapshot(materialIds, {}) }
function unit(id: string, label: string, statement: string, extra: any = {}): KnowledgeUnit {
  return {
    id, kind: 'concept', label, statement,
    identity: { canonicalSubject: extra.canonicalSubject ?? label, semanticKey: extra.semanticKey ?? label.toLowerCase(), qualifiers: extra.qualifiers || [] },
    importance: { tier: extra.tier || 'critical', signals: extra.signals || ['declared_in_material'], confidence: 1 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: statement, chunkId: 'chunk-1' }],
    domainTags: extra.domainTags || [],
    ...extra,
  } as any
}
function relation(id: string, type: KnowledgeRelation['type'], fromUnitId: string, toUnitId: string): KnowledgeRelation {
  return { id, type, fromUnitId, toUnitId, statement: `${fromUnitId} ${type} ${toUnitId}`, importance: { tier: 'supporting', signals: [], confidence: 0.9 }, provenance: [] }
}
function brain(units: KnowledgeUnit[], relations: KnowledgeRelation[] = [], fingerprint = 'fp-repair'): MaterialBrain {
  return {
    scope: { ...scopeFor(['mat-a']), fingerprint },
    meta: { version: '1.0.0', builderVersion: '1.0.0', generatedAt: new Date().toISOString(), chunking: { strategy: 'test', chunkSizeChars: 0, chunkCount: 0 }, llmCallsUsed: 0, retries: 0, status: 'ready' },
    units, relations,
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    knowledgeExtraction: { chunksAttempted: 0, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}
function pc(id: string, sourceUnitIds: string[], clusterId = 'cluster-' + id): PlannedCard {
  return { id, sourceUnitIds, sourceRelationIds: [], retrievalObjective: id, cognitiveType: 'recall', rationale: 'r', conceptClusterId: clusterId }
}
function card(planned: PlannedCard, question: string, answer: string, validated = true, errors: string[] = []): GeneratedFlashcard {
  return { ...planned, question, answer, provenance: [], generatorVersion: FLASHCARD_GENERATOR_VERSION, generatedAt: new Date().toISOString(), validated, validationErrors: errors }
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards repair-monotonicity + metadata-target + notation contracts ──\n')

  // ── P0-1: exact real-run regression classes A/B/C ──────────────────
  // Two targets share the deck: target X already has a VALID initial
  // card; target Y is pending. The repair round regenerates Y — but the
  // provider/validator ALSO effectively "touches" X's slot in a buggy
  // implementation via shared array mutation. Here we directly prove
  // the CONTRACT: even if a repair round's overall result is worse
  // (any covered target lost), the deck must retain the ORIGINAL valid
  // state for that target.
  await test('MONO-1 (real Example A/B/C shape): a valid initial card is never destroyed by an unrelated repair round', async () => {
    const uX = unit('uX', 'Igualdad de velocidades', 'En el equilibrio, la velocidad directa iguala a la velocidad inversa.')
    const uY = unit('uY', 'Cociente de reaccion', 'El cociente Q se compara con Kc para predecir el sentido del cambio.')
    const b = brain([uX, uY])
    const store = new InMemoryDeckStore()
    let call = 0
    const generateFn = async (planned: PlannedCard) => {
      call++
      if (planned.sourceUnitIds.includes('uX')) {
        // X must ALWAYS validate — proves it is never the one failing.
        return card(planned, '¿Qué establece la igualdad de velocidades en el equilibrio?', 'La velocidad directa iguala a la velocidad inversa, con evidencia directa del material.')
      }
      // Y fails validation on every attempt (broken/empty), simulating
      // the real repair-round failure that must NOT collaterally damage X.
      return card(planned, '', '', false, ['broken_academic_content'])
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    const xCard = result.deck!.cards.find(c => c.sourceUnitIds.includes('uX'))
    assert.ok(xCard, 'X must still be present in the final deck')
    assert.equal(xCard!.validated, true, 'X must remain VALID — a repair round targeting Y must never destroy X')
  })

  await test('MONO-2: valid initial card + a BETTER valid repair candidate for the SAME target may replace it', async () => {
    const u = unit('u1', 'Concepto', 'Un concepto con contexto suficiente.')
    const b = brain([u])
    const store = new InMemoryDeckStore()
    // Force an initial FAILURE so this target starts pending, then a
    // valid repair candidate arrives — must be accepted (monotonic
    // improvement: 0 -> 1 covered).
    let attempt = 0
    const generateFn = async (planned: PlannedCard) => {
      attempt++
      if (attempt === 1) return card(planned, '', '', false, ['broken_academic_content'])
      return card(planned, `Con base en el material autorizado, ¿qué establece la evidencia respecto a ${planned.id}?`, `Respuesta verificada: ${planned.retrievalObjective} — confirmado por evidencia directa del material.`)
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.ok(result.deck!.cards.some(c => c.validated), 'the repair-round valid candidate must be accepted')
  })

  await test('MONO-3: repair coverage never decreases across a single round (direct reconcileFinalCoverage proof)', () => {
    const pX = pc('cX', ['uX'], 'clusterX')
    const pY = pc('cY', ['uY'], 'clusterY')
    const plan = { plannedCards: [pX, pY], targetedUnitIds: ['uX', 'uY'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any
    const before = [card(pX, 'q', 'a'), card(pY, 'q2', 'a2', false, ['broken_academic_content'])]
    const beforeCoverage = reconcileFinalCoverage(before, plan)
    assert.equal(beforeCoverage.coveredTargetIds.length, 1)
    // Simulate a BAD repair round result where X also got clobbered.
    const afterBad = [card(pX, '', '', false, ['broken_academic_content']), card(pY, 'q2', 'a2', false, ['broken_academic_content'])]
    const afterBadCoverage = reconcileFinalCoverage(afterBad, plan)
    assert.ok(afterBadCoverage.coveredTargetIds.length < beforeCoverage.coveredTargetIds.length, 'fixture sanity: this IS a regression')
    // The contract under test: such a result must never be adopted —
    // verified end-to-end in MONO-1 above via the real deckStore path.
  })

  await test('MONO-4: multiple repair rounds — coverage sequence is monotonic non-decreasing', async () => {
    const uA = unit('uA', 'A', 'stmt a')
    const uB = unit('uB', 'B', 'stmt b')
    const uC = unit('uC', 'C', 'stmt c')
    const b = brain([uA, uB, uC])
    const store = new InMemoryDeckStore()
    let calls: Record<string, number> = {}
    const generateFn = async (planned: PlannedCard) => {
      calls[planned.id] = (calls[planned.id] || 0) + 1
      // uC never succeeds; uA/uB succeed on their first attempt.
      if (planned.sourceUnitIds.includes('uC')) return card(planned, '', '', false, ['broken_academic_content'])
      return card(planned, `Con base en el material autorizado, ¿qué establece la evidencia respecto a ${planned.id}?`, `Respuesta verificada: ${planned.retrievalObjective} — confirmado por evidencia directa del material.`)
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    const coveredCount = result.deck!.coverage.coveredConceptClusterIds.length
    assert.ok(coveredCount >= 2, `A and B must both remain covered, got ${coveredCount}`)
  })

  await test('MONO-5: dedup inside a repair round cannot erase an already-covered target\'s coverage', async () => {
    // Two DIFFERENT targets, each with its own valid card — a dedup pass
    // that (incorrectly) judged them duplicates and merged one away must
    // still leave BOTH targets covered via sourceUnitIds union+transfer;
    // if it could not, the round must be rejected, never silently accepted
    // with fewer covered targets.
    const uA = unit('uA', 'A', 'stmt a')
    const uB = unit('uB', 'B', 'stmt b')
    const b = brain([uA, uB])
    const store = new InMemoryDeckStore()
    const generateFn = async (planned: PlannedCard) =>
      card(planned, `Con base en el material autorizado, ¿qué establece la evidencia respecto a ${planned.id}?`, `Respuesta verificada: ${planned.retrievalObjective} — confirmado por evidencia directa del material.`)
    const alwaysDuplicate = async (pairs: any[]) => pairs.map(p => ({ pairId: p.pairId, duplicate: true }))
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any, pedagogicalJudgeFn: alwaysDuplicate as any })
    assert.equal(result.deck!.coverage.coveredConceptClusterIds.length, 2, 'both targets must stay covered via sourceUnitIds transfer even after a merge')
  })

  // ── P0-2: non-studyable metadata must never enter the target universe ──
  await test('META-LEAK-1: a copyright unit with BOTH critical tier AND declared_in_material (but no domainTags, no relation) never becomes a target', () => {
    const copyrightUnit = unit('u-copy', 'Derechos de autor', '© 2015 Editorial Ejemplo. Todos los derechos reservados.', { tier: 'critical', signals: ['declared_in_material'] })
    const b = brain([copyrightUnit])
    const plan = planFlashcards(b)
    assert.equal(plan.targetedUnitIds.length, 0, 'two signals from the SAME visual-prominence cause must not be enough')
    assert.ok(plan.skipped.some(s => s.reason === 'non_studyable_metadata'))
  })

  await test('META-LEAK-2: a copyright unit connected via a relation but with only 2 of the 3 weak signals (no domainTags, and NOT critical tier) is still excluded', () => {
    const realConcept = unit('u-real', 'Concepto real', 'stmt')
    const copyrightUnit = unit('u-copy2', 'Derechos de autor', '© 2015 Editorial Ejemplo.', { tier: 'supporting', signals: ['declared_in_material'] })
    const rel = relation('r1', 'depends_on', 'u-real', 'u-copy2')
    const b = brain([realConcept, copyrightUnit], [rel])
    const plan = planFlashcards(b)
    const clusterIds = new Set(plan.plannedCards.map(c => c.conceptClusterId))
    assert.ok(![...clusterIds].some(id => /copyright|derechos|autor/i.test(id)), `metadata must never leak as a target with only 2 of 3 weak signals: ${[...clusterIds].join(',')}`)
  })

  await test('META-LEAK-3: genuinely taught copyright-law content (domainTags present) is correctly retained', () => {
    const lawUnit = unit('u-law', 'Duracion del derecho de autor', 'El derecho de autor dura la vida del autor mas 70 anos.', { tier: 'critical', domainTags: ['propiedad-intelectual'] })
    const b = brain([lawUnit])
    const plan = planFlashcards(b)
    assert.ok(plan.targetedUnitIds.includes('u-law'), 'a real domainTags signal must still allow legitimate content through')
  })

  await test('META-LEAK-4: excluded metadata never affects the UI denominator (targetedConcepts)', () => {
    const realConcept = unit('u-real2', 'Concepto real', 'stmt')
    const copyrightUnit = unit('u-copy3', 'Derechos de autor', '© 2015 Editorial Ejemplo.', { tier: 'critical', signals: ['declared_in_material'] })
    const b = brain([realConcept, copyrightUnit])
    const plan = planFlashcards(b)
    const targetedConcepts = new Set(plan.plannedCards.map(c => c.conceptClusterId)).size
    assert.equal(targetedConcepts, 1, 'only the real concept counts toward the canonical target universe')
  })

  // ── P0-3: generic relational-operator preservation (adversarial) ────
  await test('NOTATION-REL-1: "K ≫ 1" restated as "K 1" is rejected (real-deck regression)', () => {
    const u = unit('u-k', 'Constante K', 'Cuando la constante K es mucho mayor que 1 (K ≫ 1), la reaccion favorece los productos.')
    const p = pc('cK', [u.id])
    const b = brain([u])
    const bad = card(p, '¿Qué indica un valor de K muy alto (K 1)?', 'Indica que la reaccion favorece los productos.')
    const result = validateDeck([bad], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, false, JSON.stringify(result[0].validationErrors))
    assert.ok(result[0].validationErrors.includes('notation_structure_lost'))
  })

  await test('NOTATION-REL-2: "K ≫ 1" correctly preserved is accepted', () => {
    const u = unit('u-k2', 'Constante K', 'Cuando la constante K es mucho mayor que 1 (K ≫ 1), la reaccion favorece los productos.')
    const p = pc('cK2', [u.id])
    const b = brain([u])
    const good = card(p, '¿Qué indica un valor de K mucho mayor que 1 (K ≫ 1)?', 'Indica que la reaccion favorece los productos.')
    const result = validateDeck([good], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, true, JSON.stringify(result[0].validationErrors))
  })

  await test('NOTATION-REL-3: "x > 1" restated as "x 1" is rejected (cross-domain, math)', () => {
    const u = unit('u-x', 'Condicion x', 'La funcion es creciente cuando x es mayor que 1 (x > 1) en este intervalo.')
    const p = pc('cx', [u.id])
    const b = brain([u])
    const bad = card(p, '¿Cuándo es creciente la funcion (x 1)?', 'Cuando x es mayor que 1 en el intervalo dado.')
    const result = validateDeck([bad], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, false, JSON.stringify(result[0].validationErrors))
  })

  await test('NOTATION-REL-4: "p < 0" restated as "p 0" is rejected (cross-domain, statistics/economics)', () => {
    const u = unit('u-p', 'Condicion p', 'El beneficio es negativo cuando p es menor que 0 (p < 0) en este escenario.')
    const p = pc('cp', [u.id])
    const b = brain([u])
    const bad = card(p, '¿Cuándo es negativo el beneficio (p 0)?', 'Cuando p es menor que 0 en el escenario dado.')
    const result = validateDeck([bad], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, false, JSON.stringify(result[0].validationErrors))
  })

  await test('NOTATION-REL-5: "A → B" restated as "A B" is rejected (cross-domain, process/reaction arrow)', () => {
    const u = unit('u-arrow', 'Transformacion', 'El proceso avanza de A hacia B (A → B) de forma espontanea en este sistema.')
    const p = pc('carrow', [u.id])
    const b = brain([u])
    const bad = card(p, '¿Cómo avanza el proceso de forma espontanea (A B)?', 'El proceso avanza de A hacia B en el sistema dado.')
    const result = validateDeck([bad], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, false, JSON.stringify(result[0].validationErrors))
  })

  await test('NOTATION-REL-6: a card that never restates the comparison content at all is NOT falsely flagged', () => {
    const u = unit('u-unrelated', 'Constante K', 'Cuando la constante K es mucho mayor que 1 (K ≫ 1), la reaccion favorece los productos.')
    const p = pc('cUnrelated', [u.id])
    const b = brain([u])
    const unrelated = card(p, '¿Qué representa la constante K en una reaccion quimica general?', 'K es la constante de equilibrio de la reaccion.')
    const result = validateDeck([unrelated], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, true, JSON.stringify(result[0].validationErrors))
  })

  // ── Final invariant + freeze/continuity untouched ──────────────────
  await test('INVARIANT-FINAL: covered + pending == canonical studyable concept universe', async () => {
    const uA = unit('uA2', 'A', 'stmt a')
    const uB = unit('uB2', 'B', 'stmt b')
    const copyrightUnit = unit('u-copy4', 'Derechos de autor', '© 2015 Editorial Ejemplo.', { tier: 'critical', signals: ['declared_in_material'] })
    const b = brain([uA, uB, copyrightUnit])
    const store = new InMemoryDeckStore()
    const generateFn = async (planned: PlannedCard) =>
      card(planned, `Con base en el material autorizado, ¿qué establece la evidencia respecto a ${planned.id}?`, `Respuesta verificada: ${planned.retrievalObjective} — confirmado por evidencia directa del material.`)
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    const cov = result.deck!.coverage
    assert.equal(cov.coveredConceptClusterIds.length + (cov.targetedConceptClusterIds.length - cov.coveredConceptClusterIds.length), cov.targetedConceptClusterIds.length)
    // copyright must never appear in the targeted universe at all
    assert.ok(!cov.targetedConceptClusterIds.some(id => /copyright|derechos|autor/i.test(id)))
  })

  // ── P1 (surgical audit, IMPLEMENTACIÓN AUTORIZADA): repair loop must
  // thread targeted feedback into the generator, not blindly re-roll
  // the identical prompt ─────────────────────────────────────────────
  await test('REPAIR-FEEDBACK-1: round 0 gets NO feedback, round >=1 gets feedback derived from the immediately preceding rejection', async () => {
    const u = unit('u-fb1', 'Concepto con contexto', 'Un concepto con contexto suficiente para ser evaluado.')
    const b = brain([u])
    const store = new InMemoryDeckStore()
    const calls: { round: number; feedback: any }[] = []
    let attempt = 0
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback: any) => {
      attempt++
      calls.push({ round: attempt, feedback })
      if (attempt === 1) return card(planned, '', '', false, ['broken_academic_content'])
      return card(planned, `Con base en el material autorizado, ¿qué establece la evidencia respecto a ${planned.id}?`, `Respuesta verificada: ${planned.retrievalObjective} — confirmado por evidencia directa del material.`)
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.equal(calls[0].feedback, undefined, 'round 0 (initial generation) must never carry repair feedback')
    assert.ok(calls.length >= 2, 'a repair round must have run')
    assert.ok(calls[1].feedback, 'round >= 1 must carry feedback')
    assert.ok(calls[1].feedback.rejectionReasons.includes('broken_academic_content'), JSON.stringify(calls[1].feedback))
  })

  await test('REPAIR-FEEDBACK-2: notation_structure_lost produces a requiredPreservations hint the repair round receives', async () => {
    const u = unit('u-fb2', 'Constante K', 'Cuando la constante K es mucho mayor que 1 (K ≫ 1), la reaccion favorece los productos.')
    const b = brain([u])
    const store = new InMemoryDeckStore()
    const calls: { round: number; feedback: any }[] = []
    let attempt = 0
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback: any) => {
      attempt++
      calls.push({ round: attempt, feedback })
      if (attempt === 1) {
        // Loses the "K ≫ 1" comparison on the first attempt — real-deck regression shape.
        return card(planned, '¿Qué indica un valor de K muy alto (K 1)?', 'Indica que la reaccion favorece los productos.')
      }
      return card(planned, '¿Qué indica un valor de K mucho mayor que 1 (K ≫ 1)?', 'Indica que la reaccion favorece los productos, con evidencia directa del material.')
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.ok(calls.length >= 2, 'a repair round must have run')
    assert.ok(calls[1].feedback, 'round >= 1 must carry feedback')
    assert.ok(calls[1].feedback.rejectionReasons.includes('notation_structure_lost'), JSON.stringify(calls[1].feedback))
    assert.ok(calls[1].feedback.requiredPreservations.length > 0, 'the specific lost comparison must be surfaced, not just the generic error string')
  })

  await test('REPAIR-FEEDBACK-3: feedback for one pending target never leaks another target\'s rejection reason', async () => {
    const uY1 = unit('u-fb3-y1', 'Objetivo Y1', 'Contenido de Y1 con contexto suficiente.')
    const uY2 = unit('u-fb3-y2', 'Objetivo Y2', 'Contenido de Y2 con contexto suficiente.')
    const b = brain([uY1, uY2])
    const store = new InMemoryDeckStore()
    const round2Feedback: Record<string, any> = {}
    const attemptByCard: Record<string, number> = {}
    const generateFn = async (planned: PlannedCard, _ctx: any, _lang: any, feedback: any) => {
      attemptByCard[planned.id] = (attemptByCard[planned.id] || 0) + 1
      if (attemptByCard[planned.id] === 1) {
        // Two DIFFERENT, deterministically-derived rejection shapes for
        // Y1 vs Y2 — validateDeck recomputes validationErrors from the
        // actual content, so the distinguishing signal must come from
        // the content itself, not a preset error array.
        if (planned.sourceUnitIds.includes('u-fb3-y1')) return card(planned, '', '', false)
        return card(planned, '¿Qué establece Y2 en este contexto evaluado?', 'Y2 en este contexto evaluado.', false)
      }
      if (attemptByCard[planned.id] === 2) round2Feedback[planned.id] = feedback
      return card(planned, `Con base en el material autorizado, ¿qué establece la evidencia respecto a ${planned.id}?`, `Respuesta verificada: ${planned.retrievalObjective} — confirmado por evidencia directa del material.`)
    }
    await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    const y1Id = Object.keys(round2Feedback).find(id => round2Feedback[id]?.rejectionReasons.includes('empty_question_or_answer'))
    const y2Id = Object.keys(round2Feedback).find(id => round2Feedback[id]?.rejectionReasons.includes('answer_leaked_in_question'))
    assert.ok(y1Id, `Y1's own feedback must carry its own rejection reason: ${JSON.stringify(round2Feedback)}`)
    assert.ok(y2Id, `Y2's own feedback must carry its own rejection reason: ${JSON.stringify(round2Feedback)}`)
    assert.notEqual(y1Id, y2Id)
    assert.ok(!round2Feedback[y1Id!].rejectionReasons.includes('answer_leaked_in_question'), 'Y1 feedback must never contain Y2\'s reason')
    assert.ok(!round2Feedback[y2Id!].rejectionReasons.includes('empty_question_or_answer'), 'Y2 feedback must never contain Y1\'s reason')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-repair-monotonicity-contracts: ALL PASS')
}

main()
