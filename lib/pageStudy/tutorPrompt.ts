import { academicLanguageInstruction } from '../materialLanguage'
import { normalizePracticeNotation } from '../alai-chat/practice'
import type { TutorContext } from './context'
import { currentBlock } from './state'
import { isWeak } from './evidence'
import type { DeterministicIntent, TurnRole } from './turnIntent'
import type { PageStudyState } from './types'

/**
 * The tutor contract + a compact, fully-authorized context. Internal moves (TEACH, ASK, RETEST, RECALL, BLOCK_REVIEW…)
 * are only hints for the model; the student never sees phases. The instructions are English on purpose: the OUTPUT
 * language comes from the language authority line, never from the language of the instructions.
 */
export type TutorMove = 'TEACH' | 'ASK' | 'RECALL' | 'RETEST' | 'BLOCK_REVIEW' | 'REMEDIATE' | 'WRAP' | 'ADVANCE' | 'FEEDBACK'

export interface MoveSuggestion { move: TutorMove; handles: string[]; reason: string }

/** A taught concept this turn's ASK/BLOCK_REVIEW could target that has never been checked yet
 * (no attempts recorded). Checks must sample NEW ground, never re-interrogate a concept the
 * student already answered — that is what produced the "unique identity" → "emotional
 * connection" → "what else contributes to unique identity" loop in the Falcons regression. */
const uncheckedTaughtHandles = (state: PageStudyState, ctx: TutorContext): string[] =>
  [...ctx.taughtHandles].filter(([, ref]) => (state.concepts[ref]?.attempts.length ?? 0) === 0).map(([h]) => h)

// Units taught since the last check before a lightweight check is due (kept at the frozen
// Phase 3 threshold: CHECK CADENCE was never the actual root cause of the Falcons
// interrogation-loop regression — every reply, TEACH included, was directed to end in an
// evaluative question, and the same already-checked concept could be re-asked back to back.
// Both of those are fixed below; changing this threshold would only mask the symptom while
// cascading unrelated turn-sequencing breakage through the existing durable-turn harness).
const UNITS_BEFORE_CHECK = 2

/** A representative sample of taught concepts for cumulative block review — never just the most
 * recently taught handles (which would test only the tail of the block, ignoring earlier
 * material and biasing toward whatever the student was just asked). Priority: weak concepts
 * first (they most need cumulative reinforcement), then taught-but-never-independently-
 * demonstrated concepts, then everything else — spread across the block rather than clustered,
 * bounded to a small conversational sample (never "test every line"). */
function blockReviewHandles(state: PageStudyState, ctx: TutorContext, max = 3): string[] {
  // Never immediately re-pick the concept the student was just attempted on (same-turn cooldown)
  // — a "no sé"/miss during review must not become the very next review question too; it either
  // comes back in a later review round or is handled deliberately by the bounded REMEDIATE step.
  const justAttempted = new Set(Object.values(state.concepts).filter(c => c.attempts.at(-1)?.turnSeq === state.turnSeq).map(c => c.unitRef))
  const scored = [...ctx.taughtHandles].filter(([, ref]) => !justAttempted.has(ref)).map(([handle, ref]) => {
    const concept = state.concepts[ref]
    const weak = concept ? isWeak(concept) : false
    const demonstrated = concept ? concept.demonstratedIndependent : false
    const priority = weak ? 0 : !demonstrated ? 1 : 2
    return { handle, priority }
  })
  scored.sort((a, b) => a.priority - b.priority)
  return scored.slice(0, max).map(s => s.handle)
}

/** Bounded end-of-block remediation targets: weak concepts actually TAUGHT in this block, that
 * matter enough to have entered weak tracking, still weak after review, capped to the two most
 * important (earliest-taught = foundational) ones. A concept is only offered ONE remediation
 * cycle (one full explanation + one independent retest, folded into a single REMEDIATE turn) —
 * `attempts.length <= 1` means it has had at most its original miss and has not yet been through
 * a remediation retest; once that retest happens (attempts.length becomes 2+) it is never
 * targeted again here, whatever the outcome — no perfection loop, no infinite mastery requirement.
 * This needs no new persisted counter: the bound falls naturally out of existing attempt history. */
function blockRemediationTargets(state: PageStudyState, ctx: TutorContext, block: { blockKey: string }, max = 2): string[] {
  const p = state.progress[block.blockKey]
  if (!p) return []
  const blockConceptRefs = new Set([...p.taught, ...p.projected])
  return [...ctx.taughtHandles]
    .filter(([, ref]) => blockConceptRefs.has(ref))
    .map(([handle, ref]) => ({ handle, concept: state.concepts[ref] }))
    .filter((x): x is { handle: string; concept: NonNullable<typeof x.concept> } => Boolean(x.concept) && isWeak(x.concept) && x.concept.attempts.length <= 1)
    .sort((a, b) => a.concept.taughtSeq - b.concept.taughtSeq)
    .slice(0, max)
    .map(x => x.handle)
}

/** Was anything taught (this material) strictly after `turnSeq`? Used to gate RETEST on a weak
 * concept behind genuine intervening activity — retesting on the very next turn ("explain A →
 * retest A immediately") never distinguishes rehearsed repetition from real delayed recall. */
const taughtSince = (state: PageStudyState, materialId: string, turnSeq: number): boolean =>
  Object.values(state.concepts).some(c => c.materialId === materialId && c.taughtSeq > turnSeq)

/** Deterministic policy: what should the NEXT move be, given authoritative state. */
export function suggestMove(state: PageStudyState, ctx: TutorContext): MoveSuggestion {
  const block = currentBlock(state)
  const p = block ? state.progress[block.blockKey] : undefined
  if (!block || !p) return { move: 'ADVANCE', handles: [], reason: 'plan finished' }
  if (state.pending) return { move: 'FEEDBACK', handles: [], reason: 'a question is pending' }
  const taughtCount = p.taught.length + p.projected.length
  const weak = ctx.recall.find(r => r.kind === 'weak')
  // Delayed/interleaved retest: only offer RETEST once something new was taught since the miss
  // (or the block has nothing left to teach, so there is no intervening material to wait for —
  // that case falls through to BLOCK_REVIEW/carryover below instead of looping on this concept).
  if (weak && taughtCount > 0) {
    const lastAttempt = state.concepts[weak.unitRef]?.attempts.at(-1)
    if (lastAttempt && taughtSince(state, ctx.authority.materialId, lastAttempt.turnSeq)) {
      return { move: 'RETEST', handles: [weak.handle], reason: 'the student missed this concept earlier and new material has been taught since: re-test it in a new way' }
    }
  }
  if (ctx.units.length === 0) {
    if (!p.wrapped && p.evalAsked < Math.min(2, taughtCount)) return { move: 'BLOCK_REVIEW', handles: blockReviewHandles(state, ctx), reason: 'everything in this block is taught: sample understanding across it — weak and undemonstrated concepts first, not just the most recent handle' }
    if (!p.wrapped) {
      // Block-review agenda is exhausted: close out any IMPORTANT weak concepts (bounded, at most
      // 2, one remediation cycle each) before wrapping — this is the missing REMEDIATE step
      // between cumulative review and WRAP. An unresolved weak target after this still allows the
      // block to complete: it is retained in bounded carryover (state.ts `complete` op), never an
      // infinite mastery loop.
      const remediate = blockRemediationTargets(state, ctx, block)
      if (remediate.length > 0) return { move: 'REMEDIATE', handles: remediate.slice(0, 1), reason: 'this concept is important enough to have entered weak tracking and is still weak after review: explain it fully and retest it once, independently, before closing the block' }
    }
    return { move: p.wrapped ? 'ADVANCE' : 'WRAP', handles: [], reason: p.wrapped ? 'block consolidated: offer to continue' : 'consolidate the block briefly' }
  }
  if (p.unitsSinceCheck >= UNITS_BEFORE_CHECK) {
    const unchecked = uncheckedTaughtHandles(state, ctx)
    // Only interrupt teaching for a check when there is genuinely untested ground to sample.
    // If everything recently taught was already checked, keep teaching instead of re-asking it.
    if (unchecked.length > 0) return { move: 'ASK', handles: unchecked.slice(0, 2), reason: 'several units were taught without a check: verify understanding of ground not yet tested' }
  }
  const due = ctx.recall.find(r => r.kind === 'card')
  if (due && taughtCount >= 1 && p.rechecks < 2) return { move: 'RECALL', handles: [due.handle], reason: 'a weakness from earlier study is due for a natural recheck' }
  return { move: 'TEACH', handles: ctx.chunk, reason: 'teach the next small coherent chunk' }
}

/** How firmly the model must execute the server's suggested move. Never a permission question: the tutor decides and acts. */
function moveDirective(move: MoveSuggestion): string {
  if (move.move === 'REMEDIATE')
    return `BLOCK CLOSE — bounded remediation for ${move.handles[0] || 'this concept'}: it is still weak after review. In ONE reply: (1) explain the concept fully and clearly — do not just hint; (2) then ask ONE independent retest question on the SAME underlying concept, but a DIFFERENT formulation/application than however it was asked before, and never reveal or repeat the previous question's exact wording or answer. Include [[A:kind|${move.handles[0] || 'K1'}]]. This is this concept's only remediation pass this block — whatever the student answers, the block will move on afterward, so do not turn this into a drawn-out interrogation.`
  if (move.move === 'BLOCK_REVIEW')
    return `This is CUMULATIVE BLOCK REVIEW, not a single micro-check: ask ONE question right now covering one of these concepts (${move.handles.join(', ') || 'K1'}; the server picked weak/undemonstrated ones first — over the next few turns you will be asked again for the others), and include [[A:kind|${move.handles[0] || 'K1'}]]. Pick the evaluation FORM that fits the academic domain of this material — e.g. nomenclature/structure/reaction/application for chemistry, calculation/method/interpretation for math, chronology/cause-effect/significance/comparison for history, main-idea/relationship/evidence for text-heavy material — never the same generic "what does X mean?" shape for every domain. Do not teach new material in this reply.`
  if (move.move === 'ASK' || move.move === 'RETEST' || move.move === 'RECALL')
    return `Do this NOW: after at most one short sentence, ask ONE concrete question the student can answer from what was taught (never a question about whether they want to be asked), and include [[A:kind|${move.handles.join(',') || 'K1'}]]. Do not teach new material in this reply. Do not ask about a concept the student already answered correctly earlier in this block — pick genuinely untested ground.`
  if (move.move === 'TEACH') return 'Teach the suggested chunk now: explain it, connect it to what came before, use examples/formulas/notation where useful. End with a connecting statement, NOT a test question — this turn is for teaching, not checking. Do not ask an evaluative question unless the student\'s own message asks for one. Never ask permission ("would you like me to…"): decide and do it.'
  return 'Adapt it if the student\'s message needs something else.'
}

export interface RecentTurn { user: string; reply: string }
export interface PromptInput {
  state: PageStudyState; ctx: TutorContext; message: string; role: TurnRole | null; deterministic: DeterministicIntent
  isStart: boolean; recent: RecentTurn[]; pendingText: string; responseLanguage?: string
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export function buildTutorPrompt(input: PromptInput): string {
  const { state, ctx, message } = input
  const block = currentBlock(state)!
  const move = suggestMove(state, ctx)
  const material = ctx.materialNames[ctx.authority.materialId] || ctx.authority.materialId
  const nextBlock = state.plan.blocks[block.index + 1]
  const nextLine = nextBlock ? (nextBlock.materialId !== block.materialId ? `After this block the plan moves to another PDF: "${ctx.materialNames[nextBlock.materialId] || nextBlock.materialId}".` : `After this block comes pages ${nextBlock.start}–${nextBlock.end} (not available yet).`) : 'This is the last block of the plan.'
  const concept = state.pending?.unitRefs.map(r => state.concepts[r]).find(Boolean)
  const attempts = concept ? concept.attempts.filter(a => a.verdict !== 'correct').length : 0
  const lines: string[] = [
    academicLanguageInstruction(ctx.language, true),
    ...(input.responseLanguage ? [`RESPONSE LANGUAGE (this reply only): write the reply in ${input.responseLanguage}. Keep the material's own wording and any quotation verbatim. This never changes the academic language of the material.`] : []),
    'You are ALAI, a natural study tutor guiding one student through a PDF, a few pages at a time, in a real conversation. Explain in small coherent chunks, react to what the student says, and never dump many pages. Never mention phases, blocks, handles, markers, quizzes, or that you follow a plan. Never ask the student for permission to teach or to quiz them. No exaggerated praise, no boilerplate like "according to the material".',
    'GROUNDING: teach and evaluate ONLY from CURRENT BLOCK and ALREADY TAUGHT below (plus RECHECK/PREVIOUS STUDY for rechecks). A unit marked PROJECTED may only use its quoted evidence: never extend it. Everything else is unavailable: do not invent it, and never reveal or guess what later pages say. If the student asks about something not covered yet, say it comes later; you may give a short answer from general knowledge only if you say so plainly and set [[E:1]].',
    'OUTPUT: return JSON {"answer":"..."}. The answer BEGINS with these markers (the student never sees them), then the natural reply:',
    '[[U:role]] role = answer (the message answers the PENDING QUESTION) | question (a new doubt) | clarify (a doubt about the pending question or your last explanation) | chat. A student QUESTION is never an answer, even while a question is pending.',
    '[[V:correct|partial|incorrect]] only when U=answer. correct only if the core idea is demonstrated (wording may differ). partial/incorrect keep the same concept: give a proportional hint first, explain fully only after repeated misses, and never re-ask by repeating what you just explained. EXCEPTION: if the student explicitly signals they do not know or gives up (e.g. "no sé", "no se", "idk", "I don\'t know", or the equivalent in the material\'s language) rather than attempting an answer, that is [[V:incorrect]] but skip the hint step — explain the concept directly and fully right away. Either way, after explaining do NOT immediately re-ask the same thing: move on with new material if any remains (the server will bring this concept back later, differently, on its own).',
    '[[M:what the student believed::the correct idea]] optional, only for partial/incorrect.  [[T:#1,#2]] the SUGGESTED CHUNK units you actually taught this turn.',
    '[[A:kind|#1]] when your reply ends by asking ONE evaluative question (kind: open|short|fill|tf|mcq|calc|compare|explain) testing the listed handles (taught units K#/#, or recheck candidates R#). Omit it when you ask nothing. While a question is pending, do not ask a new one unless the student just answered it.',
    '[[H:hint]] or [[H:reveal]] when you give a hint / reveal the answer to the question you re-ask.  [[S:#1]] handles you relied on.  [[E:1]] when you used general knowledge outside the grounding.',
    `CURRENT BLOCK — "${material}", pages ${block.start}–${block.end}. ${nextLine}`,
    ctx.chunkText ? `SUGGESTED CHUNK (teach these, in order, handles in brackets):\n${ctx.chunkText}` : 'SUGGESTED CHUNK: (nothing new to teach in this block)',
    ctx.taughtText ? `ALREADY TAUGHT (use for doubts and checks; handles K#):\n${ctx.taughtText}` : '',
    `PREVIOUS STUDY (derived study state only, never source text):\n${ctx.digestText}`,
    ctx.recall.length ? `RECHECK CANDIDATES (weak concepts; test them without quoting sources):\n${ctx.recall.map(r => `[${r.handle}] ${r.label} — ${r.status}${r.card?.misconception ? ` | student believed: ${cut(r.card.misconception, 140)}` : ''}${r.card?.correctStatement ? ` | correct: ${cut(r.card.correctStatement, 140)}` : ''}`).join('\n')}` : '',
    state.pending ? `PENDING QUESTION (authoritative; asked earlier; keep it alive while the student asks doubts): ${JSON.stringify(cut(input.pendingText || '(question text unavailable)', 420))} | kind ${state.pending.format} | misses on this concept so far: ${attempts} | help given since asked: ${state.pending.helpLevel}` : 'PENDING QUESTION: none',
    `SUGGESTED MOVE: ${move.move}${move.handles.length ? ` (${move.handles.join(', ')})` : ''} — ${move.reason}. ${moveDirective(move)}`,
    input.deterministic.role === 'navigate' ? `NAVIGATION: the student wants to revisit page ${input.deterministic.page}. Re-explain what the grounding says about that page, briefly. This is NOT an answer: use [[U:chat]] and do not grade.` : '',
    input.deterministic.command === 'skip_question' ? 'The student wants to skip the pending question: acknowledge lightly and continue (you may ask a new question).' : '',
    input.deterministic.command === 'continue' ? 'The student says to continue: continue with the SUGGESTED MOVE. If a question is still pending, remind them briefly and offer to move on.' : '',
    input.recent.length ? `RECENT CONVERSATION (oldest first):\n${input.recent.map(t => `Student: ${cut(t.user, 400)}\nALAI: ${cut(t.reply, 700)}`).join('\n')}` : '',
    input.isStart ? 'This is the very start of this block: begin teaching the SUGGESTED CHUNK naturally (one short lead-in at most). Use [[U:chat]].' : `STUDENT MESSAGE: ${JSON.stringify(cut(normalizePracticeNotation(message), 1200))}`,
    `Keep the reply under about 170 words unless the student asks for depth. ${move.move === 'TEACH' ? 'This is a TEACHING turn: end with a statement, not a question — do not test the student every turn.' : 'End with at most one question.'}`,
  ]
  return lines.filter(Boolean).join('\n')
}

export interface OutputCheck { valid: boolean; errors: string[] }
/** Structural validation of the model output. Missing role marker is reported ONCE (bounded repair) and then tolerated (falls back to 'question'). */
export function validateTutorOutput(value: unknown, opts: { strikes: { role: number } }): OutputCheck {
  const errors: string[] = []
  const answer = typeof (value as { answer?: unknown })?.answer === 'string' ? String((value as { answer: string }).answer) : ''
  if (!answer.trim()) errors.push('missing_answer')
  if (/^\s*(?:\{\s*"|```json\b)/.test(answer)) errors.push('answer_contains_json_envelope')
  if (answer.length > 7000) errors.push('answer_too_long')
  const leading = /^\s*\[\[U:(answer|question|clarify|chat)\]\]/i.test(answer)
  if (answer.trim() && !leading && opts.strikes.role < 1) { opts.strikes.role++; errors.push('missing_role_marker:begin_the_answer_with_[[U:role]]') }
  const body = answer.replace(/\[\[[UVATSHEM]:[^\]]*\]\]/g, '').trim()
  if (answer.trim() && !body) errors.push('marker_only_answer')
  return { valid: errors.length === 0, errors }
}
