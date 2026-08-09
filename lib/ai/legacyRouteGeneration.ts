import { alai, safeParseJson } from '../alai'
import {
  runGenerationPipeline,
  type GenerationTaskType,
  type ValidationResult,
} from './generationPipeline'

export interface LegacyJsonGenerationInput<T> {
  taskType: GenerationTaskType
  prompt?: string
  messages?: { role: 'system' | 'user' | 'assistant'; content: string }[]
  validate: (value: unknown) => ValidationResult
  normalize: (value: unknown) => T
  maxTokens?: number
  temperature?: number
  splitCount?: number
  mergeParts?: (parts: T[]) => T
  telemetryContext?: Record<string, unknown>
}

export async function generateValidatedLegacyJson<T>(
  input: LegacyJsonGenerationInput<T>,
): Promise<T> {
  const result = await runGenerationPipeline<T>({
    taskType: input.taskType,
    totalTimeoutMs: 105_000,
    splitCount: input.splitCount,
    mergeParts: input.mergeParts,
    generate: async context => {
      const errors = context.validationErrors.length
        ? `\nRECHAZOS DEL INTENTO ANTERIOR:\n${context.validationErrors.map(error => `- ${error}`).join('\n')}`
        : ''
      const instruction = context.stage === 'format_repair'
        ? '\nDevuelve exclusivamente JSON válido, sin markdown ni comentarios. Reduce campos opcionales.'
        : context.stage === 'targeted_repair'
          ? '\nRegenera solo elementos rechazados y corrige exactamente los rechazos anteriores.'
          : context.stage === 'simplified'
            ? '\nSimplifica el esquema conservando contenido, grounding y formato de respuesta.'
            : context.stage === 'split_individual'
              ? `\nGenera únicamente la parte ${Number(context.partIndex) + 1} de ${context.partCount}; debe ser independiente y no duplicar otras partes.`
              : context.stage === 'alternate_provider'
                ? '\nReconstruye la salida con un esquema JSON mínimo y estricto.'
                : ''
      const baseMessages = input.messages?.length
        ? input.messages
        : [{ role: 'user' as const, content: input.prompt || '' }]
      const generated = await alai({
        messages: baseMessages.map((message, index) => index === baseMessages.length - 1
          ? { ...message, content: `${message.content}${errors}${instruction}` }
          : message),
        temperature: input.temperature ?? 0.25,
        maxTokens: context.stage === 'split_individual'
          ? Math.min(input.maxTokens ?? 4000, 2200)
          : input.maxTokens ?? 4000,
        json: true,
        fallbackError: context.providerError,
        taskType: input.taskType,
        stage: context.stage,
      })
      const parsed = safeParseJson(generated.text)
      if (parsed === null) throw new Error('INVALID_JSON')
      return {
        value: input.normalize(parsed),
        provider: generated.provider,
        model: generated.model,
      }
    },
    validate: value => input.validate(value),
    telemetry: (event, payload) => console.info('[ai-generation]', JSON.stringify({
      event,
      taskType: input.taskType,
      ...input.telemetryContext,
      ...payload,
    })),
  })
  if (result.status !== 'validated' || result.content === undefined) {
    throw new Error(`GENERATION_BUDGET_EXHAUSTED:${result.validationResult.errors.join(',')}`)
  }
  return result.content
}
