// ═══════════════════════════════════════════════════════════════
// StudyAL — Teaching Moves
// Un profesor no usa un solo formato. Tiene MOVIMIENTOS distintos
// según el momento, el estudiante y la idea.
// ═══════════════════════════════════════════════════════════════

import type { StudentModel } from './adaptiveBrain'

// ═══════════════════════════════════════════════════════════════
// CATÁLOGO DE TEACHING MOVES
// ═══════════════════════════════════════════════════════════════
export type TeachingMove =
  | 'rebuild'              // Reconstruir desde el error del estudiante
  | 'celebrate_intellectual' // Celebrar con profundidad, no con "¡excelente!"
  | 'mini_lesson'          // Mini explicación cuando hay confusión clara
  | 'analogy'              // Cambiar el ángulo con una analogía
  | 'comparison'           // "Lo que pensaste vs lo que es"
  | 'story'                // Narrativa histórica/biográfica
  | 'real_case'            // Caso aplicado (médico, ingeniería, etc.)
  | 'guided_discovery'     // Devolver con pregunta para que descubra
  | 'common_mistake'       // "Ese error lo comete casi todo el mundo"
  | 'connection'           // Conectar con otro concepto que ya domina
  | 'thought_experiment'   // "Imagina que..."
  | 'counter_example'      // Mostrar caso donde la idea falla

// ═══════════════════════════════════════════════════════════════
// SELECTOR DE MOVIMIENTO
// Decide qué movimiento es el mejor AHORA según contexto
// ═══════════════════════════════════════════════════════════════
export function selectTeachingMove(params: {
  studentAnswer: string
  score: number
  questionType: string
  conceptTested?: string
  model: StudentModel
  recentMoves: TeachingMove[]  // últimos movimientos usados (evitar repetir)
  topicCarrera?: string
}): { move: TeachingMove; reason: string } {
  const { studentAnswer, score, questionType, model, recentMoves, topicCarrera } = params

  const isCorrect = score >= 70
  const isPartial = score >= 40 && score < 70
  const isWrong = score < 40
  const answerLength = studentAnswer.trim().length

  // ── Pool de candidatos con peso ──
  const candidates: Array<[TeachingMove, number, string]> = []

  // ─── Si está mal ────────────────────────────────────
  if (isWrong) {
    candidates.push(['rebuild', 80, 'Falló — reconstruir desde su lógica'])
    candidates.push(['common_mistake', 70, 'El error parece típico — validar'])
    candidates.push(['guided_discovery', 60, 'Devolverlo con pregunta para que descubra'])
    candidates.push(['analogy', 55, 'Cambiar ángulo con analogía nueva'])
    candidates.push(['thought_experiment', 50, 'Imagina que... para crear intuición'])
    if (model.motivation.engagement < 50) {
      candidates.push(['story', 65, 'Está desconectado — historia para reenganchar'])
    }
  }

  // ─── Si está parcial ────────────────────────────────
  if (isPartial) {
    candidates.push(['comparison', 75, 'Comparar lo que dijo vs lo correcto'])
    candidates.push(['mini_lesson', 70, 'Tiene la base, falta detalle'])
    candidates.push(['rebuild', 60, 'Reconstruir desde su intuición parcial'])
    candidates.push(['analogy', 55, 'Analogía para cerrar el gap'])
  }

  // ─── Si está bien ───────────────────────────────────
  if (isCorrect) {
    candidates.push(['celebrate_intellectual', 80, 'Acertó — profundizar, no felicitar vacío'])
    candidates.push(['connection', 75, 'Conectar con otro concepto que ya domina'])
    candidates.push(['real_case', 65, 'Aplicar a caso real'])
    candidates.push(['counter_example', 55, 'Mostrar caso donde la idea no aplica'])
    candidates.push(['thought_experiment', 50, 'Llevar más allá con "imagina si..."'])
  }

  // ─── Ajustes por contexto ──────────────────────────

  // Si está cansado, evitar movimientos que requieran esfuerzo (discovery)
  if (model.motivation.energy < 40) {
    const idx = candidates.findIndex(c => c[0] === 'guided_discovery')
    if (idx !== -1) candidates[idx][1] -= 30
  }

  // Si la carrera es médica/clínica, subir real_case
  if (topicCarrera && /medicina|enfermer|clinic|salud/i.test(topicCarrera)) {
    const idx = candidates.findIndex(c => c[0] === 'real_case')
    if (idx !== -1) candidates[idx][1] += 20
  }

  // Si la respuesta fue muy corta, no usar movimientos largos
  if (answerLength < 20 && isCorrect) {
    // Probablemente respuesta de opción múltiple → no abrumar
    const idx = candidates.findIndex(c => c[0] === 'celebrate_intellectual')
    if (idx !== -1) candidates[idx][1] += 10
  }

  // ─── PENALIZAR repetición ──────────────────────────
  for (const candidate of candidates) {
    if (recentMoves.includes(candidate[0])) {
      candidate[1] -= 30  // penalización fuerte
    }
    if (recentMoves[recentMoves.length - 1] === candidate[0]) {
      candidate[1] -= 50  // si fue el ÚLTIMO, casi prohibido
    }
  }

  // ─── Variabilidad aleatoria pequeña ─────────────────
  for (const candidate of candidates) {
    candidate[1] += (Math.random() - 0.5) * 15
  }

  // Ordenar y elegir el mejor
  candidates.sort((a, b) => b[1] - a[1])

  if (candidates.length === 0) {
    return { move: 'mini_lesson', reason: 'fallback' }
  }

  const winner = candidates[0]
  return { move: winner[0], reason: winner[2] }
}

// ═══════════════════════════════════════════════════════════════
// PROMPT POR MOVIMIENTO
// Cada move tiene su propio estilo de generar feedback
// ═══════════════════════════════════════════════════════════════
export function buildMovePrompt(params: {
  move: TeachingMove
  question: string
  studentAnswer: string
  correctAnswer?: string
  expectedIdea?: string
  conceptTested?: string
  topicTitle: string
  materialContext?: string
  studentCarrera?: string
  studentKnowsNothing?: boolean
  score: number
}): string {
  const {
    move, question, studentAnswer, correctAnswer, expectedIdea,
    conceptTested, topicTitle, materialContext, studentCarrera,
    studentKnowsNothing, score,
  } = params

  // Instrucciones específicas por movimiento
  const moveInstructions: Record<TeachingMove, string> = {
    rebuild: `
Tu respuesta debe RECONSTRUIR desde la lógica del estudiante.
Empieza con: "Entiendo por qué llegaste a esa conclusión..."
Después: "Lo que pasó fue X..."
Después: "Y la idea correcta es Y porque..."
NO corrijas frontalmente. RECONSTRUYE.`,

    celebrate_intellectual: `
El estudiante acertó. NO digas "¡excelente!" o "¡perfecto!".
En su lugar: "Exactamente. Y si entendiste eso, entonces ya puedes entender X..."
Después: ENSEÑA algo MÁS profundo que conecta con lo que respondió.
Hacer que sienta que su comprensión desbloqueó algo nuevo.`,

    mini_lesson: `
El estudiante tiene una confusión clara. Da una MINI CLASE corta (3-4 oraciones).
Estructura: problema → idea clave → ejemplo → ahora sí.
Sin meta-pensamiento. Sin "voy a explicarte". Solo enseña.`,

    analogy: `
Usa una ANALOGÍA potente para iluminar el concepto desde otro ángulo.
Estructura: "Imagina X. Bueno, esto funciona igual: Y."
La analogía debe ser CONCRETA y conectar con la vida cotidiana${studentCarrera ? ` o con ${studentCarrera}` : ''}.
NO uses analogías genéricas tipo "como una computadora".`,

    comparison: `
COMPARA explícitamente lo que el estudiante pensó vs la realidad.
Estructura:
- "Tú pensaste: [resumen de su respuesta]"
- "La realidad es: [respuesta correcta]"
- "La diferencia está en: [el matiz clave]"
Termina con: "Por eso es importante distinguir X de Y."`,

    story: `
Cuenta una HISTORIA breve (científica, histórica o biográfica) que ilustre el concepto.
Estructura: "Hace [tiempo], [protagonista] tenía el mismo problema que tú..."
La historia debe DESCUBRIR la idea, no decirla directamente.
Después: "Y eso es exactamente lo que pasa aquí."`,

    real_case: `
Presenta un CASO REAL aplicado.
${studentCarrera ? `Conéctalo con ${studentCarrera}.` : ''}
Estructura: "Imagina [escenario concreto]. ¿Qué crees que pasaría? Pues exactamente esto..."
Hacer que el concepto se sienta útil, no abstracto.`,

    guided_discovery: `
NO des la respuesta. Devuelve con UNA pregunta que lleve al estudiante a descubrirla solo.
Estructura: "Si X fuera cierto... ¿qué tendría que pasar también?"
O: "¿Y si fuera al revés? ¿Funcionaría?"
Después de su pregunta, ESPERA. No respondas todavía.`,

    common_mistake: `
Valida el error como TÍPICO.
Estructura: "Ese error lo comete casi todo el mundo la primera vez."
"Y ocurre porque [explicación del por qué es intuitivo pero erróneo]."
"Lo que realmente pasa es: [explicación correcta corta]."
Hacer sentir al estudiante que no es tonto, es humano.`,

    connection: `
CONECTA lo que el estudiante acaba de entender con otro concepto.
Estructura: "Esto que acabas de aprender es exactamente lo que después explica X."
"Y también es la razón de Y."
Mostrar que una idea desbloquea muchas.`,

    thought_experiment: `
Plantea un EXPERIMENTO MENTAL.
Estructura: "Imagina que [escenario imposible o extremo]. ¿Qué pasaría?"
Después de su intuición, explica cómo el concepto se aplica.
Útil para construir intuición sobre ideas abstractas.`,

    counter_example: `
Muestra un CONTRA-EJEMPLO: un caso donde la idea NO aplica.
Estructura: "Aunque esto funciona en X, fíjate en Y. ¿Por qué crees que ahí no?"
Después: "Esto pasa porque [matiz del concepto]."
Ayuda a definir los LÍMITES del concepto.`,
  }

  const carreraNote = studentCarrera
    ? `\nCarrera del estudiante: ${studentCarrera}. Si puedes conectar con eso, hazlo natural.`
    : ''

  const zeroKnowledgeNote = studentKnowsNothing
    ? '\n⚠ El estudiante dijo que NO SABE NADA. NO uses "como ya sabes" o "obviamente".'
    : ''

  return `Eres ALAI. El estudiante acaba de responder. Tu trabajo es un TEACHING MOVE específico.

═══ LA PREGUNTA ═══
"${question}"

═══ SU RESPUESTA ═══
"${studentAnswer}"

${correctAnswer ? `═══ RESPUESTA CORRECTA ═══\n"${correctAnswer}"` : ''}
${expectedIdea ? `═══ IDEA ESPERADA ═══\n${expectedIdea}` : ''}

═══ TEMA ═══
${topicTitle}
Concepto: ${conceptTested || 'general'}
Score: ${score}/100
${carreraNote}${zeroKnowledgeNote}

═══ MATERIAL ═══
${materialContext ? materialContext.slice(0, 1500) : '(sin material)'}

═══ TU MOVIMIENTO HOY: "${move.toUpperCase()}" ═══
${moveInstructions[move]}

═══ FORMATO DE RESPUESTA ═══

Devuelve SOLO JSON:
{
  "moveType": "${move}",
  "content": "El feedback completo según el movimiento. Conversacional, 80-150 palabras. Sin meta-pensamiento.",
  "rememberThis": "UNA frase memorable que el estudiante debería poder repetirle a alguien (15-25 palabras)",
  "continueButton": "Texto del botón para continuar. NO siempre 'Continuar'. Adapta: 'Sigamos →', 'Lo tengo →', 'Vamos →', 'Piénsalo →', 'Otra más →', etc."
}

REGLAS:
- NO repetir el mismo patrón de feedback que otras preguntas
- Tono conversacional
- El contenido debe HACER el movimiento, no describirlo
- Sin asteriscos markdown
- Sin frases robóticas`
}
