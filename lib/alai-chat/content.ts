/** Shared Phase B grammar. All nodes render as React text, never provider HTML. */
export type ChatContentNode =
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'ul' | 'ol'; items: string[]; start?: number }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'code'; text: string; language: string }
  | { kind: 'p'; text: string }

export function normalizeChatText(text: string): string {
  // Repair a common transport artifact where paragraph newlines arrive as
  // the two literal characters `\n`. Do not decode LaTeX commands such as
  // `\neq`; only decode when `\n` is followed by whitespace, an uppercase
  // letter, a number, or a common block/list marker.
  const normalized = text.replace(/\r\n?/g, '\n')
  // Ambiguous code/math is literal content, including escaped newline examples.
  if (/[`$]|\\(?:[a-z]{2,}|[A-Z][a-z]+|[()[\]])/.test(normalized)) return normalized
  return normalized.replace(/\\n(?=(?:\s|[A-ZÁÉÍÓÚÑ0-9#*•-]))/g, '\n')
}

function cells(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const result: string[] = []
  let cell = '', code = false, math = false, escaped = false
  for (const char of body) {
    if (escaped) { cell += char; escaped = false; continue }
    if (char === '\\') { cell += char; escaped = true; continue }
    if (char === '`' && !math) code = !code
    if (char === '$' && !code) math = !math
    if (char === '|' && !code && !math) { result.push(cell.trim()); cell = '' } else cell += char
  }
  result.push(cell.trim())
  return result
}
const row = (line: string) => /^\s*\|.*\|\s*$/.test(line)
const separator = (line: string) => row(line) && cells(line).every(cell => /^:?-{3,}:?$/.test(cell))
const list = (line: string) => line.match(/^\s*(?:(\d+)[.):]|([-*•]))\s+(.+)$/)

function expandListParts(line: string): string[] {
  const trimmed = line.trim()
  const matches = [...trimmed.matchAll(/(?:^|\s+)(\d+)[.)]\s+/g)]
  if (matches.length <= 1) return [trimmed]

  const nums = matches.map(m => parseInt(m[1], 10))
  const isSequential = nums.every((val, idx) => idx === 0 || val === nums[idx - 1] + 1)
  if (!isSequential) return [trimmed]

  const parts: string[] = []
  for (let m = 0; m < matches.length; m++) {
    const start = matches[m].index! + (matches[m][0].length - matches[m][0].trimStart().length)
    const end = m + 1 < matches.length ? matches[m + 1].index! : trimmed.length
    parts.push(trimmed.slice(start, end).trim())
  }
  return parts
}

export function parseChatContent(text: string): { nodes: ChatContentNode[]; errors: string[] } {
  const lines = normalizeChatText(text).split('\n')
  const nodes: ChatContentNode[] = [], errors: string[] = []
  let i = 0
  while (i < lines.length) {
    const current = lines[i].trim()
    if (!current) { i++; continue }
    const fence = current.match(/^(`{3,}|~{3,})(.*)$/)
    if (fence) {
      const content: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) content.push(lines[i++])
      if (i === lines.length) errors.push('unclosed_code_fence')
      else i++
      nodes.push({ kind: 'code', text: content.join('\n'), language: fence[2].trim().slice(0, 40) })
      continue
    }
    // Multiline display math blocks: preserve intact across newlines
    if (current.startsWith('$$') || current.startsWith('\\[')) {
      const isDollar = current.startsWith('$$')
      const opener = isDollar ? '$$' : '\\['
      const closer = isDollar ? '$$' : '\\]'
      const rest = current.slice(opener.length)
      if (rest.includes(closer)) {
        nodes.push({ kind: 'p', text: lines[i++] })
        continue
      }
      const mathLines = [lines[i++]]
      while (i < lines.length) {
        const nextLine = lines[i++]
        mathLines.push(nextLine)
        if (nextLine.includes(closer)) break
      }
      nodes.push({ kind: 'p', text: mathLines.join('\n') })
      continue
    }
    if (row(current) && i + 1 < lines.length && separator(lines[i + 1])) {
      const headers = cells(current), separators = cells(lines[i + 1]), rows: string[][] = []
      i += 2
      while (i < lines.length && row(lines[i]) && !separator(lines[i])) rows.push(cells(lines[i++]))
      if (!headers.length || headers.some(cell => !cell) || separators.length !== headers.length || !rows.length || rows.some(r => r.length !== headers.length)) errors.push('malformed_table')
      nodes.push({ kind: 'table', headers, rows })
      continue
    }
    if (row(current) && cells(current).length >= 2) errors.push('malformed_table')
    const heading = current.match(/^(#{1,6})\s+(.+)$/)
    if (heading) { nodes.push({ kind: 'h', level: Math.min(heading[1].length, 3) as 1 | 2 | 3, text: heading[2] }); i++; continue }
    const match = list(current)
    if (match) {
      const kind = match[1] ? 'ol' : 'ul'
      const items: string[] = []
      while (i < lines.length) {
        const next = list(lines[i])
        if (!next || Boolean(next[1]) !== Boolean(match[1])) break
        const parts = next[1] ? expandListParts(lines[i]) : [lines[i].trim()]
        items.push(...parts.map(part => part.replace(/^\s*(?:\d+[.):]|[-*•])\s+/, '')))
        i++
      }
      nodes.push({ kind, items, ...(match[1] ? { start: Number(match[1]) } : {}) }); continue
    }
    nodes.push({ kind: 'p', text: lines[i++] })
  }
  return { nodes, errors: [...new Set(errors)] }
}

export const parseContentNodes = (text: string): ChatContentNode[] => parseChatContent(text).nodes
