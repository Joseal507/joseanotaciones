import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSourceSelectionFromMaterials, buildSourceSelectionSnapshot, filterTextToSelectedPages, validateSourceSelectionInput } from '../../lib/adaptive/sourceSelection'
import { sourceScopedKey } from '../../lib/materials/authorizedSource'
import { lookupSessionByIdFromServer, selectSessionForSource } from '../../lib/studySessions'

const tools = [
  'components/materias/ALAIStudyALRepasar.tsx', 'components/materias/AnalisisTeorico.tsx',
  'components/materias/ALAIStudyMap.tsx', 'components/materias/ALAIStudyALCheatCodes.tsx',
  'components/materias/ALAIStudyALCards.tsx', 'components/materias/ALAIStudyALQuizzes.tsx',
  'components/materias/ALAIStudyALExams.tsx', 'components/materias/ALAIStudyALChat.tsx',
]

const ordered = buildSourceSelectionSnapshot(['b', 'a', 'b'], { a: [3, 1, 1], b: [8, 2] })
const reordered = buildSourceSelectionSnapshot(['a', 'b'], { b: [2, 8, 8], a: [1, 3] })
assert.equal(ordered.fingerprint, reordered.fingerprint)
assert.notEqual(ordered.fingerprint, buildSourceSelectionSnapshot(['a', 'b'], { a: [1, 4], b: [2, 8] }).fingerprint)
assert.ok(validateSourceSelectionInput({ materials: ordered.materials, fingerprint: ordered.fingerprint }))
assert.equal(validateSourceSelectionInput({ materials: ordered.materials, fingerprint: 'tampered' }), null)

for (let count = 1; count <= 5; count++) {
  const materials = Array.from({ length: count }, (_, index) => ({ id: `doc-${index}`, materialId: `mat-${index}` }))
  const selections = materials.map((material, index) => ({ materialId: material.id, pages: [index + 7, 1, index + 7] }))
  const snapshot = buildSourceSelectionFromMaterials(materials, selections)
  assert.equal(snapshot.materials.length, count)
  for (let index = 0; index < count; index++) {
    const pages = [...new Set([1, index + 7])].sort((a, b) => a - b)
    assert.deepEqual(snapshot.selectedPages[`mat-${index}`], pages)
    const text = `[Pagina 1]\nAUTHORIZED_${index}_ONE\n[Pagina ${index + 7}]\nAUTHORIZED_${index}_SPARSE\n[Pagina ${index + 20}]\nFORBIDDEN_${index}`
    const authorized = filterTextToSelectedPages(text, pages)
    assert.match(authorized, new RegExp(`AUTHORIZED_${index}`))
    assert.doesNotMatch(authorized, /FORBIDDEN_/)
  }
}

const selected = buildSourceSelectionSnapshot(['alpha', 'beta'], { alpha: [2], beta: [3] })
const alternate = buildSourceSelectionSnapshot(['alpha', 'beta'], { alpha: [5], beta: [3] })
assert.notEqual(sourceScopedKey('free-cache', selected, { temaId: 'tema', sessionId: 'free-1' }), sourceScopedKey('free-cache', alternate, { temaId: 'tema', sessionId: 'free-2' }))
assert.notEqual(sourceScopedKey('free-cache', selected, { sessionId: 'free-1' }), sourceScopedKey('free-cache', selected, { sessionId: 'adaptive-1' }))

const sessionBase = { temaId: 'tema', enfoque: 'teorico', studyMode: 'free', materialIds: selected.materialIds, selectedPages: selected.selectedPages, createdAt: 1, updatedAt: 1, status: 'in_progress' }
const sessions = [
  { ...sessionBase, id: 'adaptive', processMode: 'adaptive', sourceSelectionFingerprint: selected.fingerprint, lastOpenedAt: 50 },
  { ...sessionBase, id: 'free-old', processMode: 'free', sourceSelectionFingerprint: selected.fingerprint, lastOpenedAt: 10 },
  { ...sessionBase, id: 'free-alternate', processMode: 'free', selectedPages: alternate.selectedPages, sourceSelectionFingerprint: alternate.fingerprint, lastOpenedAt: 100 },
] as any
assert.equal(selectSessionForSource(sessions, { materialIds: selected.materialIds, processMode: 'free', sourceSelectionFingerprint: selected.fingerprint })?.id, 'free-old')
assert.equal(selectSessionForSource(sessions, { materialIds: alternate.materialIds, processMode: 'free', sourceSelectionFingerprint: alternate.fingerprint })?.id, 'free-alternate')
assert.equal(selectSessionForSource(sessions, { materialIds: selected.materialIds, processMode: 'adaptive', sourceSelectionFingerprint: selected.fingerprint })?.id, 'adaptive')
assert.equal(selectSessionForSource(sessions, { materialIds: selected.materialIds, processMode: 'free' }), null)
assert.equal(selectSessionForSource(sessions, { materialIds: selected.materialIds }), null)

async function testDurableLookupStates() {
  const originalWindow = (globalThis as any).window
  const originalFetch = globalThis.fetch
  const originalLocalStorage = (globalThis as any).localStorage
  const memory = new Map<string, string>()
  ;(globalThis as any).window = {}
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => memory.get(key) || null,
    setItem: (key: string, value: string) => memory.set(key, value),
  }
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ success: false }), { status: 500 })) as typeof fetch
    assert.equal((await lookupSessionByIdFromServer('durable-free', 'tema')).status, 'ERROR')
    globalThis.fetch = (async () => { throw new Error('timeout') }) as typeof fetch
    assert.equal((await lookupSessionByIdFromServer('durable-free', 'tema')).status, 'ERROR')
    globalThis.fetch = (async () => new Response(JSON.stringify({ success: true, sessions: [] }), { status: 200 })) as typeof fetch
    assert.equal((await lookupSessionByIdFromServer('durable-free', 'tema')).status, 'ABSENT')
    globalThis.fetch = (async () => new Response(JSON.stringify({ success: true, sessions: [{
      ...sessionBase,
      id: 'durable-free',
      processMode: 'free',
      sourceSelectionFingerprint: selected.fingerprint,
      lastOpenedAt: 200,
    }] }), { status: 200 })) as typeof fetch
    const durableFound = await lookupSessionByIdFromServer('durable-free', 'tema')
    assert.equal(durableFound.status, 'FOUND')
    assert.equal(durableFound.sessions[0]?.id, 'durable-free')
  } finally {
    globalThis.fetch = originalFetch
    ;(globalThis as any).window = originalWindow
    ;(globalThis as any).localStorage = originalLocalStorage
  }
}

for (const path of tools) {
  const source = readFileSync(path, 'utf8')
  assert.match(source, /useAuthorizedSource/, `${path} debe usar la autoridad compartida`)
  assert.doesNotMatch(source, /fetch\(['"]\/api\/enfoques\/teorico\/start/, `${path} no descarga texto completo directamente`)
  assert.doesNotMatch(source, /filtered\s*\|\|\s*fullText/, `${path} no puede hacer fail-open`)
}

const route = readFileSync('app/api/enfoques/teorico/start/route.ts', 'utf8')
assert.match(route, /validateSourceSelectionInput/)
assert.match(route, /AUTHORIZED_PAGES_UNAVAILABLE/)
assert.match(route, /AUTHORIZED_SOURCE_INCOMPLETE/)
assert.match(route, /sourceSelectionFingerprint/)
const temaView = readFileSync('components/materias/TemaView.tsx', 'utf8')
assert.match(temaView, /selectSessionForSource/)
assert.doesNotMatch(temaView, /bAdaptive - aAdaptive/)
assert.match(temaView, /returnSessionId/)
assert.match(temaView, /lookupSessionByIdFromServer\(returnSessionId/)
assert.match(temaView, /tool !== 'studymap' && tool !== 'truquitos'/)
assert.match(temaView, /freeTool', activeTool/)

testDurableLookupStates().then(() => {
  console.log('Free mode source authority: 25/25 PASS')
  console.log('source leakage: 0/8 tools')
  console.log('materials: 1-5 PASS')
}).catch(error => {
  console.error(error)
  process.exitCode = 1
})
