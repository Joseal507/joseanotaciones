import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { buildTruquitosEnjoyerContext } from '../../lib/materialBrain/truquitosEnjoyerContext'
import { safeParseJson } from '../../lib/alai'
import { POST, __routeDeps } from '../../app/api/alai-studyal-cheat-codes/route'
import { PURPOSES, WorkerTruquitosStore, buildProsePrompt, parseSlotProse, restoreOrGenerateTruquitos, selectTruquitosSlots, truquitosIdentity,
  type ArtifactRecord, type TruquitosArtifact, type TruquitosStore, type ProseProvider } from '../../lib/truquitos/artifact'

export class MemoryTruquitosStore implements TruquitosStore {
  rows = new Map<string, ArtifactRecord>()
  revision = 0
  async read(id: string) { return structuredClone(this.rows.get(id) || null) }
  async compareAndSet(id: string, expected: string | null, artifact: TruquitosArtifact) {
    if ((this.rows.get(id)?.revision || null) !== expected) return false
    this.rows.set(id, structuredClone({ revision: String(++this.revision), artifact })); return true
  }
}
export const selection = buildSourceSelectionSnapshot(['material'], { material: [28, 29, 30, 31, 32, 33] })
export const notation = String.raw`  K_p = K_c(RT)^{\Delta n}; \frac{[NO_2]^2}{[N_2O_4]}; N₂O₄ ⇌ 2NO₂; ΔH  `
export const payload = { sourceSelectionFingerprint: selection.fingerprint, materialIds: ['material'], selectedPages: selection.selectedPages, language: 'es',
  globalOrderedAnalysis: Array.from({ length: 8 }, (_, i) => ({ id: `target${i}`, name: `Equilibrio ${i}`, kind: i < 3 ? 'formula' : 'definition',
    content: i === 0 ? notation : `El equilibrio dinámico conserva flujos en ambas direcciones, concepto ${i}.`, importance: 90,
    materialId: 'material', pages: [28 + i % 6], topicId: 'same-topic', globalOrder: i })), topicsIndex: [], relations: [] }
export const context = buildTruquitosEnjoyerContext(payload, selection)
type PromptSlot = { slotId: string; source: string[] }
function requested(params: Parameters<ProseProvider>[0]): PromptSlot[] { return JSON.parse(params.messages[0].content.split('SLOTS:\n')[1]) }
export const validProse: ProseProvider = async params => ({ text: JSON.stringify({ slots: requested(params).map(slot => ({ slotId: slot.slotId,
  title: 'Recuerda el equilibrio', trick: `Imagina dos puertas con igual flujo; la pista de esta tarjeta es ${slot.slotId}${params.messages[0].content.includes('Alternative request:') ? ' como explicación alternativa' : ''}.` })) }), provider: 'mock', model: 'offline' })
let count = 0
async function test(name: string, fn: () => unknown | Promise<unknown>) { await fn(); count++; console.log(`PASS ${name}`) }
async function main() {
  await test('deterministic selection; same-topic siblings survive; purpose/categories separate from importance', () => {
    const a = selectTruquitosSlots(context), b = selectTruquitosSlots({ ...context, targets: [...context.targets].reverse() })
    assert.deepEqual(a, b); assert.equal(a.length, 8)
    assert.equal(new Set(a.map(slot => slot.target.id)).size, 8)
    assert.equal(new Set(a.map(slot => PURPOSES[slot.purpose].category)).size, 3)
    assert(a.every(slot => slot.target.importanceTier === 'critical'))
  })
  await test('provider schema contains only transport correlation and prose; no academic IDs', () => {
    const prompt = buildProsePrompt(selectTruquitosSlots(context), 'es')
    assert(!prompt.includes('unit:target')); assert(prompt.includes('Spanish'))
    assert(buildProsePrompt(selectTruquitosSlots(context), 'en').includes('English'))
    assert(!prompt.includes('topicId')); assert(!prompt.includes('targetId'))
  })
  await test('one fresh call, zero reopen calls, same stable identities/order and byte-faithful canonical notation', async () => {
    const store = new MemoryTruquitosStore(); let calls = 0
    const provider: ProseProvider = async p => { calls++; assert.equal(p.maxProviderAttempts, 1); assert.equal(p.transportRetries, 0); return validProse(p) }
    const a = await restoreOrGenerateTruquitos('identity', context, store, provider)
    const b = await restoreOrGenerateTruquitos('identity', context, store, provider)
    assert.equal(a.status, 'ready'); assert.deepEqual(a, b); assert.equal(calls, 1)
    assert.equal(JSON.parse(JSON.stringify(a)).cards[0].canonicalSources[0].content, notation)
    assert.equal(a.cards[0].targetId, 'unit:target0'); assert.equal(a.cards[0].fingerprint, selection.fingerprint)
  })
  await test('malformed sibling retries ONLY that slot; ready siblings persisted before retry', async () => {
    const store = new MemoryTruquitosStore(); let calls = 0; let firstReady = ''
    const provider: ProseProvider = async params => {
      calls++; const slots = requested(params)
      if (calls === 1) {
        const value = JSON.parse((await validProse(params)).text); firstReady = value.slots[0].slotId
        value.slots[1].targetId = 'forged'; return { text: JSON.stringify(value), provider: 'mock', model: 'offline' }
      }
      assert.equal(slots.length, 1); assert.notEqual(slots[0].slotId, firstReady)
      const persisted = await store.read('partial'); assert.equal(persisted?.artifact.cards.length, 7)
      return validProse(params)
    }
    const artifact = await restoreOrGenerateTruquitos('partial', context, store, provider)
    assert.equal(calls, 2); assert.equal(artifact.cards.length, 8); assert.equal(artifact.status, 'ready')
  })
  await test('syntactically malformed middle sibling preserves complete objects on both sides', () => {
    const slots = selectTruquitosSlots(context)
    const row = (index: number) => JSON.stringify({ slotId: slots[index].id, title: 'Pista', trick: `Una pista verbal suficientemente concreta número ${index}.` })
    const text = `{"slots":[${row(0)},{"slotId":"${slots[1].id}","trick":broken},${row(2)}]}`
    const parsed = parseSlotProse(text, slots, [])
    assert.deepEqual([...parsed.keys()], [slots[0].id, slots[2].id])
  })
  await test('empty/throwing output exhausts durable budget; reopen never resets it', async () => {
    const store = new MemoryTruquitosStore(); let calls = 0
    const provider: ProseProvider = async () => { calls++; throw new Error('offline failure') }
    const a = await restoreOrGenerateTruquitos('failed', context, store, provider)
    assert.equal(a.status, 'failed'); assert.equal(a.callsUsed, 2)
    await restoreOrGenerateTruquitos('failed', context, store, provider); assert.equal(calls, 2)
  })
  await test('two independent requests cannot enter provider simultaneously; reserve precedes call', async () => {
    const store = new MemoryTruquitosStore(); let release!: () => void; let entered!: () => void
    const enteredPromise = new Promise<void>(resolve => { entered = resolve })
    const pause = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    const provider: ProseProvider = async params => { calls++; assert.equal((await store.read('race'))?.artifact.callsUsed, 1); entered(); await pause; return validProse(params) }
    const first = restoreOrGenerateTruquitos('race', context, store, provider)
    await enteredPromise
    await assert.rejects(restoreOrGenerateTruquitos('race', context, store, provider), /TRUQUITOS_GENERATING/)
    release(); await first; assert.equal(calls, 1)
  })
  await test('crashed reservation consumes budget; stale completion cannot overwrite new owner', async () => {
    const store = new MemoryTruquitosStore(); let time = 1; let release!: () => void; let entered!: () => void
    const started = new Promise<void>(r => { entered = r }); const pause = new Promise<void>(r => { release = r })
    const first = restoreOrGenerateTruquitos('lease', context, store, async p => { entered(); await pause; return validProse(p) }, { now: () => time })
    await started; time = 100_000
    const second = await restoreOrGenerateTruquitos('lease', context, store, validProse, { now: () => time })
    release(); await assert.rejects(first, /TRUQUITOS_GENERATING/)
    assert.equal(second.callsUsed, 2); assert.equal(second.status, 'ready')
    assert.deepEqual((await store.read('lease'))?.artifact, second)
  })
  await test('failed restore or failed reservation causes zero provider calls', async () => {
    let calls = 0; const provider: ProseProvider = async p => { calls++; return validProse(p) }
    await assert.rejects(restoreOrGenerateTruquitos('x', context, { read: async () => { throw new Error('network') }, compareAndSet: async () => false }, provider), /network/)
    await assert.rejects(restoreOrGenerateTruquitos('x', context, { read: async () => null, compareAndSet: async () => { throw new Error('write') } }, provider), /write/)
    assert.equal(calls, 0)
  })
  await test('parser repairs complete and truncated LaTeX before JSON form-feed decoding', () => {
    for (const text of [String.raw`{"cards":[{"content":"\frac{a}{b}"}]}`, String.raw`{"cards":[{"content":"\frac{a}{b}"},{"content":"cut`]) {
      const parsed = safeParseJson(text); assert.equal(parsed.cards[0].content, String.raw`\frac{a}{b}`)
      assert(!parsed.cards[0].content.includes('\u000c'))
    }
  })
  await test('malformed Markdown, control chars, duplicate slots and invented fields fail individually', () => {
    const slots = selectTruquitosSlots(context)
    const rows = slots.map(slot => ({ slotId: slot.id, title: 'Título', trick: `Pista concreta para recordar un concepto ${slot.id}.` }))
    rows[0].title = '*****Kp*****'; rows[1].trick = '\u000crac corrupción que no debemos conservar'
    const result = parseSlotProse(JSON.stringify({ slots: [...rows, rows[2]] }), slots, [])
    assert.equal(result.size, 5)
  })
  await test('route authorization, raw-source rejection, persisted variants and immutable grounding', async () => {
    const original = { ...__routeDeps }; let calls = 0
    try {
      Object.assign(__routeDeps, { getServerSession: async () => ({ user: { id: 'owner' } }),
        getAuthoritativeFreeSession: async () => ({ sourceSelection: selection }), getMaterial: async () => ({ id: 'material' }),
        lookupStudyalMaterialEnjoyer: async () => payload, truquitosStore: new MemoryTruquitosStore(),
        alai: async (params: Parameters<ProseProvider>[0]) => { calls++; return validProse(params) } })
      const post = (body: object) => POST(new NextRequest('http://localhost/api/alai-studyal-cheat-codes', { method: 'POST', body: JSON.stringify(body) }))
      assert.equal((await post({ sessionId: 'session', materialText: 'forged' })).status, 400)
      const first = await post({ sessionId: 'session' }); assert.equal(first.status, 200); const data = await first.json()
      assert.equal(calls, 1); assert.equal((await post({ sessionId: 'session' })).status, 200); assert.equal(calls, 1)
      assert.equal((await post({ sessionId: 'session', mode: 'variant', cardId: 'forged', action: 'simple' })).status, 409)
      assert.equal(calls, 1)
      const body = { sessionId: 'session', mode: 'variant', cardId: data.cards[0].id, action: 'simple' }
      const variant = await (await post(body)).json(); assert.equal(variant.success, true); assert.equal(calls, 2)
      assert.deepEqual(variant.card.canonicalSources, data.cards[0].canonicalSources)
      assert.equal(variant.card.purpose, data.cards[0].purpose)
      assert.deepEqual(await (await post(body)).json(), variant); assert.equal(calls, 2)
      Object.assign(__routeDeps, { getServerSession: async () => null })
      assert.equal((await post({ sessionId: 'session' })).status, 401); assert.equal(calls, 2)
    } finally { Object.assign(__routeDeps, original) }
  })
  await test('identity separates owner, session, fingerprint, variant; mismatch fails closed', async () => {
    assert.notEqual(truquitosIdentity('a', 's', 'f'), truquitosIdentity('b', 's', 'f'))
    assert.notEqual(truquitosIdentity('a', 's', 'f'), truquitosIdentity('a', 't', 'f'))
    assert.notEqual(truquitosIdentity('a', 's', 'f'), truquitosIdentity('a', 's', 'g'))
    const store = new MemoryTruquitosStore(); await restoreOrGenerateTruquitos('bound', context, store, validProse)
    await assert.rejects(restoreOrGenerateTruquitos('bound', { ...context, fingerprint: 'forged' }, store, validProse), /MISMATCH/)
    assert.throws(() => buildTruquitosEnjoyerContext({ ...payload, sourceSelectionFingerprint: 'forged' }, selection), /MISMATCH/)
  })
  console.log(`Truquitos simple architecture: ${count} passed; 0 live provider calls`)
}
if (process.argv[1]?.includes('truquitos-simple-architecture-contracts')) main().catch(error => { console.error(error); process.exitCode = 1 })
