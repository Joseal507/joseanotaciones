import { academicLanguageInstruction } from '../materialLanguage'
import { normalizePracticeNotation } from '../alai-chat/practice'
import type { TutorContext } from './context'
import { currentBlock } from './state'
import type { DeterministicIntent, TurnRole } from './turnIntent'
import type { PageStudyState } from './types'

/**
 * The tutor contract + a compact, fully-authorized context. Internal moves (TEACH, ASK, RETEST, RECALL, BLOCK_REVIEW…)
 * are only hints for the model; the student never sees phases. The instructions are English on purpose: the OUTPUT
 * language comes from the language authority line, never from the language of the instructions.
 */
export type TutorMove = 'TEACH' | 'ASK' | 'RECALL' | 'RETEST' | 'BLOCK_REVIEW' | 'WRAP' | 'ADVANCE' | 'FEEDBACK'

export interface MoveSuggestion { move: TutorMove; handles: string[]; reason: string }

/** Deterministic policy: what should the NEXT move be, given authoritative state. */
export function suggestMove(state: PageStudyState, ctx: TutorContext): MoveSuggestion {
  const block = currentBlock(state)
  const p = block ? state.progress[block.blockKey] : undefined
  if (!block || !p) return { move: 'ADVANCE', handles: [], reason: 'plan finished' }
  if (state.pending) return { move: 'FEEDBACK', handles: [], reason: 'a question is pending' }
  const taughtCount = p.taught.length + p.projected.length
  const weak = ctx.recall.find(r => r.kind === 'weak')
  if (weak && taughtCount > 0) return { move: 'RETEST', handles: [weak.handle], reason: 'the student just missed this concept: re-test it in a new way' }
  if (ctx.units.length === 0) {
    if (!p.wrapped && p.evalAsked < Math.min(2, taughtCount)) return { move: 'BLOCK_REVIEW', handles: [...ctx.taughtHandles.keys()].slice(0, 3), reason: 'everything in this block is taught: check understanding across it' }
    return { move: p.wrapped ? 'ADVANCE' : 'WRAP', handles: [], reason: p.wrapped ? 'block consolidated: offer to continue' : 'consolidate the block briefly' }
  }
  if (p.unitsSinceCheck >= 2) return { move: 'ASK', handles: [...ctx.taughtHandles.keys()].slice(0, 2), reason: 'two units were taught without a check' }
  const due = ctx.recall.find(r => r.kind === 'card')
  if (due && taughtCount >= 1 && p.rechecks < 2) return { move: 'RECALL', handles: [due.handle], reason: 'a weakness from earlier study is due for a natural recheck' }
  return { move: 'TEACH', handles: ctx.chunk, reason: 'teach the next small coherent chunk' }
}

/** How firmly the model must execute the server's suggested move. Never a permission question: the tutor decides and acts. */
function moveDirective(move: MoveSuggestion): string {
  if (move.move === 'ASK' || move.move === 'BLOCK_REVIEW' || move.move === 'RETEST' || move.move === 'RECALL')
    return `Do this NOW: after at most one short sentence, ask ONE concrete question the student can answer from what was taught (never a question about whether they want to be asked), and include [[A:kind|${move.handles.join(',') || 'K1'}]]. Do not teach new material in this reply.`
  if (move.move === 'TEACH') return 'Teach the suggested chunk now, then end with a statement or one concrete question about the content. Never ask permission ("would you like me to…"): decide and do it.'
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
    '[[V:correct|partial|incorrect]] only when U=answer. correct only if the core idea is demonstrated (wording may differ). partial/incorrect keep the same concept: give a proportional hint first, explain fully only after repeated misses, and never re-ask by repeating what you just explained.',
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
    'Keep the reply under about 170 words unless the student asks for depth. End with at most one question.',
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
