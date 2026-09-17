import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { WorkerExamGenerationStore } from "../../lib/materialBrain/examGenerationStore"
import type { ExamGenerationManifest } from "../../lib/materialBrain/examGenerationStore"

// ─── 1. EXTRACT PRODUCTION WORKER SQL FOR EXAM GENERATION CAS ───────────────
const workerPath = resolve(__dirname, "../../cloudflare/studyal-api/src/index.ts")
const worker = readFileSync(workerPath, "utf8")
const start = worker.indexOf('if (url.pathname === "/material-results/exam-generation-cas"')
const block = worker.slice(start, worker.indexOf('if (url.pathname === "/material-results/exam-grading-cas"', start))
const statements = [...block.matchAll(/prepare\(`([\s\S]*?)`\)/g)].map(match => match[1])
assert.equal(statements.length, 3, "Must extract 3 SQL statements from exam-generation-cas (insert, update, select-frozen)")

// ─── 2. TEST SQL ATOMICITY IN ISOLATED SQLITE ENGINE ─────────────────────────
const python = String.raw`
import sqlite3, json, sys, tempfile, os, concurrent.futures

insert_sql, update_sql, select_frozen_sql = json.loads(sys.argv[1])

with tempfile.TemporaryDirectory() as directory:
    db_path = os.path.join(directory, "test_gen_cas.db")
    db = sqlite3.connect(db_path)
    db.execute("CREATE TABLE material_results(id TEXT PRIMARY KEY, material_id TEXT, enfoque TEXT, result_type TEXT, payload TEXT, content_hash TEXT, created_at TEXT)")

    manifest_id = "exam_manifest:test-hash-1"
    init_payload = json.dumps({"status": "generating", "slots": {}})

    # 1. Initial insert with expectedRevision = null
    assert db.execute(insert_sql, (manifest_id, manifest_id, "exam_manifest", init_payload, "rev-0")).rowcount == 1
    # 2. Competing initial insert with expectedRevision = null loses (DO NOTHING)
    assert db.execute(insert_sql, (manifest_id, manifest_id, "exam_manifest", json.dumps({"status": "other"}), "bad-rev")).rowcount == 0
    db.commit()

    # 3. Competing updates from rev-0
    def attempt_advance(revision):
        conn = sqlite3.connect(db_path, timeout=5)
        res = conn.execute(update_sql, (json.dumps({"status": "generating", "worker": revision}), revision, manifest_id, "exam_manifest", "rev-0")).rowcount
        conn.commit()
        conn.close()
        return res

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt_advance, ["rev-1A", "rev-1B"]))
    assert sorted(results) == [0, 1], f"Exactly one worker must win: {results}"

    winning_rev = db.execute("SELECT content_hash FROM material_results WHERE id = ?", (manifest_id,)).fetchone()[0]

    # 4. Stale update with old rev-0 loses
    assert db.execute(update_sql, (json.dumps({"stale": True}), "rev-stale", manifest_id, "exam_manifest", "rev-0")).rowcount == 0

    # 5. Valid advance from winning_rev to ready succeeds
    ready_payload = json.dumps({"status": "ready", "slots": {"s1": "ready"}})
    assert db.execute(update_sql, (ready_payload, "rev-ready", manifest_id, "exam_manifest", winning_rev)).rowcount == 1
    db.commit()

    # 6. Late write cannot overwrite READY row
    late_payload = json.dumps({"status": "generating", "slots": {}})
    assert db.execute(update_sql, (late_payload, "rev-late", manifest_id, "exam_manifest", "rev-ready")).rowcount == 0

    # 7. Frozen check recognises ready row
    assert db.execute(select_frozen_sql, (manifest_id,)).fetchone() is not None

print("Worker SQL atomicity: insert race, concurrent claim, stale rejection, frozen ready preservation PASS")
`

const sqlResult = execFileSync("python3", ["-c", python, JSON.stringify(statements)], { encoding: "utf8" }).trim()
console.log(sqlResult)

// ─── 3. TEST CLIENT-SIDE DIAGNOSTIC LOGGING AND STATUS REPORTING ─────────────
async function testClientCasDiagnostics() {
  const originalFetch = globalThis.fetch
  const originalApi = process.env.STUDYAL_API_URL
  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "))
    originalWarn(...args)
  }

  const dummyManifest: ExamGenerationManifest = {
    schemaVersion: 2,
    identity: "test-identity-64chars-long-00000000000000000000000000000000000000000000",
    examId: "exam-1",
    fingerprint: "fp-1",
    sessionId: "sess-1",
    blueprint: { examId: "exam-1", slots: [] } as any,
    totalSlots: 0,
    status: "generating",
    slots: {},
    providerAttemptsBudget: 10,
    providerAttemptsUsed: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  try {
    process.env.STUDYAL_API_URL = "https://offline.invalid"

    // Case A: Endpoint 404 (reproducing live undeployed worker failure)
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404 })
    const store = new WorkerExamGenerationStore({
      getMaterialResult: async () => null,
      saveMaterialResult: async () => ({ ok: true }),
    })

    await assert.rejects(
      () => store.saveManifest("test-identity-64chars-long-00000000000000000000000000000000000000000000", dummyManifest),
      (err: any) => {
        assert.equal(err.message, "EXAM_GENERATION_CAS_FAILED:404")
        return true
      },
      "404 from Worker must throw EXAM_GENERATION_CAS_FAILED:404",
    )
    assert.ok(warnings.some(w => w.includes("phase=cas_request_failed") && w.includes("status=404")), "Diagnostic warning must log status=404")

    // Case B: Endpoint 500 error
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: "d1_internal" }), { status: 500 })
    await assert.rejects(
      () => store.saveManifest("test-identity-64chars-long-00000000000000000000000000000000000000000000", dummyManifest),
      (err: any) => {
        assert.equal(err.message, "EXAM_GENERATION_CAS_FAILED:500")
        return true
      },
      "500 from Worker must throw EXAM_GENERATION_CAS_FAILED:500",
    )

    // Case C: Malformed JSON response
    globalThis.fetch = async () => Response.json({ ok: false })
    await assert.rejects(
      () => store.saveManifest("test-identity-64chars-long-00000000000000000000000000000000000000000000", dummyManifest),
      /EXAM_GENERATION_CAS_INVALID/,
      "Malformed response must throw EXAM_GENERATION_CAS_INVALID",
    )
    assert.ok(warnings.some(w => w.includes("phase=cas_invalid_response")), "Diagnostic warning must log phase=cas_invalid_response")

    // Case D: Contention exhausted across 16 retries
    globalThis.fetch = async () => Response.json({ ok: true, applied: false })
    await assert.rejects(
      () => store.saveManifest("test-identity-64chars-long-00000000000000000000000000000000000000000000", dummyManifest),
      /EXAM_GENERATION_CAS_CONTENDED/,
      "16 failed retries must throw EXAM_GENERATION_CAS_CONTENDED",
    )
    assert.ok(warnings.some(w => w.includes("phase=cas_contention_exhausted") && w.includes("attempts=16")), "Diagnostic warning must log contention exhausted")

    // Case E: Successful CAS write
    globalThis.fetch = async () => Response.json({ ok: true, applied: true })
    await store.saveManifest("test-identity-64chars-long-00000000000000000000000000000000000000000000", dummyManifest)

    console.log("WorkerExamGenerationStore diagnostics and error boundaries PASS")
  } finally {
    globalThis.fetch = originalFetch
    console.warn = originalWarn
    if (originalApi === undefined) delete process.env.STUDYAL_API_URL
    else process.env.STUDYAL_API_URL = originalApi
  }
}

async function main() {
  await testClientCasDiagnostics()
  console.log("ALL EXAM_GENERATION_CAS_CONTRACTS PASSED!")
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
