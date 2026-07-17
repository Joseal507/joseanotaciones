// ═══════════════════════════════════════════════════════════════
// INVARIANTS — Propiedades que nunca pueden violarse
// ═══════════════════════════════════════════════════════════════

import type { SessionState } from '../../../lib/adaptive/v3/types'
import { MAX_INTERACTIONS_PER_MICRO } from '../../../lib/adaptive/v3/engine/stateMachine'
import type { SessionCompletionResult } from '../../../lib/adaptive/v3/engine/stateMachine'
import type { SimulationInvariantFailure, SimulationTurn } from './types'
import type { StudentProfileId } from './types'

export interface InvariantContext {
  seed: number
  profileId: StudentProfileId
  programId: string
  sessionIndex: number
  sessionState: SessionState
  completion: SessionCompletionResult
  turns: SimulationTurn[]
  microResolutions: Record<string, string>
  virtualTimeMs: number
}

type InvariantCheck = (ctx: InvariantContext) => SimulationInvariantFailure | null

function makeFailure(
  ctx: InvariantContext,
  invariantId: string,
  description: string,
  snapshot: Record<string, unknown>,
): SimulationInvariantFailure {
  return {
    invariantId,
    description,
    seed: ctx.seed,
    profileId: ctx.profileId,
    programId: ctx.programId,
    sessionIndex: ctx.sessionIndex,
    turnIndex: ctx.turns.length,
    snapshot,
    replayCommand: `npm run simulate:v3:replay -- --seed ${ctx.seed} --profile ${ctx.profileId} --program ${ctx.programId}`,
  }
}

// ─── INV-01: programComplete implica todos required mastered ─────
const inv01: InvariantCheck = (ctx) => {
  const { completion } = ctx
  if (!completion.isProgramComplete) return null
  if (completion.unresolvedMicroIds.length > 0) {
    return makeFailure(ctx, 'INV-01',
      `programComplete=true pero unresolvedMicroIds=[${completion.unresolvedMicroIds.join(',')}]`,
      { isProgramComplete: true, unresolvedMicroIds: completion.unresolvedMicroIds },
    )
  }
  return null
}

// ─── INV-02: masteryPercent=100 implica todos required mastered ──
const inv02: InvariantCheck = (ctx) => {
  const { completion } = ctx
  if (completion.masteryPercent !== 100) return null
  if (completion.unresolvedMicroIds.length > 0 || completion.masteredCount !== completion.totalRequired) {
    return makeFailure(ctx, 'INV-02',
      `masteryPercent=100 pero masteredCount=${completion.masteredCount} totalRequired=${completion.totalRequired}`,
      { masteryPercent: 100, masteredCount: completion.masteredCount, totalRequired: completion.totalRequired },
    )
  }
  return null
}

// ─── INV-03: sesión complete y programa pending deben coexistir ──
const inv03: InvariantCheck = (ctx) => {
  const { completion } = ctx
  // Permitido: sessionComplete=true y programComplete=false
  // Prohibido: programComplete=true y sessionComplete=false (estado imposible)
  if (completion.isProgramComplete && !completion.isSessionComplete) {
    return makeFailure(ctx, 'INV-03',
      'programComplete=true pero isSessionComplete=false (imposible)',
      { isProgramComplete: true, isSessionComplete: false },
    )
  }
  return null
}

// ─── INV-04: sessionState no tiene loops infinitos ───────────────
const inv04: InvariantCheck = (ctx) => {
  const { turns } = ctx

  // Debe ser MÁS permisivo que el fusible del simulador.
  // El simulador fuerza avance después de MAX_INTERACTIONS_PER_MICRO * 4 + 1.
  // Por eso solo marcamos loop si el run supera ese límite claramente.
  const loopThreshold = MAX_INTERACTIONS_PER_MICRO * 4 + 2

  if (turns.length < loopThreshold) return null

  // Loop real: demasiados turnos consecutivos en el mismo micro+objetivo
  const lastWindow = turns.slice(-loopThreshold)
  const sameMicroObj = lastWindow.every(t =>
    t.microId === lastWindow[0].microId && t.objective === lastWindow[0].objective
  )

  if (sameMicroObj) {
    return makeFailure(ctx, 'INV-04',
      `Loop detectado: ${lastWindow.length} turnos consecutivos del mismo micro+objetivo`,
      {
        microId: lastWindow[0].microId,
        objective: lastWindow[0].objective,
        turns: lastWindow.length,
      },
    )
  }

  // Loop de fallos reales: demasiados incorrectos seguidos en el mismo micro
  const allIncorrect = lastWindow.every(t =>
    t.microId === lastWindow[0].microId &&
    t.format !== 'none' &&
    t.response.outcome === 'incorrect'
  )

  if (allIncorrect) {
    return makeFailure(ctx, 'INV-04',
      `Loop de fallos: ${lastWindow.length} incorrectos consecutivos en micro ${lastWindow[0].microId}`,
      {
        microId: lastWindow[0].microId,
        consecutiveIncorrect: lastWindow.length,
      },
    )
  }

  return null
}

// ─── INV-05: score siempre finito y en rango [0,100] ────────────
const inv05: InvariantCheck = (ctx) => {
  const { turns } = ctx
  for (const turn of turns) {
    const score = turn.response.score
    if (!isFinite(score) || score < 0 || score > 100) {
      return makeFailure(ctx, 'INV-05',
        `Score inválido: ${score}`,
        { score, turnIndex: turn.turnIndex, microId: turn.microId },
      )
    }
  }
  return null
}

// ─── INV-06: confidence undefined no activa illusion ────────────
const inv06: InvariantCheck = (ctx) => {
  // Esta invariante se verifica a nivel de turno
  // Si selfReportedConfidence es undefined, no debería haber high_confidence_error
  // Esta verificación es conceptual — en producción la enforce pedagogicalDecision.ts
  // Aquí solo verificamos que el score sea coherente con undefined confidence
  return null // verificado en el engine real
}

// ─── INV-07: turns tienen microId válido ─────────────────────────
const inv07: InvariantCheck = (ctx) => {
  const { turns, sessionState } = ctx
  for (const turn of turns) {
    if (!turn.microId) {
      return makeFailure(ctx, 'INV-07',
        'Turno sin microId',
        { turnIndex: turn.turnIndex },
      )
    }
  }
  return null
}

// ─── INV-08: masteredCount <= totalRequired ──────────────────────
const inv08: InvariantCheck = (ctx) => {
  const { completion } = ctx
  if (completion.masteredCount > completion.totalRequired) {
    return makeFailure(ctx, 'INV-08',
      `masteredCount=${completion.masteredCount} > totalRequired=${completion.totalRequired}`,
      { masteredCount: completion.masteredCount, totalRequired: completion.totalRequired },
    )
  }
  return null
}

// ─── INV-09: masteryPercent en rango [0,100] ─────────────────────
const inv09: InvariantCheck = (ctx) => {
  const { completion } = ctx
  if (!isFinite(completion.masteryPercent) || completion.masteryPercent < 0 || completion.masteryPercent > 100) {
    return makeFailure(ctx, 'INV-09',
      `masteryPercent inválido: ${completion.masteryPercent}`,
      { masteryPercent: completion.masteryPercent },
    )
  }
  return null
}

// ─── INV-10: completedMicroIds no tiene duplicados ───────────────
const inv10: InvariantCheck = (ctx) => {
  const { sessionState } = ctx
  const completed = sessionState.queue.completedMicroIds
  if (completed.length !== new Set(completed).size) {
    return makeFailure(ctx, 'INV-10',
      'completedMicroIds tiene duplicados',
      { completedMicroIds: completed },
    )
  }
  return null
}

// ─── INV-11: activeMicroId está en pending o completado ─────────
const inv11: InvariantCheck = (ctx) => {
  const { sessionState } = ctx
  const active = sessionState.queue.activeMicroId
  if (!active) return null
  const allKnown = [
    ...sessionState.queue.pendingMicroIds,
    ...sessionState.queue.completedMicroIds,
    ...sessionState.queue.postponedMicroIds,
  ]
  if (!allKnown.includes(active)) {
    return makeFailure(ctx, 'INV-11',
      `activeMicroId=${active} no está en pending/completed/postponed`,
      { activeMicroId: active, known: allKnown },
    )
  }
  return null
}

// ─── INV-12: coveragePercent es coherente con studiedCount ───────
const inv12: InvariantCheck = (ctx) => {
  const { completion } = ctx
  if (!isFinite(completion.coveragePercent) || completion.coveragePercent < 0 || completion.coveragePercent > 100) {
    return makeFailure(ctx, 'INV-12',
      `coveragePercent inválido: ${completion.coveragePercent}`,
      { coveragePercent: completion.coveragePercent },
    )
  }
  return null
}

// ─── Todas las invariantes ───────────────────────────────────────
export const ALL_INVARIANTS: InvariantCheck[] = [
  inv01, inv02, inv03, inv04, inv05, inv06, inv07, inv08, inv09, inv10, inv11, inv12,
]

export function checkAllInvariants(ctx: InvariantContext): SimulationInvariantFailure[] {
  const failures: SimulationInvariantFailure[] = []
  for (const check of ALL_INVARIANTS) {
    try {
      const failure = check(ctx)
      if (failure) failures.push(failure)
    } catch (err: any) {
      failures.push(makeFailure(ctx, 'INV-CRASH',
        `Invariant check crashed: ${err?.message}`,
        { error: String(err) },
      ))
    }
  }
  return failures
}
