import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST, __routeDeps } from '../../app/api/alai-studyal-cheat-codes/route'
import { PURPOSES, type ProseProvider } from '../../lib/truquitos/artifact'
import { MemoryTruquitosStore, validProse, payload, selection, notation } from './truquitos-simple-architecture-contracts'

// Reusable real-route scenarios replacing the old model-owned card mock.
export async function checkSimpleRoute(scenario: 'grounding' | 'language' | 'formula' | 'failure' | 'variant' | 'categories' | 'authority' | 'resume') {
  const saved = { ...__routeDeps }; let calls = 0; let language = 'es'; const prompts: string[] = []
  try {
    Object.assign(__routeDeps, {
      getServerSession: async () => ({ user: { id: 'test-owner' } }),
      getAuthoritativeFreeSession: async () => ({ sourceSelection: selection }),
      getMaterial: async () => ({ id: 'material' }),
      lookupStudyalMaterialEnjoyer: async () => ({ ...payload, language }),
      truquitosStore: new MemoryTruquitosStore(),
      alai: async (p: Parameters<ProseProvider>[0]) => { calls++; prompts.push(p.messages[0].content); return validProse(p) },
    })
    const post = (body: object) => POST(new NextRequest('http://localhost/api/alai-studyal-cheat-codes', { method: 'POST', body: JSON.stringify(body) }))
    if (scenario === 'failure') {
      Object.assign(__routeDeps, { alai: async () => { calls++; throw new Error('simulated invalid output') } })
      const a = await post({ sessionId: 'test' }); const body = await a.json()
      assert.equal(a.status, 422); assert.equal(body.success, false); assert.equal(body.meta.missingSlotIds.length, 8)
      await post({ sessionId: 'test' }); assert.equal(calls, 2); return
    }
    const first = await post({ sessionId: 'test' }); assert.equal(first.status, 200); const data = await first.json()
    assert.equal(calls, 1); assert.equal(data.cards.length, 8)
    if (scenario === 'categories') {
      assert.equal(new Set(data.cards.map((c: { category: string }) => c.category)).size, 3)
      for (const c of data.cards) { assert.equal(c.category, PURPOSES[c.purpose as keyof typeof PURPOSES].category); assert.equal(c.importanceTier, 'critical') }
    } else if (scenario === 'formula') {
      assert.equal(data.cards[0].canonicalSources[0].content, notation)
      const roundTrip = JSON.parse(JSON.stringify(data.cards)); assert.equal(roundTrip[0].canonicalSources[0].content, notation)
    } else if (scenario === 'language') {
      assert(prompts[0].includes('Spanish')); assert.equal(data.meta.lang, 'es')
      language = 'en'; await post({ sessionId: 'english' }); assert(prompts[1].includes('English'))
    } else if (scenario === 'variant') {
      const body = { sessionId: 'test', mode: 'variant', cardId: data.cards[0].id, action: 'simple' }
      const alternative = await post(body); assert.equal(alternative.status, 200)
      const variant = await alternative.json(); assert.deepEqual(variant.card.canonicalSources, data.cards[0].canonicalSources)
      assert.equal(variant.card.targetId, data.cards[0].targetId); assert.equal(variant.card.purpose, data.cards[0].purpose)
      assert.deepEqual(await (await post(body)).json(), variant); assert.equal(calls, 2)
      assert.equal((await post({ ...body, cardId: 'forged' })).status, 409); assert.equal(calls, 2)
    } else if (scenario === 'authority') {
      for (const key of ['materialText', 'rawText', 'combinedText', 'texto']) assert.equal((await post({ sessionId: 'test', [key]: 'forged' })).status, 400)
      Object.assign(__routeDeps, { getServerSession: async () => null }); assert.equal((await post({ sessionId: 'test' })).status, 401)
      assert.equal(calls, 1)
    } else if (scenario === 'resume') {
      assert.deepEqual(await (await post({ sessionId: 'test' })).json(), data); assert.equal(calls, 1)
      const other = await (await post({ sessionId: 'different-session' })).json(); assert.notEqual(other.cards[0].id, data.cards[0].id)
      assert.equal(calls, 2)
    } else {
      for (const card of data.cards) {
        assert.equal(card.sourceMaterial, 'material'); assert(!card.sourcePages.includes(999)); assert.equal(card.fingerprint, selection.fingerprint)
        assert(card.targetId.startsWith('unit:target')); assert.equal(card.canonicalSources[0].materialId, 'material')
      }
      assert(!prompts[0].includes('targetId')); assert(!prompts[0].includes('topicId'))
    }
  } finally { Object.assign(__routeDeps, saved) }
}
