import type { CanonicalQuestion } from './questionContract'

interface TaughtStepLike {
  id: string
  type: string
  title: string
  content: string
  keyPoint: string | null
  keyPoints?: string[]
}

export interface CheckpointObjective {
  id: string
  label: string
  kind: 'definition' | 'mechanism' | 'relation' | 'application' | 'fact' | 'interpretation'
  coveredStepIds: string[]
  coveredKeyPoints: string[]
  cognitiveTarget: CanonicalQuestion['targetDimension']
  weight: number
}

export interface CheckpointAnalysis {
  summary: string
  objectives: CheckpointObjective[]
  recommendedQuestionCount: number
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}

function normalize(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildCheckpointAnalysis(steps: TaughtStepLike[]): CheckpointAnalysis {
  const objectives: CheckpointObjective[] = []

  const allKeyPoints = steps.flatMap(step =>
    Array.isArray(step.keyPoints) && step.keyPoints.length > 0
      ? step.keyPoints
      : step.keyPoint ? [step.keyPoint] : []
  ).filter(Boolean)

  // 1) objetivos conceptuales directos
  for (const step of steps) {
    const keyPoints =
      Array.isArray(step.keyPoints) && step.keyPoints.length > 0
        ? step.keyPoints
        : step.keyPoint ? [step.keyPoint] : []

    if (keyPoints.length === 0) continue

    const kind =
      step.type === 'formula' ? 'mechanism' :
      step.type === 'connection' ? 'relation' :
      step.type === 'example' ? 'application' :
      step.type === 'warning' ? 'interpretation' :
      step.type === 'recap' ? 'interpretation' :
      'definition'

    const cognitiveTarget =
      step.type === 'formula' || step.type === 'example'
        ? 'application'
        : step.type === 'connection'
          ? 'transfer'
          : 'comprehension'

    objectives.push({
      id: `objective_${objectives.length + 1}`,
      label: step.title,
      kind,
      coveredStepIds: [step.id],
      coveredKeyPoints: keyPoints.map(String),
      cognitiveTarget,
      weight: step.type === 'formula' || step.type === 'connection' ? 1.2 : 1,
    })
  }

  // 2) objetivo integrador si hay 2+ pasos
  if (steps.length >= 2) {
    objectives.push({
      id: `objective_${objectives.length + 1}`,
      label: 'Integración del bloque enseñado',
      kind: 'relation',
      coveredStepIds: steps.map(s => s.id),
      coveredKeyPoints: uniq(allKeyPoints.map(String)).slice(0, 6),
      cognitiveTarget: 'transfer',
      weight: 1.4,
    })
  }

  // 3) deduplicación por label normalizado
  const deduped: CheckpointObjective[] = []
  const seen = new Set<string>()

  for (const obj of objectives) {
    const key = normalize(obj.label) + '|' + obj.kind
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push({
      ...obj,
      coveredKeyPoints: uniq(obj.coveredKeyPoints.map(String)),
      coveredStepIds: uniq(obj.coveredStepIds.map(String)),
    })
  }

  // 4) recomendación de cantidad de preguntas:
  // 1-2 pasos -> 2 preguntas
  // 3+ pasos -> 3 preguntas
  const recommendedQuestionCount = steps.length <= 2 ? 2 : 3

  const summary =
    `Este checkpoint enseñó ${steps.length} pasos y ${uniq(allKeyPoints).length} ideas clave. ` +
    `La evaluación debe medir comprensión real del bloque, no memoria paso por paso.`

  return {
    summary,
    objectives: deduped,
    recommendedQuestionCount,
  }
}
