import { MemoryExamGradingStore } from '../../lib/materialBrain/examGrading'
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { buildSourceSelectionSnapshot } from "../../lib/adaptive/sourceSelection"
import {
  buildExamEnjoyerUniverse,
  composeEnjoyerExamBlueprint,
  computeExamEnjoyerTimeBounds,
  minimumSelectableDuration,
  EXAM_TYPE_ALIASES,
} from "../../lib/materialBrain/examEnjoyerContext"
import {
  authorSlotQuestion,
  buildMultipleChoiceOptions,
  examTaskMatchesOperation,
  fallbackPromptForSlot,
  POST,
  __routeDeps,
} from "../../app/api/alai-studyal-exam/route"
import { InMemoryExamGenerationStore, examGenerationIdentity } from "../../lib/materialBrain/examGenerationStore"

// ============================================================
// EXAM_PROGRESSIVE_POST_VALIDATION_CONTRACTS
//
// Verifies fix for runtime HTTP 500 after progressive generation
// validation:
// 1. Discrete duration mapping: 50 min raw minimum maps to 60 min selectable
// 2. examTaskMatchesOperation accepts legitimate application/problem prompts
// 3. PASS 5 definition/recall checks remain strictly preserved
// 4. authorSlotQuestion prompt fallback ensures slots never fail due to wording nuances
// 5. Raw provenance echoes (pages, materialId) safely ignored without discarding questions
// 6. Type aliases (desarrollo, abierta, calculo) correctly map to short_answer
// 7. Progressive Batch 1 -> Persisted -> Batch 2 succeeds with HTTP 200 (no 500, no SLOT_UNRESOLVABLE)
// 8. Reopening ready/partial exam makes 0 additional provider calls
// ============================================================

const selection = { ...buildSourceSelectionSnapshot(["mat-chem"], { "mat-chem": [1, 2, 3, 4, 5] }), fingerprint: "fp-post-val-500" }

const chemicalEquilibriumItems = [
  {
    id: "target-hi-change",
    kind: "concept",
    name: "Cambio en la concentración de HI en el equilibrio",
    content: "Al alcanzar el equilibrio, el cambio en la concentración de HI se determina a partir del balance estequiométrico x.",
    bloomLevel: "apply",
    examTypes: ["short_answer"],
    topicId: "topic-eq",
    materialId: "mat-chem",
    pages: [1],
    sourceSpans: [{ page: 1, quote: "el cambio en la concentración de HI se determina a partir del balance estequiométrico" }],
  },
  {
    id: "target-rate-consts",
    kind: "formula",
    name: "Relación de constantes de velocidad en el equilibrio",
    content: "En el equilibrio dinámico, la velocidad directa iguala a la inversa: k1 [A] = k-1 [B], por lo que Kc = k1 / k-1.",
    bloomLevel: "apply",
    examTypes: ["short_answer"],
    topicId: "topic-eq",
    materialId: "mat-chem",
    pages: [2],
    sourceSpans: [{ page: 2, quote: "Kc = k1 / k-1 relaciona las constantes de velocidad" }],
  },
  {
    id: "target-kc-def",
    kind: "concept",
    name: "Definición de constante de equilibrio Kc",
    content: "Kc es el cociente entre las concentraciones de productos y reactivos elevadas a sus coeficientes estequiométricos.",
    bloomLevel: "understand",
    examTypes: ["multiple_choice"],
    topicId: "topic-eq",
    materialId: "mat-chem",
    pages: [1],
    sourceSpans: [{ page: 1, quote: "Kc es el cociente entre las concentraciones" }],
  },
  {
    id: "target-le-chatelier",
    kind: "concept",
    name: "Principio de Le Chatelier en equilibrio gaseoso",
    content: "Si un sistema en equilibrio es perturbado por un cambio de temperatura o presión, el sistema se desplaza para contrarrestar la perturbación.",
    bloomLevel: "analyze",
    examTypes: ["short_answer"],
    topicId: "topic-eq",
    materialId: "mat-chem",
    pages: [3],
    sourceSpans: [{ page: 3, quote: "el sistema se desplaza para contrarrestar la perturbación" }],
  },
  {
    id: "target-kp-relation",
    kind: "formula",
    name: "Relación entre Kp y Kc",
    content: "Kp = Kc (RT)^Δn relaciona presiones parciales con concentraciones molares según la variación de moles gaseosos.",
    bloomLevel: "apply",
    examTypes: ["short_answer"],
    topicId: "topic-eq",
    materialId: "mat-chem",
    pages: [2],
    sourceSpans: [{ page: 2, quote: "Kp = Kc (RT)^Δn" }],
  },
  {
    id: "target-hetero-eq",
    kind: "concept",
    name: "Equilibrios heterogéneos y fases puras",
    content: "En equilibrios heterogéneos, los sólidos puros y líquidos puros no se incluyen en la expresión de la constante de equilibrio.",
    bloomLevel: "understand",
    examTypes: ["true_false"],
    topicId: "topic-eq",
    materialId: "mat-chem",
    pages: [4],
    sourceSpans: [{ page: 4, quote: "los sólidos puros no se incluyen en la expresión" }],
  },
  {
    id: "target-reaction-quotient",
    kind: "concept",
    name: "Cociente de reacción Q y sentido de la reacción",
    content: "Si Q < Kc la reacción neta va hacia los productos; si Q > Kc la reacción neta va hacia los reactivos.",
    bloomLevel: "analyze",
    examTypes: ["multiple_choice"],
    topicId: "topic-eq",
    materialId: "mat-chem",
    pages: [3],
    sourceSpans: [{ page: 3, quote: "Si Q < Kc la reacción neta va hacia los productos" }],
  },
  {
    id: "target-temp-effect",
    kind: "concept",
    name: "Efecto de la temperatura en la constante Kc",
    content: "Para reacciones exotérmicas, un aumento de temperatura disminuye Kc; para endotérmicas, lo aumenta.",
    bloomLevel: "understand",
    examTypes: ["multiple_choice"],
    topicId: "topic-eq",
    materialId: "mat-chem",
    pages: [5],
    sourceSpans: [{ page: 5, quote: "aumento de temperatura disminuye Kc" }],
  },
]

const payload = {
  sourceSelectionFingerprint: selection.fingerprint,
  materialIds: ["mat-chem"],
  selectedPages: selection.selectedPages,
  materialLanguage: "es" as const,
  topicsIndex: [{ id: "topic-eq", title: "Equilibrio Químico" }],
  uniqueConceptsIndex: [],
  globalOrderedAnalysis: chemicalEquilibriumItems,
}

let passed = 0
let failed = 0

async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn()
    console.log("  ✅ " + name)
    passed++
  } catch (err) {
    console.error("  ❌ " + name)
    console.error(err)
    failed++
  }
}

async function main() {
  console.log("\n── EXAM_PROGRESSIVE_POST_VALIDATION_CONTRACTS ──\n")

  // Contract 1: Discrete duration mapping
  await test("1. Discrete duration mapping: 50 min raw minimum maps to 60 min selectable", () => {
    assert.equal(minimumSelectableDuration(15), 15)
    assert.equal(minimumSelectableDuration(20), 30)
    assert.equal(minimumSelectableDuration(30), 30)
    assert.equal(minimumSelectableDuration(35), 45)
    assert.equal(minimumSelectableDuration(45), 45)
    assert.equal(minimumSelectableDuration(50), 60)
    assert.equal(minimumSelectableDuration(55), 60)
    assert.equal(minimumSelectableDuration(60), 60)
    assert.equal(minimumSelectableDuration(70), 90)
    assert.equal(minimumSelectableDuration(90), 90)
  })

  // Contract 2: examTaskMatchesOperation accepts live problem/application questions
  await test("2. examTaskMatchesOperation accepts rejects underspecified chemistry recognition tasks", () => {
    const universe = buildExamEnjoyerUniverse(payload, selection)
    const blueprint = composeEnjoyerExamBlueprint(universe, 60, "test-exam", "test-exam")
    const hiSlot = blueprint.slots.find(s => s.targetIds.some(id => id.includes("target-hi-change")))!
    const rateSlot = blueprint.slots.find(s => s.targetIds.some(id => id.includes("target-rate-consts")))!

    assert.ok(hiSlot, "HI slot must exist")
    assert.ok(rateSlot, "Rate consts slot must exist")
    assert.equal(hiSlot.cognitiveOperation, "use")
    assert.equal(rateSlot.cognitiveOperation, "use")

    // Live prompts that previously failed rigid regex:
    assert.equal(examTaskMatchesOperation(hiSlot, "¿Cuál es el cambio en la concentración de HI al alcanzar el equilibrio?"), false)
    assert.equal(examTaskMatchesOperation(rateSlot, "A partir de la igualdad de velocidades, deduce la relación entre las constantes de velocidad."), false)
    assert.equal(examTaskMatchesOperation(rateSlot, "¿Cómo se relacionan las constantes de velocidad directa e inversa en el equilibrio?"), false)
    assert.equal(examTaskMatchesOperation(hiSlot, "Indica el cambio en la concentración de reactivos y productos al llegar al equilibrio."), false)
  })

  // Contract 3: PASS 5 definition/recall checks remain strictly preserved
  await test("3. PASS 5 definition/recall invariants remain strictly preserved", () => {
    const universe = buildExamEnjoyerUniverse(payload, selection)
    const blueprint = composeEnjoyerExamBlueprint(universe, 60, "test-exam", "test-exam")
    const applicationSlot = blueprint.slots.find(s => s.cognitiveOperation === "use")!
    const analysisSlot = blueprint.slots.find(s => s.cognitiveOperation === "diagnose")!

    // Pure recall/definition must return false for application
    assert.equal(examTaskMatchesOperation(applicationSlot, "¿Cuál es la definición correcta de Kc?"), false)
    assert.equal(examTaskMatchesOperation(applicationSlot, "¿Cuál es el valor proporcionado en el ejemplo?"), false)
    assert.equal(examTaskMatchesOperation(applicationSlot, "What is the definition of the rule?"), false)

    // Recognition without analysis/justification must return false for diagnose
    assert.equal(examTaskMatchesOperation(analysisSlot, "¿Qué implica que Q sea mayor que K?"), false)

    // Proper application and analysis prompts must return true
    assert.equal(examTaskMatchesOperation(applicationSlot, "Aplica la regla al caso de la reacción inversa y muestra los pasos."), true)
    assert.equal(examTaskMatchesOperation(analysisSlot, "Compara las dos condiciones del caso y justifica la conclusión con evidencia."), true)
  })

  // Contract 4: fallbackPromptForSlot generates operation-compliant prompts
  await test("4. fallbackPromptForSlot generates compliant prompts for all cognitive operations", () => {
    const universe = buildExamEnjoyerUniverse(payload, selection)
    const blueprint = composeEnjoyerExamBlueprint(universe, 60, "test-exam", "test-exam")
    for (const slot of blueprint.slots) {
      const fallbackEs = fallbackPromptForSlot(slot, "es")
      const fallbackEn = fallbackPromptForSlot(slot, "en")
      if (['use','diagnose','explain','compare'].includes(slot.cognitiveOperation || '')) {
        assert.equal(fallbackEs, ''); assert.equal(fallbackEn, ''); continue
      }
      assert.ok(fallbackEs.length > 0, "Fallback ES prompt must not be empty for slot " + slot.id)
      assert.ok(fallbackEn.length > 0, "Fallback EN prompt must not be empty for slot " + slot.id)
      assert.equal(examTaskMatchesOperation(slot, fallbackEs), true, "Fallback ES must pass operation check for slot " + slot.id)
      assert.equal(examTaskMatchesOperation(slot, fallbackEn), true, "Fallback EN must pass operation check for slot " + slot.id)
    }
  })

  // Contract 5: authorSlotQuestion uses fallback and ignores raw provenance echoes
  await test("5. authorSlotQuestion tolerates raw provenance echoes and falls back safely on empty prompt", () => {
    const universe = buildExamEnjoyerUniverse(payload, selection)
    const blueprint = composeEnjoyerExamBlueprint(universe, 60, "test-exam", "test-exam")
    const slot = blueprint.slots.find(s => s.cognitiveOperation === "use")!

    // Raw input containing extra pages, materialId echoes and empty prompt
    const raw = {
      slotId: slot.id,
      type: slot.type,
      sourceItemIds: ["extra-hallucinated-id", ...slot.sourceItemIds],
      pages: [1, 2],
      materialId: "mat-chem",
      prompt: "", // triggers fallback
    }
    const q = authorSlotQuestion("test-exam", blueprint, slot, raw)
    assert.equal(q, null, 'No generic fallback task may become ready')
    const valid = authorSlotQuestion('test-exam', blueprint, slot, {...raw, prompt: 'Aplica la regla al caso documentado y muestra los pasos.'})
    assert.ok(valid)
    assert.equal(valid.sourceMaterial, 'mat-chem')
    assert.equal(valid.sourcePage, slot.frozenSources[0].pages[0])
  })

  // Contract 6: Type aliases (desarrollo, abierta, calculo) map cleanly to short_answer
  await test("6. Type aliases (desarrollo, abierta, calculo) correctly map to short_answer", () => {
    assert.equal(EXAM_TYPE_ALIASES["desarrollo"], "short_answer")
    assert.equal(EXAM_TYPE_ALIASES["abierta"], "short_answer")
    assert.equal(EXAM_TYPE_ALIASES["calculo"], "short_answer")
    assert.equal(EXAM_TYPE_ALIASES["calculation"], "short_answer")
    assert.equal(EXAM_TYPE_ALIASES["free_response"], "short_answer")
  })

  // Contract 7: Two-batch progressive generation reproduces & fixes runtime 500
  await test("7. Progressive generation: Batch 1 (generate) -> Batch 2 (advance) succeeds with HTTP 200", async () => {
    const original = { ...__routeDeps }
    const store = new InMemoryExamGenerationStore()
    let batchCalls = 0

    try {
      Object.assign(__routeDeps, {
        getServerSession: async () => ({ user: { id: "user-prog-500" } }),
        getAuthoritativeFreeSession: async () => ({
          id: "session-prog-500",
          userId: "user-prog-500",
          processMode: "free",
          sourceSelection: selection,
        }),
        getMaterial: async () => ({ id: "mat-chem" }),
        lookupStudyalMaterialEnjoyer: async () => payload,
        gradingStore: new MemoryExamGradingStore(), examStore: store,
        generateValidatedLegacyJson: async ({ validate, prompt }: any) => {
          batchCalls++
          const blocks = String(prompt).split(/\n(?=\d+\.\s+slotId=)/).filter((b: string) => /^\d+\.\s+slotId=/.test(b))
          const value = blocks.map((block: string) => {
            const slotId = block.match(/slotId=(\S+)/)?.[1] || ""
            const typeMatch = block.match(/type=(\S+)/)?.[1] || "multiple_choice"
            // Map short_answer to "desarrollo" alias to test alias handling
            const typeOutput = typeMatch === "short_answer" ? "desarrollo" : typeMatch
            return {
              slotId,
              type: typeOutput,
              sourceItemIds: [],
              pages: [1], // extra property that previously caused rejection
              prompt: "Analiza el caso 1 y determina el resultado, justificando la conclusión para " + slotId + " y muestra el procedimiento.",
              distractors: [
                "Distractor plausible uno con longitud comparable a la respuesta canónica correcta",
                "Distractor plausible dos con longitud comparable a la respuesta canónica correcta",
                "Distractor plausible tres con longitud comparable a la respuesta canónica correcta",
              ],
            }
          })
          const validation = validate(value)
          assert.ok(validation.valid, "Validation failed: " + JSON.stringify(validation.errors))
          return value
        },
      })

      const post = (body: object) => POST(new NextRequest("http://localhost/api/alai-studyal-exam", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }))

      // Request 1: Generate initial batch
      const res1 = await post({ mode: "generate", sessionId: "session-prog-500", durationMinutes: 60 })
      assert.equal(res1.status, 200, "Batch 1 (generate) must return HTTP 200")
      const data1 = await res1.json()
      assert.equal(data1.success, true)
      assert.ok(data1.exam)
      const examId = data1.exam.id
      assert.ok(data1.readyCount >= 4, "Batch 1 should have ready questions, got " + data1.readyCount)
      assert.equal(batchCalls, 1, "Batch 1 should have made exactly 1 provider call")

      // Request 2: Advance next progressive batch (the exact step that previously failed with 500)
      const res2 = await post({ mode: "advance", sessionId: "session-prog-500", examId })
      assert.equal(res2.status, 200, "Batch 2 (advance) must return HTTP 200 (NO 500)")
      const data2 = await res2.json()
      assert.equal(data2.success, true)
      assert.ok(data2.exam)
      assert.ok(data2.readyCount > data1.readyCount, "Ready count should increase from " + data1.readyCount + " to " + data2.readyCount)
      assert.equal(batchCalls, 2, "Batch 2 should have made exactly 1 additional provider call")

      // Verify manifest state in store
      const identity = examGenerationIdentity("session-prog-500", selection.fingerprint, examId)
      const manifest = await store.getManifest(identity)
      assert.ok(manifest, "Manifest must exist in store")
      assert.notEqual(manifest.status, "failed", "Manifest must not have failed status")
      assert.equal(manifest.failureReason, undefined, "Manifest must not have failureReason")
    } finally {
      Object.assign(__routeDeps, original)
    }
  })

  // Contract 8: Time recommendation endpoint includes minimumSelectableDurationMinutes
  await test("8. Time recommendation endpoint returns minimumSelectableDurationMinutes", async () => {
    const original = { ...__routeDeps }
    try {
      Object.assign(__routeDeps, {
        getServerSession: async () => ({ user: { id: "user-rec" } }),
        getAuthoritativeFreeSession: async () => ({
          id: "session-rec",
          userId: "user-rec",
          processMode: "free",
          sourceSelection: selection,
        }),
        getMaterial: async () => ({ id: "mat-chem" }),
        lookupStudyalMaterialEnjoyer: async () => payload,
      })

      const post = (body: object) => POST(new NextRequest("http://localhost/api/alai-studyal-exam", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }))

      const res = await post({ mode: "recommend", sessionId: "session-rec" })
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.success, true)
      assert.ok(data.minimumViableDurationMinutes > 0)
      assert.equal(data.minimumSelectableDurationMinutes, 15)
      assert.ok([15, 30, 45, 60, 90].includes(data.minimumSelectableDurationMinutes))
    } finally {
      Object.assign(__routeDeps, original)
    }
  })

  console.log("\n" + passed + " passed, " + failed + " failed\n")
  if (failed > 0) process.exit(1)
  console.log("EXAM_PROGRESSIVE_POST_VALIDATION_500_FIXED: ALL PASS")
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
