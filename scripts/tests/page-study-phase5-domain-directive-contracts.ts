import './page-study-env'
import assert from 'node:assert/strict'
import { buildFixtureCorpus, makeWorld, type FixtureMaterialSpec } from './page-study-tutor-harness'

/**
 * Phase 5 Blocker 3 "domain sensitivity proof": the previous pass only added prompt TEXT saying
 * chemistry/math/history should get different evaluation forms. This proves that text actually
 * reaches the provider call (inspecting `w.counters.prompts`, the exact strings the fake provider
 * received — the same channel a real provider would receive), not merely that the source file
 * contains the words.
 */
const CHEMISTRY: FixtureMaterialSpec = {
  materialId: 'pdf-1', name: 'Alcanos y alquenos', lang: 'es', pageCount: 2,
  concepts: [
    { id: 'alkane', page: 1, label: 'Alcano', quote: 'Un alcano es un hidrocarburo saturado con fórmula general CnH2n+2.', summary: 'Alcano: hidrocarburo saturado CnH2n+2.' },
    { id: 'sp3', page: 1, label: 'Hibridación sp3', quote: 'En los alcanos el carbono presenta hibridación sp3, con cuatro enlaces sigma.', summary: 'sp3: cuatro enlaces sigma.' },
    { id: 'alkene', page: 2, label: 'Alqueno', quote: 'Un alqueno tiene al menos un doble enlace carbono-carbono y fórmula general CnH2n.', summary: 'Alqueno: doble enlace, CnH2n.' },
    { id: 'sp2', page: 2, label: 'Hibridación sp2', quote: 'En los alquenos el carbono del doble enlace presenta hibridación sp2, con un enlace pi.', summary: 'sp2: un enlace pi.' },
  ],
}

async function main() {
  const corpus = buildFixtureCorpus([CHEMISTRY], 2)
  const w = await makeWorld({ corpus })
  await w.start()
  await w.say('sigue')
  const first = (await w.load()).state
  if (first.pending) await w.say('ANS-OK correcto')
  await w.say('sigue')

  // Drive to a BLOCK_REVIEW turn and inspect the ACTUAL prompt text sent to the provider.
  let sawBlockReviewPrompt = false
  let guard = 0
  while (!sawBlockReviewPrompt && guard < 15) {
    guard++
    const before = (await w.load()).state
    await w.say(before.pending ? 'ANS-OK correcto' : 'sigue')
    const lastPrompt = w.counters.prompts.at(-1)!
    if (/SUGGESTED MOVE: BLOCK_REVIEW/.test(lastPrompt)) {
      sawBlockReviewPrompt = true
      assert.ok(lastPrompt.includes('CUMULATIVE BLOCK REVIEW'), 'the BLOCK_REVIEW-specific directive reached the provider prompt')
      assert.ok(lastPrompt.includes('nomenclature/structure/reaction/application for chemistry'), 'the chemistry-specific evaluation-form guidance reached the provider prompt')
      assert.ok(lastPrompt.includes('calculation/method/interpretation for math'), 'the math-specific guidance is present alongside it (server does not know the domain — it offers all forms, letting the grounded content drive the choice)')
      assert.ok(lastPrompt.includes('chronology/cause-effect/significance/comparison for history'), 'the history-specific guidance is present')
      // The domain content itself (real chemistry concepts) is ALSO in the same prompt, grounding the choice.
      assert.ok(lastPrompt.includes('Alcano') || lastPrompt.includes('Alqueno') || lastPrompt.includes('sp3') || lastPrompt.includes('sp2'), 'the literal chemistry grounding is present in the SAME prompt as the domain directive — the provider can act on both together')
    }
  }
  assert.ok(sawBlockReviewPrompt, 'a BLOCK_REVIEW turn was reached and its prompt was inspected')

  console.log('PASS page-study-phase5-domain-directive: the domain-sensitivity BLOCK_REVIEW directive and the literal chemistry grounding both reach the actual provider prompt in the same turn')
}

main().catch(error => { console.error(error); process.exit(1) })
