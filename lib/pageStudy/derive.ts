import type { AskKind, TutorMarkers, TurnRole } from './turnIntent'
import type { DeterministicIntent } from './turnIntent'
import { clip, isWeak } from './evidence'
import { currentBlock, dueRechecks } from './state'
import type { GroundedUnit } from './grounding'
import type { PageStudyState, StateOp, UnitMeta, Verdict } from './types'

/**
 * SERVER-SIDE derivation of the state transition. The model only reports bounded semantic observations (role, verdict,
 * which handles it taught / asked about); this module decides what is legal:
 *   - a verdict counts only for an ANSWER, only when a question is pending, and only when it is valid;
 *   - the pending question, its targets and its identity belong to the server (a retry after a miss is pinned to the
 *     same concept; the model cannot re-target it);
 *   - coverage advances only for units of the current offered chunk that are really grounded;
 *   - a help-assisted retry can never become independent evidence.
 */
export interface DerivationInput {
  state: PageStudyState
  seq: number
  isStart: boolean
  message: string
  deterministic: DeterministicIntent
  markers: TutorMarkers
  units: GroundedUnit[]                         // untaught, grounded candidates for the current block (in teaching order)
  deferred: string[]                            // unitRefs the grounding deferred
  handleToUnit: Map<string, string>             // '#1' → unitRef
  cardHandles: Map<string, string>              // 'R1' → unitRef (due recheck cards)
  chunk: string[]                               // handles the server offered for teaching this turn
}
export interface Derived {
  role: TurnRole
  ops: StateOp[]
  graded: Verdict | null
  taught: string[]
  askedRef: string | null
  askedUnitRefs: string[]
  askKind: 'mini' | 'eval' | 'recheck' | null
  externalKnowledgeUsed: boolean
  ignored: string[]
}

const unitMeta = (u: GroundedUnit): UnitMeta => ({ unitRef: u.unitRef, materialId: u.materialId, label: u.label, kind: u.kind, pages: u.pages })

export function deriveTurn(input: DerivationInput): Derived {
  const { state, seq, markers, units, deterministic } = input
  const block = currentBlock(state)
  const ignored: string[] = []
  const ops: StateOp[] = []
  if (!block) return { role: 'chat', ops, graded: null, taught: [], askedRef: null, askedUnitRefs: [], askKind: null, externalKnowledgeUsed: false, ignored: ['finished'] }
  const progress = state.progress[block.blockKey]
  const pending = state.pending
  const unitByRef = new Map(units.map(u => [u.unitRef, u]))

  // 1. role — deterministic beats the model; the model can never claim navigate/command/admin/start
  let role: TurnRole = input.isStart ? 'start' : deterministic.role ?? markers.role ?? 'question'
  if (!input.isStart && !deterministic.role && !markers.role) ignored.push('missing_role_marker')
  let verdict: Verdict | null = null
  if (role === 'answer') {
    if (!pending) { role = 'question'; ignored.push('answer_without_pending') }
    else if (!markers.verdict) { role = 'question'; ignored.push('missing_or_invalid_verdict') }   // conservative: nothing advances, nothing is graded
    else verdict = markers.verdict
  }

  // 2. block bootstrap (once): how many units this block can teach, and what had to be deferred
  if (progress && progress.totalUnits === 0 && units.length > 0) ops.push({ op: 'units', blockKey: block.blockKey, total: units.length })
  const newlyDeferred = input.deferred.filter(ref => !progress?.deferred.includes(ref) && !state.concepts[ref])
  if (newlyDeferred.length) ops.push({ op: 'defer', blockKey: block.blockKey, unitRefs: newlyDeferred })

  // 3. evidence: an answer is graded against the SERVER-held pending question
  const answeredUnitRefs = pending?.unitRefs ?? []
  if (role === 'answer' && verdict) {
    ops.push({ op: 'answer', verdict, digest: clip(input.message, 120), ...(verdict !== 'correct' && markers.misconception?.correctStatement ? { misconception: markers.misconception } : {}) })
  } else if (pending && (role === 'clarify' || role === 'question')) {
    ops.push({ op: 'help', kind: role === 'clarify' ? 'clarification' : 'question' })     // a doubt never consumes the pending question
  }
  if (markers.help === 'reveal' && pending && role !== 'answer') ops.push({ op: 'help', kind: 'reveal' })

  // 4. teaching: only units of the offered chunk, only from turns that really taught material
  const externalKnowledgeUsed = markers.external
  const taught: string[] = []
  const teachAllowed = !externalKnowledgeUsed && (role === 'start' || role === 'answer' || role === 'command' || role === 'chat')
  if (teachAllowed) {
    const offered = new Set(input.chunk)
    const refs = markers.taught.filter(h => offered.has(h)).map(h => input.handleToUnit.get(h)).filter((r): r is string => Boolean(r))
    const full = refs.map(r => unitByRef.get(r)).filter((u): u is GroundedUnit => Boolean(u && u.klass === 'FULL'))
    const projected = refs.map(r => unitByRef.get(r)).filter((u): u is GroundedUnit => Boolean(u && u.klass === 'PROJECTED'))
    if (full.length) ops.push({ op: 'teach', blockKey: block.blockKey, klass: 'FULL', units: full.map(unitMeta) })
    if (projected.length) ops.push({ op: 'teach', blockKey: block.blockKey, klass: 'PROJECTED', units: projected.map(unitMeta) })
    taught.push(...full.map(u => u.unitRef), ...projected.map(u => u.unitRef))
  } else if (markers.taught.length) ignored.push('teach_ignored_for_role_or_external')

  // 5. commands the server executes itself
  let complete: { forced: boolean } | null = null
  if (role === 'command' && deterministic.command === 'force_block') complete = { forced: true }

  // 6. asking: one authoritative pending question, targets owned by the server
  let askedRef: string | null = null
  let askedUnitRefs: string[] = []
  let askKind: 'mini' | 'eval' | 'recheck' | null = null
  const pendingAfter = role === 'answer' ? false : Boolean(pending)
  const skipping = role === 'command' && deterministic.command === 'skip_question'
  const mayAsk = !complete && (!pendingAfter || skipping) && role !== 'navigate' && role !== 'admin' && role !== 'question' && role !== 'clarify'
  if (markers.ask && mayAsk) {
    const taughtNow = new Set([...Object.keys(state.concepts), ...taught])
    let refs = markers.ask.handles.map(h => input.handleToUnit.get(h) ?? input.cardHandles.get(h)).filter((r): r is string => Boolean(r)).filter(r => taughtNow.has(r))
    if (verdict && verdict !== 'correct') { refs = [...answeredUnitRefs]; if (markers.ask.handles.length) ignored.push('target_pinned_to_active_concept') }   // wrong/partial ⇒ same concept, never a new target
    if (refs.length) {
      const dueRefs = new Set(dueRechecks(state).map(c => c.unitRef))
      askKind = refs.every(r => dueRefs.has(r)) ? 'recheck' : progress?.wrapped || (units.length === 0 && (progress?.evalAsked ?? 0) < 2) ? 'eval' : 'mini'
      askedRef = `q${seq}`; askedUnitRefs = refs
      ops.push({ op: 'ask', ref: askedRef, unitRefs: refs, format: (markers.ask.kind as AskKind) || 'open', kind: askKind, ...(skipping && pending ? { replace: true } : {}) })
      // a retry after a miss (or after the tutor revealed something) can never count as independent
      if (verdict && verdict !== 'correct') ops.push({ op: 'help', kind: markers.help === 'reveal' ? 'reveal' : 'hint' })
      else if (markers.help) ops.push({ op: 'help', kind: markers.help })
    }
  } else if (markers.ask) ignored.push(pendingAfter ? 'ask_ignored_pending_survives' : 'ask_ignored_for_role')

  // 7. consolidation and advancement (server decides, never the model)
  const taughtCount = (progress?.taught.length ?? 0) + (progress?.projected.length ?? 0) + taught.length
  const untaughtLeft = units.filter(u => !taught.includes(u.unitRef)).length
  const noPendingAfter = !askedRef && !pendingAfter
  // Phase 5: do not wrap while an important weak concept still owes its ONE bounded remediation
  // pass. Excludes the concept THIS turn's own answer just resolved (its post-answer weak/attempt
  // state isn't reflected in `state` yet — the next turn's fresh suggestMove reconsiders it with
  // up-to-date evidence). Without this gate, the block auto-wrapped the instant BLOCK_REVIEW's
  // cumulative-check cap was reached, racing ahead of the REMEDIATE step and permanently skipping
  // it for any concept that had already missed earlier in the block.
  const remediationOwed = progress ? [...progress.taught, ...progress.projected]
    .filter(ref => !answeredUnitRefs.includes(ref))
    .some(ref => { const c = state.concepts[ref]; return c && isWeak(c) && c.attempts.length <= 1 }) : false
  if (!complete && progress && !progress.wrapped && untaughtLeft === 0 && taughtCount > 0 && noPendingAfter && progress.evalAsked >= Math.min(2, taughtCount) && !remediationOwed) ops.push({ op: 'wrap', blockKey: block.blockKey })
  if (!complete && role === 'command' && deterministic.command === 'continue' && progress?.wrapped && !pending) complete = { forced: false }
  if (input.isStart && units.length === 0 && !complete) complete = { forced: false }   // a block with nothing teachable is skipped, never re-started forever
  if (complete) ops.push({ op: 'complete', blockKey: block.blockKey, forced: complete.forced })

  return { role, ops, graded: verdict, taught, askedRef, askedUnitRefs, askKind, externalKnowledgeUsed, ignored }
}
