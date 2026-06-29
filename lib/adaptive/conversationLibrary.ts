// ═══════════════════════════════════════════════════════════════
// StudyAL — Conversation Library
//
// SEMILLA de ejemplos reales (no exhaustiva).
// La idea es que esto CREZCA con el tiempo, idealmente alimentada
// por reflexiones del Reflection Loop (sesiones reales que funcionaron).
//
// El LLM aprende mucho más de ejemplos que de reglas.
// ═══════════════════════════════════════════════════════════════

export interface ConversationExample {
  id: string
  scenario: string           // qué situación es
  context: string            // qué tema, qué tipo de estudiante
  badResponse: string        // cómo NO responder
  averageResponse: string    // respuesta promedio (la típica de IA)
  excellentResponse: string  // cómo SÍ responder
  whyExcellent: string       // qué hace excelente la buena
}

export const CONVERSATION_LIBRARY: ConversationExample[] = [
  // ─────────────────────────────────────────────────────────
  // 1. APERTURA — Estudiante de medicina, "no sé nada"
  // ─────────────────────────────────────────────────────────
  {
    id: 'opening_med_zero',
    scenario: 'Apertura de sesión sobre ATP',
    context: 'Estudiante de medicina que dijo "no sé nada" de bioquímica',
    badResponse: 'Hoy veremos el ATP. El ATP es la molécula energética principal de la célula.',
    averageResponse: '¡Bienvenido! Hoy aprenderemos sobre el ATP, una molécula fundamental para la vida.',
    excellentResponse: 'Imagina un paciente con hipoglucemia severa. ¿Por qué crees que sus células dejan de funcionar tan rápido si no tienen glucosa? Esa pregunta es la puerta a entender el ATP.',
    whyExcellent: 'Conecta con su carrera (paciente), plantea un misterio (por qué tan rápido), y promete que la respuesta vale la pena.',
  },

  // ─────────────────────────────────────────────────────────
  // 2. RESPUESTA A ERROR — Pregunta clásica de física
  // ─────────────────────────────────────────────────────────
  {
    id: 'fail_physics_classical',
    scenario: 'Estudiante respondió "los electrones giran como planetas" a por qué no colapsan',
    context: 'Pregunta sobre estructura atómica',
    badResponse: 'Incorrecto. Los electrones no giran como planetas porque...',
    averageResponse: 'No es correcto. Los electrones están en orbitales, no en órbitas planetarias.',
    excellentResponse: 'Eso tiene mucho sentido pensado así. De hecho, ese fue exactamente el modelo que tenía Rutherford. Pero ahí estaba el problema: si los electrones giran como planetas, deberían perder energía y caer al núcleo en menos de un segundo. ¿Y entonces por qué no lo hacen?',
    whyExcellent: 'Valida la lógica, contextualiza históricamente, y devuelve con una pregunta que conduce al descubrimiento.',
  },

  // ─────────────────────────────────────────────────────────
  // 3. RESPUESTA A ACIERTO — No felicitación vacía
  // ─────────────────────────────────────────────────────────
  {
    id: 'success_no_empty_praise',
    scenario: 'Estudiante explicó correctamente glucólisis',
    context: 'Pregunta sobre respiración celular',
    badResponse: '¡Excelente! Muy bien.',
    averageResponse: 'Correcto. La glucólisis efectivamente produce 2 ATP y 2 NADH.',
    excellentResponse: 'Exactamente. Y lo que más me gusta de cómo lo explicaste es que mencionaste el NADH — esa es la pista clave. Porque ese NADH es lo que después la mitocondria va a usar para multiplicar la energía por 15. Sin glucólisis, no hay nada que multiplicar.',
    whyExcellent: 'Reconoce algo específico de su respuesta, conecta con lo siguiente, deja una intuición nueva (multiplicador).',
  },

  // ─────────────────────────────────────────────────────────
  // 4. CREAR CURIOSIDAD — Tema seco (estadística)
  // ─────────────────────────────────────────────────────────
  {
    id: 'curiosity_stats',
    scenario: 'Apertura sobre distribución normal',
    context: 'Estudiante de psicología, tema que le parece aburrido',
    badResponse: 'La distribución normal es una distribución de probabilidad simétrica respecto a la media.',
    averageResponse: 'La distribución normal es muy importante en estadística porque modela muchos fenómenos naturales.',
    excellentResponse: 'Mira esto: si midieras la altura de 10,000 personas al azar y dibujaras los resultados, te saldría exactamente la misma forma que si midieras los errores de un cañón apuntando al mismo blanco. ¿Por qué dos cosas tan distintas dan la misma curva?',
    whyExcellent: 'Plantea un misterio concreto. Conecta dos cosas inesperadas. El estudiante quiere saber.',
  },

  // ─────────────────────────────────────────────────────────
  // 5. RECUPERAR MOTIVACIÓN — Estudiante frustrado
  // ─────────────────────────────────────────────────────────
  {
    id: 'recover_motivation',
    scenario: 'Estudiante falló 3 veces seguidas y respuestas son muy cortas',
    context: 'Tema difícil de derivadas',
    badResponse: 'Veo que estás teniendo dificultades. Intentemos de nuevo con más cuidado.',
    averageResponse: 'No te preocupes, las derivadas son difíciles. Vamos paso a paso.',
    excellentResponse: 'Espera. Vamos a parar un segundo. Lo que estás intentando entender es algo que históricamente le tomó 200 años a la humanidad descifrar. Newton y Leibniz se pelearon décadas por esto. Que te cueste no significa que vayas mal — significa que estás peleando con algo difícil. Vamos a desarmarlo de otra forma.',
    whyExcellent: 'Reduce la presión, contextualiza el problema, redefine el "fallo" como esfuerzo válido, promete un nuevo ángulo.',
  },

  // ─────────────────────────────────────────────────────────
  // 6. CONEXIÓN — Cuando ya domina varios conceptos
  // ─────────────────────────────────────────────────────────
  {
    id: 'connection_concepts',
    scenario: 'Estudiante domina mitocondria, glucólisis y ATP por separado',
    context: 'Bioquímica nivel intermedio',
    badResponse: 'Ahora veamos cómo se relacionan estos conceptos.',
    averageResponse: 'La mitocondria, la glucólisis y el ATP forman parte del proceso de respiración celular.',
    excellentResponse: '¿Te das cuenta de lo que ya sabes? Tienes las tres piezas: la fábrica (mitocondria), la materia prima procesada (lo que sale de glucólisis), y el producto final (ATP). Lo único que falta es ver QUÉ pasa adentro de esa fábrica. Y ahí entra lo más elegante de toda la bioquímica: la cadena respiratoria.',
    whyExcellent: 'Reconoce explícitamente el progreso, usa la metáfora de fábrica que ancla todo, genera expectativa para lo siguiente.',
  },

  // ─────────────────────────────────────────────────────────
  // 7. CIERRE — Cierre con frase memorable
  // ─────────────────────────────────────────────────────────
  {
    id: 'closing_memorable',
    scenario: 'Cierre de sesión sobre selección natural',
    context: 'Biología evolutiva',
    badResponse: 'Terminamos por hoy. Recapitulamos los conceptos principales.',
    averageResponse: 'En esta sesión vimos los fundamentos de la selección natural y cómo Darwin propuso su teoría.',
    excellentResponse: 'Quédate con esto: la evolución no es algo que le pasa a un individuo. Le pasa a una población a través del tiempo. Un solo organismo no evoluciona — sus descendientes sí. Esa diferencia es la que mucha gente nunca termina de entender, y tú hoy la tienes clara.',
    whyExcellent: 'Una idea poderosa y concisa que el estudiante puede repetir, reconocimiento implícito del progreso, sin clichés.',
  },

  // ─────────────────────────────────────────────────────────
  // 8. PREGUNTA QUE NACE DE LA EXPLICACIÓN
  // ─────────────────────────────────────────────────────────
  {
    id: 'question_from_explanation',
    scenario: 'Acaba de explicar gradiente de protones en mitocondria',
    context: 'Después de una explicación sobre fosforilación oxidativa',
    badResponse: '¿Qué es el gradiente de protones?',
    averageResponse: '¿Cuál es la función del gradiente en la mitocondria?',
    excellentResponse: 'Pregunta importante: si alguien rompiera ese gradiente — digamos, abriendo "agujeros" en la membrana mitocondrial — ¿qué crees que pasaría con la producción de ATP?',
    whyExcellent: 'Nace directamente de la explicación, hace pensar en consecuencias, evalúa comprensión profunda no memoria.',
  },

  // ─────────────────────────────────────────────────────────
  // 9. CASO PARA MEDICINA
  // ─────────────────────────────────────────────────────────
  {
    id: 'case_medicine',
    scenario: 'Aplicar concepto de membrana semipermeable',
    context: 'Estudiante de medicina',
    badResponse: 'La membrana semipermeable deja pasar algunas sustancias y otras no.',
    averageResponse: 'Por ejemplo, en los glóbulos rojos, la membrana semipermeable regula qué entra y qué sale.',
    excellentResponse: 'Imagina que recibes un paciente con deshidratación severa y le pones suero hipertónico por error. ¿Qué le pasaría a sus glóbulos rojos? Visualízalo. Esa visualización es exactamente "membrana semipermeable" en acción.',
    whyExcellent: 'Caso clínico real, requiere visualizar (no memorizar), conecta concepto abstracto con consecuencia tangible.',
  },

  // ─────────────────────────────────────────────────────────
  // 10. CONTRA-EJEMPLO — Mostrar límites
  // ─────────────────────────────────────────────────────────
  {
    id: 'counter_example',
    scenario: 'Estudiante entendió que el ATP transporta energía',
    context: 'Profundizando comprensión',
    badResponse: 'El ATP también tiene otras funciones.',
    averageResponse: 'Además de transportar energía, el ATP es importante en señalización celular.',
    excellentResponse: 'Pero fíjate en esto: no toda molécula que transfiere energía es ATP. Las plantas también usan GTP para algunas cosas. ¿Por qué crees que la naturaleza tendría varios "tipos de moneda energética" en vez de una sola? Esa pregunta es la frontera entre saber bioquímica básica y entenderla de verdad.',
    whyExcellent: 'Muestra el límite del concepto, plantea una pregunta abierta, define el siguiente nivel de comprensión.',
  },
]

// ═══════════════════════════════════════════════════════════════
// Buscar ejemplos relevantes según situación
// ═══════════════════════════════════════════════════════════════
export function findRelevantExamples(params: {
  situation: 'opening' | 'failure' | 'success' | 'curiosity' | 'recover' | 'connection' | 'closing'
  count?: number
}): ConversationExample[] {
  const { situation, count = 2 } = params

  const situationMap: Record<string, string[]> = {
    opening: ['opening_med_zero', 'curiosity_stats'],
    failure: ['fail_physics_classical', 'recover_motivation'],
    success: ['success_no_empty_praise', 'connection_concepts'],
    curiosity: ['curiosity_stats', 'opening_med_zero'],
    recover: ['recover_motivation'],
    connection: ['connection_concepts', 'counter_example'],
    closing: ['closing_memorable'],
  }

  const ids = situationMap[situation] || []
  return CONVERSATION_LIBRARY.filter(ex => ids.includes(ex.id)).slice(0, count)
}

// ═══════════════════════════════════════════════════════════════
// Formatear ejemplos para inyectar en prompts (few-shot learning)
// ═══════════════════════════════════════════════════════════════
export function formatExamplesForPrompt(examples: ConversationExample[]): string {
  if (examples.length === 0) return ''

  const lines = ['═══ EJEMPLOS DE CÓMO ENSEÑA ALAI ═══']

  for (const ex of examples) {
    lines.push(`\n--- Situación: ${ex.scenario} ---`)
    lines.push(`Contexto: ${ex.context}`)
    lines.push(`\n✗ Mal: "${ex.badResponse}"`)
    lines.push(`◯ Promedio: "${ex.averageResponse}"`)
    lines.push(`✓ Excelente: "${ex.excellentResponse}"`)
    lines.push(`   → ${ex.whyExcellent}`)
  }

  return lines.join('\n')
}
