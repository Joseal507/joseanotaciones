export type TeachingLayoutBlock =
  | { kind: 'explanation' | 'definition' | 'formula' | 'worked_example' | 'warning' | 'common_error' | 'key_takeaways' | 'summary' | 'memory_hook'; text: string }
  | { kind: 'bullets' | 'numbered_steps' | 'sequence'; items: string[] }
  | { kind: 'comparison'; columns: Array<{ heading: string; items: string[] }> }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'cause_effect'; causes: string[]; effects: string[] }

const clean = (value: string): string => value.trim()

function parseTable(lines: string[]): TeachingLayoutBlock | null {
  const rows = lines
    .filter(line => line.includes('|'))
    .map(line => line.split('|').map(clean).filter(Boolean))
    .filter(row => row.length >= 2 && !row.every(cell => /^:?-{2,}:?$/.test(cell)))
  if (rows.length < 2) return null
  const width = rows[0].length
  if (rows.some(row => row.length !== width)) return null
  return { kind: 'table', headers: rows[0], rows: rows.slice(1) }
}

function parseComparison(lines: string[]): TeachingLayoutBlock | null {
  const pairs = lines.map(line => line.match(/^([^:]{1,60})\s+(?:vs\.?|frente a|en cambio)\s+([^:]{1,60})(?::\s*(.+))?$/i)).filter(Boolean)
  if (!pairs.length) return null
  const match = pairs[0]!
  return {
    kind: 'comparison',
    columns: [
      { heading: clean(match[1]), items: match[3] ? [clean(match[3])] : [] },
      { heading: clean(match[2]), items: [] },
    ],
  }
}

/**
 * Presentación determinista basada únicamente en la estructura del contenido.
 * No acepta HTML, no consulta la materia y no agrega hechos ausentes.
 */
export function buildTeachingLayout(input: { type: string; content: string; keyPoints?: string[] }): TeachingLayoutBlock[] {
  const text = clean(input.content)
  if (!text) return []
  const lines = text.split(/\n+/).map(clean).filter(Boolean)
  const table = parseTable(lines)
  const enumerated = lines.map(line => line.match(/^\d+[.)]\s+(.+)$/)?.[1]).filter((line): line is string => Boolean(line))
  const bullets = lines.map(line => line.match(/^[-•*]\s+(.+)$/)?.[1]).filter((line): line is string => Boolean(line))
  const type = input.type.toLowerCase()

  let primary: TeachingLayoutBlock
  if (table) primary = table
  else if (enumerated.length >= 2) primary = { kind: 'numbered_steps', items: enumerated }
  else if (bullets.length >= 2) primary = { kind: 'bullets', items: bullets }
  else if (parseComparison(lines)) primary = parseComparison(lines)!
  else if (/error com[uú]n|confundir|equivocaci[oó]n frecuente/i.test(text)) primary = { kind: 'common_error', text }
  else if (/advertencia|precauci[oó]n|evita|no olvides/i.test(text)) primary = { kind: 'warning', text }
  else if (type === 'formula' || /^\s*[a-z][\w()]*\s*=.+$/im.test(text)) primary = { kind: 'formula', text }
  else if (type === 'example' || /(?:sustitu(?:ye|imos)|resultado|ejemplo resuelto)[\s\S]*=/i.test(text)) primary = { kind: 'worked_example', text }
  else if (/^(?:definici[oó]n\s*:|.{1,60}\s+se define como)/i.test(text)) primary = { kind: 'definition', text }
  else if (/\b(?:causa|provoca|produce|conduce a|da lugar a)\b/i.test(text)) primary = { kind: 'cause_effect', causes: [text], effects: [] }
  else if (type === 'summary' || /^resumen\s*:/i.test(text)) primary = { kind: 'summary', text }
  else primary = { kind: 'explanation', text }

  const keyPoints = [...new Set((input.keyPoints || []).map(clean).filter(Boolean))]
  return keyPoints.length > 1 && primary.kind !== 'key_takeaways'
    ? [primary, { kind: 'key_takeaways', text: keyPoints.join(' · ') }]
    : [primary]
}
