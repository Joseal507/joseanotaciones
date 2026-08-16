import katex from 'katex'
import { academicDocumentText, academicNodeChildren, hasBrokenAcademicDelimiters, parseAcademicContent } from './parser'
import type { AcademicDocument, AcademicNode, AcademicValidation, NodeIssue, SourceSpan } from './types'
import { ACADEMIC_PARSER_VERSION, ACADEMIC_SCHEMA_VERSION } from './types'
import { hasSuspiciousPartialUnitCommand, normalizeAcademicUnitSource } from './unitSyntax'

const INTERNAL_VISIBLE = /\{\{(?:blank|slot|answer|internal):|(?:blank|slot|answer|option|word)_id\b|\[\[(?:blank|slot|answer):|\[object Object\]|INVALID_ACADEMIC_FRAGMENT/i
const LATEX_COMMAND = /\\[A-Za-z]+/
const RAW_PRESENTATION = /(?:^|[\s([{])(?:\*\*|__|~~)(?=\S)|<\/?[A-Za-z][^>]*>/
const RAW_TEMPLATE = /\$\{[^}]+\}|<%[\s\S]*?%>|\\u[0-9a-fA-F]{4}/
const MATHML_TAGS = new Set([
  'math', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace', 'ms', 'mglyph',
  'mfrac', 'msqrt', 'mroot', 'mstyle', 'merror', 'mpadded', 'mphantom',
  'mfenced', 'menclose', 'msub', 'msup', 'msubsup', 'munder', 'mover',
  'munderover', 'mmultiscripts', 'mprescripts', 'none', 'mtable', 'mtr',
  'mtd', 'mlabeledtr', 'maction', 'semantics', 'annotation',
])

function balanced(value: string, open: string, close: string): boolean {
  let depth = 0
  for (const character of value) {
    if (character === open) depth++
    if (character === close && --depth < 0) return false
  }
  return depth === 0
}

function validMath(node: Extract<AcademicNode, { type: 'math' }>): boolean {
  if (!node.value.trim()) return false
  if (node.source === 'mathml') {
    if (!/^<math(?:\s[^>]*)?>[\s\S]*<\/math>$/.test(node.value) ||
        /<script|on\w+\s*=|\b(?:href|src|style)\s*=/i.test(node.value)) return false
    const tags = [...node.value.matchAll(/<\/?\s*([A-Za-z][A-Za-z0-9-]*)\b/g)].map(match => match[1].toLowerCase())
    return tags.length >= 2 && tags.every(tag => MATHML_TAGS.has(tag))
  }
  if (!balanced(node.value, '{', '}')) return false
  try {
    katex.renderToString(node.value, { throwOnError: true, displayMode: node.display, trust: false, strict: 'error' })
    return true
  } catch {
    return false
  }
}

function visibleValue(node: AcademicNode): string {
  if ('value' in node) return node.value
  if (node.type === 'error_fallback') return node.fallbackText
  return ''
}

function validateNode(node: AcademicNode, index: number, path: string): NodeIssue[] {
  const issues: NodeIssue[] = []
  const value = visibleValue(node)
  if (value && INTERNAL_VISIBLE.test(value)) issues.push({ code: 'internal_token_visible', nodeIndex: index, nodePath: path, recoverable: false })
  if (node.type === 'text' && LATEX_COMMAND.test(node.value)) issues.push({ code: 'unprocessed_academic_command', nodeIndex: index, nodePath: path, recoverable: false })
  if (node.type === 'text' && RAW_PRESENTATION.test(node.value)) issues.push({ code: 'raw_presentation_token', nodeIndex: index, nodePath: path, recoverable: true })
  if (node.type === 'text' && RAW_TEMPLATE.test(node.value)) issues.push({ code: 'raw_template_token', nodeIndex: index, nodePath: path, recoverable: false })
  if ((node.type === 'text' || node.type === 'unit' || node.type === 'quantity' || node.type === 'symbol') &&
      hasSuspiciousPartialUnitCommand(node.value)) issues.push({ code: 'partial_unit_command', nodeIndex: index, nodePath: path, recoverable: false })
  if (node.type === 'math' && !validMath(node)) issues.push({ code: 'invalid_math', nodeIndex: index, nodePath: path, recoverable: true })
  if (node.type === 'chemistry' && (!node.value.trim() || !balanced(node.value, '{', '}') || INTERNAL_VISIBLE.test(node.value))) {
    issues.push({ code: 'invalid_chemistry', nodeIndex: index, nodePath: path, recoverable: true })
  }
  if (node.type === 'quantity' && (!node.value.trim() || !node.unit.trim())) issues.push({ code: 'invalid_quantity', nodeIndex: index, nodePath: path, recoverable: false })
  if (node.type === 'blank' && (!node.id.trim() || INTERNAL_VISIBLE.test(node.id))) issues.push({ code: 'invalid_blank', nodeIndex: index, nodePath: path, recoverable: false })
  if (node.type === 'code' && (node.value.includes('```') || (node.language && INTERNAL_VISIBLE.test(node.language)))) issues.push({ code: 'broken_code_fence', nodeIndex: index, nodePath: path, recoverable: true })
  if (node.type === 'link' && !/^(?:https?:\/\/|mailto:|\/|#)/i.test(node.href)) issues.push({ code: 'unsafe_link', nodeIndex: index, nodePath: path, recoverable: false })
  if (node.type === 'error_fallback' && (node.internalReason === 'internal_token' || INTERNAL_VISIBLE.test(node.fallbackText) || LATEX_COMMAND.test(node.fallbackText))) {
    issues.push({ code: 'unsafe_fallback', nodeIndex: index, nodePath: path, recoverable: false })
  }
  academicNodeChildren(node).forEach((child, childIndex) => issues.push(...validateNode(child, childIndex, `${path}.children[${childIndex}]`)))
  if (node.type === 'list') node.items.forEach((item, itemIndex) => issues.push(...validateDocumentNodes(item, `${path}.items[${itemIndex}]`)))
  if (node.type === 'table') {
    node.headers.forEach((cell, cellIndex) => issues.push(...validateDocumentNodes(cell, `${path}.headers[${cellIndex}]`)))
    node.rows.forEach((row, rowIndex) => row.forEach((cell, cellIndex) => issues.push(...validateDocumentNodes(cell, `${path}.rows[${rowIndex}][${cellIndex}]`))))
  }
  return issues
}

function collectLeafSpans(nodes: AcademicNode[], target: SourceSpan[] = []): SourceSpan[] {
  for (const node of nodes) {
    const children = academicNodeChildren(node)
    if (children.length) collectLeafSpans(children, target)
    else if (node.sourceSpan && node.type !== 'line_break' && node.type !== 'error_fallback') target.push(node.sourceSpan)
    if (node.type === 'list') node.items.forEach(item => collectLeafSpans(item.nodes, target))
    if (node.type === 'table') [...node.headers, ...node.rows.flat()].forEach(cell => collectLeafSpans(cell.nodes, target))
  }
  return target
}

function validateDocumentNodes(document: AcademicDocument, path = 'document'): NodeIssue[] {
  return document.nodes.flatMap((node, index) => validateNode(node, index, `${path}.nodes[${index}]`))
}

export function validateAcademicDocument(document: AcademicDocument): AcademicValidation {
  const issues: NodeIssue[] = []
  if (document.version !== ACADEMIC_SCHEMA_VERSION || document.parserVersion !== ACADEMIC_PARSER_VERSION) {
    issues.push({ code: 'schema_version_mismatch', nodeIndex: -1, recoverable: true })
  }
  issues.push(...validateDocumentNodes(document))
  const spans = collectLeafSpans(document.nodes).sort((left, right) => left.start - right.start || left.end - right.end)
  for (let index = 1; index < spans.length; index++) {
    if (spans[index].start < spans[index - 1].end) {
      issues.push({ code: 'duplicate_source_span', nodeIndex: -1, recoverable: false })
      break
    }
  }
  if (INTERNAL_VISIBLE.test(academicDocumentText(document))) issues.push({ code: 'internal_content_visible', nodeIndex: -1, recoverable: false })
  return { valid: issues.length === 0, issues }
}

function repairLatex(value: string): string {
  return value.replace(/\\\\([A-Za-z]+)/g, '\\$1').replace(/[−–—]/g, '-').replace(/\u00a0/g, ' ').trim()
}

export function repairAcademicDocument(document: AcademicDocument): AcademicDocument {
  const repairNodes = (nodes: AcademicNode[]): AcademicNode[] => nodes.map(node => {
    if (node.type === 'math' && node.source === 'latex') return { ...node, value: repairLatex(node.value) }
    if (node.type === 'chemistry') return { ...node, value: repairLatex(node.value) }
    if (node.type === 'code') return { ...node, value: node.value.replace(/```/g, '') }
    const children = academicNodeChildren(node)
    if (children.length) return { ...node, children: repairNodes(children) } as AcademicNode
    if (node.type === 'list') return { ...node, items: node.items.map(repairAcademicDocument) }
    if (node.type === 'table') return { ...node, headers: node.headers.map(repairAcademicDocument), rows: node.rows.map(row => row.map(repairAcademicDocument)) }
    return node
  })
  return { ...document, version: ACADEMIC_SCHEMA_VERSION, parserVersion: ACADEMIC_PARSER_VERSION, nodes: repairNodes(document.nodes) }
}

export interface AcademicDeliveryTelemetry {
  event: 'academic_parse_failed' | 'markdown_repaired' | 'latex_repaired' | 'academic_safe_fallback_used' | 'duplicate_source_span_blocked' | 'forbidden_visual_token_blocked' | 'restore_migration_applied' | 'visual_contract_violation'
  contentType?: string
  sessionId?: string
  microId?: string
  questionId?: string
  parserVersion: string
  repairStrategy?: string
  originalHash: string
  fallbackReason?: string
}

export interface AcademicDeliveryContext {
  contentType?: string
  sessionId?: string
  microId?: string
  questionId?: string
  telemetry?: (event: AcademicDeliveryTelemetry) => void
}

function hashSource(value: string): string {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function readableTechnicalFallback(source: string): string {
  return source
    .replace(/<[^>]*>/g, '')
    .replace(/\{\{(?:blank|slot):[^}]+\}\}|\[\[(?:blank|slot):[^\]]+\]\]/gi, '___')
    .replace(/\{\{(?:answer|internal):[^}]+\}\}|\[\[answer:[^\]]+\]\]/gi, '')
    .replace(/\\(?:text|mathrm)\{([^{}]*)\}/g, '$1')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2')
    .replace(/\\ce\{([^{}]*)\}/g, '$1')
    .replace(/\\(?:left|right)\b/g, '')
    .replace(/\\(?:begin|end)\{[^{}]*\}/g, '')
    .replace(/\\[A-Za-z]+/g, '')
    .replace(/[$]{1,2}/g, '')
    .replace(/(?:^|[\s([{])(?:\*\*|__|~~)(?=\S)/g, '$1')
    .replace(/\{\s*([^{}]+)\s*\}/g, '$1')
    .replace(/\s+([,.;:?!%)\]}])/g, '$1')
    .replace(/([,.;:?!])(?=\p{L}|\p{N})/gu, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function normalizeAcademicContent(input: string): {
  source: string
  document: AcademicDocument
  validation: AcademicValidation
  repaired: boolean
  requiresRegeneration: boolean
} {
  const source = normalizeAcademicUnitSource(input)
  if (hasBrokenAcademicDelimiters(source)) {
    const document = parseAcademicContent(source)
    return { source, document, validation: { valid: false, issues: [{ code: 'broken_delimiter', nodeIndex: -1, recoverable: false }] }, repaired: false, requiresRegeneration: true }
  }
  const parsed = parseAcademicContent(source)
  const initial = validateAcademicDocument(parsed)
  if (initial.valid) return { source, document: parsed, validation: initial, repaired: source !== input || academicDocumentText(parsed) !== source, requiresRegeneration: false }
  const repairedDocument = repairAcademicDocument(parsed)
  const repairedValidation = validateAcademicDocument(repairedDocument)
  return { source, document: repairedDocument, validation: repairedValidation, repaired: repairedValidation.valid, requiresRegeneration: !repairedValidation.valid }
}

export function prepareAcademicContentForDelivery(
  content: string | AcademicDocument,
  context: AcademicDeliveryContext = {},
): { document: AcademicDocument; degraded: boolean; originalHash: string } {
  const { telemetry, ...telemetryContext } = context
  // Callers pass question/flashcard/answer text sourced from JSON (API
  // responses, restored localStorage/session state) where TypeScript's
  // `string | AcademicDocument` type is not runtime-enforced — a missing or
  // stale field can arrive as undefined/null. Treat that as empty content
  // instead of crashing the whole page on `content.nodes`.
  const safeContent: string | AcademicDocument = content == null ? '' : content
  const source = typeof safeContent === 'string' ? safeContent : academicDocumentText(safeContent)
  const originalHash = hashSource(source)
  const normalized = typeof safeContent === 'string'
    ? normalizeAcademicContent(safeContent)
    : { document: safeContent, validation: validateAcademicDocument(safeContent), repaired: false, requiresRegeneration: false }
  if (normalized.validation.valid) {
    if (normalized.repaired) telemetry?.({ event: 'markdown_repaired', ...telemetryContext, parserVersion: ACADEMIC_PARSER_VERSION, originalHash, repairStrategy: 'structural_parser' })
    return { document: normalized.document, degraded: false, originalHash }
  }
  const reason = normalized.validation.issues.map(issue => issue.code).join(',') || 'unknown'
  telemetry?.({
    event: reason.includes('duplicate_source_span') ? 'duplicate_source_span_blocked' : 'academic_safe_fallback_used',
    ...telemetryContext, parserVersion: ACADEMIC_PARSER_VERSION, originalHash,
    repairStrategy: 'plain_text_semantic_degradation', fallbackReason: reason,
  })
  const fallbackText = readableTechnicalFallback(source) || 'Contenido académico no disponible.'
  const fallback = parseAcademicContent(fallbackText)
  const fallbackValidation = validateAcademicDocument(fallback)
  if (fallbackValidation.valid) return { document: fallback, degraded: true, originalHash }
  return {
    document: {
      version: ACADEMIC_SCHEMA_VERSION,
      parserVersion: ACADEMIC_PARSER_VERSION,
      originalHash,
      nodes: [{ type: 'error_fallback', fallbackText: 'Contenido académico no disponible.', internalReason: reason }],
    },
    degraded: true,
    originalHash,
  }
}

export function containsUnprocessedAcademicCommand(document: AcademicDocument): boolean {
  const visit = (nodes: AcademicNode[]): boolean => nodes.some(node =>
    (node.type === 'text' && LATEX_COMMAND.test(node.value)) || visit(academicNodeChildren(node))
  )
  return visit(document.nodes)
}
