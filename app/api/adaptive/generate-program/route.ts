import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest, safeParseJson } from '../../../../lib/alai'
import type {
  AdaptiveProgram,
  AdaptiveSession,
  AdaptiveStep,
  AdaptiveProgramSetup,
  SessionPurpose,
} from '../../../../lib/adaptive/program'

export const maxDuration = 60

// ── Días hasta examen ────────────────────────────────────────────
function getDaysToExam(examDate: string | null): number {
  if (!examDate) return 14
  const map: Record<string, number> = {
    today: 0, tomorrow: 1, in_3_days: 3, in_1_week: 7,
    in_2_weeks: 14, in_1_month: 30, no_exam: 90,
  }
  return map[examDate] ?? 14
}

// ── Calcular sesiones según urgencia ────────────────────────────
function calcSessionCount(
  daysToExam: number,
  totalUnits: number,
  sessionLength: string,
): number {
  const unitsPerSession = sessionLength === 'long' ? 3 : sessionLength === 'short' ? 1.5 : 2
  const base = Math.ceil(totalUnits / unitsPerSession)
  if (daysToExam === 0) return Math.max(1, Math.min(base, 3))
  if (daysToExam === 1) return Math.max(2, Math.min(base, 4))
  if (daysToExam <= 3) return Math.max(2, Math.min(base, 5))
  if (daysToExam <= 7) return Math.max(3, Math.min(base, 7))
  if (daysToExam <= 14) return Math.max(4, Math.min(base, 10))
  return Math.max(4, Math.min(base, 14))
}

// ── Propósito de sesión según posición ──────────────────────────
function getSessionPurpose(
  idx: number,
  total: number,
  targetScore: number,
): SessionPurpose {
  if (total <= 2) {
    if (idx === 0) return 'understand'
    return targetScore >= 90 ? 'apply' : 'simulate'
  }
  const pct = idx / (total - 1)
  if (pct < 0.3) return 'understand'
  if (pct < 0.55) return 'organize'
  if (pct < 0.75) return 'apply'
  if (pct < 0.9) return 'memorize'
  return 'simulate'
}

// ── Generar steps básicos para una sesión ───────────────────────
function buildSessionSteps(
  purpose: SessionPurpose,
  concepts: string[],
  sessionLength: string,
): AdaptiveStep[] {
  const stepCount = sessionLength === 'short' ? 3 : sessionLength === 'long' ? 6 : 4
  const steps: AdaptiveStep[] = []

  // Paso 1: siempre explicación
  steps.push({
    id: `step_explain_${Date.now()}_0`,
    type: 'explain',
    engine: 'repasar',
    title: 'Entender el concepto',
    instruction: `Explica los conceptos principales: ${concepts.slice(0, 2).join(', ')}`,
    estimatedMinutes: 5,
    evidenceRequired: false,
    status: 'pending',
    conceptsTargeted: concepts.slice(0, 2),
  })

  // Paso 2: flashcards o quiz según purpose
  if (purpose === 'memorize' || purpose === 'understand') {
    steps.push({
      id: `step_flash_${Date.now()}_1`,
      type: 'micro_flashcards',
      engine: 'flashcards',
      title: 'Anclar en memoria',
      instruction: 'Tarjetas de los conceptos clave',
      estimatedMinutes: 5,
      evidenceRequired: false,
      status: 'pending',
      conceptsTargeted: concepts,
    })
  }

  // Paso 3: recall activo
  steps.push({
    id: `step_recall_${Date.now()}_2`,
    type: 'active_recall',
    engine: 'alai',
    title: 'Comprobar comprensión',
    instruction: 'Explica con tus propias palabras lo que aprendiste',
    estimatedMinutes: 4,
    evidenceRequired: true,
    status: 'pending',
    conceptsTargeted: concepts,
  })

  // Paso 4: quiz
  if (stepCount >= 4) {
    steps.push({
      id: `step_quiz_${Date.now()}_3`,
      type: 'micro_quiz',
      engine: 'quiz',
      title: 'Evaluar comprensión',
      instruction: 'Preguntas de verificación del material',
      estimatedMinutes: 5,
      evidenceRequired: true,
      status: 'pending',
      conceptsTargeted: concepts,
    })
  }

  // Paso 5-6: para sesiones largas
  if (stepCount >= 5 && (purpose === 'apply' || purpose === 'simulate')) {
    steps.push({
      id: `step_case_${Date.now()}_4`,
      type: 'case_study',
      engine: 'quiz',
      title: 'Aplicar en caso práctico',
      instruction: 'Resuelve un caso aplicando los conceptos',
      estimatedMinutes: 7,
      evidenceRequired: true,
      status: 'pending',
      conceptsTargeted: concepts,
    })
  }

  if (stepCount >= 6) {
    steps.push({
      id: `step_meta_${Date.now()}_5`,
      type: 'metacognition',
      engine: 'alai',
      title: 'Reflexión final',
      instruction: 'Reflexiona sobre lo que aprendiste hoy',
      estimatedMinutes: 3,
      evidenceRequired: false,
      status: 'pending',
    })
  }

  return steps
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      materialId,
      materialTitle = 'Material',
      materialContent,
      mastery,
      setup,
      learningMemory,
      userProfile,
      // Nuevos campos del flujo adaptativo real
      analysis,
      diagnosticResult,
    } = body

    if (!materialContent || materialContent.trim().length < 50) {
      return NextResponse.json(
        { success: false, error: 'Material insuficiente' },
        { status: 400 }
      )
    }

    const daysToExam = getDaysToExam(setup?.examDate || null)
    const sessionLength = setup?.sessionLength || 'medium'
    const targetScore = Number(setup?.targetScore) || 80
    const knowledgeLevel = setup?.initialKnowledgeLevel || 'some'

    const isUrgent = daysToExam <= 1
    const estimatedLevel = diagnosticResult?.estimatedLevel || knowledgeLevel

    // ── Usar análisis previo si existe, o generar uno básico ──────
    let coverageUnits: any[] = []
    let concepts: any[] = []
    let subjectArea = 'general'

    if (analysis?.totalCoverageUnits?.length > 0) {
      coverageUnits = analysis.totalCoverageUnits
      concepts = analysis.concepts || []
      subjectArea = analysis.subjectArea || 'general'
    } else {
      // Análisis básico desde el contenido
      const analyzeRes = await fetch(
        `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/adaptive/analyze-material`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            materialText: materialContent.slice(0, 12000),
            materialTitle,
            materialIds: [materialId],
          }),
        }
      )

      if (analyzeRes.ok) {
        const analyzeData = await analyzeRes.json()
        if (analyzeData.success && analyzeData.analysis) {
          coverageUnits = analyzeData.analysis.totalCoverageUnits || []
          concepts = analyzeData.analysis.concepts || []
          subjectArea = analyzeData.analysis.subjectArea || 'general'
        }
      }
    }

    const totalUnits = coverageUnits.length || 5
    const sessionCount = calcSessionCount(daysToExam, totalUnits, sessionLength)

    // ── Generar plan de sesiones con ALAI ────────────────────────
    const urgencyNote = isUrgent
      ? `URGENTE — examen en ${daysToExam === 0 ? 'HORAS' : '1 DÍA'}. Comprimir al máximo sin eliminar contenido.`
      : daysToExam <= 7
      ? 'Tiempo limitado. Ser eficiente.'
      : 'Hay tiempo. Puede ser profundo.'

    const unitsList = coverageUnits
      .slice(0, 15)
      .map((u: any) => `- ${u.id}: "${u.title}" [${u.importance}]`)
      .join('\n')

    const conceptList = concepts
      .slice(0, 10)
      .map((c: any) => c.name)
      .join(', ')

    const prompt = `Diseña un plan de ${sessionCount} sesiones de estudio.

REGLA ABSOLUTA: El 100% del contenido debe estar cubierto. NUNCA eliminar temas.

MATERIAL: "${materialTitle}"
ÁREA: ${subjectArea}
NIVEL DEL ESTUDIANTE: ${estimatedLevel}
OBJETIVO: ${targetScore}%
${urgencyNote}

UNIDADES A CUBRIR (TODAS):
${unitsList || 'El material completo'}

CONCEPTOS CLAVE: ${conceptList || 'los del material'}

Para cada sesión devuelve:
- title: título pedagógico
- purpose: understand|organize|memorize|apply|simulate|repair
- objective: qué logrará el estudiante
- topicTitle: tema principal de la sesión
- targetConcepts: array de 2-4 conceptos clave
- coverageUnitIds: array de ids de unidades cubiertas
- expectedDomainGain: puntos de dominio esperados (5-25)
- planRationale: por qué esta estructura

La sesión ${sessionCount} siempre debe ser de repaso o simulación.
Si el examen es urgente, comprimir sin eliminar temas.

Devuelve SOLO JSON:
{
  "sessions": [
    {
      "title": "string",
      "purpose": "understand",
      "objective": "string",
      "topicTitle": "string",
      "targetConcepts": ["concepto1"],
      "coverageUnitIds": ["unit_1"],
      "expectedDomainGain": 15,
      "planRationale": "string"
    }
  ],
  "strategy": {
    "why": "Explicación en español de por qué ALAI eligió esta ruta",
    "goals": ["Meta 1", "Meta 2"],
    "projectedDomain": [0, 20, 40, 60, 80, 100],
    "conflictDetected": false,
    "conflictMessage": ""
  }
}`

    const planResult = await alaiRequest(async (client: any, modelFn: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 3000,
      })
      const rawText = res?.choices?.[0]?.message?.content || ''
      if (!rawText.trim()) throw new Error('ALAI_EMPTY_RESPONSE')
      return { text: rawText, provider: 'unknown', model: 'unknown' }
    })

    let planData = safeParseJson(planResult.text)
    if (!planData?.sessions) {
      const match = planResult.text.match(/\{[\s\S]*\}/)
      if (match) planData = safeParseJson(match[0])
    }

    if (!planData?.sessions || !Array.isArray(planData.sessions)) {
      // Fallback: generar plan básico sin IA
      planData = {
        sessions: Array.from({ length: Math.max(2, sessionCount) }, (_, i) => ({
          title: `Sesión ${i + 1} — ${materialTitle}`,
          purpose: getSessionPurpose(i, sessionCount, targetScore),
          objective: `Dominar los conceptos de la sesión ${i + 1}`,
          topicTitle: materialTitle,
          targetConcepts: concepts.slice(i * 2, i * 2 + 3).map((c: any) => c.name || c),
          coverageUnitIds: coverageUnits.slice(
            Math.floor((i / sessionCount) * coverageUnits.length),
            Math.floor(((i + 1) / sessionCount) * coverageUnits.length)
          ).map((u: any) => u.id),
          expectedDomainGain: Math.round(targetScore / sessionCount),
          planRationale: 'Plan generado automáticamente',
        })),
        strategy: {
          why: `Plan de ${sessionCount} sesiones para cubrir el material completo.`,
          goals: ['Cubrir todo el material', 'Alcanzar el objetivo'],
          projectedDomain: Array.from({ length: sessionCount + 1 }, (_, i) =>
            Math.round((i / sessionCount) * targetScore)
          ),
          conflictDetected: false,
          conflictMessage: '',
        },
      }
    }

    // ── Verificar cobertura del 100% ─────────────────────────────
    const allUnitIds = new Set(coverageUnits.map((u: any) => u.id))
    const coveredUnitIds = new Set<string>()
    planData.sessions.forEach((s: any) => {
      ;(s.coverageUnitIds || []).forEach((id: string) => coveredUnitIds.add(id))
    })

    // Agregar unidades faltantes a la última sesión
    const uncoveredIds = [...allUnitIds].filter(id => !coveredUnitIds.has(id))
    if (uncoveredIds.length > 0 && planData.sessions.length > 0) {
      const lastSession = planData.sessions[planData.sessions.length - 1]
      lastSession.coverageUnitIds = [
        ...(lastSession.coverageUnitIds || []),
        ...uncoveredIds,
      ]
      console.log(`[generate-program] ${uncoveredIds.length} unidades sin sesión → agregadas a última sesión`)
    }

    // ── Construir AdaptiveProgram en el formato que espera el sistema ──
    const now = Date.now()

    const sessions: AdaptiveSession[] = planData.sessions.map(
      (s: any, i: number) => {
        const purpose = (s.purpose || 'understand') as SessionPurpose
        const targetConcepts: string[] = s.targetConcepts || []
        const steps = buildSessionSteps(purpose, targetConcepts, sessionLength)

        return {
          id: `session_${i + 1}_${now}`,
          sessionNumber: i + 1,
          title: s.title || `Sesión ${i + 1}`,
          objective: s.objective || 'Dominar el contenido de esta sesión',
          estimatedMinutes:
            sessionLength === 'short'
              ? 12
              : sessionLength === 'long'
              ? 35
              : 22,
          status: (i === 0 ? 'available' : 'locked') as any,
          purpose,
          steps,
          expectedDomainGain: Number(s.expectedDomainGain) || 15,
          // Contexto del topic
          topicId: `topic_${i + 1}`,
          topicTitle: s.topicTitle || s.title || materialTitle,
          targetConcepts,
          sourcePages: [],
          evidenceGoal: `Demostrar comprensión de: ${targetConcepts.join(', ')}`,
          sessionFormat: purpose === 'simulate' ? 'exam_simulation' :
            purpose === 'apply' ? 'application' :
            purpose === 'memorize' ? 'memorization' :
            purpose === 'organize' ? 'deep_dive' : 'discovery',
          planRationale: s.planRationale || '',
          coverageUnitIds: s.coverageUnitIds || [],
        } as AdaptiveSession & { coverageUnitIds: string[] }
      }
    )

    // Blueprint mínimo para compatibilidad con el libro
    const blueprint = {
      materialId,
      materialTitle,
      validationPassed: true,
      subjectArea,
      topics: coverageUnits.slice(0, 15).map((u: any, i: number) => ({
        id: u.id || `topic_${i}`,
        title: u.title || `Tema ${i + 1}`,
        concepts: concepts
          .slice(i * 2, i * 2 + 3)
          .map((c: any) => ({
            name: c.name || c,
            definition: c.explanation || '',
            difficulty: c.difficulty || 50,
          })),
        difficulty: u.difficulty || 50,
        importance: u.importance === 'critical' ? 90 :
          u.importance === 'high' ? 70 :
          u.importance === 'low' ? 30 : 50,
        sourcePages: [],
      })),
      analyzedAt: now,
    }

    const programSetup: AdaptiveProgramSetup = {
      initialKnowledgeLevel: (setup?.initialKnowledgeLevel || 'some') as any,
      sessionLength: (setup?.sessionLength || 'medium') as any,
      targetScore,
      examDate: setup?.examDate || null,
      dailyMinutes: setup?.dailyMinutes || 45,
    }

    const program: AdaptiveProgram = {
      id: `program_${materialId}_${now}`,
      createdAt: now,
      updatedAt: now,
      materialIds: [materialId],
      setup: programSetup,
      status: 'active',
      sessions,
      currentSessionIndex: 0,
      materialBlueprint: blueprint,
      // NUEVO — guardar análisis completo para usar en sesiones
      materialAnalysis: analysis || null,
      strategy: planData.strategy || {
        why: `Plan de ${sessions.length} sesiones adaptado a tu nivel y tiempo disponible.`,
        goals: ['Cubrir el 100% del material', `Alcanzar ${targetScore}% de dominio`],
        projectedDomain: sessions.map((_, i) =>
          Math.round(((i + 1) / sessions.length) * targetScore)
        ),
        conflictDetected: false,
        conflictMessage: '',
      },
    }

    const coveredFinal = new Set<string>()
    sessions.forEach((s: any) => {
      ;(s.coverageUnitIds || []).forEach((id: string) => coveredFinal.add(id))
    })
    const coveragePct = allUnitIds.size > 0
      ? Math.round((coveredFinal.size / allUnitIds.size) * 100)
      : 100

    console.log(
      `[generate-program] ${sessions.length} sesiones | ${coveredFinal.size}/${allUnitIds.size} unidades (${coveragePct}%) | área: ${subjectArea}`
    )

    return NextResponse.json({
      success: true,
      program,
      blueprint,
      coveragePercent: coveragePct,
      analysis: analysis || { totalCoverageUnits: coverageUnits, concepts, subjectArea },
    })
  } catch (err: any) {
    console.error('[generate-program]', err.message)
    return NextResponse.json(
      { success: false, error: err.message || 'Error interno' },
      { status: 500 }
    )
  }
}
