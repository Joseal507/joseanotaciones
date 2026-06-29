// ═══════════════════════════════════════════════════════════════
// StudyAL — Program Phases
// El programa tiene fases, no solo sesiones.
// Las fases dan estructura y significado al proceso.
// ═══════════════════════════════════════════════════════════════

import type { AdaptiveSession } from './program'

export type PhaseName =
  | 'foundation'    // Fase 1: Construir base
  | 'memory'        // Fase 2: Anclar en memoria
  | 'application'   // Fase 3: Aplicar
  | 'exam_prep'     // Fase 4: Preparar para examen
  | 'repair'        // Fase 5: Reparar errores
  | 'consolidation' // Fase 6: Consolidar y confirmar
  | 'recovery'      // Fase especial: Recuperar después de ausencia

export interface ProgramPhase {
  name: PhaseName
  label: string
  description: string
  emoji: string
  sessions: AdaptiveSession[]
  sessionIndices: number[]    // índices en el programa completo
  status: 'completed' | 'active' | 'upcoming'
  estimatedMinutes: number
}

export const PHASE_CONFIG: Record<PhaseName, {
  label: string
  description: string
  emoji: string
}> = {
  foundation: {
    label: 'Fase 1 — Construir base',
    description: 'Entender las ideas principales antes de memorizar.',
    emoji: '🏗️',
  },
  memory: {
    label: 'Fase 2 — Anclar en memoria',
    description: 'Convertir comprensión en memoria a largo plazo.',
    emoji: '🎴',
  },
  application: {
    label: 'Fase 3 — Aplicar',
    description: 'Usar el conocimiento en situaciones reales.',
    emoji: '🎯',
  },
  exam_prep: {
    label: 'Fase 4 — Preparar para examen',
    description: 'Simular el examen para medir dominio real.',
    emoji: '📝',
  },
  repair: {
    label: 'Fase 5 — Reparar errores',
    description: 'Corregir los conceptos que fallaron.',
    emoji: '✨',
  },
  consolidation: {
    label: 'Fase Final — Consolidar',
    description: 'Confirmar que el dominio es estable.',
    emoji: '🏆',
  },
  recovery: {
    label: 'Fase de Recuperación',
    description: 'Recuperar lo que el tiempo se llevó.',
    emoji: '🔄',
  },
}

// ── Asignar fases a sesiones ──────────────────────────────────────
export function assignPhasesToSessions(sessions: AdaptiveSession[]): ProgramPhase[] {
  const phaseMap: Record<string, PhaseName> = {
    understand: 'foundation',
    organize: 'foundation',
    memorize: 'memory',
    apply: 'application',
    simulate: 'exam_prep',
    repair: 'repair',
  }

  const phaseBuckets: Partial<Record<PhaseName, number[]>> = {}

  sessions.forEach((session, index) => {
    const phase = phaseMap[session.purpose] || 'application'
    if (!phaseBuckets[phase]) phaseBuckets[phase] = []
    phaseBuckets[phase]!.push(index)
  })

  const phases: ProgramPhase[] = []

  for (const [phaseName, indices] of Object.entries(phaseBuckets)) {
    const config = PHASE_CONFIG[phaseName as PhaseName]
    if (!config || !indices) continue

    const phaseSessions = indices.map(i => sessions[i])
    const completedAll = phaseSessions.every(s => s.status === 'completed')
    const hasActive = phaseSessions.some(
      s => s.status === 'available' || s.status === 'in_progress'
    )

    phases.push({
      name: phaseName as PhaseName,
      label: config.label,
      description: config.description,
      emoji: config.emoji,
      sessions: phaseSessions,
      sessionIndices: indices,
      status: completedAll ? 'completed' : hasActive ? 'active' : 'upcoming',
      estimatedMinutes: phaseSessions.reduce((sum, s) => sum + s.estimatedMinutes, 0),
    })
  }

  return phases
}

// ── Mensaje de fase para el usuario ─────────────────────────────────
export function getPhaseMessage(phase: ProgramPhase): string {
  const messages: Record<PhaseName, string> = {
    foundation: 'Estamos construyendo la base. Sin esto, lo demás no funciona.',
    memory: 'La base está lista. Ahora vamos a anclar esto en tu memoria.',
    application: 'Ya sabes el tema. Hora de demostrar que puedes usarlo.',
    exam_prep: 'Es momento de la verdad. Vamos a simular el examen.',
    repair: 'Detecté errores importantes. Los vamos a corregir antes de continuar.',
    consolidation: 'Casi terminamos. Solo necesitamos confirmar que el dominio es estable.',
    recovery: 'Bienvenido de vuelta. Primero recuperamos, luego avanzamos.',
  }
  return messages[phase.name]
}
