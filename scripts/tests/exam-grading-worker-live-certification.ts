import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { workerAuthHeaders } from '../../lib/worker/auth'

async function certifyDeployedWorkerCas() {
  console.log('=== DEPLOYED WORKER CAS CERTIFICATION ===')
  const api = process.env.STUDYAL_API_URL || 'https://studyal-api-dev.jose-alberto-deobaldia.workers.dev'
  console.log('Target Worker API:', api)

  // Use a strictly disposable test identity
  const testSalt = randomUUID()
  const testHash = createHash('sha256').update(`disposable-test-${testSalt}`).digest('hex')
  const identity = testHash
  const id = `exam_grading:${identity}`

  const rev1 = 'rev-1-' + randomUUID()
  const payload1 = { version: 1, identity, marker: 'initial-payload-1', attempts: { c1: 0 } }

  console.log('1. Testing expected=null inserts revision 1...')
  const res1 = await fetch(`${api}/material-results/exam-grading-cas`, {
    method: 'POST',
    headers: workerAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ id, expectedRevision: null, revision: rev1, payload: payload1 }),
  })
  assert.equal(res1.status, 200, `Expected 200 from deployed worker, got ${res1.status}`)
  const body1 = await res1.json()
  assert.equal(body1.ok, true)
  assert.equal(body1.applied, true, 'First expected=null must succeed (applied=true)')
  console.log('   -> expected=null succeeded: applied=true, revision 1 stored')

  console.log('2. Testing second expected=null loses...')
  const revDuplicate = 'rev-dup-' + randomUUID()
  const resDup = await fetch(`${api}/material-results/exam-grading-cas`, {
    method: 'POST',
    headers: workerAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ id, expectedRevision: null, revision: revDuplicate, payload: { marker: 'duplicate-null' } }),
  })
  assert.equal(resDup.status, 200)
  const bodyDup = await resDup.json()
  assert.equal(bodyDup.ok, true)
  assert.equal(bodyDup.applied, false, 'Second expected=null must lose (applied=false)')
  console.log('   -> second expected=null lost: applied=false')

  console.log('3. Testing expected=1 advances to revision 2...')
  const rev2 = 'rev-2-' + randomUUID()
  const payload2 = { version: 1, identity, marker: 'updated-payload-2', attempts: { c1: 1 } }
  const res2 = await fetch(`${api}/material-results/exam-grading-cas`, {
    method: 'POST',
    headers: workerAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ id, expectedRevision: rev1, revision: rev2, payload: payload2 }),
  })
  assert.equal(res2.status, 200)
  const body2 = await res2.json()
  assert.equal(body2.ok, true)
  assert.equal(body2.applied, true, 'expected=rev1 advancing to rev2 must succeed')
  console.log('   -> expected=1 advanced to 2: applied=true')

  console.log('4. Testing simultaneous competing requests with expected=rev2 produce exactly ONE winner...')
  const rev3A = 'rev-3A-' + randomUUID()
  const rev3B = 'rev-3B-' + randomUUID()
  const payload3A = { version: 1, identity, marker: 'winner-A' }
  const payload3B = { version: 1, identity, marker: 'winner-B' }

  const [res3A, res3B] = await Promise.all([
    fetch(`${api}/material-results/exam-grading-cas`, {
      method: 'POST',
      headers: workerAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ id, expectedRevision: rev2, revision: rev3A, payload: payload3A }),
    }),
    fetch(`${api}/material-results/exam-grading-cas`, {
      method: 'POST',
      headers: workerAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ id, expectedRevision: rev2, revision: rev3B, payload: payload3B }),
    }),
  ])
  assert.equal(res3A.status, 200)
  assert.equal(res3B.status, 200)
  const [b3A, b3B] = await Promise.all([res3A.json(), res3B.json()])
  const appliedList = [b3A.applied, b3B.applied]
  console.log('   -> Concurrent race results:', appliedList)
  assert.deepEqual(appliedList.sort(), [false, true], 'Exactly one concurrent request must win (applied=true) and one must lose (applied=false)')

  const winningRev = b3A.applied ? rev3A : rev3B
  const winningPayload = b3A.applied ? payload3A : payload3B
  console.log(`   -> Winning revision: ${winningRev}`)

  console.log('5. Testing stale expected=rev2 after revision has advanced loses...')
  const resStale = await fetch(`${api}/material-results/exam-grading-cas`, {
    method: 'POST',
    headers: workerAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ id, expectedRevision: rev2, revision: 'rev-stale-' + randomUUID(), payload: { marker: 'stale' } }),
  })
  assert.equal(resStale.status, 200)
  const bodyStale = await resStale.json()
  assert.equal(bodyStale.applied, false, 'Stale expected revision must be rejected (applied=false)')
  console.log('   -> stale expected=rev2 lost: applied=false')

  console.log('6. Verifying stored payload corresponds to the winner in D1...')
  const readRes = await fetch(`${api}/material-results/by-material?materialId=${encodeURIComponent(id)}&enfoque=mixto&resultType=exam_grading`, {
    cache: 'no-store',
    headers: workerAuthHeaders(),
  })
  assert.equal(readRes.status, 200)
  const readBody = await readRes.json()
  assert.equal(readBody.ok, true)
  assert.ok(readBody.result)
  assert.equal(readBody.result.content_hash, winningRev, 'content_hash in D1 must match winning revision')
  const storedPayload = typeof readBody.result.payload === 'string' ? JSON.parse(readBody.result.payload) : readBody.result.payload
  assert.deepEqual(storedPayload, winningPayload, 'Stored payload must match winning payload exactly')
  console.log('   -> Verified stored payload in D1 matches winner')

  console.log('\n=== ALL DEPLOYED WORKER CAS CERTIFICATIONS PASS ===')
}

certifyDeployedWorkerCas().catch(err => {
  console.error('CERTIFICATION FAILED:', err)
  process.exitCode = 1
})
