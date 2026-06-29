// ═══════════════════════════════════════════════════════════════
// StudyAL — Adaptive Brain v2
// Cambios clave:
//   - Estado bidimensional (comprensión + motivación)
//   - Micro-objetivos con intención específica
//   - Memoria de lo que funcionó (no solo lo que falló)
//   - LLM decide pedagogía, código guarda guardrails
// ═══════════════════════════════════════════════════════════════

import type { MaterialTopic } from './blueprint'
import type { UserProfile } from './userProfile'
import type { LearningMemory } from './learningMemory'
import { buildPrinciplesPrompt } from './teachingPrinciples'

// ═══════════════════════════════════════════════════════════════
// STUDENT MODEL — minimalista pero rico
// ═══════════════════════════════════════════════════════════════
export interface StudentModel {
  topicId: string
  topicTitle: string

  // Comprensión por concepto (lo que sabe)
  concepts: Record<string, number>  // 0-100

  // Estado BIDIMENSIONAL — separar comprensión de motivación
  comprehension: {
    level: number              // 0-100 qué tan claro tiene el tema
    stability: number          // 0-100 qué tan firme es esa comprensión
  }
  motivation: {
    energy: number             // 0-100 qué tan activo está
    engagement: number         // 0-100 qué tan conectado con el tema
  }

  // Evidencia recolectada (no solo respuestas — todo lo que el estudiante hace)
  evidence: {
    avgResponseTimeMs: number
    fastestResponseMs: number
    slowestResponseMs: number
    shortAnswersCount: number
    detailedAnswersCount: number
    optionsChangedCount: number
    abandonedQuestions: number
    multipleEditsCount: number
    sessionStartMs: number
  }

  // Memoria pedagógica — lo que FALLÓ y lo que FUNCIONÓ
  memory: {
    analogiesTried: string[]
    failedApproaches: string[]
    successfulApproaches: string[]   // ← clave: qué SÍ funcionó
    masteredConcepts: string[]
  }

  // Micro-objetivos del topic actual
  microObjectives: MicroObjective[]
  currentMicroObjectiveIdx: number

  // ── Ritmo pedagógico (anti método-socrático compulsivo) ──
  rhythm: {
    consecutiveQuestions: number
    blocksWithoutExplanation: number
    lastBlockType: 'explanation' | 'question' | 'mixed' | null
    totalExplanations: number
    totalQuestions: number
    recentQuestionTypes: string[]    // últimos 5 tipos para variar
  }

  // ── Calibración: lo declarado vs lo demostrado ──
  declaredKnowledge?: 'zero' | 'some' | 'review' | 'mastered'
  knowledgeCalibration?: {
    declaredLevel: number
    actualLevel: number
    mismatch: number
    mismatchDirection: 'overestimated' | 'underestimated' | 'aligned'
    shouldReplan: boolean
    detectedAtBlock: number
  }
}

// ═══════════════════════════════════════════════════════════════
// MICRO-OBJETIVO — una idea específica para descubrir
// ═══════════════════════════════════════════════════════════════
export interface MicroObjective {
  id: string
  intent: string              // "Descubrir que ATP no es energía, sino un medio para transferirla"
  evidenceOfSuccess: string   // "El estudiante puede explicar por qué la célula no usa glucosa directamente"
  relatedConcepts: string[]   // qué conceptos involucra
  status: 'pending' | 'in_progress' | 'mastered' | 'skipped'
  attemptsMade: number
}

// ═══════════════════════════════════════════════════════════════
// CREAR MODEL + descomponer topic en micro-objetivos
// ═══════════════════════════════════════════════════════════════
export function createStudentModel(params: {
  topic: MaterialTopic
  topicMastery: number
  weakConcepts: string[]
  criticalConcepts: string[]
}): StudentModel {
  const { topic, topicMastery, weakConcepts, criticalConcepts } = params

  const concepts: Record<string, number> = {}
  for (const c of (topic.concepts || [])) {
    if (criticalConcepts.includes(c.name)) concepts[c.name] = 15
    else if (weakConcepts.includes(c.name)) concepts[c.name] = 35
    else concepts[c.name] = Math.min(75, topicMastery)
  }

  // Descomponer topic en micro-objetivos automáticamente
  const microObjectives = buildMicroObjectives(topic)

  return {
    topicId: topic.id,
    topicTitle: topic.title,
    concepts,
    comprehension: {
      level: topicMastery,
      stability: 30,
    },
    motivation: {
      energy: 70,        // empieza con buena energía
      engagement: 60,
    },
    evidence: {
      avgResponseTimeMs: 0,
      fastestResponseMs: 0,
      slowestResponseMs: 0,
      shortAnswersCount: 0,
      detailedAnswersCount: 0,
      optionsChangedCount: 0,
      abandonedQuestions: 0,
      multipleEditsCount: 0,
      sessionStartMs: Date.now(),
    },
    memory: {
      analogiesTried: [],
      failedApproaches: [],
      successfulApproaches: [],
      masteredConcepts: [],
    },
    microObjectives,
    currentMicroObjectiveIdx: 0,
    rhythm: {
      consecutiveQuestions: 0,
      blocksWithoutExplanation: 0,
      lastBlockType: null,
      totalExplanations: 0,
      totalQuestions: 0,
      recentQuestionTypes: [],
    },
  }
}

// ═══════════════════════════════════════════════════════════════
// DESCOMPONER topic en micro-objetivos con intención
// ═══════════════════════════════════════════════════════════════
function buildMicroObjectives(topic: MaterialTopic): MicroObjective[] {
  const objectives: MicroObjective[] = []
  const concepts = topic.concepts || []

  // 1. Primer micro-objetivo: comprensión intuitiva
  objectives.push({
    id: `mo_${Date.now()}_1`,
    intent: `Lograr que el estudiante construya intuición sobre por qué existe "${topic.title}" antes de definirlo`,
    evidenceOfSuccess: `Puede explicar con sus palabras qué problema resuelve "${topic.title}"`,
    relatedConcepts: concepts.slice(0, 2).map(c => c.name),
    status: 'pending',
    attemptsMade: 0,
  })

  // 2. Si hay conceptos críticos, micro-objetivo por concepto
  const criticalConcepts = concepts.filter(c => c.importance === 'critical').slice(0, 2)
  for (const c of criticalConcepts) {
    objectives.push({
      id: `mo_${Date.now()}_${c.name.slice(0, 8)}`,
      intent: `Lograr que el estudiante descubra la lógica profunda de "${c.name}"`,
      evidenceOfSuccess: `Puede aplicar "${c.name}" a un caso nuevo, no solo recordarlo`,
      relatedConcepts: [c.name],
      status: 'pending',
      attemptsMade: 0,
    })
  }

  // 3. Si hay >3 conceptos, micro-objetivo de síntesis
  if (concepts.length >= 3) {
    objectives.push({
      id: `mo_${Date.now()}_synthesis`,
      intent: `Conectar los conceptos de "${topic.title}" en una imagen coherente`,
      evidenceOfSuccess: `Puede explicar cómo se relacionan ${concepts.slice(0, 3).map(c => c.name).join(', ')}`,
      relatedConcepts: concepts.slice(0, 3).map(c => c.name),
      status: 'pending',
      attemptsMade: 0,
    })
  }

  // 4. Si el topic es importante, micro-objetivo de aplicación
  if ((topic.importance ?? 50) >= 60) {
    objectives.push({
      id: `mo_${Date.now()}_apply`,
      intent: `Demostrar que puede aplicar "${topic.title}" en un escenario realista`,
      evidenceOfSuccess: `Resuelve un caso aplicado correctamente`,
      relatedConcepts: concepts.slice(0, 3).map(c => c.name),
      status: 'pending',
      attemptsMade: 0,
    })
  }

  return objectives
}

// ═══════════════════════════════════════════════════════════════
// UPDATE MODEL — después de cada interacción
// ═══════════════════════════════════════════════════════════════
export function updateModel(
  model: StudentModel,
  interaction: {
    conceptTested?: string
    score: number
    analogyUsed?: string
    approachUsed?: string
    timeSpentMs?: number
    // Evidencia rica
    answerLength?: number       // chars de la respuesta
    optionChanges?: number       // veces que cambió opción antes de enviar
    edits?: number               // veces que borró y reescribió
    abandoned?: boolean          // no respondió
  },
): StudentModel {
  const updated: StudentModel = JSON.parse(JSON.stringify(model))

  // ── Actualizar comprensión del concepto ──────────────
  if (interaction.conceptTested && updated.concepts[interaction.conceptTested] !== undefined) {
    const prev = updated.concepts[interaction.conceptTested]
    updated.concepts[interaction.conceptTested] = Math.round(prev * 0.4 + interaction.score * 0.6)

    if (updated.concepts[interaction.conceptTested] >= 75 && !updated.memory.masteredConcepts.includes(interaction.conceptTested)) {
      updated.memory.masteredConcepts.push(interaction.conceptTested)
    }
  }

  // ── Actualizar COMPRENSIÓN (qué tan claro tiene las cosas) ──
  if (interaction.score >= 70) {
    updated.comprehension.level = Math.min(100, updated.comprehension.level + 4)
    updated.comprehension.stability = Math.min(100, updated.comprehension.stability + 8)
  } else if (interaction.score < 40) {
    updated.comprehension.level = Math.max(0, updated.comprehension.level - 3)
    updated.comprehension.stability = Math.max(0, updated.comprehension.stability - 5)
  }

  // ── Actualizar MOTIVACIÓN (cómo se siente) ──────────
  // Engagement sube con éxito, baja con fracaso constante
  if (interaction.score >= 70) {
    updated.motivation.engagement = Math.min(100, updated.motivation.engagement + 5)
  } else if (interaction.score < 40) {
    updated.motivation.engagement = Math.max(20, updated.motivation.engagement - 8)
  }

  // Energy baja con el tiempo (fatiga cognitiva)
  if (interaction.timeSpentMs && interaction.timeSpentMs > 60000) {
    updated.motivation.energy = Math.max(20, updated.motivation.energy - 3)
  }

  // ── Memoria pedagógica: separar SUCCESS vs FAIL ─────
  if (interaction.analogyUsed && !updated.memory.analogiesTried.includes(interaction.analogyUsed)) {
    updated.memory.analogiesTried.push(interaction.analogyUsed)
  }

  if (interaction.approachUsed) {
    if (interaction.score >= 70) {
      // LO QUE FUNCIONA — guardarlo
      if (!updated.memory.successfulApproaches.includes(interaction.approachUsed)) {
        updated.memory.successfulApproaches.push(interaction.approachUsed)
      }
    } else if (interaction.score < 40) {
      if (!updated.memory.failedApproaches.includes(interaction.approachUsed)) {
        updated.memory.failedApproaches.push(interaction.approachUsed)
      }
    }
  }

  // ── Avanzar micro-objetivo si está cumplido ─────────
  const currentMO = updated.microObjectives[updated.currentMicroObjectiveIdx]
  if (currentMO && currentMO.status !== 'mastered') {
    currentMO.attemptsMade += 1

    const relatedConceptsMastered = currentMO.relatedConcepts.every(
      c => (updated.concepts[c] ?? 0) >= 65
    )

    if (relatedConceptsMastered) {
      currentMO.status = 'mastered'
      // Avanzar al siguiente
      if (updated.currentMicroObjectiveIdx + 1 < updated.microObjectives.length) {
        updated.currentMicroObjectiveIdx += 1
        updated.microObjectives[updated.currentMicroObjectiveIdx].status = 'in_progress'
      }
    } else if (currentMO.attemptsMade >= 4 && !relatedConceptsMastered) {
      // GUARDRAIL: si lleva 4 intentos sin lograr el micro-objetivo, marcarlo como skipped
      // y avanzar para no atascarse
      currentMO.status = 'skipped'
      if (updated.currentMicroObjectiveIdx + 1 < updated.microObjectives.length) {
        updated.currentMicroObjectiveIdx += 1
        updated.microObjectives[updated.currentMicroObjectiveIdx].status = 'in_progress'
      }
    } else if (currentMO.status === 'pending') {
      currentMO.status = 'in_progress'
    }
  }

  // ── Actualizar EVIDENCIA recolectada ──────────────
  if (interaction.timeSpentMs !== undefined) {
    const ev = updated.evidence
    const interactionsCount = (ev.shortAnswersCount + ev.detailedAnswersCount) || 1
    ev.avgResponseTimeMs = Math.round(
      (ev.avgResponseTimeMs * interactionsCount + interaction.timeSpentMs) / (interactionsCount + 1)
    )
    if (ev.fastestResponseMs === 0 || interaction.timeSpentMs < ev.fastestResponseMs) {
      ev.fastestResponseMs = interaction.timeSpentMs
    }
    if (interaction.timeSpentMs > ev.slowestResponseMs) {
      ev.slowestResponseMs = interaction.timeSpentMs
    }
  }

  if (interaction.answerLength !== undefined) {
    if (interaction.answerLength < 20) updated.evidence.shortAnswersCount += 1
    if (interaction.answerLength > 100) updated.evidence.detailedAnswersCount += 1
  }

  if (interaction.optionChanges) updated.evidence.optionsChangedCount += interaction.optionChanges
  // ── Actualizar EVIDENCIA recolectada ──────────────
  if (interaction.timeSpentMs !== undefined) {
    const ev = updated.evidence
    const interactionsCount = (ev.shortAnswersCount + ev.detailedAnswersCount) || 1
    ev.avgResponseTimeMs = Math.round(
      (ev.avgResponseTimeMs * interactionsCount + interaction.timeSpentMs) / (interactionsCount + 1)
    )
    if (ev.fastestResponseMs === 0 || interaction.timeSpentMs < ev.fastestResponseMs) {
      ev.fastestResponseMs = interaction.timeSpentMs
    }
    if (interaction.timeSpentMs > ev.slowestResponseMs) {
      ev.slowestResponseMs = interaction.timeSpentMs
    }
  }

  if (interaction.answerLength !== undefined) {
    if (interaction.answerLength < 20) updated.evidence.shortAnswersCount += 1
    if (interaction.answerLength > 100) updated.evidence.detailedAnswersCount += 1
  }

  if (interaction.optionChanges) updated.evidence.optionsChangedCount += interaction.optionChanges
  if (interaction.edits) updated.evidence.multipleEditsCount += interaction.edits
  if (interaction.abandoned) updated.evidence.abandonedQuestions += 1

  // ── La evidencia influye en motivación ──────────────
  const ev = updated.evidence
  if (ev.shortAnswersCount > ev.detailedAnswersCount + 2) {
    // Respuestas cortas seguidas → engagement bajando
    updated.motivation.engagement = Math.max(20, updated.motivation.engagement - 5)
  }
  if (ev.detailedAnswersCount > ev.shortAnswersCount + 2) {
    // Respuestas detalladas → engagement alto
    updated.motivation.engagement = Math.min(100, updated.motivation.engagement + 3)
  }
  if (ev.avgResponseTimeMs > 90000) {
    // Tarda mucho → puede ser fatiga o duda
    updated.motivation.energy = Math.max(20, updated.motivation.energy - 2)
  }

  return updated
}

// ═══════════════════════════════════════════════════════════════
// REGISTRAR RITMO — llamar después de cada bloque entregado
// ═══════════════════════════════════════════════════════════════
export function trackBlockRhythm(
  model: StudentModel,
  block: { interactions: Array<{ type: string; expectAnswer?: boolean }> },
): StudentModel {
  const updated: StudentModel = JSON.parse(JSON.stringify(model))
  if (!updated.rhythm) {
    updated.rhythm = {
      consecutiveQuestions: 0,
      blocksWithoutExplanation: 0,
      lastBlockType: null,
      totalExplanations: 0,
      totalQuestions: 0,
      recentQuestionTypes: [],
    }
  }

  const questions = block.interactions.filter(i => i.expectAnswer || i.type === 'question').length
  const explanations = block.interactions.filter(i => i.type === 'explanation' || i.type === 'example').length

  updated.rhythm.totalQuestions += questions
  updated.rhythm.totalExplanations += explanations

  // Determinar tipo del bloque
  let blockType: 'explanation' | 'question' | 'mixed' | null = null
  if (questions > 0 && explanations === 0) blockType = 'question'
  else if (explanations > 0 && questions === 0) blockType = 'explanation'
  else if (explanations > 0 && questions > 0) blockType = 'mixed'
  updated.rhythm.lastBlockType = blockType

  // Contadores acumulativos
  if (blockType === 'question') {
    updated.rhythm.consecutiveQuestions += questions
    updated.rhythm.blocksWithoutExplanation += 1
  } else if (blockType === 'explanation' || blockType === 'mixed') {
    updated.rhythm.consecutiveQuestions = 0
    updated.rhythm.blocksWithoutExplanation = 0
  }

  // Trackear tipos de pregunta usados
  const newTypes = block.interactions
    .filter((i: any) => i.expectAnswer && i.questionType)
    .map((i: any) => i.questionType)
  if (newTypes.length > 0) {
    updated.rhythm.recentQuestionTypes = [
      ...(updated.rhythm.recentQuestionTypes || []),
      ...newTypes,
    ].slice(-5)
  }

  return updated
}

// ═══════════════════════════════════════════════════════════════
// THINK — el cerebro decide qué hacer ahora
// Con guardrails firmes, pero pedagogía guiada por LLM
// ═══════════════════════════════════════════════════════════════
export interface BrainDecision {
  prompt: string
  blockGoal: string                 // intención específica de este bloque
  shouldClose: boolean              // guardrail
  shouldReduceDifficulty: boolean   // guardrail
}



// ═══════════════════════════════════════════════════════════════
// INFERIR PATRONES desde la evidencia (no solo datos, conclusiones)
// ═══════════════════════════════════════════════════════════════
export interface EvidenceInsights {
  conclusions: string[]   // afirmaciones pedagógicas en lenguaje natural
  warnings: string[]      // alertas que el cerebro debe considerar
}

export function inferEvidencePatterns(model: StudentModel): EvidenceInsights {
  const conclusions: string[] = []
  const warnings: string[] = []
  const ev = model.evidence

  const totalAnswers = ev.shortAnswersCount + ev.detailedAnswersCount
  if (totalAnswers === 0) return { conclusions, warnings }

  // Patrón: responde mejor después de ciertos enfoques
  if (model.memory.successfulApproaches.length >= 2) {
    const top = model.memory.successfulApproaches.slice(-2)
    conclusions.push(`Con este estudiante funcionan mejor: ${top.join(' y ')}`)
  }

  // Patrón: respuestas detalladas vs cortas
  if (ev.detailedAnswersCount > ev.shortAnswersCount * 2) {
    conclusions.push('El estudiante se compromete con las respuestas — escribe en detalle')
  } else if (ev.shortAnswersCount > ev.detailedAnswersCount * 2 && totalAnswers >= 3) {
    warnings.push('Respuestas muy cortas: puede estar desconectado o cansado')
  }

  // Patrón: tiempo de respuesta
  if (ev.avgResponseTimeMs > 0) {
    if (ev.avgResponseTimeMs < 15000 && ev.shortAnswersCount > 2) {
      warnings.push('Responde muy rápido y corto: probablemente sin pensar')
    } else if (ev.avgResponseTimeMs > 60000 && ev.detailedAnswersCount > 2) {
      conclusions.push('Reflexiona profundamente antes de responder')
    }
  }

  // Patrón: cambios de opción
  if (ev.optionsChangedCount >= 3) {
    warnings.push('Duda al elegir opciones — no termina de tener confianza')
  }

  // Patrón: abandono
  if (ev.abandonedQuestions >= 2) {
    warnings.push('Ha abandonado preguntas — posible frustración o desconexión')
  }

  // Patrón: ediciones múltiples
  if (ev.multipleEditsCount >= 3 && ev.detailedAnswersCount > 0) {
    conclusions.push('Reescribe mucho — busca precisión, valora la calidad')
  }

  return { conclusions, warnings }
}



// ═══════════════════════════════════════════════════════════════
// DETECTAR MISMATCH entre conocimiento declarado y demostrado
// Si alguien dijo "sé algo" y falla todo → recalibrar
// ═══════════════════════════════════════════════════════════════
export function detectKnowledgeMismatch(
  model: StudentModel,
  blocksCompleted: number,
): StudentModel {
  // Necesitamos al menos 3 bloques para tener evidencia confiable
  if (blocksCompleted < 3) return model
  if (!model.declaredKnowledge) return model

  // Si ya detectamos mismatch antes, no recalcular hasta que pasen más bloques
  if (model.knowledgeCalibration && model.knowledgeCalibration.detectedAtBlock >= blocksCompleted - 2) {
    return model
  }

  // Mapear declaración a número
  const declaredMap = {
    'zero': 10,
    'some': 40,
    'review': 65,
    'mastered': 85,
  }
  const declaredLevel = declaredMap[model.declaredKnowledge] ?? 40

  // Calcular nivel actual demostrado (promedio de conceptos testeados)
  const conceptValues = Object.values(model.concepts)
  if (conceptValues.length === 0) return model
  const testedConcepts = conceptValues.filter(v => v > 0 && v < 100)
  if (testedConcepts.length < 2) return model

  const actualLevel = Math.round(
    testedConcepts.reduce((a, b) => a + b, 0) / testedConcepts.length
  )

  const mismatch = Math.abs(declaredLevel - actualLevel)
  const direction: 'overestimated' | 'underestimated' | 'aligned' =
    mismatch < 20 ? 'aligned' :
    actualLevel < declaredLevel ? 'overestimated' :
    'underestimated'

  // Decidir si recalcular el plan
  // Overestimated grave (dijo que sabía pero no): replan
  // Underestimated grave (dijo que no sabía pero sí): replan también
  const shouldReplan = mismatch >= 30 && blocksCompleted >= 3

  const updated: StudentModel = JSON.parse(JSON.stringify(model))
  updated.knowledgeCalibration = {
    declaredLevel,
    actualLevel,
    mismatch,
    mismatchDirection: direction,
    shouldReplan,
    detectedAtBlock: blocksCompleted,
  }

  // Si hay mismatch grave, ajustar comprensión y motivación
  if (direction === 'overestimated' && mismatch >= 30) {
    // Probablemente está frustrado de descubrir que sabía menos de lo que pensaba
    updated.motivation.engagement = Math.max(30, updated.motivation.engagement - 10)
    updated.comprehension.level = actualLevel
  } else if (direction === 'underestimated' && mismatch >= 30) {
    // Sabía más de lo que dijo — boost de confianza
    updated.motivation.engagement = Math.min(100, updated.motivation.engagement + 10)
    updated.comprehension.level = actualLevel
  }

  return updated
}

// ═══════════════════════════════════════════════════════════════
// CRITERIO PEDAGÓGICO — selecciona la idea de MAYOR PALANCA
// (cuál concepto, si lo aprendes, desbloquea más comprensión)
// ═══════════════════════════════════════════════════════════════
export function selectHighestLeverageIdea(params: {
  model: StudentModel
  topic: MaterialTopic
  blueprint?: any  // MaterialBlueprint para ver dependencias
  timeRemainingMs?: number
}): {
  conceptName: string
  reason: string
  leverageScore: number
  candidates: Array<{ name: string; leverage: number; reasons: string[] }>
} {
  const { model, topic, blueprint, timeRemainingMs = Infinity } = params

  const conceptScores: Array<{
    name: string
    leverage: number
    reasons: string[]
  }> = []

  for (const concept of (topic.concepts || [])) {
    const reasons: string[] = []
    let leverage = 0

    const currentUnderstanding = model.concepts[concept.name] ?? 0

    // CRITERIO 1: Si ya está dominado, no tiene palanca
    if (currentUnderstanding >= 75) {
      conceptScores.push({ name: concept.name, leverage: 5, reasons: ['ya dominado'] })
      continue
    }

    // CRITERIO 2: Conceptos críticos para examen
    if (concept.importance === 'critical') {
      leverage += 35
      reasons.push('crítico para el examen')
    } else if (concept.importance === 'major') {
      leverage += 20
      reasons.push('importante')
    }

    // CRITERIO 3: Conceptos que son prerrequisito de otros (palanca alta)
    if (blueprint && blueprint.topics) {
      let dependentsCount = 0
      for (const t of blueprint.topics) {
        if (t.prerequisites?.includes(topic.title)) dependentsCount += 1
      }
      if (dependentsCount > 0) {
        leverage += dependentsCount * 15
        reasons.push(`desbloquea ${dependentsCount} tema(s) posteriores`)
      }
    }

    // CRITERIO 4: Gap grande de comprensión = más palanca al cerrarlo
    const gap = 75 - currentUnderstanding
    leverage += Math.round(gap * 0.4)
    if (gap > 50) reasons.push('gap grande de comprensión')

    // CRITERIO 5: Si está en zona de proximal development (40-65%), máxima palanca
    if (currentUnderstanding >= 40 && currentUnderstanding < 65) {
      leverage += 20
      reasons.push('zona ideal de aprendizaje')
    }

    // CRITERIO 6: Dificultad del concepto vs energía del estudiante
    const conceptDifficulty = concept.difficulty ?? 50
    if (model.motivation.energy < 50 && conceptDifficulty > 70) {
      leverage -= 15
      reasons.push('demasiado difícil para energía actual')
    }

    // CRITERIO 7: Si la sesión es corta, priorizar conceptos rápidos
    if (timeRemainingMs < 10 * 60 * 1000 && conceptDifficulty > 60) {
      leverage -= 10
      reasons.push('poco tiempo para profundizar')
    }

    // CRITERIO 8: Conceptos que aparecen en el material con más frecuencia
    if (concept.sourcePages && concept.sourcePages.length > 2) {
      leverage += 10
      reasons.push('aparece mucho en el material')
    }

    conceptScores.push({
      name: concept.name,
      leverage: Math.max(0, Math.min(100, leverage)),
      reasons,
    })
  }

  // Si no hay conceptos, devolver topic genérico
  if (conceptScores.length === 0) {
    return {
      conceptName: topic.title,
      reason: 'concepto único del topic',
      leverageScore: 50,
      candidates: [{
        name: topic.title,
        leverage: 50,
        reasons: ['concepto único del topic'],
      }],
    }
  }

  // Ordenar por palanca y devolver TOP 3 candidatos
  conceptScores.sort((a, b) => b.leverage - a.leverage)
  const topCandidates = conceptScores.slice(0, 3)

  return {
    conceptName: topCandidates[0].name,
    reason: topCandidates[0].reasons.join(' · '),
    leverageScore: topCandidates[0].leverage,
    // Top 3 para que el LLM elija pedagógicamente
    candidates: topCandidates.map(c => ({
      name: c.name,
      leverage: c.leverage,
      reasons: c.reasons,
    })),
  }
}

export function think(params: {
  model: StudentModel
  topic: MaterialTopic
  materialSlice: string
  userProfile: UserProfile | null
  learningMemory: LearningMemory | null
  isFirstBlock: boolean
  blocksCompleted: number
  maxBlocks?: number  // guardrail
  blueprint?: any  // para análisis de palanca con dependencias
  timeRemainingMs?: number
}): BrainDecision {
  const { model, topic, materialSlice, userProfile, learningMemory, isFirstBlock, blocksCompleted, maxBlocks = 10 } = params

  // ── GUARDRAILS (decididos por código, no LLM) ───────
  const allMicroObjectivesDone = model.microObjectives.every(
    mo => mo.status === 'mastered' || mo.status === 'skipped'
  )
  const hitMaxBlocks = blocksCompleted >= maxBlocks
  const studentExhausted = model.motivation.energy < 30 && blocksCompleted >= 3

  const shouldClose = allMicroObjectivesDone || hitMaxBlocks || studentExhausted
  const shouldReduceDifficulty = model.motivation.engagement < 35 || model.motivation.energy < 40

  // ── Micro-objetivo actual ───────────────────────────
  const currentMO = model.microObjectives[model.currentMicroObjectiveIdx] || model.microObjectives[0]

  // ── CRITERIO PEDAGÓGICO: idea de mayor palanca AHORA ──
  const leverageIdea = selectHighestLeverageIdea({
    model,
    topic,
    blueprint: params.blueprint,
    timeRemainingMs: params.timeRemainingMs,
  })

  // ── Contexto del estudiante (sin "ALAI cree") ───────
  const studentDescription = describeStudent(model, userProfile, learningMemory)

  // ── RITMO PEDAGÓGICO — regla de oro ──────────────
  // Si lleva 2+ preguntas seguidas O 2 bloques sin explicar → FORZAR explicación
  const rhythm = model.rhythm || {
    consecutiveQuestions: 0,
    blocksWithoutExplanation: 0,
    lastBlockType: null,
    totalExplanations: 0,
    totalQuestions: 0,
    recentQuestionTypes: [] as string[],
  }
  const mustExplain = rhythm.consecutiveQuestions >= 2 || rhythm.blocksWithoutExplanation >= 2
  const mustGiveExample = rhythm.totalExplanations >= 2 && rhythm.totalExplanations % 2 === 0

  // Estudiante que dijo "nunca lo he visto" → 80% explicación, 20% preguntas
  const isBeginner = model.declaredKnowledge === 'zero' || (model.comprehension?.level ?? 50) < 25
  const beginnerForceExplain = isBeginner && rhythm.totalExplanations < rhythm.totalQuestions * 2

  // ── Patrones inferidos de la evidencia ───────────
  const insights = inferEvidencePatterns(model)

  // ── Calibración: el estudiante sabe lo que dijo? ──
  let calibrationNote = ''
  if (model.knowledgeCalibration && model.knowledgeCalibration.mismatch >= 30) {
    if (model.knowledgeCalibration.mismatchDirection === 'overestimated') {
      calibrationNote = `⚠ ALERTA: El estudiante dijo que sabía del tema (${model.knowledgeCalibration.declaredLevel}%) pero está demostrando mucho menos (${model.knowledgeCalibration.actualLevel}%). Ajusta tu enseñanza: trata el tema como si fuera nuevo, sin asumir conocimiento previo. Sé especialmente empático — puede sentirse frustrado al darse cuenta.`
    } else {
      calibrationNote = `✓ El estudiante dijo que no sabía mucho (${model.knowledgeCalibration.declaredLevel}%) pero está demostrando mucho más (${model.knowledgeCalibration.actualLevel}%). Puedes subir el nivel — está listo para más reto.`
    }
  }

  // ── Lo que FUNCIONÓ vs lo que FALLÓ ────────────────
  const memoryHints: string[] = []
  if (model.memory.successfulApproaches.length > 0) {
    memoryHints.push(`Lo que ha funcionado con este estudiante: ${model.memory.successfulApproaches.slice(-3).join(', ')}`)
  }
  if (model.memory.failedApproaches.length > 0) {
    memoryHints.push(`NO repitas estos enfoques que ya fallaron: ${model.memory.failedApproaches.slice(-3).join(', ')}`)
  }
  if (model.memory.analogiesTried.length > 0) {
    memoryHints.push(`No reuses estas analogías: ${model.memory.analogiesTried.slice(-3).join(', ')}`)
  }

  // ── Construir prompt ────────────────────────────────
  const carreraNote = userProfile?.carrera
    ? `Si usas analogías o ejemplos, conéctalos con: ${userProfile.carrera}.`
    : ''

  let blockGoal = ''
  let situationInstruction = ''

  if (shouldClose) {
    blockGoal = 'Cerrar la sesión con autenticidad'
    situationInstruction = `Cierra la sesión. El estudiante dominó ${model.memory.masteredConcepts.length} conceptos. Reconoce su progreso REAL, no genérico. Conecta con lo que viene.`
  } else if (isFirstBlock) {
    blockGoal = currentMO.intent
    situationInstruction = `Esta es la apertura. Tu micro-objetivo: "${currentMO.intent}". NO empieces con definición. Diseña una experiencia (pregunta, situación, paradoja) que lleve al estudiante a DESCUBRIR la idea, no a memorizarla.`
  } else if (shouldReduceDifficulty) {
    blockGoal = 'Reconstruir confianza antes de avanzar'
    situationInstruction = `El estudiante está cansado o desconectado (energy: ${model.motivation.energy}, engagement: ${model.motivation.engagement}). Vuelve a un terreno donde sí tenga éxito. Reconstruye desde ahí. No avances todavía al siguiente micro-objetivo.`
  } else {
    blockGoal = currentMO.intent
    situationInstruction = `Tu micro-objetivo ahora: "${currentMO.intent}". Evidencia de éxito: "${currentMO.evidenceOfSuccess}". Diseña un bloque que CONDUZCA al estudiante a esta comprensión. No lo digas directo — guíalo para que LLEGUE solo.`
  }

  const prompt = `Eres ALAI, un profesor que diseña experiencias para que el estudiante DESCUBRA, no para que memorice.

═══ EL ESTUDIANTE ═══
${studentDescription}

═══ COMPRENSIÓN ACTUAL ═══
Topic: "${topic.title}"
Nivel general: ${model.comprehension.level}% (estabilidad: ${model.comprehension.stability}%)
Conceptos dominados hasta ahora: ${model.memory.masteredConcepts.join(', ') || 'ninguno todavía'}

═══ ESTADO EMOCIONAL ═══
Energía: ${model.motivation.energy}/100
Engagement: ${model.motivation.engagement}/100

${calibrationNote ? '═══ CALIBRACIÓN ═══\n' + calibrationNote + '\n\n' : ''}═══ PATRONES OBSERVADOS DEL ESTUDIANTE ═══
${insights.conclusions.length > 0 ? insights.conclusions.map(c => '- ' + c).join('\n') : '- Sin patrones todavía'}
${insights.warnings.length > 0 ? '\nALERTAS:\n' + insights.warnings.map(w => '⚠ ' + w).join('\n') : ''}



═══ REGLA DE ORO: CALIDAD ≠ CANTIDAD ═══

PRINCIPIO: Un profesor excelente enseña MUCHO con POCAS palabras.

${isBeginner ? '🚨 Este estudiante NO SABE NADA. Necesita ENSEÑANZA REAL, no interrogatorio. Proporción ideal: 70% enseñar, 30% verificar.' : 'Tiene base. Puede preguntarse más, pero siempre con sustancia.'}
${mustExplain ? '🚨 Lleva ' + rhythm.consecutiveQuestions + ' preguntas seguidas. Este bloque DEBE ENSEÑAR algo nuevo, no preguntar más.' : ''}
${beginnerForceExplain ? '🚨 OBLIGATORIO explicar: ratio actual ' + rhythm.totalExplanations + ' explicaciones vs ' + rhythm.totalQuestions + ' preguntas.' : ''}

ESTRUCTURA OBLIGATORIA del bloque:

1. ENSEÑA UNA IDEA con precisión (2-4 oraciones MÁXIMO)
   - Define lo que importa, sin relleno
   - Si usas un término técnico, explícalo en la misma oración
   - El estudiante debe poder repetir la idea con sus palabras
   - PROHIBIDO: rellenar con frases vacías

2. UN EJEMPLO CONCRETO (1-2 oraciones)
   - Real, específico, no abstracto
   - Que ilustre la idea, no que la repita

3. (OPCIONAL) UNA pregunta para verificar
   - Solo si encaja naturalmente
   - Tipo según el objetivo (ver tipos abajo)

═══ TIPOS DE PREGUNTA — USA EL CORRECTO ═══

Tipos usados recientemente (NO repetir): ${rhythm.recentQuestionTypes && rhythm.recentQuestionTypes.length > 0
  ? rhythm.recentQuestionTypes.slice(-3).join(', ')
  : 'ninguno'}

Cuándo usar cada tipo:
- multiple_choice → UNA respuesta correcta entre 4 opciones plausibles. Para verificación rápida.
- true_false → Para verificar una relación o regla. Pide justificación corta.
- fill_blank → Recordar un término clave específico.
- apply_scenario → Caso real para resolver con lo aprendido (después de explicar).
- explain_why → Razonamiento profundo (solo si ya tiene base).
- predict_outcome → Proyectar consecuencias ("¿qué pasaría si...?").
- find_error → Detectar lo que está mal en un razonamiento.
- compare_two → Comparar dos conceptos relacionados.

REGLA: Varía el tipo en cada bloque. NO uses open_essay siempre (es perezoso).

═══ ANTI-RELLENO ═══

PROHIBIDO escribir:
- "Es importante destacar que..."
- "Cabe mencionar..."
- "Como sabemos..."
- "En el ámbito de..."
- Repetir la misma idea en 3 formas distintas
- Listas largas de cosas obvias

═══ MEMORIA DE LO QUE FUNCIONA ═══
${memoryHints.length > 0 ? memoryHints.join('\n') : 'Sin historial todavía — primera interacción.'}
${carreraNote}

═══ TU MICRO-OBJETIVO AHORA ═══
${blockGoal}

═══ CANDIDATOS DE ALTA PALANCA (tú decides cuál enseñar) ═══
${leverageIdea.candidates.map((c, i) =>
  `${i + 1}. "${c.name}" — palanca ${c.leverage}/100 (${c.reasons.join(', ')})`
).join('\n')}

Como profesor, TÚ decides cuál de estos 3 enseñar AHORA. Considera:
- ¿Cuál genera mayor "ajá" intuitivo en este momento?
- ¿Cuál conecta mejor con lo que ya viste?
- ¿Cuál es más natural según el estado del estudiante?

El código filtró los candidatos. La decisión pedagógica es tuya.

═══ INSTRUCCIÓN ═══
${situationInstruction}

═══ MATERIAL ═══
${materialSlice.slice(0, 3000)}

═══ FORMATO DE RESPUESTA ═══

Diseña un BLOQUE que tenga INTENCIÓN PEDAGÓGICA clara. 2-4 interacciones que conduzcan al estudiante hacia el micro-objetivo.

Devuelve SOLO JSON:
{
  "intro": "Texto de apertura del bloque. Conversacional, sin meta-pensamientos. 2-4 párrafos cortos.",
  "interactions": [
    {
      "type": "explanation" | "question" | "example" | "transition",
      "content": "Contenido específico",
      "expectAnswer": true | false,
      "question": "Si expectAnswer, la pregunta",
      "questionType": "open_essay | multiple_choice | predict_outcome | explain_why | apply_scenario | find_error",
      "options": ["si multiple_choice"],
      "correctAnswer": "si multiple_choice",
      "conceptTested": "qué concepto evalúa",
      "expectedIdea": "qué idea central debería contener una buena respuesta abierta"
    }
  ],
  "analogyUsedHere": "Nombre corto de analogía nueva (si aplica)",
  "approachUsedHere": "Estilo usado: ej 'caso_clinico', 'paradoja_inicial', 'razonamiento_causal', 'ejemplo_cotidiano'"
}

${buildPrinciplesPrompt({
  studentKnowsNothing: model.comprehension.level < 20,
  hasExamSoon: false,  // se setea desde el caller con daysToExam
  emphasize: model.comprehension.level < 20
    ? ['respect_zero_knowledge', 'no_proper_names_first', 'curiosity_before_definition']
    : ['questions_born_from_explanation', 'never_say_thinking'],
})}

REGLAS DE FORMATO:
- Devuelve SOLO JSON válido
- Si preguntas, que la pregunta NAZCA de lo explicado
- El bloque debe AVANZAR hacia el micro-objetivo`

  return {
    prompt,
    blockGoal,
    shouldClose,
    shouldReduceDifficulty,
  }
}

// ─────────────────────────────────────────────────────────
function describeStudent(
  model: StudentModel,
  profile: UserProfile | null,
  memory: LearningMemory | null,
): string {
  const parts: string[] = []

  if (profile?.carrera) parts.push(`Estudia ${profile.carrera}.`)
  if (profile?.objetivo) parts.push(`Su objetivo: ${profile.objetivo}.`)
  if (memory && memory.styleConfidence > 30) {
    parts.push(`Estilo de aprendizaje: ${memory.learningStyle}.`)
  }

  return parts.length > 0 ? parts.join(' ') : 'Estudiante general.'
}

// ═══════════════════════════════════════════════════════════════
// IS COMPLETE — guardrail final
// ═══════════════════════════════════════════════════════════════
export function isSessionComplete(model: StudentModel, blocksCompleted: number, maxBlocks: number = 6): boolean {
  // Todos los micro-objetivos terminados
  const allDone = model.microObjectives.every(mo => mo.status === 'mastered' || mo.status === 'skipped')
  if (allDone) return true

  // Hit max blocks (guardrail anti-loop)
  if (blocksCompleted >= maxBlocks) return true

  // Estudiante exhausto
  if (model.motivation.energy < 25 && blocksCompleted >= 4) return true

  return false
}

// ═══════════════════════════════════════════════════════════════
// SESSION SUMMARY
// ═══════════════════════════════════════════════════════════════
export interface ClosingNarrative {
  discovered: string[]              // "Lo que descubriste hoy"
  stillToWorkOn: string[]           // "Lo que todavía no entiendes"
  unlocks: string[]                 // "Lo que eso desbloquea"
  tomorrowPreview: string           // "Lo que haremos mañana"
  keyInsight?: string               // la idea más importante (cierre que enseña)
}

export function getSessionSummary(model: StudentModel) {
  const masteredMOs = model.microObjectives.filter(mo => mo.status === 'mastered')
  const skippedMOs = model.microObjectives.filter(mo => mo.status === 'skipped')
  const inProgressMOs = model.microObjectives.filter(mo => mo.status === 'in_progress' || mo.status === 'pending')

  // Reflexionar sobre la sesión (el cerebro aprende de sí mismo)
  const reflection = reflectOnSession(model, 0)

  // Construir narrativa de cierre con continuidad — y que ENSEÑE
  const narrative: ClosingNarrative = {
    discovered: masteredMOs.map(mo => mo.evidenceOfSuccess),
    stillToWorkOn: skippedMOs.map(mo => mo.intent).concat(
      inProgressMOs.slice(0, 2).map(mo => mo.intent)
    ),
    unlocks: inferUnlocks(model, masteredMOs),
    tomorrowPreview: buildTomorrowPreview(model, inProgressMOs),
    // El cierre también enseña: la idea clave que cambió hoy
    keyInsight: reflection.keyInsight,
  }

  return {
    masteredConcepts: model.memory.masteredConcepts,
    finalComprehension: model.comprehension.level,
    finalStability: model.comprehension.stability,
    microObjectivesMastered: masteredMOs.map(mo => mo.intent),
    microObjectivesSkipped: skippedMOs.map(mo => mo.intent),
    successfulApproaches: model.memory.successfulApproaches,
    // Evidencia rica
    engagement: {
      avgResponseTime: model.evidence.avgResponseTimeMs,
      detailedAnswers: model.evidence.detailedAnswersCount,
      shortAnswers: model.evidence.shortAnswersCount,
      abandoned: model.evidence.abandonedQuestions,
    },
    // Narrativa de cierre
    narrative,
    // El cerebro reflexiona sobre la sesión
    reflection,
  }
}

function inferUnlocks(model: StudentModel, masteredMOs: MicroObjective[]): string[] {
  if (masteredMOs.length === 0) return []
  return [
    `Ahora puedes abordar conceptos que dependen de ${model.memory.masteredConcepts.slice(0, 2).join(' y ')}`,
  ]
}

function buildTomorrowPreview(model: StudentModel, pendingMOs: MicroObjective[]): string {
  if (pendingMOs.length === 0) {
    return 'En la próxima sesión avanzamos al siguiente topic — ya completaste lo de hoy.'
  }
  return `En la próxima sesión: ${pendingMOs[0].intent}`
}

// ═══════════════════════════════════════════════════════════════
// REFLECTION LOOP — el cerebro reflexiona sobre la sesión
// ═══════════════════════════════════════════════════════════════
export interface SessionReflection {
  worked: string[]        // qué funcionó pedagógicamente
  didntWork: string[]     // qué no funcionó
  keyInsight: string      // la idea más importante que cambió hoy
  forNextTime: string[]   // lo que debe recordar el cerebro para próximas sesiones
}

export function reflectOnSession(
  model: StudentModel,
  blocksCompleted: number,
): SessionReflection {
  const reflection: SessionReflection = {
    worked: [],
    didntWork: [],
    keyInsight: '',
    forNextTime: [],
  }

  // ¿Qué funcionó?
  if (model.memory.successfulApproaches.length > 0) {
    reflection.worked.push(`Los enfoques que conectaron: ${model.memory.successfulApproaches.slice(-3).join(', ')}`)
  }
  const masteredMOs = model.microObjectives.filter(mo => mo.status === 'mastered')
  if (masteredMOs.length > 0) {
    reflection.worked.push(`Logramos ${masteredMOs.length} micro-objetivo(s) clave`)
  }
  if (model.comprehension.stability > 60) {
    reflection.worked.push('La comprensión quedó estable, no superficial')
  }

  // ¿Qué no funcionó?
  if (model.memory.failedApproaches.length > 0) {
    reflection.didntWork.push(`Estos enfoques no resonaron: ${model.memory.failedApproaches.slice(-2).join(', ')}`)
  }
  const skippedMOs = model.microObjectives.filter(mo => mo.status === 'skipped')
  if (skippedMOs.length > 0) {
    reflection.didntWork.push(`Tuvimos que saltar ${skippedMOs.length} micro-objetivo(s)`)
  }
  if (model.evidence.abandonedQuestions >= 2) {
    reflection.didntWork.push('Hubo preguntas que el estudiante prefirió no responder')
  }

  // Key insight pedagógico: la idea MÁS importante que cambió
  if (masteredMOs.length > 0) {
    const main = masteredMOs[0]
    reflection.keyInsight = main.evidenceOfSuccess || `Comprendió: ${main.intent}`
  } else if (model.memory.masteredConcepts.length > 0) {
    reflection.keyInsight = `El concepto que más se asentó hoy: "${model.memory.masteredConcepts[0]}"`
  } else {
    reflection.keyInsight = 'Construyó base, aunque el "ajá" llegará en próximas sesiones'
  }

  // Para la próxima vez
  if (model.memory.successfulApproaches.length > 0) {
    reflection.forNextTime.push(`Usar más: ${model.memory.successfulApproaches.slice(-1)[0]}`)
  }
  if (model.memory.failedApproaches.length > 0) {
    reflection.forNextTime.push(`Evitar: ${model.memory.failedApproaches.slice(-1)[0]}`)
  }
  if (model.motivation.engagement < 50) {
    reflection.forNextTime.push('Empezar la próxima sesión con algo más concreto y motivador')
  }

  return reflection
}

// ═══════════════════════════════════════════════════════════════
// PREDICT NEXT BEST SESSION — qué hacer si solo hay 20 min
// ═══════════════════════════════════════════════════════════════
export interface NextSessionPrediction {
  recommendedFocus: string
  reason: string
  estimatedImpact: 'high' | 'medium' | 'low'
  minTimeNeededMs: number
}

export function predictNextBestSession(
  model: StudentModel,
  topic: MaterialTopic,
  availableTimeMs: number = 20 * 60 * 1000,
): NextSessionPrediction {
  // Si hay micro-objetivos pendientes, el siguiente es claro
  const pendingMOs = model.microObjectives.filter(mo => mo.status === 'pending' || mo.status === 'in_progress')

  if (pendingMOs.length > 0) {
    const next = pendingMOs[0]
    const isComplex = next.relatedConcepts.length > 2

    return {
      recommendedFocus: next.intent,
      reason: `Es el siguiente micro-objetivo natural y conecta con lo que ya logramos`,
      estimatedImpact: isComplex ? 'high' : 'medium',
      minTimeNeededMs: isComplex ? 25 * 60 * 1000 : 15 * 60 * 1000,
    }
  }

  // Si todo está completo, sugerir consolidación
  const weakConcepts = Object.entries(model.concepts)
    .filter(([_, v]) => v < 60)
    .sort((a, b) => a[1] - b[1])

  if (weakConcepts.length > 0) {
    return {
      recommendedFocus: `Consolidar "${weakConcepts[0][0]}" — todavía no está estable`,
      reason: 'Mejor cerrar un concepto débil antes de avanzar',
      estimatedImpact: 'high',
      minTimeNeededMs: 15 * 60 * 1000,
    }
  }

  // Default
  return {
    recommendedFocus: `Avanzar al siguiente topic relacionado con "${topic.title}"`,
    reason: 'Ya consolidaste este topic — toca avanzar',
    estimatedImpact: 'medium',
    minTimeNeededMs: 20 * 60 * 1000,
  }
}
