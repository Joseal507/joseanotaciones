import assert from 'node:assert/strict'
import { syncToServer, type StudySession } from '../../lib/studySessions'

const posts: string[] = []
Object.assign(globalThis, {
  window: {},
  fetch: async (_url: string, init?: RequestInit) => {
    posts.push(String(init?.body || ''))
    return { ok: true, json: async () => ({ success: true }) }
  },
})

const base: StudySession = {
  id: 'persist-contract',
  temaId: 'falcons',
  enfoque: 'teorico',
  processMode: 'adaptive',
  studyMode: 'adaptive',
  materialIds: ['falcons-pdf'],
  materialNames: ['Falcons'],
  selectedPages: {},
  currentSessionNumber: 2,
  currentStep: 4,
  createdAt: 1,
  lastOpenedAt: 1,
}

const waitForCoalescing = () => new Promise(resolve => setTimeout(resolve, 220))

async function main() {
  syncToServer(base)
  await waitForCoalescing()
  assert.equal(posts.length, 1)
  posts.length = 0

  for (let render = 0; render < 10; render++) syncToServer({ ...base, lastOpenedAt: render + 2 })
  await waitForCoalescing()
  assert.equal(posts.length, 0)

  syncToServer({ ...base, currentStep: 5 })
  syncToServer({ ...base, currentStep: 6 })
  syncToServer({ ...base, currentStep: 7 })
  await waitForCoalescing()
  assert.equal(posts.length, 1)
  assert.equal(JSON.parse(posts[0]).currentStep, 7)

  console.log('study-session-persistence-contracts: 4 contracts PASS')
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
