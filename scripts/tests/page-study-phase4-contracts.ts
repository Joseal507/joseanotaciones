import './page-study-env'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { POST as setupPOST, GET as setupGET, __routeDeps as setupDeps } from '../../app/api/page-study-plan/route'
import { makeWorker } from './page-study-worker-harness'
import {
  PAGE_STUDY_BLOCK_PRESETS,
  PAGE_STUDY_DEFAULT_BLOCK_SIZE,
  compactPageList,
  normalizePublicTurns,
  safePageStudyMessage,
  validatePageStudyBlockSize,
} from '../../lib/pageStudy/ui'

const tema = readFileSync('components/materias/TemaView.tsx', 'utf8')
const ui = readFileSync('components/materias/PageStudyMode.tsx', 'utf8')
const turnRoute = readFileSync('app/api/page-study/turn/route.ts', 'utf8')
const stateRoute = readFileSync('app/api/page-study/state/route.ts', 'utf8')
const setupRoute = readFileSync('app/api/page-study-plan/route.ts', 'utf8')
const academic = readFileSync('components/academic/AcademicContent.tsx', 'utf8')

async function main() {
  // A–C / X: a real fourth top-level branch. Existing three branches remain present and Page Study is not a Free tool.
  for (const mode of ["id: 'free'", "id: 'adaptive'", "id: 'manual'", "id: 'page-study'"]) assert.match(tema, new RegExp(mode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(tema, /<PageStudyMode/)
  assert.match(tema, /if \(openPageStudy\)/)
  assert.doesNotMatch(ui, /StudyALProcess|freeToolState|onOpenFlashcards|onOpenQuiz/)
  assert.match(tema, /<StudyALAdaptive/)
  assert.match(tema, /<StudyALManualProcess/)
  assert.match(tema, /<StudyALProcess/)

  // E/F: exact product choices and sensible custom validation.
  assert.deepEqual(PAGE_STUDY_BLOCK_PRESETS, [5, 10, 15, 20])
  assert.equal(PAGE_STUDY_DEFAULT_BLOCK_SIZE, 15)
  for (const valid of [1, 5, 10, 15, 20, 37, 50]) assert.equal(validatePageStudyBlockSize(valid), valid)
  for (const invalid of ['', 0, 1.5, 51, Number.NaN, 'abc']) assert.equal(validatePageStudyBlockSize(invalid), null)

  // D/H/S/T: server-owned setup supports >5, preserves visible order, and exposes no batch concept in the public view.
  const worker = makeWorker()
  const userId = 'phase4-user'
  const ids = Array.from({ length: 7 }, (_, index) => `pdf-${index + 1}`)
  Object.assign(setupDeps, {
    getServerSession: async () => ({ user: { id: userId } }),
    store: worker.store,
    getMaterial: async (id: string, owner: string) => owner === userId && ids.includes(id) ? ({
      id, user_id: owner, tema_id: 'tema-phase4', materia_id: 'materia', nombre: `Material ${id}`,
      extension: 'pdf', mime_type: 'application/pdf', size_bytes: 100, storage_key: id, kind: 'pdf',
      upload_status: 'uploaded', text_status: 'ready', extracted_chars: 100, pages_count: 31,
      created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(),
    }) : null,
    getMaterialText: async (id: string) => ids.includes(id) ? ({ material_id: id, raw_text: '[Pagina 1]\nContenido', created_at: '', updated_at: '' }) : null,
  })
  const callSetup = async (body: unknown) => {
    const response = await setupPOST(new NextRequest('http://x/api/page-study-plan', { method: 'POST', body: JSON.stringify(body) }))
    return { response, json: await response.json() }
  }
  const first = await callSetup({ temaId: 'tema-phase4', orderedMaterialIds: ids, blockSize: 15 })
  assert.equal(first.response.status, 200)
  assert.equal(first.json.created, true)
  assert.deepEqual(first.json.view.materials.map((material: any) => material.materialId), ids)
  assert.equal(first.json.view.materials.length, 7)
  assert.equal(first.json.preparationGroups.length, 2)
  assert.ok(first.json.preparationGroups.every((group: any) => group.materials.length <= 5))
  assert.ok(first.json.view.blocks.every((block: any) => ['studied', 'current', 'upcoming'].includes(block.phase)))
  const publicView = JSON.stringify(first.json.view)
  for (const internal of ['batchIndex', 'batchId', 'fingerprint', 'sourceSelection', 'stateDelta', 'turnSeq:']) assert.ok(!publicView.includes(internal))
  assert.equal(first.json.view.block.materialId, 'pdf-1')
  assert.equal(first.json.view.block.pageStart, 1)
  assert.equal(first.json.view.block.pageEnd, 15)

  // G/AA: repeated setup is restore-first; start itself remains the frozen durable slot operation and is never effect-driven.
  const second = await callSetup({ temaId: 'tema-phase4', orderedMaterialIds: ids, blockSize: 15 })
  assert.equal(second.json.created, false)
  assert.equal(second.json.view.planId, first.json.view.planId)
  assert.match(ui, /if \(payload\.view\.turnSeq === 0 && payload\.view\.nextSlot\)/)
  const effectBodies = [...ui.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\)/g)].map(match => match[1])
  assert.ok(effectBodies.length >= 2)
  assert.ok(effectBodies.every(body => !body.includes('performTurn')), 'mount/rerender effects never create a tutor turn')
  assert.match(ui, /actionLockRef\.current/)

  // N/O/AB: restore and setup lookup are storage reads; neither imports or invokes a provider.
  const beforeReads = worker.stats.writes
  const restored = await setupGET(new NextRequest(`http://x/api/page-study-plan?planId=${encodeURIComponent(first.json.view.planId)}`))
  assert.equal(restored.status, 200)
  assert.equal(worker.stats.writes, beforeReads)
  const stateRouteCode = stateRoute.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(stateRouteCode, /from ['"][^'"]*(?:alai|provider)|generateValidatedLegacyJson\s*\(|provider\s*\./i)
  assert.match(ui, /applyState\(await readState\(targetPlanId\)\)/)
  assert.doesNotMatch(ui, /localStorage|sessionStorage/)

  // I/J/K/L/M/P/Q/R/AC/AD: one natural composer, server slot authority, exact retry payload, no optimistic coverage.
  assert.equal((ui.match(/<textarea/g) || []).length, 1)
  assert.match(ui, /Escribe tu respuesta o pregunta/)
  assert.doesNotMatch(ui, /interactionMode|Pregunta["']|Respuesta["']/)
  assert.match(ui, /setView\(payload\.view/)
  assert.doesNotMatch(ui, /setView\([^)]*coverage/)
  assert.match(ui, /retryRequest\.request/)
  assert.match(turnRoute, /forbiddenClientFields\(body\)/)
  for (const forbidden of ['blockKey', 'pages', 'materialIds', 'batchIndex', 'pendingQuestion', 'coverage', 'verdict', 'role']) assert.ok(turnRoute.includes('forbiddenClientFields') && readFileSync('lib/pageStudy/routeSupport.ts', 'utf8').includes(`'${forbidden}'`))
  assert.match(ui, /view\.pending/)
  assert.doesNotMatch(ui, /["'`](?:PAGE_STUDY_[A-Z_]+|CAS error|Worker error|provider name|stateDelta)["'`]/)
  assert.equal(safePageStudyMessage({ error: 'PAGE_STUDY_STORAGE_UNAVAILABLE' }), 'No pude continuar este turno. Inténtalo de nuevo.')

  // U/V/T: Unicode survives public-turn normalization, citations remain material-scoped, chrome is Spanish.
  const languageTurns = normalizePublicTurns([
    { seq: 3, role: 'chat', userMessage: '解释一下', reply: '光合作用 ✓ ΔG', provenance: [{ materialId: 'zh-pdf', pages: [3, 4] }] },
    { seq: 1, role: 'chat', userMessage: 'Explain', reply: 'English $x^2$', provenance: [{ materialId: 'en-pdf', pages: [3] }] },
    { seq: 2, role: 'chat', userMessage: 'Explícame', reply: 'Español', provenance: [{ materialId: 'es-pdf', pages: [3] }] },
  ])
  assert.deepEqual(languageTurns.map(turn => turn.seq), [1, 2, 3])
  assert.equal(languageTurns[2].reply, '光合作用 ✓ ΔG')
  assert.notEqual(languageTurns[0].provenance[0].materialId, languageTurns[1].provenance[0].materialId)
  assert.equal(compactPageList([1, 2, 3, 6, 8, 9]), '1–3, 6, 8–9')
  for (const copy of ['Estudio por Páginas', 'Empezar a estudiar', 'Páginas por bloque', 'estudiado', 'Reintentar']) assert.ok(ui.includes(copy))
  assert.match(ui, /<AcademicContent content=\{turn\.reply\}/)
  assert.match(academic, /case 'table'/)
  assert.match(academic, /ChemistryNode/)

  // W/AE: mobile rearranges context after a dominant chat; wide content has bounded overflow.
  assert.match(ui, /@media\(max-width:900px\)/)
  assert.match(ui, /grid-template-columns:minmax\(0,1fr\)/)
  assert.match(ui, /overflow-x:auto/)
  assert.match(ui, /Shift\+Enter/)
  assert.match(ui, /aria-label="Enviar mensaje"/)
  assert.match(ui, /prefers-reduced-motion/)

  // Y: Phase 4 imports no Exam implementation and the setup route delegates to frozen Page Study creation.
  assert.doesNotMatch(`${ui}\n${setupRoute}`, /ALAIStudyALExams|alai-studyal-exam|examGrading/)
  assert.match(setupRoute, /createPageStudy\(/)

  console.log('Page Study Phase 4 UI/integration contracts: PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
