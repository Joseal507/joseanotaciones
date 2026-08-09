import { normalizeOrRegenerateAcademicFragment } from './fragmentPipeline'

export interface AcademicFragmentTelemetry {
  surface: string
  sessionId: string
  stepId: string
  phase: string
  nodePath: string
  nodeType: string
  validationReason: string
  repairAttempts: number
}

export interface AcademicRecoveryContext extends Omit<AcademicFragmentTelemetry, 'validationReason' | 'repairAttempts'> {
  fallback: string
}

export async function recoverAcademicFragment(
  source: string,
  context: AcademicRecoveryContext,
  regenerate: (fragment: string, issues: string[], attempt: number) => Promise<string>,
  telemetry: (event: AcademicFragmentTelemetry) => void = event => {
    console.error('[academic-content]', JSON.stringify(event))
  },
): Promise<{ content: string; recovered: boolean; attempts: number; valid: boolean }> {
  const result = await normalizeOrRegenerateAcademicFragment(source, regenerate, 2)
  if (result.valid) return { content: result.source, recovered: result.attempts > 0, attempts: result.attempts, valid: true }

  telemetry({
    surface: context.surface,
    sessionId: context.sessionId,
    stepId: context.stepId,
    phase: context.phase,
    nodePath: context.nodePath,
    nodeType: context.nodeType,
    validationReason: result.validation.issues.map(issue => issue.code).join(',') || 'unknown',
    repairAttempts: result.attempts,
  })
  return { content: context.fallback, recovered: false, attempts: result.attempts, valid: false }
}
