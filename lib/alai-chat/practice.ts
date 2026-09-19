import type { ChatConversationContext, ChatIntent } from './contracts'
import type { ChatEnjoyerContext, ChatEnjoyerTarget, ChatRetrievalResult } from '../materialBrain/chatEnjoyerContext'

/**
 * Interaction mode is WHO initiates (pedagogical behavior). It is orthogonal to
 * sourcePolicy (WHERE knowledge may come from) and never mutates it.
 * 'ask'    → student asks ALAI (existing behavior, unchanged).
 * 'answer' → ALAI asks the student, evaluates the reply, then asks the next question.
 */
export type InteractionMode = 'ask' | 'answer'

/** Sentinel the client sends (hidden) when the student switches to Responder. */
export const PRACTICE_START_MESSAGE = 'Iniciar práctica'
export const PRACTICE_LIMITS = { asked: 12, askedChars: 160, targetIds: 60, candidates: 4, mergedTargets: 12 } as const

/** Absent → 'ask'. Anything present but unknown is invalid (never silently downgraded). */
export function readInteractionMode(value: unknown): InteractionMode | null {
  if (value === undefined || value === null) return 'ask'
  return value === 'ask' || value === 'answer' ? value : null
}

const SUPERSCRIPTS: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' }
const SUBSCRIPTS: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' }

/** Notation-only normalization (sp³ = sp3 = sp 3, minus sign variants, ^). Never semantic. */
export function normalizePracticeNotation(text: string): string {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]/g, ch => SUPERSCRIPTS[ch] ?? ch)
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => SUBSCRIPTS[ch] ?? ch)
    .replace(/[−–—]/g, '-')
    .replace(/\^\s*/g, '')
    .replace(/\b(s\s*p)\s*([123])\b/gi, (_m, _p, n) => `sp${n}`)
    .replace(/\bsp\s+([123])\b/gi, 'sp$1')
    .replace(/\s+/g, ' ')
    .trim()
}

const QUESTION_SENTENCE = /[^.!?¿？\n]*[?？]/g

/** The last question ALAI asked, extracted deterministically from its own prose. */
export function extractAskedQuestion(answer: string): string {
  const matches = String(answer || '').replace(/\s+/g, ' ').match(QUESTION_SENTENCE)
  const last = matches?.[matches.length - 1]?.replace(/^[\s¿]+/, '').trim()
  return last ? `¿${last}`.slice(0, PRACTICE_LIMITS.askedChars) : ''
}

export function appendAsked(previous: readonly string[] | undefined, question: string): string[] {
  const list = [...(previous || [])]
  if (question && list[list.length - 1] !== question) list.push(question)
  return list.slice(-PRACTICE_LIMITS.asked)
}

export function lastAssistantContent(history: readonly { role: string; content: string }[]): string {
  for (let index = history.length - 1; index >= 0; index--) if (history[index].role === 'assistant') return history[index].content
  return ''
}

export function practiceIntent(explicitPolicy?: ChatIntent['explicitPolicy']): ChatIntent {
  return { shape: 'prose', followup: false, materialInspection: false, ...(explicitPolicy ? { explicitPolicy } : {}) }
}

/** Importance-ordered, material-interleaved candidate targets that were not practiced yet; `rotation` (questions asked so far) rotates which material leads. */
export function pickPracticeCandidates(context: ChatEnjoyerContext, coveredIds: readonly string[], count: number = PRACTICE_LIMITS.candidates, rotation = 0): ChatEnjoyerTarget[] {
  const covered = new Set(coveredIds)
  const ordered = [...context.targets].sort((a, b) => b.importance - a.importance || a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id))
  const fresh = ordered.filter(target => !covered.has(target.id))
  const pool = fresh.length ? fresh : ordered // everything practiced → start another pass
  const byMaterial = new Map<string, ChatEnjoyerTarget[]>()
  for (const target of pool) byMaterial.set(target.materialId, [...(byMaterial.get(target.materialId) || []), target])
  const all = [...byMaterial.values()]
  const lead = all.length ? Math.abs(Math.floor(rotation)) % all.length : 0
  const lanes = [...all.slice(lead), ...all.slice(0, lead)] // the lead material rotates each question so no material is drilled first
  const picked: ChatEnjoyerTarget[] = []
  for (let round = 0; picked.length < count && lanes.some(lane => lane[round]); round++) {
    for (const lane of lanes) if (lane[round] && picked.length < count) picked.push(lane[round])
  }
  return picked
}

/** Union of retrieval results, bounded, order-preserving (evaluation evidence first). */
export function mergePracticeRetrieval(primary: ChatRetrievalResult | null, candidates: ChatEnjoyerTarget[], context: ChatEnjoyerContext, sourcePolicy: ChatRetrievalResult['mode']): ChatRetrievalResult {
  const seen = new Set<string>()
  const targets: ChatEnjoyerTarget[] = []
  for (const target of [...(primary?.targets || []), ...candidates]) {
    if (seen.has(target.id) || targets.length >= PRACTICE_LIMITS.mergedTargets) continue
    seen.add(target.id); targets.push(target)
  }
  const bySource = new Map(context.targets.map(target => [target.sourceItemId, target.id]))
  const relations = context.relations.filter(relation => {
    const from = bySource.get(relation.fromSourceItemId), to = bySource.get(relation.toSourceItemId)
    return from && to && seen.has(from) && seen.has(to)
  }).slice(0, 12)
  return {
    materialLanguage: context.materialLanguage, targets, relations,
    pages: [...new Set(targets.flatMap(target => target.pages))].sort((a, b) => a - b),
    materials: [...new Set(targets.map(target => target.materialId).filter(Boolean))],
    mode: sourcePolicy,
    materialRetrievalOutcome: sourcePolicy === 'GENERAL_ONLY' ? 'not_checked' : targets.length ? 'supported' : 'no_relevant_target',
    evidence: targets.flatMap(target => target.materialId ? [{ targetId: target.id, materialId: target.materialId, pages: target.pages }] : []),
    diagnostics: primary?.diagnostics || { explicitPages: [], exactWordingIntent: false, isFollowup: false, targetMatches: targets.length, retrievalMs: 0 },
  }
}

export function buildPracticeRetrievalQuery(params: { start: boolean; lastQuestion: string; answer: string }): string {
  return params.start ? '' : `${params.lastQuestion} ${normalizePracticeNotation(params.answer)}`.trim()
}

/** Prompt directive. Language authority is injected separately (academicLanguageInstruction). */
export function buildPracticeDirective(params: { start: boolean; lastQuestion: string; answer: string; asked: readonly string[]; candidateIds?: readonly string[]; currentIds?: readonly string[]; attempts?: number }): string {
  const normalized = normalizePracticeNotation(params.answer)
  const asked = params.asked.length ? params.asked.map((q, i) => `${i + 1}. ${q}`).join('\n') : '(ninguna todavía)'
  const common = `MODO RESPONDER — PRÁCTICA ORAL ACTIVA (tiene prioridad sobre "resuelve la petición actual").
Tú eres el profesor: TÚ preguntas y el estudiante responde. La "PREGUNTA ACTUAL" de abajo NO es una pregunta para ti.
Base las preguntas en los bloques ENJOYER autorizados (material seleccionado); si no hay ninguno, usa solo el tema/materia indicados. No conviertas una sesión de material en trivia irrestricta ni uses material que no esté en los bloques.
Formula UNA sola pregunta por turno, clara y respondible en pocas líneas: definición, explicación, comparación, proceso, causa/efecto, cronología, fórmula, cálculo o relación entre conceptos, según lo que el material contenga. Termina siempre con esa pregunta.
Nunca repitas ni reformules superficialmente una pregunta ya hecha. PREGUNTAS YA HECHAS:
${asked}
CANDIDATOS PARA LA PRÓXIMA PREGUNTA (aún no practicados, por prioridad; sirven para rotar conceptos y materiales): ${params.candidateIds?.length ? params.candidateIds.join(', ') : '(usa el tema)'}.
Basa la nueva pregunta en el primer candidato, salvo que la conversación pida simplificar o conectar con un concepto ya visto (usa entonces el bloque relacionado).
Reporta en usedTargetIds los IDs recibidos que usaste (evaluación y pregunta). Pon practiceVerdict: "start" en el inicio. No inventes afirmaciones del material para calificar. No imprimas IDs ni páginas en answer.
Mantén un tono conversacional; no uses tablas de calificación ni puntajes. Deja suggestedFollowups vacío.
IDIOMA: escribe TODO (saludo, evaluación, corrección y pregunta) en el idioma fijado por ACADEMIC LANGUAGE AUTHORITY. Estas instrucciones, el disparador interno "Iniciar práctica" y el historial están en español solo por implementación y NO determinan el idioma de salida; solo una petición explícita de idioma en el mensaje ACTUAL del estudiante lo cambia, solo para esta respuesta.`
  if (params.start) {
    return `${common}
INICIO: el estudiante abrió el hilo Responder por primera vez. No hay respuesta que evaluar. Saluda en una línea, invitando a practicar (en el idioma de autoridad), y haz la primera pregunta, fundamental y basada en los bloques ENJOYER.`
  }
  return `${common}
ÚLTIMA PREGUNTA QUE HICISTE: ${JSON.stringify(params.lastQuestion || '(no disponible)')}
RESPUESTA DEL ESTUDIANTE (normalizada solo en notación: sp³ = sp3 = sp 3): ${JSON.stringify(normalized)}
EVALÚA por significado, no por texto exacto: acepta variantes de notación, sinónimos y equivalentes matemáticos/químicos correctos.
CONCEPTO ACTUAL (IDs del bloque de la pregunta pendiente): ${params.currentIds?.length ? params.currentIds.join(', ') : '(no disponible)'}. Intentos no correctos en este concepto: ${params.attempts ?? 0}.
El estudiante SOLO avanza cuando demuestra comprensión. Clasifica y REPORTA el veredicto: empieza el texto de "answer" con EXACTAMENTE un marcador seguido de un espacio — [[V:correct]] | [[V:partial]] | [[V:incorrect]] | [[V:question]] (en el inicio: [[V:start]]). El servidor elimina el marcador; el estudiante nunca lo ve. Sin marcador la respuesta se rechaza.
- correct: confírmalo brevemente, refuerza la idea clave solo si aporta y AVANZA: haz una pregunta NUEVA basada en el primer CANDIDATO.
- partial: NO abandones el concepto. Di qué estuvo bien, qué falta y pide que lo complete/corrija, o haz una pregunta dirigida sobre EL MISMO CONCEPTO ACTUAL.
- incorrect: explica el error conceptual con el material y sigue en EL MISMO CONCEPTO ACTUAL con una pregunta más simple o reformulada. No pases a otro concepto.
- question: el estudiante hizo una pregunta o pidió ayuda en vez de responder: respóndela brevemente y vuelve a formular la MISMA pregunta pendiente (o una más simple del mismo concepto).
${(params.attempts ?? 0) >= 3 ? 'El estudiante ya falló varias veces: da ahora la explicación completa del concepto con el material y luego vuelve a comprobarlo con una pregunta distinta y más sencilla (sin avanzar de concepto).\n' : ''}REGLAS DE COHERENCIA (el servidor las verifica): si practiceVerdict NO es "correct", tu pregunta debe ser sobre el CONCEPTO ACTUAL y usedTargetIds debe incluir sus IDs y NINGÚN ID de los CANDIDATOS. Si es "correct", la pregunta nueva debe basarse en el primer CANDIDATO y usedTargetIds debe incluir su ID.
Nunca marques "correct" solo porque el estudiante respondió algo. Termina siempre con UNA pregunta.`
}


export type PracticeVerdict = 'start' | 'correct' | 'partial' | 'incorrect' | 'question'

/** An unreadable/missing verdict is NEVER treated as understanding: the caller keeps the same concept. */
export function readPracticeVerdict(value: unknown): Exclude<PracticeVerdict, 'start'> | null {
  return value === 'correct' || value === 'partial' || value === 'incorrect' || value === 'question' ? value : null
}

export const PRACTICE_START_SLOT = 'start'
export function readPracticeSlot(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.length <= 160 ? value.trim() : null
}
/** Durable identity of a practice turn = the question being answered. Restores, retries and duplicate submits share one record. */
export function practiceTurnKey(slot: string): string { return `practice:${slot}` }

/** The only place practice progress changes. Tab/mode switching never reaches it. */
export function nextPracticeState(input: {
  previous: ChatConversationContext | null; start: boolean; verdict: unknown; answer: string
  usedTargetIds: readonly string[]; candidateIds: readonly string[]; questionRef: string
}): Pick<ChatConversationContext, 'practiceAsked' | 'practiceTargetIds' | 'practiceCurrentTargetIds' | 'practiceAttempts' | 'practiceQuestionRef' | 'practiceLastVerdict'> {
  const { previous } = input
  const verdict: PracticeVerdict = input.start ? 'start' : readPracticeVerdict(input.verdict) ?? 'partial'
  const fresh = input.usedTargetIds.filter(id => input.candidateIds.includes(id)).slice(0, 3)
  const nextConcept = fresh.length ? fresh : input.candidateIds.slice(0, 1)
  const priorCurrent = previous?.practiceCurrentTargetIds || []
  const advance = verdict === 'start' || verdict === 'correct'
  const mastered = verdict === 'correct' ? [...(previous?.practiceTargetIds || []), ...priorCurrent] : previous?.practiceTargetIds || []
  return {
    practiceAsked: appendAsked(previous?.practiceAsked, extractAskedQuestion(input.answer)),
    practiceTargetIds: [...new Set(mastered)].slice(-PRACTICE_LIMITS.targetIds),
    practiceCurrentTargetIds: advance ? (nextConcept.length ? nextConcept : priorCurrent) : priorCurrent,
    practiceAttempts: advance ? 0 : (previous?.practiceAttempts || 0) + (verdict === 'question' ? 0 : 1),
    practiceQuestionRef: input.questionRef,
    practiceLastVerdict: verdict,
  }
}

const VERDICT_TAG = /^\s*\[\[V:(start|correct|partial|incorrect|question)\]\]\s*/i

/** Responder verdict travels as an inline marker at the start of `answer`; it is removed before anything is validated, stored or shown. */
export function splitPracticeVerdictTag(answer: string): { verdict: string | null; answer: string } {
  const match = VERDICT_TAG.exec(String(answer || ''))
  return match ? { verdict: match[1].toLowerCase(), answer: String(answer).slice(match[0].length).trim() } : { verdict: null, answer: String(answer || '') }
}
