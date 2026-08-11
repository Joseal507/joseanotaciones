// Máquina de estados de sesión (misión: auditoría de ciclo de vida y persistencia).
// NO introduce almacenamiento nuevo — deriva un status EXPLÍCITO a partir de los
// campos ya canónicos y ya persistidos (completedSessionNumbers, sessionContent,
// sessionPreparation, currentSessionNumber/currentStep, recoveryQueues), exactamente
// los mismos que loadContext (page.tsx) ya lee. Antes de esta misión, esas mismas
// señales ya gobernaban el comportamiento real de forma IMPLÍCITA y dispersa dentro
// de loadContext — este módulo las centraliza en una función pura y testeable, sin
// duplicar la fuente de verdad ni crear una arquitectura paralela de mastery/estado.
//
// Estados:
//   planned            — el capítulo existe en el journey pero nunca se preparó.
//   preparing          — hay una request de preparación en curso (señal efímera,
//                        solo conocida por el caller — p.ej. sessionPreparationPromiseRef).
//   ready              — sessionContent[N] válido existe, pero N no es la sesión
//                        actualmente activa o aún no se avanzó ningún paso.
//   in_progress        — sessionContent[N] válido existe, N es la sesión activa y
//                        ya se avanzó al menos un paso.
//   repair_required    — sessionContent[N] válido existe pero hay recovery sin
//                        resolver para esta sesión (puede coexistir con in_progress;
//                        repair_required tiene prioridad porque bloquea completion).
//   completed          — sessionNumber ∈ completedSessionNumbers y no es un replay activo.
//   failed_recoverable — no hay sessionContent[N] válido, pero sí un
//                        sessionPreparation[N] parcial (preparationStatus !== 'ready')
//                        de un intento anterior — reanudable, nunca debe regenerarse
//                        desde cero indiscriminadamente.
export type SessionLifecycleStatus =
  | 'planned'
  | 'preparing'
  | 'ready'
  | 'in_progress'
  | 'repair_required'
  | 'completed'
  | 'failed_recoverable'

export interface SessionLifecycleInput {
  isCompleted: boolean
  hasValidPreparedContent: boolean
  hasPartialPreparationState: boolean
  isCurrentSession: boolean
  hasStarted: boolean
  hasUnresolvedRecovery: boolean
  requestInFlight?: boolean
}

export function deriveSessionLifecycleStatus(input: SessionLifecycleInput): SessionLifecycleStatus {
  if (input.requestInFlight) return 'preparing'
  // completed es terminal — una sesión completada nunca vuelve a "planned"/"ready"
  // solo porque su contenido preparado también siga presente.
  if (input.isCompleted) return 'completed'
  if (input.hasValidPreparedContent) {
    if (input.hasUnresolvedRecovery) return 'repair_required'
    if (input.isCurrentSession && input.hasStarted) return 'in_progress'
    return 'ready'
  }
  if (input.hasPartialPreparationState) return 'failed_recoverable'
  return 'planned'
}

// Deriva el input desde las formas de datos reales ya persistidas (StudySession +
// sessionNumber + el kind ya resuelto) — mismo shape que page.tsx ya lee en
// loadContext, sin inventar campos nuevos.
export function deriveSessionLifecycleInput(params: {
  session: {
    completedSessionNumbers?: number[]
    replaySessionNumber?: number
    currentSessionNumber?: number
    currentStep?: number
    sessionContent?: Record<string, { steps?: unknown[]; evaluationBlocks?: unknown[] } | undefined>
    sessionPreparation?: Record<string, { preparationStatus?: string } | undefined>
    recoveryQueues?: Record<string, Array<{ status?: string }>>
  }
  sessionNumber: number
  requiresEvaluation: boolean
  requestInFlight?: boolean
}): SessionLifecycleInput {
  const { session, sessionNumber, requiresEvaluation } = params
  const key = String(sessionNumber)
  const isCompleted = Boolean(
    session.completedSessionNumbers?.includes(sessionNumber) && session.replaySessionNumber !== sessionNumber,
  )
  const content = session.sessionContent?.[key]
  const hasValidPreparedContent = Boolean(
    content && Array.isArray(content.steps) && content.steps.length > 0
    && (!requiresEvaluation || (Array.isArray(content.evaluationBlocks) && content.evaluationBlocks.length > 0)),
  )
  const preparation = session.sessionPreparation?.[key]
  const hasPartialPreparationState = Boolean(preparation) && preparation?.preparationStatus !== 'ready'
  const isCurrentSession = Number(session.currentSessionNumber) === sessionNumber
  const hasStarted = isCurrentSession && Number(session.currentStep || 0) > 0
  const recoveryQueue = session.recoveryQueues?.[key] || []
  const hasUnresolvedRecovery = recoveryQueue.some(item => item.status !== 'resolved')
  return {
    isCompleted, hasValidPreparedContent, hasPartialPreparationState,
    isCurrentSession, hasStarted, hasUnresolvedRecovery,
    requestInFlight: params.requestInFlight,
  }
}

// Predicados de transición — usados para decidir la acción correcta en vez de
// booleanos ambiguos dispersos por el código.
export const canPrepareSession = (status: SessionLifecycleStatus): boolean =>
  status === 'planned' || status === 'failed_recoverable'

export const shouldRestoreDirectly = (status: SessionLifecycleStatus): boolean =>
  status === 'ready' || status === 'in_progress' || status === 'repair_required' || status === 'completed'

// Una sesión completada NUNCA debe volver a prepararse/regenerarse — invariante
// explícito exigido por la misión ("COMPLETED no debe volver a prepararse
// accidentalmente").
export const mustNeverRegenerate = (status: SessionLifecycleStatus): boolean =>
  status === 'completed'
