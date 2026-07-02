import { NextRequest, NextResponse } from 'next/server'
import { fetchAndBuildBlueprint } from '../../../../lib/adaptive/blueprintBuilder'
import { generateAdaptiveProgram } from '../../../../lib/adaptive/generator'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { materialId, materialTitle, materialContent, mastery, setup, learningMemory, userProfile } = body

    if (!materialContent || !setup) {
      return NextResponse.json({ success: false, error: 'Faltan materialContent o setup' }, { status: 400 })
    }

    // Fase 1: Blueprint
    const blueprint = await fetchAndBuildBlueprint({
      materialId: materialId || `mat_${Date.now()}`,
      materialTitle: materialTitle || 'Material',
      materialContent,
    })

    // Fase 2: Programa
    const program = await generateAdaptiveProgram(
      mastery || null,
      setup,
      blueprint,
      learningMemory || null,
      userProfile || null,
    )

    return NextResponse.json({ success: true, blueprint, program })
  } catch (err: any) {
    console.error('[generate-program] Error:', err?.message)
    return NextResponse.json({ success: false, error: err?.message }, { status: 500 })
  }
}
