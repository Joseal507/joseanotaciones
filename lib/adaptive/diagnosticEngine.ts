// ═══════════════════════════════════════════════════════════════
// StudyAL — Diagnostic Engine
// Antes de enseñar, DIAGNOSTICA.
// Después de cada respuesta, ACTUALIZA HIPÓTESIS y reajusta.
// Esto convierte a ALAI en un profesor que entiende, no que ejecuta.
// ═══════════════════════════════════════════════════════════════

import type { MaterialTopic } from './blueprint'

// ═══════════════════════════════════════════════════════════════
// HIPÓTESIS PEDAGÓGICA — qué cree ALAI sobre el estudiante
// ═══════════════════════════════════════════════════════════════
export interface TeachingHypothesis {
  id: string
  createdAt: number

  // Qué cree ALAI
  belief: string                  // "El estudiante no entiende ATP"
  confidence: number              // 0-100

  // Sub-conceptos involucrados
  rootConcept: string             // el concepto raíz que cree que falla
  relatedConcepts: string[]       // conceptos satélite

  // Evidencia
  evidenceFor: string[]           // qué señales apoyan la hipótesis
  evidenceAgainst: string[]       // qué señales la contradicen

  // Estado
  status: 'forming' | 'testing' | 'confirmed' | 'refuted'

  // Test pendiente
  nextTest?: {
    question: string
    questionType: string
    expectedIfTrue: string
    expectedIfFalse: string
  }
}

// ═══════════════════════════════════════════════════════════════
// STUDENT MODEL — el modelo vivo del estudiante en esta sesión
// ═══════════════════════════════════════════════════════════════
export interface LiveStudentModel {
  // Estado del momento
  currentTopic: string
  topicMastery: number

  // Hipótesis activas
  hypotheses: TeachingHypothesis[]

  // Conceptos: confianza ACTUAL en cada uno (no histórico)
  conceptBeliefs: Record<string, {
    understood: number       // 0-100 qué tan seguro está ALAI que entiende
    lastTested: number       // timestamp
    failedAttempts: number
  }>

  // Memoria pedagógica de ESTA sesión
  analogiesUsed: string[]
  examplesUsed: string[]
  questionsAsked: string[]
  approachesTriedAndFailed: string[]

  // Estado emocional inferido
  studentState: {
    confidence: 'low' | 'medium' | 'high'
    engagement: 'distracted' | 'engaged' | 'flow'
    frustration: 'none' | 'mild' | 'high'
    consecutiveCorrect: number
    consecutiveWrong: number
  }
}

// ═══════════════════════════════════════════════════════════════
// CREAR MODELO INICIAL
// ═══════════════════════════════════════════════════════════════
export function createStudentModel(params: {
  topic: MaterialTopic
  topicMastery: number
  weakConcepts: string[]
  criticalConcepts: string[]
}): LiveStudentModel {
  const { topic, topicMastery, weakConcepts, criticalConcepts } = params

  // Crear creencias iniciales sobre cada concepto
  const conceptBeliefs: LiveStudentModel['conceptBeliefs'] = {}
  for (const concept of (topic.concepts || [])) {
    const isCritical = criticalConcepts.includes(concept.name)
    const isWeak = weakConcepts.includes(concept.name)
    conceptBeliefs[concept.name] = {
      understood: isCritical ? 15 : isWeak ? 35 : Math.min(80, topicMastery),
      lastTested: 0,
      failedAttempts: 0,
    }
  }

  return {
    currentTopic: topic.title,
    topicMastery,
    hypotheses: [],
    conceptBeliefs,
    analogiesUsed: [],
    examplesUsed: [],
    questionsAsked: [],
    approachesTriedAndFailed: [],
    studentState: {
      confidence: topicMastery > 60 ? 'high' : topicMastery > 30 ? 'medium' : 'low',
      engagement: 'engaged',
      frustration: 'none',
      consecutiveCorrect: 0,
      consecutiveWrong: 0,
    },
  }
}

// ═══════════════════════════════════════════════════════════════
// FORMULAR HIPÓTESIS INICIAL
// (antes de la primera explicación)
// ═══════════════════════════════════════════════════════════════
export function formulateInitialHypothesis(
  model: LiveStudentModel,
  topic: MaterialTopic,
): TeachingHypothesis {
  // Identificar el concepto más probable que falle
  const weakestConcept = Object.entries(model.conceptBeliefs)
    .sort((a, b) => a[1].understood - b[1].understood)[0]

  const rootConcept = weakestConcept ? weakestConcept[0] : (topic.concepts?.[0]?.name || topic.title)
  const understanding = weakestConcept ? weakestConcept[1].understood : 50

  let belief: string
  let confidence: number

  if (understanding < 25) {
    belief = `El estudiante probablemente no tiene noción real de "${rootConcept}"`
    confidence = 70
  } else if (understanding < 50) {
    belief = `El estudiante reconoce "${rootConcept}" pero no entiende su lógica profunda`
    confidence = 60
  } else if (understanding < 75) {
    belief = `El estudiante entiende "${rootConcept}" pero podría tener confusiones sutiles`
    confidence = 55
  } else {
    belief = `El estudiante ya domina lo básico, hay que detectar puntos ciegos en "${rootConcept}"`
    confidence = 50
  }

  // Conceptos relacionados (mismo topic)
  const relatedConcepts = (topic.concepts || [])
    .filter(c => c.name !== rootConcept)
    .map(c => c.name)
    .slice(0, 3)

  return {
    id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    belief,
    confidence,
    rootConcept,
    relatedConcepts,
    evidenceFor: [`Mastery histórico de "${rootConcept}": ${understanding}%`],
    evidenceAgainst: [],
    status: 'forming',
  }
}

// ═══════════════════════════════════════════════════════════════
// ACTUALIZAR MODELO después de cada respuesta
// ═══════════════════════════════════════════════════════════════
export function updateModelFromResponse(
  model: LiveStudentModel,
  response: {
    questionAsked: string
    answerGiven: string
    score: number
    conceptTested?: string
    questionType?: string
  },
): {
  updatedModel: LiveStudentModel
  diagnosis: string
  shouldReformulate: boolean
} {
  const updated: LiveStudentModel = {
    ...model,
    questionsAsked: [...model.questionsAsked, response.questionAsked],
    conceptBeliefs: { ...model.conceptBeliefs },
    studentState: { ...model.studentState },
  }

  // Actualizar belief del concepto testeado
  if (response.conceptTested && updated.conceptBeliefs[response.conceptTested]) {
    const current = updated.conceptBeliefs[response.conceptTested]
    const newUnderstanding = Math.round(current.understood * 0.5 + response.score * 0.5)
    updated.conceptBeliefs[response.conceptTested] = {
      understood: newUnderstanding,
      lastTested: Date.now(),
      failedAttempts: response.score < 50 ? current.failedAttempts + 1 : current.failedAttempts,
    }
  }

  // Actualizar estado emocional
  if (response.score >= 70) {
    updated.studentState.consecutiveCorrect += 1
    updated.studentState.consecutiveWrong = 0
    if (updated.studentState.consecutiveCorrect >= 3) {
      updated.studentState.confidence = 'high'
      updated.studentState.engagement = 'flow'
    }
  } else if (response.score < 40) {
    updated.studentState.consecutiveWrong += 1
    updated.studentState.consecutiveCorrect = 0
    if (updated.studentState.consecutiveWrong >= 2) {
      updated.studentState.frustration = updated.studentState.consecutiveWrong >= 3 ? 'high' : 'mild'
      updated.studentState.confidence = 'low'
    }
  }

  // Diagnóstico
  let diagnosis = ''
  let shouldReformulate = false

  if (response.score >= 75) {
    diagnosis = `Respuesta sólida en "${response.conceptTested || 'el concepto'}". Confianza confirmada.`
  } else if (response.score >= 50) {
    diagnosis = `Respuesta parcial. Entiende algo pero hay vacíos. Vale la pena profundizar.`
    shouldReformulate = true
  } else {
    diagnosis = `Respuesta débil. La hipótesis inicial puede estar mal o el concepto raíz es otro.`
    shouldReformulate = true
  }

  // Si lleva 2 fallos seguidos en el mismo concepto, hay que cambiar de enfoque
  if (response.conceptTested) {
    const beliefs = updated.conceptBeliefs[response.conceptTested]
    if (beliefs && beliefs.failedAttempts >= 2) {
      diagnosis += ` Ya falló 2 veces en "${response.conceptTested}" — necesita ángulo completamente nuevo.`
      shouldReformulate = true
    }
  }

  return { updatedModel: updated, diagnosis, shouldReformulate }
}

// ═══════════════════════════════════════════════════════════════
// REFORMULAR HIPÓTESIS después de evidencia
// ═══════════════════════════════════════════════════════════════
export function reformulateHypothesis(
  oldHypothesis: TeachingHypothesis,
  model: LiveStudentModel,
  lastResponse: { score: number; answerGiven: string; conceptTested?: string },
): TeachingHypothesis {
  // Encontrar el concepto MÁS débil ahora
  const sortedBeliefs = Object.entries(model.conceptBeliefs)
    .sort((a, b) => a[1].understood - b[1].understood)

  const weakestConcept = sortedBeliefs[0]?.[0] || oldHypothesis.rootConcept

  // ¿El root cambió?
  const rootChanged = weakestConcept !== oldHypothesis.rootConcept

  let belief: string
  let confidence: number
  let status: TeachingHypothesis['status']

  if (rootChanged) {
    belief = `Cambio de hipótesis: el problema real está en "${weakestConcept}", no en "${oldHypothesis.rootConcept}"`
    confidence = 65
    status = 'forming'
  } else if (lastResponse.score >= 70) {
    belief = `Confirmado: el estudiante entiende mejor "${oldHypothesis.rootConcept}" de lo que pensaba`
    confidence = 80
    status = 'refuted'  // la hipótesis original era pesimista
  } else if (lastResponse.score < 30) {
    belief = `Reforzado: "${oldHypothesis.rootConcept}" sigue siendo el problema. Hay que cambiar de ángulo.`
    confidence = Math.min(90, oldHypothesis.confidence + 15)
    status = 'confirmed'
  } else {
    belief = `Refinando: el estudiante tiene comprensión parcial de "${oldHypothesis.rootConcept}"`
    confidence = oldHypothesis.confidence
    status = 'testing'
  }

  const newEvidence = [
    ...oldHypothesis.evidenceFor,
    `Respuesta ${lastResponse.score}% en pregunta sobre "${lastResponse.conceptTested || 'tema'}"`,
  ]

  return {
    id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    belief,
    confidence,
    rootConcept: weakestConcept,
    relatedConcepts: oldHypothesis.relatedConcepts.filter(c => c !== weakestConcept),
    evidenceFor: newEvidence.slice(-5),
    evidenceAgainst: oldHypothesis.evidenceAgainst,
    status,
  }
}

// ═══════════════════════════════════════════════════════════════
// SIGUIENTE ACCIÓN PEDAGÓGICA
// (qué hacer después de actualizar el modelo)
// ═══════════════════════════════════════════════════════════════
export type NextAction =
  | { type: 'continue_explaining'; reason: string; focus: string }
  | { type: 'change_angle'; reason: string; abandonApproach: string; newDirection: string }
  | { type: 'test_understanding'; reason: string; question: string; questionType: string; concept: string }
  | { type: 'celebrate_and_advance'; reason: string; nextConcept: string }
  | { type: 'reduce_difficulty'; reason: string; simplerConcept: string }
  | { type: 'increase_difficulty'; reason: string; challengeWith: string }
  | { type: 'close_session'; reason: string; summary: string }

export function decideNextAction(
  model: LiveStudentModel,
  currentHypothesis: TeachingHypothesis,
  stagesCompleted: number,
  totalStagesPlanned: number,
): NextAction {
  const state = model.studentState

  // Si lleva 3+ correctas → avanzar y subir dificultad
  if (state.consecutiveCorrect >= 3) {
    const dominatedConcepts = Object.entries(model.conceptBeliefs)
      .filter(([_, b]) => b.understood >= 70)
      .map(([name]) => name)
    const nextChallenge = Object.entries(model.conceptBeliefs)
      .filter(([name]) => !dominatedConcepts.includes(name))
      .sort((a, b) => b[1].understood - a[1].understood)[0]?.[0]

    if (nextChallenge) {
      return {
        type: 'increase_difficulty',
        reason: `${state.consecutiveCorrect} respuestas seguidas correctas. Está listo para más.`,
        challengeWith: nextChallenge,
      }
    } else {
      return {
        type: 'celebrate_and_advance',
        reason: 'Dominó todos los conceptos centrales de este topic.',
        nextConcept: 'siguiente topic',
      }
    }
  }

  // Si lleva 2+ incorrectas → cambiar ángulo
  if (state.consecutiveWrong >= 2) {
    return {
      type: 'change_angle',
      reason: `${state.consecutiveWrong} respuestas seguidas débiles. La aproximación actual no funciona.`,
      abandonApproach: model.approachesTriedAndFailed[model.approachesTriedAndFailed.length - 1] || 'enfoque actual',
      newDirection: `Atacar "${currentHypothesis.rootConcept}" con analogía completamente distinta`,
    }
  }

  // Si está frustrado → bajar dificultad
  if (state.frustration === 'high') {
    const easierConcept = Object.entries(model.conceptBeliefs)
      .filter(([_, b]) => b.understood >= 40 && b.understood < 70)
      .sort((a, b) => b[1].understood - a[1].understood)[0]?.[0]

    return {
      type: 'reduce_difficulty',
      reason: 'Detecté frustración. Volvamos a algo que sí domina para reconstruir confianza.',
      simplerConcept: easierConcept || 'concepto base',
    }
  }

  // Si hipótesis no confirmada y faltan muchas etapas → testear
  if (currentHypothesis.status === 'forming' && stagesCompleted < totalStagesPlanned / 2) {
    return {
      type: 'test_understanding',
      reason: 'Necesito más evidencia para confirmar mi hipótesis.',
      question: `Sobre "${currentHypothesis.rootConcept}", ¿puedes explicar...?`,
      questionType: 'explain_why',
      concept: currentHypothesis.rootConcept,
    }
  }

  // Si ya cubrió suficiente → cerrar
  if (stagesCompleted >= totalStagesPlanned - 1) {
    return {
      type: 'close_session',
      reason: 'Cubrimos los puntos clave de hoy.',
      summary: `Trabajamos "${model.currentTopic}". Tu comprensión mejoró en ${
        Object.values(model.conceptBeliefs).filter(b => b.understood > 60).length
      } conceptos.`,
    }
  }

  // Default: continuar explicando con foco
  return {
    type: 'continue_explaining',
    reason: 'Continuamos construyendo comprensión.',
    focus: currentHypothesis.rootConcept,
  }
}

// ═══════════════════════════════════════════════════════════════
// PROMPT GENERATOR para micro-acciones
// (no genera la clase entera — genera la SIGUIENTE micro acción)
// ═══════════════════════════════════════════════════════════════
export function buildMicroActionPrompt(params: {
  action: NextAction
  model: LiveStudentModel
  hypothesis: TeachingHypothesis
  materialSlice: string
  userCarrera?: string
}): string {
  const { action, model, hypothesis, materialSlice, userCarrera } = params

  const studentEmotionalContext = `
Estado del estudiante:
- Confianza: ${model.studentState.confidence}
- Frustración: ${model.studentState.frustration}
- Engagement: ${model.studentState.engagement}
- Últimas: ${model.studentState.consecutiveCorrect} correctas, ${model.studentState.consecutiveWrong} incorrectas`

  const memoryContext = `
Lo que YA usaste en esta sesión (no repetir):
- Analogías: ${model.analogiesUsed.join(', ') || 'ninguna'}
- Ejemplos: ${model.examplesUsed.join(', ') || 'ninguno'}
- Enfoques que fallaron: ${model.approachesTriedAndFailed.join(', ') || 'ninguno'}`

  const carreraNote = userCarrera
    ? `\nSI usas analogías, conéctalas con: ${userCarrera}.`
    : ''

  let actionPrompt = ''
  switch (action.type) {
    case 'continue_explaining':
      actionPrompt = `Continúa explicando "${action.focus}". Profundiza UN aspecto que no hayas tocado.`
      break
    case 'change_angle':
      actionPrompt = `CAMBIA COMPLETAMENTE el enfoque. ${action.reason} Abandona "${action.abandonApproach}" y prueba: ${action.newDirection}`
      break
    case 'test_understanding':
      actionPrompt = `Haz UNA pregunta tipo ${action.questionType} sobre "${action.concept}". La pregunta debe DIAGNOSTICAR, no evaluar.`
      break
    case 'celebrate_and_advance':
      actionPrompt = `Reconoce el dominio del estudiante con autenticidad (no genérico). Conecta con el siguiente concepto: ${action.nextConcept}`
      break
    case 'reduce_difficulty':
      actionPrompt = `El estudiante está frustrado. Vuelve a "${action.simplerConcept}" donde sí tiene confianza. Reconstruye desde ahí.`
      break
    case 'increase_difficulty':
      actionPrompt = `El estudiante está en flow. Súbele la dificultad: hazle pensar sobre "${action.challengeWith}" en un caso menos obvio.`
      break
    case 'close_session':
      actionPrompt = `Cierra la sesión: ${action.summary}. Sé auténtico, no genérico.`
      break
  }

  return `Eres ALAI, un profesor que diagnostica y reajusta CONSTANTEMENTE.

═══ TU HIPÓTESIS ACTUAL ═══
"${hypothesis.belief}"
Confianza: ${hypothesis.confidence}%
Concepto raíz que crees que falla: ${hypothesis.rootConcept}
Estado: ${hypothesis.status}

═══ ESTADO DEL ESTUDIANTE ═══
${studentEmotionalContext}

═══ MEMORIA DE ESTA SESIÓN ═══
${memoryContext}
${carreraNote}

═══ TU SIGUIENTE ACCIÓN ═══
Tipo: ${action.type}
Razón: ${action.reason}

═══ INSTRUCCIÓN ESPECÍFICA ═══
${actionPrompt}

═══ MATERIAL DE REFERENCIA ═══
${materialSlice.slice(0, 2500)}

═══ REGLAS ═══
- NO uses analogías ya usadas (lista arriba)
- NO repitas enfoques que fallaron
- Tu respuesta debe sentirse como un profesor PENSANDO, no ejecutando
- Si estás celebrando, sé auténtico ("Ya veo que esto te quedó claro" en vez de "¡Excelente!")
- Si estás cambiando ángulo, di POR QUÉ ("Espera, creo que el problema no es esto...")
- Máximo 150 palabras
- Tono: cercano, humano, pensante

Devuelve SOLO JSON:
{
  "thought": "Lo que ALAI está pensando (visible al estudiante como cita pequeña al inicio)",
  "content": "El contenido principal de la micro-acción",
  "expectAnswer": true/false,
  "questionToAsk": "Si expectAnswer es true, la pregunta exacta",
  "questionType": "open_essay | multiple_choice | explain_why | apply_scenario | predict_outcome | find_error",
  "conceptBeingTested": "Cuál concepto está siendo testeado",
  "analogyUsedHere": "Nombre corto de la analogía si usaste una (para memoria)",
  "exampleUsedHere": "Nombre corto del ejemplo si usaste uno"
}`
}
