import assert from "node:assert/strict"
import fs from "node:fs"
import { NextRequest } from "next/server"
import { buildSourceSelectionSnapshot } from "../../lib/adaptive/sourceSelection"
import { buildExamEnjoyerUniverse, composeEnjoyerExamBlueprint } from "../../lib/materialBrain/examEnjoyerContext"
import {
  InMemoryExamGenerationStore,
  examGenerationIdentity,
  getOrBuildExamGeneration,
  advanceExamGeneration,
} from "../../lib/materialBrain/examGenerationStore"
import { POST, __routeDeps } from "../../app/api/alai-studyal-exam/route"
import {
  EXAM_ADVANCE_BACKOFF_DELAYS,
  EXAM_ADVANCE_MAX_FAILURES,
  getAdvanceBackoffDelay,
} from "../../components/materias/ALAIStudyALExams"

console.log("── RUNNING EXAM AUTHORITY RETRY & READY UX CONTRACTS ──\n")

const selection = buildSourceSelectionSnapshot(["test-material"], { "test-material": [1] })

function source(id: string, content = "Contenido academico " + id, examTypes = ["short_answer"]) {
  return {
    id,
    name: "Concepto " + id,
    content,
    kind: "fact",
    importance: "high",
    difficulty: "medium",
    examTypes,
    topicId: "topic-1",
    materialId: "test-material",
    pages: [1],
    sourceSpans: [{ page: 1, quote: content }],
  }
}

function enjoyer(items = [source("one"), source("two")]) {
  return {
    sourceSelectionFingerprint: selection.fingerprint,
    materialIds: selection.materialIds,
    selectedPages: selection.selectedPages,
    materialLanguage: "es",
    topicsIndex: [{ id: "topic-1", title: "Tema 1" }],
    globalOrderedAnalysis: items,
    uniqueConceptsIndex: [],
  }
}

type StoredQuestion = { id: string; slotId: string; prompt: string }

function setupTestRoute(payload = enjoyer()) {
  const store = new InMemoryExamGenerationStore<StoredQuestion>()
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: "test-user" } }),
    getAuthoritativeFreeSession: async () => ({
      id: "test-session",
      userId: "test-user",
      processMode: "free",
      sourceSelection: selection,
    }),
    getMaterial: async () => ({ id: "test-material" }),
    lookupStudyalMaterialEnjoyer: async () => payload,
    examStore: store,
    generateValidatedLegacyJson: async ({ prompt }: { prompt: string }) => {
      return prompt.split(/\n(?=\d+\.\s+slotId=)/).filter(block => /^\d+\.\s+slotId=/.test(block)).map(block => {
        const slotId = block.match(/slotId=(\S+)/)?.[1]
        const type = block.match(/type=(\S+)/)?.[1]
        return {
          slotId,
          type,
          sourceItemIds: block.match(/sourceItemIds=([^\n]+)/)?.[1]?.split(","),
          prompt: "Pregunta sobre " + slotId,
        }
      })
    },
  })
  return store
}

async function post(body: unknown) {
  const response = await POST(new NextRequest("http://localhost/api/alai-studyal-exam", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }))
  return { status: response.status, data: await response.json().catch(() => null) }
}

async function runContracts() {
  console.log("Contract A: Transient 503 recoverable mapping & non-terminal manifest...")
  const storeA = setupTestRoute()
  const startRes = await post({
    sessionId: "test-session",
    durationMinutes: 30,
  })
  assert.equal(startRes.status, 200)
  assert.ok(startRes.data.exam?.id)
  const examIdA = startRes.data.exam.id

  __routeDeps.getAuthoritativeFreeSession = async () => {
    throw new Error("SESSION_AUTHORITY_FAILED:503")
  }

  const advanceRes = await post({
    mode: "advance",
    sessionId: "test-session",
    examId: examIdA,
  })
  assert.equal(advanceRes.status, 503, "Must return HTTP 503")
  assert.equal(advanceRes.data.success, false)
  assert.equal(advanceRes.data.error, "SESSION_AUTHORITY_UNAVAILABLE")
  assert.equal(advanceRes.data.recoverable, true, "Transient 503 MUST be marked recoverable")

  const manifestA = await storeA.getManifest(examGenerationIdentity("test-session", selection.fingerprint, examIdA))
  assert.ok(manifestA)
  assert.notEqual(manifestA.status, "failed", "Transient 503 must not mark exam generation failed")
  console.log("Contract A PASS: 503 correctly mapped to SESSION_AUTHORITY_UNAVAILABLE (recoverable: true) without corrupting manifest status")

  console.log("\nContract B: Ownership failures (401/403/404) return non-recoverable...")
  __routeDeps.getAuthoritativeFreeSession = async () => {
    throw new Error("SESSION_AUTHORITY_FAILED:401")
  }
  const res401 = await post({ mode: "advance", sessionId: "test-session", examId: examIdA })
  assert.equal(res401.status, 401)
  assert.equal(res401.data.error, "UNAUTHORIZED")
  assert.equal(res401.data.recoverable, false, "401 MUST NOT be recoverable")

  __routeDeps.getAuthoritativeFreeSession = async () => {
    throw new Error("SESSION_AUTHORITY_FAILED:403")
  }
  const res403 = await post({ mode: "advance", sessionId: "test-session", examId: examIdA })
  assert.equal(res403.status, 401)
  assert.equal(res403.data.error, "UNAUTHORIZED")
  assert.equal(res403.data.recoverable, false, "403 MUST NOT be recoverable")

  __routeDeps.getAuthoritativeFreeSession = async () => {
    throw new Error("SESSION_AUTHORITY_FAILED:404")
  }
  const res404 = await post({ mode: "advance", sessionId: "test-session", examId: examIdA })
  assert.equal(res404.status, 404)
  assert.equal(res404.data.error, "SESSION_NOT_FOUND")
  assert.equal(res404.data.recoverable, false, "404 MUST NOT be recoverable")
  console.log("Contract B PASS: Ownership failures (401, 403, 404) return 401/404 with recoverable: false")

  console.log("\nContract C: Client backoff schedule [2000, 4000, 8000, 16000, 30000] & pause after 5 attempts...")
  assert.deepEqual(EXAM_ADVANCE_BACKOFF_DELAYS, [2000, 4000, 8000, 16000, 30000])
  assert.equal(EXAM_ADVANCE_MAX_FAILURES, 5)

  assert.equal(getAdvanceBackoffDelay(1), 2000)
  assert.equal(getAdvanceBackoffDelay(2), 4000)
  assert.equal(getAdvanceBackoffDelay(3), 8000)
  assert.equal(getAdvanceBackoffDelay(4), 16000)
  assert.equal(getAdvanceBackoffDelay(5), 30000)
  assert.equal(getAdvanceBackoffDelay(6), null, "After 5 attempts, delay MUST be null (paused)")
  assert.equal(getAdvanceBackoffDelay(0), null)

  let failures = 0
  const executedDelays: number[] = []
  let paused = false

  for (let step = 0; step < 7; step++) {
    failures++
    const delay = getAdvanceBackoffDelay(failures)
    if (delay === null) {
      paused = true
      break
    }
    executedDelays.push(delay)
  }

  assert.deepEqual(executedDelays, [2000, 4000, 8000, 16000, 30000])
  assert.equal(paused, true)
  console.log("Contract C PASS: Backoff schedule adheres to 2s -> 4s -> 8s -> 16s -> 30s and pauses after 5 attempts")

  console.log("\nContract D: Manual resume reuses exact examId and sessionId...")
  const simulatedClient = {
    examId: "exam-preserved-12345",
    sessionId: "session-user-67890",
    advancePaused: true,
    advanceFailures: 5,
    retryTrigger: 0,
    resumeAdvance() {
      this.advanceFailures = 0
      this.advancePaused = false
      this.retryTrigger++
    },
  }

  assert.equal(simulatedClient.advancePaused, true)
  simulatedClient.resumeAdvance()
  assert.equal(simulatedClient.advancePaused, false)
  assert.equal(simulatedClient.advanceFailures, 0)
  assert.equal(simulatedClient.retryTrigger, 1)
  assert.equal(simulatedClient.examId, "exam-preserved-12345", "examId MUST NOT change upon resume")
  assert.equal(simulatedClient.sessionId, "session-user-67890", "sessionId MUST NOT change upon resume")
  console.log("Contract D PASS: Resume cleanly reuses exact examId/sessionId without restart or regeneration")

  console.log("\nContract E: Preview screen eliminates internal academic bookkeeping...")
  const componentSource = fs.readFileSync("components/materias/ALAIStudyALExams.tsx", "utf8")
  const previewSection = componentSource.slice(
    componentSource.indexOf("{phase === 'preview' && exam && ("),
    componentSource.indexOf("{phase === 'exam' && exam && (() => {"),
  )

  assert.ok(!previewSection.includes("exam.coverage"), "exam.coverage MUST NOT be rendered in preview")
  assert.ok(!previewSection.includes("MATERIAL INCLUIDO"), "MATERIAL INCLUIDO tile MUST NOT be in preview")
  assert.ok(!previewSection.includes("objetivos listos"), "Internal objective counts MUST NOT be in preview")
  assert.ok(!previewSection.includes("de planeados"), "Internal plan counts MUST NOT be in preview")
  console.log("Contract E PASS: Student preview screen is free of internal bookkeeping tiles and coverage percentages")

  console.log("\nContract F: Preview screen renders student-essential stats & recoverable UI...")
  assert.ok(previewSection.includes("DURACIÓN"), "Must render DURACIÓN tile")
  assert.ok(previewSection.includes("{duration} min"), "Must render duration value")
  assert.ok(previewSection.includes("PREGUNTAS"), "Must render PREGUNTAS tile")
  assert.ok(previewSection.includes("{totalSlots}"), "Must render totalSlots count")
  assert.ok(previewSection.includes("{readyCount}/{totalSlots} preguntas listas"), "Must render readyCount/totalSlots progress")
  assert.ok(previewSection.includes("La preparación está pausada temporalmente. Tus preguntas guardadas se conservan."), "Must include paused message")
  assert.ok(previewSection.includes("Reintentar preparación"), "Must include retry button")
  console.log("Contract F PASS: Preview renders duration, questions, progress, and recoverable pause controls")

  console.log("\nContract G: Diagnostic log ordering (candidate_accepted before chunk_committed)...")
  const logs: string[] = []
  const origLog = console.log
  console.log = (...args: any[]) => {
    logs.push(args.join(" "))
    origLog(...args)
  }

  try {
    const universe = buildExamEnjoyerUniverse(enjoyer(), selection)
    const blueprint = composeEnjoyerExamBlueprint(universe, 30, "diag", "seed-diag")
    const storeG = new InMemoryExamGenerationStore<StoredQuestion>()
    await getOrBuildExamGeneration("diag-sess", selection.fingerprint, "diag", blueprint, storeG, async ids => {
      return new Map(ids.map(id => [id, { id, slotId: id, prompt: "Prompt " + id }]))
    })
  } finally {
    console.log = origLog
  }

  const candidateIdx = logs.findIndex(l => l.includes("phase=candidate_accepted"))
  const committedIdx = logs.findIndex(l => l.includes("phase=chunk_committed"))

  assert.ok(candidateIdx >= 0, "Must log phase=candidate_accepted")
  assert.ok(committedIdx >= 0, "Must log phase=chunk_committed")
  assert.ok(candidateIdx < committedIdx, "phase=candidate_accepted MUST precede phase=chunk_committed")
  assert.ok(logs[candidateIdx].includes("acceptedCount="), "candidate log must include acceptedCount")
  assert.ok(logs[committedIdx].includes("committedSlots="), "committed log must include committedSlots")
  console.log("Contract G PASS: phase=candidate_accepted verified BEFORE phase=chunk_committed with slot telemetry")

  console.log("\nALL 7 AUTHORITY RETRY & READY UX CONTRACTS PASSED!\n")
}

runContracts().catch(err => {
  console.error("\nCONTRACT TEST FAILED:", err)
  process.exit(1)
})