// ═══════════════════════════════════════════════════════════════
// CONTENT DEPTH ENGINE
// 
// Calcula la profundidad ADECUADA para cada micro según:
// - Tipo cognitivo
// - Dificultad
// - Importancia
// - Objetivo pedagógico actual
// - Historial del estudiante
// 
// No es sobre "corto vs largo" — es sobre "adecuado al contenido".
// ═══════════════════════════════════════════════════════════════

import type { MicroConcept, MicroState, TeachingObjective } from '../types'

export type ContentDepthLevel =
  | 'minimal'        // 1-2 oraciones, para hechos simples
  | 'brief'          // 3-4 oraciones + tal vez 1 ejemplo
  | 'standard'       // Explicación + ejemplo + insight
  | 'thorough'       // Explicación + múltiples ejemplos + comparación
  | 'deep'           // Explicación completa + ejemplos + procedimiento + errores comunes

export interface DepthGuidance {
  level: ContentDepthLevel
  maxBlocks: number
  shouldIncludeExample: boolean
  shouldIncludeAnalogy: boolean
  shouldIncludeSteps: boolean
  shouldIncludeCommonError: boolean
  shouldIncludeComparison: boolean
  toneNote: string              // Instrucción específica al LLM
  focus: string                 // Foco pedagógico
}

// ═══════════════════════════════════════════════════════════════
// CALCULAR PROFUNDIDAD ADECUADA
// ═══════════════════════════════════════════════════════════════
export function calculateDepth(
  micro: MicroConcept,
  microState: MicroState,
  objective: TeachingObjective,
): DepthGuidance {
  // ─── FACTOR 1: Tipo cognitivo del micro ───
  const cognitiveBaseline = getCognitiveBaseline(micro.cognitiveType)

  // ─── FACTOR 2: Dificultad del micro ───
  const difficultyModifier = getDifficultyModifier(micro.difficulty)

  // ─── FACTOR 3: Importancia ───
  const importanceModifier = getImportanceModifier(micro.importance)

  // ─── FACTOR 4: Objetivo actual ───
  const objectiveDepth = getObjectiveDepth(objective)

  // ─── FACTOR 5: Historial del estudiante ───
  const studentModifier = getStudentModifier(microState)

  // Combinar factores
  const score = cognitiveBaseline + difficultyModifier + importanceModifier + objectiveDepth + studentModifier
  const level = scoreToLevel(score)

  return buildGuidance(level, micro, objective, microState)
}

// ═══════════════════════════════════════════════════════════════
// FACTOR 1: Baseline según tipo cognitivo
// ═══════════════════════════════════════════════════════════════
function getCognitiveBaseline(type: string): number {
  const map: Record<string, number> = {
    definitional: 0,      // Definiciones: minimal por defecto
    memorization: 0,      // Datos a memorizar: minimal
    conceptual: 2,        // Conceptos: standard
    narrative: 2,         // Historias: standard
    causal: 3,            // Causa-efecto: thorough
    comparative: 3,       // Comparaciones: thorough
    chronological: 2,     // Cronología: standard
    classificatory: 2,    // Categorías: standard
    procedural: 4,        // Procedimientos: deep
    mathematical: 4,      // Matemáticas: deep
    analytical: 3,        // Análisis: thorough
    applicative: 3,       // Aplicación: thorough
  }
  return map[type] ?? 2
}

// ═══════════════════════════════════════════════════════════════
// FACTOR 2: Modificador por dificultad
// ═══════════════════════════════════════════════════════════════
function getDifficultyModifier(difficulty: number): number {
  if (difficulty < 30) return -1        // Fácil: menos profundidad
  if (difficulty < 60) return 0         // Medio: normal
  if (difficulty < 80) return 1         // Difícil: más profundidad
  return 2                              // Muy difícil: mucha más
}

// ═══════════════════════════════════════════════════════════════
// FACTOR 3: Modificador por importancia
// ═══════════════════════════════════════════════════════════════
function getImportanceModifier(importance: string): number {
  const map: Record<string, number> = {
    low: -1,
    medium: 0,
    high: 1,
    critical: 2,
  }
  return map[importance] ?? 0
}

// ═══════════════════════════════════════════════════════════════
// FACTOR 4: Profundidad según objetivo pedagógico
// ═══════════════════════════════════════════════════════════════
function getObjectiveDepth(objective: TeachingObjective): number {
  const map: Record<TeachingObjective, number> = {
    introduce: 0,                    // Primera vez: no abrumar
    explain_deeper: 2,               // Ya lo vio: profundizar
    illustrate_with_example: 1,      // Ejemplo: mediano
    verify_understanding: -2,        // Pregunta: casi sin texto
    test_application: -1,            // Aplicación: setup breve
    test_transfer: -1,               // Transfer: setup breve
    consolidate: 0,                  // Cierre: normal
    reveal_answer: 1,                // Correción: explicar bien
    reconstruct_from_error: 2,       // Segundo fallo: profundidad
    connect_to_previous: 1,          // Conexión: mediano
    recall_check: -2,                // Recall: mínimo
  }
  return map[objective] ?? 0
}

// ═══════════════════════════════════════════════════════════════
// FACTOR 5: Historial del estudiante
// ═══════════════════════════════════════════════════════════════
function getStudentModifier(microState: MicroState): number {
  const { evidence, timeline } = microState

  // Si falló recientemente, necesita más profundidad
  const recentEvents = timeline.slice(-3)
  const recentFails = recentEvents.filter(e => e.eventType === 'answered_incorrectly').length

  if (recentFails >= 2) return 2      // Múltiples fallos: mucha más profundidad
  if (recentFails === 1) return 1     // Un fallo: más profundidad
  if (evidence.answeredCorrectly >= 2) return -1  // Va bien: menos profundidad

  return 0
}

// ═══════════════════════════════════════════════════════════════
// CONVERTIR SCORE A NIVEL
// ═══════════════════════════════════════════════════════════════
function scoreToLevel(score: number): ContentDepthLevel {
  if (score <= 0) return 'minimal'
  if (score <= 2) return 'brief'
  if (score <= 5) return 'standard'
  if (score <= 7) return 'thorough'
  return 'deep'
}

// ═══════════════════════════════════════════════════════════════
// CONSTRUIR GUÍA COMPLETA
// ═══════════════════════════════════════════════════════════════
function buildGuidance(
  level: ContentDepthLevel,
  micro: MicroConcept,
  objective: TeachingObjective,
  microState: MicroState,
): DepthGuidance {
  const hasFormulas = micro.formulas.length > 0
  const hasProcedures = micro.procedures.length > 0
  const hasExamples = micro.examples.length > 0
  const hasErrors = micro.commonErrors.length > 0

  const recentFails = microState.timeline.slice(-3).filter(e => e.eventType === 'answered_incorrectly').length
  const isReteaching = recentFails > 0 || objective === 'reveal_answer' || objective === 'reconstruct_from_error'

  switch (level) {
    case 'minimal':
      return {
        level,
        maxBlocks: 2,
        shouldIncludeExample: false,
        shouldIncludeAnalogy: false,
        shouldIncludeSteps: false,
        shouldIncludeCommonError: false,
        shouldIncludeComparison: false,
        toneNote: 'MÍNIMA profundidad. Este contenido es simple y directo. Ve al grano en 1-2 oraciones. No agregues ejemplos ni explicaciones extra.',
        focus: 'Solo la idea esencial. Sin adorno.',
      }

    case 'brief':
      return {
        level,
        maxBlocks: 3,
        shouldIncludeExample: hasExamples && objective !== 'introduce',
        shouldIncludeAnalogy: false,
        shouldIncludeSteps: false,
        shouldIncludeCommonError: false,
        shouldIncludeComparison: false,
        toneNote: 'Profundidad BREVE. 3-4 oraciones máximo. Puedes agregar un ejemplo si aclara mucho. Sin adornos innecesarios.',
        focus: 'Explicación directa + un ejemplo si ayuda.',
      }

    case 'standard':
      return {
        level,
        maxBlocks: 5,
        shouldIncludeExample: hasExamples,
        shouldIncludeAnalogy: micro.cognitiveType === 'conceptual' || micro.cognitiveType === 'analytical',
        shouldIncludeSteps: false,
        shouldIncludeCommonError: hasErrors && isReteaching,
        shouldIncludeComparison: micro.cognitiveType === 'comparative',
        toneNote: 'Profundidad ESTÁNDAR. Explicación clara con un ejemplo concreto. Si el concepto es abstracto, agrega una analogía. Máximo 5 bloques.',
        focus: 'Explicación + ejemplo + un insight clave.',
      }

    case 'thorough':
      return {
        level,
        maxBlocks: 7,
        shouldIncludeExample: true,
        shouldIncludeAnalogy: true,
        shouldIncludeSteps: hasProcedures,
        shouldIncludeCommonError: hasErrors,
        shouldIncludeComparison: micro.cognitiveType === 'comparative' || micro.cognitiveType === 'causal',
        toneNote: 'Profundidad EXHAUSTIVA. Este es un concepto importante. Incluye: explicación clara, ejemplo, y si aplica: comparación, causa-efecto, o error común. Máximo 7 bloques.',
        focus: 'Explicación completa con ejemplos y matices.',
      }

    case 'deep':
      return {
        level,
        maxBlocks: 10,
        shouldIncludeExample: true,
        shouldIncludeAnalogy: true,
        shouldIncludeSteps: hasProcedures,
        shouldIncludeCommonError: hasErrors,
        shouldIncludeComparison: true,
        toneNote: 'Profundidad MÁXIMA. Concepto crítico o muy difícil. Incluye TODO: intuición, explicación técnica, ejemplo resuelto, procedimiento paso a paso si aplica, comparación con conceptos parecidos, y errores comunes. El estudiante DEBE dominar esto.',
        focus: 'Domino total del concepto. Sin dejar nada al azar.',
      }
  }
}

// ═══════════════════════════════════════════════════════════════
// GENERAR INSTRUCCIÓN PARA EL PROMPT DEL LLM
// ═══════════════════════════════════════════════════════════════
export function depthToPromptInstruction(guidance: DepthGuidance, micro: MicroConcept): string {
  const parts: string[] = []

  parts.push(`PROFUNDIDAD REQUERIDA: ${guidance.level.toUpperCase()}`)
  parts.push(`Máximo ${guidance.maxBlocks} bloques de contenido.`)
  parts.push(guidance.toneNote)
  parts.push(`Foco: ${guidance.focus}`)

  if (guidance.shouldIncludeExample && micro.examples.length > 0) {
    parts.push(`SÍ incluye un ejemplo (del material: ${micro.examples[0].scenario.slice(0, 80)}...).`)
  }
  if (guidance.shouldIncludeAnalogy) {
    parts.push(`SÍ incluye una analogía cotidiana si ayuda a entender.`)
  }
  if (guidance.shouldIncludeSteps && micro.procedures.length > 0) {
    parts.push(`SÍ incluye el procedimiento paso a paso (${micro.procedures[0].steps.length} pasos).`)
  }
  if (guidance.shouldIncludeCommonError && micro.commonErrors.length > 0) {
    parts.push(`SÍ menciona el error común: "${micro.commonErrors[0].description}".`)
  }
  if (guidance.shouldIncludeComparison) {
    parts.push(`SÍ incluye una comparación clara.`)
  }

  if (guidance.level === 'minimal' || guidance.level === 'brief') {
    parts.push(`NO agregues teoría extra. NO expliques cosas obvias. NO uses relleno.`)
  }

  return parts.join('\n')
}
