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

// Evaluador seguro de expresiones aritméticas con TABLA DE VARIABLES — misma
// familia que evaluateExpression (recursive descent, sin eval()/Function()),
// generalizado para code_execution: en vez de una única variable `x`, resuelve
// cualquier identificador contra `variables`. Rechaza (devuelve null) CUALQUIER
// token fuera de dígitos/+-*/()/identificadores conocidos — una llamada a
// función, un identificador no definido, o cualquier token sobrante tras
// parsear, hace fallar cerrado en vez de adivinar. Esto es lo que acota el
// "subset seguro" de deriveTraceFromCode: nunca ejecuta código arbitrario,
// solo evalúa aritmética pura sobre variables ya conocidas.
export function evaluateArithmeticWithVariables(expression: string, variables: Record<string, number>): number | null {
  const tokens = expression.replace(/\s+/g, '').match(/(\d+\.?\d*|[+\-*/()]|[A-Za-z_]\w*)/g)
  if (!tokens || !tokens.length) return null
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  function parseExpr(): number | null {
    let value = parseTerm()
    if (value === null) return null
    while (peek() === '+' || peek() === '-') {
      const op = next()
      const rhs = parseTerm()
      if (rhs === null) return null
      value = op === '+' ? value + rhs : value - rhs
    }
    return value
  }
  function parseTerm(): number | null {
    let value = parseFactor()
    if (value === null) return null
    while (peek() === '*' || peek() === '/') {
      const op = next()
      const rhs = parseFactor()
      if (rhs === null) return null
      value = op === '*' ? value * rhs : value / rhs
    }
    return value
  }
  function parseFactor(): number | null {
    let sign = 1
    while (peek() === '+' || peek() === '-') { if (next() === '-') sign *= -1 }
    const base = parseBase()
    return base === null ? null : sign * base
  }
  function parseBase(): number | null {
    const token = next()
    if (token === undefined) return null
    if (token === '(') {
      const value = parseExpr()
      if (value === null) return null
      if (peek() === ')') { next() } else { return null }
      return value
    }
    if (/^\d/.test(token)) {
      const num = Number(token)
      return Number.isFinite(num) ? num : null
    }
    if (/^[A-Za-z_]\w*$/.test(token)) {
      return token in variables ? variables[token] : null
    }
    return null
  }

  try {
    const result = parseExpr()
    // Tokens sobrantes (p.ej. una llamada a función no soportada como "foo(x)")
    // significan que la expresión NO cayó enteramente dentro del subset seguro.
    if (result === null || pos !== tokens.length) return null
    return Number.isFinite(result) ? result : null
  } catch {
    return null
  }
}
