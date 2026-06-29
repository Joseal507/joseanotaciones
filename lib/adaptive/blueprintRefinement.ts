
// ═══════════════════════════════════════════════════════════════
// StudyAL — Blueprint Refinement
// Si el estudiante falla mucho un topic, ALAI detecta que el
// blueprint puede estar mal dividido y lo mejora automáticamente.
// ═══════════════════════════════════════════════════════════════

import type { MaterialBlueprint, MaterialTopic } from './blueprint'
import type { LearningMemory } from './learningMemory'

export interface RefinementAction {
  type: 'split_topic' | 'add_prerequisite' | 'add_concept' | 'reorder' | 'merge_topics'
  topicId: string
  topicTitle: string
  reason: string
  confidence: number  // 0-100
  suggestion: string
}

export interface BlueprintRefinement {
  actions: RefinementAction[]
  shouldRefinement: boolean
  urgency: 'low' | 'medium' | 'high'
  summary: string
}

// ── Analizar si el blueprint necesita refinamiento ───────────
export function analyzeBlueprintForRefinement(
  blueprint: MaterialBlueprint,
  topicMastery: Array<{
    topicId: string
    topicTitle: string
    score: number
    conceptCount: number
    coveredCount: number
    weakConcepts: string[]
  }>,
  sessionHistory: Array<{
    topicId: string
    purpose: string
    score: number
    hadToRepeat: boolean
  }>,
  learningMemory?: LearningMemory | null,
): BlueprintRefinement {
  const actions: RefinementAction[] = []

  for (const tm of topicMastery) {
    const topic = blueprint.topics.find(t => t.id === tm.topicId)
    if (!topic) continue

    const topicSessions = sessionHistory.filter(s => s.topicId === tm.topicId)
    const repeatedFails = topicSessions.filter(s => s.hadToRepeat && s.score < 40).length
    const totalAttempts = topicSessions.length

    // 1. Topic con muchos conceptos y score bajo → sugerir split
    if (
      (topic.concepts?.length ?? 0) >= 5 &&
      tm.score < 30 &&
      totalAttempts >= 2
    ) {
      actions.push({
        type: 'split_topic',
        topicId: tm.topicId,
        topicTitle: tm.topicTitle,
        reason: `"${tm.topicTitle}" tiene ${topic.concepts?.length} conceptos y score de ${tm.score}% tras ${totalAttempts} sesiones.`,
        confidence: 80,
        suggestion: `Dividir "${tm.topicTitle}" en 2 subtemas más específicos para reducir la carga cognitiva.`,
      })
    }

    // 2. Topic con prerequisitos no dominados → detectar prerequisito faltante
    if (tm.score < 20 && topic.prerequisites && topic.prerequisites.length === 0) {
      // Buscar topics más básicos con conceptos relacionados
      const relatedBasicTopics = blueprint.topics.filter(t =>
        t.id !== topic.id &&
        (t.difficulty ?? 50) < (topic.difficulty ?? 50) - 15 &&
        (t.concepts || []).some(c =>
          (topic.concepts || []).some(tc =>
            tc.definition?.toLowerCase().includes(c.name.toLowerCase().slice(0, 6))
          )
        )
      )

      if (relatedBasicTopics.length > 0) {
        actions.push({
          type: 'add_prerequisite',
          topicId: tm.topicId,
          topicTitle: tm.topicTitle,
          reason: `"${tm.topicTitle}" parece depender de conceptos de "${relatedBasicTopics[0].title}" que no está marcado como prerequisito.`,
          confidence: 70,
          suggestion: `Marcar "${relatedBasicTopics[0].title}" como prerequisito de "${tm.topicTitle}".`,
        })
      }
    }

    // 3. Topic con fallos repetidos pero pocos conceptos → puede faltar concepto clave
    if (repeatedFails >= 2 && (topic.concepts?.length ?? 0) <= 2 && tm.score < 40) {
      actions.push({
        type: 'add_concept',
        topicId: tm.topicId,
        topicTitle: tm.topicTitle,
        reason: `"${tm.topicTitle}" tiene solo ${topic.concepts?.length} concepto(s) y el estudiante sigue fallando tras ${repeatedFails} intentos.`,
        confidence: 65,
        suggestion: `El topic puede necesitar más conceptos de soporte para que el estudiante entienda el contexto completo.`,
      })
    }

    // 4. Topic dominado pero estaba después de topics difíciles → reordenar
    if (
      tm.score >= 80 &&
      (topic.difficulty ?? 50) <= 40 &&
      blueprint.topics.indexOf(topic) > 2
    ) {
      actions.push({
        type: 'reorder',
        topicId: tm.topicId,
        topicTitle: tm.topicTitle,
        reason: `"${tm.topicTitle}" es un topic fácil que aparece tarde en el plan, pero el estudiante ya lo domina.`,
        confidence: 55,
        suggestion: `Mover "${tm.topicTitle}" al inicio como base para los topics más difíciles.`,
      })
    }
  }

  // Detectar topics muy similares → merge
  for (let i = 0; i < blueprint.topics.length - 1; i++) {
    for (let j = i + 1; j < blueprint.topics.length; j++) {
      const a = blueprint.topics[i]
      const b = blueprint.topics[j]
      const aWords = a.title.toLowerCase().split(' ').filter(w => w.length > 4)
      const bWords = b.title.toLowerCase().split(' ').filter(w => w.length > 4)
      const shared = aWords.filter(w => bWords.includes(w))
      const similarity = shared.length / Math.max(1, Math.min(aWords.length, bWords.length))

      if (similarity > 0.6) {
        const tmA = topicMastery.find(t => t.topicId === a.id)
        const tmB = topicMastery.find(t => t.topicId === b.id)
        if (tmA && tmB && tmA.score > 60 && tmB.score > 60) {
          actions.push({
            type: 'merge_topics',
            topicId: a.id,
            topicTitle: a.title,
            reason: `"${a.title}" y "${b.title}" son muy similares y ambos están dominados.`,
            confidence: 60,
            suggestion: `Considera fusionar estos dos topics para simplificar el plan.`,
          })
        }
      }
    }
  }

  const shouldRefinement = actions.length > 0 && actions.some(a => a.confidence >= 65)
  const urgency = actions.some(a => a.confidence >= 80) ? 'high' :
                  actions.some(a => a.confidence >= 65) ? 'medium' : 'low'

  const summary = actions.length === 0
    ? 'El blueprint está bien estructurado para este estudiante.'
    : `Detecté ${actions.length} posibles mejora(s) al blueprint. ${actions[0].suggestion}`

  return { actions, shouldRefinement, urgency, summary }
}

// ── Aplicar refinamiento al blueprint ───────────────────────
export function applyBlueprintRefinement(
  blueprint: MaterialBlueprint,
  actions: RefinementAction[],
): MaterialBlueprint {
  let refined = { ...blueprint, topics: [...blueprint.topics] }

  for (const action of actions) {
    if (action.confidence < 65) continue

    if (action.type === 'add_prerequisite') {
      refined = {
        ...refined,
        topics: refined.topics.map(t => {
          if (t.id !== action.topicId) return t
          // La sugerencia indica el prerequisito a agregar
          const match = action.suggestion.match(/"([^"]+)"/)
          if (!match) return t
          const prereqTitle = match[1]
          return {
            ...t,
            prerequisites: [...(t.prerequisites || []), prereqTitle],
          }
        }),
      }
    }

    if (action.type === 'reorder') {
      // Mover el topic al inicio
      const topicIdx = refined.topics.findIndex(t => t.id === action.topicId)
      if (topicIdx > 0) {
        const topic = refined.topics[topicIdx]
        const newTopics = [
          topic,
          ...refined.topics.slice(0, topicIdx),
          ...refined.topics.slice(topicIdx + 1),
        ]
        refined = { ...refined, topics: newTopics }
      }
    }
  }

  // updatedAt no existe en el tipo base — guardarlo en metadata
  ;(refined as any).updatedAt = Date.now()
  return refined
}
