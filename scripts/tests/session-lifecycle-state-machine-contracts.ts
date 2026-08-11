import assert from 'node:assert/strict'
import {
  deriveSessionLifecycleStatus,
  deriveSessionLifecycleInput,
  canPrepareSession,
  shouldRestoreDirectly,
  mustNeverRegenerate,
  type SessionLifecycleStatus,
} from '../../lib/adaptive/sessionLifecycle'

// ---------------------------------------------------------------------------
// deriveSessionLifecycleStatus — todas las transiciones puras.
// ---------------------------------------------------------------------------
{
  const base = {
    isCompleted: false, hasValidPreparedContent: false, hasPartialPreparationState: false,
    isCurrentSession: false, hasStarted: false, hasUnresolvedRecovery: false,
  }
  assert.equal(deriveSessionLifecycleStatus(base), 'planned')
  assert.equal(deriveSessionLifecycleStatus({ ...base, hasPartialPreparationState: true }), 'failed_recoverable')
  assert.equal(deriveSessionLifecycleStatus({ ...base, hasValidPreparedContent: true }), 'ready')
  assert.equal(deriveSessionLifecycleStatus({ ...base, hasValidPreparedContent: true, isCurrentSession: true, hasStarted: true }), 'in_progress')
  assert.equal(deriveSessionLifecycleStatus({ ...base, hasValidPreparedContent: true, hasUnresolvedRecovery: true }), 'repair_required')
  assert.equal(deriveSessionLifecycleStatus({ ...base, hasValidPreparedContent: true, isCurrentSession: true, hasStarted: true, hasUnresolvedRecovery: true }), 'repair_required', 'repair_required tiene prioridad sobre in_progress — bloquea completion')
  assert.equal(deriveSessionLifecycleStatus({ ...base, isCompleted: true }), 'completed')
  assert.equal(deriveSessionLifecycleStatus({ ...base, isCompleted: true, hasValidPreparedContent: true, hasUnresolvedRecovery: true }), 'completed', 'completed es terminal — nada más puede sobreescribirlo')
  assert.equal(deriveSessionLifecycleStatus({ ...base, requestInFlight: true }), 'preparing')
  assert.equal(deriveSessionLifecycleStatus({ ...base, isCompleted: true, requestInFlight: true }), 'preparing', 'preparing (señal efímera del caller) tiene prioridad de lectura inmediata sobre el estado persistido')
  console.log('session-lifecycle: deriveSessionLifecycleStatus transitions PASS')
}

// ---------------------------------------------------------------------------
// deriveSessionLifecycleInput — deriva desde formas de datos reales (StudySession-like).
// ---------------------------------------------------------------------------
{
  const learningPlanned = deriveSessionLifecycleInput({
    session: {}, sessionNumber: 2, requiresEvaluation: true,
  })
  assert.equal(deriveSessionLifecycleStatus(learningPlanned), 'planned')

  const learningReady = deriveSessionLifecycleInput({
    session: { sessionContent: { '2': { steps: [{ id: 's1' }], evaluationBlocks: [{ id: 'b1' }] } } },
    sessionNumber: 2, requiresEvaluation: true,
  })
  assert.equal(deriveSessionLifecycleStatus(learningReady), 'ready')

  // learning SIN evaluationBlocks -> contenido NO válido (requiresEvaluation=true) -> planned, no ready.
  const learningIncompleteContent = deriveSessionLifecycleInput({
    session: { sessionContent: { '2': { steps: [{ id: 's1' }], evaluationBlocks: [] } } },
    sessionNumber: 2, requiresEvaluation: true,
  })
  assert.equal(deriveSessionLifecycleStatus(learningIncompleteContent), 'planned', 'learning sin evaluationBlocks nunca debe considerarse contenido válido')

  // introduction/final_review no requieren evaluationBlocks.
  const introReady = deriveSessionLifecycleInput({
    session: { sessionContent: { '1': { steps: [{ id: 's1' }], evaluationBlocks: [] } } },
    sessionNumber: 1, requiresEvaluation: false,
  })
  assert.equal(deriveSessionLifecycleStatus(introReady), 'ready')

  const inProgress = deriveSessionLifecycleInput({
    session: {
      sessionContent: { '2': { steps: [{ id: 's1' }], evaluationBlocks: [{ id: 'b1' }] } },
      currentSessionNumber: 2, currentStep: 3,
    },
    sessionNumber: 2, requiresEvaluation: true,
  })
  assert.equal(deriveSessionLifecycleStatus(inProgress), 'in_progress')

  const repairRequired = deriveSessionLifecycleInput({
    session: {
      sessionContent: { '2': { steps: [{ id: 's1' }], evaluationBlocks: [{ id: 'b1' }] } },
      currentSessionNumber: 2, currentStep: 3,
      recoveryQueues: { '2': [{ status: 'unresolved' }] },
    },
    sessionNumber: 2, requiresEvaluation: true,
  })
  assert.equal(deriveSessionLifecycleStatus(repairRequired), 'repair_required')

  const resolvedRecoveryStillInProgress = deriveSessionLifecycleInput({
    session: {
      sessionContent: { '2': { steps: [{ id: 's1' }], evaluationBlocks: [{ id: 'b1' }] } },
      currentSessionNumber: 2, currentStep: 3,
      recoveryQueues: { '2': [{ status: 'resolved' }] },
    },
    sessionNumber: 2, requiresEvaluation: true,
  })
  assert.equal(deriveSessionLifecycleStatus(resolvedRecoveryStillInProgress), 'in_progress', 'recovery YA resuelto no debe seguir bloqueando como repair_required')

  const completed = deriveSessionLifecycleInput({
    session: { completedSessionNumbers: [1, 2], sessionContent: { '2': { steps: [{ id: 's1' }], evaluationBlocks: [{ id: 'b1' }] } } },
    sessionNumber: 2, requiresEvaluation: true,
  })
  assert.equal(deriveSessionLifecycleStatus(completed), 'completed')

  // Replay activo: aunque esté en completedSessionNumbers, replaySessionNumber===N
  // significa que el usuario está reintentando esta sesión — no debe leerse como completed.
  const replaying = deriveSessionLifecycleInput({
    session: { completedSessionNumbers: [1, 2], replaySessionNumber: 2, currentSessionNumber: 2, currentStep: 1, sessionContent: { '2': { steps: [{ id: 's1' }], evaluationBlocks: [{ id: 'b1' }] } } },
    sessionNumber: 2, requiresEvaluation: true,
  })
  assert.equal(deriveSessionLifecycleStatus(replaying), 'in_progress', 'replaySessionNumber===N debe anular la lectura de completed')

  const failedRecoverable = deriveSessionLifecycleInput({
    session: { sessionPreparation: { '2': { preparationStatus: 'evaluation_generation' } } },
    sessionNumber: 2, requiresEvaluation: true,
  })
  assert.equal(deriveSessionLifecycleStatus(failedRecoverable), 'failed_recoverable')

  // Un sessionPreparation con preparationStatus='ready' pero SIN sessionContent
  // correspondiente (estado inconsistente/legacy) no debe leerse como failed_recoverable
  // permanentemente resumible — sigue siendo planned (nada resumible realmente).
  const inconsistentReadyPrepNoContent = deriveSessionLifecycleInput({
    session: { sessionPreparation: { '2': { preparationStatus: 'ready' } } },
    sessionNumber: 2, requiresEvaluation: true,
  })
  assert.equal(deriveSessionLifecycleStatus(inconsistentReadyPrepNoContent), 'planned')

  console.log('session-lifecycle: deriveSessionLifecycleInput (formas de datos reales) PASS')
}

// ---------------------------------------------------------------------------
// Predicados de transición.
// ---------------------------------------------------------------------------
{
  const all: SessionLifecycleStatus[] = ['planned', 'preparing', 'ready', 'in_progress', 'repair_required', 'completed', 'failed_recoverable']
  assert.deepEqual(all.filter(canPrepareSession).sort(), ['failed_recoverable', 'planned'].sort())
  assert.deepEqual(all.filter(shouldRestoreDirectly).sort(), ['completed', 'in_progress', 'ready', 'repair_required'].sort())
  assert.deepEqual(all.filter(mustNeverRegenerate), ['completed'])
  // Ninguna sesión puede simultáneamente "poder prepararse" Y "deber restaurarse
  // directo" — invariante de exclusividad mutua entre las dos rutas de decisión.
  for (const status of all) {
    assert.ok(!(canPrepareSession(status) && shouldRestoreDirectly(status)), `status=${status} no puede ser ambos canPrepare y shouldRestore`)
  }
  console.log('session-lifecycle: transition predicates (canPrepare/shouldRestore/mustNeverRegenerate) mutually exclusive PASS')
}

console.log('session-lifecycle-state-machine-contracts: ALL PASS')
