// ═══════════════════════════════════════════════════════════════
// StudyAL — Teaching Memory
//
// La memoria pedagógica de ALAI.
// Antes "Conversation Library" (estática).
// Ahora: viva, con peso, evoluciona con cada sesión real.
//
// 4 fuentes:
//   - handcrafted (escritos a mano, semilla)
//   - validated (validados por reflexión)
//   - top_rated (alta efectividad medida)
//   - reflection_generated (creados por el sistema)
//
// Esta es la única estructura que va a crecer con el tiempo.
// Todo lo demás está cerrado.
// ═══════════════════════════════════════════════════════════════

export type MemorySource = 'handcrafted' | 'validated' | 'top_rated' | 'reflection_generated'

export type TeachingSituation =
  | 'opening'
  | 'failure'
  | 'success'
  | 'curiosity'
  | 'recover_motivation'
  | 'connection'
  | 'closing'
  | 'misconception'
  | 'aha_moment'

export interface TeachingMemoryEntry {
  id: string
  situation: TeachingSituation

  // Contexto donde se usó
  context: {
    subject?: string         // materia (biología, física, etc)
    careerFit?: string[]     // carreras donde funciona bien
    errorType?: string       // tipo de error si aplica
    objective?: string       // qué quería lograr
  }

  // El ejemplo
  scenario: string
  badResponse: string
  averageResponse: string
  excellentResponse: string
  whyExcellent: string

  // Metadata viva
  source: MemorySource
  effectiveness: number      // 0-100 — qué tan bien funcionó (peso)
  timesUsed: number
  lastUsedAt: number
  createdAt: number

  // Evidencia de éxito (alimenta el peso)
  evidence?: {
    studentsHelped: number
    avgComprehensionAfter: number  // % de comprensión después de usarlo
    abandonRateAfter: number       // % de estudiantes que abandonaron después
  }
}

// ═══════════════════════════════════════════════════════════════
// SEMILLA: 10 ejemplos handcrafted
// (los mismos del paso anterior, pero con metadata viva)
// ═══════════════════════════════════════════════════════════════
const SEED_MEMORY: TeachingMemoryEntry[] = [
  {
    id: 'seed_opening_med',
    situation: 'opening',
    context: {
      subject: 'bioquímica',
      careerFit: ['medicina', 'enfermería'],
      objective: 'crear curiosidad',
    },
    scenario: 'Apertura de sesión sobre ATP',
    badResponse: 'Hoy veremos el ATP. El ATP es la molécula energética principal de la célula.',
    averageResponse: '¡Bienvenido! Hoy aprenderemos sobre el ATP, una molécula fundamental para la vida.',
    excellentResponse: 'Imagina un paciente con hipoglucemia severa. ¿Por qué crees que sus células dejan de funcionar tan rápido si no tienen glucosa? Esa pregunta es la puerta a entender el ATP.',
    whyExcellent: 'Conecta con su carrera (paciente), plantea un misterio, promete que la respuesta vale la pena.',
    source: 'handcrafted',
    effectiveness: 75,  // empieza con score medio-alto por ser handcrafted
    timesUsed: 0,
    lastUsedAt: 0,
    createdAt: Date.now(),
  },
  {
    id: 'seed_fail_physics',
    situation: 'failure',
    context: {
      subject: 'física',
      errorType: 'modelo_mental_clasico',
    },
    scenario: 'Estudiante respondió "los electrones giran como planetas"',
    badResponse: 'Incorrecto. Los electrones no giran como planetas porque...',
    averageResponse: 'No es correcto. Los electrones están en orbitales, no en órbitas planetarias.',
    excellentResponse: 'Eso tiene mucho sentido pensado así. De hecho, ese fue exactamente el modelo de Rutherford. Pero ahí estaba el problema: si los electrones giran como planetas, deberían perder energía y caer al núcleo en menos de un segundo. ¿Y entonces por qué no lo hacen?',
    whyExcellent: 'Valida la lógica, contextualiza históricamente, devuelve con pregunta que conduce al descubrimiento.',
    source: 'handcrafted',
    effectiveness: 80,
    timesUsed: 0,
    lastUsedAt: 0,
    createdAt: Date.now(),
  },
  {
    id: 'seed_success_no_empty',
    situation: 'success',
    context: {
      subject: 'bioquímica',
      objective: 'profundizar comprensión',
    },
    scenario: 'Estudiante explicó correctamente glucólisis',
    badResponse: '¡Excelente! Muy bien.',
    averageResponse: 'Correcto. La glucólisis produce 2 ATP y 2 NADH.',
    excellentResponse: 'Exactamente. Lo que más me gusta es que mencionaste el NADH — esa es la pista clave. Porque ese NADH es lo que la mitocondria va a usar para multiplicar la energía por 15. Sin glucólisis, no hay nada que multiplicar.',
    whyExcellent: 'Reconoce algo específico, conecta con lo siguiente, deja intuición nueva (multiplicador).',
    source: 'handcrafted',
    effectiveness: 78,
    timesUsed: 0,
    lastUsedAt: 0,
    createdAt: Date.now(),
  },
  {
    id: 'seed_curiosity_stats',
    situation: 'curiosity',
    context: {
      subject: 'estadística',
      careerFit: ['psicología', 'sociales'],
    },
    scenario: 'Apertura sobre distribución normal',
    badResponse: 'La distribución normal es una distribución de probabilidad simétrica respecto a la media.',
    averageResponse: 'La distribución normal es muy importante porque modela muchos fenómenos naturales.',
    excellentResponse: 'Mira esto: si midieras la altura de 10,000 personas al azar y dibujaras los resultados, te saldría exactamente la misma forma que si midieras los errores de un cañón apuntando al mismo blanco. ¿Por qué dos cosas tan distintas dan la misma curva?',
    whyExcellent: 'Plantea misterio concreto, conecta dos cosas inesperadas, el estudiante quiere saber.',
    source: 'handcrafted',
    effectiveness: 82,
    timesUsed: 0,
    lastUsedAt: 0,
    createdAt: Date.now(),
  },
  {
    id: 'seed_recover_calc',
    situation: 'recover_motivation',
    context: {
      subject: 'cálculo',
      errorType: 'frustracion_acumulada',
    },
    scenario: 'Estudiante falló 3 veces seguidas con derivadas',
    badResponse: 'Veo que estás teniendo dificultades. Intentemos de nuevo.',
    averageResponse: 'No te preocupes, las derivadas son difíciles. Vamos paso a paso.',
    excellentResponse: 'Espera. Vamos a parar un segundo. Lo que estás intentando entender es algo que históricamente le tomó 200 años a la humanidad descifrar. Newton y Leibniz se pelearon décadas por esto. Que te cueste no significa que vayas mal — significa que estás peleando con algo difícil. Vamos a desarmarlo de otra forma.',
    whyExcellent: 'Reduce presión, contextualiza, redefine "fallo" como esfuerzo válido, promete nuevo ángulo.',
    source: 'handcrafted',
    effectiveness: 85,
    timesUsed: 0,
    lastUsedAt: 0,
    createdAt: Date.now(),
  },
  {
    id: 'seed_connection',
    situation: 'connection',
    context: {
      subject: 'bioquímica',
      objective: 'consolidar y avanzar',
    },
    scenario: 'Estudiante domina mitocondria, glucólisis y ATP por separado',
    badResponse: 'Ahora veamos cómo se relacionan estos conceptos.',
    averageResponse: 'Forman parte del proceso de respiración celular.',
    excellentResponse: '¿Te das cuenta de lo que ya sabes? Tienes las tres piezas: la fábrica (mitocondria), la materia prima procesada (lo que sale de glucólisis), y el producto final (ATP). Lo único que falta es ver QUÉ pasa dentro de esa fábrica. Y ahí entra lo más elegante de toda la bioquímica.',
    whyExcellent: 'Reconoce el progreso, usa metáfora de fábrica que ancla todo, genera expectativa.',
    source: 'handcrafted',
    effectiveness: 80,
    timesUsed: 0,
    lastUsedAt: 0,
    createdAt: Date.now(),
  },
  {
    id: 'seed_closing_evolution',
    situation: 'closing',
    context: {
      subject: 'biología',
    },
    scenario: 'Cierre de sesión sobre selección natural',
    badResponse: 'Terminamos por hoy.',
    averageResponse: 'En esta sesión vimos los fundamentos de la selección natural.',
    excellentResponse: 'Quédate con esto: la evolución no es algo que le pasa a un individuo. Le pasa a una población a través del tiempo. Un solo organismo no evoluciona — sus descendientes sí. Esa diferencia es la que mucha gente nunca termina de entender, y tú hoy la tienes clara.',
    whyExcellent: 'Idea poderosa y concisa que el estudiante puede repetir, reconocimiento implícito, sin clichés.',
    source: 'handcrafted',
    effectiveness: 88,
    timesUsed: 0,
    lastUsedAt: 0,
    createdAt: Date.now(),
  },
  {
    id: 'seed_misconception',
    situation: 'misconception',
    context: {
      subject: 'física',
      errorType: 'confusion_fuerza_energia',
    },
    scenario: 'Estudiante confunde fuerza con energía',
    badResponse: 'No, fuerza y energía no son lo mismo.',
    averageResponse: 'La fuerza causa cambios en el movimiento, la energía es la capacidad de hacer trabajo.',
    excellentResponse: 'Esta confusión la tienen 9 de cada 10 estudiantes al principio, y tiene sentido — en el lenguaje cotidiano usamos "fuerza" y "energía" como sinónimos. Pero en física son cosas distintas. Mira: una pared empujándote tiene fuerza, pero no te transfiere energía si no te mueves. Esa es la pista clave.',
    whyExcellent: 'Normaliza el error, valida el origen lingüístico, da ejemplo concreto que distingue claramente.',
    source: 'handcrafted',
    effectiveness: 87,
    timesUsed: 0,
    lastUsedAt: 0,
    createdAt: Date.now(),
  },
  {
    id: 'seed_aha_dna',
    situation: 'aha_moment',
    context: {
      subject: 'biología molecular',
    },
    scenario: 'Construir momento ajá sobre ADN',
    badResponse: 'El ADN contiene la información genética.',
    averageResponse: 'El ADN es como un manual de instrucciones de la célula.',
    excellentResponse: 'Pregunta: si rompieras 1 célula de tu cuerpo y sacaras su ADN, ¿podrías clonarte? Sí. Cada célula tiene la receta completa de ti. Tu hígado tiene las instrucciones para hacer cerebro. Tu piel sabe cómo hacer pulmones. Lo único distinto entre células es qué partes de la receta leen.',
    whyExcellent: 'Pregunta provocadora, dato contraintuitivo, cambia completamente la idea de qué es el ADN.',
    source: 'handcrafted',
    effectiveness: 92,
    timesUsed: 0,
    lastUsedAt: 0,
    createdAt: Date.now(),
  },
  {
    id: 'seed_question_from_explanation',
    situation: 'curiosity',
    context: {
      subject: 'bioquímica',
      objective: 'pregunta diagnóstica',
    },
    scenario: 'Después de explicar gradiente de protones',
    badResponse: '¿Qué es el gradiente de protones?',
    averageResponse: '¿Cuál es la función del gradiente?',
    excellentResponse: 'Pregunta importante: si alguien rompiera ese gradiente — digamos, abriendo "agujeros" en la membrana mitocondrial — ¿qué crees que pasaría con la producción de ATP?',
    whyExcellent: 'Nace de la explicación, hace pensar en consecuencias, evalúa comprensión no memoria.',
    source: 'handcrafted',
    effectiveness: 83,
    timesUsed: 0,
    lastUsedAt: 0,
    createdAt: Date.now(),
  },
]

// ═══════════════════════════════════════════════════════════════
// STORAGE (LocalStorage por ahora; servidor cuando aplique)
// ═══════════════════════════════════════════════════════════════
const MEMORY_KEY = 'studyal_teaching_memory_v1'

function loadMemory(): TeachingMemoryEntry[] {
  if (typeof window === 'undefined') return SEED_MEMORY
  try {
    const raw = localStorage.getItem(MEMORY_KEY)
    if (!raw) {
      localStorage.setItem(MEMORY_KEY, JSON.stringify(SEED_MEMORY))
      return SEED_MEMORY
    }
    return JSON.parse(raw)
  } catch {
    return SEED_MEMORY
  }
}

function saveMemory(memory: TeachingMemoryEntry[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory))
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
// BUSCAR ejemplos relevantes según situación + contexto
// (no random — pesado por effectiveness)
// ═══════════════════════════════════════════════════════════════
export function findRelevantMemory(params: {
  situation: TeachingSituation
  subject?: string
  career?: string
  count?: number
}): TeachingMemoryEntry[] {
  const { situation, subject, career, count = 2 } = params
  const all = loadMemory()

  // Filtrar por situación
  let candidates = all.filter(e => e.situation === situation)

  if (candidates.length === 0) return []

  // Calcular score de relevancia para cada candidato
  const scored = candidates.map(entry => {
    let score = entry.effectiveness  // base

    // Bonus por match de materia
    if (subject && entry.context.subject?.toLowerCase().includes(subject.toLowerCase())) {
      score += 15
    }

    // Bonus por match de carrera
    if (career && entry.context.careerFit?.some(c => c.toLowerCase().includes(career.toLowerCase()))) {
      score += 15
    }

    // Penalización si se usó muy recientemente (evitar repetición)
    const hoursSinceLastUse = (Date.now() - entry.lastUsedAt) / (1000 * 60 * 60)
    if (hoursSinceLastUse < 1) score -= 30
    else if (hoursSinceLastUse < 24) score -= 10

    return { entry, score }
  })

  // Ordenar por score y tomar los top
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, count).map(s => s.entry)
}

// ═══════════════════════════════════════════════════════════════
// REGISTRAR uso de un ejemplo
// ═══════════════════════════════════════════════════════════════
export function recordMemoryUse(entryId: string): void {
  const all = loadMemory()
  const entry = all.find(e => e.id === entryId)
  if (!entry) return

  entry.timesUsed += 1
  entry.lastUsedAt = Date.now()
  saveMemory(all)
}

// ═══════════════════════════════════════════════════════════════
// ACTUALIZAR effectiveness basado en evidencia
// (llamar después de una sesión que usó este ejemplo)
// ═══════════════════════════════════════════════════════════════
export function updateEffectiveness(params: {
  entryId: string
  outcome: {
    studentUnderstood: boolean      // ¿la comprensión subió?
    studentAbandoned: boolean        // ¿abandonó la sesión?
    comprehensionDelta: number       // cambio en comprensión (-100 a +100)
  }
}): void {
  const { entryId, outcome } = params
  const all = loadMemory()
  const entry = all.find(e => e.id === entryId)
  if (!entry) return

  // Inicializar evidencia si no existe
  if (!entry.evidence) {
    entry.evidence = {
      studentsHelped: 0,
      avgComprehensionAfter: 0,
      abandonRateAfter: 0,
    }
  }

  const ev = entry.evidence
  const newCount = ev.studentsHelped + 1

  // Actualizar métricas (promedio móvil)
  if (outcome.studentUnderstood) {
    ev.avgComprehensionAfter = Math.round(
      (ev.avgComprehensionAfter * ev.studentsHelped + Math.max(0, outcome.comprehensionDelta)) / newCount
    )
  }
  if (outcome.studentAbandoned) {
    ev.abandonRateAfter = Math.round(
      (ev.abandonRateAfter * ev.studentsHelped + 100) / newCount
    )
  } else {
    ev.abandonRateAfter = Math.round(
      (ev.abandonRateAfter * ev.studentsHelped) / newCount
    )
  }
  ev.studentsHelped = newCount

  // Actualizar effectiveness basado en evidencia real
  // Fórmula: comprensión - abandono, con peso por cantidad de datos
  if (ev.studentsHelped >= 3) {
    const evidenceScore = ev.avgComprehensionAfter - (ev.abandonRateAfter * 0.5)
    // Promediar con score original (handcrafted parte de 75-90)
    entry.effectiveness = Math.round(entry.effectiveness * 0.3 + evidenceScore * 0.7)
    entry.effectiveness = Math.max(0, Math.min(100, entry.effectiveness))

    // Promover de fuente si supera umbral
    if (entry.source === 'handcrafted' && ev.studentsHelped >= 5 && entry.effectiveness >= 80) {
      entry.source = 'validated'
    }
    if (entry.source === 'validated' && ev.studentsHelped >= 20 && entry.effectiveness >= 88) {
      entry.source = 'top_rated'
    }
  }

  saveMemory(all)
}

// ═══════════════════════════════════════════════════════════════
// AGREGAR nuevo ejemplo (desde Reflection Loop o manual)
// ═══════════════════════════════════════════════════════════════
export function addMemoryEntry(entry: Omit<TeachingMemoryEntry, 'id' | 'createdAt' | 'timesUsed' | 'lastUsedAt'>): TeachingMemoryEntry {
  const all = loadMemory()
  const newEntry: TeachingMemoryEntry = {
    ...entry,
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timesUsed: 0,
    lastUsedAt: 0,
    createdAt: Date.now(),
  }
  all.push(newEntry)
  saveMemory(all)
  return newEntry
}

// ═══════════════════════════════════════════════════════════════
// FORMAT para prompt (few-shot)
// ═══════════════════════════════════════════════════════════════
export function formatMemoryForPrompt(entries: TeachingMemoryEntry[]): string {
  if (entries.length === 0) return ''

  // Registrar uso
  for (const e of entries) recordMemoryUse(e.id)

  const lines = ['═══ EJEMPLOS DE CÓMO ENSEÑA ALAI ═══']
  for (const ex of entries) {
    lines.push(`\n--- ${ex.scenario} ---`)
    lines.push(`Contexto: ${ex.context.subject || 'general'}${ex.context.careerFit ? ` | ${ex.context.careerFit.join(', ')}` : ''}`)
    lines.push(`\n✗ Mal: "${ex.badResponse}"`)
    lines.push(`◯ Promedio: "${ex.averageResponse}"`)
    lines.push(`✓ Excelente: "${ex.excellentResponse}"`)
    lines.push(`   → ${ex.whyExcellent}`)
  }
  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════════
// STATS para debug/dashboard
// ═══════════════════════════════════════════════════════════════
export function getMemoryStats() {
  const all = loadMemory()
  return {
    total: all.length,
    bySource: {
      handcrafted: all.filter(e => e.source === 'handcrafted').length,
      validated: all.filter(e => e.source === 'validated').length,
      top_rated: all.filter(e => e.source === 'top_rated').length,
      reflection_generated: all.filter(e => e.source === 'reflection_generated').length,
    },
    avgEffectiveness: Math.round(
      all.reduce((sum, e) => sum + e.effectiveness, 0) / all.length
    ),
    topRated: all
      .filter(e => e.effectiveness >= 85)
      .sort((a, b) => b.effectiveness - a.effectiveness)
      .slice(0, 5)
      .map(e => ({ scenario: e.scenario, effectiveness: e.effectiveness })),
  }
}
