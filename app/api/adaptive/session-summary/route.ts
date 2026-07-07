import { NextRequest, NextResponse } from 'next/server'
import type { AdaptiveSessionSummary } from '../../../../lib/adaptive/types'

export const maxDuration = 30

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      sessionId,
      sessionNumber = 1,
      durationMinutes = 0,
      coverageUnitsCompleted = [],
      coverageUnitsTitles = [],
      totalUnitsInMaterial = 1,
      conceptsImproved = [],
      conceptsStillWeak = [],
      averageScore = 0,
      fatigueDetected = false,
      nextSessionTitle = '',
    } = body

    const totalCoveredSoFar = coverageUnitsCompleted.length
    const totalCoveragePercent = Math.round((totalCoveredSoFar / Math.max(totalUnitsInMaterial, 1)) * 100)

    const canSay = conceptsImproved.slice(0, 4).map((c: string) => `Explicar ${c}`)
    const stillWorking = conceptsStillWeak.slice(0, 3).map((c: string) => `Reforzando ${c}`)

    let motivationalMessage = ''
    if (averageScore >= 80) {
      motivationalMessage = 'Excelente sesión. Tu comprensión de este material es sólida.'
    } else if (averageScore >= 60) {
      motivationalMessage = 'Buen avance. Hay algunos puntos que vamos a reforzar en la próxima sesión.'
    } else {
      motivationalMessage = 'Esta fue una sesión de base. Lo que no quedó claro hoy, lo trabajaremos en la siguiente sesión.'
    }

    const summary: AdaptiveSessionSummary = {
      sessionId,
      sessionNumber,
      durationMinutes,
      coverageUnitsCovered: coverageUnitsCompleted,
      coverageUnitsTitles,
      totalCoveragePercent,
      conceptsImproved,
      conceptsStillWeak,
      averageScore,
      fatigueDetected,
      nextSessionPreview: nextSessionTitle || 'Continuar con el plan',
      motivationalMessage,
      canSay,
      stillWorking,
    }

    return NextResponse.json({ success: true, summary })

  } catch (err: any) {
    console.error('[session-summary]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
