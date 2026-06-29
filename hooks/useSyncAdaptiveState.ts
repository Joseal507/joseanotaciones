
// ═══════════════════════════════════════════════════════════════
// StudyAL — Sync Adaptive State Hook
// Sincroniza learningMemory, blueprint, program y mastery
// entre dispositivos via servidor.
// Fallback graceful a localStorage si el servidor no responde.
// ═══════════════════════════════════════════════════════════════

import { useCallback, useRef } from 'react'

export interface AdaptiveSyncPayload {
  materialId: string
  learningMemory?: any
  materialBlueprint?: any
  adaptiveProgram?: any
  masterySnapshot?: any
  topicMastery?: any[]
  updatedAt: number
}

const SYNC_DEBOUNCE_MS = 3000 // no guardar más de 1 vez cada 3s

export function useSyncAdaptiveState() {
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const lastSyncRef = useRef<number>(0)

  // ── Guardar en servidor ──────────────────────────────────────
  const syncToServer = useCallback(async (payload: AdaptiveSyncPayload) => {
    try {
      await fetch('/api/adaptive/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialId: payload.materialId,
          state: payload,
        }),
      })
      lastSyncRef.current = Date.now()
    } catch {
      // Silent fail — localStorage ya tiene los datos
    }
  }, [])

  // ── Guardar con debounce ─────────────────────────────────────
  const saveAdaptiveState = useCallback((payload: AdaptiveSyncPayload) => {
    // Siempre guardar en localStorage inmediatamente
    try {
      localStorage.setItem(
        `studyal_adaptive_sync_${payload.materialId}`,
        JSON.stringify(payload)
      )
    } catch {}

    // Debounce el sync al servidor
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      syncToServer(payload)
    }, SYNC_DEBOUNCE_MS)
  }, [syncToServer])

  // ── Cargar desde servidor o localStorage ────────────────────
  const loadAdaptiveState = useCallback(async (
    materialId: string
  ): Promise<AdaptiveSyncPayload | null> => {
    // Intentar servidor primero
    try {
      const res = await fetch(
        `/api/adaptive/sync?materialId=${encodeURIComponent(materialId)}`
      )
      if (res.ok) {
        const data = await res.json()
        if (data.success && data.state && data.state.updatedAt) {
          // Comparar con localStorage — usar el más reciente
          const localRaw = localStorage.getItem(`studyal_adaptive_sync_${materialId}`)
          if (localRaw) {
            const local = JSON.parse(localRaw) as AdaptiveSyncPayload
            if (local.updatedAt > data.state.updatedAt) {
              // Local más reciente — usar local y sincronizar al servidor
              syncToServer(local)
              return local
            }
          }
          // Servidor más reciente
          localStorage.setItem(
            `studyal_adaptive_sync_${materialId}`,
            JSON.stringify(data.state)
          )
          return data.state
        }
      }
    } catch {}

    // Fallback: localStorage
    try {
      const raw = localStorage.getItem(`studyal_adaptive_sync_${materialId}`)
      if (raw) return JSON.parse(raw)
    } catch {}

    return null
  }, [syncToServer])

  // ── Forzar sync inmediato ────────────────────────────────────
  const forceSyncNow = useCallback(async (payload: AdaptiveSyncPayload) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    await syncToServer(payload)
  }, [syncToServer])

  return { saveAdaptiveState, loadAdaptiveState, forceSyncNow }
}
