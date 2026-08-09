import type { AcademicDocument, AcademicFragmentInput, AcademicNode, SourceSpan } from './types'
import { ACADEMIC_PARSER_VERSION, ACADEMIC_SCHEMA_VERSION } from './types'
import { academicNodeBoundary, quantityText } from './composition'
import { normalizeAcademicUnitSource } from './unitSyntax'

const INTERNAL_TOKEN = /\{\{(?:blank|slot|answer|internal):([^}]+)\}\}|\[\[(?:blank|slot|answer):([^\]]+)\]\]/i
const NUMBER_SOURCE = String.raw`[-+]?(?:(?:\d{1,3}(?:[.,]\d{3})+)|\d+)(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)?(?:\s*[×x·]\s*10(?:\^|\*\*)?[-−+]?\d+)?`
const UNIT_ATOM = String.raw`[%°µμΩÅA-Za-z]+(?:\^[-+]?\d+|[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)?`
const UNIT_SOURCE = String.raw`${UNIT_ATOM}(?:[*/·]\s*${UNIT_ATOM})*`
const UNIT_EXPRESSION = new RegExp(`^(${NUMBER_SOURCE})\\s*(${UNIT_SOURCE})$`, 'u')
const SYMBOL_ONLY = /^[\p{Sm}\p{Sk}\p{So}]+$/u
const CHEMISTRY_EXPLICIT = /^\\ce\{([\s\S]*)\}$/
const CHEMISTRY_EQUATION = /(?:<=>|<->|->|←|→|⇌|↔|⟶|⟷)/
const CHEMISTRY_TERM = /(?:^|[\s+])(?:\d+\s*)?(?:[A-Z][a-z]?\d*)+(?:\([a-z]{1,3}\))?(?:\^?[+-]\d*|\d*[+-])?(?=$|[\s+])/g
const INLINE_TOKEN = /(`[^`\n]+`|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|<math(?:\s[^>]*)?>[\s\S]*?<\/math>|\\ce\{(?:[^{}]|\{[^{}]*\})*\}|___|\{\{(?:blank|slot|answer|internal):[^}]+\}\}|\[\[(?:blank|slot|answer):[^\]]+\]\]|\*\*(?=\S)[\s\S]*?\S\*\*|__(?=\S)[\s\S]*?\S__|~~(?=\S)[\s\S]*?\S~~|(?<![\p{L}\p{N}])\*(?=\S)[^*\n]*?\S\*(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])_(?=\S)[^_\n]*?\S_(?![\p{L}\p{N}])|\[[^\]\n]+\]\([^) \n]+\))/giu

function safeText(value: AcademicFragmentInput): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

const span = (start: number, end: number): SourceSpan => ({ start, end })

function pushText(nodes: AcademicNode[], value: string, start: number): void {
  if (!value) return
  const previous = nodes.at(-1)
  if (previous?.type === 'text' && previous.sourceSpan?.end === start) {
    previous.value += value
    previous.sourceSpan.end += value.length
  } else {
    nodes.push({ type: 'text', value, sourceSpan: span(start, start + value.length) })
  }
}

function isChemistryExpression(value: string): boolean {
  if (!CHEMISTRY_EQUATION.test(value)) return false
  const terms = value.match(CHEMISTRY_TERM) || []
  return terms.length >= 2
}

function classifyPlainSegment(value: string, offset: number): AcademicNode[] {
  if (!value) return []
  const wholeQuantity = value.trim().match(UNIT_EXPRESSION)
  if (wholeQuantity) {
    const leading = value.indexOf(value.trim())
    return [{
      type: 'quantity',
      value: wholeQuantity[1].trim(),
      unit: wholeQuantity[2].trim(),
      sourceSpan: span(offset + leading, offset + leading + value.trim().length),
    }]
  }
  if (SYMBOL_ONLY.test(value.trim())) {
    const leading = value.indexOf(value.trim())
    return [{ type: 'symbol', value: value.trim(), sourceSpan: span(offset + leading, offset + leading + value.trim().length) }]
  }
  const nodes: AcademicNode[] = []
  const specialized = new RegExp(`${NUMBER_SOURCE}\\s*${UNIT_SOURCE}|[\\p{Sm}\\p{Sk}]`, 'gu')
  let cursor = 0
  for (const match of value.matchAll(specialized)) {
    const index = match.index || 0
    pushText(nodes, value.slice(cursor, index), offset + cursor)
    const quantity = match[0].trim().match(UNIT_EXPRESSION)
    nodes.push(quantity
      ? { type: 'quantity', value: quantity[1].trim(), unit: quantity[2].trim(), sourceSpan: span(offset + index, offset + index + match[0].length) }
      : { type: 'symbol', value: match[0], sourceSpan: span(offset + index, offset + index + match[0].length) })
    cursor = index + match[0].length
  }
  pushText(nodes, value.slice(cursor), offset + cursor)
  return nodes
}

function safeLink(href: string): boolean {
  if (/^(?:javascript|data|vbscript):/i.test(href.trim())) return false
  return /^(?:https?:\/\/|mailto:|\/|#)/i.test(href.trim())
}

function parseInline(source: string, baseOffset = 0): AcademicNode[] {
  const nodes: AcademicNode[] = []
  let cursor = 0
  for (const match of source.matchAll(INLINE_TOKEN)) {
    const index = match.index || 0
    for (const plain of classifyPlainSegment(source.slice(cursor, index), baseOffset + cursor)) nodes.push(plain)
    const raw = match[0]
    const sourceSpan = span(baseOffset + index, baseOffset + index + raw.length)
    if (raw === '___') {
      nodes.push({ type: 'blank', id: `blank_${nodes.filter(node => node.type === 'blank').length + 1}`, sourceSpan })
    } else {
      const internal = raw.match(INTERNAL_TOKEN)
      if (internal) {
        if (/^\{\{(?:internal|answer):/i.test(raw) || /^\[\[answer:/i.test(raw)) {
          nodes.push({ type: 'error_fallback', fallbackText: '', internalReason: 'internal_token', sourceSpan })
        } else {
          nodes.push({ type: 'blank', id: (internal[1] || internal[2]).trim(), sourceSpan })
        }
      } else if (raw.startsWith('`')) {
        nodes.push({ type: 'code', value: raw.slice(1, -1), display: false, sourceSpan })
      } else if (/^<math/i.test(raw)) {
        nodes.push({ type: 'math', value: raw, display: raw.includes('display="block"'), source: 'mathml', sourceSpan })
      } else if (raw.startsWith('\\ce{')) {
        nodes.push({ type: 'chemistry', value: raw.match(CHEMISTRY_EXPLICIT)?.[1] || '', display: false, sourceSpan })
      } else if (raw.startsWith('$$')) {
        const value = raw.slice(2, -2).trim()
        nodes.push(isChemistryExpression(value)
          ? { type: 'chemistry', value, display: true, sourceSpan }
          : { type: 'math', value, display: true, source: 'latex', sourceSpan })
      } else if (raw.startsWith('\\[')) {
        nodes.push({ type: 'math', value: raw.slice(2, -2).trim(), display: true, source: 'latex', sourceSpan })
      } else if (raw.startsWith('$') || raw.startsWith('\\(')) {
        const value = raw.startsWith('\\(') ? raw.slice(2, -2).trim() : raw.slice(1, -1).trim()
        nodes.push(isChemistryExpression(value)
          ? { type: 'chemistry', value, display: false, sourceSpan }
          : { type: 'math', value, display: false, source: 'latex', sourceSpan })
      } else if (raw.startsWith('**') || raw.startsWith('__')) {
        nodes.push({ type: 'strong', children: parseInline(raw.slice(2, -2), baseOffset + index + 2), sourceSpan })
      } else if (raw.startsWith('~~')) {
        nodes.push({ type: 'strike', children: parseInline(raw.slice(2, -2), baseOffset + index + 2), sourceSpan })
      } else if (raw.startsWith('*') || raw.startsWith('_')) {
        nodes.push({ type: 'emphasis', children: parseInline(raw.slice(1, -1), baseOffset + index + 1), sourceSpan })
      } else if (raw.startsWith('[')) {
        const link = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
        if (link && safeLink(link[2])) {
          nodes.push({ type: 'link', href: link[2], children: parseInline(link[1], baseOffset + index + 1), sourceSpan })
        } else {
          pushText(nodes, link?.[1] || raw, baseOffset + index)
        }
      }
    }
    cursor = index + raw.length
  }
  for (const plain of classifyPlainSegment(source.slice(cursor), baseOffset + cursor)) nodes.push(plain)
  return nodes
}

function stripUnbalancedPresentationMarkers(source: string): { source: string; repaired: boolean } {
  let result = source
  let repaired = false
  for (const delimiter of ['**', '__', '~~']) {
    const escaped = delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matches = result.match(new RegExp(escaped, 'g')) || []
    if (matches.length % 2 !== 0) {
      result = result.replace(new RegExp(`(^|[\\s([{])${escaped}(?=\\p{L}|\\p{N})`, 'gu'), '$1')
      repaired = result !== source || repaired
    }
  }
  return { source: result, repaired }
}

function document(nodes: AcademicNode[], originalHash?: string): AcademicDocument {
  return {
    version: ACADEMIC_SCHEMA_VERSION,
    parserVersion: ACADEMIC_PARSER_VERSION,
    nodes,
    ...(originalHash ? { originalHash } : {}),
  }
}

function parseTable(lines: string[], offsets: number[]): Extract<AcademicNode, { type: 'table' }> | null {
  if (lines.length < 2 || !/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[1])) return null
  const cells = (line: string, offset: number) => {
    let cursor = offset + (line.startsWith('|') ? 1 : 0)
    return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => {
      const trimmed = cell.trim()
      const start = line.indexOf(trimmed, Math.max(0, cursor - offset))
      cursor = offset + start + trimmed.length
      return document(parseInline(trimmed, offset + start))
    })
  }
  const headers = cells(lines[0], offsets[0])
  const rowLines: string[] = []
  for (let index = 2; index < lines.length && lines[index].includes('|'); index++) rowLines.push(lines[index])
  const rows = rowLines.map((line, index) => cells(line, offsets[index + 2]))
  return headers.length && rows.length ? { type: 'table', headers, rows } : null
}

export function parseAcademicContent(input: AcademicFragmentInput): AcademicDocument {
  const raw = normalizeAcademicUnitSource(
    safeText(input).replace(/\r\n?/g, '\n').replace(/[\u200B-\u200D\uFEFF]/g, ''),
  )
  const repaired = stripUnbalancedPresentationMarkers(raw)
  const source = repaired.source
  if (!source) return document([])
  const nodes: AcademicNode[] = []
  const lines = source.split('\n')
  const offsets: number[] = []
  let runningOffset = 0
  for (const line of lines) {
    offsets.push(runningOffset)
    runningOffset += line.length + 1
  }
  let line = 0
  while (line < lines.length) {
    if (/^```/.test(lines[line])) {
      const start = offsets[line]
      const language = lines[line].slice(3).trim() || undefined
      const body: string[] = []
      line++
      while (line < lines.length && !/^```/.test(lines[line])) body.push(lines[line++])
      if (line < lines.length) line++
      nodes.push({
        type: 'code', value: body.join('\n'), ...(language ? { language } : {}),
        display: true, sourceSpan: span(start, line < offsets.length ? offsets[line] - 1 : source.length),
      })
      if (line < lines.length) nodes.push({ type: 'line_break' })
      continue
    }
    const table = parseTable(lines.slice(line), offsets.slice(line))
    if (table) {
      nodes.push(table)
      line += 2 + table.rows.length
      if (line < lines.length) nodes.push({ type: 'line_break' })
      continue
    }
    const heading = lines[line].match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      nodes.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(heading[2], offsets[line] + heading[1].length + 1),
        sourceSpan: span(offsets[line], offsets[line] + lines[line].length),
      })
      if (line < lines.length - 1) nodes.push({ type: 'line_break' })
      line++
      continue
    }
    const listMatch = lines[line].match(/^\s*(?:(\d+)[.)]|[-*+])\s+(.+)$/)
    if (listMatch) {
      const ordered = Boolean(listMatch[1])
      const items: AcademicDocument[] = []
      while (line < lines.length) {
        const match = lines[line].match(/^\s*(?:(\d+)[.)]|[-*+])\s+(.+)$/)
        if (!match || Boolean(match[1]) !== ordered) break
        const contentOffset = offsets[line] + lines[line].indexOf(match[2])
        items.push(document(parseInline(match[2], contentOffset)))
        line++
      }
      nodes.push({ type: 'list', ordered, items })
      if (line < lines.length) nodes.push({ type: 'line_break' })
      continue
    }
    nodes.push({ type: 'paragraph', children: parseInline(lines[line], offsets[line]), sourceSpan: span(offsets[line], offsets[line] + lines[line].length) })
    if (line < lines.length - 1) nodes.push({ type: 'line_break' })
    line++
  }
  return document(nodes)
}

export function hasBrokenAcademicDelimiters(input: AcademicFragmentInput): boolean {
  const source = safeText(input).replace(/\\\$/g, '')
  const blockCount = source.match(/\$\$/g)?.length || 0
  const withoutBlocks = source.replace(/\$\$/g, '')
  const inlineCount = withoutBlocks.match(/\$/g)?.length || 0
  return blockCount % 2 !== 0 ||
    inlineCount % 2 !== 0 ||
    (source.match(/\\\(/g)?.length || 0) !== (source.match(/\\\)/g)?.length || 0) ||
    (source.match(/\\\[/g)?.length || 0) !== (source.match(/\\\]/g)?.length || 0)
}

export function academicNodeChildren(node: AcademicNode): AcademicNode[] {
  return 'children' in node ? node.children : []
}

export function academicDocumentText(documentValue: AcademicDocument): string {
  const renderNodes = (nodes: AcademicNode[]): string => nodes.map((node, index) => {
    const boundary = academicNodeBoundary(nodes[index - 1], node)
    switch (node.type) {
      case 'text': case 'symbol': case 'unit': case 'code': case 'chemistry': return boundary + node.value
      case 'quantity': return boundary + quantityText(node.value, node.unit)
      case 'math': return boundary + node.value
      case 'blank': return boundary + '___'
      case 'line_break': return '\n'
      case 'strong': case 'emphasis': case 'strike': case 'paragraph': case 'heading': case 'link': case 'callout':
        return boundary + renderNodes(node.children)
      case 'list': return boundary + node.items.map(academicDocumentText).join('\n')
      case 'table': return boundary + [...node.headers, ...node.rows.flat()].map(academicDocumentText).join(' | ')
      case 'error_fallback': return boundary + node.fallbackText
    }
  }).join('')
  return renderNodes(documentValue.nodes)
}
