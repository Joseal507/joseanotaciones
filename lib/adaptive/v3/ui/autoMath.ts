// ═══════════════════════════════════════════════════════════════
// autoMath v3 — Detecta expresiones matemáticas/químicas en texto
// y las envuelve en $...$ para renderizar con KaTeX.
// ═══════════════════════════════════════════════════════════════

const SUP_TO_ASCII: Record<string, string> = {
  '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁻':'-','⁺':'+',
}
const SUB_TO_ASCII: Record<string, string> = {
  '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9',
}

// Normalizar Unicode químico a ASCII, SIN colapsar espacios de texto normal
function normalizeUnicode(text: string): string {
  let s = text
  // FIX: colapsar fórmulas matemáticas partidas verticalmente
  // Detectar bloques de 3+ líneas cortas consecutivas (cada una 1-4 chars)
  // que contengan = o ^ o dígitos → son fórmulas rotas
  s = s.replace(/(?:^|\n)((?:[A-Za-z0-9=+\-*/^_.,\s]{1,4}\n){3,}[A-Za-z0-9=+\-*/^_.,\s]{1,10})/g, (block) => {
    // Si el bloque tiene = o ^ es fórmula
    if (/[=^]/.test(block)) {
      return '\n' + block.replace(/\s*\n\s*/g, '')
    }
    return block
  })
  // Convertir subíndices Unicode a ASCII (H₃ → H3)
  s = s.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, c => SUB_TO_ASCII[c] || c)
  // Convertir superíndices Unicode a ASCII (X⁺ → X+, X⁻ → X-)
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]/g, c => SUP_TO_ASCII[c] || c)
  // Quitar caracteres invisibles
  s = s.replace(/[\u2061-\u2064\u200B-\u200F\uFEFF]/g, '')
  // Normalizar operadores Unicode a ASCII
  s = s.replace(/×/g, 'x')       // multiplicación Unicode
  s = s.replace(/−/g, '-')       // minus Unicode
  s = s.replace(/[–—]/g, '-')    // en-dash y em-dash
  return s
}

// Colapsar espacios SOLO en patrones que claramente son fórmulas químicas
// Ej: "H 3 O +" → "H3O+" pero "en 1789" queda igual
function collapseChemistrySpaces(text: string): string {
  let s = text
  // Patrón A: Letra + dígito + letra (química: "H 3 O", "C 6 H 12 O 6")
  s = s.replace(/\b([A-Z][a-z]?)(\s+\d+\s+[A-Z][a-z]?)+\b/g, (match) => match.replace(/\s+/g, ''))
  // Patrón B: 2 letras químicas con espacio en contexto de fórmula (rodeado de '=' o '[' '(' '+' '-')
  // Ej: "p H = ..." → "pH = ..."; NO afecta "es Historia"
  s = s.replace(/(?<=^|[\s(\[+\-=])([A-Za-z])\s+([A-Z][a-z]?)(?=\s*[=+\-\[\]()]|\s+\d)/g, '$1$2')
  // Pegar signo +/- al final: "H3O +" → "H3O+", "OH -" → "OH-"
  s = s.replace(/\b([A-Z][A-Za-z0-9]*\d?)\s+([+\-])(?=\s|$|[.,;:!?)\]])/g, '$1$2')
  // Pegar signo dentro de corchetes: "[ H 3 O + ]" ya normalizado a "[H3O+]"
  s = s.replace(/\[\s+/g, '[')
  s = s.replace(/\s+\]/g, ']')
  return s
}

// Convierte "OH" → "\text{OH}", "H3O" → "\text{H}_3\text{O}", "H2SO4" → "\text{H}_2\text{SO}_4"
function chemToLatex(formula: string): string {
  // Split por dígitos: "H2SO4" → ["H", "2", "SO", "4"]
  const parts = formula.match(/[A-Za-z]+|\d+/g) || []
  let result = ''
  for (const p of parts) {
    if (/^\d+$/.test(p)) {
      result += '_{' + p + '}'
    } else {
      result += '\\text{' + p + '}'
    }
  }
  return result || '\\text{' + formula + '}'
}

// Convierte una expresión detectada a LaTeX
function toLatex(expr: string): string {
  let s = expr.trim()

  // Iones en corchetes: [H+] → [\text{H}^+], [H3O+] → [\text{H}_3\text{O}^+]
  s = s.replace(/\[([A-Za-z0-9]+)\+\]/g, (_m, inner) => '[' + chemToLatex(inner) + '^+]')
  s = s.replace(/\[([A-Za-z0-9]+)-\]/g, (_m, inner) => '[' + chemToLatex(inner) + '^-]')

  // Iones y fórmulas con signo: H+, OH-, H3O+, H3O-, NH4+
  s = s.replace(/\b([A-Z][A-Za-z]*\d*(?:[A-Z][A-Za-z]*\d*)*)([+\-])/g, (_m, sym, sign) => chemToLatex(sym) + '^' + sign)

  // Fórmulas químicas sueltas con dígitos: H2O, CO2, H2SO4
  s = s.replace(/\b([A-Z][A-Za-z]*\d+(?:[A-Z][A-Za-z]*\d*)*)\b/g, (_m, formula) => chemToLatex(formula))

  // Constantes: Kw → K_w, Ka → K_a, Kb → K_b, Kc → K_c
  s = s.replace(/\bK([wabc])\b/g, 'K_$1')

  // Log / ln / sin / cos
  s = s.replace(/\blog\b/g, '\\log')
  s = s.replace(/\bln\b/g, '\\ln')
  s = s.replace(/\bsin\b/g, '\\sin')
  s = s.replace(/\bcos\b/g, '\\cos')
  s = s.replace(/\btan\b/g, '\\tan')

  // Multiplicación con exponente explícito: 1x10^-14 → 1 \times 10^{-14}
  s = s.replace(/(\d+(?:\.\d+)?)\s*[x×]\s*10\^(-?\d+)/gi, '$1 \\times 10^{$2}')
  // Multiplicación con exponente implícito: 1x10-14 → 1 \times 10^{-14} (Unicode normalizado)
  s = s.replace(/(\d+(?:\.\d+)?)\s*[x×]\s*10(-\d+)(?!\d)/g, '$1 \\times 10^{$2}')

  // Exponentes generales: X^-14 → X^{-14}, X^n → X^{n}, X^2n → X^{2n}
  s = s.replace(/\^(-?\d+)/g, '^{$1}')
  s = s.replace(/\^([a-zA-Z])/g, '^{$1}')  // 4^n → 4^{n}
  s = s.replace(/\^(\d*[a-zA-Z])/g, '^{$1}')  // x^2n → x^{2n}

  // Subíndices explícitos: E_n → E_{n}, X_1 → X_{1}
  s = s.replace(/([A-Za-z])_(\d+)/g, '$1_{$2}')
  s = s.replace(/([A-Za-z])_([a-zA-Z])/g, '$1_{$2}')

  // Variables con subíndice implícito: En → E_n, Vn → V_n (solo 2 chars)
  // Solo cuando la variable es LETRA+letra en contexto de ecuación
  // Ej: 'En = -13.6' → 'E_n = -13.6'
  s = s.replace(/\b([A-Z])([a-z])\b(?=\s*=)/g, '$1_{$2}')

  // División con dígito pegado a letra (n2 → n^2): SIEMPRE aplicar exponente
  // Ej: 13.6/n2 → \frac{13.6}{n^{2}}, x/y3 → \frac{x}{y^{3}}
  s = s.replace(/(-?\d+(?:\.\d+)?)\s*\/\s*([a-zA-Z])(\d+)/g, '\\frac{$1}{$2^{$3}}')
  // Sin división: letra pegada a dígito al final (n2 → n^{2})
  s = s.replace(/([a-zA-Z])(\d+)(?![a-zA-Z0-9])/g, '$1^{$2}')
  // División con exponente marcado: 13.6/n^2 → \frac{13.6}{n^{2}}
  s = s.replace(/(-?\d+(?:\.\d+)?)\s*\/\s*([a-zA-Z])\^\{?(\d+)\}?/g, '\\frac{$1}{$2^{$3}}')

  // Unidades comunes: eV, keV, MeV → \text{eV}
  s = s.replace(/\b(eV|keV|MeV|GeV|J|W|Hz|kg|mol|K)\b/g, '\\,\\text{$1}')

  return s
}

// Detecta y colapsa duplicaciones del tipo "X = Y X = Y" (con o sin espacios)
// Estrategia: dividir el texto en tokens y buscar secuencias A B donde
// normalize(A) === normalize(B) y ambos contienen "="
function collapseDuplications(text: string): string {
  const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase()

  // Estrategia 1: buscar el mismo patrón contiguo con espacio en medio
  // Regex: capturar un fragmento con '=' seguido de espacio+mismo fragmento
  // Usa backreferences con \1
  // Fragmento: no-espacio con '=' dentro, longitud 4-80 chars
  const dupExactRe = /([^\s]{4,80}=[^\s]{1,60})\s+\1(?=\s|$|[.,;:!?])/g
  let result = text.replace(dupExactRe, '$1')

  // Estrategia 2: duplicación con posibles espacios internos distintos
  // Ej: "Kw = 1x10^-14 Kw = 1x10^-14"
  // Buscar dos ocurrencias del mismo patrón (con espacios normalizados) contiguas
  const chunks = result.split(/([.;\n!?])/)
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]
    if (!chunk.includes('=')) continue
    // Dentro de este chunk, dividir por doble-espacio o por 'variable=...'
    // Buscar patrón: (frase con =) (frase con =) donde normalize son iguales
    const eqParts = chunk.match(/[A-Za-z][A-Za-z0-9_]*\s*=\s*[^=]{1,60}?(?=\s+[A-Za-z][A-Za-z0-9_]*\s*=|$)/g)
    if (!eqParts || eqParts.length < 2) continue
    // Verificar si hay pares consecutivos idénticos
    let modified = chunk
    for (let i = 0; i < eqParts.length - 1; i++) {
      const a = eqParts[i]
      const b = eqParts[i+1]
      if (normalize(a) === normalize(b)) {
        // Remover la segunda ocurrencia b (con su whitespace previo)
        const escapedB = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp('\\s+' + escapedB, 'g')
        modified = modified.replace(re, '')
      }
    }
    chunks[ci] = modified
  }
  return chunks.join('')
}

// Procesa un tramo (sin $...$) envolviendo expresiones matemáticas
function processSegment(text: string): string {
  let result = text

  // Patrón 1: expresiones con "=" y símbolos técnicos
  const eqPattern = /([A-Za-z][A-Za-z0-9\^_]*(?:\([A-Za-z0-9\s,]*\))?(?:\s*[+\-]\s*[A-Za-z][A-Za-z0-9\^_]*(?:\([A-Za-z0-9\s,]*\))?)*\s*=\s*(?:\([^)]*\)|[^,;\n!?$)]|\.(?=\d))+?)(?=\s+(?:a\s|de\s|del\s|en\s|es\s|es\.|para\s|con\s|cuando\s|donde\s|si\s|porque\s|así\s|entonces\s|siempre\s|solo\s|mediante\s|dado\s|válida\s|válido\s|describe\s|explica\s|muestra\s|indica\s|representa\s|significa\s|permite\s|se\s|nos\s|el\s|la\s|los\s|las\s|un\s|una\s)|[,;!?\n]|\.\s|\.$|$)/g
  result = result.replace(eqPattern, (match) => {
    // Envolver si contiene símbolos matemáticos claros, o si es una ecuación X = Y con valor numérico
    const hasMathSymbols = /[\[\]+\-\^*/]|\blog\b|\bln\b|\bsin\b|\bcos\b|\btan\b|10\^|\bK[wabc]\b|\btimes\b/.test(match)
    const isNumericEq = /=\s*-?\d/.test(match) && /^[A-Za-z][A-Za-z0-9_]{0,10}\s*=/.test(match)
    if (hasMathSymbols || isNumericEq) {
      return '$' + toLatex(match) + '$'
    }
    return match
  })
  // Patrón 2: iones en corchetes [H+], [OH-], [H3O+]
  result = result.replace(/\[([A-Za-z0-9]+[+\-])\]/g, (m) => '$' + toLatex(m) + '$')

  // Patrón 3: fórmulas químicas sueltas con dígitos (H2O, CO2, H3O+, H3O-)
  // El signo +/- al final es parte de la fórmula, EXCEPTO si es conector químico
  result = result.replace(/(^|[\s(,])([A-Z][A-Za-z]*\d+(?:[A-Z][A-Za-z]*\d*)*)([+\-]?)(?=([\s.,;:)!?]|$))/g, (m, pre, formula, sign, after) => {
    // Si hay signo y después viene otra fórmula química (espacio + mayúscula), es conector
    if (sign) {
      const restStart = pre.length + formula.length + sign.length
      // Buscar en el resto de la cadena original si viene otra fórmula
      // Para eso pasamos por args de replace pero solo tenemos el match
      // Alternativa: usar heurística — si after es espacio + mayúscula pendiente, dejar signo fuera
      // El grupo after solo captura 1 char, así que confiamos en el post-check
    }
    return pre + '$' + toLatex(formula + (sign || '')) + '$'
  })
  // POST-FIX crítico: revertir cuando una fórmula química con carga fue seguida de otra fórmula
  // Ej: "$H2O^+$ $CO2$" → "$H2O$ + $CO2$"
  // Detectar: $ \text{X}_{N}^{+|-} $ seguido de espacio y $ \text{otro}
  result = result.replace(/\$(\\text\{[A-Z][A-Za-z]*\}(?:_\{\d+\}(?:\\text\{[A-Z][A-Za-z]*\})?(?:_\{\d+\})?)+)\^([+\-])\$(\s+)\$/g,
    (_m, formulaLatex, sign, space) => '$' + formulaLatex + '$' + space + sign + ' $')

  // Patrón 3.5: variables con subíndice implícito seguidas de = (En = ..., Vn = ...)
  result = result.replace(/\b([A-Z][a-z])\s*=\s*(-?\d+(?:\.\d+)?[^,.;!?\n]*)/g, (m) => {
    // Solo si contiene una unidad o operador matemático
    if (/eV|keV|MeV|\^|\//.test(m)) {
      return '$' + toLatex(m) + '$'
    }
    return m
  })

  // Patrón 3.6: exponentes sueltos: 4^n, x^2, a^b
  result = result.replace(/\b([a-zA-Z0-9]+)\^(-?[a-zA-Z0-9]+)\b/g, (m, base, exp) => {
    return '$' + base + '^{' + exp + '}$'
  })

  // Patrón 3.7: notación científica: 1x10^-14, 3x10^8, 2.5x10^-3
  result = result.replace(/(\d+(?:\.\d+)?)\s*[x×]\s*10\^?(-?\d+)/g, (m, coef, exp) => {
    return '$' + coef + ' \\times 10^{' + exp + '}$'
  })

  // Patrón 4: iones sueltos sin dígitos: H+, OH-, Na+, Cl-
  // Restricción: NO capturar si después del +/- viene una fórmula química o mayúscula
  // (para no romper "H2O + CO2" convirtiendo H2O en H2O+)
  result = result.replace(/(^|[\s(,])([A-Z][A-Za-z]*)([+\-])(?=[\s.,;:)!?]|$)/g, (fullMatch, pre, sym, sign, offset, str) => {
    const afterEnd = offset + fullMatch.length
    const rest = str.slice(afterEnd)
    const nextNonSpace = rest.match(/^\s+([A-Z])/)
    if (nextNonSpace) {
      return fullMatch
    }
    return pre + '$' + toLatex(sym + sign) + '$'
  })

  // POST-FIX FINAL: reunificar ecuaciones que quedaron cortadas dentro de paréntesis
  // Ej: "(pH = -log$[\text{H}^+]$)" → "($pH = -\log[\text{H}^+]$)"
  result = result.replace(/\(([A-Za-z][A-Za-z0-9_]{0,10}\s*=\s*[^$()]*?)(\$[^$]+\$)([^()$]*)\)/g, (_m, prefix, midLatex, suffix) => {
    const inner = midLatex.slice(1, -1)
    return '($' + toLatex(prefix) + inner + suffix + '$)'
  })

  return result
}

// FUNCIÓN PRINCIPAL
export function autoMath(text: string): string {
  if (!text) return ''

  // Paso 1: normalizar Unicode → ASCII
  let s = normalizeUnicode(text)

  // Paso 2: colapsar espacios SOLO en patrones claramente químicos
  s = collapseChemistrySpaces(s)

  // Paso 3: detectar y colapsar duplicaciones "X X"
  s = collapseDuplications(s)

  // Paso 4: procesar solo los tramos NO envueltos en $...$
  const parts = s.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$)/g)
  const processed = parts.map(part => {
    if (part.startsWith('$')) return part
    return processSegment(part)
  })

  return processed.join('')
}
