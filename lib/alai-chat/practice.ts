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

/**
 * Next-question candidates in the material's own teaching order (Enjoyer `sourceOrder` follows how the material builds
 * ideas, so foundations and prerequisites come before what depends on them), skipping trivial items while enough
 * important ones remain, interleaved across materials; `rotation` (questions asked so far) rotates which material leads.
 * Nothing here is subject-specific.
 */
export function pickPracticeCandidates(context: ChatEnjoyerContext, coveredIds: readonly string[], count: number = PRACTICE_LIMITS.candidates, rotation = 0): ChatEnjoyerTarget[] {
  const covered = new Set(coveredIds)
  const inOrder = (list: ChatEnjoyerTarget[]) => [...list].sort((a, b) => a.sourceOrder - b.sourceOrder || b.importance - a.importance || a.id.localeCompare(b.id))
  const fresh = context.targets.filter(target => !covered.has(target.id))
  const pool = fresh.length ? fresh : context.targets // everything practiced → start another pass
  const byMaterial = new Map<string, ChatEnjoyerTarget[]>()
  for (const target of pool) byMaterial.set(target.materialId, [...(byMaterial.get(target.materialId) || []), target])
  // Per material (never globally, so a lower-importance material is not starved): skip trivial items while enough important ones remain.
  for (const [materialId, list] of byMaterial) {
    const sorted = list.map(target => target.importance).sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const meaningful = list.filter(target => target.importance >= median)
    byMaterial.set(materialId, inOrder(meaningful.length >= Math.min(count, list.length) ? meaningful : list))
  }
  const all = [...byMaterial.values()]
  const lead = all.length ? Math.abs(Math.floor(rotation)) % all.length : 0
  const lanes = [...all.slice(lead), ...all.slice(0, lead)]
  const picked: ChatEnjoyerTarget[] = []
  for (let round = 0; picked.length < count && lanes.some(lane => lane[round]); round++) {
    for (const lane of lanes) if (lane[round] && picked.length < count) picked.push(lane[round])
  }
  return picked
}

export type PracticeOperation = 'recall' | 'explain' | 'connect' | 'apply' | 'reason' | 'compare' | 'calculate' | 'order'

/** The cognitive demand suggested for the NEXT question: driven by the target's own kind, then a rotating ladder so questions do not all read "what is X?". */
export function suggestPracticeOperation(target: Pick<ChatEnjoyerTarget, 'kind' | 'content' | 'difficulty'> | undefined, askedCount: number): PracticeOperation {
  const kind = String(target?.kind || '').toLowerCase()
  if (/formula|equation|ecuaci|calcul/.test(kind) || (/[=]/.test(target?.content || '') && /\d/.test(target?.content || '') && askedCount % 2 === 1)) return 'calculate'
  if (/process|procedure|step|proceso|procedimiento|timeline|cronolog/.test(kind)) return 'order'
  if (/compar|contrast|difference/.test(kind)) return 'compare'
  if (/cause|effect|consequence|causa|efecto|consecuen/.test(kind)) return 'reason'
  const ladder: PracticeOperation[] = String(target?.difficulty || '') === 'advanced'
    ? ['explain', 'apply', 'reason', 'connect', 'explain']
    : ['recall', 'explain', 'connect', 'apply', 'reason']
  return ladder[Math.max(0, askedCount) % ladder.length]
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
export function buildPracticeDirective(params: {
  start: boolean; lastQuestion: string; answer: string; asked: readonly string[]; candidateIds?: readonly string[]; currentIds?: readonly string[]
  attempts?: number; revealed?: boolean; operation?: PracticeOperation
}): string {
  const normalized = normalizePracticeNotation(params.answer)
  const asked = params.asked.length ? params.asked.slice(-6).map((q, i) => `${i + 1}. ${q}`).join('\n') : '(ninguna todavía)'
  const attempts = params.attempts ?? 0
  const common = `MODO RESPONDER — TUTORÍA ORAL ACTIVA (tiene prioridad sobre "resuelve la petición actual").
Eres un tutor excelente en una conversación natural: TÚ preguntas y el estudiante responde. La "PREGUNTA ACTUAL" de abajo NO es una pregunta para ti.
FUENTES: basa las preguntas y la evaluación en los bloques ENJOYER autorizados; si no hay ninguno, usa solo el tema/materia indicados. No agregues hechos externos ni contenido fuera del temario y no uses material que no esté en los bloques. Este anclaje es INTERNO: jamás le recuerdes al estudiante que existe un material o documento.
TONO Y ESTILO (obligatorio):
- Prohibido usar fórmulas como "según el material", "basándote en el material", "de acuerdo con el documento", "el material que hemos revisado", "para nuestra práctica", "es un placer", "necesitamos basarnos en". Formula las preguntas directamente.
- No abras con elogios exagerados ("¡Excelente!", "¡Fantástico!", "¡Muy bien!", "has captado perfectamente"). Feedback breve y variado: una palabra o frase corta cuando es correcto; elogio solo si aporta algo.
- Suena como un tutor real, no como una app infantil ni un formulario. Sin listas de calificación, sin puntajes, sin sermones.
- Si la respuesta es un disparate, una broma o no tiene relación, tómalo con naturalidad: no moralices ni regañes; di con ligereza que eso no demuestra el concepto, da una pista útil y devuélvelo al concepto (sigue el tono del estudiante, sin exagerar).
Formula UNA sola pregunta por turno, clara y respondible en pocas líneas, y termina siempre con ella. La pregunta NO debe contener ni insinuar la respuesta: no enumeres las opciones ni adelantes el giro clave (p. ej. "además de X" ya regala la mitad); pregunta de forma abierta.
VARIEDAD: no todas las preguntas deben ser "¿qué es X?". Alterna la demanda cognitiva (recordar, explicar con tus palabras, comparar, conectar ideas, aplicar a un caso, razonar con evidencia, ordenar un proceso, calcular) SOLO cuando el bloque lo respalda. OPERACIÓN SUGERIDA PARA LA PRÓXIMA PREGUNTA: ${params.operation || 'explain'} (si el bloque no la respalda, elige la más natural).
Nunca repitas ni reformules superficialmente una pregunta ya hecha. PREGUNTAS YA HECHAS:
${asked}
CANDIDATOS PARA LA PRÓXIMA PREGUNTA (aún no practicados, en el orden didáctico del material; sirven para avanzar de forma progresiva y rotar materiales): ${params.candidateIds?.length ? params.candidateIds.join(', ') : '(usa el tema)'}.
Basa la nueva pregunta en el primer candidato, salvo que la conversación pida simplificar o conectar con un concepto ya visto (usa entonces el bloque relacionado).
Reporta en usedTargetIds los IDs recibidos que usaste (evaluación y pregunta). No inventes afirmaciones del material para calificar. No imprimas IDs ni páginas en answer. Deja suggestedFollowups vacío.
IDIOMA: escribe TODO (introducción, evaluación, pistas y pregunta) en el idioma fijado por ACADEMIC LANGUAGE AUTHORITY. Estas instrucciones, el disparador interno "Iniciar práctica" y el historial están en español solo por implementación y NO determinan el idioma de salida; solo una petición explícita de idioma en el mensaje ACTUAL del estudiante lo cambia, solo para esta respuesta.`
  if (params.start) {
    return `${common}
INICIO: es la primera pregunta del hilo. Empieza directo: como máximo una frase corta de arranque (por ejemplo, que empiezas con algo sencillo) y luego la pregunta, sobre un concepto fundacional del primer candidato. Sin saludo largo, sin "hola, es un placer", sin mencionar material ni práctica.`
  }
  const tier = attempts <= 0
    ? 'INTENTO 1 FALLIDO → reconoce cualquier fragmento correcto, identifica el error o concepto que falta y da UNA pista pequeña que oriente el razonamiento SIN revelar la respuesta esperada. Pide que lo intente de nuevo (pregunta sobre EL MISMO CONCEPTO).'
    : attempts === 1
      ? 'INTENTO 2 FALLIDO → da una pista más fuerte y acota el problema (por ejemplo, señala la categoría o el criterio que falta o contrasta con un caso), evitando volcar la respuesta completa si puedes. Pregunta de nuevo sobre EL MISMO CONCEPTO.'
      : 'INTENTO 3+ FALLIDO → ahora SÍ enseña: escribe la explicación clara de la idea central en 2-3 frases (una pista o una pregunta guiada NO cuenta como explicación). Después NO pidas repetir ni enumerar lo que acabas de explicar: haz una pregunta de TRANSFERENCIA sobre EL MISMO CONCEPTO que ponga a prueba la comprensión: predecir o aplicar a un caso nuevo concreto, elegir cuál de dos situaciones cumple la idea, distinguir entre dos casos o explicar el mecanismo (por qué ocurre). PROHIBIDO preguntar por la importancia o utilidad de saberlo ("¿por qué es importante conocer…?") o pedir que lo parafrasee sin más.'
  const revealed = params.revealed
    ? '\nYA EXPLICASTE la respuesta de este concepto. PROHIBIDO pedir repetirla, enumerarla o completarla tal cual (nada de "menciona/enumera/cuáles son…"). Si el estudiante acierta la comprobación, avanza; si falla, da un ángulo distinto, breve, y una pregunta de reconocimiento o aplicación más sencilla.'
    : ''
  return `${common}
ÚLTIMA PREGUNTA QUE HICISTE: ${JSON.stringify(params.lastQuestion || '(no disponible)')}
RESPUESTA DEL ESTUDIANTE (normalizada solo en notación: sp³ = sp3 = sp 3): ${JSON.stringify(normalized)}
CONCEPTO ACTUAL (IDs del bloque de la pregunta pendiente): ${params.currentIds?.length ? params.currentIds.join(', ') : '(no disponible)'}. Intentos no correctos en este concepto: ${attempts}.
EVALÚA por significado, no por texto exacto. Si la respuesta demuestra la idea central con sus propias palabras, es correcta aunque no repita la redacción del material ni enumere cada frase canónica. Acepta variantes de notación, sinónimos y equivalentes correctos.
El estudiante SOLO avanza cuando demuestra comprensión. Empieza el texto de "answer" con EXACTAMENTE un marcador seguido de un espacio — [[V:correct]] | [[V:partial]] | [[V:incorrect]] | [[V:question]] (en el inicio: [[V:start]]). El servidor elimina el marcador; el estudiante nunca lo ve. Sin marcador la respuesta se rechaza.
- correct: confirma en pocas palabras, refuerza solo si aporta y AVANZA con una pregunta NUEVA basada en el primer CANDIDATO.
- partial: NO abandones el concepto. Di qué estuvo bien y qué falta con una pista, y pide que lo complete (o pregunta de forma dirigida sobre EL MISMO CONCEPTO).
- incorrect: sigue en EL MISMO CONCEPTO ACTUAL, sin pasar a otro. ${tier}
- question: el estudiante preguntó o pidió ayuda en vez de responder: respóndele brevemente y vuelve a la pregunta pendiente (o una más simple del mismo concepto).${revealed}
REGLAS DE COHERENCIA (el servidor las verifica): si practiceVerdict NO es "correct", tu pregunta debe ser sobre el CONCEPTO ACTUAL y usedTargetIds debe incluir sus IDs y NINGÚN ID de los CANDIDATOS. Si es "correct", la pregunta nueva debe basarse en el primer CANDIDATO y usedTargetIds debe incluir su ID.
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
}): Pick<ChatConversationContext, 'practiceAsked' | 'practiceTargetIds' | 'practiceCurrentTargetIds' | 'practiceAttempts' | 'practiceQuestionRef' | 'practiceLastVerdict' | 'practiceRevealed'> {
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
    // Once the concept was explained (third failure) the next check must test understanding, never repetition.
    ...(!advance && ((previous?.practiceRevealed === true) || ((verdict === 'partial' || verdict === 'incorrect') && (previous?.practiceAttempts || 0) + 1 >= 3)) ? { practiceRevealed: true } : {}),
  }
}

const VERDICT_TAG = /^\s*\[\[V:(start|correct|partial|incorrect|question)\]\]\s*/i

/** Responder verdict travels as an inline marker at the start of `answer`; it is removed before anything is validated, stored or shown. */
export function splitPracticeVerdictTag(answer: string): { verdict: string | null; answer: string } {
  const match = VERDICT_TAG.exec(String(answer || ''))
  return match ? { verdict: match[1].toLowerCase(), answer: String(answer).slice(match[0].length).trim() } : { verdict: null, answer: String(answer || '') }
}

// ── style + hint-budget checks (deterministic backstops for what the directive asks) ─────────────
const BOILERPLATE = [
  /\b(?:seg[uú]n|de acuerdo con|bas[aá]ndote en|basado en|conforme a|con base en)\s+(?:el|la|tu|nuestro|nuestra)?\s*(?:material|documento|pdf|texto)\b/i,
  /\b(?:el|nuestro)\s+material\s+(?:que\s+)?(?:hemos\s+)?revisad/i,
  /\bel material\s+(?:nos\s+)?(?:dice|menciona|describe|indica|plantea|se[ñn]ala|explica|establece)\b|\ben el material\b|\bthe material (?:says|mentions|describes|states)\b/i,
  /\bes un placer\b|\bnuestra pr[aá]ctica\b|\bnecesitamos basarnos\b/i,
  /\b(?:according to|based on|as per)\s+(?:the|your|our)\s+(?:material|document|pdf|text)\b|\bit(?:'|’)?s a pleasure\b|\bour practice\b/i,
]
const OVER_PRAISE = /^\s*[¡!]*\s*(?:excelente|fant[aá]stic[oa]|perfect[oa]|magn[ií]fic[oa]|incre[ií]ble|genial|excellent|fantastic|perfect|awesome|amazing)\b|\bhas (?:captado|descrito|explicado|entendido|comprendido) (?:perfectamente|muy bien|la idea)\b|\bgreat job\b|\bexcelente trabajo\b/i

/** Boilerplate / over-praise the tutor must not use. Returns [] when the text reads naturally. */
export function findPracticeStyleIssues(answer: string): string[] {
  const text = String(answer || '')
  const issues: string[] = []
  if (BOILERPLATE.some(pattern => pattern.test(text))) issues.push('practice_boilerplate:ask_directly_without_reminding_the_student_of_a_material')
  if (OVER_PRAISE.test(text)) issues.push('practice_over_praise:use_brief_natural_feedback')
  if (/por qu[eé] (?:es|ser[ií]a) importante|para qu[eé] sirve (?:saber|conocer)|why is it important (?:to|that)/i.test(extractAskedQuestion(text))) issues.push('practice_meta_question:test_the_concept_not_why_it_matters')
  return issues
}

const REPEAT_CUES = /\b(?:menciona\w*|enumera\w*|list\w*|nombra\w*|repit\w*|cu[aá]les son|dime (?:los|las|todos)|name|mention|enumerate|state (?:the|all)|what are the)\b/gi
const STOP = new Set(['para','como','esos','esas','otros','otras','entre','sobre','desde','hasta','pero','porque','which','their','there','these','those','about','other'])
const tokens = (text: string) => (String(text || '').toLowerCase().normalize('NFKC').match(/\p{L}{4,}/gu) || []).filter(word => !STOP.has(word))

/** True when the closing question only asks the student to repeat/enumerate what the same reply just explained. */
export function isEchoQuestion(answer: string): boolean {
  const question = extractAskedQuestion(answer)
  if (!question) return false
  const feedback = String(answer).slice(0, Math.max(0, String(answer).lastIndexOf(question.replace(/^¿/, '')) )).trim() || String(answer)
  if (!question.match(REPEAT_CUES)) return false
  const asked = tokens(question.replace(REPEAT_CUES, ' ').replace(/\bpodr[ií]as\b|\bpuedes\b|\bcould\b|\bcan\b/gi, ' '))
  if (!asked.length) return false
  const known = new Set(tokens(feedback))
  return asked.filter(word => known.has(word)).length / asked.length >= 0.4
}

/** The closing question of a reply and the feedback that precedes it. */
export function splitFeedbackAndQuestion(answer: string): { feedback: string; question: string } {
  const question = extractAskedQuestion(answer)
  if (!question) return { feedback: String(answer || '').trim(), question: '' }
  const index = String(answer).lastIndexOf(question.replace(/^¿/, ''))
  return { feedback: index > 0 ? String(answer).slice(0, index).trim() : '', question }
}

/** A closing question that already hands over the key twist ("besides X…") instead of asking openly. */
export function questionLeaksAnswer(answer: string): boolean {
  return /\b(?:adem[aá]s de|aparte de|m[aá]s all[aá] de|otros? (?:aspectos?|factores?) (?:adem[aá]s|aparte)|besides|other than|apart from|in addition to)\b/i.test(splitFeedbackAndQuestion(answer).question)
}

/** The third miss must actually teach: a real explanation precedes the transfer question. */
export function hasSubstantialExplanation(answer: string): boolean {
  return splitFeedbackAndQuestion(answer).feedback.replace(/\s+/g, ' ').length >= 160
}
