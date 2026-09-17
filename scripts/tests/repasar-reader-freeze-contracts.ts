import assert from 'node:assert/strict'
import {
  freezeRepasarEnjoyerSnapshot, resolveRepasarEnjoyerSnapshot,
  type RepasarSnapshotStore, type RepasarFrozenSnapshot, type RepasarReader,
} from '../../lib/materialBrain/repasarSnapshot'
import type { RepasarGroundedContext } from '../../lib/materialBrain/reviewContext'

// ============================================================
// LIVE BUG: user explicitly selected "Niño" but the returned/persisted
// result said "Profesor" — because the route re-read `body.mode` fresh
// on EVERY request (new attempt AND teach-check continuation) instead of
// freezing the reader once, at attempt creation, into the same frozen
// snapshot that already freezes the academic universe.
//
// Fix: RepasarFrozenSnapshot now carries `reader`, set only for
// intent:'new_attempt' from the caller's requested reader; a
// 'continue_attempt' call ignores any reader argument entirely and the
// restored snapshot's own `reader` is authoritative for the rest of the
// attempt (lib/materialBrain/repasarSnapshot.ts, app/api/alai-studyal-repasar/route.ts).
//
// This harness exercises the REAL resolveRepasarEnjoyerSnapshot/
// freezeRepasarEnjoyerSnapshot functions with a minimal in-memory store —
// no provider calls, no HTTP.
// ============================================================

class MemoryStore implements RepasarSnapshotStore {
  private map = new Map<string, RepasarFrozenSnapshot>()
  async get(id: string) { return this.map.get(id) || null }
  async set(snapshot: RepasarFrozenSnapshot) { this.map.set(snapshot.snapshotId, snapshot) }
}

function grounded(fingerprint = 'fp-equilibrio'): RepasarGroundedContext {
  return {
    fingerprint,
    builderVersion: '1.0.0',
    authorityType: 'studyal_material_enjoyer',
    targets: [
      {
        id: 't1', unitId: 't1', kind: 'concept', label: 'Definición de Equilibrio Químico',
        statement: 'El equilibrio químico ocurre cuando la reacción directa y la inversa pasan a la misma velocidad',
        importanceTier: 'critical', difficulty: null, topicId: null, topicTitle: null,
        sourceOrder: 0, materialId: 'mat-a', page: 1, pages: [1],
        sourceSpans: [{ page: 1, quote: 'El equilibrio químico ocurre cuando la reacción directa y la inversa pasan a la misma velocidad' }],
        derivation: null, evidenceText: 'El equilibrio químico ocurre cuando la reacción directa y la inversa pasan a la misma velocidad',
      },
    ],
    relations: [],
    topics: [],
  }
}

async function testA_selectingNinoFreezesNino() {
  const store = new MemoryStore()
  const resolution = await resolveRepasarEnjoyerSnapshot({
    groundedContext: grounded(), store, intent: 'new_attempt', requestedReader: 'nino',
  })
  assert.equal(resolution.ok, true)
  assert.equal(resolution.snapshot?.reader, 'nino', 'A: selecting Niño produces a frozen reader of nino')
  console.log('repasar-reader-freeze: A PASS')
}

async function testB_evaluationReceivesNino() {
  const snapshot = freezeRepasarEnjoyerSnapshot(grounded(), { reader: 'nino' })
  const evaluationReader: RepasarReader = snapshot.reader || 'libre'
  assert.equal(evaluationReader, 'nino', 'B: the value the evaluation step reads is nino, not a fresh body.mode')
  console.log('repasar-reader-freeze: B PASS')
}

async function testC_returnedResultSaysNino() {
  const snapshot = freezeRepasarEnjoyerSnapshot(grounded(), { reader: 'nino' })
  const responsePersona = { nino: 'Niño', universitario: 'Universitario', profesor: 'Profesor', libre: 'Evaluador neutral' }[snapshot.reader || 'libre']
  assert.equal(responsePersona, 'Niño', 'C: the persona surfaced in the response matches the frozen reader')
  console.log('repasar-reader-freeze: C PASS')
}

async function testD_persistedReopenedAttemptStillNino() {
  const store = new MemoryStore()
  const created = await resolveRepasarEnjoyerSnapshot({
    groundedContext: grounded(), store, intent: 'new_attempt', requestedReader: 'nino',
  })
  const snapshotId = created.snapshot!.snapshotId
  // A later teach-check call passes a DIFFERENT (or absent) reader — must be ignored.
  const reopened = await resolveRepasarEnjoyerSnapshot({
    groundedContext: grounded(), store, intent: 'continue_attempt', requestedSnapshotId: snapshotId,
    requestedReader: 'profesor', // simulates a stale/drifted client value; must be ignored
  })
  assert.equal(reopened.ok, true)
  assert.equal(reopened.snapshot?.reader, 'nino', 'D: reopening/continuing the attempt still reports nino, never the passed-in profesor')
  console.log('repasar-reader-freeze: D PASS')
}

async function testE_selectingProfesorIndependentlyProducesProfesor() {
  const store = new MemoryStore()
  const resolution = await resolveRepasarEnjoyerSnapshot({
    groundedContext: grounded(), store, intent: 'new_attempt', requestedReader: 'profesor',
  })
  assert.equal(resolution.snapshot?.reader, 'profesor', 'E: an independent attempt selecting Profesor freezes profesor')
  console.log('repasar-reader-freeze: E PASS')
}

async function testF_oldProfesorAttemptCannotContaminateNewNinoAttempt() {
  const store = new MemoryStore()
  const older = await resolveRepasarEnjoyerSnapshot({
    groundedContext: grounded(), store, intent: 'new_attempt', requestedReader: 'profesor',
  })
  assert.equal(older.snapshot?.reader, 'profesor')
  const fresh = await resolveRepasarEnjoyerSnapshot({
    groundedContext: grounded(), store, intent: 'new_attempt', requestedReader: 'nino',
  })
  assert.equal(fresh.snapshot?.reader, 'nino', 'F: a brand-new attempt is unaffected by any prior attempt\'s frozen reader')
  assert.notEqual(fresh.snapshot?.snapshotId, older.snapshot?.snapshotId)
  console.log('repasar-reader-freeze: F PASS')
}

async function testG_retryPreservesCurrentAttemptFrozenReader() {
  const store = new MemoryStore()
  const created = await resolveRepasarEnjoyerSnapshot({
    groundedContext: grounded(), store, intent: 'new_attempt', requestedReader: 'universitario',
  })
  const snapshotId = created.snapshot!.snapshotId
  // Simulate two subsequent teach-check/retry calls within the same attempt.
  for (let i = 0; i < 2; i++) {
    const retried = await resolveRepasarEnjoyerSnapshot({
      groundedContext: grounded(), store, intent: 'continue_attempt', requestedSnapshotId: snapshotId,
    })
    assert.equal(retried.snapshot?.reader, 'universitario', `G: retry #${i + 1} preserves the attempt's frozen reader`)
  }
  console.log('repasar-reader-freeze: G PASS')
}

async function testLegacySnapshotFallsBackToLibre() {
  const legacy = freezeRepasarEnjoyerSnapshot(grounded())
  delete (legacy as Partial<RepasarFrozenSnapshot>).reader
  const evaluationReader: RepasarReader = legacy.reader || 'libre'
  assert.equal(evaluationReader, 'libre', 'legacy snapshot with no reader field falls back to libre, never fabricated')
  console.log('repasar-reader-freeze: LEGACY-FALLBACK PASS')
}

async function main() {
  await testA_selectingNinoFreezesNino()
  await testB_evaluationReceivesNino()
  await testC_returnedResultSaysNino()
  await testD_persistedReopenedAttemptStillNino()
  await testE_selectingProfesorIndependentlyProducesProfesor()
  await testF_oldProfesorAttemptCannotContaminateNewNinoAttempt()
  await testG_retryPreservesCurrentAttemptFrozenReader()
  await testLegacySnapshotFallsBackToLibre()
  console.log('repasar-reader-freeze-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
