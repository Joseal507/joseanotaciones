import { isRecord } from './questionContract'

export const EVALUATION_GENERATION_ERROR = 'No pudimos generar una pregunta válida.'

export function generationErrorMessage(
  responseOk: boolean,
  payload: unknown,
): string | null {
  if (responseOk && isRecord(payload) && payload.success === true) {
    return null
  }
  return EVALUATION_GENERATION_ERROR
}
