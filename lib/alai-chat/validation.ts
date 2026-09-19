import { boundedIds, CHAT_LIMITS, isRecord, type ChatIntent, type SourcePolicy, type PedagogicalTransition } from './contracts'
import { parseChatContent, type ChatContentNode } from './content'
import { normalizeIntentText } from './intent'
import { isInternalChatText } from './errors'

export interface ChatCandidate {
  answer: string
  usedTargetIds: string[]
  usedRelationIds: string[]
  suggestedFollowups: string[]
  externalKnowledgeUsed: boolean | null
  pedagogicalTransition?: PedagogicalTransition | null
  /** Responder only: the model's judgement of the student's last answer. Read by the server state machine, never shown. */
  practiceVerdict?: string | null
}
export function normalizeChatCandidate(value: unknown): ChatCandidate {
  const raw = isRecord(value) ? value : {}
  const ped = isRecord(raw.pedagogicalTransition) ? raw.pedagogicalTransition : null
  return {
    answer: typeof raw.answer === 'string' ? raw.answer.trim() : '',
    practiceVerdict: typeof raw.practiceVerdict === 'string' ? raw.practiceVerdict.trim().toLowerCase() : null,
    usedTargetIds: boundedIds(raw.usedTargetIds), usedRelationIds: boundedIds(raw.usedRelationIds, CHAT_LIMITS.relations),
    suggestedFollowups: Array.isArray(raw.suggestedFollowups) ? raw.suggestedFollowups.slice(0, CHAT_LIMITS.followups).filter((s): s is string => typeof s === 'string' && !!s.trim() && s.length <= 160 && !isInternalChatText(s)) : [],
    externalKnowledgeUsed: typeof raw.externalKnowledgeUsed === 'boolean' ? raw.externalKnowledgeUsed : null,
    pedagogicalTransition: ped ? {
      action: typeof ped.action === 'string' ? ped.action as any : undefined,
      targetObject: typeof ped.targetObject === 'string' ? ped.targetObject.trim() : undefined,
      solutionRevealed: typeof ped.solutionRevealed === 'boolean' ? ped.solutionRevealed : undefined,
      focusedEntity: typeof ped.focusedEntity === 'string' ? ped.focusedEntity.trim() : undefined,
    } : null,
  }
}

export function validateChatCandidate(value: ChatCandidate, options: {
  intent: ChatIntent; sourcePolicy: SourcePolicy; requestedCount?: number
  transportComplete?: boolean; requireSourceReport?: boolean
}): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const { answer } = value
  if (!answer.trim()) errors.push('missing_answer')
  if (isInternalChatText(answer)) errors.push('internal_failure_text')
  if (answer.length > CHAT_LIMITS.answerChars) errors.push('answer_too_long')
  if (options.transportComplete === false) errors.push('incomplete_transport')
  if (options.requireSourceReport && value.externalKnowledgeUsed === null) errors.push('missing_external_knowledge_report')
  if (options.sourcePolicy === 'MATERIAL_ONLY' && value.externalKnowledgeUsed) errors.push('external_knowledge_forbidden')
  if (options.requireSourceReport && options.sourcePolicy === 'GENERAL_ONLY' && value.externalKnowledgeUsed !== true) errors.push('general_answer_required')
  if (/^\s*(?:\{\s*"|```json\b)/.test(answer)) errors.push('answer_contains_json_envelope')
  const parsed = parseChatContent(answer)
  errors.push(...parsed.errors)
  const prose = parsed.nodes.filter(node => node.kind !== 'code').map(node => 'text' in node ? node.text : node.kind === 'table' ? [...node.headers, ...node.rows.flat()].join(' ') : node.items.join(' ')).join('\n')
  const normalized = normalizeIntentText(prose)
  const honestLimitation = /(?:no encontre (?:respaldo|informacion|evidencia)|el (?:contexto|material) (?:recuperado )?no (?:respalda|permite|contiene)|solo (?:hay|encontre|se respaldan) \d+|not enough (?:material|evidence)|could not find support)/.test(normalized)
  if (options.requireSourceReport && !value.usedTargetIds.length && !value.externalKnowledgeUsed && !honestLimitation) errors.push('answer_has_no_declared_source')
  if (!value.usedTargetIds.length && !honestLimitation && /\b(?:segun (?:tu |el |mi )?(?:pdf|material|documento)|en tu material)\b/.test(normalized)) errors.push('material_claim_without_evidence')
  const tables = parsed.nodes.filter(node => node.kind === 'table')
  const lists = parsed.nodes.filter((node): node is Extract<ChatContentNode, { kind: 'ul' | 'ol' }> => node.kind === 'ol' || node.kind === 'ul')
  if (options.intent.shape === 'bullet_list' && !lists.length && !honestLimitation) errors.push('requested_list_missing')
  if (options.intent.shape === 'comparison_table' && !tables.length && !honestLimitation) errors.push('requested_table_missing')
  const count = options.intent.ordinal ? undefined : options.requestedCount || options.intent.requestedCount
  if (count && !honestLimitation) {
    const counts = tables.length ? tables.map(t => t.rows.length) : lists.map(l => l.items.length)
    if (counts.length === 1 && counts[0] < count) errors.push(`requested_count_${count}_received_${counts[0]}`)
    if (!counts.length && options.intent.shape === 'bullet_list') errors.push('requested_list_missing')
  }
  // Explanatory paragraphs/equations can separate steps. Their numbering must
  // survive parsing; demanding adjacent list rows rejects valid worked solutions.
  let sequentialSteps = 0, longestSequence = 0
  for (const list of lists.filter(l => l.kind === 'ol')) {
    sequentialSteps = (list.start || 1) === sequentialSteps + 1 ? sequentialSteps + list.items.length : (list.start || 1) === 1 ? list.items.length : 0
    longestSequence = Math.max(longestSequence, sequentialSteps)
  }
  if (options.intent.shape === 'numbered_steps' && !honestLimitation && longestSequence < 2) errors.push('requested_steps_missing')
  if (options.intent.shape === 'graph') {
    // Rich graph output is assembled server-side from a safe explicit expression.
    // The provider must not falsely claim that it already rendered/drew a visual.
    const falseRenderedClaim = /aqui (?:esta|tienes) (?:la |una )?grafica|(?:ya |aqui |arriba |abajo )?(?:he |se ha )?(?:dibujado|graficado|renderizado|mostrado) (?:la |una |esta )?grafica|(?:i (?:have )?)?(?:rendered|drawn|displayed) (?:the |a )?graph/.test(normalized)
    if (falseRenderedClaim) errors.push('graph_false_rendered_claim')
  }
  if (options.intent.shape === 'timeline' && !honestLimitation) {
    const entries = tables.some(t => t.rows.length >= 1) || lists.some(l => l.items.length >= 1)
    if (!entries) errors.push('timeline_requires_textual_entries')
  }
  // Citations are displayed by the server from evidence. Provider-written page labels are forbidden,
  // even if that page number happens to exist in a different selected material.
  if (/\b(?:p[aá]ginas?|p[aá]gs?\.?|pages?)\s*[:#]?\s*\d/i.test(prose)) errors.push('provider_page_claim_forbidden_use_evidence')
  if (/(?:chat_target:|chat_relation:|ENJOYER_TARGET|ENJOYER_RELATION)/.test(prose)) errors.push('internal_evidence_id_in_answer')
  if (/\b(?:no (?:aparece|existe|esta|se menciona).*\b(?:material|pdf|documento)|(?:material|pdf|documento).*no contiene)\b/.test(normalized)) errors.push('unproven_document_wide_absence')
  return { valid: errors.length === 0, errors: errors.map(error => `STRUCTURAL_VALIDATION_FAILED:${error}`) }
}
