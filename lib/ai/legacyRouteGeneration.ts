import { alai, safeParseJson, classifyJsonParseFailure, type ALAICompletionMetadata, type ALAIResult } from '../alai'
import { CHAT_LIMITS, CHAT_RESPONSE_SCHEMA } from '../alai-chat/contracts'
import {
  runGenerationPipeline,
  type GenerationStage,
  type GenerationTaskType,
  type ValidationResult,
} from './generationPipeline'
import { recoverLLMResponse } from '../materialBrain/truncationRecovery'

export interface LegacyJsonGenerationInput<T> {
  taskType: GenerationTaskType
  /** Injectable transport; parsing, validation and retry orchestration remain production code. */
  provider?: typeof alai
  prompt?: string
  messages?: { role: 'system' | 'user' | 'assistant'; content: string }[]
  validate: (value: unknown, completion?: ALAICompletionMetadata) => ValidationResult
  normalize: (value: unknown) => T
  maxTokens?: number
  temperature?: number
  /** Route-local opt-in for native provider JSON transport. */
  forceJsonTransport?: boolean
  /** ALAI-only opt-in. Legacy callers retain their transport and parsing behavior. */
  chatTransport?: {
    totalTimeoutMs?: number; attemptTimeoutMs?: number
    onAttempt?: () => void
    onCompletion?: (completion: ALAICompletionMetadata | undefined) => void
    onValidation?: (errors: string[]) => void
  }
  splitCount?: number
  mergeParts?: (parts: T[]) => T
  telemetryContext?: Record<string, unknown>
  failurePath?: 'comprehensive' | 'single_repair'
  beforeProviderAttempt?: Parameters<typeof runGenerationPipeline<T>>[0]['beforeProviderAttempt']
  /**
   * Claves de arrays esperadas en la respuesta JSON.
   * Si se provee y safeParseJson falla, se intenta recovery parcial
   * antes de lanzar INVALID_JSON.
   * Esto conecta truncationRecovery al camino live real de extracción.
   */
  recoverableArrayKeys?: string[]
  /**
   * Salvage determinístico de raw text para rutas que pueden recuperar el
   * contenido antes de declarar INVALID_JSON y quemar otro provider call.
   */
  salvageRawText?: (rawText: string, stage: GenerationStage) => unknown | null
}

export async function generateValidatedLegacyJson<T>(
  input: LegacyJsonGenerationInput<T>,
): Promise<T> {
  const totalTimeoutMs = input.chatTransport
    ? Math.min(CHAT_LIMITS.totalTimeoutMs, Math.max(1, input.chatTransport.totalTimeoutMs ?? CHAT_LIMITS.totalTimeoutMs)) : 105_000
  const deadline = Date.now() + totalTimeoutMs
  let completion: ALAICompletionMetadata | undefined
  let rejectedText = ''
  const result = await runGenerationPipeline<T>({
    taskType: input.taskType,
    failurePath: input.chatTransport ? 'single_repair' : input.failurePath,
    beforeProviderAttempt: input.beforeProviderAttempt,
    totalTimeoutMs,
    splitCount: input.chatTransport ? undefined : input.splitCount,
    mergeParts: input.mergeParts,
    generate: async context => {
      completion = undefined
      if (input.chatTransport && Date.now() >= deadline) throw new Error('CHAT_TRANSPORT_DEADLINE')
      const errors = context.validationErrors.length
        ? `\nRECHAZOS DEL INTENTO ANTERIOR:\n${context.validationErrors.map(error => `- ${error}`).join('\n')}`
        : ''
      const instruction = context.stage === 'format_repair'
        ? (input.taskType === 'explanation'
            ? '\nDevuelve exclusivamente un objeto JSON válido con la propiedad "answer". Asegúrate de que las cadenas de texto tengan los saltos de línea escapados (\\n) y las comillas dobles internas escapadas (\\").'
            : '\nDevuelve exclusivamente JSON válido con el esquema requerido, sin markdown ni comentarios. Asegúrate de que las cadenas de texto tengan los saltos de línea escapados (\\n) y las comillas dobles internas escapadas (\\"). Reduce campos opcionales.')
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
      const cleanRejected = rejectedText ? rejectedText.trim().replace(/[ \t]{2,}/g, ' ') : ''
      const repairContext = input.chatTransport && context.stage !== 'normal' && cleanRejected
        ? `\nBORRADOR RECHAZADO (solo contexto de edición; NO autoridad académica):\n${JSON.stringify(cleanRejected.slice(0, 1500))}\nDevuelve la respuesta completa corregida con todos los campos del contrato original. No completes hechos faltantes por conjetura.` : ''
      const controller = input.chatTransport ? new AbortController() : undefined
      const timeoutMs = input.chatTransport ? Math.max(1, Math.min(
        CHAT_LIMITS.attemptTimeoutMs, input.chatTransport.attemptTimeoutMs ?? CHAT_LIMITS.attemptTimeoutMs, deadline - Date.now(),
      )) : undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      let generated: ALAIResult
      try {
      input.chatTransport?.onAttempt?.()
      const pending = (input.provider || alai)({
        ...(input.chatTransport ? { responseJsonSchema: CHAT_RESPONSE_SCHEMA } : {}),
        messages: baseMessages.map((message, index) => index === baseMessages.length - 1
          ? { ...message, content: `${message.content}${errors}${instruction}${repairContext}` }
          : message),
        temperature: input.temperature ?? 0.25,
        maxTokens: context.stage === 'split_individual'
          ? Math.min(input.maxTokens ?? 4000, 2200)
          : input.maxTokens ?? 4000,
        json: true,
        forceJsonTransport: input.forceJsonTransport,
        fallbackError: context.providerError,
        excludeProviders: context.excludedProviders,
        taskType: input.taskType,
        stage: context.stage,
        ...(input.chatTransport ? { transportRetries: 0, maxProviderAttempts: 1, timeoutMs, signal: controller!.signal } : {}),
      })
      generated = input.chatTransport ? await Promise.race([pending, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller!.abort(); reject(new Error('CHAT_TRANSPORT_TIMEOUT')) }, timeoutMs)
      })]) : await pending
      } finally { if (timer) clearTimeout(timer) }
      completion = generated.completion
      input.chatTransport?.onCompletion?.(completion)
      if (input.chatTransport) {
        rejectedText = generated.text.replace(/[ \t]{2,}/g, ' ').slice(0, 2000)
        if (!completion?.transportComplete || completion.finishReason !== 'stop') throw new Error('INVALID_JSON:incomplete_transport')
      }

      // FIX 1: intentar parse normal primero
      const parsed = safeParseJson(generated.text)
      if (parsed !== null) {
        // Route-local diagnostics for ALAI Chat. Lengths/counts only:
        // never log the student's material or provider response content.
        if (input.telemetryContext?.route === 'alai-studyal-chat') {
          const parsedObject =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? parsed as Record<string, unknown>
              : null

          const knownKeys = new Set([
            'answer',
            'usedTargetIds',
            'usedRelationIds',
            'suggestedFollowups',
          ])

          const parsedSerializedChars = (() => {
            try {
              return JSON.stringify(parsed).length
            } catch {
              return null
            }
          })()

          console.info('[ai-generation]', JSON.stringify({
            event: 'chat_payload_shape',
            taskType: input.taskType,
            ...input.telemetryContext,
            stage: context.stage,
            parsedTopLevelType: Array.isArray(parsed) ? 'array' : typeof parsed,
            parsedSerializedChars,
            answerChars:
              typeof parsedObject?.answer === 'string'
                ? parsedObject.answer.length
                : null,
            usedTargetCount:
              Array.isArray(parsedObject?.usedTargetIds)
                ? parsedObject.usedTargetIds.length
                : null,
            usedRelationCount:
              Array.isArray(parsedObject?.usedRelationIds)
                ? parsedObject.usedRelationIds.length
                : null,
            suggestedFollowupCount:
              Array.isArray(parsedObject?.suggestedFollowups)
                ? parsedObject.suggestedFollowups.length
                : null,
            unknownFieldCount: parsedObject
              ? Object.keys(parsedObject).filter(key => !knownKeys.has(key)).length
              : null,
          }))
        }

        return {
          value: input.normalize(parsed),
          provider: generated.provider,
          model: generated.model,
        }
      }

      // Strict chat transport cannot reinterpret malformed JSON as a successful prose answer.
      if (input.chatTransport) {
        if (input.salvageRawText) {
          const salvaged = input.salvageRawText(generated.text, context.stage)
          if (salvaged !== null && salvaged !== undefined) {
            return {
              value: input.normalize(salvaged),
              provider: generated.provider,
              model: generated.model,
            }
          }
        }
        throw new Error(`INVALID_JSON:${classifyJsonParseFailure(generated.text)}`)
      }

      // FIX 1: parse normal falló — si el caller declaró recoverableArrayKeys,
      // intentar recovery parcial del raw text ANTES de lanzar INVALID_JSON.
      // El raw text está disponible aquí (generated.text) y NO se pierde.
      // El recovery devuelve solo objetos JSON completos — nunca inventa semántica.
      if (input.recoverableArrayKeys?.length) {
        const recovery = recoverLLMResponse(generated.text, input.recoverableArrayKeys)
        const hasAnyRecovered = input.recoverableArrayKeys.some(
          key => (recovery.result[key]?.length ?? 0) > 0
        )
        if (hasAnyRecovered) {
          // Pasar el resultado recuperado con metadata de recovery embebida
          // para que normalize() en extraction.ts pueda setear wasRecovered/strategy
          const recoveredPayload = {
            ...recovery.result,
            __recovery__: {
              isPartial: recovery.isPartial,
              strategy: recovery.strategy,
              truncatedObjectsPerArray: recovery.truncatedObjectsPerArray,
            },
          }
          return {
            value: input.normalize(recoveredPayload),
            provider: generated.provider,
            model: generated.model,
          }
        }
        // Recovery intentado pero 0 objetos salvados — lanzar con indicación
        throw new Error(`INVALID_JSON:truncated_no_recovery`)
      }

      // FIX 3: si el caller declaró salvageRawText, intentar salvage determinístico
      // antes de lanzar INVALID_JSON y quemar otro provider call.
      if (input.salvageRawText) {
        const salvaged = input.salvageRawText(generated.text, context.stage)
        if (salvaged !== null && salvaged !== undefined) {
          return {
            value: input.normalize(salvaged),
            provider: generated.provider,
            model: generated.model,
          }
        }
      }

      // Sin recoverableArrayKeys ni salvage exitoso — diagnosticar y lanzar
      const failureClass = classifyJsonParseFailure(generated.text)
      throw new Error(`INVALID_JSON:${failureClass}`)
    },
    validate: value => {
      const validation = input.validate(value, completion)
      input.chatTransport?.onValidation?.(validation.errors)
      return validation
    },
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
