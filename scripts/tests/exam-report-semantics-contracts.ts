import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import {
  MemoryExamGradingStore,
  advanceExamGrading,
  gradingIdentity,
  type ExamGradingJob,
  type ExamGradingStore,
  type CriterionResult,
} from "../../lib/materialBrain/examGrading"
import {
  InMemoryExamGenerationStore,
  examGenerationIdentity,
  EXAM_MANIFEST_SCHEMA_VERSION,
  type ExamArtifact,
  type ExamGenerationManifest,
} from "../../lib/materialBrain/examGenerationStore"
import {
  EXAM_ENJOYER_AUTHORITY_TYPE,
  buildExamEnjoyerUniverse,
  composeEnjoyerExamBlueprint,
  type ExamAssessmentCriterion,
  type ExamComposedSlot,
  type ExamQuestionType,
} from "../../lib/materialBrain/examEnjoyerContext"
import {
  POST,
  optionsCollide,
  promptsCollide,
  buildMultipleChoiceOptionsWithDiagnostics,
  authorSlotQuestionWithDiagnostics,
  __routeDeps,
} from "../../app/api/alai-studyal-exam/route"
import { autoMath } from "../../lib/adaptive/v3/ui/autoMath"
import { prepareAcademicContentForDelivery } from "../../lib/academic-content/validation"
import type { SourceSelectionSnapshot } from "../../lib/adaptive/sourceSelection"

console.log("\n── EXAM_REPORT_SEMANTICS_AND_QUALITY CONTRACTS ──\n")

async function main() {
  console.log("--- Test 1: P0 Report Semantics Contradiction (Bohr 24-Target Regression) ---")
  const examStore = new InMemoryExamGenerationStore()
  const gradingStore = new MemoryExamGradingStore()

  const userId = "user-bohr-report"
  const sessionId = "session-bohr-report"
  const fingerprint = "fp-bohr-24"
  const examId = "exam-bohr-24"
  const identity = examGenerationIdentity(sessionId, fingerprint, examId)

  let providerCalls = 0
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: userId } }),
    getAuthoritativeFreeSession: async () => ({
      id: sessionId, userId, processMode: "free",
      sourceSelection: { fingerprint, materialIds: ["mat-bohr"], selectedPages: { "mat-bohr": [1, 2, 4] } },
    }),
    getMaterial: async () => ({ id: "mat-bohr", nombre: "Niels Bohr" }),
    gradingStore,
    examStore,
    generateValidatedLegacyJson: async ({ prompt, beforeProviderAttempt, telemetryContext }: any) => {
      if (telemetryContext && telemetryContext.phase === "semantic_grade") {
        await (beforeProviderAttempt && beforeProviderAttempt())
        providerCalls++
        const batch = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1))
        return {
          judgments: batch.map((item: any) => ({
            criterionId: item.criterion.criterionId,
            scorePercent: item.criterion.criterionId === "crit-bohr-open-2" ? 40 : 100,
            status: item.criterion.criterionId === "crit-bohr-open-2" ? "partial" : "correct",
            feedback: item.criterion.criterionId === "crit-bohr-open-2" ? "Incompleto." : "Excelente desarrollo.",
          })),
        }
      }
      throw new Error("Unexpected generator call")
    },
  })

  const DEMONSTRATED_8 = [
    "Colaboraciones cientificas de Niels Bohr",
    "Fecha y lugar de nacimiento",
    "Ecuacion de Niveles de Energia",
    "Contribucion de Bohr a la comprension del universo",
    "Colaboracion de Bohr con Rutherford",
    "Impacto del Modelo de Bohr en la Fisica",
    "Impacto de Bohr en la Comprension de la Realidad",
    "Explicacion del Espectro del Hidrogeno",
  ]

  const targets = [
    ...DEMONSTRATED_8.map((label, i) => ({
      targetId: "target-dem-" + (i + 1),
      label,
      pages: [1, 2, 4],
      canonicalRequirement: "Contenido canonico de " + label,
    })),
    { targetId: "target-part-1", label: "Estructura del nucleo atomico", pages: [3], canonicalRequirement: "Nucleo" },
    { targetId: "target-part-2", label: "Principio de correspondencia", pages: [5], canonicalRequirement: "Correspondencia" },
    { targetId: "target-not-dem-1", label: "Efecto Zeeman anomalo", pages: [6], canonicalRequirement: "Zeeman" },
    { targetId: "target-unassessed-1", label: "Vida en Manchester", pages: [2], canonicalRequirement: "Manchester" },
    { targetId: "target-unassessed-2", label: "Premio Sonning", pages: [7], canonicalRequirement: "Sonning" },
  ]

  const questions: any[] = DEMONSTRATED_8.map((label, i) => ({
    id: "q-dem-" + (i + 1),
    slotId: "slot-dem-" + (i + 1),
    type: "multiple_choice",
    prompt: "Detalle clave sobre " + label + "?",
    points: 10,
    skill: "retention",
    difficulty: "medium",
    options: ["Opcion incorrecta A", "Respuesta canonica de " + label, "Opcion incorrecta B", "Opcion incorrecta C"],
    correctAnswer: 1,
    assessmentCriteria: [{
      criterionId: "crit-dem-" + (i + 1),
      targetIds: ["target-dem-" + (i + 1)],
      operation: "retrieve",
      canonicalCriterion: "Respuesta canonica de " + label,
      gradingMode: "deterministic",
      points: 10,
      skill: "retention",
      label,
      sourceItemId: "item-dem-" + (i + 1),
      materialId: "mat-bohr",
      pages: [1, 2, 4],
    }],
  }))

  questions.push({
    id: "q-part-1",
    slotId: "slot-part-1",
    type: "multiple_choice",
    prompt: "Pregunta parcial sobre nucleo",
    points: 10,
    skill: "comprehension",
    difficulty: "medium",
    options: ["Correcta", "Incorrecta 1", "Incorrecta 2", "Incorrecta 3"],
    correctAnswer: 0,
    assessmentCriteria: [{
      criterionId: "crit-part-1",
      targetIds: ["target-part-1"],
      operation: "interpret",
      canonicalCriterion: "Correcta",
      gradingMode: "deterministic",
      points: 10,
      skill: "comprehension",
      label: "Estructura del nucleo atomico",
      sourceItemId: "item-part-1",
      materialId: "mat-bohr",
      pages: [3],
    }],
  })

  questions.push({
    id: "q-part-2",
    slotId: "slot-part-2",
    type: "short_answer",
    prompt: "Explica el principio de correspondencia.",
    points: 10,
    skill: "explanation",
    difficulty: "advanced",
    expectedAnswer: "El principio establece...",
    assessmentCriteria: [{
      criterionId: "crit-bohr-open-2",
      targetIds: ["target-part-2"],
      operation: "explain",
      canonicalCriterion: "El principio establece...",
      gradingMode: "semantic",
      points: 10,
      skill: "explanation",
      label: "Principio de correspondencia",
      sourceItemId: "item-part-2",
      materialId: "mat-bohr",
      pages: [5],
    }],
  })

  questions.push({
    id: "q-not-dem-1",
    slotId: "slot-not-dem-1",
    type: "multiple_choice",
    prompt: "Pregunta sobre efecto Zeeman",
    points: 10,
    skill: "retention",
    difficulty: "advanced",
    options: ["A", "B", "C", "D"],
    correctAnswer: 0,
    assessmentCriteria: [{
      criterionId: "crit-not-dem-1",
      targetIds: ["target-not-dem-1"],
      operation: "retrieve",
      canonicalCriterion: "A",
      gradingMode: "deterministic",
      points: 10,
      skill: "retention",
      label: "Efecto Zeeman anomalo",
      sourceItemId: "item-not-dem-1",
      materialId: "mat-bohr",
      pages: [6],
    }],
  })

  const slots: ExamComposedSlot[] = questions.map(q => ({
    id: q.slotId,
    type: q.type,
    skill: q.skill,
    difficulty: q.difficulty,
    sourceItemIds: [q.assessmentCriteria[0].sourceItemId],
    primaryTargetId: q.assessmentCriteria[0].targetIds[0],
    assessedTargetIds: q.assessmentCriteria[0].targetIds,
    contextTargetIds: [],
    assessmentFocus: q.assessmentCriteria[0].label,
    cognitiveOperation: q.assessmentCriteria[0].operation,
    assessmentCriteria: q.assessmentCriteria,
    answerAuthority: { kind: "single_text", canonicalValue: "Test" },
    frozenSources: [{
      sourceItemId: q.assessmentCriteria[0].sourceItemId,
      materialId: "mat-bohr",
      pages: [1],
      label: q.assessmentCriteria[0].label,
      content: "Source text",
      kind: "concept",
    }],
  }))

  const now = new Date().toISOString()
  const manifest: ExamGenerationManifest = {
    schemaVersion: EXAM_MANIFEST_SCHEMA_VERSION,
    identity,
    sessionId,
    fingerprint,
    examId,
    status: "ready",
    totalSlots: questions.length,
    readyCount: questions.length,
    slots: Object.fromEntries(slots.map(s => [s.id, { status: "ready", attempts: 1 }])),
    providerAttemptsBudget: 46,
    providerAttemptsUsed: 1,
    createdAt: now,
    updatedAt: now,
    blueprint: {
      examId,
      authorityType: EXAM_ENJOYER_AUTHORITY_TYPE,
      version: "1.0.0",
      requestedDurationMinutes: 30,
      estimatedDurationMinutes: 30,
      difficultyTier: "medium",
      materialLanguage: "es",
      fingerprint,
      targetUniverse: targets,
      slots,
      coverage: {
        targetUniverseCount: targets.length,
        consideredCount: targets.length,
        touchedTargetIds: targets.map(t => t.targetId),
        criteriaCount: questions.length,
        targetsWithLegitimateCriteriaCount: 11,
        sufficientEvidenceTargetIds: [],
        coveragePercent: 100,
      } as any,
    },
  }

  const artifact: ExamArtifact<any> = {
    examId,
    fingerprint,
    meta: {
      status: "ready",
      generatedAt: now,
    },
    questions,
  }

  await examStore.saveManifest(identity, manifest)
  await examStore.saveArtifact(identity, artifact)

  const answers: any[] = [
    1, 1, 1, 1, 1, 1, 1, 1,
    3,
    "Mi respuesta sobre correspondencia",
    2,
  ]
  const confidences = answers.map(() => "high")

  const post = async (body: any) => {
    const req = new NextRequest("http://localhost/api/alai-studyal-exam", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    const res = await POST(req)
    return { status: res.status, data: await res.json() }
  }

  let evalRes = await post({ mode: "evaluate", sessionId, examId, answers, confidences })
  if (evalRes.status === 409) { evalRes = await post({ mode: "evaluate", sessionId, examId, answers, confidences }) }
  assert.equal(evalRes.status, 200, "Evaluation should succeed")
  const evaluation = evalRes.data.evaluation
  assert.ok(evaluation, "Evaluation object must exist")

  for (const label of DEMONSTRATED_8) {
    const row = evaluation.targetEvidence.find((t: any) => t.label === label)
    assert.ok(row, "Target " + label + " must be present in targetEvidence")
    assert.equal(row.status, "demonstrated", label + " status must be demonstrated")
    assert.equal(row.scorePercent, 100, label + " scorePercent must be 100")
    assert.equal(row.sufficientEvidence, true, label + " sufficientEvidence must be true")

    assert.ok(evaluation.masteredConcepts.includes(label), label + " MUST appear in masteredConcepts")
    assert.ok(!evaluation.weakConcepts.includes(label), label + " MUST NOT appear in weakConcepts")
    assert.ok(!evaluation.recoveryPlan.some((p: any) => p.title === label), label + " MUST NOT appear in recoveryPlan")
  }

  const partTarget = evaluation.targetEvidence.find((t: any) => t.targetId === "target-part-2")
  assert.ok(partTarget, "Partial target must be present")
  assert.equal(partTarget.status, "partial")
  assert.equal(partTarget.sufficientEvidence, false)
  assert.ok(evaluation.weakConcepts.includes(partTarget.label), "Partial target must appear in weakConcepts")
  assert.ok(evaluation.recoveryPlan.some((p: any) => p.title === partTarget.label), "Partial target must appear in recoveryPlan")
  assert.ok(!evaluation.masteredConcepts.includes(partTarget.label), "Partial target must NOT appear in masteredConcepts")

  const notDemTarget = evaluation.targetEvidence.find((t: any) => t.targetId === "target-not-dem-1")
  assert.ok(notDemTarget, "Not demonstrated target must be present")
  assert.equal(notDemTarget.status, "not_demonstrated")
  assert.equal(notDemTarget.sufficientEvidence, false)
  assert.ok(evaluation.weakConcepts.includes(notDemTarget.label), "Not demonstrated target must appear in weakConcepts")
  assert.ok(evaluation.recoveryPlan.some((p: any) => p.title === notDemTarget.label), "Not demonstrated target must appear in recoveryPlan")
  assert.ok(!evaluation.masteredConcepts.includes(notDemTarget.label), "Not demonstrated target must NOT appear in masteredConcepts")

  const unassessedTarget = evaluation.targetEvidence.find((t: any) => t.targetId === "target-unassessed-1")
  assert.ok(unassessedTarget, "Unassessed target must be present")
  assert.equal(unassessedTarget.status, "not_assessed")
  assert.equal(unassessedTarget.scorePercent, null)
  assert.equal(unassessedTarget.sufficientEvidence, false)
  assert.ok(!evaluation.weakConcepts.includes(unassessedTarget.label), "Unassessed target must NOT appear in weakConcepts")
  assert.ok(!evaluation.recoveryPlan.some((p: any) => p.title === unassessedTarget.label), "Unassessed target must NOT appear in recoveryPlan")
  assert.ok(!evaluation.masteredConcepts.includes(unassessedTarget.label), "Unassessed target must NOT appear in masteredConcepts")
  assert.ok(!evaluation.strengths.includes(unassessedTarget.label), "Unassessed target must NOT appear in strengths")

  console.log("PASS 1: Bohr 24-target report semantics verified with strict evidence authority")

  console.log("--- Test 2: P1 MCQ Collision Detection ---")
  const optA = "Su talento excepcional, que capto la atencion de otros investigadores importantes"
  const optD = "El talento de Niels Bohr atrajo la atencion de cientificos importantes de su epoca"
  const promptQ2 = "Que factor fue determinante en el reconocimiento inicial de Niels Bohr?"

  assert.equal(optionsCollide(optA, optD, promptQ2), true, "Paraphrased options A and D must collide")
  assert.equal(optionsCollide(optD, optA, promptQ2), true, "Collision must be symmetric")

  const builtCollision = buildMultipleChoiceOptionsWithDiagnostics(
    { kind: "single_text", canonicalValue: optD },
    [optA, "Estudio en la Universidad de Copenhague sin llamar la atencion", "Abandono la fisica tras graduarse"],
    "seed-test-1",
    promptQ2,
  )
  assert.equal(builtCollision.result, null, "Colliding candidate distractor must reject option generation")
  assert.ok(builtCollision.rejectionReason && builtCollision.rejectionReason.includes("CANONICAL_COLLISION"), "Must return CANONICAL_COLLISION reason")

  const optContrasting1 = "El nivel de energia orbital del electron aumenta"
  const optContrasting2 = "El nivel de energia orbital del electron disminuye"
  assert.equal(optionsCollide(optContrasting1, optContrasting2), false, "Antonym pair aumenta/disminuye must NOT collide")

  const builtValid = buildMultipleChoiceOptionsWithDiagnostics(
    { kind: "single_text", canonicalValue: optContrasting1 },
    [optContrasting2, "El nivel de energia se mantiene constante en todo momento", "El electron es repelido por el nucleo"],
    "seed-test-2",
  )
  assert.ok(builtValid.result, "Valid contrasting distractors must be accepted")
  assert.equal(builtValid.result.options.length, 4)

  console.log("PASS 2: MCQ collision detection verified on Bohr Question 2 and antonym pairs")

  console.log("--- Test 3: P1 Redundant Composite Question ---")
  const redundantTask1 = "Por que recibio Niels Bohr el Premio Nobel de Fisica en 1922?"
  const redundantTask2 = "Cual fue el motivo y la razon por la que le otorgaron el Premio Nobel de Fisica a Bohr?"
  assert.equal(promptsCollide(redundantTask1, redundantTask2), true, "Paraphrased composite subquestions must collide")

  const distinctTask1 = "Explica la formulacion del modelo atomico por la que Bohr recibio el Premio Nobel."
  const distinctTask2 = "Explica la repercusion de su modelo en la evolucion de la mecanica cuantica."
  assert.equal(promptsCollide(distinctTask1, distinctTask2), false, "Distinct subquestions must NOT collide")

  const compositeSlot: ExamComposedSlot = {
    id: "slot-comp-1",
    type: "short_answer",
    skill: "explanation",
    difficulty: "advanced",
    sourceItemIds: ["item-1", "item-2"],
    primaryTargetId: "target-1",
    targetIds: ["target-1", "target-2"],
    assessedTargetIds: ["target-1", "target-2"],
    contextTargetIds: [],
    assessmentFocus: "Premio Nobel e Impacto",
    cognitiveOperation: "explain",
    assessmentCriteria: [
      { criterionId: "crit-nobel-1", targetIds: ["target-1"], operation: "explain", canonicalCriterion: "Motivo Nobel", gradingMode: "semantic", points: 10, skill: "explanation", label: "Premio Nobel", sourceItemId: "item-1", materialId: "mat-1", pages: [1] },
      { criterionId: "crit-nobel-2", targetIds: ["target-2"], operation: "explain", canonicalCriterion: "Impacto modelo", gradingMode: "semantic", points: 10, skill: "explanation", label: "Impacto en Fisica", sourceItemId: "item-2", materialId: "mat-1", pages: [2] },
    ],
    answerAuthority: { kind: "single_text", canonicalValue: "Explicacion del modelo y repercusion", distractorPool: [] },
    frozenSources: [
      { sourceItemId: "item-1", materialId: "mat-1", pages: [1], label: "Premio Nobel", content: "Recibio el nobel en 1922", sourceSpans: [] },
      { sourceItemId: "item-2", materialId: "mat-1", pages: [2], label: "Impacto en Fisica", content: "Transformo la fisica cuantica", sourceSpans: [] },
    ],
  }

  const authoredRedundant = authorSlotQuestionWithDiagnostics(
    "exam-1",
    manifest.blueprint,
    compositeSlot,
    {
      type: "short_answer",
      parts: [
        { criterionId: "crit-nobel-1", prompt: redundantTask1 },
        { criterionId: "crit-nobel-2", prompt: redundantTask2 },
      ],
    }
  )
  assert.equal(authoredRedundant.question, null, "Redundant composite question parts must be rejected")
  assert.ok(authoredRedundant.rejectionReason && authoredRedundant.rejectionReason.includes("COMPOSITE_REDUNDANT_PARTS"), "Rejection reason must be COMPOSITE_REDUNDANT_PARTS")

  const authoredDistinct = authorSlotQuestionWithDiagnostics(
    "exam-1",
    manifest.blueprint,
    compositeSlot,
    {
      type: "short_answer",
      parts: [
        { criterionId: "crit-nobel-1", prompt: distinctTask1 },
        { criterionId: "crit-nobel-2", prompt: distinctTask2 },
      ],
    }
  )
  assert.ok(authoredDistinct.question, "Distinct composite question parts must be accepted")
  assert.equal(authoredDistinct.question.prompt.split("\n").length, 2)

  console.log("PASS 3: Composite question redundancy detection verified")

  console.log("--- Test 4: P1 Academic Math Rendering ---")
  const mathFormula1 = "En = -13.6 eV/n2"
  const mathFormula2 = "E_n = -13.6 eV / n²"
  const converted1 = autoMath(mathFormula1)
  const converted2 = autoMath(mathFormula2)
  assert.ok(converted1.includes("$E_{n} = -13.6"), "autoMath must convert En = -13.6 into LaTeX equation")
  assert.ok(converted2.includes("$E_{n} = -13.6"), "autoMath must convert E_n = -13.6 into LaTeX equation")

  const prep1 = prepareAcademicContentForDelivery(converted1)
  const mathNode = prep1.document.nodes[0] && prep1.document.nodes[0].type === "paragraph"
    ? prep1.document.nodes[0].children && prep1.document.nodes[0].children.find((c: any) => c.type === "math")
    : null
  assert.ok(mathNode, "prepareAcademicContentForDelivery must create a math node for autoMath output")
  assert.equal(mathNode.type, "math")

  const latexExisting = "$E_n = -13.6 \\text{ eV} / n^2$"
  assert.equal(autoMath(latexExisting), latexExisting, "autoMath must preserve existing LaTeX without corruption")

  console.log("PASS 4: Academic math rendering and autoMath transformation verified")

  console.log("--- Test 5: P1 Question-Type Variety without Forced Quotas ---")
  const universePayload = {
    sourceSelectionFingerprint: "fp-variety",
    materialIds: ["mat-var"],
    selectedPages: { "mat-var": [1, 2, 3, 4] },
    uniqueConceptsIndex: [
      { id: "u1", kind: "concept", name: "Postulado 1 de Bohr", content: "Los electrones orbitan en estados estacionarios sin emitir radiacion.", importance: 90, difficulty: "medium", examTypes: ["multiple_choice", "true_false", "short_answer"], materialId: "mat-var", pages: [1] },
      { id: "u2", kind: "formula", name: "Energia de niveles", content: "E_n = -13.6 eV / n²", importance: 95, difficulty: "advanced", examTypes: ["fill_blank", "multiple_choice"], materialId: "mat-var", pages: [2] },
      { id: "u3", kind: "concept", name: "Postulado 2 de Bohr", content: "La radiacion se emite cuando el electron cambia de orbita.", importance: 85, difficulty: "medium", examTypes: ["multiple_choice", "true_false"], materialId: "mat-var", pages: [3] },
      { id: "u4", kind: "concept", name: "Numero cuantico n", content: "El numero cuantico n define la orbita principal del electron.", importance: 80, difficulty: "basic", examTypes: ["fill_blank", "true_false"], materialId: "mat-var", pages: [4] },
      { id: "u5", kind: "concept", name: "Espectro del atomo de hidrogeno", content: "Explica las lineas discretas de emision luminosa observadas.", importance: 85, difficulty: "advanced", examTypes: ["short_answer", "multiple_choice"], materialId: "mat-var", pages: [1] },
    ],
  }
  const selection: SourceSelectionSnapshot = {
    fingerprint: "fp-variety",
    materialIds: ["mat-var"],
    materials: [{ materialId: "mat-var", selectedPages: [1, 2, 3, 4] }],
    selectedPages: { "mat-var": [1, 2, 3, 4] },
  }
  const universe = buildExamEnjoyerUniverse(universePayload, selection)
  const blueprint = composeEnjoyerExamBlueprint(universe, 30, "exam-var-30", "seed-var")

  const slotTypes = blueprint.slots.map(s => s.type)
  const uniqueTypes = new Set(slotTypes)
  assert.ok(uniqueTypes.size >= 3, "Blueprint must contain at least 3 distinct question types, found: " + [...uniqueTypes].join(", "))
  assert.ok(slotTypes.includes("multiple_choice"), "Must include multiple_choice")
  console.log("Types generated: " + [...uniqueTypes].join(", ") + " across " + slotTypes.length + " slots")

  console.log("PASS 5: Question-type variety verified without forced quotas")

  console.log("--- Test 6: Final Reopen Test ---")
  const callsBeforeReopen = providerCalls
  const reopenRes = await post({ mode: "evaluate", sessionId, examId, answers, confidences })
  assert.equal(reopenRes.status, 200, "Reopen must return 200")
  assert.equal(providerCalls, callsBeforeReopen, "Reopening completed exam must make ZERO provider calls")
  assert.equal(reopenRes.data.evaluation.score, evalRes.data.evaluation.score, "Score must be identical on reopen")
  assert.deepEqual(reopenRes.data.evaluation.masteredConcepts, evalRes.data.evaluation.masteredConcepts, "Mastered concepts must be identical")
  assert.deepEqual(reopenRes.data.evaluation.weakConcepts, evalRes.data.evaluation.weakConcepts, "Weak concepts must be identical")

  console.log("PASS 6: Reopen completed exam verified with zero provider calls")

  console.log("\nALL 6 CONTRACTS PASSED PERFECTLY!\n")
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
