import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { isPageStudyEnabled } from '../../lib/pageStudy/featureFlags'
import { GET as setupGET, POST as setupPOST } from '../../app/api/page-study-plan/route'
import { GET as resumeGET } from '../../app/api/page-study-plan/resume/route'
import { POST as turnPOST } from '../../app/api/page-study/turn/route'
import { GET as stateGET } from '../../app/api/page-study/state/route'

async function main() {
  console.log('Testing Page Study feature flag contracts...')

  // 1. Static checks on TemaView.tsx and PageStudyMode.tsx
  const temaViewSource = readFileSync('components/materias/TemaView.tsx', 'utf8')
  const pageStudyModeSource = readFileSync('components/materias/PageStudyMode.tsx', 'utf8')

  assert.ok(temaViewSource.includes('locked: !isPageStudyEnabled()'), 'TemaView must lock page-study when disabled')
  assert.ok(temaViewSource.includes("'Próximamente'"), 'TemaView must show Próximamente label when locked')
  assert.ok(temaViewSource.includes('if (!isPageStudyEnabled()) return null'), 'readPageStudyPlanIdFromURL and openPageStudy must reject direct navigation')
  assert.ok(pageStudyModeSource.includes('if (!isPageStudyEnabled())'), 'PageStudyMode must self-guard against direct rendering')

  // 2. Dynamic checks when disabled
  process.env.NEXT_PUBLIC_PAGE_STUDY_ENABLED = 'false'
  assert.equal(isPageStudyEnabled(), false, 'isPageStudyEnabled must be false when set to "false"')

  // Test setup GET
  const reqSetupGet = new NextRequest('http://localhost:3000/api/page-study-plan?temaId=tema1')
  const resSetupGet = await setupGET(reqSetupGet)
  assert.equal(resSetupGet.status, 403, 'setup GET must return 403 when disabled')
  const jsonSetupGet = await resSetupGet.json()
  assert.equal(jsonSetupGet.error, 'PAGE_STUDY_DISABLED')

  // Test setup POST
  const reqSetupPost = new NextRequest('http://localhost:3000/api/page-study-plan', {
    method: 'POST',
    body: JSON.stringify({ temaId: 'tema1', orderedMaterialIds: ['mat1'], blockSize: 15 }),
  })
  const resSetupPost = await setupPOST(reqSetupPost)
  assert.equal(resSetupPost.status, 403, 'setup POST must return 403 when disabled')
  const jsonSetupPost = await resSetupPost.json()
  assert.equal(jsonSetupPost.error, 'PAGE_STUDY_DISABLED')

  // Test resume GET
  const reqResumeGet = new NextRequest('http://localhost:3000/api/page-study-plan/resume?temaId=tema1&materialIds=mat1')
  const resResumeGet = await resumeGET(reqResumeGet)
  assert.equal(resResumeGet.status, 403, 'resume GET must return 403 when disabled')
  const jsonResumeGet = await resResumeGet.json()
  assert.equal(jsonResumeGet.error, 'PAGE_STUDY_DISABLED')

  // Test turn POST
  const reqTurnPost = new NextRequest('http://localhost:3000/api/page-study/turn', {
    method: 'POST',
    body: JSON.stringify({ planId: 'pstudy_plan:' + 'a'.repeat(64), slot: 'slot1', message: 'hola' }),
  })
  const resTurnPost = await turnPOST(reqTurnPost)
  assert.equal(resTurnPost.status, 403, 'turn POST must return 403 when disabled')
  const jsonTurnPost = await resTurnPost.json()
  assert.equal(jsonTurnPost.error, 'PAGE_STUDY_DISABLED')

  // Test state GET
  const reqStateGet = new NextRequest('http://localhost:3000/api/page-study/state?planId=' + 'pstudy_plan:' + 'a'.repeat(64))
  const resStateGet = await stateGET(reqStateGet)
  assert.equal(resStateGet.status, 403, 'state GET must return 403 when disabled')
  const jsonStateGet = await resStateGet.json()
  assert.equal(jsonStateGet.error, 'PAGE_STUDY_DISABLED')

  // 3. Dynamic checks when enabled
  process.env.NEXT_PUBLIC_PAGE_STUDY_ENABLED = 'true'
  assert.equal(isPageStudyEnabled(), true, 'isPageStudyEnabled must be true when set to "true"')

  console.log('Page Study feature flag contracts: PASS')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
