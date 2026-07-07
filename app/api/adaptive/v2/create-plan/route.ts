// ═══════════════════════════════════════════════════════════════
// /api/adaptive/v2/create-plan
// 
// Toma MaterialIntelligence + StudentModel + StudyGoal
// y genera el plan de sesiones (SessionBlueprint[]).
// Guarda el plan en R2. Devuelve el plan completo.
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createSessionPlan } from '../../../../../lib/adaptive/v2/agents/planner'
import { loadIntelligence } from '../../../../../lib/adaptive/v2/storage/intelligence'
import { savePlan, loadPlan, type StoredPlan } from '../../../../../lib/adaptive/v2/storage/plan'
import { buildStudyGoal, buildInitialStudentModel } from '../../../../../lib/adaptive/v2/contracts'

export const maxDuration = 60

// ═══════════════════════════════════════════════════════════════
// POST — Crear plan de sesiones
// ═══════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      userId,
      materialId,
      profile,
      setup,
      forceRefresh = false,
    } = body

    if (!userId || !materialId) {
      return NextResponse.json(
        { success: false, error: 'userId y materialId son requeridos' },
        { status: 400 }
      )
    }

    // ── 1. Verificar cache del plan ─────────────────────────────
    if (!forceRefresh) {
      const cachedPlan = await loadPlan(userId, materialId)
      if (cachedPlan) {
        return NextResponse.json({
          success: true,
          plan: cachedPlan,
          fromCache: true,
        })
      }
    }

    // ── 2. Cargar intelligence del material ─────────────────────
    const intelligence = await loadIntelligence(userId, materialId)
    if (!intelligence) {
      return NextResponse.json(
        {
          success: false,
          error: 'El material no ha sido analizado. Llama primero a /api/adaptive/v2/analyze',
        },
        { status: 400 }
      )
    }

    // ── 3. Construir student model y goal ───────────────────────
    if (!profile || !setup) {
      return NextResponse.json(
        { success: false, error: 'profile y setup son requeridos para crear el plan' },
        { status: 400 }
      )
    }

    const student = buildInitialStudentModel(profile, setup)
    const goal = buildStudyGoal(setup)

    // ── 4. Ejecutar el Planner ──────────────────────────────────
    const result = await createSessionPlan(intelligence, student, goal)

    if (!result.success || result.sessions.length === 0) {
      return NextResponse.json({
        success: false,
        error: result.errors[0] || 'Falló la generación del plan',
        stats: result.stats,
      }, { status: 500 })
    }

    // ── 5. Construir y guardar el plan ──────────────────────────
    const now = Date.now()
    const storedPlan: StoredPlan = {
      planId: `plan_${userId}_${materialId}_${now}`,
      userId,
      materialId,
      materialTitle: intelligence.materialTitle,
      sessions: result.sessions,
      strategy: result.strategy,
      createdAt: now,
      updatedAt: now,
      currentSessionIndex: 0,
      completedSessionIds: [],
    }

    try {
      await savePlan(storedPlan)
    } catch (err: any) {
      console.error('[create-plan] Error guardando plan:', err.message)
    }

    return NextResponse.json({
      success: true,
      plan: storedPlan,
      fromCache: false,
      stats: result.stats,
    })

  } catch (err: any) {
    console.error('[create-plan]', err.message, err.stack)
    return NextResponse.json({
      success: false,
      error: err.message,
    }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════
// GET — Consultar plan existente
// ═══════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const materialId = searchParams.get('materialId')

    if (!userId || !materialId) {
      return NextResponse.json(
        { success: false, error: 'userId y materialId son requeridos' },
        { status: 400 }
      )
    }

    const plan = await loadPlan(userId, materialId)
    return NextResponse.json({
      success: true,
      exists: !!plan,
      plan,
    })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
