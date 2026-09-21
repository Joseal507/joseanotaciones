import { isAdministrativeQuery } from '../adaptive/evaluation/chatAssistanceClassifier'

/**
 * Turn interpretation for Page Study. Order of authority:
 *   1. deterministic rules for obvious commands / navigation / progress questions (no provider needed to classify);
 *   2. otherwise the role the tutor reports in the SAME provider call via a compact leading marker;
 *   3. anything missing or invalid falls back to 'question' — which changes no evidence and consumes no pending question.
 */
export type TurnRole = 'start' | 'answer' | 'question' | 'clarify' | 'navigate' | 'command' | 'chat' | 'admin'
export type CommandKind = 'continue' | 'skip_question' | 'force_block'
export interface DeterministicIntent { role: 'navigate' | 'command' | 'admin' | null; command?: CommandKind; page?: number }

const NAVIGATE = /\b(?:vuelve|volver|volvamos|regresa|regresemos|regresar|ll[eé]vame|ve|ir|vamos|go\s+back|go\s+to|back\s+to)\b[^.?!\n]{0,24}?\b(?:p[aá]g(?:ina)?\.?|page)\s*(\d{1,3})\b/i
const FORCE_BLOCK = /(?:^|\b)(?:pasemos|avancemos|vamos|saltemos|pasa)\s+(?:ya\s+)?(?:al\s+)?(?:siguiente|pr[oó]ximo)\s+bloque\b|\bsaltar\s+(?:este\s+)?bloque\b|\bterminemos\s+(?:ya\s+)?este\s+bloque\b|\bskip\s+(?:this\s+)?block\b/i
const SKIP_QUESTION = /(?:saltemos|salta|omite|olvida)\s+(?:esta\s+)?pregunta\b|\bno\s+s[eé],?\s+(?:sigamos|avancemos|pasemos)\b|\bprefiero\s+seguir\b|\bskip\s+(?:this\s+)?question\b/i
const CONTINUE = /^\s*(?:ok[,.]?\s*)?(?:sigue|sigamos|contin[uú]a|continuemos|siguiente|adelante|dale|listo,?\s*sigue|next|continue|go\s+on|keep\s+going|继续|下一个)\s*[.!¡]*\s*$/i
const ADMIN = /\bcu[aá]nt[oa]s?\s+(?:p[aá]ginas?|bloques?|pdfs?)\s+(?:me\s+)?(?:falta|faltan|quedan)\b|\ben\s+qu[eé]\s+(?:bloque|p[aá]gina|pdf)\s+(?:voy|estoy)\b|\bmi\s+progreso\b|\bhow\s+much\s+(?:is\s+)?left\b/i

export function classifyDeterministic(message: string): DeterministicIntent {
  const text = String(message || '').trim()
  if (!text) return { role: null }
  const nav = NAVIGATE.exec(text)
  if (nav) return { role: 'navigate', page: Number(nav[1]) }
  if (FORCE_BLOCK.test(text)) return { role: 'command', command: 'force_block' }
  if (SKIP_QUESTION.test(text)) return { role: 'command', command: 'skip_question' }
  if (CONTINUE.test(text)) return { role: 'command', command: 'continue' }
  if (ADMIN.test(text) || isAdministrativeQuery(text)) return { role: 'admin' }
  return { role: null }
}

// ── tutor markers (leading, stripped before anything is stored or shown) ────────────────────────────────────────
export const ASK_KINDS = ['open', 'short', 'fill', 'tf', 'mcq', 'calc', 'compare', 'explain'] as const
export type AskKind = (typeof ASK_KINDS)[number]
export type ModelRole = 'answer' | 'question' | 'clarify' | 'chat'
export interface TutorMarkers {
  role?: ModelRole
  verdict?: 'correct' | 'partial' | 'incorrect'
  ask?: { kind: AskKind; handles: string[] }
  taught: string[]
  sources: string[]
  external: boolean
  help?: 'hint' | 'reveal'
  misconception?: { statement: string; correctStatement: string }
  body: string
  invalid: string[]
}

const MARKER = /\[\[([UVATSHEM]):([^\]]*)\]\]/g
const LEADING = /^\s*(?:\[\[[UVATSHEM]:[^\]]*\]\]\s*)+/
const handles = (raw: string) => [...new Set(raw.split(/[,\s]+/).map(h => h.replace(/^#/, '').trim().toUpperCase()).filter(h => /^[RK]?\d{1,2}$/.test(h)).map(h => (/^[RK]/.test(h) ? h : `#${h}`)))].slice(0, 6)

export function parseTutorMarkers(answer: string): TutorMarkers {
  const text = String(answer || '')
  const out: TutorMarkers = { taught: [], sources: [], external: false, body: text, invalid: [] }
  const leading = LEADING.exec(text)?.[0] ?? ''
  for (const match of leading.matchAll(MARKER)) {
    const [, key, valueRaw] = match
    const value = valueRaw.trim()
    if (key === 'U') { const role = value.toLowerCase(); if (role === 'answer' || role === 'question' || role === 'clarify' || role === 'chat') out.role = role; else out.invalid.push(`U:${value}`) }
    else if (key === 'V') { const v = value.toLowerCase(); if (v === 'correct' || v === 'partial' || v === 'incorrect') out.verdict = v; else out.invalid.push(`V:${value}`) }
    else if (key === 'A') { const [kindRaw, hs = ''] = value.split('|'); const kind = kindRaw.trim().toLowerCase() as AskKind; out.ask = { kind: (ASK_KINDS as readonly string[]).includes(kind) ? kind : 'open', handles: handles(hs) } }
    else if (key === 'T') out.taught = handles(value)
    else if (key === 'S') out.sources = handles(value)
    else if (key === 'E') out.external = /^(1|true|yes|si|sí)$/i.test(value)
    else if (key === 'H') { const h = value.toLowerCase(); if (h === 'hint' || h === 'reveal') out.help = h; else out.invalid.push(`H:${value}`) }
    else if (key === 'M') { const [statement, correct = ''] = value.split('::'); if (statement.trim()) out.misconception = { statement: statement.trim().slice(0, 200), correctStatement: correct.trim().slice(0, 200) } }
  }
  out.body = text.slice(leading.length).replace(MARKER, '').replace(/[ \t]+\n/g, '\n').trim()   // stray markers anywhere are never shown either
  return out
}
