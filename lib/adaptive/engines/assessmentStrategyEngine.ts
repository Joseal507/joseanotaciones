// ═══════════════════════════════════════════════════════════════
// Assessment Strategy Engine
// NO genera preguntas. Decide QUÉ evidencia se necesita y CUÁL
// es el mejor formato para obtenerla.
// ═══════════════════════════════════════════════════════════════

import type { ConceptEvidence, EvidenceDimension } from './evidenceEngine'
import { getNeededDimensions, FORMAT_EVIDENCE_WEIGHT } from './evidenceEngine'

export type KnowledgeType =
  | 'conceptual'
  | 'procedural'
  | 'memorization'
  | 'mathematical'
  | 'narrative'
  | 'causal'
  | 'argumentative'
  | 'medical'
  | 'legal'
  | 'historical'
  | 'application'
  | 'analysis'
  | 'chronological'

export type SubjectArea =
  | 'medical' | 'math' | 'legal' | 'history'
  | 'science' | 'language' | 'general' | 'mixed'

export interface AssessmentStrategy {
  format: string                     // Formato elegido
  targetDimension: EvidenceDimension // Qué dimensión evalúa
  reasoning: string                  // Por qué se eligió este formato
  difficulty: 'easy' | 'medium' | 'hard'
  cognitiveObjective: string
}

// ── Formatos disponibles por dimensión ───────────────────────────
// Cada dimensión tiene formatos preferidos que la evalúan mejor
const FORMATS_BY_DIMENSION: Record<EvidenceDimension, string[]> = {
  recognition: ['multiple_choice', 'true_false', 'matching', 'fill_blank'],
  comprehension: ['multiple_choice', 'true_false', 'matching', 'ordering', 'fill_blank'],
  recall: ['fill_blank', 'multiple_choice', 'matching', 'ordering'],
  application: ['multiple_choice', 'matching', 'ordering', 'fill_blank', 'case_study'],
  transfer: ['multiple_choice', 'case_study', 'true_false', 'matching'],
  retention: ['multiple_choice', 'fill_blank', 'true_false'],
  differentiation: ['matching', 'true_false', 'multiple_choice', 'ordering'],
}

// ── Formatos preferidos por tipo de conocimiento ─────────────────
const FORMATS_BY_KNOWLEDGE: Record<KnowledgeType, string[]> = {
  conceptual: ['comparison', 'cause_effect', 'short_answer', 'active_recall'],
  procedural: ['ordering', 'fill_blank', 'error_detection', 'problem'],
  memorization: ['fill_blank', 'matching', 'multiple_choice'],
  mathematical: ['problem', 'fill_blank', 'error_detection', 'harder_problem'],
  narrative: ['ordering', 'matching', 'short_answer', 'multiple_choice'],
  causal: ['cause_effect', 'ordering', 'case_study', 'comparison'],
  argumentative: ['comparison', 'short_answer', 'case_study', 'transfer_case'],
  medical: ['case_study', 'cause_effect', 'comparison', 'ordering'],
  legal: ['case_study', 'matching', 'comparison', 'multiple_choice'],
  historical: ['ordering', 'matching', 'cause_effect', 'short_answer'],
  application: ['case_study', 'problem', 'harder_problem'],
  analysis: ['comparison', 'error_detection', 'case_study', 'short_answer'],
  chronological: ['ordering', 'matching', 'fill_blank'],
}

// ── Formatos preferidos por área ─────────────────────────────────
const FORMATS_BY_SUBJECT: Record<SubjectArea, string[]> = {
  medical: ['multiple_choice', 'matching', 'ordering', 'true_false', 'case_study'],
  math: ['fill_blank', 'multiple_choice', 'ordering', 'true_false'],
  legal: ['multiple_choice', 'matching', 'true_false', 'case_study'],
  history: ['ordering', 'matching', 'multiple_choice', 'true_false', 'fill_blank'],
  science: ['multiple_choice', 'ordering', 'matching', 'fill_blank', 'true_false'],
  language: ['matching', 'fill_blank', 'multiple_choice', 'true_false'],
  general: ['multiple_choice', 'true_false', 'matching', 'fill_blank'],
  mixed: ['multiple_choice', 'matching', 'true_false', 'ordering'],
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: Decidir la mejor estrategia de evaluación
// ═══════════════════════════════════════════════════════════════
export function decideAssessmentStrategy(params: {
  evidence: ConceptEvidence
  knowledgeType: KnowledgeType
  subjectArea: SubjectArea
  targetMasteryLevel: number       // 60=pass, 75=80+, 85=90+, 92=100
  recentFormats: string[]           // Formatos usados recientemente (evitar repetir)
  consecutiveFailures: number       // Fallos consecutivos del estudiante
  isFirstAssessment: boolean        // Es la primera evaluación de este concepto
}): AssessmentStrategy {
  const {
    evidence, knowledgeType, subjectArea,
    targetMasteryLevel, recentFormats, consecutiveFailures, isFirstAssessment,
  } = params

  // ── PASO 1: Determinar qué dimensión necesita evidencia ──────
  const neededDimensions = isFirstAssessment
    ? (['recognition'] as EvidenceDimension[])
    : getNeededDimensions(evidence, targetMasteryLevel)

  const targetDimension = neededDimensions[0] || 'comprehension'

  // ── PASO 2: Si hay muchos fallos, simplificar drásticamente ──
  if (consecutiveFailures >= 2) {
    const simpleFormats = ['true_false', 'multiple_choice', 'matching']
    const lastFormat = recentFormats[recentFormats.length - 1]
    const format = simpleFormats.find(f => f !== lastFormat) || 'true_false'

    return {
      format,
      targetDimension: 'recognition',
      reasoning: `Después de ${consecutiveFailures} fallos, simplificar para reconstruir confianza`,
      difficulty: 'easy',
      cognitiveObjective: 'Recuperar seguridad con reconocimiento básico',
    }
  }

  // ── PASO 3: Elegir formato según prioridades ────────────────
  // Prioridad: subject > knowledge > dimension
  const subjectFormats = FORMATS_BY_SUBJECT[subjectArea] || FORMATS_BY_SUBJECT.general
  const knowledgeFormats = FORMATS_BY_KNOWLEDGE[knowledgeType] || FORMATS_BY_KNOWLEDGE.conceptual
  const dimensionFormats = FORMATS_BY_DIMENSION[targetDimension] || ['multiple_choice']

  // Intersección triple: formatos que aplican a todo
  const perfectMatch = subjectFormats.filter(f =>
    knowledgeFormats.includes(f) && dimensionFormats.includes(f)
  )

  // Intersección doble: formatos que aplican al menos a dos
  const goodMatch = subjectFormats.filter(f =>
    knowledgeFormats.includes(f) || dimensionFormats.includes(f)
  )

  // Filtrar formatos recientes para variar
  const lastFormat = recentFormats[recentFormats.length - 1]
  const recentSet = new Set(recentFormats.slice(-3))

  let candidates = perfectMatch.filter(f => !recentSet.has(f))
  if (candidates.length === 0) candidates = perfectMatch.filter(f => f !== lastFormat)
  if (candidates.length === 0) candidates = goodMatch.filter(f => !recentSet.has(f))
  if (candidates.length === 0) candidates = goodMatch.filter(f => f !== lastFormat)
  if (candidates.length === 0) candidates = dimensionFormats.filter(f => f !== lastFormat)
  if (candidates.length === 0) candidates = dimensionFormats

  const format = candidates[0] || 'short_answer'

  // ── PASO 4: Determinar dificultad ────────────────────────────
  const masteryLevel = evidence.overallMastery
  let difficulty: 'easy' | 'medium' | 'hard'

  if (masteryLevel < 40) difficulty = 'easy'
  else if (masteryLevel < 70) difficulty = 'medium'
  else difficulty = 'hard'

  // Si estamos evaluando aplicación/transferencia, subir dificultad
  if (targetDimension === 'application' || targetDimension === 'transfer') {
    if (difficulty === 'easy') difficulty = 'medium'
  }

  // ── PASO 5: Construir el objetivo cognitivo ──────────────────
  const objectives: Record<EvidenceDimension, string> = {
    recognition: 'Verificar que reconoce el concepto',
    comprehension: 'Verificar que entiende qué significa y por qué',
    recall: 'Verificar que puede recordar sin ayuda',
    application: 'Verificar que puede aplicarlo a una situación',
    transfer: 'Verificar que puede usarlo en un contexto nuevo',
    retention: 'Verificar que lo recuerda tras el tiempo',
    differentiation: 'Verificar que lo distingue de conceptos similares',
  }

  const reasoning = buildReasoning({
    format, targetDimension, subjectArea, knowledgeType,
    masteryLevel, difficulty, isFirstAssessment,
  })

  return {
    format,
    targetDimension,
    reasoning,
    difficulty,
    cognitiveObjective: objectives[targetDimension],
  }
}

// ── Construir explicación de por qué se eligió esta estrategia ──
function buildReasoning(params: {
  format: string
  targetDimension: EvidenceDimension
  subjectArea: SubjectArea
  knowledgeType: KnowledgeType
  masteryLevel: number
  difficulty: string
  isFirstAssessment: boolean
}): string {
  const { format, targetDimension, subjectArea, knowledgeType, isFirstAssessment } = params

  if (isFirstAssessment) {
    return `Primera evaluación → verificar ${targetDimension} con ${format}`
  }

  return `Falta evidencia de ${targetDimension}. ${format} es óptimo para ${knowledgeType} en área ${subjectArea}.`
}

// ── Sugerir el siguiente paso de enseñanza cuando falla ──────────
export function decideTeachingStrategy(params: {
  evidence: ConceptEvidence
  errorType: string
  knowledgeType: KnowledgeType
  previousFormat: string
}): { format: string; reasoning: string } {
  const { errorType, knowledgeType, previousFormat } = params

  // Errores específicos → estrategias específicas
  const strategyByError: Record<string, string> = {
    vocabulary: 'analogy',         // No conoce términos → analogía
    relation: 'comparison',        // No conecta ideas → comparación explícita
    application: 'worked_example', // Sabe teoría pero no aplica → ejemplo resuelto
    memory: 'explain',             // Olvidó → reexplicar desde otro ángulo
    procedure: 'step_by_step',     // No sigue proceso → pasos numerados
    causal: 'cause_effect',        // No entiende causa-efecto → cadena causal
    false_confidence: 'true_false',// Falsa confianza → contra-ejemplo directo
  }

  const format = strategyByError[errorType] || 'analogy'

  const reasoning = `Error de tipo "${errorType}" → ${format} desde ángulo diferente a "${previousFormat}"`

  return { format, reasoning }
}
