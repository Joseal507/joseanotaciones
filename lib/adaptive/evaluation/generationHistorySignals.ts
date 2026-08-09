/**
 * generationHistorySignals.ts
 *
 * Extrae señales REALES (no inventadas) del historial de generación ya
 * persistido en la sesión — sessionContent de capítulos anteriores del mismo
 * journey — para alimentar al generador vivo de session-teach como desempate de
 * variedad y como base de "previous evidence". Función pura: no genera nada, no
 * llama IA, no decide qué producir — solo agrega datos que ya existen.
 *
 * Prioridad de uso en el prompt (ver AGENTS.md P3.2): esta señal es SIEMPRE
 * desempate (punto 6), nunca criterio principal (ajuste semántico y
 * cognitiveTarget van primero).
 */

interface HistoricalQuestion {
  format?: unknown
  variant?: unknown
  targetFactKeys?: unknown
  factKeys?: unknown
  targetDimension?: unknown
  cognitiveTarget?: unknown
}

interface HistoricalEvaluationBlock {
  questions?: HistoricalQuestion[]
}

interface HistoricalSessionContent {
  evaluationBlocks?: HistoricalEvaluationBlock[]
}

export interface GenerationHistorySignals {
  recentFormats: string[]
  recentVariants: string[]
  recentFactKeys: string[]
  recentCognitiveTargets: string[]
  /** factKey -> nivel cognitivo más alto ya demostrado/enseñado para ese hecho. */
  priorCognitiveLevelByFactKey: Record<string, string>
}

const COGNITIVE_RANK: Record<string, number> = { recognition: 0, comprehension: 1, application: 2, transfer: 3 }

function higherLevel(a: string | undefined, b: string): string {
  if (!a) return b
  return (COGNITIVE_RANK[b] ?? -1) > (COGNITIVE_RANK[a] ?? -1) ? b : a
}

export function computeGenerationHistorySignals(
  sessionContent: Record<string, HistoricalSessionContent> | null | undefined,
  options: { excludeSessionNumber?: number; recentLimit?: number } = {},
): GenerationHistorySignals {
  const recentLimit = options.recentLimit ?? 8
  const empty: GenerationHistorySignals = { recentFormats: [], recentVariants: [], recentFactKeys: [], recentCognitiveTargets: [], priorCognitiveLevelByFactKey: {} }
  if (!sessionContent || typeof sessionContent !== 'object') return empty

  const orderedSessionNumbers = Object.keys(sessionContent)
    .map(Number)
    .filter(n => Number.isFinite(n) && n !== options.excludeSessionNumber)
    .sort((a, b) => b - a) // más reciente primero

  const questionsNewestFirst: HistoricalQuestion[] = []
  const priorCognitiveLevelByFactKey: Record<string, string> = {}

  for (const sessionNumber of orderedSessionNumbers) {
    const content = sessionContent[String(sessionNumber)]
    const blocks = Array.isArray(content?.evaluationBlocks) ? content!.evaluationBlocks! : []
    for (const block of blocks) {
      const questions = Array.isArray(block?.questions) ? block.questions! : []
      for (const question of questions) {
        questionsNewestFirst.push(question)
        const level = String(question.targetDimension || question.cognitiveTarget || '')
        const factKeys = Array.isArray(question.targetFactKeys)
          ? question.targetFactKeys
          : Array.isArray(question.factKeys) ? question.factKeys : []
        if (level && COGNITIVE_RANK[level] !== undefined) {
          for (const factKey of factKeys) {
            const key = String(factKey)
            if (!key) continue
            priorCognitiveLevelByFactKey[key] = higherLevel(priorCognitiveLevelByFactKey[key], level)
          }
        }
      }
    }
  }

  const recentFormats = questionsNewestFirst.slice(0, recentLimit).map(q => String(q.format || '')).filter(Boolean)
  const recentVariants = questionsNewestFirst.slice(0, recentLimit).map(q => String(q.variant || '')).filter(Boolean)
  const recentCognitiveTargets = questionsNewestFirst.slice(0, recentLimit).map(q => String(q.targetDimension || q.cognitiveTarget || '')).filter(Boolean)
  const recentFactKeys = [...new Set(
    questionsNewestFirst.slice(0, recentLimit).flatMap(q => {
      const keys = Array.isArray(q.targetFactKeys) ? q.targetFactKeys : Array.isArray(q.factKeys) ? q.factKeys : []
      return keys.map(String)
    }),
  )]

  return { recentFormats, recentVariants, recentFactKeys, recentCognitiveTargets, priorCognitiveLevelByFactKey }
}
