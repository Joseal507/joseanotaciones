import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest, safeParseJson } from '../../../../lib/alai'
import type {
  AdaptiveProgram,
  AdaptiveSession,
  AdaptiveStep,
  AdaptiveProgramSetup,
  SessionPurpose,
} from '../../../../lib/adaptive/program'
import { loadGraph, saveGraph } from '../../../../lib/adaptive/v3/storage/graphStorage'
import { buildKnowledgeGraph } from '../../../../lib/adaptive/v3/graph/orchestrator'
import { saveQuestionBank } from '../../../../lib/adaptive/v3/storage/questionBankStorage'

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

// ── Calcular sesiones según urgencia Y tamaño del material ─────
function calcSessionCount(
  daysToExam: number,
  totalUnits: number,
  sessionLength: string,
  materialPages: number = 0,
  materialChars: number = 0,
): number {
  const unitsPerSession = sessionLength === 'long' ? 3 : sessionLength === 'short' ? 1.5 : 2

  // Estimar páginas desde chars si no se pasaron
  const estimatedPages = materialPages > 0 ? materialPages : Math.ceil(materialChars / 1600)

  // Factor de complejidad por tamaño del material:
  // 1-5 páginas  → factor 1.0 (base)
  // 6-15 páginas → factor 1.5
  // 16-30 páginas → factor 2.0
  // 31-50 páginas → factor 2.5
  // 50+ páginas  → factor 3.0
  const sizeFactor =
    estimatedPages <= 5  ? 1.0 :
    estimatedPages <= 15 ? 1.5 :
    estimatedPages <= 30 ? 2.0 :
    estimatedPages <= 50 ? 2.5 : 3.0

  // Base de sesiones: si hay chars, usar tiempo estimado (1min/300chars densos)
  // Si no, usar unidades de cobertura como fallback
  const estimatedMinutes = materialChars > 0 ? Math.ceil(materialChars / 300) : 0
  const base = estimatedMinutes > 0
    ? Math.ceil(estimatedMinutes / unitsPerSession / 5)  // ~5min por unidad de sesión
    : Math.ceil((totalUnits / unitsPerSession) * sizeFactor)

  // Caps por urgencia del examen
  if (daysToExam === 0) return Math.max(1, Math.min(base, 3))
  if (daysToExam === 1) return Math.max(2, Math.min(base, 5))
  if (daysToExam <= 3) return Math.max(2, Math.min(base, 7))
  if (daysToExam <= 7) return Math.max(3, Math.min(base, 10))
  if (daysToExam <= 14) return Math.max(4, Math.min(base, 15))
  return Math.max(4, Math.min(base, 25))
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
    const targetScore = (setup?.targetScore != null && Number(setup.targetScore) > 0)
      ? Math.min(100, Math.max(1, Number(setup.targetScore)))
      : 80
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
    const totalConcepts = concepts.length || totalUnits
    // Mínimo de sesiones: cada sesión cubre ~2 micros para nivel zero
    // + 1 sesión de examen al final
    const microsPerSession = sessionLength === 'long' ? 3 : sessionLength === 'short' ? 1 : 2
    const minSessions = Math.ceil(totalConcepts / microsPerSession) + 1  // +1 para examen
    const sessionCount = Math.max(minSessions, 3)  // mínimo 3 sesiones siempre

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

    const prompt = `Diseña un plan de EXACTAMENTE ${sessionCount} sesiones de estudio.

REGLA ABSOLUTA #1: Debes generar EXACTAMENTE ${sessionCount} sesiones. Ni más, ni menos.
REGLA ABSOLUTA #2: El 100% del contenido debe estar cubierto. NUNCA eliminar temas.
REGLA ABSOLUTA #3: Cada concepto del material debe aparecer en al menos una sesión.

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

    // Validar que el LLM generó el número correcto de sesiones
    if (planData?.sessions && Array.isArray(planData.sessions) && planData.sessions.length < sessionCount) {
      console.warn(`[generate-program] LLM generó ${planData.sessions.length} sesiones pero se pidieron ${sessionCount} — rellenando`)
      // Rellenar con sesiones adicionales distribuyendo las unidades faltantes
      const existingUnitIds = new Set(planData.sessions.flatMap((s: any) => s.coverageUnitIds || []))
      const missingUnits = coverageUnits.filter((u: any) => !existingUnitIds.has(u.id))
      while (planData.sessions.length < sessionCount - 1 && missingUnits.length > 0) {
        const chunk = missingUnits.splice(0, 2)
        planData.sessions.splice(planData.sessions.length - 1, 0, {
          title: chunk.map((u: any) => u.title).join(' y '),
          purpose: 'understand',
          objective: `Aprender: ${chunk.map((u: any) => u.title).join(', ')}`,
          topicTitle: chunk[0]?.title || 'Contenido adicional',
          targetConcepts: chunk.map((u: any) => u.title),
          coverageUnitIds: chunk.map((u: any) => u.id),
          expectedDomainGain: 15,
        })
      }
      // La última siempre es de simulación/repaso
      if (planData.sessions.length < sessionCount) {
        planData.sessions.push({
          title: 'Repaso y simulación final',
          purpose: 'simulate',
          objective: 'Simular el examen y repasar todos los conceptos',
          topicTitle: 'Repaso completo',
          targetConcepts: concepts.slice(0, 4).map((c: any) => c.name || c),
          coverageUnitIds: coverageUnits.map((u: any) => u.id),
          expectedDomainGain: 10,
        })
      }
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

    // Distribuir unidades faltantes de forma equilibrada entre sesiones
    const uncoveredIds = [...allUnitIds].filter(id => !coveredUnitIds.has(id))
    if (uncoveredIds.length > 0 && planData.sessions.length > 0) {
      // Preferir sesiones que no son de simulación final
      const candidateSessions = planData.sessions
        .map((s: any, idx: number) => ({ s, idx }))
        .filter(({ s }: any) => (s.purpose || 'understand') !== 'simulate')

      const targetPool = candidateSessions.length > 0
        ? candidateSessions
        : planData.sessions.map((s: any, idx: number) => ({ s, idx }))

      for (const unitId of uncoveredIds) {
        // Asignar a la sesión con menor carga actual
        targetPool.sort((a: any, b: any) => {
          const aLoad = (a.s.coverageUnitIds || []).length
          const bLoad = (b.s.coverageUnitIds || []).length
          if (aLoad !== bLoad) return aLoad - bLoad
          return a.idx - b.idx
        })
        const target = targetPool[0]
        target.s.coverageUnitIds = [
          ...(target.s.coverageUnitIds || []),
          unitId,
        ]
      }

      console.log(`[generate-program] ${uncoveredIds.length} unidades sin sesión → distribuidas entre ${targetPool.length} sesiones`)
    }

    // ── Cargar o construir grafo v3 para asignar microIds deterministas a cada sesión ──
    let graphMicros: any[] = []
    const effectiveUserId = userProfile?.userId || (mastery as any)?.userId || null

    if (!effectiveUserId) {
      throw new Error('No se puede generar un programa seguro sin userId para construir/cargar el grafo')
    }

    if (!materialId) {
      throw new Error('No se puede generar un programa seguro sin materialId')
    }

    try {
      let graph = await loadGraph(effectiveUserId, materialId)

      // Si no existe grafo, construirlo on-the-fly ahora mismo
      if (!graph) {
        console.log('[generate-program] Grafo no encontrado — construyendo on-the-fly')
        const built = await buildKnowledgeGraph({
          materialId,
          materialTitle,
          materialText: materialContent,
          subjectHint: subjectArea,
        })

        if (!built.success || !built.graph) {
          throw new Error(built.error || 'No se pudo construir el grafo del material')
        }

        graph = built.graph
        try {
          await saveGraph(effectiveUserId, materialId, graph)
          if (built.questionBank && Object.keys(built.questionBank).length > 0) {
            await saveQuestionBank(effectiveUserId, materialId, built.questionBank)
          }
        } catch (saveErr: any) {
          console.warn('[generate-program] Grafo construido pero no se pudo guardar en R2:', saveErr.message)
        }
      }

      if (!graph || !graph.microConcepts || graph.microConcepts.length === 0) {
        throw new Error('El grafo no contiene microconceptos; no es seguro generar un programa')
      }

      graphMicros = graph.microConcepts
      console.log(`[generate-program] Grafo listo: ${graphMicros.length} micros para asignacion`)
    } catch (e: any) {
      throw new Error('[generate-program] No se pudo cargar ni construir el grafo: ' + (e.message || e))
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
          // ── Asignacion determinista de micros del grafo v3 ──
          assignedMicroIds: [],   // se rellena en la fase de asignacion determinista
          requiredMicroIds: [],   // se rellena en la fase de asignacion determinista
          retentionMicroIds: [],  // se rellena en la fase de asignacion determinista
        } as AdaptiveSession & { coverageUnitIds: string[] }
      }
    )

    // Variable para coverageAssignment — se llena en la fase 8/8 y se inyecta en program
    let coverageAssignmentMeta: any = null

    // ═══════════════════════════════════════════════════════════════
    // FASE DE ASIGNACIÓN DETERMINISTA 8/8
    // Garantiza que union(requiredMicroIds de teaching sessions) === allMicroIds
    // ═══════════════════════════════════════════════════════════════
    if (graphMicros.length > 0) {
      const allGraphIds: string[] = graphMicros.map((m: any) => m.id)

      const TEACHING_PURPOSES = new Set([
        'understand', 'organize', 'memorize', 'interpret', 'apply', 'deep_dive', 'teach',
      ])
      const NON_TEACHING_PURPOSES = new Set([
        'simulate', 'exam', 'review', 'repair',
      ])

      const normMicro = (str: string) => String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      // PASO 1: Asignar micros por matching semántico a sesiones de enseñanza
      const usedMicroIds = new Set<string>()

      for (const session of sessions) {
        const purpose = session.purpose || 'understand'
        if (!TEACHING_PURPOSES.has(purpose)) continue

        const sessionTerms = [
          ...(((session as any).coverageUnitIds || []) as string[]).map(normMicro),
          ...(session.targetConcepts || []).map(normMicro),
          normMicro(session.topicTitle || session.title || ''),
        ].filter(Boolean)

        const matched = graphMicros
          .filter((m: any) => {
            if (usedMicroIds.has(m.id)) return false
            const mName = normMicro(m.name || '')
            const mGroup = normMicro(m.topicGroup || '')
            return sessionTerms.some((term: string) =>
              term.length > 2 && (
                mGroup.includes(term) || term.includes(mGroup) ||
                mName.includes(term) || term.includes(mName)
              )
            )
          })
          .map((m: any) => m.id)

        ;(session as any).requiredMicroIds = matched
        ;(session as any).assignedMicroIds = matched
        matched.forEach((id: string) => usedMicroIds.add(id))
      }

      // PASO 2: Detectar micros huérfanos (no asignados a ninguna teaching session)
      const unassignedIds = allGraphIds.filter((id: string) => !usedMicroIds.has(id))

      // Guardar cuántos asignó el LLM antes del rescate
      const initiallyAssignedMicros = usedMicroIds.size

      if (unassignedIds.length > 0) {
        console.log(`[generate-program] ${unassignedIds.length} micros huérfanos — redistribuyendo (semánticamente)`)

        const teachingSessions = sessions
          .filter((s: any) => TEACHING_PURPOSES.has(s.purpose || 'understand'))
          .map((s: any) => ({
            session: s,
            load: ((s.requiredMicroIds as string[]) || []).length,
          }))

        for (const orphanId of unassignedIds) {
          const orphanMicro = graphMicros.find((m: any) => m.id === orphanId)
          let placed = false

          if (teachingSessions.length > 0) {
            // Prioridad de compatibilidad:
            // 1. topicGroup del micro coincide con términos de la sesión
            // 2. prerequisitos del micro ya están en la sesión
            // 3. coverageUnitIds similares
            // 4. menor carga (último recurso)
            const orphanName = normMicro(orphanMicro?.name || '')
            const orphanGroup = normMicro(orphanMicro?.topicGroup || '')
            const orphanPrereqs: string[] = orphanMicro?.prerequisites || []

            let bestScore = -1
            let bestIdx = 0

            teachingSessions.forEach((ts, idx) => {
              let score = 0
              const sTerms = [
                ...(((ts.session as any).coverageUnitIds || []) as string[]).map(normMicro),
                ...(ts.session.targetConcepts || []).map(normMicro),
                normMicro(ts.session.topicTitle || ts.session.title || ''),
              ].filter(Boolean)

              // Puntos por compatibilidad de topicGroup
              if (orphanGroup && sTerms.some(t => t.includes(orphanGroup) || orphanGroup.includes(t))) {
                score += 10
              }
              // Puntos por nombre del micro
              if (orphanName && sTerms.some(t => t.length > 3 && (t.includes(orphanName.slice(0,8)) || orphanName.includes(t.slice(0,8))))) {
                score += 6
              }
              // Puntos si los prerequisitos del micro ya están en esta sesión
              const sessionRequired: string[] = (ts.session as any).requiredMicroIds || []
              const prereqsInSession = orphanPrereqs.filter(pid => sessionRequired.includes(pid)).length
              score += prereqsInSession * 4
              // Penalizar por carga (menor carga = más espacio)
              score -= ts.load * 0.5

              if (score > bestScore) { bestScore = score; bestIdx = idx }
            })

            const best = teachingSessions[bestIdx]
            const req: string[] = (best.session as any).requiredMicroIds || []
            req.push(orphanId)
            ;(best.session as any).requiredMicroIds = req
            ;(best.session as any).assignedMicroIds = req
            best.load = req.length
            usedMicroIds.add(orphanId)
            placed = true
            console.log(`[generate-program] Huérfano '${orphanMicro?.name}' (score=${bestScore.toFixed(1)}) → '${best.session.title}'`)
          }

          if (!placed) {
            // Crear sesión nueva de cobertura si no hay teaching sessions
            const coverageSession: any = {
              id: `session_coverage_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
              sessionNumber: sessions.length + 1,
              title: 'Cobertura de conceptos adicionales',
              objective: 'Completar el estudio de todos los conceptos del material',
              estimatedMinutes: sessionLength === 'short' ? 12 : sessionLength === 'long' ? 35 : 22,
              status: 'locked',
              purpose: 'understand',
              steps: [],
              expectedDomainGain: 15,
              topicId: `topic_coverage_${Date.now()}`,
              topicTitle: 'Conceptos adicionales',
              targetConcepts: [],
              sourcePages: [],
              evidenceGoal: 'Estudiar los conceptos pendientes',
              sessionFormat: 'discovery',
              planRationale: 'Sesión creada automáticamente para garantizar cobertura 100%',
              coverageUnitIds: [],
              requiredMicroIds: unassignedIds,
              assignedMicroIds: unassignedIds,
              retentionMicroIds: [],
            }
            sessions.push(coverageSession)
            unassignedIds.forEach((id: string) => usedMicroIds.add(id))
            console.log(`[generate-program] Nueva sesión de cobertura creada con ${unassignedIds.length} micros huérfanos`)
            break
          }
        }
      }

      // PASO 3: Asignar sesiones de simulate/review/exam con retentionMicroIds
      for (const session of sessions) {
        const purpose = session.purpose || 'understand'
        if (!NON_TEACHING_PURPOSES.has(purpose)) continue
        ;(session as any).requiredMicroIds = []
        ;(session as any).retentionMicroIds = allGraphIds
        ;(session as any).assignedMicroIds = allGraphIds
      }

      // PASO 3b: Eliminar sesiones de enseñanza vacías (sin requiredMicroIds)
      // Una sesión de enseñanza sin contenido no debe existir en el programa
      const sessionsBeforeClean = sessions.length
      const validSessions = sessions.filter((s: any) => {
        const purpose = s.purpose || 'understand'
        if (!TEACHING_PURPOSES.has(purpose)) return true  // no-teaching siempre pasa
        const req = (s.requiredMicroIds as string[]) || []
        return req.length > 0  // teaching solo pasa si tiene micros
      })
      const removedEmpty = sessionsBeforeClean - validSessions.length
      if (removedEmpty > 0) {
        console.log(`[generate-program] ${removedEmpty} sesiones de enseñanza vacías eliminadas`)
        // Renumerar
        validSessions.forEach((s: any, i: number) => { s.sessionNumber = i + 1 })
        sessions.length = 0
        sessions.push(...validSessions)
      }

      // PASO 4: Verificar invariante 8/8
      const finalRequired = new Set(
        sessions
          .filter((s: any) => TEACHING_PURPOSES.has(s.purpose || 'understand'))
          .flatMap((s: any) => (s.requiredMicroIds as string[]) || [])
      )
      const stillMissing = allGraphIds.filter((id: string) => !finalRequired.has(id))

      if (stillMissing.length > 0) {
        console.error(`[generate-program] INVARIANTE FALLIDA: ${stillMissing.length} micros siguen sin asignar`)
      } else {
        console.log(`[generate-program] ✅ Invariante 8/8 cumplida: ${finalRequired.size}/${allGraphIds.length} micros asignados`)
      }

      // PASO 5: Metadata de validación con calidad real del LLM
      const rescuedOrphanMicros = allGraphIds.length - initiallyAssignedMicros
      const initialAssignmentPercent = allGraphIds.length > 0
        ? Math.round((initiallyAssignedMicros / allGraphIds.length) * 100)
        : 0

      coverageAssignmentMeta = {
        totalGraphMicros: allGraphIds.length,
        initiallyAssignedMicros,
        rescuedOrphanMicros,
        initialAssignmentPercent,
        requiredAssignedMicros: finalRequired.size,
        unassignedMicroIds: stillMissing,
        duplicateRequiredMicroIds: [],
        assignmentComplete: stillMissing.length === 0,
      }
      console.log(`[generate-program] LLM asignó ${initiallyAssignedMicros}/${allGraphIds.length} (${initialAssignmentPercent}%) | rescatados: ${rescuedOrphanMicros}`)
    }

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
      // Metadata de cobertura 8/8 — calculada en la fase de asignación determinista
      ...(coverageAssignmentMeta ? { coverageAssignment: coverageAssignmentMeta } : {}),
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
