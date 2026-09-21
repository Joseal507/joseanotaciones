import { alai } from '../alai'
import { generateValidatedLegacyJson, type LegacyJsonGenerationInput } from '../ai/legacyRouteGeneration'
import { extractAskedQuestion } from '../alai-chat/practice'
import { resolveTutorContext, inspectTutorPrompt, responseLanguage, type ContextDeps, type TutorContext } from './context'
import { normalizeSourceText } from '../materials/sourceIndex'
import { deriveTurn } from './derive'
import { suggestMove } from './tutorPrompt'
import { sha256, turnScopeOf } from './identity'
import { PageStudyError, resolveBlockAuthority, runPageStudyTurn, type ServiceDeps, type TurnOutcome } from './service'
import { applyDelta, coverageOf, currentBlock } from './state'
import { buildTutorPrompt, validateTutorOutput, type RecentTurn } from './tutorPrompt'
import { ASK_KINDS, classifyDeterministic, parseTutorMarkers, type AskKind, type TurnRole } from './turnIntent'
import { buildPageStudyView, type PageStudyView } from './view'
import type { PageStudyState, StateOp, Verdict } from './types'

/**
 * Real tutor orchestration on top of the FROZEN durable service. Lifecycle inside `generate` (called by the service only after
 * storage proved healthy and the slot was reserved):
 *   authority → canonical Enjoyer → real page text → frozen grounding → prompt inspector (fail closed, ZERO provider calls)
 *   → ONE validated provider call (bounded single repair) → server-side delta derivation → result + stateDelta.
 * Obvious commands / progress questions / out-of-range navigation never reach a provider at all.
 */
export type LlmCall = <T>(input: LegacyJsonGenerationInput<T>) => Promise<T>
/** "Would you like me to…" is a permission request, not a check of understanding: it never becomes a pending question. */
const PERMISSION_QUESTION = /(?:te\s+gustar[ií]a|quieres\s+que|prefieres\s+que|would\s+you\s+like|do\s+you\s+want\s+me|你想让我|要我)/i

/** ≥60% (and ≥2 when the label has several) of a unit label's content words appear in the reply. */
function labelEchoed(reply: string, label: string): boolean {
  const normalizedLabel = normalizeSourceText(label)
  const words = [...new Set(normalizedLabel.split(' ').filter(w => w.length >= 4))]
  if (!words.length) return false
  const tokens = new Set(normalizeSourceText(reply).split(' '))
  const numericIdentifiers = [...new Set(normalizedLabel.split(' ').filter(w => /^\d+$/.test(w)))]
  if (numericIdentifiers.some(identifier => !tokens.has(identifier))) return false
  const hit = words.filter(w => tokens.has(w)).length
  return hit >= Math.min(2, words.length) && hit / words.length >= 0.6
}

export interface TutorDeps extends ServiceDeps {
  context: ContextDeps
  /** Injectable transport (production: `alai`). The real generation/repair pipeline always runs on top of it. */
  provider?: LegacyJsonGenerationInput<unknown>['provider']
  /** Test seam: lets a contract inject an unauthorized section to prove the inspector fails closed before the provider. */
  contextTransform?: (ctx: TutorContext) => TutorContext
}
export interface TutorInput { userId: string; planId: string; slot: string; message: string; expectedSeq?: number; languageOverride?: string }

export interface TutorResult {
  schema: 'page-study-turn'; version: 1; seq: number; role: TurnRole
  reply: string; userMessage: string; deterministic: boolean
  provenance: Array<{ materialId: string; pages: number[]; kind: 'FULL' | 'PROJECTED' | 'RECALL' }>
  externalKnowledgeUsed: boolean; graded: Verdict | null
  pendingQuestion: { ref: string; kind: string; text: string } | null
  navigation: { materialId: string; page: number } | null
  language: string | null; responseLanguage: string | null
  diagnostics: { providerCalls: number; repaired: boolean; contextChars: number; ignored: string[]; role: TurnRole }
}
export interface TutorTurnOutcome { turn: TutorResult; view: PageStudyView; replayed: boolean }

const clip = (t: string, n: number) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n)

async function recentWindow(deps: TutorDeps, userId: string, state: PageStudyState): Promise<{ recent: RecentTurn[]; pendingText: string }> {
  const scope = turnScopeOf(userId, state.planId)
  const tail = await deps.store.listTurnsAfter(scope, Math.max(0, state.turnSeq - 4), 4)
  const recent = tail.filter(t => t.record.status === 'completed' && t.record.result).map(t => ({ user: String((t.record.result as unknown as TutorResult).userMessage || ''), reply: String((t.record.result as unknown as TutorResult).reply || '') })).slice(-4)
  let pendingText = ''
  if (state.pending) {
    const asked = await deps.store.listTurnsAfter(scope, Math.max(0, state.pending.askedSeq - 1), 1)
    const r = asked.find(t => t.record.turnSeq === state.pending!.askedSeq)?.record.result as unknown as TutorResult | undefined
    pendingText = r?.pendingQuestion?.text || ''
  }
  return { recent, pendingText }
}

const deterministicResult = (seq: number, role: TurnRole, reply: string, message: string, extra: Partial<TutorResult> = {}): TutorResult => ({
  schema: 'page-study-turn', version: 1, seq, role, reply, userMessage: clip(message, 600), deterministic: true, provenance: [], externalKnowledgeUsed: false,
  graded: null, pendingQuestion: null, navigation: null, language: null, responseLanguage: null, diagnostics: { providerCalls: 0, repaired: false, contextChars: 0, ignored: [], role }, ...extra,
})

function progressReply(state: PageStudyState): string {
  const cov = coverageOf(state); const block = currentBlock(state)
  const name = block ? state.plan.materials.find(m => m.materialId === block.materialId)?.name : ''
  return block ? `Vas por "${name}", páginas ${block.start}–${block.end} (bloque ${block.index + 1} de ${state.plan.blocks.length}). Llevas ${cov.plan.pagesDone} de ${cov.plan.pagesTotal} páginas completadas y ${cov.concepts.checked} conceptos comprobados.` : 'Ya terminaste todo el plan de estudio.'
}

export async function runTutorTurn(deps: TutorDeps, input: TutorInput): Promise<TutorTurnOutcome> {
  const message = String(input.message ?? '').trim().slice(0, 2000)
  const isStartSlot = input.slot.endsWith(':start')
  if (!isStartSlot && !message) throw new PageStudyError('PAGE_STUDY_EMPTY_MESSAGE')
  const lang = responseLanguage(input.languageOverride)
  const requestHash = sha256({ slot: input.slot, message: isStartSlot ? '' : message, lang: lang ?? '' })

  const outcome: TurnOutcome = await runPageStudyTurn(deps, {
    userId: input.userId, planId: input.planId, slot: input.slot, requestHash, expectedSeq: input.expectedSeq,
    generate: async ({ state, authority, seq }) => {
      const block = currentBlock(state)!
      const deterministic = isStartSlot ? { role: null } as ReturnType<typeof classifyDeterministic> : classifyDeterministic(message)

      // ── deterministic turns: zero provider calls, and no Enjoyer/source reads either ────────────────────────────
      if (deterministic.role === 'admin') return { result: deterministicResult(seq, 'admin', progressReply(state), message) as unknown as Record<string, unknown>, ops: [] }
      if (deterministic.command === 'force_block') {
        const next = state.plan.blocks[block.index + 1]
        const where = next ? (next.materialId !== block.materialId ? `Pasamos a "${state.plan.materials.find(m => m.materialId === next.materialId)?.name}".` : `Seguimos con las páginas ${next.start}–${next.end}.`) : 'Con esto terminas el plan.'
        return { result: deterministicResult(seq, 'command', `Listo, cerramos este bloque. ${where}`, message) as unknown as Record<string, unknown>, ops: [{ op: 'complete', blockKey: block.blockKey, forced: true }] }
      }
      if (deterministic.role === 'navigate' && !authority.allowedPages.includes(deterministic.page!)) {
        return { result: deterministicResult(seq, 'navigate', `La página ${deterministic.page} todavía no está disponible en este punto del estudio. Puedes volver a cualquier página que ya viste o a las de este bloque (${block.start}–${block.end}).`, message) as unknown as Record<string, unknown>, ops: [] }
      }

      // ── resolve authorized context (storage reads only) ─────────────────────────────────────────────────────────
      let ctx = await resolveTutorContext(state, deps.context, input.userId)
      if (deps.contextTransform) ctx = deps.contextTransform(ctx)
      const { recent, pendingText } = await recentWindow(deps, input.userId, state)

      if (isStartSlot && ctx.units.length === 0) {           // nothing teachable in this block: skip it without a provider
        const d = deriveTurn({ state, seq, isStart: true, message: '', deterministic, markers: parseTutorMarkers(''), units: ctx.units, deferred: ctx.grounding.deferred, handleToUnit: ctx.handleToUnit, cardHandles: new Map(), chunk: [] })
        return { result: deterministicResult(seq, 'start', 'No hay contenido nuevo para estudiar en estas páginas, así que seguimos.', '') as unknown as Record<string, unknown>, ops: d.ops }
      }
      const prompt = buildTutorPrompt({ state, ctx, message, role: null, deterministic, isStart: isStartSlot, recent, pendingText, responseLanguage: lang })
      const violations = inspectTutorPrompt(prompt, ctx)
      if (violations.length) throw new PageStudyError('PAGE_STUDY_UNAUTHORIZED_CONTEXT', state)   // ← fail closed: the provider is never reached

      // ── ONE validated provider call (real pipeline: bounded single repair) ─────────────────────────────────────
      let calls = 0
      const strikes = { role: 0 }
      const transport: NonNullable<LegacyJsonGenerationInput<unknown>['provider']> = async params => { calls++; return (deps.provider || alai)(params) }
      const parsed = await generateValidatedLegacyJson<{ answer: string }>({
        taskType: 'explanation', prompt, temperature: 0.3, maxTokens: 1500, forceJsonTransport: true, failurePath: 'single_repair', provider: transport,
        normalize: raw => ({ answer: String((raw as { answer?: unknown })?.answer ?? '') }),
        validate: value => validateTutorOutput(value, { strikes }), telemetryContext: { route: 'page-study-turn' },
      })
      const markers = parseTutorMarkers(parsed.answer)
      // The model asked the check the server requested but forgot the marker: the SERVER adopts it (its handles, never model-chosen) so the question is durable and gradable.
      const move = suggestMove(state, ctx)
      // The model taught the suggested chunk but forgot [[T]]: the server credits only the chunk units whose own label the reply demonstrably covers (never blind).
      if (!markers.taught.length && markers.invalid.length === 0 && (isStartSlot || move.move === 'TEACH') && (markers.role === 'chat' || markers.role === undefined || deterministic.command === 'continue') && !markers.external && !state.pending && markers.body.length >= 160) {
        const echoed = ctx.chunk.filter(handle => { const unit = ctx.units.find(u => u.unitRef === ctx.handleToUnit.get(handle)); return unit ? labelEchoed(markers.body, unit.label) : false })
        if (echoed.length) markers.taught = echoed
      }
      const asking = move.move === 'ASK' || move.move === 'BLOCK_REVIEW' || move.move === 'RETEST' || move.move === 'RECALL'
      if (asking && !markers.ask && !state.pending && move.handles.length && /[?？]\s*$/.test(markers.body.trim()) && !PERMISSION_QUESTION.test(markers.body.slice(-240))) markers.ask = { kind: 'open', handles: [...move.handles] }
      if (state.pending && markers.role === 'answer' && (markers.verdict === 'partial' || markers.verdict === 'incorrect') && !markers.ask
        && /[?？]\s*$/.test(markers.body.trim()) && !PERMISSION_QUESTION.test(markers.body.slice(-240))) {
        const pendingKind = (ASK_KINDS as readonly string[]).includes(state.pending.format) ? state.pending.format as AskKind : 'open'
        markers.ask = { kind: pendingKind, handles: [] } // deriveTurn pins these targets to the server-held pending question
      }
      const otherHandles = new Map<string, string>([...ctx.cardHandles, ...ctx.taughtHandles])
      const derived = deriveTurn({ state, seq, isStart: isStartSlot, message, deterministic, markers, units: ctx.units, deferred: ctx.grounding.deferred, handleToUnit: ctx.handleToUnit, cardHandles: otherHandles, chunk: ctx.chunk })
      if (!markers.body) throw new PageStudyError('PAGE_STUDY_EMPTY_REPLY', state)

      // provenance is attached by the SERVER from grounded data (never model-authored pages)
      const provenance: TutorResult['provenance'] = []
      const seen = new Set<string>()
      for (const h of [...markers.sources, ...markers.taught, ...(markers.ask?.handles ?? [])]) {
        const ref = ctx.handleToUnit.get(h) ?? otherHandles.get(h)
        if (!ref || seen.has(ref)) continue
        seen.add(ref)
        const grounded = ctx.units.find(u => u.unitRef === ref); const concept = state.concepts[ref]
        const card = h.startsWith('R')
        if (grounded) provenance.push({ materialId: grounded.materialId, pages: grounded.pages, kind: grounded.klass })
        else if (concept) provenance.push({ materialId: concept.materialId, pages: concept.pages, kind: card ? 'RECALL' : concept.taughtClass })
      }
      const askText = derived.askedRef ? (extractAskedQuestion(markers.body) || clip(markers.body.slice(-300), 300)) : ''
      const navigation = deterministic.role === 'navigate' ? { materialId: block.materialId, page: deterministic.page! } : null
      const result: TutorResult = {
        schema: 'page-study-turn', version: 1, seq, role: derived.role, reply: markers.body, userMessage: clip(isStartSlot ? '' : message, 600), deterministic: false,
        provenance, externalKnowledgeUsed: derived.externalKnowledgeUsed, graded: derived.graded,
        pendingQuestion: derived.askedRef ? { ref: derived.askedRef, kind: markers.ask?.kind ?? 'open', text: askText } : null,
        navigation, language: ctx.language, responseLanguage: lang ?? null,
        diagnostics: { providerCalls: calls, repaired: calls > 1, contextChars: prompt.length, ignored: [...derived.ignored, ...markers.invalid.map(m => `invalid_marker:${m}`)], role: derived.role },
      }
      return { result: result as unknown as Record<string, unknown>, ops: derived.ops as StateOp[] }
    },
  })
  return { turn: outcome.result as unknown as TutorResult, view: buildPageStudyView(outcome.state), replayed: outcome.replayed }
}

export { resolveBlockAuthority, applyDelta }
