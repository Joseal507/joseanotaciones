// ═══════════════════════════════════════════════════════════════
// /api/adaptive/v2/analyze
// 
// Endpoint público del análisis de material.
// Usa el orquestador (Chunker + Analyzer + Consolidator).
// Guarda resultado en R2. Devuelve MaterialIntelligence.
// 
// Comportamiento:
// - Si el análisis ya existe en R2 y no se pide refresh → lo devuelve del cache
// - Si no existe → ejecuta la orquesta completa y guarda
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { orchestrateAnalysis } from '../../../../../lib/adaptive/v2/agents/orchestrator'
import {
  loadIntelligence,
  saveIntelligence,
  loadIntelligenceMeta,
} from '../../../../../lib/adaptive/v2/storage/intelligence'

export const maxDuration = 120  // 2 minutos máx (materiales grandes)

// ═══════════════════════════════════════════════════════════════
// POST — Analizar material (o devolver cache)
// ═══════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      userId,
      materialId,
      materialTitle,
      materialText,
      totalPages,
      forceRefresh = false,
    } = body

    if (!userId || !materialId) {
      return NextResponse.json(
        { success: false, error: 'userId y materialId son requeridos' },
        { status: 400 }
      )
    }

    // ── 1. Intentar cargar de cache ─────────────────────────────
    if (!forceRefresh) {
      const cached = await loadIntelligence(userId, materialId)
      if (cached) {
        return NextResponse.json({
          success: true,
          intelligence: cached,
          fromCache: true,
          stats: {
            totalTopics: cached.topics.length,
            totalFormulas: cached.formulas.length,
            totalProcedures: cached.procedures.length,
            analyzedAt: cached.analyzedAt,
          },
        })
      }
    }

    // ── 2. Validar que hay texto para analizar ──────────────────
    if (!materialText || materialText.trim().length < 100) {
      return NextResponse.json(
        { success: false, error: 'Material insuficiente (mínimo 100 caracteres)' },
        { status: 400 }
      )
    }

    // ── 3. Ejecutar orquesta ────────────────────────────────────
    const result = await orchestrateAnalysis({
      materialId,
      materialTitle: materialTitle || 'Material sin título',
      materialText,
      totalPages,
      maxParallel: 5,
    })

    if (!result.success || !result.intelligence) {
      return NextResponse.json({
        success: false,
        error: result.error || 'Falló el análisis',
        stats: result.stats,
      }, { status: 500 })
    }

    // ── 4. Guardar en R2 ────────────────────────────────────────
    try {
      await saveIntelligence(userId, materialId, result.intelligence)
    } catch (err: any) {
      console.error('[analyze] Error guardando en R2:', err.message)
      // No fallar la request si el save falla, devolver el análisis igual
    }

    return NextResponse.json({
      success: true,
      intelligence: result.intelligence,
      fromCache: false,
      stats: result.stats,
    })

  } catch (err: any) {
    console.error('[analyze]', err.message, err.stack)
    return NextResponse.json({
      success: false,
      error: err.message,
    }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════
// GET — Consultar si existe análisis + metadata
// ═══════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const materialId = searchParams.get('materialId')
    const includeContent = searchParams.get('full') === 'true'

    if (!userId || !materialId) {
      return NextResponse.json(
        { success: false, error: 'userId y materialId son requeridos' },
        { status: 400 }
      )
    }

    if (includeContent) {
      const intelligence = await loadIntelligence(userId, materialId)
      if (!intelligence) {
        return NextResponse.json({ success: true, exists: false })
      }
      return NextResponse.json({ success: true, exists: true, intelligence })
    }

    const meta = await loadIntelligenceMeta(userId, materialId)
    return NextResponse.json({
      success: true,
      exists: !!meta,
      meta,
    })

  } catch (err: any) {
    console.error('[analyze GET]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
