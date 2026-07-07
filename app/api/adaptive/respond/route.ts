import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest, safeParseJson } from '../../../../lib/alai'
import {
  createEvidenceRecord,
  applyEvidence,
  createEmptyConceptEvidence,
  getConceptStatus,
  isConceptMastered,
  type ConceptEvidence,
} from '../../../../lib/adaptive/engines/evidenceEngine'
import {
  decideAssessmentStrategy,
  decideTeachingStrategy,
  type KnowledgeType,
  type SubjectArea,
} from '../../../../lib/adaptive/engines/assessmentStrategyEngine'

export const maxDuration = 60

// ═══════════════════════════════════════════════════════════════
// /api/adaptive/respond
// Cerebro pedagógico central.
// Recibe: qué pasó (respuesta del estudiante)
// Devuelve: qué hacer ahora (siguiente interacción)
// ═══════════════════════════════════════════════════════════════

// ── LEGACY: mantener para compatibilidad, pero preferir decideAssessmentStrategy
function selectBestFormat(
  objective: string,
  knowledgeType: string,
  subjectArea: string,
  recentFormats: string[],
  consecutiveFailures: number,
): string {
  const last = recentFormats[recentFormats.length - 1] || ''

  // Si hay fallos consecutivos → simplificar
  if (consecutiveFailures >= 2) {
    const simple = ['true_false', 'multiple_choice', 'fill_blank']
    return simple.find(f => f !== last) || 'true_false'
  }

  // Por objetivo cognitivo
  const byObjective: Record<string, string[]> = {
    recognition: ['multiple_choice', 'true_false', 'fill_blank', 'matching'],
    comprehension: ['true_false', 'multiple_choice', 'short_answer', 'comparison'],
    recall: ['fill_blank', 'short_answer', 'active_recall', 'multiple_choice'],
    application: ['case_study', 'short_answer', 'harder_problem', 'multiple_choice'],
    transfer: ['case_study', 'short_answer', 'comparison', 'harder_problem'],
    differentiation: ['comparison', 'matching', 'true_false', 'multiple_choice'],
    procedure: ['ordering', 'fill_blank', 'error_detection', 'step_by_step'],
    chronology: ['ordering', 'matching', 'true_false', 'fill_blank'],
    relation: ['matching', 'comparison', 'ordering', 'multiple_choice'],
    synthesis: ['active_recall', 'short_answer', 'case_study'],
  }

  // Override por área
  const bySubject: Record<string, Record<string, string>> = {
    math: { application: 'fill_blank', procedure: 'ordering', recall: 'fill_blank' },
    medical: { application: 'case_study', comprehension: 'cause_effect', relation: 'matching' },
    legal: { application: 'case_study', comprehension: 'matching', recall: 'fill_blank' },
    history: { chronology: 'ordering', relation: 'matching', recall: 'fill_blank', comprehension: 'cause_effect' },
    science: { procedure: 'ordering', application: 'fill_blank', comprehension: 'cause_effect' },
  }

  const subjectOverride = bySubject[subjectArea]?.[objective]
  if (subjectOverride && subjectOverride !== last) return subjectOverride

  const candidates = byObjective[objective] || byObjective.comprehension
  const available = candidates.filter(f => f !== last)
  return available[0] || candidates[0] || 'multiple_choice'
}

// ── Determinar objetivo cognitivo del siguiente paso ─────────────
function determineNextObjective(
  currentObjective: string,
  wasCorrect: boolean,
  confidence: string,
  evidenceHistory: Array<{ objective: string; correct: boolean; confidence: string }>,
): string {
  // Falsa confianza detectada → volver a comprensión
  if (!wasCorrect && confidence === 'high') return 'comprehension'

  // Progresión normal de objetivos
  const progression: Record<string, string> = {
    recognition: 'comprehension',
    comprehension: wasCorrect ? 'recall' : 'recognition',
    recall: wasCorrect ? 'application' : 'comprehension',
    application: wasCorrect ? 'transfer' : 'recall',
    transfer: wasCorrect ? 'synthesis' : 'application',
    synthesis: 'synthesis',
  }

  // Si falló → no avanzar, reforzar el actual
  if (!wasCorrect && currentObjective !== 'recognition') {
    return currentObjective
  }

  return progression[currentObjective] || 'comprehension'
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      // Estado de la sesión
      sessionState,
      // Respuesta del estudiante
      studentAnswer,
      confidence = 'medium',
      responseTimeSeconds = 30,
      // Interacción actual
      currentInteraction,
      // Contexto del material
      materialText,
      materialTitle,
      subjectArea = 'general',
      // Historial de evidencia
      evidenceHistory = [],
      recentFormats = [],
      consecutiveFailures = 0,
      // Cobertura
      remainingUnits = [],
      coveredUnits = [],
    } = body

    const concept = currentInteraction?.concept || ''
    const currentObjective = currentInteraction?.objective || 'recognition'
    const currentFormat = currentInteraction?.format || 'explain'
    const isTeachingBlock = currentFormat === 'explain' || currentFormat === 'analogy' ||
      currentFormat === 'example' || currentFormat === 'context' ||
      currentFormat === 'worked_example' || currentFormat === 'step_by_step' ||
      studentAnswer === '__teaching_acknowledged__'

    // ── EVALUACIÓN DE LA RESPUESTA ───────────────────────────────
    let evaluationResult = null

    if (!isTeachingBlock && studentAnswer !== null && studentAnswer !== undefined) {
      // Evaluar respuesta según el tipo de interacción
      // Formatear la respuesta del estudiante según el tipo
      let formattedStudentAnswer = ''
      let formattedExpected = ''

      if (currentFormat === 'matching' && currentInteraction?.pairs) {
        const pairs = currentInteraction.pairs
        const userMatches: string[] = []
        if (studentAnswer && typeof studentAnswer === 'object') {
          Object.entries(studentAnswer).forEach(([leftIdx, rightIdx]: [string, any]) => {
            const left = pairs[Number(leftIdx)]?.left || ''
            const right = pairs[Number(rightIdx)]?.right || ''
            userMatches.push(`"${left}" → "${right}"`)
          })
        }
        formattedStudentAnswer = userMatches.join(' | ') || 'sin respuesta'
        formattedExpected = pairs.map((p: any) => `"${p.left}" → "${p.right}"`).join(' | ')
      } else if (currentFormat === 'ordering' && Array.isArray(studentAnswer)) {
        const items = currentInteraction?.items || []
        formattedStudentAnswer = studentAnswer.map((idx: number) => items[idx]).join(' → ')
        formattedExpected = (currentInteraction?.correctOrder || items.map((_: any, i: number) => i))
          .map((idx: number) => items[idx]).join(' → ')
      } else if (currentFormat === 'true_false') {
        formattedStudentAnswer = studentAnswer === true ? 'Verdadero' : 'Falso'
        formattedExpected = currentInteraction?.correctAnswer === true ? 'Verdadero' : 'Falso'
      } else if (currentFormat === 'multiple_choice') {
        const opts = currentInteraction?.options || []
        formattedStudentAnswer = opts[studentAnswer] || String(studentAnswer)
        formattedExpected = opts[currentInteraction?.correctAnswer] || String(currentInteraction?.correctAnswer)
      } else {
        formattedStudentAnswer = typeof studentAnswer === 'string' ? studentAnswer : JSON.stringify(studentAnswer)
        formattedExpected = String(currentInteraction?.correctAnswer || currentInteraction?.answer || (currentInteraction?.acceptedAnswers || [])[0] || '')
      }

      const evalPrompt = `Evalúa esta respuesta de un estudiante.

CONCEPTO: "${concept}"
MATERIAL: "${materialText?.slice(0, 2000) || ''}"
OBJETIVO: ${currentObjective}
FORMATO: ${currentFormat}
PREGUNTA: "${currentInteraction?.question || currentInteraction?.prompt || ''}"
RESPUESTA DEL ESTUDIANTE: ${formattedStudentAnswer}
RESPUESTA CORRECTA ESPERADA: ${formattedExpected}
CONFIANZA DEL ESTUDIANTE: ${confidence}
TIEMPO DE RESPUESTA: ${responseTimeSeconds}s

REGLAS DE EVALUACIÓN (SÉ JUSTO Y GENEROSO):
- Si la respuesta es correcta pero incompleta → score 75-85 (NO poner "incorrecto")
- Si mencionó al menos 1 concepto correcto del material → score 65-80
- Si dio la idea principal aunque falten detalles → score 70-85
- Si respondió los pares/opciones correctos → score 90-100
- Solo dar score < 40 si la respuesta NO tiene NADA que ver con el material
- Solo marcar "correct": false si el score es < 50
- NUNCA marcar "falseConfidence: true" si el estudiante mencionó algo correcto
- Si el estudiante escribe "no sé" o texto sin sentido → score 10-25
- La comprensión es más importante que la perfección de redacción

REGLAS DE ERRORTYPE:
- "none" → respondió bien (score >= 65)
- "partial" → respondió parcial (score 40-65)
- "memory" → olvidó info (score < 40 en preguntas de recall)
- "vocabulary" → no conoce términos técnicos
- "false_confidence" → SOLO si dijo algo completamente incorrecto CON alta confianza

Devuelve SOLO este JSON:
{
  "correct": true|false,
  "score": 0-100,
  "errorType": "none|vocabulary|relation|application|memory|procedure|false_confidence|partial",
  "whatWasCorrect": "qué dijo bien (máx 1 oración)",
  "whatWasMissing": "qué específicamente faltó o estuvo mal (máx 1 oración)",
  "correctExplanation": "la explicación correcta basada en el material (máx 2 oraciones)",
  "falseConfidence": true|false,
  "conceptsIdentified": ["concepto que sí mencionó"],
  "conceptsMissing": ["concepto que le faltó mencionar"]
}`

      const evalRes = await alaiRequest(async (client: any, modelFn: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [{ role: 'user', content: evalPrompt }],
        temperature: 0.1,
        max_tokens: 500,
      })
      const rawText = res?.choices?.[0]?.message?.content || ''
      if (!rawText.trim()) throw new Error('ALAI_EMPTY_RESPONSE')
      return { text: rawText, provider: 'unknown', model: 'unknown' }
    })

      evaluationResult = safeParseJson(evalRes.text)
    }

    // ── DECISIÓN ADAPTATIVA ──────────────────────────────────────
    const wasCorrect = evaluationResult?.correct ?? true
    const score = evaluationResult?.score ?? (isTeachingBlock ? 0 : 70)
    const errorType = evaluationResult?.errorType || 'none'
    const falseConfidence = evaluationResult?.falseConfidence || false

    // Determinar siguiente objetivo cognitivo
    const nextObjective = isTeachingBlock
      ? 'recognition'  // Después de enseñar → verificar reconocimiento
      : determineNextObjective(currentObjective, wasCorrect, confidence, evidenceHistory)

    // ══════════════════════════════════════════════════════════════
    // MOTOR DE EVIDENCIA — Aplicar evidencia ANTES del análisis
    // ══════════════════════════════════════════════════════════════
    const conceptEvidence: ConceptEvidence = sessionState?.conceptEvidences?.[concept] ||
      createEmptyConceptEvidence(concept, concept)

    let updatedEvidence = conceptEvidence
    if (evaluationResult && !isTeachingBlock) {
      const newEvidences = createEvidenceRecord({
        conceptId: concept,
        format: currentFormat,
        correct: wasCorrect,
        confidence: confidence as any,
        responseTimeSeconds,
        isTeachingBlock: false,
      })
      updatedEvidence = applyEvidence(conceptEvidence, newEvidences)
    }

    // ══════════════════════════════════════════════════════════════
    // ANÁLISIS DEL CONCEPTO ACTUAL
    // ══════════════════════════════════════════════════════════════
    
    const historyForConcept = (sessionState?.evidenceHistory || [])
      .filter((e: any) => e.concept === concept)
    const conceptInteractionsCount = historyForConcept.length
    const conceptFailCount = historyForConcept.filter((e: any) => !e.correct).length
    
    const conceptMastery = updatedEvidence.overallMastery || 0
    const hasEnoughEvidence = updatedEvidence.evidenceCount >= 2
    
    // Cuántas veces se REENSEÑÓ este concepto ya (para no reenseñar infinito)
    const reteachCount = (sessionState?.evidenceHistory || [])
      .filter((e: any) => e.concept === concept && e.wasReteach).length
    
    // ══════════════════════════════════════════════════════════════
    // DECISIÓN PRINCIPAL: ¿QUÉ HACER AHORA?
    // ══════════════════════════════════════════════════════════════
    
    // CASO 1: FALLÓ → REENSEÑAR (no repetir pregunta)
    // Si respondió mal, el próximo paso es una EXPLICACIÓN diferente,
    // no otra pregunta. El estudiante necesita entender antes de intentar de nuevo.
    const needsReteach = !isTeachingBlock && !wasCorrect && reteachCount < 2

    // CASO 2: Tuvo 2 reenseñanzas y sigue fallando → avanzar y volver después
    const givesUpOnConcept = conceptFailCount >= 3 && reteachCount >= 2

    // CASO 3: Dominio suficiente → avanzar al siguiente concepto
    const conceptMastered = wasCorrect && (
      conceptMastery >= 70 ||
      (hasEnoughEvidence && conceptMastery >= 55)
    )
    
    // CASO 4: Ya preguntó suficientes veces del concepto → avanzar
    const askedThisConceptTooMuch = conceptInteractionsCount >= 4

    // Avanzar al siguiente concepto
    const shouldAdvance = (
      isTeachingBlock ||           // Después de enseñar, siempre a pregunta (mismo concepto)
      conceptMastered ||           // Ya lo domina
      askedThisConceptTooMuch ||   // Ya se preguntó suficiente
      givesUpOnConcept              // No progresa, mejor seguir y volver después
    ) && !needsReteach

    // Siguiente unidad a cubrir
    const nextUnit = remainingUnits[0] || null
    const allCovered = remainingUnits.length === 0

    // ══════════════════════════════════════════════════════════════
    // MOTOR DE DECISIÓN: ¿QUÉ FORMATO USAR AHORA?
    // ══════════════════════════════════════════════════════════════
    let nextFormat: string
    let strategyReasoning = ''
    let isReteachStep = false

    if (needsReteach) {
      // ─── REENSEÑAR ─────────────────────────────────────────────
      // El estudiante falló. NO hacer otra pregunta. REEXPLICAR de forma diferente.
      isReteachStep = true
      
      // Rotar entre estrategias de reenseñanza según cuántas veces ya reenseñamos
      const reteachStrategies = ['analogy', 'worked_example', 'step_by_step']
      const strategyIdx = Math.min(reteachCount, reteachStrategies.length - 1)
      nextFormat = reteachStrategies[strategyIdx]
      
      // Si el error es de vocabulario, empezar con analogía siempre
      if (errorType === 'vocabulary') nextFormat = 'analogy'
      // Si es de aplicación, mostrar ejemplo resuelto
      if (errorType === 'application') nextFormat = 'worked_example'
      // Si es de procedimiento, paso a paso
      if (errorType === 'procedure') nextFormat = 'step_by_step'
      
      strategyReasoning = `Estudiante falló (${errorType}). Reenseñando con ${nextFormat} (intento ${reteachCount + 1})`
      
    } else if (shouldAdvance && nextUnit) {
      // ─── NUEVO CONCEPTO ────────────────────────────────────────
      nextFormat = 'explain'
      strategyReasoning = `Concepto dominado. Nuevo concepto: ${nextUnit.title}`
      
    } else if (allCovered && conceptMastery >= 60) {
      // ─── FIN DE SESIÓN ─────────────────────────────────────────
      nextFormat = 'active_recall'
      strategyReasoning = 'Cobertura completa — recall final de síntesis'
      
    } else if (isTeachingBlock) {
      // ─── DESPUÉS DE ENSEÑAR → EVALUAR ──────────────────────────
      // Recién enseñado, primera evaluación: usar formato SIMPLE
      const simpleFormats = ['multiple_choice', 'true_false', 'matching']
      nextFormat = simpleFormats.find(f => !recentFormats.slice(-2).includes(f)) || 'multiple_choice'
      strategyReasoning = `Después de explicar, verificar con ${nextFormat}`
      
    } else {
      // ─── SIGUIENTE EVALUACIÓN — subir dificultad progresivamente ─
      const assessStrategy = decideAssessmentStrategy({
        evidence: updatedEvidence,
        knowledgeType: (currentInteraction?.knowledgeType || 'conceptual') as KnowledgeType,
        subjectArea: subjectArea as SubjectArea,
        targetMasteryLevel: 75,
        recentFormats,
        consecutiveFailures,
        isFirstAssessment: updatedEvidence.evidenceCount === 0,
      })
      nextFormat = assessStrategy.format
      strategyReasoning = assessStrategy.reasoning
    }

    console.log(`[respond] Strategy: ${strategyReasoning}`)

    // Concepto para el siguiente paso
    const nextConcept = shouldAdvance && nextUnit
      ? (nextUnit.title || nextUnit.name || concept)
      : concept

    const nextUnitData = shouldAdvance && nextUnit ? nextUnit : null

    // ── PROMPT PARA GENERAR LA SIGUIENTE INTERACCIÓN ─────────────
    const nextAction = shouldAdvance && allCovered ? 'close_session' :
      needsReteach ? 'reteach' :
      shouldAdvance ? 'next_concept' : 'practice_more'

    const interactionPrompt = buildInteractionPrompt({
      format: nextFormat,
      objective: nextObjective,
      concept: nextConcept,
      unit: nextUnitData || currentInteraction?.unit || { rawTextReference: materialText?.slice(0, 3000) },
      materialText: materialText?.slice(0, 4000) || '',
      subjectArea,
      materialTitle,
      errorType,
      previousAnswer: typeof studentAnswer === 'string' ? studentAnswer : '',
      wasCorrect,
      consecutiveFailures: needsReteach ? consecutiveFailures : 0,
      isReteach: needsReteach,
      isFinalRecall: allCovered || nextFormat === 'active_recall',
    })

    const interactionRes = await alaiRequest(async (client: any, modelFn: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
        {
          role: 'system',
          content: 'Generas interacciones pedagógicas usando el texto real del material. Solo JSON válido.',
        },
        { role: 'user', content: interactionPrompt },
      ],
        temperature: 0.3,
        max_tokens: 1500,
      })
      const rawText = res?.choices?.[0]?.message?.content || ''
      if (!rawText.trim()) throw new Error('ALAI_EMPTY_RESPONSE')
      return { text: rawText, provider: 'unknown', model: 'unknown' }
    })

    let nextInteraction = safeParseJson(interactionRes.text)
    if (!nextInteraction) {
      nextInteraction = buildFallbackInteraction(nextFormat, nextConcept, nextObjective)
    }

    // ═══════════════════════════════════════════════════════════════
    // VALIDACIÓN CRÍTICA — garantizar que nextInteraction sea válido
    // ═══════════════════════════════════════════════════════════════
    const isTeachingFormat = ['explain', 'analogy', 'example', 'context', 'step_by_step', 'worked_example'].includes(nextFormat)
    
    // Detectar si la interacción está incompleta según su formato
    function isIncomplete(inter: any, fmt: string): boolean {
      if (!inter) return true
      if (isTeachingFormat) {
        return !inter.content && !inter.question
      }
      // Formatos que requieren pregunta
      const hasQuestion = !!(inter.question || inter.prompt)
      if (!hasQuestion) return true
      
      // Validaciones específicas por formato
      if (fmt === 'multiple_choice') {
        return !Array.isArray(inter.options) || inter.options.length < 2 || inter.correctAnswer === undefined
      }
      if (fmt === 'true_false') {
        return inter.correctAnswer === undefined && inter.correctAnswer !== false
      }
      if (fmt === 'matching') {
        return !Array.isArray(inter.pairs) || inter.pairs.length < 2
      }
      if (fmt === 'ordering') {
        return !Array.isArray(inter.items) || inter.items.length < 2
      }
      if (fmt === 'fill_blank') {
        return !inter.answer && (!inter.wordBank || inter.wordBank.length === 0)
      }
      // short_answer, comparison, cause_effect, case_study, harder_problem solo necesitan question
      return false
    }
    
    // Forzar formato final ANTES del enriquecimiento
    let finalFormat = nextFormat
    
    if (isIncomplete(nextInteraction, nextFormat)) {
      console.warn(`[respond] Interacción incompleta para format=${nextFormat}. Fallback → short_answer`)
      
      if (isTeachingFormat) {
        // Fallback de enseñanza
        const unitText = currentInteraction?.unit?.rawTextReference || materialText?.slice(0, 400) || ''
        nextInteraction = {
          content: `Vamos a estudiar "${nextConcept}". ${unitText.slice(0, 300)}`,
          keyIdea: nextConcept,
        }
        finalFormat = nextFormat
      } else {
        // Fallback SIEMPRE a short_answer (funciona sin datos extra)
        nextInteraction = {
          question: `Según el material, ¿qué sabes sobre "${nextConcept}"? Explica con tus propias palabras.`,
          acceptedAnswers: [nextConcept],
          explanation: `Respuesta basada en el material sobre ${nextConcept}.`,
        }
        finalFormat = 'short_answer'
      }
    }

    // Enriquecer con metadatos del motor
    // IMPORTANTE: finalFormat prevalece sobre cualquier format que venga en la respuesta de ALAI
    nextInteraction = {
      ...nextInteraction,
      id: `int_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      format: finalFormat,
      type: finalFormat,
      objective: nextObjective,
      concept: nextConcept,
      knowledgeType: currentInteraction?.knowledgeType || 'conceptual',
      unit: nextUnitData || currentInteraction?.unit,
      isTeaching: isTeachingFormat,
      isFinalRecall: allCovered && (finalFormat === 'active_recall' || finalFormat === 'short_answer'),
    }
    
    console.log(`[respond] nextInteraction: format=${finalFormat} | hasQuestion=${!!nextInteraction.question} | hasContent=${!!nextInteraction.content}`)

    // Actualizar cobertura
    const newCoveredUnits = shouldAdvance && nextUnit
      ? [...coveredUnits, nextUnit.id || nextUnit.title]
      : coveredUnits
    const newRemainingUnits = shouldAdvance && nextUnit
      ? remainingUnits.slice(1)
      : remainingUnits

    console.log(`[respond] concept: "${concept}" | correct: ${wasCorrect} | score: ${score} | nextAction: ${nextAction} | nextFormat: ${nextFormat} | nextObjective: ${nextObjective}`)

    return NextResponse.json({
      success: true,
      // Evaluación de la respuesta actual
      evaluation: evaluationResult ? {
        correct: wasCorrect,
        score,
        errorType,
        whatWasCorrect: evaluationResult.whatWasCorrect || '',
        whatWasMissing: evaluationResult.whatWasMissing || '',
        correctExplanation: evaluationResult.correctExplanation || '',
        falseConfidence,
        conceptsIdentified: evaluationResult.conceptsIdentified || [],
        conceptsMissing: evaluationResult.conceptsMissing || [],
      } : null,
      // Decisión del motor
      decision: {
        nextAction,
        wasCorrect,
        score,
        shouldAdvance,
        needsReteach,
        falseConfidence,
        consecutiveFailures: needsReteach ? consecutiveFailures + 1 : 0,
      },
      // Siguiente interacción
      nextInteraction,
      // Estado actualizado
      updatedState: {
        coveredUnits: newCoveredUnits,
        remainingUnits: newRemainingUnits,
        totalCovered: newCoveredUnits.length,
        isSessionComplete: allCovered && (nextFormat === 'active_recall' ||
          currentObjective === 'synthesis'),
        conceptEvidences: {
          ...(sessionState?.conceptEvidences || {}),
          [concept]: updatedEvidence,
        },
        isReteachStep,
      },
      // Motor de estrategia
      strategy: {
        format: nextFormat,
        reasoning: strategyReasoning,
        targetDimension: updatedEvidence.weakestDimension,
      },
      // Estado del concepto
      conceptStatus: getConceptStatus(updatedEvidence),
      isConceptMastered: isConceptMastered(updatedEvidence, '80'),
    })

  } catch (err: any) {
    console.error('[respond]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

// ── Construir prompt según formato ───────────────────────────────
function buildInteractionPrompt(params: {
  format: string
  objective: string
  concept: string
  unit: any
  materialText: string
  subjectArea: string
  materialTitle: string
  errorType: string
  previousAnswer: string
  wasCorrect: boolean
  consecutiveFailures: number
  isReteach: boolean
  isFinalRecall: boolean
}): string {
  const { format, objective, concept, unit, materialText, subjectArea, errorType,
          previousAnswer, wasCorrect, isReteach, isFinalRecall } = params

  const unitText = unit?.rawTextReference || unit?.content || materialText.slice(0, 2000)
  const keyFacts = unit?.keyFacts?.join(', ') || ''
  const learningObjectives = unit?.learningObjectives?.join('; ') || ''

  const reteachNote = isReteach
    ? `IMPORTANTE: El estudiante falló la pregunta anterior. Error tipo: "${errorType}". Su respuesta fue: "${previousAnswer}". 
       ${errorType === 'false_confidence' ? 'Tenía falsa confianza. Usa una pregunta que demuestre el error claramente.' : ''}
       ${errorType === 'vocabulary' ? 'No conoce los términos. Define primero, luego evalúa.' : ''}
       ${errorType === 'relation' ? 'No conecta las ideas. Usa matching o comparación.' : ''}
       Usa un ángulo COMPLETAMENTE diferente al anterior.`
    : ''

  const formatInstructions: Record<string, string> = {
    explain: `Genera una explicación CORTA y ESPECÍFICA de "${concept}".
REGLAS:
- Máximo 4 oraciones
- Usa SOLO información del texto del material (cita hechos reales)
- Define términos técnicos cuando aparezcan
- Termina con "Para recordar: [frase ancla corta]"
- NO inventar información

Devuelve:
{
  "type": "explain",
  "content": "explicación en 3-4 oraciones máximo",
  "keyIdea": "frase ancla de máximo 10 palabras",
  "recallPrompt": "pregunta corta para verificar comprensión después"
}`,

    analogy: `Genera una ANALOGÍA para explicar "${concept}" desde otro ángulo.
El estudiante no entendió con la explicación directa.
Usa algo cotidiano y obvio.

Devuelve:
{
  "type": "analogy",
  "content": "La analogía: [concepto] es como [algo cotidiano] porque [razón]. Esto importa porque [conexión con el material].",
  "keyIdea": "frase ancla corta"
}`,

    multiple_choice: `Genera UNA pregunta de opción múltiple sobre "${concept}".
Usa información ESPECÍFICA del material (nombres, hechos, eventos reales).
La pregunta debe medir ${objective}.

${reteachNote}

Devuelve:
{
  "type": "multiple_choice",
  "question": "pregunta que use información real del material",
  "options": ["opción A", "opción B", "opción C", "opción D"],
  "correctAnswer": 0,
  "explanation": "Por qué es correcta, citando el material"
}`,

    true_false: `Genera UNA afirmación verdadera o falsa sobre "${concept}".
Usa un hecho específico del material.
${reteachNote}

Devuelve:
{
  "type": "true_false",
  "question": "afirmación específica basada en el material",
  "correctAnswer": true,
  "explanation": "por qué es verdadera/falsa según el material"
}`,

    fill_blank: `Genera UNA pregunta de completar espacio sobre "${concept}".
Usa una frase real o paráfrasis del material.

Devuelve:
{
  "type": "fill_blank",
  "question": "El _____ fue quien revolucionó la posición de quarterback",
  "answer": "respuesta correcta",
  "wordBank": ["opción1", "opción2", "opción3", "opción4"],
  "explanation": "explicación según el material"
}`,

    matching: `Genera un ejercicio de RELACIONAR para "${concept}".
Usa personas, conceptos o eventos reales del material.
Exactamente 3-4 pares.

Devuelve:
{
  "type": "matching",
  "question": "Relaciona cada elemento con su descripción",
  "pairs": [
    {"left": "elemento del material", "right": "descripción del material"},
    {"left": "elemento 2", "right": "descripción 2"},
    {"left": "elemento 3", "right": "descripción 3"}
  ],
  "explanation": "cómo se relacionan según el material"
}`,

    ordering: `Genera un ejercicio de ORDENAR para "${concept}".
Usa eventos, pasos o elementos cronológicos reales del material.

Devuelve:
{
  "type": "ordering",
  "question": "Ordena estos elementos correctamente",
  "items": ["elemento 1", "elemento 2", "elemento 3", "elemento 4"],
  "correctOrder": [0, 1, 2, 3],
  "explanation": "por qué este orden según el material"
}`,

    comparison: `Genera una pregunta de COMPARACIÓN para "${concept}".
Compara dos elementos reales del material.

Devuelve:
{
  "type": "comparison",
  "question": "¿En qué se diferencia [A] de [B] según el material?",
  "correctAnswer": "las diferencias clave según el texto",
  "explanation": "comparación basada en el material"
}`,

    cause_effect: `Genera una pregunta de CAUSA Y EFECTO para "${concept}".
Usa una relación causal real del material.

Devuelve:
{
  "type": "cause_effect",
  "question": "¿Por qué [causa del material] llevó a [efecto del material]?",
  "correctAnswer": "explicación de la cadena causal del material",
  "explanation": "la cadena causa-efecto según el texto"
}`,

    case_study: `Genera un CASO PRÁCTICO basado en "${concept}".
El caso debe requerir aplicar conocimiento del material.

Devuelve:
{
  "type": "case_study",
  "question": "descripción del caso que requiere aplicar el concepto",
  "correctAnswer": "cómo aplicar el concepto del material al caso",
  "explanation": "por qué esta es la respuesta correcta"
}`,

    short_answer: `Genera UNA pregunta de respuesta corta sobre "${concept}".
${isReteach ? 'El estudiante falló antes. Pregunta algo diferente desde otro ángulo.' : ''}
${isFinalRecall ? 'Es el CIERRE DE SESIÓN. Pide síntesis de todo lo aprendido.' : ''}

Devuelve:
{
  "type": "short_answer",
  "question": "${isFinalRecall ? 'Explica en 2-3 oraciones todo lo que aprendiste hoy sobre el tema.' : 'pregunta específica'}",
  "acceptedAnswers": ["respuesta1", "elementos clave que deben aparecer"],
  "explanation": "qué se esperaba según el material"
}`,

    active_recall: `Genera una pregunta de RECALL ACTIVO para "${concept}".
${isFinalRecall ? 'Es el CIERRE. Pide reconstruir el conocimiento completo.' : ''}

Devuelve:
{
  "type": "active_recall",
  "question": "${isFinalRecall ? 'Sin mirar el material, explica todo lo que aprendiste en esta sesión. ¿Qué fue lo más importante? ¿Qué conceptos se conectan?' : `Explica "${concept}" con tus propias palabras sin mirar el material.`}",
  "evaluationCriteria": ["criterio 1 que debe mencionar", "criterio 2", "criterio 3"]
}`,
  }

  const formatInstruction = formatInstructions[format] || formatInstructions.multiple_choice

  return `Eres un tutor generando la siguiente interacción pedagógica para un estudiante.

CONCEPTO ACTUAL: "${concept}"
OBJETIVO COGNITIVO: ${objective}
ÁREA: ${subjectArea}
FORMATO ELEGIDO: ${format}

TEXTO DEL MATERIAL (usa información REAL de aquí, no inventes):
"${unitText}"

HECHOS CLAVE DEL MATERIAL: ${keyFacts}
OBJETIVOS DE APRENDIZAJE: ${learningObjectives}

${reteachNote}

${formatInstruction}`
}

// ── Fallback de interacción ──────────────────────────────────────
function buildFallbackInteraction(format: string, concept: string, objective: string): any {
  const base = { type: format, concept, objective }

  if (format === 'explain') {
    return { ...base, content: `Vamos a estudiar "${concept}".`, keyIdea: concept, recallPrompt: `¿Qué es "${concept}"?` }
  }
  if (format === 'true_false') {
    return { ...base, question: `¿Es correcto lo que dice el material sobre "${concept}"?`, correctAnswer: true, explanation: 'Basado en el material.' }
  }
  if (format === 'active_recall') {
    return { ...base, question: `Explica "${concept}" con tus propias palabras.`, evaluationCriteria: [concept] }
  }
  return { ...base, question: `¿Qué sabes sobre "${concept}"?`, correctAnswer: '', explanation: '' }
}
