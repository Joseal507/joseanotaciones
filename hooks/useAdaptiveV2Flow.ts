// ═══════════════════════════════════════════════════════════════
// useAdaptiveV2Flow
// 
// Orquesta el flujo completo v2:
// 1. Analyze material (o usa cache de R2)
// 2. Create plan (o usa cache de R2)
// 3. Devuelve plan listo para mostrar en el libro
// ═══════════════════════════════════════════════════════════════

import { useState, useCallback, useRef } from 'react'
import type { MaterialIntelligence } from '../lib/adaptive/v2/types'
import type { StoredPlan } from '../lib/adaptive/v2/storage/plan'

export type V2FlowPhase =
  | 'idle'
  | 'analyzing'
  | 'planning'
  | 'ready'
  | 'error'

export interface V2FlowState {
  phase: V2FlowPhase
  intelligence: MaterialIntelligence | null
  plan: StoredPlan | null
  error: string | null
  loadingMessage: string
  progress: number
  stats: {
    fromCacheAnalysis?: boolean
    fromCachePlan?: boolean
    analysisMs?: number
    planMs?: number
    totalMs?: number
  }
}

export function useAdaptiveV2Flow() {
  const [state, setState] = useState<V2FlowState>({
    phase: 'idle',
    intelligence: null,
    plan: null,
    error: null,
    loadingMessage: '',
    progress: 0,
    stats: {},
  })

  const abortRef = useRef(false)

  const runFullFlow = useCallback(async (input: {
    userId: string
    materialId: string
    materialTitle: string
    materialText: string
    totalPages?: number
    profile: any
    setup: any
    forceRefresh?: boolean
  }) => {
    abortRef.current = false
    const totalStart = Date.now()

    // ═══════════════════════════════════════════════════════════
    // FASE 1: ANALYZE
    // ═══════════════════════════════════════════════════════════
    setState({
      phase: 'analyzing',
      intelligence: null,
      plan: null,
      error: null,
      loadingMessage: 'ALAI está analizando el material completo...',
      progress: 0,
      stats: {},
    })

    let intelligence: MaterialIntelligence | null = null
    let fromCacheAnalysis = false
    const analysisStart = Date.now()

    try {
      const res = await fetch('/api/adaptive/v2/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: input.userId,
          materialId: input.materialId,
          materialTitle: input.materialTitle,
          materialText: input.materialText,
          totalPages: input.totalPages,
          forceRefresh: input.forceRefresh || false,
        }),
      })

      if (!res.ok) throw new Error(`analyze ${res.status}`)
      const data = await res.json()
      if (!data.success || !data.intelligence) {
        throw new Error(data.error || 'Análisis falló')
      }

      intelligence = data.intelligence
      fromCacheAnalysis = data.fromCache || false
      console.log(`[V2Flow] Analyze OK: ${intelligence?.topics.length} topics${fromCacheAnalysis ? ' (cache)' : ''}`)
    } catch (err: any) {
      console.error('[V2Flow] Analyze error:', err.message)
      setState(prev => ({
        ...prev,
        phase: 'error',
        error: `Error analizando material: ${err.message}`,
      }))
      return
    }

    if (abortRef.current || !intelligence) return

    const analysisMs = Date.now() - analysisStart
    setState(prev => ({
      ...prev,
      intelligence,
      progress: 50,
      loadingMessage: `Material analizado (${intelligence!.topics.length} temas). Diseñando plan de estudio...`,
      stats: { fromCacheAnalysis, analysisMs },
    }))

    // ═══════════════════════════════════════════════════════════
    // FASE 2: CREATE PLAN
    // ═══════════════════════════════════════════════════════════
    setState(prev => ({ ...prev, phase: 'planning' }))

    let plan: StoredPlan | null = null
    let fromCachePlan = false
    const planStart = Date.now()

    try {
      const res = await fetch('/api/adaptive/v2/create-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: input.userId,
          materialId: input.materialId,
          profile: input.profile,
          setup: input.setup,
          forceRefresh: input.forceRefresh || false,
        }),
      })

      if (!res.ok) throw new Error(`create-plan ${res.status}`)
      const data = await res.json()
      if (!data.success || !data.plan) {
        throw new Error(data.error || 'Plan generation failed')
      }

      plan = data.plan
      fromCachePlan = data.fromCache || false
      console.log(`[V2Flow] Plan OK: ${plan?.sessions.length} sesiones${fromCachePlan ? ' (cache)' : ''}`)
    } catch (err: any) {
      console.error('[V2Flow] Plan error:', err.message)
      setState(prev => ({
        ...prev,
        phase: 'error',
        error: `Error creando plan: ${err.message}`,
      }))
      return
    }

    if (abortRef.current || !plan) return

    const planMs = Date.now() - planStart
    const totalMs = Date.now() - totalStart

    // ═══════════════════════════════════════════════════════════
    // FASE 3: READY
    // ═══════════════════════════════════════════════════════════
    setState({
      phase: 'ready',
      intelligence,
      plan,
      error: null,
      loadingMessage: '',
      progress: 100,
      stats: {
        fromCacheAnalysis,
        fromCachePlan,
        analysisMs,
        planMs,
        totalMs,
      },
    })

    console.log(`[V2Flow] COMPLETO en ${totalMs}ms | analyze: ${analysisMs}ms | plan: ${planMs}ms`)
  }, [])

  const reset = useCallback(() => {
    abortRef.current = true
    setState({
      phase: 'idle',
      intelligence: null,
      plan: null,
      error: null,
      loadingMessage: '',
      progress: 0,
      stats: {},
    })
  }, [])

  return {
    ...state,
    runFullFlow,
    reset,
  }
}
