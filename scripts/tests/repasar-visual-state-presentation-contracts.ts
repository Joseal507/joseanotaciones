import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

// ============================================================
// FINAL UI POLISH — visually distinguish PARTIAL from MISSING.
//
// Live shape reproduced here (Niño, 51/51 fully adjudicated):
//   8 correct, 4 partial, 39 missing (0 incorrect) = 51 total
//   reinforcement (pendingAcademicTargets) = 4 + 0 + 39 = 43
//
// This suite proves the DATA CONTRACT the UI polish depends on: the
// route's gap-item payload (toGapItem, app/api/alai-studyal-repasar/
// route.ts) now carries `evidence`/`missingDetail` per target, sourced
// from the SAME canonical maps as conceptStatus's "Dijiste"/"Falta" (no
// second evidence source), and a genuinely omitted target's `evidence`
// is always empty. The actual pixel-level rendering (colors/icons) lives
// in components/materias/ALAIStudyALRepasar.tsx and is not exercised
// here — this repo has no jsdom/RTL in its test stack (see the
// established pattern in every other Repasar contract file) — so this
// suite is the deterministic, non-provider-call proof that the DATA the
// component renders from is correct, complete, and never fabricated.
// ============================================================

const selection = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] })

function payloadWithCounts(correct: number, partial: number, missing: number, incorrect = 0) {
  const targets: any[] = []
  let i = 0
  for (let c = 0; c < correct; c++, i++) targets.push({ id: `u${i}`, name: `Correcto ${i}`, summary: `Contenido ${i}` })
  for (let p = 0; p < partial; p++, i++) targets.push({ id: `u${i}`, name: `Parcial ${i}`, summary: `Contenido ${i}` })
  for (let m = 0; m < missing; m++, i++) targets.push({ id: `u${i}`, name: `Ausente ${i}`, summary: `Contenido ${i}` })
  for (let x = 0; x < incorrect; x++, i++) targets.push({ id: `u${i}`, name: `Incorrecto ${i}`, summary: `Contenido ${i}` })
  return {
    payload: {
      sourceSelectionFingerprint: selection.fingerprint,
      topicsIndex: [{ id: 'topic-1', title: 'Tema', order: 0 }],
      globalOrderedAnalysis: targets.map((t, idx) => ({
        id: t.id, kind: 'concept', name: t.name, summary: t.summary, importance: 60,
        materialId: 'mat-a', pages: [1], sourceSpans: [{ page: 1, quote: t.summary }], topicId: 'topic-1', globalOrder: idx,
      })),
      uniqueConceptsIndex: [],
    },
    correctIds: targets.slice(0, correct).map(t => t.id),
    partialIds: targets.slice(correct, correct + partial).map(t => t.id),
    missingIds: targets.slice(correct + partial, correct + partial + missing).map(t => t.id),
    incorrectIds: targets.slice(correct + partial + missing).map(t => t.id),
  }
}

function extractRequestedTargetIds(messages: any[]): string[] {
  const text = (messages || []).map((m: any) => String(m?.content || '')).join('\n')
  return [...text.matchAll(/\[TARGET (\S+?)\]/g)].map(match => match[1])
}

function installMocks(payload: any, correctIds: string[], partialIds: string[], missingIds: string[], incorrectIds: string[]) {
  const snapshots = new Map<string, any>()
  const correctSet = new Set(correctIds), partialSet = new Set(partialIds), incorrectSet = new Set(incorrectIds)
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }),
    getAuthoritativeFreeSession: async () => ({ id: 'sess-vis', userId: 'user-1', processMode: 'free', sourceSelection: selection }),
    getMaterial: async () => ({ id: 'mat-a' }),
    lookupEnjoyer: async (fingerprint: string) => (fingerprint === selection.fingerprint ? payload : null),
    createRepasarSnapshotStore: () => ({
      async get(id: string) { return snapshots.get(id) || null },
      async set(snapshot: any) { snapshots.set(snapshot.snapshotId, snapshot) },
    }),
    generateValidatedLegacyJson: async ({ telemetryContext, validate, messages }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        const requestedIds = extractRequestedTargetIds(messages)
        const value = {
          targetCoverage: requestedIds.map(id => {
            if (correctSet.has(id)) return { targetId: id, status: 'covered', evidence: `evidencia real de ${id}`, demonstrated: `evidencia real de ${id}` }
            if (partialSet.has(id)) return { targetId: id, status: 'partial', evidence: `evidencia real de ${id}`, demonstrated: `evidencia real de ${id}`, missingDetail: `falta detalle de ${id}` }
            if (incorrectSet.has(id)) return { targetId: id, status: 'incorrect', evidence: `evidencia equivocada de ${id}`, demonstrated: `evidencia equivocada de ${id}` }
            return { targetId: id, status: 'missing', evidence: '' }
          }),
        }
        assert.equal(validate(value).valid, true)
        return value
      }
      // Adversarial: persona call tries its own free-text "said" for the
      // missing bucket — must never surface (single canonical source).
      const value = {
        score: 40, feedback: 'ok', summary: 'ok', strengths: [], missingConcepts: [], confusions: [],
        conceptStatus: missingIds.slice(0, 3).map(id => ({
          concept: `Ausente ${id}`, status: 'weak', importance: 'supporting',
          said: 'texto inventado por el lector, nunca debe aparecer', missing: '',
        })),
        repair: { question: '', topicLabel: '', targetConcepts: [], requiredFacts: [], optionalFacts: [], targetIds: [] },
      }
      assert.equal(validate(value).valid, true)
      return value
    },
  })
}

async function evaluate() {
  const response = await POST(new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-vis', explanation: 'Explicación de prueba suficientemente larga.', mode: 'nino' }),
  }))
  return { response, data: await response.json() }
}

function allGapItems(dm: any) {
  return [...dm.gapGroups.flatMap((g: any) => g.items), ...dm.gapRemainder]
}

async function testABC_bucketsAreDistinct() {
  const { payload, correctIds, partialIds, missingIds } = payloadWithCounts(8, 4, 39)
  installMocks(payload, correctIds, partialIds, missingIds, [])
  const { data } = await evaluate()
  const dm = data.analysis.domainMap
  const items = allGapItems(dm)
  const byId = new Map(items.map((i: any) => [i.id, i]))

  // A. covered -> never appears in the gap set at all (it's a strength, not a gap).
  for (const id of correctIds) assert.ok(!byId.has(id), `A: covered target ${id} must not appear in the gap set`)
  const strengthIds = new Set(dm.strengths.map((s: any) => s.id))
  assert.ok(correctIds.some(id => strengthIds.has(id)), 'A: covered targets appear in strengths (bounded to top 8, at least one must show)')

  // B. partial -> partial bucket, never the missing bucket.
  for (const id of partialIds) assert.equal(byId.get(id)?.status, 'demonstrated_partial', `B: ${id} must be in the partial bucket, not missing`)

  // C. missing -> missing bucket.
  for (const id of missingIds) assert.equal(byId.get(id)?.status, 'omitted', `C: ${id} must be in the missing/omitted bucket`)

  console.log('repasar-visual-state: A/B/C PASS')
}

async function testDE_partialRendersCanonicalEvidenceAndMissingDetail() {
  const { payload, correctIds, partialIds, missingIds } = payloadWithCounts(8, 4, 39)
  installMocks(payload, correctIds, partialIds, missingIds, [])
  const { data } = await evaluate()
  const items = allGapItems(data.analysis.domainMap)
  const byId = new Map(items.map((i: any) => [i.id, i]))
  for (const id of partialIds) {
    const item = byId.get(id)
    assert.ok(item?.evidence?.length, `D: partial target ${id} must render canonical evidence ("Dijiste")`)
    assert.ok(item?.missingDetail?.length, `E: partial target ${id} must render canonical missingDetail ("Falta")`)
  }
  console.log('repasar-visual-state: D/E PASS')
}

async function testF_missingNeverFabricatesEvidence() {
  const { payload, correctIds, partialIds, missingIds } = payloadWithCounts(8, 4, 39)
  installMocks(payload, correctIds, partialIds, missingIds, [])
  const { data } = await evaluate()
  const items = allGapItems(data.analysis.domainMap)
  const byId = new Map(items.map((i: any) => [i.id, i]))
  for (const id of missingIds) {
    const item = byId.get(id)
    assert.equal(item?.evidence || '', '', `F: missing target ${id} must never render fabricated evidence, even though the persona call tried to invent one`)
  }
  // Also verify the persona call's fabricated "said" never leaks into conceptStatus for a missing concept.
  const fabricated = data.analysis.conceptStatus?.find((c: any) => c.said === 'texto inventado por el lector, nunca debe aparecer')
  assert.equal(fabricated, undefined, 'F: the persona call\'s fabricated "said" for a missing concept is never surfaced')
  console.log('repasar-visual-state: F PASS')
}

async function testG_countsSumTo51() {
  const { payload, correctIds, partialIds, missingIds } = payloadWithCounts(8, 4, 39)
  installMocks(payload, correctIds, partialIds, missingIds, [])
  const { data } = await evaluate()
  const dm = data.analysis.domainMap
  assert.equal(dm.demonstratedCorrect, 8)
  assert.equal(dm.demonstratedPartial, 4)
  assert.equal(dm.omitted, 39)
  assert.equal(dm.demonstratedIncorrect, 0)
  assert.equal(dm.totalAcademicTargets, 51)
  assert.equal(dm.demonstratedCorrect + dm.demonstratedPartial + dm.demonstratedIncorrect + dm.omitted, 51,
    'G: 8 correct + 4 partial + 0 incorrect + 39 missing = 51')
  console.log('repasar-visual-state: G PASS')
}

async function testH_reinforcementEquals43() {
  const { payload, correctIds, partialIds, missingIds } = payloadWithCounts(8, 4, 39)
  installMocks(payload, correctIds, partialIds, missingIds, [])
  const { data } = await evaluate()
  const dm = data.analysis.domainMap
  assert.equal(dm.pendingAcademicTargets, 43, 'H: reinforcement = 4 partial + 0 incorrect + 39 missing = 43')
  console.log('repasar-visual-state: H PASS')
}

async function testI_partialEligibleForCorrigePrimero() {
  // Only a partial target exists as a gap — "Corrige primero" must still surface it.
  const { payload, correctIds, partialIds, missingIds } = payloadWithCounts(3, 2, 0)
  installMocks(payload, correctIds, partialIds, missingIds, [])
  const { data } = await evaluate()
  const dm = data.analysis.domainMap
  assert.ok(dm.nextPriorityTargetId, 'I: a next-priority target is selected')
  assert.ok(partialIds.includes(dm.nextPriorityTargetId), 'I: a partial target remains eligible for "Corrige primero" — never filtered out of remediation priority')
  console.log('repasar-visual-state: I PASS')
}

async function testJ_reopenPreservesSameVisualState() {
  const { payload, correctIds, partialIds, missingIds } = payloadWithCounts(4, 2, 3)
  installMocks(payload, correctIds, partialIds, missingIds, [])
  const first = await evaluate()
  // "Reopening" an attempt in this architecture restores the SAME frozen
  // snapshot's canonical verdicts (teach-check/continuation path) —
  // simulated here by re-deriving the gap payload from the identical
  // persisted domainMap-equivalent data and checking it produces the
  // exact same visual-state fields, never re-adjudicated or drifted.
  const second = await evaluate()
  const itemsA = allGapItems(first.data.analysis.domainMap)
  const itemsB = allGapItems(second.data.analysis.domainMap)
  const byIdA = new Map(itemsA.map((i: any) => [i.id, i]))
  const byIdB = new Map(itemsB.map((i: any) => [i.id, i]))
  for (const id of [...partialIds, ...missingIds]) {
    assert.deepEqual(byIdA.get(id), byIdB.get(id), `J: target ${id} keeps the identical visual-state payload (status/evidence/missingDetail) across independent evaluations of the same canonical input`)
  }
  console.log('repasar-visual-state: J PASS')
}

async function main() {
  await testABC_bucketsAreDistinct()
  await testDE_partialRendersCanonicalEvidenceAndMissingDetail()
  await testF_missingNeverFabricatesEvidence()
  await testG_countsSumTo51()
  await testH_reinforcementEquals43()
  await testI_partialEligibleForCorrigePrimero()
  await testJ_reopenPreservesSameVisualState()
  console.log('repasar-visual-state-presentation-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
