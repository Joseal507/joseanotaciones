/** Shared harness: the REAL chat route + the REAL client reducers; only auth/session/store/provider are in-memory. */
import { NextRequest } from 'next/server'
import { POST, __routeDeps } from '../../app/api/alai-studyal-chat/route'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { withMaterialLanguage } from '../../lib/materialLanguage'
import { buildChatEnjoyerContext } from '../../lib/materialBrain/chatEnjoyerContext'
import type { ChatTurnStore, StoredChatTurn } from '../../lib/alai-chat/turnStore'
import {
  alaiPendingQuestionRef, alaiThreadState, beginAlaiTurn, buildAlaiTurnRequest, completeAlaiTurn, failAlaiTurn, initialAlaiState, needsPracticeStart,
  recoverInterruptedAlaiState, retryAlaiTurn, selectAlaiThread, selectedAlaiThread, withAlaiThreadState, type AlaiThread, type DurableAlaiState,
} from '../../lib/freeAlaiState'
import { PRACTICE_START_MESSAGE, PRACTICE_START_SLOT } from '../../lib/alai-chat/practice'

export const state = { providerCalls: 0, prompts: [] as string[], fail: false, tagForm: true }
export function memoryStore(): ChatTurnStore {
  const rows = new Map<string, StoredChatTurn>()
  return { async read(id) { return rows.get(id) ?? null }, async compareAndSet(id, expected, revision, record) { if ((rows.get(id)?.revision ?? null) !== expected) return false; rows.set(id, { revision, record }); return true } }
}

export function chemistry() {
  const rows: Array<[string, string, string]> = [
    ['carbon-bonds', 'Enlaces del carbono', 'El carbono tiene cuatro electrones de valencia y por eso puede formar cuatro enlaces covalentes.'],
    ['sp3', 'Hibridación sp3', 'La hibridación sp3 combina un orbital s y tres orbitales p y forma cuatro orbitales híbridos con ángulo de 109.5 grados.'],
    ['sp2', 'Hibridación sp2', 'La hibridación sp2 combina un orbital s y dos orbitales p y forma geometría trigonal plana con ángulos de 120 grados.'],
    ['sp', 'Hibridación sp', 'La hibridación sp combina un orbital s y un orbital p y forma geometría lineal con ángulos de 180 grados.'],
    ['geometry', 'Geometría molecular', 'La geometría molecular depende del número de pares de electrones alrededor del átomo central según la teoría de repulsión.'],
    ['sigma-pi', 'Enlaces sigma y pi', 'Un doble enlace contiene un enlace sigma y un enlace pi formado por orbitales p paralelos.'],
  ]
  const selection = buildSourceSelectionSnapshot(['mat-q'], { 'mat-q': [1, 2] })
  const payload = withMaterialLanguage({ blueprint: {
    sourceSelectionFingerprint: selection.fingerprint, materialIds: ['mat-q'], selectedPages: selection.selectedPages,
    topicsIndex: [{ id: 't', title: 'Química orgánica', order: 0 }],
    globalOrderedAnalysis: rows.map(([id, name, content], index) => ({ id, kind: 'concept', label: name, name, summary: content, content, importance: 90 - index, materialId: 'mat-q', pages: [index < 3 ? 1 : 2], topicId: 't', globalOrder: index, sourceSpans: [{ page: index < 3 ? 1 : 2, quote: content }] })),
    uniqueConceptsIndex: [],
  } })
  return { payload, selection }
}

/** Deterministic stand-in for the provider. It only sees the prompt the server built. */
function fakeProvider(targets: ReturnType<typeof buildChatEnjoyerContext>['targets']) {
  return async ({ prompt }: { prompt: string }) => {
    state.providerCalls++; state.prompts.push(prompt)
    if (state.fail) throw new Error('provider down')
    const ids = (label: string) => new RegExp(`${label}[^:\\n]*: ((?:chat_target:[^\\s,]+?(?:, )?)+)\\.`).exec(prompt)?.[1]?.split(', ').filter(Boolean) ?? []
    const candidates = ids('CANDIDATOS PARA LA PRÓXIMA PREGUNTA'), current = ids('CONCEPTO ACTUAL')
    const byId = (id: string) => targets.find(target => target.id === id)
    const start = prompt.includes('INICIO:')
    const student = /RESPUESTA DEL ESTUDIANTE[^\n]*?\): ("(?:[^"\\]|\\.)*")/.exec(prompt)
    const answer = student ? String(JSON.parse(student[1])) : ''
    const attempts = Number(/Intentos no correctos en este concepto: (\d+)/.exec(prompt)?.[1] ?? 0)
    const verdict = start ? 'start' : /sp3|109|correct/i.test(answer) ? 'correct' : /parcial/i.test(answer) ? 'partial' : /\?|ayuda|no s[eé]/i.test(answer) ? 'question' : 'incorrect'
    const next = verdict === 'correct' || start ? byId(candidates[0]) : byId(current[0])
    const lead = start ? 'Vamos a practicar.' : verdict === 'correct' ? 'Correcto.' : verdict === 'partial' ? 'Parcialmente correcto: falta un detalle.' : verdict === 'question' ? 'Claro, te explico brevemente.' : 'No exactamente; te lo explico.'
    const tagForm = state.tagForm && prompt.includes('MODO RESPONDER')
    const nth = verdict === 'correct' || start ? '' : ` (reformulada, intento ${attempts + 1})`
    return {
      answer: `${tagForm ? `[[V:${verdict}]] ` : ''}${lead} Ahora dime: ¿qué ocurre con ${next?.label ?? 'el tema'}${nth}?`,
      usedTargetIds: next ? [next.id] : [], usedRelationIds: [], externalKnowledgeUsed: false, suggestedFollowups: ['no debería mostrarse'], ...(tagForm ? {} : { practiceVerdict: verdict }),
    }
  }
}

export function install(payload: any, selection: ReturnType<typeof buildSourceSelectionSnapshot>, store: ChatTurnStore = memoryStore(), live = false) {
  let targets: ReturnType<typeof buildChatEnjoyerContext>['targets'] = []
  try { targets = buildChatEnjoyerContext(payload, selection).targets } catch { /* sixth-material payloads must fail closed inside the route */ }
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'u1' } }),
    getAuthoritativeFreeSession: async () => ({ id: 's1', userId: 'u1', processMode: 'free', sourceSelection: selection }),
    getMaterial: async (id: string) => ({ id }),
    lookupStudyalMaterialEnjoyer: async () => payload,
    chatTurnStore: store,
    ...(live ? {} : { generateValidatedLegacyJson: fakeProvider(targets) }),
  })
  return { store, targets }
}

export async function rawTurn(body: Record<string, unknown>) {
  const response = await POST(new NextRequest('http://localhost/api/alai-studyal-chat', { method: 'POST', body: JSON.stringify({ sessionId: 's1', ...body }) }))
  return { status: response.status, data: await response.json() as any }
}

let uidCounter = 0
const uid = () => `t${++uidCounter}`

/** Mirrors ALAIStudyALChat: a durable root with two threads, the same reducers, the same request builder. */
export class Client {
  root: DurableAlaiState
  constructor(root: DurableAlaiState = initialAlaiState()) { this.root = recoverInterruptedAlaiState(root) }
  static remount(previous: Client) { return new Client(JSON.parse(JSON.stringify(previous.root))) }
  get thread(): AlaiThread { return selectedAlaiThread(this.root) }
  view(thread: AlaiThread = this.thread) { return alaiThreadState(this.root, thread) }
  visible(thread: AlaiThread = this.thread) { return this.view(thread).messages.filter(message => !message.hidden) }
  private write(thread: AlaiThread, next: DurableAlaiState) { this.root = withAlaiThreadState(this.root, thread, next) }
  /** Same rule as the component effect: start only when the Responder thread is genuinely new. */
  async mount() { if (this.thread === 'answer' && needsPracticeStart(this.root)) await this.startPractice() }
  async switchTo(thread: AlaiThread) {
    this.root = selectAlaiThread(this.root, thread)
    await this.mount()
  }
  private async run(thread: AlaiThread, turnId: string, attempt: number, extra: Record<string, unknown> = {}) {
    const view = this.view(thread)
    const response = await rawTurn(buildAlaiTurnRequest(view, { sessionId: 's1', turnId, attempt, materia: 'Química', tema: 'Química orgánica', ...extra }) as Record<string, unknown>)
    if (response.status !== 200 || !response.data.success) { this.write(thread, failAlaiTurn(this.view(thread), turnId, attempt, response.data.error || 'fallo')); return response }
    const data = response.data
    this.write(thread, completeAlaiTurn(this.view(thread), turnId, attempt, {
      id: `${turnId}:assistant`, turnId, role: 'assistant', content: data.answer, conversationContext: data.conversationContext, evidence: data.evidence,
      usedTargetIds: data.usedTargetIds, provenance: data.provenance, suggestedFollowups: data.suggestedFollowups, materialIds: data.materialIds,
    }))
    return response
  }
  async startPractice() {
    if (!needsPracticeStart(this.root)) return null
    const turnId = uid()
    this.write('answer', beginAlaiTurn(this.view('answer'), { turnId, userMessageId: `${turnId}:user`, content: PRACTICE_START_MESSAGE, timestamp: 1, interactionMode: 'answer', practiceStart: true, practiceSlot: PRACTICE_START_SLOT, hidden: true }))
    return this.run('answer', turnId, 1)
  }
  /** Sends on the visible thread exactly as the component would. Returns null when the UI would refuse. */
  async send(text: string) {
    const thread = this.thread, view = this.view()
    if (view.currentTurn?.status === 'sending') return null
    const slot = thread === 'answer' ? alaiPendingQuestionRef(view) : null
    if (thread === 'answer' && (!slot || view.currentTurn?.status === 'recoverable')) return null
    const turnId = uid()
    this.write(thread, beginAlaiTurn(view, { turnId, userMessageId: `${turnId}:user`, content: text, timestamp: 1, interactionMode: thread, ...(slot ? { practiceSlot: slot } : {}) }))
    return this.run(thread, turnId, 1)
  }
  async retry() {
    const thread = this.thread, turn = this.view().currentTurn
    if (!turn || turn.status !== 'recoverable') return null
    this.write(thread, retryAlaiTurn(this.view(), turn.id))
    return this.run(thread, turn.id, this.view().currentTurn!.attempt)
  }
  lastAssistant(thread: AlaiThread = this.thread) { return [...this.view(thread).messages].reverse().find(message => message.role === 'assistant') }
}
