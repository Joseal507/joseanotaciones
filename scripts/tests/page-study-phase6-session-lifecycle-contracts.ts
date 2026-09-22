import './page-study-env'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { createPageStudy } from '../../lib/pageStudy/service'
import { GET as resumeGET, __routeDeps as resumeDeps } from '../../app/api/page-study-plan/resume/route'
import { makeWorker } from './page-study-worker-harness'
import { planIdOf, planKeyOf } from '../../lib/pageStudy/identity'
import { normalizePlanMaterials } from '../../lib/pageStudy/batching'

/**
 * Phase 6F/C/D: real session-identity + discovery contracts, against the ACTUAL identity/storage
 * code (lib/pageStudy/identity.ts, lib/pageStudy/service.ts) and the new discovery route — not a
 * simulation. Confirms the audit finding: planId is ALREADY keyed by material INSTANCE id
 * (never content hash), and createPageStudy is ALREADY restore-first — the gap Phase 6 closes is
 * purely the DISCOVERY surface (TemaView/PageStudyMode had no way to know a session exists before
 * blindly re-running setup).
 */
const userId = 'u1'
const temaId = 'tema-lifecycle'

function materialRow(materialId: string, pagesCount: number) {
  return { id: materialId, tema_id: temaId, nombre: `${materialId}.pdf`, kind: 'pdf', upload_status: 'uploaded', text_status: 'ready', pages_count: pagesCount }
}

async function main() {
  const w = makeWorker()
  const base = { store: w.store, now: () => Date.now() }

  // ── 1/14/15. Session identity is keyed by material INSTANCE id (materialId), never filename or
  // content hash alone — proven directly against the real identity functions.
  const m1 = normalizePlanMaterials([{ materialId: 'M1', name: 'falcons.pdf', selectedPages: [1, 2] }])
  const m2 = normalizePlanMaterials([{ materialId: 'M2', name: 'falcons.pdf', selectedPages: [1, 2] }]) // SAME name/content, DIFFERENT instance id
  const planIdM1 = planIdOf(userId, temaId, planKeyOf(m1))
  const planIdM2 = planIdOf(userId, temaId, planKeyOf(m2))
  assert.notEqual(planIdM1, planIdM2, '14/15. identity depends on materialId (instance), not filename/content — two different uploads of the same PDF never collide')

  // ── Create S1 on material instance M1 (page-study service layer directly — no HTTP, no provider).
  const created1 = await createPageStudy(base, { userId, temaId, materials: [{ materialId: 'M1', name: 'falcons.pdf', selectedPages: [1, 2] }], blockSize: 2, universe: { M1: [1, 2] } })
  assert.equal(created1.created, true)
  const s1PlanId = created1.state.planId
  assert.equal(s1PlanId, planIdM1, 'S1 planId matches the deterministic identity for M1')

  // ── 2. Discovery finds NO session for a material that was never studied.
  Object.assign(resumeDeps, {
    getServerSession: async () => ({ user: { id: userId } }),
    store: w.store,
    getMaterial: async (id: string) => (id === 'M1' ? materialRow('M1', 2) : id === 'M2' ? materialRow('M2', 2) : null),
    getMaterialText: async () => ({ raw_text: '[Página 1]\ntexto\n\f\n[Página 2]\ntexto' }),
  })
  const resumeReq = (materialIds: string[]) => resumeGET(new NextRequest(`http://x/api/page-study-plan/resume?temaId=${temaId}&materialIds=${materialIds.join(',')}`))
  const noneYet = await (await resumeReq(['M2'])).json()
  assert.equal(noneYet.exists, false, '2. no active session for a fresh material instance → normal start entry')

  // ── 3/6/7/8. Discovery FINDS S1 for the same material instance M1 — read-only, zero provider
  // calls (only Worker state reads happen; nothing here touches lib/alai or any provider).
  const found = await (await resumeReq(['M1'])).json()
  assert.equal(found.exists, true, '3. an active unfinished session IS discoverable for the same material instance')
  assert.equal(found.planId, s1PlanId, '8. same PDF content + same materialId → same session when resuming')
  assert.equal(found.currentMaterialId, 'M1')
  assert.ok(found.coverage, '6/7. summary metadata (coverage/current block/updatedAt) is returned, not raw hidden state')
  assert.ok(!('concepts' in found) && !('misconceptions' in found) && !('carryover' in found), 'discovery exposes only safe summary metadata, never raw internal state')

  // ── 9/10/11. Re-uploading the SAME PDF content as a DIFFERENT material instance (M2) does NOT
  // inherit S1 — a fresh S2 is possible, isolated from S1's progress/transcript.
  const stillNoneForM2 = await (await resumeReq(['M2'])).json()
  assert.equal(stillNoneForM2.exists, false, '9. identical PDF bytes under a NEW materialId does not inherit the old session')
  const created2 = await createPageStudy(base, { userId, temaId, materials: [{ materialId: 'M2', name: 'falcons.pdf', selectedPages: [1, 2] }], blockSize: 2, universe: { M2: [1, 2] } })
  assert.equal(created2.created, true, 'S2 is a genuinely NEW session, not a restore of S1')
  assert.notEqual(created2.state.planId, s1PlanId)
  assert.deepEqual(Object.keys(created2.state.concepts), [], '10. M2/S2 starts with zero of M1/S1\'s taught concepts')
  assert.equal(created2.state.turnSeq, 0, '11. M2/S2 has no inherited transcript/turn history')

  // ── 4/5. Reopening/refreshing with the SAME material instance always resolves to the SAME S1
  // (createPageStudy is restore-first — proven directly, matching the audited service.ts contract).
  const reopened = await createPageStudy(base, { userId, temaId, materials: [{ materialId: 'M1', name: 'falcons.pdf', selectedPages: [1, 2] }], blockSize: 2, universe: { M1: [1, 2] } })
  assert.equal(reopened.created, false, '4/5. reopening the same material instance restores S1, never creates a duplicate')
  assert.equal(reopened.state.planId, s1PlanId)

  console.log('PASS page-study-phase6-session-lifecycle: identity keyed by material instance (never content/filename alone), discovery finds/omits sessions correctly, re-upload isolation, restore-on-reopen — all against the real identity/service/route code')
}

main().catch(error => { console.error(error); process.exit(1) })
