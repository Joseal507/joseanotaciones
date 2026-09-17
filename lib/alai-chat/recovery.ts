import type { ChatEnjoyerTarget } from '../materialBrain/chatEnjoyerContext'
import type { ChatIntent, SourcePolicy } from './contracts'
import { isInternalChatText } from './errors'
import { normalizeChatCandidate, validateChatCandidate, type ChatCandidate } from './validation'

export const PROVIDER_PAGE_CLAIM = /\b(?:p[aá]ginas?|p[aá]gs?\.?|pages?)\s*[:#]?\s*\d/i
export type ChatFinalOutcome = 'normal_success' | 'repaired_success' | 'deterministic_salvage_success' | 'safe_partial_success' | 'safe_user_fallback' | 'hard_internal_failure'
export const MATERIAL_LIMITATION = 'No encontré respaldo suficiente en el material seleccionado para responder eso con seguridad. Puedes preguntarme por una sección o concepto específico y lo reviso contigo.'

/** Presentation-only salvage. Never relabel unsupported material prose as verified. */
export function salvageChatPresentation(candidate: ChatCandidate, options: {
  intent: ChatIntent; sourcePolicy: SourcePolicy; requestedCount?: number
}): { candidate: ChatCandidate; strategy: string } | null {
  const check = validateChatCandidate(candidate, { ...options, requireSourceReport: true })
  if (!check.errors.length || check.errors.some(e => !e.endsWith(':provider_page_claim_forbidden_use_evidence'))) return null
  // Remove entire page-bearing statements, not just their numbers: the remaining
  // assertion (e.g. "this is the most important page") might also be unsupported.
  const answer = candidate.answer.split(/\n|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/u)
    .filter(part => !PROVIDER_PAGE_CLAIM.test(part)).join('\n').trim()
  const salvaged = { ...candidate, answer, suggestedFollowups: [], pedagogicalTransition: null }
  if (!validateChatCandidate(salvaged, { ...options, requireSourceReport: true }).valid) return null
  return { candidate: salvaged, strategy: 'remove_page_statements' }
}

/** Evidence-first fallback: copy one complete bounded authorized fragment. No new synthesis. */
export function chatEvidenceFallback(targets: ChatEnjoyerTarget[], prioritize = false): ChatCandidate | null {
  const ranked = [...targets].sort((a, b) => b.importance - a.importance || a.sourceOrder - b.sourceOrder)
  for (const target of ranked) {
    const fragments = [...target.sourceSpans.map(span => span.quote), target.content]
    const fragment = fragments.find(text => text.length >= 15 && text.length <= 1600
      && !PROVIDER_PAGE_CLAIM.test(text) && !isInternalChatText(text)
      && validateChatCandidate(normalizeChatCandidate({ answer: text, usedTargetIds: [target.id], externalKnowledgeUsed: false }), {
        intent: { shape: 'prose', followup: false, materialInspection: false }, sourcePolicy: 'MATERIAL_ONLY', requireSourceReport: true,
      }).valid)
    if (!fragment || !target.materialId) continue
    const intro = prioritize
      ? 'Como punto de partida, revisaría este contenido destacado del material. No tengo suficiente respaldo para señalar una única página imprescindible; las referencias indican dónde se encuentra.'
      : 'No pude verificar una respuesta completa. Este contenido del material sí está respaldado por las referencias:'
    return normalizeChatCandidate({ answer: `${intro}\n\n${fragment}`, usedTargetIds: [target.id], usedRelationIds: [], externalKnowledgeUsed: false, suggestedFollowups: [] })
  }
  return null
}

/** Compositional material-navigation intent, independent of the PDF or subject. */
export function isMaterialPriorityRequest(message: string): boolean {
  const q = message.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  return /\b(?:paginas?|seccion(?:es)?|material|estudiar|revisar|estudio)\b/.test(q)
    && /\b(?:importante|importancia|esencial|priori\w*|primero|primera|saltar|salto|imprescindible|si o si)\b/.test(q)
}
