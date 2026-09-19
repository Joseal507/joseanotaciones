/** Explicit, opt-in live probe: real provider, real route, real client reducers. Auth/session/store are in-memory; synthetic content only. */
import assert from 'node:assert/strict'
import { detectMaterialLanguage, withMaterialLanguage } from '../../lib/materialLanguage'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { alaiPendingQuestionRef } from '../../lib/freeAlaiState'
import { buildPayload, KEYS, F } from './five-material-fixture'
import { languageFixtures } from './material-language-authority-contracts'
import { Client, chemistry, install, state } from './alai-practice-harness'

const transcript: Record<string, unknown> = {}
async function main() {
  const chem = chemistry(); install(chem.payload, chem.selection, undefined, true)
  const client = new Client()
  await client.send('¿Qué es un enlace covalente?')                       // Preguntar has its own conversation
  await client.switchTo('answer')
  const q1 = client.visible('answer'); assert.equal(q1.length, 1); assert.match(q1[0].content, /\?/); assert.equal(detectMaterialLanguage(q1[0].content), 'es')
  transcript.q1 = q1[0].content
  const calls = state.providerCalls
  await client.switchTo('ask'); await client.switchTo('answer')
  assert.equal(state.providerCalls, calls, 'switching tabs made no provider call'); assert.equal(client.visible('answer')[0].content, q1[0].content)
  const ref1 = alaiPendingQuestionRef(client.view('answer'))
  const concept = client.lastAssistant('answer')!.conversationContext!.practiceCurrentTargetIds
  // incorrect answer → remediation on the SAME concept
  await client.send('El carbono no tiene electrones de valencia, por eso no forma enlaces.')
  const wrong = client.lastAssistant('answer')!.conversationContext!; transcript.afterWrong = client.lastAssistant('answer')!.content
  assert.match(String(wrong.practiceLastVerdict), /incorrect|partial/, 'a wrong answer is not judged correct')
  assert.deepEqual(wrong.practiceCurrentTargetIds, concept, 'stays on the same concept'); assert.deepEqual(wrong.practiceTargetIds, [])
  assert.notEqual(alaiPendingQuestionRef(client.view('answer')), ref1)
  // demonstrate understanding → advance
  await client.send('El carbono tiene cuatro electrones de valencia, por lo tanto puede formar cuatro enlaces covalentes.')
  const right = client.lastAssistant('answer')!.conversationContext!; transcript.afterRight = client.lastAssistant('answer')!.content
  assert.equal(right.practiceLastVerdict, 'correct'); assert.notDeepEqual(right.practiceCurrentTargetIds, concept); assert.deepEqual(right.practiceTargetIds, concept)
  const q2 = client.visible('answer').at(-1)!.content
  const beforeReturn = state.providerCalls
  await client.switchTo('ask'); await client.switchTo('answer')
  assert.equal(state.providerCalls, beforeReturn); assert.equal(client.visible('answer').at(-1)!.content, q2, 'Q2 stays pending')
  assert.equal(client.visible('answer').some(m => /Ya analicé tu material/.test(m.content)), false)

  // Chinese + English five materials
  const zhSel = buildSourceSelectionSnapshot(['mat-zh'], { 'mat-zh': [1] })
  const zhPayload = withMaterialLanguage({ blueprint: { sourceSelectionFingerprint: zhSel.fingerprint, materialIds: ['mat-zh'], selectedPages: zhSel.selectedPages, topicsIndex: [{ id: 't', title: '光合作用', order: 0 }],
    globalOrderedAnalysis: [{ id: 'x', kind: 'concept', label: '光合作用', name: '光合作用', summary: languageFixtures.zh, content: languageFixtures.zh, importance: 90, materialId: 'mat-zh', pages: [1], topicId: 't', globalOrder: 0, sourceSpans: [{ page: 1, quote: languageFixtures.zh }] }], uniqueConceptsIndex: [] } })
  install(zhPayload, zhSel, undefined, true)
  const zh = new Client(); await zh.switchTo('answer'); transcript.zh = zh.visible('answer')[0].content
  assert.match(zh.visible('answer')[0].content, /\p{Script=Han}/u)
  const five = buildPayload(KEYS); install(five.payload, five.selection, undefined, true)
  const en = new Client(); await en.switchTo('answer'); transcript.en = en.visible('answer')[0].content
  assert.equal(detectMaterialLanguage(en.visible('answer')[0].content), 'en', `EN: ${en.visible('answer')[0].content}`)
  assert.ok((en.lastAssistant('answer')!.evidence ?? []).every(e => e.materialId !== F.id))
  await en.send('Explícamelo en español, no entiendo la pregunta.')
  transcript.enOverride = en.lastAssistant('answer')!.content
  assert.equal(detectMaterialLanguage(en.lastAssistant('answer')!.content), 'es', 'response-scoped override'); assert.equal((five.payload as any).blueprint.materialLanguage, 'en')
  console.log(JSON.stringify({ transcript }, null, 2))
  console.log(`LIVE PASS alai-chat-practice: independent threads, pending Q1 restored with no call, wrong→same concept, correct→advance, zh/en/override`)
}
main().catch(error => { console.error(JSON.stringify(transcript, null, 2)); console.error(error); process.exit(1) })
