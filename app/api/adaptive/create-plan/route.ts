import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest, safeParseJson } from '../../../../lib/alai'
import type {
  MaterialAnalysis,
  StudentIntake,
  AdaptiveProgramPlan,
  AdaptiveSessionPlan,
} from '../../../../lib/adaptive/types'

export const maxDuration = 60

// Días hasta el examen
function getDaysFromExamDate(examDate: string): number {
  const map: Record<string, number> = {
    today: 0,
    tomorrow: 1,
    in_3_days: 3,
    in_1_week: 7,
    in_2_weeks: 14,
    in_1_month: 30,
    no_exam: 90,
  }
  return map[examDate] ?? 14
}

// Número de sesiones según urgencia y nivel
function calculateSessionCount(
  daysToExam: number,
  totalUnits: number,
  sessionMinutes: number,
  selfReportedLevel: string,
  diagnosticLevel: string,
): number {
  const unitsPerSession = sessionMinutes >= 35 ? 3 : sessionMinutes >= 20 ? 2 : 1.5
  const baseNeeded = Math.ceil(totalUnits / unitsPerSession)

  if (daysToExam === 0) return Math.min(baseNeeded, 3)    // hoy: máximo 3 sesiones comprimidas
  if (daysToExam === 1) return Math.min(baseNeeded, 4)    // mañana: máximo 4
  if (daysToExam <= 3) return Math.min(baseNeeded, 5)
  if (daysToExam <= 7) return Math.min(baseNeeded, 7)
  if (daysToExam <= 14) return Math.min(baseNeeded, 10)
  return Math.min(baseNeeded, 15)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      analysis,
      intake,
      diagnosticResult,
    }: {
      analysis: MaterialAnalysis
      intake: StudentIntake
      diagnosticResult?: any
    } = body

    if (!analysis || !intake) {
      return NextResponse.json({ success: false, error: 'Faltan datos' }, { status: 400 })
    }

    const daysToExam = getDaysFromExamDate(intake.examDate)
    const isUrgent = daysToExam <= 1
    const estimatedLevel = diagnosticResult?.estimatedLevel || intake.selfReportedLevel
    const totalUnits = analysis.totalCoverageUnits.length

    const sessionCount = calculateSessionCount(
      daysToExam,
      totalUnits,
      intake.sessionDurationMinutes,
      intake.selfReportedLevel,
      estimatedLevel,
    )

    const urgencyNote = isUrgent
      ? `URGENTE: El examen es ${daysToExam === 0 ? 'HOY' : 'MAÑANA'}. 
REGLA CRÍTICA: Comprimir la enseñanza pero NUNCA eliminar contenido.
Cada sesión debe cubrir más unidades. Ir directo al grano. Sin decoración.`
      : daysToExam <= 7
      ? 'Tiempo limitado. Ir eficiente pero sin saltarse contenido.'
      : 'Hay tiempo suficiente. Puede profundizar más en cada sesión.'

    const targetNote = intake.targetGrade === '100'
      ? 'El estudiante quiere dominio COMPLETO. Cada concepto debe estar cubierto con profundidad suficiente para aplicarlo en cualquier contexto.'
      : intake.targetGrade === 'pass'
      ? 'El estudiante quiere aprobar. Priorizar los conceptos críticos y de alta importancia.'
      : `El estudiante quiere ${intake.targetGrade}. Balance entre cobertura y profundidad.`

    const levelNote = estimatedLevel === 'zero' || intake.selfReportedLevel === 'zero'
      ? 'NIVEL CERO: Empezar desde fundamentos absolutos. Nunca asumir conocimiento previo.'
      : estimatedLevel === 'basic'
      ? 'NIVEL BÁSICO: Cubrir fundamentos antes de avanzar.'
      : estimatedLevel === 'advanced'
      ? 'NIVEL AVANZADO: Puede ir más rápido en conceptos que ya demostró dominar.'
      : 'NIVEL INTERMEDIO: Balance entre refuerzo y contenido nuevo.'

    const unitsList = analysis.totalCoverageUnits
      .map(u => `- ${u.id}: "${u.title}" [${u.importance}] [${u.knowledgeType}]`)
      .join('\n')

    const prompt = `Eres un planificador pedagógico experto. Diseña un plan de sesiones de estudio.

REGLA ABSOLUTA QUE NUNCA PUEDES ROMPER:
El 100% de las unidades de cobertura DEBE aparecer en el plan. No puedes omitir NINGUNA.
Solo cambia cómo se enseña. Nunca qué se enseña.

MATERIAL: "${analysis.materialTitle}"
ÁREA: ${analysis.subjectArea}
TOTAL DE UNIDADES: ${totalUnits}
SESIONES DISPONIBLES: ${sessionCount}
MINUTOS POR SESIÓN: ${intake.sessionDurationMinutes}

${urgencyNote}
${targetNote}
${levelNote}

UNIDADES QUE DEBEN CUBRIRSE (TODAS):
${unitsList}

REGLAS DEL PLAN:
1. Cada unidad debe aparecer en exactamente UNA sesión principal
2. Las unidades críticas van en las primeras sesiones
3. Las unidades de memorización van después de las conceptuales
4. Los procesos van después de sus conceptos base
5. La última sesión siempre es de repaso/simulación
6. Si el examen es hoy o mañana: comprimir pero cubrir todo en las pocas sesiones disponibles

Devuelve SOLO este JSON:
{
  "sessions": [
    {
      "id": "session_1",
      "sessionNumber": 1,
      "title": "Título claro de la sesión",
      "sessionType": "learning|practice|integration|simulation|review|repair",
      "objectives": ["Objetivo 1", "Objetivo 2"],
      "coverageUnitIds": ["unit_1", "unit_2"],
      "teachingStrategy": "Descripción de cómo enseñar este contenido",
      "assessmentStrategy": "Cómo evaluar que aprendió",
      "retentionItems": [],
      "estimatedMinutes": ${intake.sessionDurationMinutes}
    }
  ],
  "strategySummary": "Descripción en 2-3 oraciones de la estrategia general",
  "warnings": []
}`

    const result = await alaiRequest(async (client: any, modelFn: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4000,
      })
      const rawText = res?.choices?.[0]?.message?.content || ''
      if (!rawText.trim()) throw new Error('ALAI_EMPTY_RESPONSE')
      return { text: rawText, provider: 'unknown', model: 'unknown' }
    })

    let parsed = safeParseJson(result.text)
    if (!parsed?.sessions) {
      const match = result.text.match(/\{[\s\S]*\}/)
      if (match) parsed = safeParseJson(match[0])
    }

    if (!parsed?.sessions || !Array.isArray(parsed.sessions)) {
      return NextResponse.json({ success: false, error: 'No se pudo generar el plan' }, { status: 500 })
    }

    // Verificar cobertura del 100%
    const allUnitIds = new Set(analysis.totalCoverageUnits.map(u => u.id))
    const coveredUnitIds = new Set<string>()
    parsed.sessions.forEach((s: any) => {
      (s.coverageUnitIds || []).forEach((id: string) => coveredUnitIds.add(id))
    })

    // Unidades no cubiertas — agregarlas a la última sesión
    const uncoveredUnits = analysis.totalCoverageUnits.filter(u => !coveredUnitIds.has(u.id))
    if (uncoveredUnits.length > 0) {
      console.warn(`[create-plan] ${uncoveredUnits.length} unidades no cubiertas — agregando a última sesión`)
      const lastSession = parsed.sessions[parsed.sessions.length - 1]
      if (lastSession) {
        lastSession.coverageUnitIds = [
          ...(lastSession.coverageUnitIds || []),
          ...uncoveredUnits.map(u => u.id),
        ]
      }
    }

    // Construir el plan final
    const sessions: AdaptiveSessionPlan[] = parsed.sessions.map((s: any, i: number) => ({
      id: s.id || `session_${i + 1}`,
      sessionNumber: i + 1,
      title: s.title || `Sesión ${i + 1}`,
      estimatedMinutes: Number(s.estimatedMinutes) || intake.sessionDurationMinutes,
      objectives: s.objectives || [],
      coverageUnitIds: s.coverageUnitIds || [],
      conceptIds: s.conceptIds || [],
      teachingStrategy: s.teachingStrategy || '',
      assessmentStrategy: s.assessmentStrategy || '',
      retentionItems: s.retentionItems || [],
      sessionType: s.sessionType || 'learning',
    }))

    // Mapa de cobertura
    const coverageMap: Record<string, string> = {}
    sessions.forEach(session => {
      session.coverageUnitIds.forEach(unitId => {
        coverageMap[unitId] = session.id
      })
    })

    const plan: AdaptiveProgramPlan = {
      planId: `plan_${Date.now()}`,
      totalCoverageRequired: 100,
      estimatedSessions: sessions,
      coverageMap,
      strategySummary: parsed.strategySummary || '',
      warnings: parsed.warnings || [],
      createdAt: Date.now(),
      examDate: intake.examDate,
      targetGrade: intake.targetGrade,
    }

    const finalCoveredCount = new Set(Object.keys(coverageMap)).size
    const coveragePct = Math.round((finalCoveredCount / totalUnits) * 100)

    console.log(`[create-plan] ${sessions.length} sesiones | ${finalCoveredCount}/${totalUnits} unidades (${coveragePct}%)`)

    return NextResponse.json({ success: true, plan, coveragePercent: coveragePct })

  } catch (err: any) {
    console.error('[create-plan]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
