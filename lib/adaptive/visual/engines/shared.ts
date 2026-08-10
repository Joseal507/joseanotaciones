export const normalizeToken = (value: unknown): string =>
  typeof value === 'string'
    ? value.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, '')
    : ''

// Evaluador seguro de expresiones polinómicas simples en x — sin eval(). Soporta
// +, -, *, /, ^, paréntesis, negativos y la variable x. Usado únicamente para calcular
// f(x) en puntos concretos a partir de una expresión YA extraída literalmente del
// material (nunca para inventar la expresión en sí).
export function evaluateExpression(expression: string, x: number): number | null {
  // Multiplicación implícita: "2x" / "2(x+1)" / "x(" -> inserta "*" explícito antes
  // de tokenizar, para que el parser (sin soporte nativo de yuxtaposición) no
  // trunque la expresión al primer factor.
  const withExplicitMultiplication = expression
    .replace(/(\d)\s*([xX(])/g, '$1*$2')
    .replace(/([xX)])\s*(\d)/g, '$1*$2')
  const tokens = withExplicitMultiplication.replace(/\s+/g, '').match(/(\d+\.?\d*|[+\-*/^()]|x)/gi)
  if (!tokens) return null
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  function parseExpr(): number {
    let value = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const op = next()
      const rhs = parseTerm()
      value = op === '+' ? value + rhs : value - rhs
    }
    return value
  }
  function parseTerm(): number {
    let value = parseFactor()
    while (peek() === '*' || peek() === '/') {
      const op = next()
      const rhs = parseFactor()
      value = op === '*' ? value * rhs : value / rhs
    }
    return value
  }
  function parseFactor(): number {
    let sign = 1
    while (peek() === '+' || peek() === '-') { if (next() === '-') sign *= -1 }
    let value = parseBase()
    if (peek() === '^') { next(); const exp = parseFactor(); value = Math.pow(value, exp) }
    return sign * value
  }
  function parseBase(): number {
    const token = next()
    if (token === '(') {
      const value = parseExpr()
      if (peek() === ')') next()
      return value
    }
    if (token?.toLowerCase() === 'x') return x
    const num = Number(token)
    return Number.isFinite(num) ? num : NaN
  }

  try {
    const result = parseExpr()
    return Number.isFinite(result) ? result : null
  } catch {
    return null
  }
}
