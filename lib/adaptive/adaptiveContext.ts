import { detectRealPages, extractPageSlice } from './blueprintChunker'

// ═══════════════════════════════════════════════════════════════
// StudyAL — AdaptiveContext Universal
// Formato único que reciben TODAS las APIs del modo adaptativo.
// El runner construye uno solo y lo pasa a cada endpoint.
// ═══════════════════════════════════════════════════════════════

export interface AdaptiveContext {
  // ── Topic del blueprint ──────────────────────────────────────
  topicId: string
  topicTitle: string
  targetConcepts: string[]        // conceptos objetivo de esta sesión
  evidenceGoal: string            // qué debe demostrar el estudiante
  sourcePages: number[]           // páginas del material donde está el tema

  // ── Material (fragmento inteligente, no 8000 chars brutos) ───
  materialSlice: string           // fragmento relevante del material
  materialTitle: string

  // ── Estado del estudiante ────────────────────────────────────
  overallMastery: number          // 0-100 dominio actual
  weakConcepts: string[]          // conceptos débiles del topic
  criticalConcepts: string[]      // conceptos críticos (< 20%)
  strongConcepts: string[]        // conceptos dominados
  topicScore: number              // 0-100 dominio del topic actual

  // ── Sesión actual ────────────────────────────────────────────
  sessionPurpose: string          // 'understand' | 'memorize' | 'apply' | etc.
  sessionNumber: number
  stepType: string                // 'explain' | 'micro_quiz' | etc.

  // ── Configuración ────────────────────────────────────────────
  difficulty: number              // 0-100
  lang: 'es' | 'en'

  // ── Perfil del usuario ────────────────────────────────────────
  userProfile?: {
    carrera?: string
    universidad?: string
    tipoEstudiante?: string
    academicLevel?: string
    studyContext?: string
    objetivo?: string
  } | null
}

// ── Builder — construye el contexto desde los datos disponibles ──
export function buildAdaptiveContext(params: {
  session: {
    topicId?: string
    topicTitle?: string
    targetConcepts?: string[]
    evidenceGoal?: string
    sourcePages?: number[]
    sessionNumber: number
    purpose: string
  }
  step: {
    type: string
  }
  materialContent: string
  materialTitle: string
  masterySnapshot: {
    overallMastery: number
    weakConcepts: Array<{ name: string }>
    criticalConcepts: Array<{ name: string }>
    dominatedConcepts: Array<{ name: string }>
    topicMastery?: Array<{
      topicId: string
      topicTitle: string
      score: number
      weakConcepts: string[]
    }>
    userProfile?: {
      carrera?: string
      universidad?: string
      tipoEstudiante?: string
      academicLevel?: string
      studyContext?: string
      objetivo?: string
    } | null
  } | null
}): AdaptiveContext {
  const { session, step, materialContent, materialTitle, masterySnapshot } = params

  // ── Fragmento inteligente del material ───────────────────────
  const materialSlice = buildMaterialSlice(
    materialContent,
    session.sourcePages ?? [],
    session.targetConcepts ?? [],
  )

  // ── Score del topic actual ───────────────────────────────────
  const topicScore = masterySnapshot?.topicMastery?.find(
    t => t.topicId === session.topicId
  )?.score ?? 0

  // ── Conceptos débiles del topic actual ───────────────────────
  const topicWeakConcepts = masterySnapshot?.topicMastery?.find(
    t => t.topicId === session.topicId
  )?.weakConcepts ?? []

  const weak = topicWeakConcepts.length > 0
    ? topicWeakConcepts
    : (masterySnapshot?.weakConcepts?.map(c => c.name) ?? [])

  const critical = masterySnapshot?.criticalConcepts?.map(c => c.name) ?? []
  const strong = masterySnapshot?.dominatedConcepts?.map(c => c.name) ?? []

  // ── Dificultad adaptativa ────────────────────────────────────
  const difficulty = calculateDifficulty(
    masterySnapshot?.overallMastery ?? 0,
    topicScore,
    session.purpose,
  )

  // ── Idioma ───────────────────────────────────────────────────
  const lang = detectLang(materialContent)

  return {
    topicId: session.topicId ?? 'unknown',
    topicTitle: session.topicTitle ?? 'Tema principal',
    targetConcepts: session.targetConcepts ?? [],
    evidenceGoal: session.evidenceGoal ?? '',
    sourcePages: session.sourcePages ?? [],
    materialSlice,
    materialTitle,
    overallMastery: masterySnapshot?.overallMastery ?? 0,
    weakConcepts: weak.slice(0, 5),
    criticalConcepts: critical.slice(0, 3),
    strongConcepts: strong.slice(0, 3),
    topicScore,
    sessionPurpose: session.purpose,
    sessionNumber: session.sessionNumber,
    stepType: step.type,
    difficulty,
    lang,
    userProfile: params.masterySnapshot?.userProfile ?? null,
  }
}

// ── Fragmento inteligente del material ───────────────────────────
// Prioridad: sourcePages > búsqueda por concepto > inicio del material
function buildMaterialSlice(
  materialContent: string,
  sourcePages: number[],
  targetConcepts: string[],
): string {
  const MAX_CHARS = 6000
  const PREFIX_CHARS = 600  // siempre incluir el inicio para contexto

  const prefix = materialContent.slice(0, PREFIX_CHARS)

  // 1. Si hay sourcePages → intentar páginas reales primero
  if (sourcePages.length > 0) {
    // Intentar detectar páginas reales en el material
    const pageMap = detectRealPages(materialContent)

    if (pageMap.length >= 2) {
      const realSlice = extractPageSlice(materialContent, sourcePages, pageMap, MAX_CHARS)
      if (realSlice.length > 400) {
        return realSlice
      }
    }

    // Fallback: estimado por chars
    const charsPerPage = 1600
    const minPage = Math.min(...sourcePages)
    const maxPage = Math.max(...sourcePages)
    const startChar = Math.max(0, (minPage - 1) * charsPerPage)
    const endChar = Math.min(materialContent.length, maxPage * charsPerPage + 1200)
    const pageSlice = materialContent.slice(startChar, endChar)

    if (pageSlice.length > 400) {
      const combined = prefix + '\n\n' + pageSlice
      return combined.slice(0, MAX_CHARS)
    }
  }

  // 2. Si hay targetConcepts → buscar fragmentos donde aparecen
  if (targetConcepts.length > 0) {
    const fragments: string[] = []
    const contentLower = materialContent.toLowerCase()

    for (const concept of targetConcepts.slice(0, 3)) {
      const conceptLower = concept.toLowerCase().slice(0, 10)
      let idx = contentLower.indexOf(conceptLower)
      while (idx !== -1 && fragments.length < 6) {
        const start = Math.max(0, idx - 200)
        const end = Math.min(materialContent.length, idx + 800)
        fragments.push(materialContent.slice(start, end))
        idx = contentLower.indexOf(conceptLower, idx + 1)
      }
    }

    if (fragments.length > 0) {
      const conceptSlice = [...new Set(fragments)].join('\n\n---\n\n')
      const combined = prefix + '\n\n' + conceptSlice
      return combined.slice(0, MAX_CHARS)
    }
  }

  // 3. Fallback: inicio del material
  return materialContent.slice(0, MAX_CHARS)
}

// ── Dificultad adaptativa ────────────────────────────────────────
function calculateDifficulty(
  overallMastery: number,
  topicScore: number,
  purpose: string,
): number {
  const base = topicScore > 0 ? topicScore : overallMastery

  // Ajuste por propósito
  const purposeOffset: Record<string, number> = {
    understand: -10,  // más fácil al entender
    organize: -5,
    memorize: 0,
    apply: +10,       // más difícil al aplicar
    simulate: +20,    // más difícil al simular
    repair: -15,      // más fácil al reparar
  }

  const offset = purposeOffset[purpose] ?? 0
  return Math.min(90, Math.max(20, base + offset))
}

// ── Detectar idioma ───────────────────────────────────────────────
function detectLang(text: string): 'es' | 'en' {
  const sample = text.slice(0, 2000).toLowerCase()
  const spanishWords = [' el ', ' la ', ' los ', ' las ', ' de ', ' que ', ' en ', ' con ']
  const count = spanishWords.filter(w => sample.includes(w)).length
  return count >= 4 ? 'es' : 'en'
}

// ── Serializar para enviar a API ─────────────────────────────────
export function serializeAdaptiveContext(ctx: AdaptiveContext): Record<string, unknown> {
  return {
    adaptiveContext: ctx,
    // Campos legacy para compatibilidad con APIs existentes
    contenido: ctx.materialSlice,
    masteryContext: {
      overallMastery: ctx.overallMastery,
      weakConcepts: ctx.weakConcepts,
      criticalConcepts: ctx.criticalConcepts,
      strongConcepts: ctx.strongConcepts,
      topicTitle: ctx.topicTitle,
      targetConcepts: ctx.targetConcepts,
      evidenceGoal: ctx.evidenceGoal,
      focusInstruction: buildFocusInstruction(ctx),
    },
    topicTitle: ctx.topicTitle,
    targetConcepts: ctx.targetConcepts,
    sourcePages: ctx.sourcePages,
    difficulty: ctx.difficulty,
    lang: ctx.lang,
    mode: 'adaptive',
  }
}

// ── Instrucción de foco para el LLM ─────────────────────────────
export function buildFocusInstruction(ctx: AdaptiveContext): string {
  const parts: string[] = []

  parts.push(`FOCO EXCLUSIVO: Genera contenido ÚNICAMENTE sobre "${ctx.topicTitle}".`)

  if (ctx.targetConcepts.length > 0) {
    parts.push(`Conceptos objetivo: ${ctx.targetConcepts.slice(0, 5).join(', ')}.`)
  }

  if (ctx.evidenceGoal) {
    parts.push(`Objetivo de evidencia: ${ctx.evidenceGoal}.`)
  }

  if (ctx.weakConcepts.length > 0) {
    parts.push(`Conceptos débiles del estudiante: ${ctx.weakConcepts.slice(0, 3).join(', ')}.`)
  }

  parts.push(`Dificultad objetivo: ${ctx.difficulty}/100.`)

  if (ctx.lang === 'es') {
    parts.push('Responde en español.')
  }

  return parts.join(' ')
}

// ═══════════════════════════════════════════════════════════════
// PREDICCIÓN DE EXAMEN — actualizada después de cada sesión
// ═══════════════════════════════════════════════════════════════

export interface ExamPrediction {
  passProb: number          // 0-100
  excellentProb: number     // 0-100
  expectedScore: number     // 0-100
  message: string
  daysToExamImpact: 'critical' | 'tight' | 'comfortable' | 'ample'
  recommendedDailyMinutes: number
}

export function buildExamPrediction(params: {
  overallMastery: number
  targetScore: number
  daysToExam: number | null
  dailyMinutes: number
  topicMastery?: Array<{ score: number; critical: boolean }>
  learningStyle?: string
}): ExamPrediction {
  const { overallMastery, targetScore, daysToExam, dailyMinutes, topicMastery } = params

  const distance = targetScore - overallMastery
  const criticalTopics = (topicMastery || []).filter(t => t.critical).length

  // Probabilidad base de pasar
  let passProb = Math.min(95, Math.max(5,
    overallMastery >= targetScore ? 85 + (overallMastery - targetScore) * 0.5 :
    50 + (overallMastery / targetScore) * 35
  ))

  // Penalizar por topics críticos
  passProb = Math.max(5, passProb - (criticalTopics * 8))

  // Ajustar por días al examen
  let daysImpact: ExamPrediction['daysToExamImpact'] = 'ample'
  if (daysToExam !== null) {
    const minutesNeeded = distance * 12 // estimado: 12 min por punto
    const minutesAvailable = (daysToExam || 1) * dailyMinutes
    const ratio = minutesAvailable / Math.max(1, minutesNeeded)

    if (daysToExam <= 1) { daysImpact = 'critical'; passProb *= 0.7 }
    else if (ratio < 0.5) { daysImpact = 'tight'; passProb *= 0.85 }
    else if (ratio < 1.5) { daysImpact = 'comfortable' }
    else { daysImpact = 'ample' }
  }

  const excellentProb = Math.max(0, passProb - 25)
  const expectedScore = Math.min(100, Math.round(overallMastery + (passProb / 100) * distance * 0.8))

  const message = passProb >= 80
    ? 'Vas muy bien. Mantén el ritmo y estarás listo.'
    : passProb >= 60
    ? 'Buen progreso. Enfócate en los temas críticos para asegurar el aprobado.'
    : passProb >= 40
    ? 'Necesitas acelerar. Prioriza los temas más importantes.'
    : 'Riesgo alto. Cambia la estrategia y enfócate solo en lo esencial.'

  const recommendedDailyMinutes = daysToExam && daysToExam > 0 && distance > 0
    ? Math.min(120, Math.max(20, Math.round((distance * 12) / daysToExam)))
    : dailyMinutes

  return { passProb: Math.round(passProb), excellentProb: Math.round(excellentProb), expectedScore, message, daysToExamImpact: daysImpact, recommendedDailyMinutes }
}
