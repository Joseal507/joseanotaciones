const NUMBER_SOURCE = String.raw`[-+]?(?:(?:\d{1,3}(?:[.,]\d{3})+)|\d+)(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)?(?:\s*[×x·]\s*10(?:\^|\*\*)?[-−+]?\d+)?`
const UNIT_BODY_SOURCE = String.raw`(?:[^{}\n]|\{[-−+]?\d+\})+`
const ACADEMIC_TOKEN = /(`[^`\n]+`|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|<math(?:\s[^>]*)?>[\s\S]*?<\/math>|\\ce\{(?:[^{}]|\{[^{}]*\})*\})/gi

const KNOWN_UNIT_SYMBOL = /^(?:h|s|m|g|kg|mol|A|K|cd|Hz|Pa|J|W|C|V|F|Ω|S|Wb|T|H|lm|lx|Bq|Gy|Sv|kat)$/u
const PARTIAL_BRACED_COMMAND = /(?:^|[^\p{L}])(?:ext|text|rm|mathrm)\{(?:[^{}\n]|\{[-−+]?\d+\})+\}/iu
const PARTIAL_COMPACT_COMMAND = /\b(?:ext|text|rm|mathrm)([A-Za-zµμΩ]+)\b/giu

function normalizeUnitBody(value: string): string {
  return value
    .replace(/\^\{([-−+]?\d+)\}/g, '^$1')
    .replace(/\s+/g, '')
    .trim()
}

function normalizePlainUnitSyntax(source: string): string {
  const scientific = source.replace(
    /((?:(?:\d{1,3}(?:[.,]\d{3})+)|\d+)(?:[.,]\d+)?)\s*\\times\s*10\^\{([-−+]?\d+)\}/gu,
    '$1 × 10^$2',
  )
  const command = new RegExp(
    `(${NUMBER_SOURCE})\\s*\\\\(?:text|mathrm)\\s*\\{(${UNIT_BODY_SOURCE})\\}`,
    'gu',
  )
  const validCommandsNormalized = scientific.replace(command, (_, value: string, unit: string) =>
    `${value.trim()} ${normalizeUnitBody(unit)}`)

  // "\text{m}" mal interpretado por JSON/JavaScript se convierte en TAB + "ext{m}".
  const damagedBraced = new RegExp(
    `(${NUMBER_SOURCE})[ \\u00a0]*(?:\\text|(?:ext|text|rm|mathrm))\\s*\\{(${UNIT_BODY_SOURCE})\\}`,
    'gu',
  )
  const bracedNormalized = validCommandsNormalized.replace(damagedBraced, (_, value: string, unit: string) =>
    `${value.trim()} ${normalizeUnitBody(unit)}`)

  const damagedCompact = new RegExp(
    `(${NUMBER_SOURCE})\\s+(ext|text|rm|mathrm)([A-Za-zµμΩ]+)\\b`,
    'gu',
  )
  return bracedNormalized.replace(
    damagedCompact,
    (whole: string, value: string, _prefix: string, unit: string) =>
      KNOWN_UNIT_SYMBOL.test(unit) ? `${value.trim()} ${unit}` : whole,
  )
}

function repairMathToken(token: string): string {
  // Dentro de matemáticas solo esta forma con llaves es inequívoca.
  return token.replace(/\text(?=\{(?:[^{}\n]|\{[-−+]?\d+\})+\})/gu, '\\text')
}

export function normalizeAcademicUnitSource(source: string): string {
  let result = ''
  let cursor = 0
  for (const match of source.matchAll(ACADEMIC_TOKEN)) {
    const index = match.index || 0
    result += normalizePlainUnitSyntax(source.slice(cursor, index))
    result += repairMathToken(match[0])
    cursor = index + match[0].length
  }
  return result + normalizePlainUnitSyntax(source.slice(cursor))
}

export function hasSuspiciousPartialUnitCommand(value: string): boolean {
  if (PARTIAL_BRACED_COMMAND.test(value)) return true
  PARTIAL_COMPACT_COMMAND.lastIndex = 0
  for (const match of value.matchAll(PARTIAL_COMPACT_COMMAND)) {
    if (KNOWN_UNIT_SYMBOL.test(match[1])) return true
  }
  return false
}

