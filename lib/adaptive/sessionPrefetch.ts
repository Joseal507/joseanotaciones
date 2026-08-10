// PrefetchedSession: contrato de FASE 8/9 de la misión visual+prefetch. Cubre el flujo
// real: sesión N activa -> prefetch seguro de N+1 -> persistencia -> dependency
// fingerprint -> reuse si válido -> stale/reconcile si cambió el fingerprint.
//
// Hallazgo clave de la auditoría (Codex C, prefetch architecture): una sesión N+1
// ordinaria (kind='learning') NO depende hoy de la evidencia/mastery/recovery de N —
// el journey es estático una vez construido (journeyBuilder.ts). La EXCEPCIÓN real es
// `final_review`, que sí depende de demonstratedFactKeys/recovery de N — por eso este
// módulo NUNCA prefetchea final_review (shouldPrefetchSession lo excluye
// explícitamente); esperar a que N termine para esa clase de sesión es el diseño
// mínimo seguro, no una limitación accidental.
export type PrefetchStatus =
  | 'not_started'
  | 'preparing'
  | 'static_ready'
  | 'finalizing'
  | 'ready'
  | 'stale'
  | 'failed_retryable'
  | 'failed_terminal'

export interface PrefetchDependencyInput {
  chapterId: string
  chapterBlockIds: string[]
  blueprintVersion: number | string
  journeyId: string
  journeyVersion: number | string
  setupSnapshot: unknown
  materialHash: string
}

// Hash determinista puro-JS (FNV-1a de 32 bits, doblado dos veces con semillas
// distintas para reducir colisiones) — SIN node:crypto: este módulo se importa desde
// page.tsx ("use client"), y node:crypto no es bundleable para el navegador. No es un
// límite de seguridad (a diferencia de visualSpecIntegrity.ts, que sí firma
// server-side con HMAC) — solo necesita ser estable y sensible a cualquier cambio de
// dependencia real, nunca criptográficamente fuerte.
function fnv1a(text: string, seed: number): string {
  let hash = seed
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// dependencyFingerprint: para sesiones learning, cubre EXACTAMENTE las dependencias
// reales confirmadas por Codex C (chapter/blueprint/journey/setup/material) — nunca
// evidencia/mastery/recovery de N, porque esas no son dependencias reales de una N+1
// ordinaria.
export function computeSessionDependencyFingerprint(input: PrefetchDependencyInput): string {
  const payload = JSON.stringify({
    chapterId: input.chapterId,
    chapterBlockIds: [...input.chapterBlockIds].sort(),
    blueprintVersion: input.blueprintVersion,
    journeyId: input.journeyId,
    journeyVersion: input.journeyVersion,
    setupSnapshot: input.setupSnapshot,
    materialHash: input.materialHash,
  })
  return fnv1a(payload, 2166136261) + fnv1a(payload, 0x9e3779b9)
}

export interface PrefetchedSessionMeta {
  sessionNumber: number
  sourceBlueprintVersion: number | string
  journeyVersion: number | string
  setupFingerprint: string
  dependencyFingerprint: string
  preparedAt: number
  status: PrefetchStatus
}

// Solo sesiones 'learning' cuya definición ya es estable son elegibles para
// prefetch — nunca 'final_review' (depende de la evidencia real de N, ver arriba),
// nunca 'introduction' (siempre es la sesión 1, no hay "N+1" que prefetchear hacia
// ella en un flujo de avance normal).
export function shouldPrefetchSession(kind: string): boolean {
  return kind === 'learning'
}

// Un prefetch persistido solo es válido para servir si su dependencyFingerprint
// coincide EXACTAMENTE con el fingerprint recalculado en el momento de consumo — si
// blueprint/journey/setup cambiaron entre el momento en que se preparó el prefetch y
// el momento en que el usuario navega, nunca se sirve contenido obsoleto (FASE 10-H).
export function isPrefetchStillValid(meta: PrefetchedSessionMeta | undefined | null, currentFingerprint: string): boolean {
  if (!meta) return false
  return meta.dependencyFingerprint === currentFingerprint
}

// Dedupe same-tab: dos triggers de prefetch para la MISMA clave dentro de la misma
// pestaña/montaje deben compartir la MISMA promesa en curso — nunca disparan dos
// requests divergentes. Extraído a una clase reusable/testeable (antes vivía inline
// en page.tsx, igual que recoveryPrefetchRef) para poder probarlo de forma
// determinista sin un navegador. page.tsx usa una instancia de esto para
// sessionPrefetchRef.
//
// CROSS_TAB_DEDUP: NOT GUARANTEED — esta clase (como recoveryPrefetchRef, su mismo
// patrón, ya en producción) es un Map en memoria del COMPONENTE/pestaña actual.
// Ninguna coordinación existe entre pestañas distintas ni entre instancias
// serverless (confirmado por Codex C: ningún mecanismo del codebase, ni siquiera el
// flujo de recovery ya en producción, coordina entre pestañas/instancias). Dos
// pestañas abiertas sobre la MISMA sesión pueden disparar prefetches concurrentes
// independientes — no se declara ni se debe asumir cobertura completa de esto.
export const CROSS_TAB_DEDUP = 'NOT GUARANTEED' as const

export class KeyedPromiseCache<T> {
  private readonly inFlight = new Map<string, Promise<T>>()

  // Si ya hay una operación en curso para `key`, devuelve ESA MISMA promesa
  // (nunca invoca `factory` de nuevo) — garantiza que dos triggers concurrentes con
  // la misma clave produzcan exactamente un request subyacente.
  run(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key)
    if (existing) return existing
    const promise = factory().finally(() => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key)
    })
    this.inFlight.set(key, promise)
    return promise
  }

  has(key: string): boolean {
    return this.inFlight.has(key)
  }
}
