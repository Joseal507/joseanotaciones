// ═══════════════════════════════════════════════════════════════
// StudyAL — Conversation Strategy
// ALAI no selecciona respuestas. DISEÑA conversaciones.
//
// Jerarquía:
//   1. Intention (qué necesita el estudiante AHORA)
//   2. EmotionalTarget (cómo debe sentirse en 2 minutos)
//   3. Strategy (qué tipo de conversación llevar)
//   4. Moves (qué movimientos usar en secuencia)
// ═══════════════════════════════════════════════════════════════

import type { StudentModel } from './adaptiveBrain'

// ═══════════════════════════════════════════════════════════════
// INTENCIÓN PEDAGÓGICA — qué necesita el estudiante ahora
// ═══════════════════════════════════════════════════════════════
export type TeachingIntention =
  | 'create_curiosity'        // Despertar curiosidad antes de explicar
  | 'correct_intuition'       // Corregir una idea equivocada
  | 'deepen_understanding'    // Profundizar lo que ya entiende
  | 'recover_motivation'      // Reenganchar al estudiante
  | 'build_connection'        // Conectar con otros conceptos
  | 'consolidate_confidence'  // Reforzar lo que sabe
  | 'challenge_thinking'      // Retar al estudiante

// ═══════════════════════════════════════════════════════════════
// OBJETIVO EMOCIONAL — cómo debe sentirse en 2 minutos
// ═══════════════════════════════════════════════════════════════
export type EmotionalTarget =
  | 'curious'      // "quiero saber más"
  | 'confident'    // "sí entiendo esto"
  | 'surprised'    // "¡no sabía eso!"
  | 'challenged'   // "esto es interesante de pensar"
  | 'reassured'    // "no soy tonto, esto es normal"
  | 'in_flow'      // "estoy aprendiendo rápido"

// ═══════════════════════════════════════════════════════════════
// ESTRATEGIA DE CONVERSACIÓN
// ═══════════════════════════════════════════════════════════════
export type ConversationStrategy =
  | 'socratic'     // Conducir con preguntas
  | 'narrative'    // Contar como historia
  | 'case_based'   // Caso real/aplicado
  | 'comparative'  // Comparar y contrastar
  | 'experiential' // Experimento mental
  | 'reconstructive' // Reconstruir desde el error

// ═══════════════════════════════════════════════════════════════
// MOVIMIENTOS — las acciones específicas dentro de una estrategia
// ═══════════════════════════════════════════════════════════════
export type Move =
  | 'ask_question'
  | 'tell_story'
  | 'give_analogy'
  | 'compare_two'
  | 'show_counter_example'
  | 'mini_lesson'
  | 'real_case'
  | 'thought_experiment'
  | 'validate_misconception'
  | 'connect_concepts'
  | 'celebrate_specific'

// ═══════════════════════════════════════════════════════════════
// EL PLAN COMPLETO DE CONVERSACIÓN
// ═══════════════════════════════════════════════════════════════
export interface ConversationPlan {
  intention: TeachingIntention
  emotionalTarget: EmotionalTarget
  strategy: ConversationStrategy
  moveSequence: Move[]              // hasta 3 movimientos en secuencia
  whyThisPlan: string                // razonamiento humano
}

// ═══════════════════════════════════════════════════════════════
// CARACTERÍSTICAS PEDAGÓGICAS POR CAMPO DE ESTUDIO
// (no random — basado en cómo se enseñan estas disciplinas)
// ═══════════════════════════════════════════════════════════════
interface FieldPedagogy {
  preferredStrategies: ConversationStrategy[]
  preferredMoves: Move[]
  avoidMoves: Move[]
}

function inferFieldPedagogy(carrera?: string): FieldPedagogy {
  const c = (carrera || '').toLowerCase()

  if (/medic|enferm|salud|odonto|clinic/.test(c)) {
    return {
      preferredStrategies: ['case_based', 'comparative', 'reconstructive'],
      preferredMoves: ['real_case', 'compare_two', 'validate_misconception'],
      avoidMoves: ['thought_experiment'],
    }
  }
  if (/matem|física|estadísti|cálcul/.test(c)) {
    return {
      preferredStrategies: ['socratic', 'experiential', 'reconstructive'],
      preferredMoves: ['ask_question', 'thought_experiment', 'show_counter_example'],
      avoidMoves: ['tell_story'],
    }
  }
  if (/ingenier|sistemas|software|comput/.test(c)) {
    return {
      preferredStrategies: ['case_based', 'experiential', 'comparative'],
      preferredMoves: ['real_case', 'thought_experiment', 'compare_two'],
      avoidMoves: ['tell_story'],
    }
  }
  if (/biolog|química|bioqu/.test(c)) {
    return {
      preferredStrategies: ['narrative', 'comparative', 'experiential'],
      preferredMoves: ['tell_story', 'give_analogy', 'thought_experiment'],
      avoidMoves: [],
    }
  }
  if (/histori|filosof|literatur|arte|social/.test(c)) {
    return {
      preferredStrategies: ['narrative', 'socratic', 'comparative'],
      preferredMoves: ['tell_story', 'ask_question', 'compare_two'],
      avoidMoves: ['thought_experiment'],
    }
  }
  if (/derecho|leyes|jurídic/.test(c)) {
    return {
      preferredStrategies: ['case_based', 'comparative', 'reconstructive'],
      preferredMoves: ['real_case', 'compare_two', 'show_counter_example'],
      avoidMoves: ['tell_story'],
    }
  }

  // Default: variado
  return {
    preferredStrategies: ['socratic', 'narrative', 'case_based'],
    preferredMoves: ['ask_question', 'give_analogy', 'mini_lesson'],
    avoidMoves: [],
  }
}

// ═══════════════════════════════════════════════════════════════
// DESIGN CONVERSATION — el corazón del sistema
// Decide intención → emoción → estrategia → secuencia de movimientos
// SIN RANDOM. Todo deriva del contexto.
// ═══════════════════════════════════════════════════════════════
export function designConversation(params: {
  studentAnswer: string
  score: number
  questionType: string
  conceptTested?: string
  model: StudentModel
  recentMoves: Move[]
  topicCarrera?: string
  topicTitle: string
}): ConversationPlan {
  const { studentAnswer, score, model, recentMoves, topicCarrera } = params

  const isCorrect = score >= 70
  const isPartial = score >= 40 && score < 70
  const isWrong = score < 40
  const answerLength = studentAnswer.trim().length

  // ═══════════════════════════════════════════════════════════════
  // 1. ¿QUÉ NECESITA EL ESTUDIANTE AHORA?  (intención)
  // ═══════════════════════════════════════════════════════════════
  let intention: TeachingIntention
  let whyIntention: string

  if (isWrong && model.motivation.engagement < 50) {
    intention = 'recover_motivation'
    whyIntention = 'Falló y está desconectado — primero hay que reenganchar'
  } else if (isWrong && answerLength > 50) {
    intention = 'correct_intuition'
    whyIntention = 'Pensó algo concreto pero erróneo — corregir el razonamiento'
  } else if (isWrong) {
    intention = 'create_curiosity'
    whyIntention = 'No tiene base — despertar interés antes de explicar'
  } else if (isPartial) {
    intention = 'correct_intuition'
    whyIntention = 'Tiene parte de la idea — afinar el matiz que falta'
  } else if (isCorrect && model.motivation.engagement > 70) {
    intention = 'challenge_thinking'
    whyIntention = 'Está en flow — subir el reto'
  } else if (isCorrect && model.memory.masteredConcepts.length >= 2) {
    intention = 'build_connection'
    whyIntention = 'Ya domina varios conceptos — conectarlos'
  } else if (isCorrect) {
    intention = 'deepen_understanding'
    whyIntention = 'Acertó — profundizar para que no sea memoria superficial'
  } else {
    intention = 'consolidate_confidence'
    whyIntention = 'Mantener confianza estable'
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. ¿CÓMO DEBE SENTIRSE EN 2 MINUTOS?  (emocional)
  // ═══════════════════════════════════════════════════════════════
  const emotionalTarget: EmotionalTarget = (() => {
    if (intention === 'create_curiosity') return 'curious'
    if (intention === 'correct_intuition') return 'reassured'
    if (intention === 'deepen_understanding') return 'surprised'
    if (intention === 'recover_motivation') return 'reassured'
    if (intention === 'build_connection') return 'in_flow'
    if (intention === 'consolidate_confidence') return 'confident'
    if (intention === 'challenge_thinking') return 'challenged'
    return 'confident'
  })()

  // ═══════════════════════════════════════════════════════════════
  // 3. ¿QUÉ ESTRATEGIA?  (basada en intención + campo + estado)
  // ═══════════════════════════════════════════════════════════════
  const fieldPed = inferFieldPedagogy(topicCarrera)

  // Mapeo base de intención → estrategias candidatas
  const intentionToStrategies: Record<TeachingIntention, ConversationStrategy[]> = {
    create_curiosity: ['narrative', 'socratic', 'experiential'],
    correct_intuition: ['reconstructive', 'comparative', 'socratic'],
    deepen_understanding: ['comparative', 'experiential', 'case_based'],
    recover_motivation: ['narrative', 'case_based'],
    build_connection: ['comparative', 'narrative'],
    consolidate_confidence: ['case_based', 'comparative'],
    challenge_thinking: ['experiential', 'socratic'],
  }

  // Intersectar con preferencias del campo
  const intentionStrategies = intentionToStrategies[intention]
  const intersected = intentionStrategies.filter(s => fieldPed.preferredStrategies.includes(s))
  const strategy: ConversationStrategy = intersected[0] || intentionStrategies[0]

  // ═══════════════════════════════════════════════════════════════
  // 4. ¿QUÉ SECUENCIA DE MOVIMIENTOS?
  // ═══════════════════════════════════════════════════════════════
  const moveSequence = designMoveSequence({
    intention,
    strategy,
    fieldPed,
    recentMoves,
    isWrong,
    isCorrect,
    energy: model.motivation.energy,
  })

  // ═══════════════════════════════════════════════════════════════
  // 5. RAZONAMIENTO HUMANO
  // ═══════════════════════════════════════════════════════════════
  const whyThisPlan = `${whyIntention}. Por eso uso una conversación ${strategy} con foco en que se sienta ${emotionalTarget}.`

  return {
    intention,
    emotionalTarget,
    strategy,
    moveSequence,
    whyThisPlan,
  }
}

// ═══════════════════════════════════════════════════════════════
// DISEÑAR SECUENCIA DE MOVIMIENTOS
// (un profesor cambia de movimiento dentro de la misma respuesta)
// ═══════════════════════════════════════════════════════════════
function designMoveSequence(params: {
  intention: TeachingIntention
  strategy: ConversationStrategy
  fieldPed: FieldPedagogy
  recentMoves: Move[]
  isWrong: boolean
  isCorrect: boolean
  energy: number
}): Move[] {
  const { intention, strategy, fieldPed, recentMoves, isWrong, isCorrect, energy } = params

  // Plantillas de secuencia por estrategia (no fija — un menú)
  const strategyMoves: Record<ConversationStrategy, Move[][]> = {
    socratic: [
      ['ask_question', 'mini_lesson', 'connect_concepts'],
      ['ask_question', 'thought_experiment'],
      ['validate_misconception', 'ask_question'],
    ],
    narrative: [
      ['tell_story', 'connect_concepts'],
      ['tell_story', 'ask_question'],
      ['tell_story', 'mini_lesson', 'real_case'],
    ],
    case_based: [
      ['real_case', 'ask_question', 'mini_lesson'],
      ['real_case', 'compare_two'],
      ['real_case', 'mini_lesson'],
    ],
    comparative: [
      ['compare_two', 'mini_lesson'],
      ['compare_two', 'show_counter_example'],
      ['compare_two', 'connect_concepts'],
    ],
    experiential: [
      ['thought_experiment', 'mini_lesson'],
      ['thought_experiment', 'ask_question'],
      ['thought_experiment', 'real_case'],
    ],
    reconstructive: [
      ['validate_misconception', 'mini_lesson', 'compare_two'],
      ['validate_misconception', 'ask_question'],
      ['validate_misconception', 'give_analogy', 'mini_lesson'],
    ],
  }

  const candidates = strategyMoves[strategy]

  // Filtrar secuencias que NO empiecen con un movimiento usado recientemente
  const lastMove = recentMoves[recentMoves.length - 1]
  const filtered = candidates.filter(seq => seq[0] !== lastMove)
  const pool = filtered.length > 0 ? filtered : candidates

  // Filtrar movimientos en avoid del campo
  const cleanPool = pool.map(seq =>
    seq.filter(m => !fieldPed.avoidMoves.includes(m))
  ).filter(seq => seq.length > 0)

  // Si energía baja, preferir secuencias más cortas
  let chosen: Move[]
  if (energy < 40) {
    chosen = cleanPool.sort((a, b) => a.length - b.length)[0] || cleanPool[0]
  } else {
    // Preferir secuencia que NO repita ningún reciente
    chosen = cleanPool.find(seq => !seq.some(m => recentMoves.slice(-2).includes(m)))
            || cleanPool[0]
  }

  // Si acertó perfecto, agregar celebrate_specific al inicio si no está
  if (isCorrect && !chosen.includes('celebrate_specific')) {
    chosen = ['celebrate_specific', ...chosen.slice(0, 2)]
  }

  return chosen.slice(0, 3)
}

// ═══════════════════════════════════════════════════════════════
// CONSTRUIR PROMPT desde el plan de conversación
// ═══════════════════════════════════════════════════════════════
export function buildConversationPrompt(params: {
  plan: ConversationPlan
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
    plan, question, studentAnswer, correctAnswer, expectedIdea, conceptTested,
    topicTitle, materialContext, studentCarrera, studentKnowsNothing, score,
  } = params

  // Descripciones de las intenciones
  const intentionDescriptions: Record<TeachingIntention, string> = {
    create_curiosity: 'Hacer que el estudiante QUIERA saber más antes de darle la respuesta',
    correct_intuition: 'Corregir su razonamiento sin que se sienta tonto',
    deepen_understanding: 'Llevar lo que sabe a un nivel más profundo',
    recover_motivation: 'Reenganchar emocionalmente al estudiante',
    build_connection: 'Conectar este concepto con otros que ya domina',
    consolidate_confidence: 'Reforzar lo que sabe sin sobreestimarlo',
    challenge_thinking: 'Subir el reto porque está en flow',
  }

  const emotionalDescriptions: Record<EmotionalTarget, string> = {
    curious: 'Quiero que termine pensando "necesito saber esto"',
    confident: 'Quiero que termine sintiendo "sí entendí"',
    surprised: 'Quiero que termine diciendo "¡no sabía eso!"',
    challenged: 'Quiero que termine pensando "esto está interesante"',
    reassured: 'Quiero que termine sintiendo "no soy tonto, esto es normal"',
    in_flow: 'Quiero que termine en estado de flow, aprendiendo rápido',
  }

  const strategyDescriptions: Record<ConversationStrategy, string> = {
    socratic: 'Conducir con preguntas, no con respuestas. Que descubra solo.',
    narrative: 'Contar como historia. Personajes, problema, descubrimiento.',
    case_based: 'Usar un caso real específico. Aplicar el concepto a algo concreto.',
    comparative: 'Comparar dos cosas. Lo que pensó vs lo correcto, o A vs B.',
    experiential: 'Experimento mental. "Imagina que..." para construir intuición.',
    reconstructive: 'Validar el razonamiento erróneo y reconstruir desde ahí.',
  }

  const moveDescriptions: Record<Move, string> = {
    ask_question: 'haz una pregunta',
    tell_story: 'cuenta una breve historia',
    give_analogy: 'usa una analogía',
    compare_two: 'compara dos cosas',
    show_counter_example: 'muestra un contraejemplo',
    mini_lesson: 'da una mini explicación',
    real_case: 'pon un caso real',
    thought_experiment: 'plantea un experimento mental',
    validate_misconception: 'valida el error como típico',
    connect_concepts: 'conecta con otro concepto',
    celebrate_specific: 'reconoce lo específico que hizo bien',
  }

  const carreraNote = studentCarrera
    ? `\nCarrera del estudiante: ${studentCarrera}. Conecta naturalmente si encaja.`
    : ''

  const zeroKnowledgeNote = studentKnowsNothing
    ? '\n⚠ El estudiante NO SABE NADA del tema. NUNCA digas "como ya sabes".'
    : ''

  const sequenceNarrative = plan.moveSequence
    .map((m, i) => `${i + 1}. ${moveDescriptions[m]}`)
    .join(' → ')

  return `Eres ALAI, un profesor que DISEÑA CONVERSACIONES, no que selecciona respuestas.

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

═══ MATERIAL DE REFERENCIA ═══
${materialContext ? materialContext.slice(0, 1500) : '(sin material)'}

═══ TU PLAN DE CONVERSACIÓN PARA AHORA ═══

INTENCIÓN: ${plan.intention}
→ ${intentionDescriptions[plan.intention]}

OBJETIVO EMOCIONAL: ${plan.emotionalTarget}
→ ${emotionalDescriptions[plan.emotionalTarget]}

ESTRATEGIA: ${plan.strategy}
→ ${strategyDescriptions[plan.strategy]}

SECUENCIA DE MOVIMIENTOS: ${sequenceNarrative}

POR QUÉ ESTE PLAN: ${plan.whyThisPlan}

═══ INSTRUCCIONES ═══

Tu respuesta debe EJECUTAR este plan completo, no solo dar feedback.

REGLAS:
- NUNCA digas solo "correcto" o "incorrecto"
- Ejecuta los movimientos en orden, fluido, sin anunciarlos
- El estudiante debe terminar SINTIÉNDOSE como dice el objetivo emocional
- Conversacional, sin meta-pensamiento
- Sin asteriscos markdown
- 100-180 palabras totales

═══ FORMATO DE RESPUESTA ═══

Devuelve SOLO JSON:
{
  "content": "El contenido completo de la conversación que ejecuta los movimientos",
  "rememberThis": "UNA frase memorable que el estudiante pueda contarle a alguien (15-25 palabras)",
  "continueButton": "Texto del botón. Adapta al momento: 'Sigamos →', 'Piénsalo →', 'Vamos →', 'Otra más →', 'Lo tengo →', etc.",
  "emotionalCheck": "Una palabra: cómo crees que se sentirá el estudiante después de leer esto"
}`
}
