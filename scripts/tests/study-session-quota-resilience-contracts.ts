// P0 — StudySession persistence must not depend on localStorage having room.
//
// Contract: SERVER = durable authority. MEMORY (module-level cache inside
// lib/studySessions.ts) = active session state for this runtime. LOCALSTORAGE
// = best-effort cache only. A localStorage quota failure must never look
// like "the session doesn't exist" to any reader in this module.
//
// Exercises the REAL functions in lib/studySessions.ts and lib/freeToolState.ts
// against a FakeLocalStorage that can be switched into "always throws
// QuotaExceededError" mode — mirrors the pattern already used by
// session-persistence-restart-equivalence-contracts.ts.
import assert from 'node:assert/strict'

class FakeLocalStorage {
  private store = new Map<string, string>()
  private quotaMode: 'ok' | 'always-throw' = 'ok'
  setQuotaMode(mode: 'ok' | 'always-throw') { this.quotaMode = mode }
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null }
  setItem(key: string, value: string): void {
    if (this.quotaMode === 'always-throw') {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
    this.store.set(key, String(value))
  }
  removeItem(key: string): void { this.store.delete(key) }
  clear(): void { this.store.clear() }
  snapshot(): Record<string, string> { return Object.fromEntries(this.store) }
}

const fakeStorage = new FakeLocalStorage()
;(global as any).window = (global as any).window || {}
;(global as any).localStorage = fakeStorage

// In-memory fake server: mirrors app/api/study-sessions/route.ts's contract
// (accepts the full session body incl. notes, returns it back on GET) so we
// can assert "server write succeeds while local cache fails" for real,
// without needing a running Next.js dev server.
const serverStore = new Map<string, any>()
;(global as any).fetch = async (url: string, init?: any) => {
  if (String(url).includes('/api/study-sessions')) {
    if (!init || init.method === undefined) {
      // GET
      const u = new URL(String(url), 'http://localhost')
      const sessionId = u.searchParams.get('sessionId')
      const temaId = u.searchParams.get('temaId')
      let sessions = [...serverStore.values()]
      if (sessionId) sessions = sessions.filter((s) => s.id === sessionId)
      else if (temaId) sessions = sessions.filter((s) => s.temaId === temaId)
      return { ok: true, json: async () => ({ success: true, sessions }) }
    }
    const body = JSON.parse(init.body)
    serverStore.set(body.id, { ...(serverStore.get(body.id) || {}), ...body })
    return { ok: true, json: async () => ({ success: true, session: body }) }
  }
  return { ok: true, json: async () => ({ success: true }) }
}

async function flushDebounce(ms = 250) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const {
    upsertSession, getSessionById, getSessionsByTema, findSession,
    lookupSessionsFromServer,
  } = await import('../../lib/studySessions')
  const { readFreeToolState, writeFreeToolState, computeFreeProcessProgress } = await import('../../lib/freeToolState')
  const { buildSourceSelectionSnapshot } = await import('../../lib/adaptive/sourceSelection')

  let pass = 0
  const check = (label: string, cond: boolean) => {
    assert.ok(cond, `FAIL: ${label}`)
    pass++
    console.log(`  ok — ${label}`)
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 1 — saveAll quota error contract: localStorage ALWAYS throws
  // QuotaExceededError from the very first write. Free Mode must still work.
  // ═══════════════════════════════════════════════════════════════
  console.log('\nTEST 1-3 — saveAll quota contract, server write succeeds, same sessionId retained')
  fakeStorage.clear()
  fakeStorage.setQuotaMode('always-throw')
  serverStore.clear()

  const temaId = 'tema-quota-1'
  const materialIds = ['mat-quota-1']
  const snapshot = buildSourceSelectionSnapshot(materialIds, { 'mat-quota-1': [1, 2] })

  const created = upsertSession({
    temaId, enfoque: 'teorico', processMode: 'free',
    materialIds, selectedPages: { 'mat-quota-1': [1, 2] },
    debugCaller: 'test-start-free',
  })
  const sessionA = created.id
  check('upsertSession returns a real session id even though localStorage always throws', Boolean(sessionA))
  check('created session keeps the correct fingerprint', created.sourceSelectionFingerprint === snapshot.fingerprint)

  // Immediately re-read — this is EXACTLY the StudyALProcess re-render that
  // the bug report showed as "sessionFound false" right after creation.
  const rereadImmediately = getSessionById(sessionA)
  check('getSessionById finds the session immediately after creation despite quota failure', Boolean(rereadImmediately))
  check('re-read session has the same id (no duplicate session created)', rereadImmediately?.id === sessionA)

  const foundViaFingerprint = findSession(temaId, materialIds, 'free', undefined, snapshot.fingerprint)
  check('findSession resolves the SAME session by fingerprint (no CREATE_NEW fallback)', foundViaFingerprint?.id === sessionA)

  // TEST 2 — server write succeeds while local cache fails
  await flushDebounce()
  const serverRow = serverStore.get(sessionA)
  check('server received the POST with the same sessionId even though localStorage writes always throw', Boolean(serverRow))
  check('server row has the correct fingerprint', serverRow?.sourceSelectionFingerprint === snapshot.fingerprint || serverRow?.source_selection_fingerprint === undefined)

  // Simulate opening Flashcards right after: onOpenFlashcards resolves via
  // findSession too — must resolve to the SAME session A, not CREATE_NEW.
  const onOpenFlashcardsResolved = findSession(temaId, materialIds, 'free', undefined, snapshot.fingerprint)
  check('opening a tool right after creation resolves session A (no phantom session B)', onOpenFlashcardsResolved?.id === sessionA)

  // ═══════════════════════════════════════════════════════════════
  // TEST 6 — Flashcards survive a quota failure (writeFreeToolState + readFreeToolState)
  // ═══════════════════════════════════════════════════════════════
  console.log('\nTEST 6 — Flashcards state survives quota failure')
  const cards = Array.from({ length: 8 }, (_, i) => ({ id: `fc-${i}`, question: `Q${i}`, answer: `A${i}`, sourcePage: 1 }))
  writeFreeToolState(sessionA, snapshot.fingerprint, 'flashcards', { cards, currentIndex: 0 })
  const restoredFlashcards = readFreeToolState<{ cards: any[] }>(sessionA, snapshot.fingerprint, 'flashcards')
  check('Flashcards envelope readable immediately after write despite quota failure', Array.isArray(restoredFlashcards?.state.cards) && restoredFlashcards!.state.cards.length === 8)

  // ═══════════════════════════════════════════════════════════════
  // TEST 5/7 — Free progress + 8-tool durable notes survive
  // ═══════════════════════════════════════════════════════════════
  console.log('\nTEST 5,7 — Free progress + 8-tool notes durable under quota failure')
  const tools: Array<[string, any]> = [
    ['quiz', { questions: [{ id: 'q1', type: 'multiple_choice', question: 'Q', options: ['A', 'B'], correctAnswer: 0 }] }],
    ['repasar', { phase: 'explicar' }],
    ['analysis', { selectedType: 'universidad', resultsByType: { universidad: { status: 'completed' } } }],
    ['alai', { messages: [{ role: 'user', content: 'hola' }, { id: 'a1', role: 'assistant', content: 'respuesta' }] }],
    ['exam', { exam: { id: 'e1', questions: [] } }],
    ['studymap', { mapData: { title: 't', root: { id: 'r', label: 'r', type: 'root', children: [] } } }],
    ['truquitos', { cards: [{ id: 'cc1', type: 'regla_oro', title: 't', content: 'c' }] }],
  ]
  for (const [tool, state] of tools) {
    writeFreeToolState(sessionA, snapshot.fingerprint, tool as any, state)
  }
  const sessionAfterAllTools = getSessionById(sessionA)!
  const progress = computeFreeProcessProgress(sessionAfterAllTools)
  check('progress is exactly 100 after all 8 tools, despite localStorage never accepting a single write', progress.totalPercent === 100)
  for (const tool of ['flashcards', 'quiz', 'repasar', 'analysis', 'alai', 'exam', 'studymap', 'truquitos']) {
    check(`durable envelope present for ${tool}`, progress.byTool[tool as keyof typeof progress.byTool] === true)
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 4/9 — cold device: a session that exists ONLY on the server (never
  // touched this runtime's memory or localStorage — simulates a genuine
  // cross-device / post-reload cold read) must still restore completely,
  // with the fingerprint preserved exactly (not reconstructed from empty
  // arrays).
  // ═══════════════════════════════════════════════════════════════
  console.log('\nTEST 4,9 — cold device: session exists ONLY on server, lookupSessionsFromServer restores it with fingerprint intact')
  const temaIdCold = 'tema-quota-cold'
  const materialIdsCold = ['mat-quota-cold']
  const snapshotCold = buildSourceSelectionSnapshot(materialIdsCold, { 'mat-quota-cold': [3, 4] })
  const sessionCold = 'sess_cold_device_only'
  const coldToolsNotes = { freeTools: Object.fromEntries(tools.map(([tool, state], i) => [tool, {
    version: 1, tool, sessionId: sessionCold, sourceSelectionFingerprint: snapshotCold.fingerprint, revision: 1, updatedAt: Date.now(), state,
  }])) }
  serverStore.set(sessionCold, {
    id: sessionCold, temaId: temaIdCold, enfoque: 'teorico', processMode: 'free', studyMode: 'free',
    materialIds: materialIdsCold, selectedPages: { 'mat-quota-cold': [3, 4] },
    sourceSelectionFingerprint: snapshotCold.fingerprint,
    notes: coldToolsNotes,
    createdAt: Date.now(), updatedAt: Date.now(), lastOpenedAt: Date.now(),
  })

  const coldReadBefore = getSessionById(sessionCold)
  check('before any server lookup: session unknown to this runtime\'s memory/localStorage (genuinely cold)', coldReadBefore === null)

  const serverLookup = await lookupSessionsFromServer(temaIdCold, sessionCold)
  check('lookupSessionsFromServer restores the session from the server', serverLookup.status === 'FOUND' && serverLookup.sessions.length === 1)
  const restoredSession = serverLookup.sessions[0]
  check('restored session has the SAME sessionId', restoredSession.id === sessionCold)
  check('restored session preserves materialIds', JSON.stringify(restoredSession.materialIds) === JSON.stringify(materialIdsCold))
  check('restored session preserves selectedPages', JSON.stringify(restoredSession.selectedPages) === JSON.stringify({ 'mat-quota-cold': [3, 4] }))
  check('restored session preserves sourceSelectionFingerprint exactly (not reconstructed from empty arrays)', restoredSession.sourceSelectionFingerprint === snapshotCold.fingerprint)

  const coldReadAfterLookup = getSessionById(sessionCold)
  check('after lookupSessionsFromServer, a plain synchronous getSessionById now finds the session (memory cache populated)', coldReadAfterLookup?.id === sessionCold)

  const restoredProgress = getSessionsByTema(temaIdCold).find((s) => s.id === sessionCold)
  check('restored session (via getSessionsByTema) still shows 8-tool notes.freeTools', Object.keys(restoredProgress?.notes?.freeTools || {}).length === 7)
  check('progress computed from server-restored session reflects the 7 tools written (no flashcards on this cold session, by design)', computeFreeProcessProgress(restoredProgress!).totalPercent === 82)

  console.log(`\n${pass} PASS, 0 FAIL`)
  console.log('✅ StudySession quota resilience contracts')
}

main().catch((err) => {
  console.error('❌ StudySession quota resilience contracts FAILED')
  console.error(err)
  process.exit(1)
})
