// ═══════════════════════════════════════════════════════════════
// /api/adaptive/v3/build-graph
// 
// Endpoint para construir el KnowledgeGraph de un material.
// Usa cache en R2 (no reconstruye si ya existe).
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { buildKnowledgeGraph } from '../../../../../lib/adaptive/v3/graph/orchestrator'
import { loadGraph, saveGraph } from '../../../../../lib/adaptive/v3/storage/graphStorage'

export const maxDuration = 180  // 3 minutos máx para materiales grandes

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, materialId, materialTitle, materialText, subjectHint, forceRefresh = false } = body

    if (!userId || !materialId) {
      return NextResponse.json({ success: false, error: 'userId y materialId requeridos' }, { status: 400 })
    }

    // 1. Intentar cache
    if (!forceRefresh) {
      const cached = await loadGraph(userId, materialId)
      if (cached) {
        return NextResponse.json({
          success: true,
          graph: cached,
          fromCache: true,
          stats: {
            totalMicros: cached.totalMicros,
            totalDependencies: cached.totalDependencies,
            topicGroups: cached.topicGroups.length,
            estimatedMinutes: cached.estimatedTotalMinutes,
          },
        })
      }
    }

    // 2. Validar material
    if (!materialText || materialText.trim().length < 100) {
      return NextResponse.json({ success: false, error: 'Material insuficiente' }, { status: 400 })
    }

    // 3. Ejecutar orquesta
    const result = await buildKnowledgeGraph({
      materialId,
      materialTitle: materialTitle || 'Material',
      materialText,
      subjectHint,
    })

    if (!result.success || !result.graph) {
      return NextResponse.json({
        success: false,
        error: result.error || 'Falló construcción del grafo',
        stats: result.stats,
      }, { status: 500 })
    }

    // 4. Guardar en R2
    try {
      await saveGraph(userId, materialId, result.graph)
    } catch (err: any) {
      console.error('[build-graph] Error guardando:', err.message)
    }

    return NextResponse.json({
      success: true,
      graph: result.graph,
      fromCache: false,
      stats: result.stats,
    })

  } catch (err: any) {
    console.error('[build-graph]', err.message, err.stack)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════
// GET — Consultar grafo existente
// ═══════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const materialId = searchParams.get('materialId')

    if (!userId || !materialId) {
      return NextResponse.json({ success: false, error: 'userId y materialId requeridos' }, { status: 400 })
    }

    const graph = await loadGraph(userId, materialId)
    return NextResponse.json({
      success: true,
      exists: !!graph,
      graph,
    })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
