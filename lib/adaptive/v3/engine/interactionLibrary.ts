// ═══════════════════════════════════════════════════════════════
// INTERACTION LIBRARY v2
// 
// Arquitectura de 4 capas:
// CAPA 1: ¿Qué habilidad medir? (recordar, comprender, aplicar...)
// CAPA 2: ¿Qué evidencia necesito? (reconoce, explica, aplica...)
// CAPA 3: ¿Qué formato usar? (MCQ, fill_blank, matching...)
// CAPA 4: ¿Qué variación aplicar? (con pistas, sin ayuda, caso...)
// 
// El LLM recibe este contexto completo y genera la mejor
// evaluación posible para cada microconcepto.
// ═══════════════════════════════════════════════════════════════

export type EvalPreference = 'quick_test' | 'write_explain' | 'mix_everything'

// ═══════════════════════════════════════════════════════════════
// GENERAR INSTRUCCIÓN COMPLETA PARA EL LLM
// ═══════════════════════════════════════════════════════════════
export function buildFormatInstruction(params: {
  cognitiveType: string
  difficulty: number
  preference: EvalPreference
  hasFormulas: boolean
  hasProcedures: boolean
  hasExamples: boolean
  hasCommonErrors: boolean
  formatsAlreadyUsed: string[]
  isFirstQuestion: boolean
}): string {
  const {
    cognitiveType, difficulty, preference,
    hasFormulas, hasProcedures, hasExamples, hasCommonErrors,
    formatsAlreadyUsed, isFirstQuestion,
  } = params

  const lines: string[] = []

  // ═══════════════════════════════════════════════════════════
  // CAPA 1: ¿QUÉ HABILIDAD MEDIR?
  // ═══════════════════════════════════════════════════════════
  lines.push(`═══════════════════════════════════════`)
  lines.push(`SISTEMA DE EVALUACIÓN ADAPTATIVA`)
  lines.push(`═══════════════════════════════════════`)
  lines.push(``)
  lines.push(`TIPO COGNITIVO: ${cognitiveType}`)
  lines.push(`DIFICULTAD: ${difficulty}/100`)
  lines.push(``)

  // Habilidades sugeridas según tipo cognitivo
  const skillsByType: Record<string, string[]> = {
    definitional: ['recordar', 'comprender', 'identificar'],
    conceptual: ['comprender', 'explicar', 'relacionar', 'analizar'],
    narrative: ['recordar', 'ordenar', 'relacionar', 'resumir'],
    chronological: ['ordenar', 'recordar', 'relacionar', 'contextualizar'],
    causal: ['comprender', 'explicar', 'predecir', 'analizar'],
    comparative: ['diferenciar', 'relacionar', 'analizar', 'evaluar'],
    classificatory: ['clasificar', 'organizar', 'diferenciar'],
    procedural: ['aplicar', 'ordenar', 'resolver', 'detectar errores'],
    mathematical: ['calcular', 'resolver', 'aplicar', 'demostrar'],
    analytical: ['analizar', 'evaluar', 'argumentar', 'sintetizar'],
    applicative: ['aplicar', 'resolver', 'transferir', 'crear'],
  }
  const skills = skillsByType[cognitiveType] || ['comprender', 'aplicar']
  lines.push(`HABILIDADES A EVALUAR: ${skills.join(', ')}`)
  lines.push(``)

  // ═══════════════════════════════════════════════════════════
  // CAPA 2: PREFERENCIA DEL ESTUDIANTE
  // ═══════════════════════════════════════════════════════════
  lines.push(`PREFERENCIA DEL ESTUDIANTE: ${
    preference === 'quick_test'
      ? 'EVALUACIONES RÁPIDAS SIN ESCRIBIR — Solo seleccionar, ordenar, relacionar o completar con banco. PROHIBIDO cualquier input de texto o composición por teclado.'
      : preference === 'write_explain'
      ? 'EXPLICAR CON PALABRAS — Prefiere escribir, explicar, argumentar, reflexionar.'
      : 'MEZCLA DE TODO — Alternar entre formatos rápidos y escritura.'
  }`)
  lines.push(``)

  // ═══════════════════════════════════════════════════════════
  // CAPA 3: FORMATOS DISPONIBLES
  // ═══════════════════════════════════════════════════════════
  if (formatsAlreadyUsed.length > 0) {
    lines.push(`⛔ YA SE USARON (no repetir): ${formatsAlreadyUsed.join(', ')}`)
    lines.push(``)
  }

  if (isFirstQuestion) {
    lines.push(`Es la PRIMERA evaluación. Usa algo simple y rápido.`)
    lines.push(``)
  }

  // Formatos rápidos (interactivos, sin escribir mucho)
  const quickFormats = `
FORMATOS RÁPIDOS (preferidos por evaluaciones rápidas):

• multiple_choice — Opción múltiple clásica
  Variaciones: mejor respuesta, excepción, causa, consecuencia, "¿qué pasaría si...?", con escenario, con caso, por eliminación
  Schema: { "interactionType": "multiple_choice", "prompt": "pregunta", "data": { "type": "multiple_choice", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "por qué" } }

• true_false — Verdadero o falso
  Variaciones: con explicación, corrige la afirmación, marca todas las verdaderas/falsas
  Schema: { "interactionType": "true_false", "prompt": "evalúa", "data": { "type": "true_false", "statement": "afirmación", "correctAnswer": true, "explanation": "por qué" } }

• fill_blank — Completar espacio (CON banco de palabras)
  Variaciones: una palabra, número, fórmula, definición, completar ecuación
  Schema: { "interactionType": "fill_blank", "prompt": "completa", "data": { "type": "fill_blank", "template": "El proceso inicia con ___", "correctAnswers": ["la observación"], "bank": ["la observación", "la conclusión", "la revisión"] } }
  OBLIGATORIO: siempre incluir "correctAnswers" Y "bank"

• matching — Relacionar pares
  Variaciones: concepto↔definición, persona↔logro, causa↔efecto, fecha↔evento, fórmula↔nombre
  Schema: { "interactionType": "matching", "prompt": "relaciona", "data": { "type": "matching", "pairs": [{"left":"A","right":"desc A"},{"left":"B","right":"desc B"},{"left":"C","right":"desc C"}] } }

• ordering — Ordenar elementos
  Variaciones: cronológico, pasos de procedimiento, importancia, lógico, de causa a efecto
  Schema: { "interactionType": "ordering", "prompt": "ordena", "data": { "type": "ordering", "items": ["primero","segundo","tercero"], "correctOrder": [0,1,2] } }

• classification — Clasificar en grupos
  Schema: { "interactionType": "classification", "prompt": "clasifica", "data": { "type": "classification", "items": ["item1","item2","item3","item4"], "groups": ["Grupo A","Grupo B"], "correctAssignments": {"item1":"Grupo A","item2":"Grupo B","item3":"Grupo A","item4":"Grupo B"} } }
`

  // Formatos de escritura
  const writeFormats = `
FORMATOS DE ESCRITURA (preferidos por explicar con palabras):

• open_response — Respuesta abierta
  Variaciones: respuesta corta, explicación, justificación, comparación, reflexión, resumen, describe, reescribe
  Schema: { "interactionType": "open_response", "prompt": "pregunta", "data": { "type": "open_response", "acceptedAnswers": ["palabra clave 1","palabra clave 2"] } }

• teach_back — Enseña el concepto
  Variaciones: explica para un niño, explica para un experto, enseña a otro estudiante
  Schema: { "interactionType": "teach_back", "prompt": "explícame como si fuera tu alumno", "data": { "type": "teach_back", "concept": "nombre", "rubric": ["debe mencionar X","debe mencionar Y"] } }

• explain_why — Explica por qué
  Variaciones: causa, mecanismo, justificación, razonamiento, consecuencia
  Schema: { "interactionType": "explain_why", "prompt": "¿por qué...?", "data": { "type": "explain_why", "phenomenon": "fenómeno", "expectedFactors": ["factor1","factor2"] } }

• error_detection — Encuentra y corrige el error
  Variaciones: error en procedimiento, error conceptual, error de cálculo, inconsistencia
  Schema: { "interactionType": "find_the_error", "prompt": "encuentra el error", "data": { "type": "find_the_error", "workedSolution": ["paso1","paso2 con error","paso3"], "errorStepIndex": 1, "explanation": "el error es..." } }

• prediction — Predice qué pasará
  Schema: { "interactionType": "prediction", "prompt": "¿qué pasaría si...?", "data": { "type": "prediction", "setup": "situación", "question": "pregunta", "expectedAnswer": "resultado" } }

• case_analysis — Analiza un caso
  Schema: { "interactionType": "practical_case", "prompt": "caso", "data": { "type": "practical_case", "scenario": "situación", "question": "pregunta", "expectedElements": ["elemento1","elemento2"] } }

• compare_contrast — Compara y contrasta
  Schema: { "interactionType": "compare_contrast", "prompt": "compara", "data": { "type": "compare_contrast", "itemA": "concepto A", "itemB": "concepto B", "expectedDifferences": ["diff1"], "expectedSimilarities": ["sim1"] } }
`

  // Formatos avanzados (para cualquier preferencia)
  const advancedFormats = `
FORMATOS AVANZADOS:

• analogy — Completa o crea analogía
  Schema: { "interactionType": "analogy", "prompt": "completa la analogía", "data": { "type": "analogy", "partial": "X es a Y como ___ es a ___", "expectedAnswer": "A es a B" } }

• counterexample — Da un contraejemplo
  Schema: { "interactionType": "counterexample", "prompt": "da un contraejemplo", "data": { "type": "counterexample", "claim": "afirmación", "expectedCounter": "contraejemplo" } }

• minimal_pair — Diferencia mínima entre dos conceptos
  Schema: { "interactionType": "minimal_pair", "prompt": "¿cuál es la diferencia clave?", "data": { "type": "minimal_pair", "conceptA": "X", "conceptB": "Y", "keyDifference": "diferencia" } }

• metacognition — Reflexión sobre el aprendizaje
  Variaciones: ¿qué fue difícil?, ¿qué concepto usaste?, explica tu razonamiento, ¿qué cambiaría tu respuesta?
  Schema: { "interactionType": "metacognition", "prompt": "reflexiona", "data": { "type": "metacognition", "question": "pregunta reflexiva", "expectedInsight": "insight esperado" } }

• spot_misconception — Identifica el error conceptual
  Schema: { "interactionType": "spot_misconception", "prompt": "¿qué está mal en esta explicación?", "data": { "type": "spot_misconception", "wrongExplanation": "explicación incorrecta", "correctExplanation": "la correcta", "misconception": "el error conceptual" } }
`

  // Seleccionar qué formatos mostrar según preferencia
  if (preference === 'quick_test') {
    lines.push(quickFormats)
    lines.push(`SOLO usa formatos RÁPIDOS cerrados de la lista de arriba. El estudiante no puede escribir ni introducir números: cualquier producción debe transformarse en selección o discriminación y registrarse como evidencia de selección.`)
  } else if (preference === 'write_explain') {
    lines.push(writeFormats)
    lines.push(`SOLO usa formatos de ESCRITURA de la lista de arriba.`)
  } else {
    lines.push(quickFormats)
    lines.push(writeFormats)
    lines.push(advancedFormats)
    lines.push(`Usa CUALQUIER formato. Varía. Sorprende.`)
  }

  // ═══════════════════════════════════════════════════════════
  // CAPA 4: RECURSOS ESPECIALES DEL MICRO
  // ═══════════════════════════════════════════════════════════
  lines.push(``)
  const specials: string[] = []
  if (hasFormulas) specials.push('Tiene fórmulas → puedes usar fill_blank con fórmula, o resolver ecuación')
  if (hasProcedures) specials.push('Tiene procedimientos → puedes usar ordering de pasos, o error_detection')
  if (hasExamples) specials.push('Tiene ejemplos → puedes usar caso práctico, o predicción')
  if (hasCommonErrors) specials.push('Tiene errores comunes → puedes usar spot_misconception, o find_the_error')

  if (specials.length > 0) {
    lines.push(`RECURSOS ESPECIALES DEL MICRO:`)
    specials.forEach(s => lines.push(`  • ${s}`))
    lines.push(``)
  }

  // ═══════════════════════════════════════════════════════════
  // REGLAS FINALES
  // ═══════════════════════════════════════════════════════════
  lines.push(`═══════════════════════════════════════`)
  lines.push(`REGLAS:`)
  lines.push(`1. Elige el formato que MEJOR evalúe la comprensión de ESTE concepto específico.`)
  lines.push(`2. La pregunta debe ser respondible con lo que se enseñó.`)
  lines.push(`3. NO hagas preguntas cuya respuesta sea obvia por el contexto.`)
  lines.push(`4. Si usas fill_blank, SIEMPRE incluye correctAnswers Y bank.`)
  lines.push(`5. Si el concepto es cronológico → ordering es ideal.`)
  lines.push(`6. Si el concepto es comparativo → matching o compare_contrast.`)
  lines.push(`7. Si el concepto tiene errores comunes → error_detection o spot_misconception.`)
  lines.push(`8. Varía. No repitas el mismo tipo.`)
  lines.push(`═══════════════════════════════════════`)

  return lines.join('\n')
}
