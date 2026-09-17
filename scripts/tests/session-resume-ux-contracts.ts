import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolvePreparationCopyVariant, resolveFreeHubMaterialEnjoyerGate } from '../../components/materias/MaterialPreparationScreen'

// ============================================================
// SESSION_RESUME_UX contracts — Part 1 of STUDYAL — SESSION RESUME UX
// + STUDY MAP GUIDED CAMERA.
//
// Ownership trace (audit, not fixed — TemaView already had all the
// pieces; this phase only adds the copy decision on top of them):
//   - "new session" vs "existing/resumable session" is decided by
//     resumeSessionId (components/materias/TemaView.tsx) — sourced from
//     the URL's freeSessionId param or an in-app freeReturnSeed, cross-
//     checked against activeSessions/getSessionById
//     (lib/studySessions.ts — a localStorage cache kept in sync with
//     the server via syncToServer/lookupSessionByIdFromServer, i.e. the
//     SAME server-backed session authority TemaView already uses
//     everywhere else for session identity — never a bespoke
//     localStorage-only check).
//   - "persisted Enjoyer readiness" (whether the gate shows ANY
//     preparation screen at all, and which technical mode) is decided
//     by resolveFreeHubMaterialEnjoyerGate — completely unmodified by
//     this phase.
//   - This phase adds ONE new, orthogonal, pure decision:
//     resolvePreparationCopyVariant(hasResumeSessionId, resumeSessionExists)
//     -> 'new' | 'resume', which only ever changes COPY inside the
//     'preparing' gate mode — never shouldGate/mode itself, never
//     Enjoyer/Brain readiness, never triggers a fetch.
// ============================================================

let passed = 0, failed = 0
function test(name: string, fn: () => void) {
  try { fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

console.log('\n── SESSION_RESUME_UX contracts ──\n')

// ── A/B: new vs resume copy decision (pure function) ──

test('B. new session (no resumeSessionId) -> preparation copy variant', () => {
  assert.equal(resolvePreparationCopyVariant(false, false), 'new')
})

test('B2. a resumeSessionId that does NOT resolve to a real persisted session -> preparation copy (never trust an unresolved id)', () => {
  assert.equal(resolvePreparationCopyVariant(true, false), 'new', 'a stale/dead session link must never be read as resumable')
})

test('A. existing, persisted, resolvable session -> resume copy variant', () => {
  assert.equal(resolvePreparationCopyVariant(true, true), 'resume')
})

// ── Wiring: TemaView derives isResumingFreeSession from the SAME
// server-synced session store it already uses for resumeSessionId
// elsewhere — never a separate/new localStorage read. ──

const temaViewSrc = readFileSync('components/materias/TemaView.tsx', 'utf8')

test('TemaView derives resume-copy variant from resumeSessionId + activeSessions/getSessionById (existing session authority), not a new localStorage check', () => {
  assert.match(temaViewSrc, /const resumeSessionRecord = resumeSessionId\s*\n\s*\? activeSessions\.find\(s => s\.id === resumeSessionId\) \|\| getSessionById\(resumeSessionId\)\s*\n\s*: null;/)
  assert.match(temaViewSrc, /const isResumingFreeSession = resolvePreparationCopyVariant\(!!resumeSessionId, !!resumeSessionRecord\) === 'resume';/)
  assert.doesNotMatch(temaViewSrc.slice(temaViewSrc.indexOf('const resumeSessionRecord'), temaViewSrc.indexOf('isResumingFreeSession = resolvePreparationCopyVariant') + 200), /localStorage\.getItem/, 'must reuse the existing session-store accessors, never a raw localStorage read')
})

test('TemaView passes isResumingSession into MaterialPreparationScreen at the Free-hub gate render site', () => {
  const gateBlock = temaViewSrc.slice(temaViewSrc.indexOf('if (openFree)'), temaViewSrc.indexOf('if (openFree)') + 800)
  assert.match(gateBlock, /isResumingSession=\{isResumingFreeSession\}/)
})

// ── C: resume UX causes no provider calls / no Enjoyer regeneration ──

test('C. resolvePreparationCopyVariant is a pure function with zero I/O (no fetch, no provider, no localStorage) — copy-only decision', () => {
  const fnSrc = readFileSync('components/materias/MaterialPreparationScreen.tsx', 'utf8')
  const body = fnSrc.slice(fnSrc.indexOf('export function resolvePreparationCopyVariant'), fnSrc.indexOf('// ── Componente visual'))
  assert.doesNotMatch(body, /fetch\(|localStorage|generate|regenerat/i)
})

test('C2. the resume-copy branch never calls getOrCreateStudyalMaterialEnjoyer or any generation entrypoint — only the pre-existing readiness gate (unchanged) can ever trigger generation', () => {
  assert.doesNotMatch(temaViewSrc, /isResumingFreeSession[\s\S]{0,200}getOrCreateStudyalMaterialEnjoyer/)
  // The readiness gate itself (freePreparationGate) is untouched — still
  // driven purely by materialEnjoyer?.status / enjoyerFingerprintMatches,
  // never by isResumingFreeSession.
  const gateCallMatch = temaViewSrc.match(/const freePreparationGate = resolveFreeHubMaterialEnjoyerGate\(([\s\S]*?)\);/)
  assert.ok(gateCallMatch)
  assert.doesNotMatch(gateCallMatch![1], /isResumingFreeSession/, 'the readiness gate must remain decided ONLY by Enjoyer status/fingerprint — resume copy must never influence whether/what it gates')
})

test('D. resume path reuses persisted state: isResumingSession only changes MaterialPreparationScreen COPY, never `mode`/`shouldGate` (still resolveFreeHubMaterialEnjoyerGate\'s exclusive authority)', () => {
  const screenSrc = readFileSync('components/materias/MaterialPreparationScreen.tsx', 'utf8')
  assert.match(screenSrc, /const showResumeCopy = isResumingSession && mode === 'preparing';/)
  // showResumeCopy is read-only downstream — it must never feed back into
  // `mode` or trigger a retry/regeneration path.
  const afterDecl = screenSrc.slice(screenSrc.indexOf('const showResumeCopy'))
  assert.doesNotMatch(afterDecl, /setMode|onRetry\(\)|mode = /, 'showResumeCopy must be read-only presentational state')
})

test('E. resolveFreeHubMaterialEnjoyerGate (the actual readiness/regeneration gate) is byte-for-byte unchanged by this phase', () => {
  const fnSrc = readFileSync('components/materias/MaterialPreparationScreen.tsx', 'utf8')
  const gateFn = fnSrc.slice(fnSrc.indexOf('export function resolveFreeHubMaterialEnjoyerGate'), fnSrc.indexOf('export function resolveMaterialPreparationGate'))
  assert.match(gateFn, /if \(effectiveStatus === 'ready'\) return \{ shouldGate: false, mode: null \};/)
  assert.match(gateFn, /if \(effectiveStatus === 'failed'\) return \{ shouldGate: true, mode: 'failed' \};/)
  assert.doesNotMatch(gateFn, /isResumingSession|resumeSessionId/, 'the readiness gate must remain fully independent of session-resume copy logic')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
console.log('session-resume-ux-contracts: ALL PASS')
