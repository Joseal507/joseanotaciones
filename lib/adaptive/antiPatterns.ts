// ═══════════════════════════════════════════════════════════════
// StudyAL — Anti-Patterns
// Lo que ALAI JAMÁS debe hacer. Estos errores rompen la confianza.
// ═══════════════════════════════════════════════════════════════

export const ANTI_PATTERNS = [
  {
    id: 'assume_prior_knowledge_when_zero',
    description: 'Asumir conocimiento previo cuando el estudiante dijo "no sé nada"',
    badExamples: [
      '"Como probablemente recuerdas..."',
      '"Seguramente ya has visto..."',
      '"Como sabes de tu curso anterior..."',
      '"La física clásica, que ya conoces..."',
    ],
    whenToDetect: (text: string, ctx: { studentKnowsNothing: boolean }) => {
      if (!ctx.studentKnowsNothing) return false
      return /como (probablemente|seguramente|sabes|ya|habrás) (recuerdas|sabes|vist|estudiad|aprendid)/i.test(text)
    },
  },
  {
    id: 'ask_about_unexplained',
    description: 'Preguntar sobre un concepto que aún no se explicó',
    badExamples: [
      'Empezar la sesión con "Define qué es la mitocondria"',
      'Preguntar "¿Cuáles son las limitaciones de X?" antes de explicar X',
    ],
    whenToDetect: (text: string) => {
      // Heurística: si el texto es la apertura y comienza con "¿Qué es" o "¿Cuáles son"
      return /^[¿]?(qué es|cuáles son|cuál es|define|explica qué)/i.test(text.trim())
    },
  },
  {
    id: 'name_before_problem',
    description: 'Introducir nombres propios antes de explicar el problema que resolvieron',
    badExamples: [
      '"Niels Bohr propuso un modelo atómico..."',
      '"Según Einstein, la energía..."',
      '"Watson y Crick descubrieron..."',
    ],
    whenToDetect: (text: string) => {
      // Si el primer párrafo empieza con nombre propio + verbo
      const firstSentence = text.split(/[.!?]/)[0] || ''
      return /^[A-ZÁÉÍÓÚ][a-záéíóú]+\s+(propuso|descubrió|inventó|formuló|teorizó)/.test(firstSentence)
    },
  },
  {
    id: 'empty_praise',
    description: 'Felicitaciones vacías sin contenido específico',
    badExamples: [
      '"¡Excelente!"',
      '"¡Muy bien!"',
      '"¡Perfecto!"',
      '"¡Correcto! Siguiente pregunta."',
    ],
    whenToDetect: (text: string) => {
      const normalized = text.toLowerCase().trim()
      // Detecta si la respuesta es solo una felicitación corta
      if (normalized.length < 50 && /^[¡]?(excelente|perfecto|muy bien|fantástico|correcto)/i.test(normalized)) {
        return true
      }
      // O si hay 2+ felicitaciones vacías en el texto
      const matches = (text.match(/¡(excelente|perfecto|muy bien|fantástico)!/gi) || [])
      return matches.length >= 2
    },
  },
  {
    id: 'meta_thinking_visible',
    description: 'Verbalizar el meta-proceso del sistema',
    badExamples: [
      '"Voy a cambiar de estrategia"',
      '"Déjame pensar..."',
      '"ALAI cree que..."',
      '"Mi hipótesis es..."',
      '"Detecté que no entiendes"',
    ],
    whenToDetect: (text: string) => {
      return /voy a cambiar (de )?estrategia|déjame pensar|alai (cree|piensa)|mi hipótesis|detecté que/i.test(text)
    },
  },
  {
    id: 'just_correct_or_wrong',
    description: 'Solo decir "correcto" o "incorrecto" sin explicar',
    badExamples: [
      '"Incorrecto. La respuesta era B."',
      '"Correcto. Siguiente."',
      '"Esa no es la respuesta."',
    ],
    whenToDetect: (text: string) => {
      const normalized = text.toLowerCase().trim()
      if (normalized.length < 80) {
        return /^(incorrecto|correcto|esa no es|no, es)/i.test(normalized)
      }
      return false
    },
  },
  {
    id: 'academic_distance',
    description: 'Tono académico distante en lugar de conversacional',
    badExamples: [
      '"A continuación procederemos a analizar..."',
      '"En el presente análisis se observa..."',
      '"Cabe destacar que..."',
      '"Es menester comprender..."',
    ],
    whenToDetect: (text: string) => {
      return /(a continuación procederemos|en el presente análisis|cabe destacar|es menester|en virtud de)/i.test(text)
    },
  },
  {
    id: 'formula_without_intuition',
    description: 'Introducir fórmulas antes de construir intuición',
    badExamples: [
      'Empezar con "La ecuación es E = mc²"',
      'Listar fórmulas sin explicar qué representan',
    ],
    whenToDetect: (text: string) => {
      // Detecta fórmulas en las primeras 100 chars
      const start = text.slice(0, 100)
      return /[A-Z]\s*=\s*[A-Za-z0-9]/.test(start) || /\\frac|\\int|\\sum/.test(start)
    },
  },
  {
    id: 'list_dump',
    description: 'Listar muchos conceptos sin construir narrativa',
    badExamples: [
      'Listar 5+ términos uno tras otro sin contexto',
      'Bullet points secos sin explicación',
    ],
    whenToDetect: (text: string) => {
      const bullets = (text.match(/^[\s]*[-•·]\s/gm) || []).length
      return bullets >= 5
    },
  },
  {
    id: 'ignore_user_context',
    description: 'Ignorar contexto crítico del usuario (examen mañana, no sabe nada)',
    badExamples: [
      'No mencionar examen cuando el estudiante dijo "examen mañana"',
      'Hablar como si tuviera tiempo cuando dijo urgencia',
    ],
    whenToDetect: (text: string, ctx: { hasExamSoon: boolean }) => {
      if (!ctx.hasExamSoon) return false
      // Si es una respuesta larga y no menciona examen/tiempo/urgencia
      return text.length > 250 && !/examen|prueba|tiempo|mañana|hoy/i.test(text)
    },
  },
]

// ═══════════════════════════════════════════════════════════════
// DETECTAR violaciones en un texto generado
// ═══════════════════════════════════════════════════════════════
export interface AntiPatternViolation {
  id: string
  description: string
  badExamples: string[]
}

export function detectAntiPatterns(
  text: string,
  context: {
    studentKnowsNothing?: boolean
    hasExamSoon?: boolean
  } = {}
): AntiPatternViolation[] {
  const violations: AntiPatternViolation[] = []

  for (const ap of ANTI_PATTERNS) {
    try {
      const violated = (ap.whenToDetect as any)(text, context)
      if (violated) {
        violations.push({
          id: ap.id,
          description: ap.description,
          badExamples: ap.badExamples,
        })
      }
    } catch {
      // Si la detección falla, no rompe
    }
  }

  return violations
}

// ═══════════════════════════════════════════════════════════════
// CONSTRUIR sección de anti-patterns para inyectar en prompts
// (solo los más críticos según contexto, no todos)
// ═══════════════════════════════════════════════════════════════
export function getCriticalAntiPatterns(context: {
  studentKnowsNothing?: boolean
  hasExamSoon?: boolean
  isFirstInteraction?: boolean
}): string {
  const critical: typeof ANTI_PATTERNS[number][] = []

  // Siempre evitar estos
  critical.push(ANTI_PATTERNS.find(a => a.id === 'empty_praise')!)
  critical.push(ANTI_PATTERNS.find(a => a.id === 'just_correct_or_wrong')!)
  critical.push(ANTI_PATTERNS.find(a => a.id === 'meta_thinking_visible')!)

  // Contextuales
  if (context.studentKnowsNothing) {
    critical.push(ANTI_PATTERNS.find(a => a.id === 'assume_prior_knowledge_when_zero')!)
  }
  if (context.hasExamSoon) {
    critical.push(ANTI_PATTERNS.find(a => a.id === 'ignore_user_context')!)
  }
  if (context.isFirstInteraction) {
    critical.push(ANTI_PATTERNS.find(a => a.id === 'ask_about_unexplained')!)
    critical.push(ANTI_PATTERNS.find(a => a.id === 'name_before_problem')!)
  }

  const lines = ['═══ NUNCA HAGAS ESTO ═══']
  for (const ap of critical.filter(Boolean)) {
    lines.push(`✗ ${ap.description}`)
    lines.push(`  Ejemplo de lo que NO hacer: ${ap.badExamples[0]}`)
  }
  return lines.join('\n')
}
