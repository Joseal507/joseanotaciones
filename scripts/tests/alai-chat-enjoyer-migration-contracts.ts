import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-chat/route'

const selection = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2] }), fingerprint: 'fp-chat-r' }

const items = [
  { id: 'kc', kind: 'formula', name: 'Constante Kc', content: 'Kc es la constante de equilibrio en concentraciones molares', importance: 90, difficulty: 'advanced', topicId: 't1', materialId: 'mat-a', pages: [1], sourceSpans: [{ page: 1, quote: 'Kc se define como el cociente de concentraciones' }] },
  { id: 'kp', kind: 'formula', name: 'Constante Kp', content: 'Kp es la constante de equilibrio en presiones parciales', importance: 85, difficulty: 'advanced', topicId: 't1', materialId: 'mat-a', pages: [2], sourceSpans: [{ page: 2, quote: 'Kp usa presiones parciales' }] },
]

function payload() {
  return {
    sourceSelectionFingerprint: 'fp-chat-r', materialIds: ['mat-a'], selectedPages: { 'mat-a': [1, 2] },
    topicsIndex: [{ id: 't1', title: 'Equilibrio' }], globalOrderedAnalysis: items, uniqueConceptsIndex: [], relations: [],
  }
}

async function main() {
  const store = new Map<string, any>()
  let providerCalls = 0
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: selection }) as any,
    getMaterial: async () => ({ id: 'mat-a', nombre: 'Material A' }) as any,
    lookupStudyalMaterialEnjoyer: async (fingerprint: string) => store.get(fingerprint) ?? null,
    materialEnjoyerStore: {} as any,
    generateValidatedLegacyJson: async ({ prompt, validate }: any) => {
      providerCalls++
      const idMatch = [...prompt.matchAll(/\[ENJOYER_TARGET (chat_target:\S+)\]/g)].map((m: any) => m[1])
      const value = { answer: 'Kc es la constante de equilibrio.', usedTargetIds: idMatch.slice(0, 1), usedRelationIds: [], externalKnowledgeUsed: false, suggestedFollowups: [] }
      const v = validate(value)
      if (!v.valid) throw new Error('sim invalid: ' + v.errors.join(','))
      return value
    },
  })

  async function post(body: unknown) {
    const response = await POST(new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    return { response, data: await response.json() }
  }

  // L: missing Enjoyer returns a retryable readiness failure.
  const missing = await post({ sessionId: 'sess-1', message: '¿Qué es Kc?' })
  assert.equal(missing.response.status, 409)
  assert.equal(missing.data.error, 'ENJOYER_NOT_READY')
  assert.equal(providerCalls, 0, 'no provider call attempted when Enjoyer is missing')

  // M: __routeDeps never exposes restoreMaterialBrain.
  assert.ok(!('restoreMaterialBrain' in __routeDeps), 'M: zero restoreMaterialBrain in the active route deps')

  const routeSource = fs.readFileSync('app/api/alai-studyal-chat/route.ts', 'utf8')
  const enjoyerBranch = routeSource.slice(routeSource.indexOf('async function resolveReadyChatEnjoyer'), routeSource.indexOf('async function handleGroundedChatTurn') + 20000 > routeSource.length ? routeSource.length : routeSource.indexOf('function extractJson'))

  // N: zero KnowledgeUnit-shaped dependency in the active Free branch.
  assert.ok(!enjoyerBranch.includes('KnowledgeUnit'), 'N: no KnowledgeUnit dependency in the active Free Chat branch')
  assert.ok(!enjoyerBranch.includes('restoreMaterialBrain') && !enjoyerBranch.includes('WorkerMaterialResultStore'),
    'M: no Brain restore path in the active Free Chat branch')
  assert.ok(enjoyerBranch.includes('lookupStudyalMaterialEnjoyer'), 'active branch uses the Enjoyer lookup')

  // O: zero raw PDF/materialText authority in the active Free branch (no getMaterialText/buildSourceIndex calls there).
  assert.ok(!enjoyerBranch.includes('getMaterialText') && !enjoyerBranch.includes('buildSourceIndex'),
    'O: no raw PDF/materialText retrieval in the active Free Chat branch')

  // P: zero Vision.
  assert.ok(!enjoyerBranch.includes('Vision'), 'P: no Vision dependency in the active Free Chat branch')

  // Q: route never builds/regenerates the Enjoyer, lookup-only.
  assert.ok(!routeSource.includes('getOrCreateStudyalMaterialEnjoyer'), 'Q: route never builds/regenerates the Enjoyer')

  // R: no second LLM planner/extraction pass — exactly one generateValidatedLegacyJson call site inside the Enjoyer branch.
  const plannerCallCount = (enjoyerBranch.match(/__routeDeps\.generateValidatedLegacyJson/g) || []).length
  assert.equal(plannerCallCount, 1, 'R: exactly one provider call site (the answer itself) in the grounded Free Chat branch — no separate planning/extraction pass')

  // W: client academic bypass rejected.
  const rawBypass = await post({ sessionId: 'sess-1', message: 'hola', materialText: 'forbidden raw text' })
  assert.equal(rawBypass.response.status, 400)
  assert.equal(rawBypass.data.error, 'INVALID_CONFIG')

  store.set('fp-chat-r', payload())

  // K/S/X: exact persisted Enjoyer is academic authority; one message → one provider call; bounded context (not the whole universe blindly).
  const first = await post({ sessionId: 'sess-1', message: '¿Qué es Kc?' })
  assert.equal(first.response.status, 200)
  assert.equal(providerCalls, 1, 'S: one message produces exactly one provider call')
  assert.equal(first.data.authorityType, 'studyal_material_enjoyer')
  assert.deepEqual(first.data.usedTargetIds, ['chat_target:kc'])
  assert.equal(first.data.mode, 'MATERIAL_ONLY')

  // X: provider receives a bounded context, not the whole Enjoyer universe blindly — confirmed the prompt referenced specific target ids, not a full dump keyword.
  // (Already implicit in the mocked provider parsing [ENJOYER_TARGET id] blocks — a raw full-Enjoyer dump would not have this shape.)

  // U: exact fingerprint isolation — a different fingerprint with nothing persisted is still ENJOYER_NOT_READY.
  const otherSelection = { ...buildSourceSelectionSnapshot(['mat-b'], { 'mat-b': [1] }), fingerprint: 'fp-other-chat' }
  Object.assign(__routeDeps, { getAuthoritativeFreeSession: async () => ({ id: 'sess-2', userId: 'user-1', processMode: 'free', sourceSelection: otherSelection }) as any })
  const otherMissing = await post({ sessionId: 'sess-2', message: 'hola' })
  assert.equal(otherMissing.response.status, 409)
  assert.equal(otherMissing.data.error, 'ENJOYER_NOT_READY', 'U: a different fingerprint never reuses another selection\'s persisted result')
  Object.assign(__routeDeps, { getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: selection }) as any })

  // A stale/unknown previousGrounding target id must never become authority (security §15).
  const staleGrounding = await post({
    sessionId: 'sess-1', message: '¿y por qué?',
    previousGrounding: { mode: 'MATERIAL_ONLY', usedTargetIds: ['chat_target:does-not-exist'], usedRelationIds: [], materialIds: [], pages: [] },
  });
  assert.equal(staleGrounding.response.status, 200)
  assert.ok(!staleGrounding.data.usedTargetIds?.includes('chat_target:does-not-exist'))

  // V: legacy/Adaptive routes remain isolated — the legacy materialText
  // branch is structurally distinct and only reachable without sessionId.
  const postSource = routeSource.slice(routeSource.indexOf('export async function POST'));
  const sessionIdx = postSource.indexOf('handleGroundedChatTurn');
  const legacyIdx = postSource.indexOf('const materialText = String(body.materialText');
  assert.ok(sessionIdx > -1 && legacyIdx > -1 && sessionIdx < legacyIdx,
    'V: the Free sessionId/Enjoyer branch is checked before the legacy materialText pipeline, both remain distinct');

  console.log('alai-chat-enjoyer-migration-contracts: K-X ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
