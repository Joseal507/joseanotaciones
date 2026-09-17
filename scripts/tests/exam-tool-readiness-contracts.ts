import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { InMemoryExamGenerationStore } from '../../lib/materialBrain/examGenerationStore'
import { POST, __routeDeps } from '../../app/api/alai-studyal-exam/route'

const selection = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] }), fingerprint: 'fp-exam-ready' }
const persistedEnjoyer = {
  sourceSelectionFingerprint: 'fp-exam-ready', materialIds: ['mat-a'], selectedPages: { 'mat-a': [1, 2, 3] },
  topicsIndex: [{ id: 'topic-a', title: 'Tema A' }],
  globalOrderedAnalysis: [1, 2, 3].map(page => ({
    id: `source-${page}`, kind: 'fact', name: `Concepto ${page}`,
    content: `Contenido académico autorizado ${page}`, importance: 'high', difficulty: 'medium',
    examTypes: ['short_answer'], topicId: 'topic-a', materialId: 'mat-a', pages: [page],
    sourceSpans: [{ materialId: 'mat-a', page, quote: `Evidencia ${page}` }],
  })),
  uniqueConceptsIndex: [],
}

function providerQuestions(prompt: string) {
  return prompt.split(/\n(?=\d+\.\s+slotId=)/).filter(block => /^\d+\.\s+slotId=/.test(block)).map((block, index) => ({
    slotId: block.match(/slotId=(\S+)/)?.[1],
    type: block.match(/type=(\S+)/)?.[1],
    sourceItemIds: (block.match(/sourceItemIds=([^\n]+)/)?.[1] || '').split(',').map(v => v.trim()).filter(Boolean),
    prompt: `Pregunta ${index + 1}`,
  }))
}

function baseDeps(payload: any | null, calls: { n: number }, fingerprint = 'fp-exam-ready') {
  const examStore = new InMemoryExamGenerationStore<any>()
  return {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: { ...selection, fingerprint } }) as any,
    getMaterial: async () => ({ id: 'mat-a', nombre: 'Material A' }) as any,
    lookupStudyalMaterialEnjoyer: async () => payload,
    materialEnjoyerStore: {} as any,
    generateValidatedLegacyJson: async ({ prompt, validate }: any) => {
      calls.n++
      const value = providerQuestions(prompt)
      assert.ok(validate(value).valid)
      return value
    },
    examStore,
  }
}

async function request(mode: string, extra: Record<string, unknown> = {}) {
  return POST(new NextRequest('http://localhost/api/alai-studyal-exam', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, sessionId: 'sess-1', durationMinutes: 30, ...extra }),
  }))
}

async function main() {
  const missingCalls = { n: 0 }
  const missingDeps = baseDeps(null, missingCalls)
  Object.assign(__routeDeps, missingDeps)
  const missing = await request('generate')
  assert.equal(missing.status, 409)
  assert.equal((await missing.json()).error, 'ENJOYER_NOT_READY')
  assert.equal(missingCalls.n, 0)
  assert.equal((missingDeps.examStore as any).manifests?.size ?? 0, 0)

  const goodCalls = { n: 0 }
  Object.assign(__routeDeps, baseDeps(persistedEnjoyer, goodCalls))
  const started = await request('generate')
  const startedData = await started.json()
  assert.equal(started.status, 200)
  assert.ok(goodCalls.n > 0)
  assert.equal(startedData.blueprint?.authorityType, 'studyal_material_enjoyer')

  const mismatchCalls = { n: 0 }
  Object.assign(__routeDeps, baseDeps(persistedEnjoyer, mismatchCalls, 'fp-other'))
  const mismatch = await request('generate')
  assert.equal(mismatch.status, 409)
  assert.equal((await mismatch.json()).error, 'SOURCE_SELECTION_MISMATCH')
  assert.equal(mismatchCalls.n, 0)

  const page = fs.readFileSync('app/materias/page.tsx', 'utf8')
  const openExam = page.match(/const onOpenExam[\s\S]*?\n  }/)?.[0] || ''
  assert.ok(!openExam.includes('setBrainSourceSelection'))
  assert.ok(!page.includes("['analisis', 'alai', 'exam']"))
  assert.ok(!/VISTA_TOOL[\s\S]{0,500}exam/.test(page))
  console.log('exam-tool-readiness-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
