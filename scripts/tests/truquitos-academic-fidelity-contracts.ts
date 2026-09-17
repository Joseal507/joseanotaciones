import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { buildTruquitosEnjoyerContext } from '../../lib/materialBrain/truquitosEnjoyerContext'
import {
  buildProsePrompt, parseSlotProse, restoreOrGenerateTruquitos, selectTruquitosSlots,
  type ProseProvider, type TruquitosStore,
} from '../../lib/truquitos/artifact'
import { MemoryTruquitosStore } from './truquitos-simple-architecture-contracts'

// ============================================================
// TRUQUITOS_ACADEMIC_FIDELITY contracts.
//
// A live CLUTCH 2.pdf card ("Cálculo de Kc con Sólidos") told the
// student Kc = [HI]^2 / [H2] — the provider had silently "corrected"
// the source's own worked answer (Kc = [HI]^2 / ([H2][I2]) = 51, pages
// 28-33) by applying the general pure-solids-are-omitted rule, which
// does not even apply here (I2 is not a solid in this problem) and,
// more fundamentally, contradicts what the attached canonical source
// itself computes. StudyalMaterialEnjoyer is the sole academic
// authority for the session — Truquitos prose may never invent,
// correct, replace, or contradict it.
//
// Root cause: the prompt already said "no formulas" but nothing
// enforced it — parseSlotProse only rejected control characters and
// `\ $ *`. Fix: reject any bracket/exponent/equation-shaped span in
// prose structurally (by SHAPE, never by judging whether the specific
// values are right or wrong, and never chemistry-specific) — the
// canonical formula is already rendered verbatim, byte-faithfully,
// from canonicalSources; prose only ever needs to talk about it.
// ============================================================

const artifactSource = fs.readFileSync('lib/truquitos/artifact.ts', 'utf8')

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

// Realistic CLUTCH 2.pdf-shaped fixture: the exact reported ICE/Kc
// worked-problem cluster, where the source's OWN computed value
// deliberately looks "unusual" against the general pure-solids rule
// (I2 here is NOT a solid, so a model applying that rule anyway is
// exactly the reported failure).
const selection = buildSourceSelectionSnapshot(['clutch'], { clutch: [28, 29, 30, 31, 32, 33] })
const kcWorkedAnswer = 'Kc = [HI]^2 / ([H2][I2]) = 51'
const payload = {
  sourceSelectionFingerprint: selection.fingerprint, materialIds: ['clutch'], selectedPages: selection.selectedPages, language: 'es',
  globalOrderedAnalysis: [
    { id: 'kc-worked', name: 'Cálculo de Kc con sólidos', kind: 'formula',
      content: `Problema resuelto de equilibrio H2 + I2 <-> 2HI. Datos iniciales y tabla ICE en p.28-31. Resultado final: ${kcWorkedAnswer}.`,
      importance: 92, materialId: 'clutch', pages: [28, 29, 30, 31, 32, 33], topicId: 'ice-kc', globalOrder: 0 },
  ], topicsIndex: [], relations: [],
}
const context = buildTruquitosEnjoyerContext(payload, selection)

async function main() {
  console.log('\n── TRUQUITOS_ACADEMIC_FIDELITY contracts ──\n')

  await test('1. an internally unusual source worked answer is followed, never "corrected": a provider that drops [I2] (applying the general pure-solids rule, which does not even apply here) produces prose that is structurally rejected, never accepted as the card', async () => {
    const slots = selectTruquitosSlots(context)
    const badProvider: ProseProvider = async params => {
      const requested = JSON.parse(params.messages[0].content.split('SLOTS:\n')[1]) as { slotId: string }[]
      return {
        text: JSON.stringify({ slots: requested.map(s => ({ slotId: s.slotId, title: 'Cálculo de Kc con sólidos',
          // The exact reported live corruption: the model "corrects" the
          // source's own equation by omitting a term via an outside
          // convention.
          trick: 'Recuerda: Kc = [HI]^2 / [H2], porque los sólidos puros se omiten de la expresión.' })) }),
        provider: 'mock', model: 'offline',
      }
    }
    const store: TruquitosStore = new MemoryTruquitosStore()
    const artifact = await restoreOrGenerateTruquitos('fidelity-bad', context, store, badProvider, { slots })
    // The malformed (formula-reconstructing) sibling is never accepted —
    // it stays missing, consuming budget, rather than silently landing
    // in the artifact with a value that contradicts the source.
    assert.equal(artifact.cards.some(card => card.content.includes('[HI]')), false, 'a card that reproduces/alters the source equation must never be persisted')
    assert.equal(artifact.status, 'failed', 'exhausting the bounded budget on an unusable output must fail honestly, never silently substitute a wrong equation')
    assert.equal(artifact.callsUsed, 2)
  })

  await test('2. a provider that talks ABOUT the source formula verbally, without reproducing/altering it, is accepted normally (the fix rejects the SHAPE, not legitimate pedagogy)', async () => {
    const slots = selectTruquitosSlots(context)
    const goodProvider: ProseProvider = async params => {
      const requested = JSON.parse(params.messages[0].content.split('SLOTS:\n')[1]) as { slotId: string }[]
      return {
        text: JSON.stringify({ slots: requested.map(s => ({ slotId: s.slotId, title: 'Recuerda el resultado del problema',
          trick: 'El problema resuelto de la fuente ya te da el valor final de Kc para este equilibrio; repásalo tal como está en el material antes del examen, sin recalcularlo desde una regla general.' })) }),
        provider: 'mock', model: 'offline',
      }
    }
    const store: TruquitosStore = new MemoryTruquitosStore()
    const artifact = await restoreOrGenerateTruquitos('fidelity-good', context, store, goodProvider, { slots })
    assert.equal(artifact.status, 'ready')
    assert.equal(artifact.callsUsed, 1, 'a well-behaved provider still costs exactly one call — the fix never taxes the happy path')
  })

  await test('3. pedagogical analogy purpose is held to the SAME structural contract: an analogy that restates the equation instead of only simplifying presentation is rejected too, not carved out as an exception', () => {
    const rows = [{ slotId: 'analogy-slot', title: 'Piensa en dos puertas',
      trick: 'Como si Kc = [HI]^2 / [H2] fuera dos puertas con distinto flujo de personas.' }]
    const fakeSlot = { id: 'analogy-slot', purpose: 'analogy' as const, target: context.targets[0] }
    const result = parseSlotProse(JSON.stringify({ slots: rows }), [fakeSlot], [])
    assert.equal(result.size, 0, 'an analogy that reproduces a formula must be rejected exactly like any other purpose')
  })

  await test('4. the provider must not add a specific academic claim unsupported by the target — softer case (an unsupported direction/condition, no formula syntax involved): mitigated at the prompt boundary since a deterministic structural check cannot exist here without truth/keyword classification or external knowledge (both explicitly out of scope)', () => {
    assert.match(artifactSource, /sole academic authority for this session/)
    assert.match(artifactSource, /Never "correct", generalize, or apply an outside convention/)
    assert.match(artifactSource, /If the source does not specify a detail \(a direction, a condition, a magnitude\), do not supply one yourself/)
  })

  await test('5. canonical formula/source fields remain byte-untouched by this fix: the rejected card never existed, and the SAME target\'s canonicalSources content is unchanged regardless of what the provider attempted', () => {
    const target = context.targets[0]
    assert.ok(target.content.includes(kcWorkedAnswer), 'the canonical Enjoyer target content must still contain the exact source worked answer, unedited')
    assert.equal((target.canonicalSources || [{ content: target.content }])[0].content, target.content)
  })

  await test('6. existing category-diversity capability (4/4/4-style) is unaffected by this fix — selectTruquitosSlots still spans esencial/estrategico/examen deterministically on a realistic multi-target batch', () => {
    const multiPayload = {
      ...payload,
      globalOrderedAnalysis: Array.from({ length: 12 }, (_, i) => ({
        id: `t${i}`, name: `Concepto ${i}`, kind: i % 3 === 0 ? 'formula' : i % 3 === 1 ? 'process' : 'definition',
        content: `Contenido suficientemente largo y real para el concepto de equilibrio numero ${i}.`,
        importance: 92, materialId: 'clutch', pages: [28 + (i % 6)], topicId: `topic-${i}`, globalOrder: i,
      })),
    }
    const multiContext = buildTruquitosEnjoyerContext(multiPayload, selection)
    const slots = selectTruquitosSlots(multiContext, 12)
    const categories = new Set(slots.map(slot => require('../../lib/truquitos/artifact').PURPOSES[slot.purpose].category))
    assert.equal(categories.size, 3, 'esencial/estrategico/examen must all still be reachable after this fix')
  })

  await test('7. fresh happy path remains exactly 1 provider call end-to-end through buildProsePrompt (unchanged budget contract)', async () => {
    const slots = selectTruquitosSlots(context)
    let calls = 0
    const provider: ProseProvider = async params => {
      calls++
      const requested = JSON.parse(params.messages[0].content.split('SLOTS:\n')[1]) as { slotId: string }[]
      return {
        text: JSON.stringify({ slots: requested.map(s => ({ slotId: s.slotId, title: 'Pista', trick: 'Una pista verbal suficientemente concreta y segura, sin reconstruir la formula original.' })) }),
        provider: 'mock', model: 'offline',
      }
    }
    const store: TruquitosStore = new MemoryTruquitosStore()
    const artifact = await restoreOrGenerateTruquitos('fidelity-budget', context, store, provider, { slots })
    assert.equal(calls, 1)
    assert.equal(artifact.status, 'ready')
    // Reopen: still 0 additional calls.
    await restoreOrGenerateTruquitos('fidelity-budget', context, store, provider, { slots })
    assert.equal(calls, 1)
  })

  await test('8. buildProsePrompt still forbids formulas explicitly at the instruction level, in addition to the new structural enforcement (defense in depth, not a replacement)', () => {
    const prompt = buildProsePrompt(selectTruquitosSlots(context), 'es')
    assert.match(prompt, /No Markdown, LaTeX, formulas, scores, categories or source identifiers/)
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('truquitos-academic-fidelity-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
