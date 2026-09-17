import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { NextRequest } from 'next/server'
import { POST, __routeDeps, authorSlotQuestionWithDiagnostics, privateMatchingPermutation } from '../../app/api/alai-studyal-exam/route'
import { WorkerExamGenerationStore, examGenerationIdentity, examAnswersHash, type ExamGenerationManifest } from '../../lib/materialBrain/examGenerationStore'
import { MemoryExamGradingStore } from '../../lib/materialBrain/examGrading'
import { buildExamEnjoyerUniverse, composeEnjoyerExamBlueprint } from '../../lib/materialBrain/examEnjoyerContext'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'

export async function runPersistedParityContracts() {
  const directory = mkdtempSync(join(tmpdir(), 'exam-slot-cas-'))
  const db = join(directory, 'offline.sqlite')
  const python = String.raw`
import sqlite3,json,sys
db=sqlite3.connect(sys.argv[1])
db.execute('CREATE TABLE IF NOT EXISTS material_results(id TEXT PRIMARY KEY,material_id TEXT,enfoque TEXT,result_type TEXT,payload TEXT,content_hash TEXT,created_at TEXT)')
sql,params=json.loads(sys.argv[2])
cursor=db.execute(sql,params)
rows=[dict(zip([d[0] for d in cursor.description],row)) for row in cursor.fetchall()] if cursor.description else []
changes=cursor.rowcount
db.commit()
print(json.dumps({'rows':rows,'changes':changes}))
`
  function execute(sql: string, params: unknown[]) {
    return JSON.parse(execFileSync('python3', ['-c', python, db, JSON.stringify([sql, params])], { encoding: 'utf8' }))
  }
  const workerPath = existsSync('cloudflare/studyal-api/src/index.ts')
    ? 'cloudflare/studyal-api/src/index.ts'
    : join(__dirname, '../../cloudflare/studyal-api/src/index.ts')
  const worker = readFileSync(workerPath, 'utf8')
  const block = worker.slice(worker.indexOf('if (url.pathname === "/material-results/exam-generation-cas"'),
    worker.indexOf('// Exam grading: insert-if-absent'))
  const sql = [...block.matchAll(/prepare\(`([\s\S]*?)`\)/g)].map(match => match[1])
  assert.equal(sql.length, 3, 'Execute actual Worker SQL, not a reimplemented CAS')
  const oldFetch = globalThis.fetch, oldApi = process.env.STUDYAL_API_URL
  const deps = { ...__routeDeps }
  try {
    process.env.STUDYAL_API_URL = 'https://offline.invalid'
    let rejectedWrites = 0
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://offline.invalid/material-results/exam-generation-cas', 'No network/provider access')
      const body = JSON.parse(String(init?.body))
      const result = body.expectedRevision === null
        ? execute(sql[0], [body.id, body.id, body.resultType, JSON.stringify(body.payload), body.revision])
        : execute(sql[1], [JSON.stringify(body.payload), body.revision, body.id, body.resultType, body.expectedRevision])
      if (result.changes === 0) rejectedWrites++
      const frozen = result.changes === 0 && execute(sql[2], [body.id]).rows.length > 0
      return Response.json({ ok: true, applied: result.changes === 1 || frozen })
    }
    const getMaterialResult = async (id: string) => {
      const row = execute('SELECT * FROM material_results WHERE material_id=?', [id]).rows[0]
      return row ? { ...row, payload: JSON.parse(row.payload) } : null
    }
    const saveMaterialResult = async (data: Parameters<NonNullable<ConstructorParameters<typeof WorkerExamGenerationStore>[0]>['saveMaterialResult']>[0]) => {
      execute('INSERT INTO material_results(id,material_id,enfoque,result_type,payload,content_hash) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
        [data.id, data.material_id, data.enfoque, data.result_type, JSON.stringify(data.payload), data.content_hash])
      return { ok: true }
    }
    const store = new WorkerExamGenerationStore({ getMaterialResult, saveMaterialResult })
    const secondWorker = new WorkerExamGenerationStore({ getMaterialResult, saveMaterialResult })
    const selection = buildSourceSelectionSnapshot(['material'], { material: [1] })
    const leftItems = ['L1', 'L2', 'L3'].map((id) => ({
      id, name: `Entity ${id}`, content: `Content of ${id}`, kind: 'entity',
      bloomLevel: 'remember', importance: 80, materialId: 'material', pages: [1], topicId: 'pairs',
      sourceSpans: [{ page: 1, quote: id }],
    }))
    const rightItems = ['R1', 'R2', 'R3'].map((id) => ({
      id, name: `Concept ${id}`, content: `Definition of concept ${id}`, kind: 'concept',
      bloomLevel: 'remember', importance: 80, materialId: 'material', pages: [1], topicId: 'pairs',
      sourceSpans: [{ page: 1, quote: id }],
    }))
    const fillItem = {
      id: 'D', name: 'Delta', content: 'El término Delta representa la variación en el sistema.', kind: 'concept',
      bloomLevel: 'remember', importance: 80, materialId: 'material', pages: [1], topicId: 'fill',
      sourceSpans: [{ page: 1, quote: 'Delta' }],
    }
    const relations = [
      { id: 'rel_1', fromSourceItemId: 'L1', toSourceItemId: 'R1', type: 'definition' },
      { id: 'rel_2', fromSourceItemId: 'L2', toSourceItemId: 'R2', type: 'definition' },
      { id: 'rel_3', fromSourceItemId: 'L3', toSourceItemId: 'R3', type: 'definition' },
    ]
    const universe = buildExamEnjoyerUniverse({
      sourceSelectionFingerprint: selection.fingerprint,
      materialIds: ['material'],
      globalOrderedAnalysis: [...leftItems, ...rightItems, fillItem],
      relations,
    }, selection)
    const examId = 'persisted-parity'
    const blueprint = composeEnjoyerExamBlueprint(universe, 30, examId, examId)
    const matching = blueprint.slots.find(slot => slot.type === 'matching')!
    assert.ok(matching)
    const fill = blueprint.slots.find(slot => slot !== matching)!
    fill.type = 'fill_blank'
    // This fixture exercises restoration of the historical pool-based authority.
    delete fill.authoringContractVersion
    fill.answerAuthority = { kind: 'single_text', canonicalValue: 'Delta', distractorPool: ['Uno','Dos','Tres'] }
    fill.assessmentCriteria!.forEach(c => { c.canonicalCriterion = 'Delta'; c.gradingMode = 'deterministic'; c.points = 10 })
    let randomDraws = 0
    __routeDeps.matchingRandomInt = () => { randomDraws++; return 0 }
    const authored = blueprint.slots.map(slot => {
      const result = authorSlotQuestionWithDiagnostics(examId, blueprint, slot,
        { type: slot.type, prompt: slot === matching ? 'Relaciona cada nombre con su significado.' : 'Indica el término: ___' })
      assert.ok(result.question, result.rejectionReason)
      return result.question!
    })
    const matchQuestion = authored.find(q => q.type === 'matching')!
    const fillQuestion = authored.find(q => q.type === 'fill_blank')!
    assert.deepEqual(privateMatchingPermutation(2, max => max - 1), [0,1])
    assert.deepEqual(privateMatchingPermutation(2, () => 0), [1,0])

    const identity = examGenerationIdentity('session', selection.fingerprint, examId)
    const manifest: ExamGenerationManifest = { schemaVersion: 2, identity, examId, fingerprint: selection.fingerprint,
      sessionId: 'session', blueprint, totalSlots: authored.length, status: 'generating',
      slots: Object.fromEntries(authored.map(q => [q.id, { status: 'pending', attempts: 0 }])),
      providerAttemptsBudget: 10, providerAttemptsUsed: 0, createdAt: '', updatedAt: '' }
    await store.saveManifest(identity, manifest)
    const initial = { examId, fingerprint: selection.fingerprint, meta: { status: 'generating' as const, generatedAt: '' }, questions: [] }
    await store.saveArtifact(identity, initial)
    // Two independently instantiated production stores race on the same revision.
    const competitor = structuredClone(matchQuestion)
    competitor.matchingRightTexts = [...matchQuestion.matchingRightTexts!].reverse()
    competitor.matchingCorrectMap = Object.fromEntries(Object.entries(matchQuestion.matchingCorrectMap!).map(([k,v]) =>
      [k, matchQuestion.matchingRightTexts!.length - 1 - Number(v)]))
    await Promise.all([
      store.saveArtifact(identity, { ...initial, questions: [matchQuestion] }),
      secondWorker.saveArtifact(identity, { ...initial, questions: [competitor] }),
    ])
    assert.ok(rejectedWrites > 0, 'Actual SQL must reject at least one competing stale revision')
    const winner = (await store.getArtifact(identity))!.questions[0]
    assert.ok(JSON.stringify(winner) === JSON.stringify(matchQuestion) || JSON.stringify(winner) === JSON.stringify(competitor))
    await secondWorker.saveArtifact(identity, { ...initial, questions: [competitor, fillQuestion] })
    const accepted = (await store.getArtifact(identity))!
    assert.deepEqual(accepted.questions.find(q => q.id === winner.id), winner, 'Stale author cannot replace accepted mapping')
    // Ready metadata freezes only after all accepted siblings are present.
    await store.saveManifest(identity, manifest)
    await store.saveArtifact(identity, { ...accepted, meta: { ...accepted.meta, status: 'ready' } })
    const frozen = (await secondWorker.getArtifact(identity))!
    assert.deepEqual(frozen.questions, accepted.questions, 'Restart/reopen preserves full questions and bank order')

    Object.assign(__routeDeps, { examStore: secondWorker, gradingStore: new MemoryExamGradingStore(),
      getServerSession: async () => ({ user: { id: 'user' } }),
      getAuthoritativeFreeSession: async () => ({ id: 'session', userId: 'user', sourceSelection: selection }),
      generateValidatedLegacyJson: async () => { throw new Error('PROVIDER_FORBIDDEN') } })
    async function post(mode: string, answers?: unknown[]) {
      const response = await POST(new NextRequest('http://localhost/api/alai-studyal-exam', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, sessionId: 'session', examId, answers }),
      }))
      const result = await response.json()
      assert.equal(response.status, 200, JSON.stringify(result))
      return result
    }
    const publicExam = (await post('advance')).exam
    const publicMatch = publicExam.questions.find((q: { id: string }) => q.id === winner.id)
    assert.deepEqual(publicMatch.matchingRightTexts, (winner as typeof matchQuestion).matchingRightTexts)
    assert.equal(publicMatch.pairs, undefined)
    assert.equal(publicMatch.matchingCorrectMap, undefined)
    assert.equal(publicExam.questions.find((q: { id: string }) => q.id === fill.id).expectedAnswer, undefined)
    const correctMap = (winner as typeof matchQuestion).matchingCorrectMap!
    assert.ok(Object.entries(correctMap).some(([left, right]) => Number(left) !== Number(right)), 'Fixture must use nonidentity authority')
    const partialMap = { ...correctMap, 0: (correctMap[0] + 1) % 3 }
    const drawsBeforeRestore = randomDraws
    const answers = frozen.questions.map(q => q.id === winner.id ? partialMap : 'wrong')
    const result = (await post('evaluate', answers)).evaluation
    assert.equal(result.perQuestion.find((q: { index: number }) => q.index === frozen.questions.findIndex(q => q.id === fill.id)).partialScore, 0)
    const matchCriteria = result.criterionResults.filter((c: { questionId: string }) => c.questionId === winner.id)
    assert.ok(matchCriteria.length >= 3)
    const firstCriterionId = matching.assessmentCriteria![0].criterionId
    assert.equal(matchCriteria.find((c: { criterionId: string }) => c.criterionId === firstCriterionId).scorePercent, 0)
    assert.ok(matchCriteria.filter((c: { criterionId: string }) => c.criterionId !== firstCriterionId)
      .every((c: { scorePercent: number }) => c.scorePercent === 100))
    const privateFields = ['canonicalCriterion','rubric','rubricHints','expectedAnswer','matchingCorrectMap','pairs','componentIndex']
    function assertPrivate(value: unknown) {
      if (!value || typeof value !== 'object') return
      for (const [key, nested] of Object.entries(value)) { assert.ok(!privateFields.includes(key), key); assertPrivate(nested) }
    }
    assertPrivate(result)
    // Poison the old persisted result with the historical private fields and use actual API restore.
    const record = (await store.getResult(identity, examAnswersHash(answers)))!
    const legacy = structuredClone(result)
    legacy.criterionResults.forEach((c: Record<string, unknown>) => { c.canonicalCriterion = 'PRIVATE'; c.componentIndex = 0 })
    await store.saveResult(identity, { ...record, result: legacy })
    const reopened = (await post('evaluate', answers)).evaluation
    assertPrivate(reopened)
    assert.deepEqual(reopened, result)
    assert.deepEqual((await post('advance')).exam.questions, publicExam.questions)
    assert.equal(randomDraws, drawsBeforeRestore, 'Accepted/reopened questions must not request new entropy')
    console.log('Production Worker CAS + SQLite, competing acceptance, API grading, private fresh/restored results and reopen PASS')
  } finally {
    Object.assign(__routeDeps, deps)
    globalThis.fetch = oldFetch
    if (oldApi === undefined) delete process.env.STUDYAL_API_URL; else process.env.STUDYAL_API_URL = oldApi
    rmSync(directory, { recursive: true, force: true })
  }
}
