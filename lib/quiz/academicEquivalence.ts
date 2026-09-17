import { parseNumericExpression } from '../adaptive/evaluation/numericEquivalence'

export type WrittenAnswerMatch = 'exact' | 'academic_equivalence' | 'different' | 'undecided'

/** Remove presentation only. Never discard signs, case, exponents or units. */
function surface(value: string): string {
  let text = value.normalize('NFC').trim()
  for (let i = 0; i < 4; i++) {
    text = text.replace(/^```(?:latex|math|text)?\s*([\s\S]*?)\s*```$/i, '$1')
      .replace(/^(\*\*|__|`|\$\$|\$)([\s\S]*?)\1$/, '$2')
      .replace(/^\\\(([\s\S]*)\\\)$/, '$1').replace(/^\\\[([\s\S]*)\\\]$/, '$1').trim()
  }
  const supers = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻'
  const subs = '₀₁₂₃₄₅₆₇₈₉₊₋'
  const digits = '0123456789+-'
  return text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, run => `^{${[...run].map(c => digits[supers.indexOf(c)]).join('')}}`)
    .replace(/[₀₁₂₃₄₅₆₇₈₉₊₋]+/g, run => `_{${[...run].map(c => digits[subs.indexOf(c)]).join('')}}`)
    .replace(/−/g, '-').replace(/[×·]/g, '*').replace(/\\(?:times|cdot)\b/g, '*')
    .replace(/\\(?:,|;|!|quad\b|qquad\b)/g, ' ')
    .replace(/\\(?:mathrm|text)\{([A-Za-z]+)\}/g, '$1')
    .replace(/\s+/g, ' ').trim()
}

function orbitals(text: string): string | null {
  const compact = text.replace(/\s/g, '')
  const pattern = /([1-9])([spdfgh])(?:\^\{(\d+)\}|\^(\d+?)|(\d+?))(?=[1-9][spdfgh]|$)/igy
  const tokens: string[] = []
  const seen = new Set<string>()
  let end = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(compact))) {
    const shell = Number(match[1]); const orbital = match[2].toLowerCase()
    const l = 'spdfgh'.indexOf(orbital); const count = Number(match[3] ?? match[4] ?? match[5])
    const id = `${shell}${orbital}`
    if (shell <= l || count < 1 || count > 4 * l + 2 || seen.has(id)) return null
    seen.add(id); tokens.push(`${id}^${count}`); end = pattern.lastIndex
  }
  return tokens.length && end === compact.length ? tokens.join(' ') : null
}

function numeric(text: string) {
  return parseNumericExpression(text.replace(/\^\{([+-]?\d+(?:\.\d+)?)\}/g, '^$1'))
}

function expression(text: string): string | null {
  const normalized = text.replace(/([_^])\{([+-]?[\p{L}\d]+)\}/gu, '$1($2)')
    .replace(/([_^])([+-]?\d+|[\p{L}])/gu, '$1($2)')
  if (!/[\d_^=+*/()-]/.test(normalized)) return null
  const tokens = normalized.match(/[\p{L}]+|\d+(?:\.\d+)?|[_^=+*/()-]/gu)
  if (!tokens || tokens.join('') !== normalized.replace(/\s/g, '')) return null
  // A token boundary is significant: "1 2" != "12", "x y" != "xy".
  return tokens.join('|')
}

function prose(text: string): string | null {
  if (!/^[\p{L}\s,!.?¿¡]+$/u.test(text)) return null
  // Short symbols can be case-sensitive (Co/CO, Pa/pa, X/x).
  if (/^[A-Za-z]{1,3}$/.test(text) || /^(?:[A-Z][a-z]?)+$/.test(text)) return null
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[,!.?¿¡]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function compareAcademicAnswer(answer: string, expected: string): WrittenAnswerMatch {
  if (!answer.trim() || !expected.trim()) return 'undecided'
  if (answer.trim() === expected.trim()) return 'exact'
  const a = surface(answer); const b = surface(expected)
  if (a === b) return 'academic_equivalence'
  const oa = orbitals(a); const ob = orbitals(b)
  if (oa && ob) return oa === ob ? 'academic_equivalence' : 'different'
  const na = numeric(a); const nb = numeric(b)
  if (na && nb && Number.isFinite(na.value) && Number.isFinite(nb.value)) {
    // Case-sensitive units, exact numerical value; no rounding/fuzzy tolerance.
    return na.unit === nb.unit && na.value === nb.value ? 'academic_equivalence' : 'different'
  }
  const ea = expression(a); const eb = expression(b)
  if (ea && eb && ea === eb) return 'academic_equivalence'
  const pa = prose(a); const pb = prose(b)
  if (pa && pb && pa === pb) return 'exact'
  return 'undecided'
}

export function matchWrittenAnswer(answer: string, expectedForms: string[]): WrittenAnswerMatch {
  const matches = expectedForms.map(expected => compareAcademicAnswer(answer, expected))
  if (matches.includes('exact')) return 'exact'
  if (matches.includes('academic_equivalence')) return 'academic_equivalence'
  return matches.length && matches.every(match => match === 'different') ? 'different' : 'undecided'
}

export function academicDifferenceFeedback(answer: string, expected: string): string {
  const a = orbitals(surface(answer)); const b = orbitals(surface(expected))
  if (a && b) {
    const actual = new Map(a.split(' ').map(token => token.split('^') as [string, string]))
    const wanted = new Map(b.split(' ').map(token => token.split('^') as [string, string]))
    const differences: string[] = []
    for (const [orbital, count] of wanted) {
      if (!actual.has(orbital)) differences.push(`Falta el orbital ${orbital}, con ${count} electrones.`)
      else if (actual.get(orbital) !== count) differences.push(`En ${orbital} escribiste ${actual.get(orbital)} electrones; se esperan ${count}.`)
    }
    for (const orbital of actual.keys()) if (!wanted.has(orbital)) differences.push(`El orbital ${orbital} no forma parte de la configuración esperada.`)
    if (differences.length) return differences.join(' ')
  }
  const na = numeric(surface(answer)); const nb = numeric(surface(expected))
  if (na && nb && na.unit !== nb.unit) return 'La unidad de tu respuesta no coincide con la unidad esperada.'
  return 'El valor que escribiste difiere del valor esperado. Revisa los signos y exponentes.'
}
