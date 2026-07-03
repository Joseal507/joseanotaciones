'use client'
import React from 'react'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { AdaptiveSession } from '../../../../lib/adaptive'
import {
  createSessionMemory, updateConceptState, saveSessionMemory,
  loadSessionMemory, getPriorityForNextSession,
} from '../../../../lib/adaptive/sessionMemory'
import type { SessionMemory } from '../../../../lib/adaptive/sessionMemory'
import { buildAdaptiveContext, serializeAdaptiveContext } from '../../../../lib/adaptive/adaptiveContext'
import MatchingCanvas from './MatchingCanvas'

interface Props {
  session: AdaptiveSession
  materialContent: string
  masteryContext: any
  onSessionComplete: (result: {
    domainGain: number
    conceptsImproved: string[]
    stepResults: Array<{ stepId: string; score?: number; correct?: boolean }>
  }) => void
  onClose: () => void
}

// ── Tipos de actividad ──────────────────────────────────────────
type ActivityType =
  | 'explain'           // Explicación del concepto
  | 'doubt_chat'        // Chat para dudas post-explicación
  | 'quiz'              // Quiz (cualquier tipo)
  | 'flashcards'        // Ver flashcards
  | 'flashcard_repaso'  // Repaso espaciado de flashcards
  | 'recall'            // Recall activo (legacy)
  | 'active_recall'     // Recall activo (nuevo)
  | 'reflection'        // Reflexión metacognitiva
  | 'reflection_chat'   // Chat post-reflexión
  | 'practice'          // Práctica opcional al final
  | 'context'           // Contexto previo
  | 'analogy'           // Analogía
  | 'worked_example'    // Ejemplo trabajado
  | 'step_by_step'      // Paso a paso
  | 'guided_practice'   // Práctica guiada
  | 'micro_quiz'        // Mini quiz
  | 'comparison'        // Comparación
  | 'cause_effect'      // Causa y efecto
  | 'position_a'        // Posición A
  | 'position_b'        // Posición B
  | 'identify'          // Identificación
  | 'case_study'        // Caso de estudio
  | 'actors'            // Actores
  | 'harder_problem'    // Problema difícil
  | 'micro_flashcards'  // Micro flashcards
  | 'metacognition'     // Metacognición
  | 'repair'            // Reparación
  | 'coach_feedback'    // Feedback del coach
  | 'mini_exam'         // Mini examen

type KnowledgeType =
  | 'conceptual' | 'procedural' | 'mathematical' | 'medical'
  | 'legal' | 'historical' | 'narrative' | 'classification'
  | 'memorization' | 'causal' | 'argumentative' | 'memoristic' | 'visual'

type LearningGoal =
  | 'explain_concept' | 'apply_to_case' | 'solve_problem'
  | 'memorize_facts' | 'compare_contrast' | 'argue_position'
  | 'identify_pattern' | 'simulate_exam'

interface SessionStep {
  id: string
  type: ActivityType
  concept?: string
  concepts?: string[]
  instruction?: string
  mode?: string
  questionTypes?: string[]
  count?: number
  isOptional?: boolean
  isFallback?: boolean
  actType?: ActivityType
  knowledgeType?: KnowledgeType
  learningGoal?: LearningGoal
}

// ═══════════════════════════════════════════════════════════════
// REPAIR CYCLE — ciclo de reparación según knowledgeType
// ═══════════════════════════════════════════════════════════════
function buildRepairCycle(
  concept: string,
  concepts: string[] | undefined,
  kt: string,
  lg: string,
  isBlocked: boolean
): SessionStep[] {
  const id = () => 'repair_' + Math.random().toString(36).slice(2, 8)

  // Instrucción de repair según tipo de conocimiento
  const repairInstruction = isBlocked
    ? `Volvamos a "${concept}" desde cero. Esta vez con un ejemplo muy concreto y simple.`
    : `Profundicemos en "${concept}" desde otro ángulo para aclarar lo que faltó.`

  // Paso 1: reexplicación simple siempre
  const explainStep: SessionStep = {
    id: id(), type: 'explain', concept, concepts,
    instruction: repairInstruction,
    mode: 'repair', actType: 'explain', knowledgeType: kt as any, learningGoal: lg as any,
  }

  // Paso 2: ejemplo o analogía según tipo
  const deepenStep: SessionStep = {
    id: id(), type: 'explain', concept, concepts,
    instruction: kt === 'mathematical' || kt === 'procedural'
      ? `Resolvamos juntos un ejemplo paso a paso de "${concept}".`
      : kt === 'medical' || kt === 'causal'
      ? `Analicemos la cadena causa-efecto de "${concept}" con un caso concreto.`
      : kt === 'legal' || kt === 'argumentative'
      ? `Apliquemos "${concept}" a un caso simple con argumento directo.`
      : kt === 'memoristic'
      ? `Agrupa los elementos de "${concept}" en categorías para recordarlos mejor.`
      : `Veamos "${concept}" desde una analogía diferente para que quede claro.`,
    mode: kt === 'mathematical' || kt === 'procedural' ? 'worked_example' : 'analogy',
    actType: kt === 'mathematical' || kt === 'procedural' ? 'worked_example' : 'analogy',
    knowledgeType: kt as any, learningGoal: lg as any,
  }

  // Paso 3: verificación simple
  const verifyStep: SessionStep = {
    id: id(), type: 'quiz', concept, concepts,
    instruction: `Una pregunta simple para verificar que "${concept}" quedó claro.`,
    count: 1, isFallback: true,
    actType: 'micro_quiz', knowledgeType: kt as any, learningGoal: lg as any,
  }

  // Si estaba bloqueado (< 40), agregar recall corto final
  if (isBlocked) {
    const recallStep: SessionStep = {
      id: id(), type: 'active_recall', concept, concepts,
      instruction: `En una frase, ¿qué es "${concept}"? No mires el material.`,
      actType: 'active_recall', knowledgeType: kt as any, learningGoal: lg as any,
    }
    return [explainStep, deepenStep, verifyStep, recallStep]
  }

  return [explainStep, verifyStep]
}

export default function AdaptiveSessionV2({
  session, materialContent, masteryContext, onSessionComplete, onClose,
}: Props) {
  // ── Estado principal ──────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState<SessionStep | null>(null)
  const [currentContent, setCurrentContent] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<any[]>([])
  const [allScores, setAllScores] = useState<number[]>([])
  const [conceptsImproved, setConceptsImproved] = useState<string[]>([])
  const [finalizing, setFinalizing] = useState(false)
  const [showCelebration, setShowCelebration] = useState(false)

  // ── Plan de sesión ────────────────────────────────────────────
  const [plan, setPlan] = useState<SessionStep[]>([])
  const [planIndex, setPlanIndex] = useState(0)
  const [planLoading, setPlanLoading] = useState(true)
  const [planError, setPlanError] = useState<string | null>(null)
  const [planRetries, setPlanRetries] = useState(0)
  const planRef = useRef<SessionStep[]>([])
  const planIndexRef = useRef(0)
  useEffect(() => { planRef.current = plan }, [plan])
  useEffect(() => { planIndexRef.current = planIndex }, [planIndex])

  // ── Estado de interacción ────────────────────────────────────
  const [chatMessages, setChatMessages] = useState<Array<{role:'user'|'alai'; text:string}>>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [selectedOptions, setSelectedOptions] = useState<number[]>([])
  const [fillBlankAnswer, setFillBlankAnswer] = useState('')
  const [shortAnswer, setShortAnswer] = useState('')
  const [showQuizFeedback, setShowQuizFeedback] = useState(false)
  const [matchingAnswer, setMatchingAnswer] = useState<Record<number,number>>({})
  const [quizResult, setQuizResult] = useState<{correct: boolean; explanation: string; correctAnswer?: string} | null>(null)
  const [quizAnswers, setQuizAnswers] = useState<Array<{correct: boolean}>>([])
  const [currentQuizIdx, setCurrentQuizIdx] = useState(0)
  const [flashcardIdx, setFlashcardIdx] = useState(0)
  const [flashcardFlipped, setFlashcardFlipped] = useState(false)
  const [flashcardKnown, setFlashcardKnown] = useState<boolean[]>([])
  const [repasoCards, setRepasoCards] = useState<any[]>([])
  const [repasoIdx, setRepasoIdx] = useState(0)
  const [repasoFlipped, setRepasoFlipped] = useState(false)
  const [repasoRound, setRepasoRound] = useState(1)
  const [repasoComplete, setRepasoComplete] = useState(false)
  const [recallText, setRecallText] = useState('')
  const [recallFeedback, setRecallFeedback] = useState<any>(null)
  const [reflectionText, setReflectionText] = useState('')
  const [reflectionFeedback, setReflectionFeedback] = useState<any>(null)
  const [showPractice, setShowPractice] = useState(false)
  const [failCount, setFailCount] = useState<Record<string, number>>({})

  // ── Contexto y refs ───────────────────────────────────────────
  const lastExplanationRef = useRef('')
  const lastRecallPromptRef = useRef('')
  const explainedConceptsRef = useRef<string[]>([])  // Conceptos ya explicados en esta sesión
  const previousQuizTypesRef = useRef<string[]>([])
  const hasStartedRef = useRef(false)
  const sessionMemoryRef = useRef<SessionMemory>(
    createSessionMemory(session.id || 'sess_' + Date.now(), session.topicTitle || session.title, session.targetConcepts || [])
  )

  const adaptiveCtx = buildAdaptiveContext({
    session: {
      topicId: session.topicId, topicTitle: session.topicTitle,
      targetConcepts: session.targetConcepts, evidenceGoal: session.evidenceGoal,
      sourcePages: session.sourcePages, sessionNumber: session.sessionNumber,
      purpose: session.purpose,
    },
    step: { type: 'explain' },
    materialContent,
    materialTitle: (masteryContext as any)?.materialTitle ?? '',
    masterySnapshot: masteryContext as any,
  })

  // ═══════════════════════════════════════════════════════════════
  // CONSTRUIR PLAN DE SESIÓN
  // Flujo tutor: Explica → Duda → Evalúa → (Falla → Reexplica → Evalúa) → Siguiente
  // ═══════════════════════════════════════════════════════════════
  const buildPlan = (steps: any[]): SessionStep[] => {
    const plan: SessionStep[] = []

    // Tipos que se renderizan como 'explain'
    const EXPLAIN_TYPES = new Set([
      'explain', 'analogy', 'concrete_example', 'context',
      'worked_example', 'step_by_step', 'guided_practice',
    ])
    // Tipos que se renderizan como 'quiz'
    const QUIZ_TYPES = new Set([
      'micro_quiz', 'mini_exam', 'case_study', 'comparison',
      'cause_effect', 'position_a', 'position_b', 'identify',
      'actors', 'harder_problem',
    ])
    // Tipos que se renderizan como 'flashcards'
    const FLASH_TYPES = new Set(['micro_flashcards'])
    // Tipos que se renderizan como 'recall'
    const RECALL_TYPES = new Set(['active_recall', 'inverse_teaching'])
    // Tipos que se renderizan como 'reflection'
    const REFLECT_TYPES = new Set(['metacognition'])

    for (const step of steps) {
      const concept = step.conceptsTargeted?.[0] || session.topicTitle
      const meta = step.metadata || {}

      if (EXPLAIN_TYPES.has(step.type)) {
        // Determinar el modo de explicación según el actType
        const modeMap: Record<string, string> = {
          analogy: 'analogy',
          worked_example: 'worked_example',
          step_by_step: 'step_by_step',
          guided_practice: 'guided_practice',
          context: 'context',
        }
        const explainMode = modeMap[step.type] || step.mode || 'explain'

        plan.push({
          id: step.id || genId(),
          type: 'explain',
          concept,
          concepts: step.conceptsTargeted,
          instruction: step.instruction,
          mode: explainMode,
          actType: step.type,
          knowledgeType: meta.knowledgeType,
          learningGoal: meta.learningGoal,
        })

        // Chat de dudas SOLO después del primer explain de cada concepto
        // No después de analogy, worked_example, step_by_step, guided_practice
        const isFirstExplainOfConcept = step.type === 'explain' && !plan.some(
          p => p.type === 'doubt_chat' && p.concept === concept
        )
        if (isFirstExplainOfConcept) {
          plan.push({
            id: genId(),
            type: 'doubt_chat',
            concept,
            instruction: `¿Algo no quedó claro sobre "${concept}"? Pregúntame antes de continuar.`,
          })
        }

      } else if (QUIZ_TYPES.has(step.type)) {
        // Deduplicar: no agregar quiz del mismo concepto si ya hay uno reciente (últimos 3 pasos)
        const recentSteps = plan.slice(-3)
        const recentQuizSameConcept = recentSteps.some(
          p => p.type === 'quiz' && p.concept === concept && p.actType === step.type
        )
        if (!recentQuizSameConcept) {
          plan.push({
            id: step.id || genId(),
            type: 'quiz',
            concept,
            concepts: step.conceptsTargeted,
            instruction: step.instruction,
            count: step.type === 'mini_exam' ? 5 : 2,
            actType: step.type,
            knowledgeType: meta.knowledgeType,
            learningGoal: meta.learningGoal,
          })
        }

      } else if (FLASH_TYPES.has(step.type)) {
        plan.push({
          id: step.id || genId(),
          type: 'flashcards',
          concept,
          concepts: step.conceptsTargeted,
          instruction: step.instruction,
          knowledgeType: meta.knowledgeType,
        })
        plan.push({
          id: genId(),
          type: 'flashcard_repaso',
          concept,
          concepts: step.conceptsTargeted,
          instruction: `Repasa hasta dominarlas.`,
        })

      } else if (RECALL_TYPES.has(step.type)) {
        plan.push({
          id: step.id || genId(),
          type: 'active_recall',
          concept,
          concepts: step.conceptsTargeted,
          instruction: step.instruction,
          knowledgeType: meta.knowledgeType,
          learningGoal: meta.learningGoal,
        })

      } else if (REFLECT_TYPES.has(step.type)) {
        plan.push({
          id: step.id || genId(),
          type: 'reflection',
          concepts: step.conceptsTargeted,
          instruction: step.instruction,
          knowledgeType: meta.knowledgeType,
        })
        plan.push({
          id: genId(),
          type: 'reflection_chat',
          concepts: step.conceptsTargeted,
          instruction: `¿Tienes alguna duda final? También puedes pedir más práctica.`,
        })
      }
    }

    return plan
  }

  const genId = () => Math.random().toString(36).slice(2, 10)

  const getRepairInstruction = (failureType: string, concept: string): string => {
    const instructions: Record<string, string> = {
      vocabulary: `Volvamos a "${concept}" — esta vez definiendo cada término clave desde cero.`,
      relation: `Te faltó conectar las ideas de "${concept}". Ahora lo veremos con una analogía que une todo.`,
      application: `Entiendes la teoría de "${concept}" pero falta aplicarla. Veamos un ejemplo resuelto paso a paso.`,
      memory: `Repasemos "${concept}" — esta vez con otro enfoque para que quede grabado.`,
      formula: `La fórmula/mecanismo de "${concept}" no quedó claro. Lo veremos con números concretos del material.`,
      procedure: `El proceso de "${concept}" necesita verse paso a paso. Cada paso tiene una razón.`,
      argument: `El argumento sobre "${concept}" necesita más contexto. Veamos la posición y el contraargumento.`,
    }
    return instructions[failureType] || `Volvamos a "${concept}" desde otro ángulo completamente diferente.`
  }

  // ═══════════════════════════════════════════════════════════════
  // CARGAR PLAN DESDE API
  // ═══════════════════════════════════════════════════════════════
  const loadPlan = async () => {
    setPlanLoading(true)
    setPlanError(null)

    try {
      const blueprintTopics = (masteryContext as any)?.materialBlueprint?.topics || []
      const sessionTopicIds = (session as any).groupedTopicIds || [session.topicId].filter(Boolean)
      let topicsData = blueprintTopics.filter((t: any) =>
        sessionTopicIds.includes(t.id) || t.title === session.topicTitle
      )

      if (topicsData.length === 0) {
        topicsData = [{
          id: session.topicId || 'unknown',
          title: session.topicTitle || session.title,
          concepts: (session.targetConcepts || []).map((name: string) => ({ name, definition: '', difficulty: 50 })),
          difficulty: 50, importance: 70, sourcePages: session.sourcePages || [],
        }]
      }

      const previousEvidence: Record<string, number> = {}
      const topicMastery = (masteryContext as any)?.topicMastery || []
      for (const t of topicMastery) {
        if (t.concepts) for (const c of t.concepts) previousEvidence[c.name] = c.score || 0
      }

      const prevMemory = loadSessionMemory(session.topicTitle || session.title)
      const priority = prevMemory ? getPriorityForNextSession(prevMemory) : null

      const sessionLength = (masteryContext as any)?.setup?.sessionLength || (masteryContext as any)?.sessionLength || 'medium'

      const res = await fetch('/api/adaptive/plan-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionBlueprint: {
            title: session.title, objective: session.objective,
            purpose: session.purpose, estimatedMinutes: session.estimatedMinutes,
            rationale: (session as any).planRationale || '',
          },
          topics: topicsData, sessionLength, previousEvidence,
          userProfile: (masteryContext as any)?.userProfile || null,
          learningStyle: (masteryContext as any)?.learningMemory?.learningStyle || null,
          handoffNote: priority?.handoffNote || '',
          mustStartWith: priority?.mustStartWith || [],
          mustReinforce: priority?.mustReinforce || [],
          canSkip: priority?.canSkip || [],
          sessionNumber: session.sessionNumber || 1,
        }),
      })

      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = await res.json()
      if (!data.success || !data.steps?.length) throw new Error(data?.error || 'Sin actividades')

      const builtPlan = buildPlan(data.steps)
      setPlan(builtPlan)
      setPlanLoading(false)
      setPlanIndex(0)
      executeStep(builtPlan[0])

    } catch (err: any) {
      console.error('[plan] Error:', err.message)
      setPlanError(err.message || 'ALAI está ocupado.')
      setPlanLoading(false)
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EJECUTAR PASO
  // ═══════════════════════════════════════════════════════════════
  const executeStep = async (step: SessionStep) => {
    if (!step) return
    setCurrentStep(step)
    setCurrentContent(null)
    setLoading(true)
    // Reset estado de interacción
    setSelectedOption(null); setSelectedOptions([]); setFillBlankAnswer('')
    setShortAnswer(''); setShowQuizFeedback(false); setQuizResult(null)
    setQuizAnswers([]); setCurrentQuizIdx(0); setFlashcardIdx(0)
    setFlashcardFlipped(false); setFlashcardKnown([]); setRepasoCards([])
    setRepasoIdx(0); setRepasoFlipped(false); setRepasoRound(1)
    setRepasoComplete(false); setRecallText(''); setRecallFeedback(null)
    setReflectionText(''); setReflectionFeedback(null)
    setChatMessages([]); setChatInput('')

    const payload = {
      ...serializeAdaptiveContext(adaptiveCtx),
      topicTitle: session.topicTitle || session.title,
      targetConcepts: step.concepts || session.targetConcepts || [],
      focusConcept: step.concept || session.targetConcepts?.[0],
      lastExplanation: lastExplanationRef.current.slice(0, 2000),
      sessionNumber: session.sessionNumber || 1,
    }

    try {
      if (step.type === 'explain') {
        // Obtener failureType del último recall/quiz si es un repair
        const lastFailure = recallFeedback?.failureType || 'none'
        const res = await fetch('/api/adaptive/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            mode: (step as any).mode || 'explain',
            actType: step.actType || 'explain',
            knowledgeType: step.knowledgeType || 'conceptual',
            learningGoal: step.learningGoal || 'explain_concept',
            alreadyExplained: explainedConceptsRef.current,
            lastExplanation: lastExplanationRef.current.slice(0, 1000),
            // Pasar failureType para que ALAI adapte la explicación
            failureType: (step as any).mode === 'repair' ? lastFailure : 'none',
          }),
        })
        if (!res.ok) throw new Error('explain failed')
        const data = await res.json()
        lastExplanationRef.current = data.content || ''
        if (data.recallPrompt) lastRecallPromptRef.current = data.recallPrompt
        // Registrar que este concepto ya fue explicado
        const explainedConcept = step.concept || ''
        if (explainedConcept && !explainedConceptsRef.current.includes(explainedConcept)) {
          explainedConceptsRef.current = [...explainedConceptsRef.current, explainedConcept]
        }
        setCurrentContent(data)

      } else if (step.type === 'doubt_chat' || step.type === 'reflection_chat') {
        // El chat no necesita contenido previo — solo muestra la interfaz
        setCurrentContent({ type: step.type, ready: true })

      } else if (step.type === 'quiz') {
        const res = await fetch('/api/adaptive/quiz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            lastExplanation: lastExplanationRef.current.slice(0, 3000),
            questionTypes: step.questionTypes,
            count: step.count || 2,
            previousTypes: previousQuizTypesRef.current,
            actType: step.actType || 'micro_quiz',
            knowledgeType: step.knowledgeType || 'conceptual',
            learningGoal: step.learningGoal || 'explain_concept',
          }),
        })
        if (!res.ok) throw new Error('quiz failed')
        const data = await res.json()
        if (data.questionType) previousQuizTypesRef.current = [...previousQuizTypesRef.current, data.questionType].slice(-5)
        setCurrentContent(data)

      } else if (step.type === 'flashcards' || step.type === 'flashcard_repaso') {
        const res = await fetch('/api/adaptive/flashcards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, count: 6 }),
        })
        if (!res.ok) throw new Error('flashcards failed')
        const data = await res.json()
        const cards = data.cards || data.flashcards || []
        setCurrentContent({ ...data, cards })
        if (step.type === 'flashcard_repaso') {
          setRepasoCards(cards)
        }

      } else if (step.type === 'active_recall') {
        const res = await fetch('/api/adaptive/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, mode: 'repair' }),
        })
        const data = res.ok ? await res.json() : {}
        setCurrentContent({ ...data, recallPrompt: lastRecallPromptRef.current || step.instruction })

      } else if (step.type === 'reflection') {
        setCurrentContent({ type: 'reflection', ready: true })
      }

    } catch (err: any) {
      console.error('[executeStep]', err.message)
      setCurrentContent({ error: err.message })
    }
    setLoading(false)
  }

  // ═══════════════════════════════════════════════════════════════
  // AVANZAR AL SIGUIENTE PASO
  // ═══════════════════════════════════════════════════════════════
  const advance = async (result?: { score?: number; correct?: boolean; isExposure?: boolean }) => {
    const currentPlan = planRef.current
    const currentIdx = planIndexRef.current
    const nextIdx = currentIdx + 1
    const currentStepData = currentPlan[currentIdx]

    // Registrar resultado
    if (result && !result.isExposure) {
      const score = result.score ?? (result.correct ? 80 : 30)
      setAllScores(prev => [...prev, score])
      setHistory(prev => [...prev, {
        type: currentStepData?.type, score, concept: currentStepData?.concept,
        timestamp: Date.now(),
      }])

      // Si mejoró un concepto
      if (score >= 70 && currentStepData?.concept && !conceptsImproved.includes(currentStepData.concept)) {
        setConceptsImproved(prev => [...prev, currentStepData.concept!])
      }

      // [Removido: skip por score — necesita evidencia multidimensional, no score simple]

      // Actualizar SessionMemory
      if (currentStepData?.concept) {
        const actType = currentStepData.type === 'quiz' ? 'quiz'
          : currentStepData.type === 'flashcards' ? 'flashcard'
          : currentStepData.type === 'active_recall' ? 'recall' : 'explain'
        sessionMemoryRef.current = updateConceptState(sessionMemoryRef.current, currentStepData.concept, {
          activityType: actType as any, score,
        })
      }

      // Si falló quiz/recall → decidir si hace falta repair real
      if (score < 50 && (currentStepData?.type === 'quiz' || currentStepData?.type === 'active_recall')) {
        const concept = currentStepData.concept || ''
        const fails = (failCount[concept] || 0) + 1
        setFailCount(prev => ({ ...prev, [concept]: fails }))

        const failedRecall = currentStepData?.type === 'active_recall'
        const needsRepair = failedRecall || fails >= 2

        if (needsRepair) {
          // Insertar reexplicación + quiz simple SOLO cuando hay bloqueo real
          const reexplainStep: SessionStep = {
            id: 'reex_' + genId(), type: 'explain',
            concept, concepts: currentStepData.concepts,
            instruction: `Volvamos a "${concept}" desde otro ángulo. Esta vez lo veremos más simple y con un ejemplo concreto.`,
            mode: 'repair',
            actType: 'explain',
            knowledgeType: currentStepData.knowledgeType,
            learningGoal: currentStepData.learningGoal,
          }
          const reQuizStep: SessionStep = {
            id: 'req_' + genId(), type: 'quiz',
            concept, concepts: currentStepData.concepts,
            instruction: `Ahora que lo vimos diferente, intenta esta pregunta sobre "${concept}".`,
            count: 1, isFallback: true,
          }

          setPlan(prev => {
            const newPlan = [...prev]
            newPlan.splice(currentIdx + 1, 0, reexplainStep, reQuizStep)
            return newPlan
          })
          setPlanIndex(nextIdx)
          await executeStep(reexplainStep)
          return
        }
      }
    }

    // Terminar si no hay más pasos
    if (nextIdx >= currentPlan.length) {
      finishSession()
      return
    }

    setPlanIndex(nextIdx)
    await executeStep(currentPlan[nextIdx])
  }

  // ═══════════════════════════════════════════════════════════════
  // CHAT DE DUDAS
  // ═══════════════════════════════════════════════════════════════
  const sendChat = async (message: string) => {
    if (!message.trim() || chatLoading) return
    setChatInput('')
    setChatMessages(prev => [...prev, { role: 'user', text: message }])
    setChatLoading(true)

    try {
      const ctx = serializeAdaptiveContext(adaptiveCtx)
      // Contexto: primero la explicación que acaba de leer, luego el material
      const recentExplanation = lastExplanationRef.current
      const chatMaterialContext = recentExplanation.length > 100
        ? recentExplanation
        : (ctx as any).contenido || ''

      // Historial del chat para mantener coherencia
      const chatHistory = chatMessages.slice(-6).map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        text: m.text,
      }))

      const res = await fetch('/api/adaptive/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ctx,
          contenido: chatMaterialContext,
          lastExplanation: recentExplanation.slice(0, 2000),
          chatHistory,
          message,
          topicTitle: currentStep?.concept || session.topicTitle,
          targetConcepts: currentStep?.concepts || session.targetConcepts || [],
          knowledgeType: (currentStep as any)?.knowledgeType || 'conceptual',
          learningGoal: (currentStep as any)?.learningGoal || 'explain_concept',
        }),
      })

      const data = await res.json()
      const response = data.message || data.content || 'No pude responder eso. Intenta reformular tu pregunta.'
      setChatMessages(prev => [...prev, { role: 'alai', text: response }])

      // Detectar si el usuario no entendió → insertar repair
      // Detectar confusión profunda — activar rescue mode
      const confusedPatterns = /no entend|no sé|no se|confund|me perdí|me perdi|no me quedó|no me quedo|no captè|no captè|no comprend|muchas dudas|explícame todo|explicame todo|no sé nada|no sé nada/i
      const isGeneralConfusion = /muchas dudas|explícame todo|explicame todo|no sé nada|no entendí nada|no entendi nada/i

      if (confusedPatterns.test(message)) {
        const repairConcept = currentStep?.concept || session.targetConcepts?.[0] || ''
        const kt = currentStep?.knowledgeType || 'conceptual'
        const lg = currentStep?.learningGoal || 'explain_concept'

        if (repairConcept) {
          // Confusión general → rescue mode completo (4 pasos)
          // Confusión parcial → repair simple (2 pasos)
          const isBlocked = isGeneralConfusion.test(message)
          const repairCycle = buildRepairCycle(repairConcept, currentStep?.concepts, kt, lg, isBlocked)

          setPlan(prev => {
            const currentIdx = planIndexRef.current
            const newPlan = [...prev]
            newPlan.splice(currentIdx + 1, 0, ...repairCycle)
            return newPlan
          })

          // Si es confusión general, agregar mensaje especial
          if (isBlocked) {
            setChatMessages(prev => [...prev, {
              role: 'alai',
              text: `Veo que hay una duda más profunda. Antes de seguir, vamos a trabajar "${repairConcept}" desde cero con un enfoque diferente. No te preocupes — esto es normal y vamos a resolverlo paso a paso.`
            }])
            setChatLoading(false)
            return
          }
        }
      }
    } catch {
      setChatMessages(prev => [...prev, { role: 'alai', text: 'Hubo un error. Intenta de nuevo.' }])
    }
    setChatLoading(false)
  }

  // ═══════════════════════════════════════════════════════════════
  // RECALL SUBMIT
  // ═══════════════════════════════════════════════════════════════
  const submitRecall = async () => {
    if (!recallText.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/adaptive/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...serializeAdaptiveContext(adaptiveCtx),
          message: recallText,
          concept: currentStep?.concept,
          stepType: 'active_recall',
          evaluateWithFeedback: true,
          recallPrompt: lastRecallPromptRef.current || currentContent?.recallPrompt || '',
          lastExplanation: lastExplanationRef.current.slice(0, 2000),
        }),
      })
      const data = await res.json()
      // Parsear correctamente
      let feedback = data
      if (typeof data.score === 'undefined' && data.message) {
        try {
          const parsed = JSON.parse(data.message)
          if (parsed.score !== undefined) feedback = parsed
        } catch {}
      }
      const cleanStr = (s: any) => String(s || '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/#{1,6}\s/g, '')
      const realScore = Math.min(100, Math.max(0, Number(feedback.score) || 50))
      const failureType = feedback.failureType || 'none'
      
      setRecallFeedback({
        score: realScore,
        failureType,
        correctThings: cleanStr(feedback.correctThings),
        wrongOrMissing: cleanStr(feedback.wrongOrMissing),
        keyExplanation: cleanStr(feedback.keyExplanation),
        answerToDubts: cleanStr(feedback.answerToDubts),
        keyIdea: cleanStr(feedback.keyIdea),
      })

      // Recall < 40 = bloqueo conceptual — repair profundo inmediato
      // Recall 40-60 = comprensión parcial — repair simple
      const concept = currentStep?.concept || ''
      const kt = currentStep?.knowledgeType || 'conceptual'
      const lg = currentStep?.learningGoal || 'explain_concept'

      if (realScore < 60 && concept) {
        const isBlocked = realScore < 40
        const alreadyRepairing = planRef.current.some(s => s.id.startsWith('repair_'))

        if (!alreadyRepairing) {
          // Ciclo de repair según knowledgeType
          const repairCycle: SessionStep[] = buildRepairCycle(concept, currentStep?.concepts, kt, lg, isBlocked)

          setPlan(prev => {
            const currentIdx = planIndexRef.current
            const newPlan = [...prev]
            newPlan.splice(currentIdx + 1, 0, ...repairCycle)
            return newPlan
          })
        }
      }
    } catch { setRecallFeedback({ score: 50, keyExplanation: 'No pude evaluar tu respuesta.' }) }
    setLoading(false)
  }

  // ═══════════════════════════════════════════════════════════════
  // REFLECTION SUBMIT
  // ═══════════════════════════════════════════════════════════════
  const submitReflection = async () => {
    if (!reflectionText.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/adaptive/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...serializeAdaptiveContext(adaptiveCtx),
          message: reflectionText,
          concept: session.topicTitle,
          stepType: 'metacognition',
          evaluateWithFeedback: true,
          lastExplanation: lastExplanationRef.current.slice(0, 2000),
        }),
      })
      const data = await res.json()
      let feedback = data
      if (typeof data.score === 'undefined' && data.message) {
        try {
          const parsed = JSON.parse(data.message)
          if (parsed.score !== undefined) feedback = parsed
        } catch {}
      }
      const cleanStr = (s: any) => String(s || '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/#{1,6}\s/g, '')
      // Limpiar JSON crudo si viene embebido en el texto
      const cleanJson = (s: any) => {
        const str = cleanStr(s)
        // Si parece JSON, intentar parsear y extraer solo el texto relevante
        if (str.startsWith('{') || str.includes('"score"')) {
          try {
            const parsed = JSON.parse(str)
            return parsed.keyExplanation || parsed.wrongOrMissing || parsed.correctThings || str
          } catch {}
        }
        return str
      }
      setReflectionFeedback({
        score: Number(feedback.score) || 60,
        correctThings: cleanStr(feedback.correctThings),
        wrongOrMissing: cleanJson(feedback.wrongOrMissing),
        keyExplanation: cleanStr(feedback.keyExplanation),
        answerToDubts: cleanStr(feedback.answerToDubts),
        keyIdea: cleanStr(feedback.keyIdea),
      })
    } catch { setReflectionFeedback({ score: 60, keyExplanation: 'Gracias por tu reflexión.' }) }

    // NO marcar como dominado si el estudiante expresó confusión
    const confusedInReflection = /no entend|no entendí|no entendi|no sé|no se|me perdí|me perdi|no comprend|estoy perdido|no me quedó|no me quedo|nada claro/i
    if (confusedInReflection.test(reflectionText)) {
      const concept = currentStep?.concept
      if (concept) {
        setConceptsImproved(prev => prev.filter(c => c !== concept))
        console.log(`⚠ [Reflection] "${concept}" desmarcado — estudiante expresó confusión`)
      }
      // Insertar sesión de rescue antes de cerrar
      const kt = currentStep?.knowledgeType || 'conceptual'
      const lg = currentStep?.learningGoal || 'explain_concept'
      const rescueSteps = buildRepairCycle(concept || session.topicTitle, currentStep?.concepts, kt, lg, true)
      setPlan(prev => {
        const currentIdx = planIndexRef.current
        const newPlan = [...prev]
        newPlan.splice(currentIdx + 1, 0, ...rescueSteps)
        return newPlan
      })
    }

    setLoading(false)
  }

  // ═══════════════════════════════════════════════════════════════
  // QUIZ HANDLERS
  // ═══════════════════════════════════════════════════════════════
  const normStr = (s: string) => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/gi,' ').replace(/\s+/g,' ').trim()

  const submitQuizAnswer = (questions: any[], directAnswer?: any) => {
    const q = questions[currentQuizIdx]
    if (!q) return

    let correct = false
    let correctAnswerText = ''

    if (q.type === 'multiple_choice') {
      const ans = directAnswer !== undefined ? directAnswer : selectedOption
      correct = ans === q.correctAnswer
      correctAnswerText = q.options?.[q.correctAnswer] || ''
    } else if (q.type === 'true_false') {
      const ans = directAnswer !== undefined ? directAnswer : selectedOption
      const correctIsTrue = q.correctAnswer === true || q.correctAnswer === 0
        || String(q.correctAnswer).toLowerCase() === 'true'
        || String(q.correctAnswer).toLowerCase() === 'verdadero'
      correct = ans === (correctIsTrue ? 0 : 1)
      correctAnswerText = correctIsTrue ? 'Verdadero' : 'Falso'
    } else if (q.type === 'multi_select') {
      const correctSet = new Set(q.correctAnswers || [])
      const selectedSet = new Set(selectedOptions)
      const correctSelected = [...selectedSet].filter(i => correctSet.has(i)).length
      const wrongSelected = [...selectedSet].filter(i => !correctSet.has(i)).length
      const score = Math.max(0, (correctSelected - wrongSelected) / Math.max(correctSet.size, 1)) * 100
      correct = score >= 85
      correctAnswerText = (q.correctAnswers || []).map((i: number) => q.options?.[i]).join(', ')
    } else if (q.type === 'fill_blank') {
      const user = normStr(fillBlankAnswer)
      const ans = normStr(q.answer || '')
      correct = user === ans || user.includes(ans) || ans.includes(user)
      if (!correct && user.length > 2) {
        const uWords = user.split(' ').filter(Boolean)
        const aWords = ans.split(' ').filter(Boolean)
        const matches = uWords.filter(w => aWords.some(aw => aw.includes(w) || w.includes(aw)))
        correct = matches.length / Math.max(aWords.length, 1) >= 0.6
      }
      correctAnswerText = q.answer || ''
    } else if (q.type === 'short_answer') {
      const user = normStr(shortAnswer)
      const accepted = (q.acceptedAnswers || []).map(normStr)
      correct = accepted.some((a: string) => user === a || user.includes(a) || a.includes(user))
      if (!correct && user.length > 3) {
        const uWords = user.split(' ').filter(Boolean)
        const allWords = accepted.flatMap((a: string) => a.split(' ')).filter(Boolean)
        const matches = uWords.filter(w => allWords.some(aw => aw.includes(w) || w.includes(aw)))
        correct = matches.length / Math.max(uWords.length, 1) >= 0.5
      }
      correctAnswerText = (q.acceptedAnswers || [])[0] || ''
    } else if (q.type === 'matching') {
      const pairs = q.pairs || []
      const ok = pairs.filter((_: any, i: number) => matchingAnswer[i] === i).length
      correct = ok === pairs.length
      correctAnswerText = ok + '/' + pairs.length + ' conexiones correctas'
    }

    setQuizResult({ correct, explanation: q.explanation || '', correctAnswer: correctAnswerText })
    setShowQuizFeedback(true)
    setQuizAnswers((prev: any) => [...prev, { correct }])
  }

  const advanceQuiz = async (questions: any[]) => {
    setShowQuizFeedback(false)
    setSelectedOption(null); setSelectedOptions([]); setFillBlankAnswer(''); setShortAnswer('')

    if (currentQuizIdx + 1 < questions.length) {
      setCurrentQuizIdx(prev => prev + 1)
    } else {
      const correct = quizAnswers.filter(a => a.correct).length
      const score = Math.round((correct / questions.length) * 100)
      await advance({ score })
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FLASHCARD HANDLERS
  // ═══════════════════════════════════════════════════════════════
  const handleFlashcardAnswer = (knew: boolean) => {
    const cards = currentContent?.cards || []
    const newKnown = [...flashcardKnown]
    newKnown[flashcardIdx] = knew
    setFlashcardKnown(newKnown)
    setFlashcardFlipped(false)

    if (flashcardIdx + 1 < cards.length) {
      setFlashcardIdx(prev => prev + 1)
    } else {
      // Terminó de ver todas → ir a repaso
      const score = Math.round((newKnown.filter(Boolean).length / cards.length) * 100)
      advance({ score, isExposure: true }) // Las flashcards de lectura son exposición
    }
  }

  const handleRepasoAnswer = (knew: boolean) => {
    const cards = repasoCards
    if (!knew && repasoRound <= 3) {
      // Mover al final para repetir
      const current = cards[repasoIdx]
      const newCards = [...cards.filter((_, i) => i !== repasoIdx), current]
      setRepasoCards(newCards)
    }
    setRepasoFlipped(false)

    const nextIdx = repasoIdx + 1
    if (nextIdx >= repasoCards.length) {
      const allKnown = knew
      if (!allKnown && repasoRound < 3) {
        // Otra ronda con las que no sabía
        const failed = repasoCards.filter((_, i) => !flashcardKnown[i])
        if (failed.length > 0) {
          setRepasoCards(failed); setRepasoIdx(0); setRepasoRound(prev => prev + 1)
          return
        }
      }
      setRepasoComplete(true)
    } else {
      setRepasoIdx(nextIdx)
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FINISH SESSION
  // ═══════════════════════════════════════════════════════════════
  const finishSession = () => {
    if (finalizing) return

    const avgScore = allScores.length > 0
      ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : 0

    // ── VERIFICACIÓN DE DOMINIO MÍNIMO ──────────────────────────
    // Si el avg score es muy bajo Y todavía hay conceptos sin verificar
    // Y no se ha intentado reforzar antes → insertar refuerzo antes de cerrar
    const MIN_PASSING_SCORE = 55
    const conceptStates = Object.values(sessionMemoryRef.current.conceptStates)
    const unverifiedConcepts = conceptStates.filter(s =>
      s.status === 'unseen' || s.status === 'explained'
    ).map(s => s.name)
    const failedConcepts = conceptStates.filter(s =>
      s.status === 'attempted' && (s.lastScore || 0) < MIN_PASSING_SCORE
    ).map(s => s.name)

    // Evidencia por concepto — no promediar globalmente
    // Un concepto puede estar en 100 y otro en 0: el promedio no dice nada
    const conceptEvidenceMap: Record<string, { scores: number[]; hasApplication: boolean }> = {}
    for (const h of history) {
      if (!h.concept) continue
      if (!conceptEvidenceMap[h.concept]) {
        conceptEvidenceMap[h.concept] = { scores: [], hasApplication: false }
      }
      if (h.type === 'quiz' || h.type === 'active_recall' || h.type === 'active_recall') {
        conceptEvidenceMap[h.concept].scores.push(h.score || 0)
        if (h.type === 'active_recall' || h.type === 'active_recall') {
          conceptEvidenceMap[h.concept].hasApplication = true
        }
      }
    }

    // Concepto débil = tiene evidencia pero score bajo, O no tiene aplicación
    const weakConceptsInSession = Object.entries(conceptEvidenceMap)
      .filter(([_, ev]) => {
        if (ev.scores.length === 0) return false
        const avg = ev.scores.reduce((a, b) => a + b, 0) / ev.scores.length
        return avg < 50 // Falló
      })
      .map(([name]) => name)

    const hasFallbacksAlready = planRef.current.some(s => s.isFallback)

    // No cerrar si hay conceptos que fallaron y no hemos intentado repair
    const needsReinforcement = (unverifiedConcepts.length > 0 || failedConcepts.length > 0 || weakConceptsInSession.length > 0)
      && !hasFallbacksAlready
      && allScores.length < 5

    if (needsReinforcement && unverifiedConcepts.length > 0) {
      // Insertar un quiz rápido de cierre antes de terminar
      const closingConcept = unverifiedConcepts[0]
      const closingStep: SessionStep = {
        id: 'closing_' + Math.random().toString(36).slice(2, 8),
        type: 'quiz',
        concept: closingConcept,
        concepts: unverifiedConcepts.slice(0, 2),
        instruction: `Antes de cerrar, una pregunta rápida sobre "${closingConcept}".`,
        count: 1,
        isFallback: true,
      }
      setPlan(prev => [...prev, closingStep])
      setPlanIndex(planRef.current.length)
      executeStep(closingStep)
      return // No cerrar todavía
    }

    setFinalizing(true)
    setShowCelebration(true)

    // Fórmula honesta: domainGain refleja lo que realmente aprendió el estudiante
    // Si score < 40: dominio no sube → sistema genera sesión de repair
    // Si score 40-60: sube poco → necesita refuerzo
    // Si score 60-80: sube normal
    // Si score > 80: sube más → sesión excelente
    const baseGain = session.expectedDomainGain || 15
    const scoreMultiplier = avgScore >= 80 ? 1.2 : avgScore >= 60 ? 1.0 : avgScore >= 40 ? 0.6 : 0.0
    const domainGain = avgScore < 40
      ? 0  // No aprendió — repair session se activa en updater
      : Math.max(
          Math.round(avgScore >= 60 ? 6 : 3),  // piso mínimo solo si aprendió algo
          Math.round((avgScore / 100) * baseGain * scoreMultiplier)
        )

    const finalMemory = { ...sessionMemoryRef.current, completedAt: Date.now() }
    saveSessionMemory(finalMemory)
    const priority = getPriorityForNextSession(finalMemory)
    console.log('📚 [SessionMemory] Handoff:', priority.handoffNote)
    console.log('📊 [finishSession] avgScore:', avgScore, '| domainGain:', domainGain, '| mastered:', conceptsImproved)

    const masteredConcepts = conceptsImproved.length > 0
      ? conceptsImproved : (session.targetConcepts || []).slice(0, 3)

    setTimeout(() => {
      setShowCelebration(false)
      onSessionComplete({
        domainGain,
        conceptsImproved: masteredConcepts,
        stepResults: history.map((h, i) => ({
          stepId: h.stepId || String(i),
          score: h.score,
          correct: (h.score || 0) >= 60,
          type: h.type,
        })),
      })
    }, 1800)
  }

  // ═══════════════════════════════════════════════════════════════
  // ARRANCAR
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (hasStartedRef.current && planRetries === 0) return
    hasStartedRef.current = true
    if (!materialContent || materialContent.trim().length < 50) return
    loadPlan()
    return () => {}
  }, [planRetries])

  const totalSteps = plan.length || 1
  const progressPct = Math.round((planIndexRef.current / totalSteps) * 100)

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  if (planLoading) {
    return (
      <div style={overlayStyle}>
        <div style={{ fontSize: 56, marginBottom: 20, animation: 'pulse 1.5s ease-in-out infinite' }}>📖</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#f5e6b8', marginBottom: 10 }}>Preparando tu sesión</div>
        <div style={{ fontSize: 13, color: '#a8854a', textAlign: 'center', maxWidth: 360 }}>
          ALAI está diseñando las actividades perfectas para ti basándose en tu nivel actual
        </div>
        <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.7;transform:scale(1.05)}}`}</style>
      </div>
    )
  }

  if (planError) {
    return (
      <div style={overlayStyle}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>😓</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#f5e6b8', marginBottom: 8 }}>ALAI está ocupado</div>
        <div style={{ fontSize: 13, color: '#a8854a', marginBottom: 24, textAlign: 'center' }}>{planError}</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => { setPlanError(null); setPlanRetries(r => r + 1) }} style={btnGold}>🔄 Reintentar</button>
          <button onClick={onClose} style={btnOutline}>← Volver</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div style={overlayStyle}>
        {/* Botón volver */}
        <button onClick={onClose} style={{
          position: 'absolute', top: 20, left: 24,
          background: 'rgba(214,178,111,0.08)', border: '1px solid rgba(214,178,111,0.3)',
          color: 'rgba(214,178,111,0.9)', padding: '8px 16px', borderRadius: 999,
          fontSize: 11, cursor: 'pointer', letterSpacing: 1.5, fontFamily: 'Georgia, serif', zIndex: 200,
        }}>← VOLVER AL LIBRO</button>

        {/* Progress */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'rgba(214,178,111,0.15)' }}>
          <div style={{ height: '100%', width: `${progressPct}%`, background: 'linear-gradient(90deg,#d6b26f,#a8854a)', transition: 'width .5s ease' }} />
        </div>

        {/* Celebración */}
        {showCelebration && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,8,6,.95)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
            <div style={{ fontSize: 60, animation: 'pulse 1s ease-in-out infinite' }}>✨</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#d6b26f', fontFamily: 'Georgia, serif' }}>Sesión completada</div>
          </div>
        )}

        {/* Contenido principal */}
        {!showCelebration && !finalizing && (
          <div style={cardStyle}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 10, letterSpacing: 3, color: 'rgba(58,46,31,.5)', fontWeight: 700 }}>
                {stepLabel(currentStep?.type)}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(58,46,31,.5)' }}>
                {planIndexRef.current + 1} / {totalSteps}
              </div>
            </div>
            <div style={{ height: 3, background: 'rgba(58,46,31,.1)', borderRadius: 2, marginBottom: 20, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, background: 'linear-gradient(90deg,#d6b26f,#a8854a)', transition: 'width .5s' }} />
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#3a2e1f', marginBottom: 20, lineHeight: 1.2 }}>
              {session.topicTitle || session.title}
            </div>

            {loading && (
              <div style={{ textAlign: 'center', padding: '50px 0' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📖</div>
                <div style={{ fontSize: 13, color: 'rgba(58,46,31,.6)', fontStyle: 'italic' }}>Preparando...</div>
              </div>
            )}

            {/* ── EXPLAIN ─────────────────────────────────────── */}
            {!loading && currentStep?.type === 'explain' && currentContent && (
              <ExplainBlock
                data={currentContent}
                onContinue={() => advance({ isExposure: true })}
              />
            )}

            {/* ── DOUBT CHAT / REFLECTION CHAT ────────────────── */}
            {!loading && (currentStep?.type === 'doubt_chat' || currentStep?.type === 'reflection_chat') && (
              <ChatBlock
                type={currentStep.type}
                concept={currentStep.concept}
                messages={chatMessages}
                input={chatInput}
                loading={chatLoading}
                onInputChange={setChatInput}
                onSend={sendChat}
                onContinue={() => advance({ isExposure: true })}
                onRequestPractice={currentStep.type === 'reflection_chat' ? () => {
                  // Agregar múltiples pasos de práctica al plan
                  const concepts = session.targetConcepts || []
                  const practiceSteps: SessionStep[] = [
                    {
                      id: 'practice_quiz_' + genId(),
                      type: 'quiz',
                      concepts,
                      concept: concepts[0],
                      instruction: 'Práctica extra — preguntas variadas sobre todo lo que vimos.',
                      count: 3,
                      isOptional: true,
                    },
                    {
                      id: 'practice_flash_' + genId(),
                      type: 'flashcards',
                      concepts,
                      concept: concepts[0],
                      instruction: 'Repasa las flashcards una vez más para consolidar.',
                      isOptional: true,
                    },
                    {
                      id: 'practice_repaso_' + genId(),
                      type: 'flashcard_repaso',
                      concepts,
                      concept: concepts[0],
                      instruction: 'Repaso final hasta que las domines.',
                      isOptional: true,
                    },
                  ]
                  setPlan(prev => {
                    const newPlan = [...prev, ...practiceSteps]
                    return newPlan
                  })
                  // Avanzar al siguiente paso (práctica)
                  const nextIdx = planIndexRef.current + 1
                  setPlanIndex(nextIdx)
                  const currentPlan = planRef.current
                  const nextStep = currentPlan[nextIdx] || practiceSteps[0]
                  executeStep(nextStep)
                } : undefined}
              />
            )}

                        {/* ── QUIZ ─────────────────────────────────────────── */}
            {!loading && currentStep?.type === 'quiz' && currentContent?.questions?.length > 0 && (
              <QuizBlock
                questions={currentContent.questions}
                currentIdx={currentQuizIdx}
                selectedOption={selectedOption}
                selectedOptions={selectedOptions}
                fillBlankAnswer={fillBlankAnswer}
                shortAnswer={shortAnswer}
                matchingAnswer={matchingAnswer}
                showFeedback={showQuizFeedback}
                quizResult={quizResult}
                onSelectOption={setSelectedOption}
                onToggleOption={(idx: number) => setSelectedOptions((prev: number[]) =>
                  prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
                )}
                onFillBlankChange={setFillBlankAnswer}
                onShortAnswerChange={setShortAnswer}
                onMatchingChange={setMatchingAnswer}
                onSubmit={(directAnswer?: any) => submitQuizAnswer(currentContent.questions, directAnswer)}
                onAdvance={() => advanceQuiz(currentContent.questions)}
              />
            )}

            {/* ── FLASHCARDS ───────────────────────────────────── */}
            {!loading && currentStep?.type === 'flashcards' && currentContent?.cards?.length > 0 && (
              <FlashcardsBlock
                cards={currentContent.cards}
                currentIdx={flashcardIdx}
                flipped={flashcardFlipped}
                onFlip={() => setFlashcardFlipped(!flashcardFlipped)}
                onAnswer={handleFlashcardAnswer}
              />
            )}

            {/* ── FLASHCARD REPASO ─────────────────────────────── */}
            {!loading && currentStep?.type === 'flashcard_repaso' && (
              <FlashcardRepasoBlock
                cards={repasoCards.length > 0 ? repasoCards : (currentContent?.cards || [])}
                currentIdx={repasoIdx}
                flipped={repasoFlipped}
                round={repasoRound}
                complete={repasoComplete}
                onFlip={() => setRepasoFlipped(!repasoFlipped)}
                onAnswer={handleRepasoAnswer}
                onFinish={() => advance({ score: 80 })}
                onInit={(cards) => { setRepasoCards(cards); setRepasoIdx(0) }}
              />
            )}

            {/* ── RECALL ───────────────────────────────────────── */}
            {!loading && currentStep?.type === 'active_recall' && (
              <RecallBlock
                instruction={currentContent?.recallPrompt || currentStep.instruction || `Explica "${currentStep.concept}" con tus palabras.`}
                concept={currentStep.concept}
                text={recallText}
                feedback={recallFeedback}
                loading={loading}
                onChange={setRecallText}
                onSubmit={submitRecall}
                onContinue={() => advance({ score: recallFeedback?.score || 60 })}
              />
            )}

            {/* ── REFLECTION ───────────────────────────────────── */}
            {!loading && currentStep?.type === 'reflection' && (
              <ReflectionBlock
                instruction={currentStep.instruction || `Reflexión final de la sesión:`}
                text={reflectionText}
                feedback={reflectionFeedback}
                loading={loading}
                onChange={setReflectionText}
                onSubmit={submitReflection}
                onContinue={() => {
                  const score = reflectionFeedback?.score || 70
                  // Si score muy bajo en reflexión, marcar para refuerzo
                  if (score < 35) {
                    setAllScores(prev => [...prev, score])
                  }
                  advance({ score, isExposure: true })
                }}
              />
            )}
          </div>
        )}

        {finalizing && !showCelebration && (
          <div style={{ color: '#d6b26f', fontFamily: 'Georgia, serif', textAlign: 'center' }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>📖</div>
            <div>Guardando progreso...</div>
          </div>
        )}
      </div>

      {/* Botón terminar */}
      {!finalizing && !showCelebration && plan.length > 0 && (
        <button onClick={() => { if (confirm('¿Terminar sesión ahora?')) finishSession() }}
          style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999, background: 'rgba(245,200,66,.15)', border: '1.5px solid rgba(245,200,66,.5)', color: '#f5c842', padding: '10px 18px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(8px)' }}>
          ✓ Terminar sesión
        </button>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function stepLabel(type?: string): string {
  const labels: Record<string, string> = {
    explain: '✦ EXPLICACIÓN',
    doubt_chat: '💬 CONSULTA CON ALAI',
    quiz: '✦ EVALUACIÓN',
    flashcards: '✦ FLASHCARDS',
    flashcard_repaso: '🔄 REPASO DE FLASHCARDS',
    recall: '✦ RECALL ACTIVO',
    reflection: '✦ REFLEXIÓN FINAL',
    reflection_chat: '💬 CIERRE CON ALAI',
    practice: '✦ PRÁCTICA ADICIONAL',
  }
  return labels[type || ''] || '✦ ACTIVIDAD'
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTES DE ACTIVIDAD
// ═══════════════════════════════════════════════════════════════

function renderPlainText(text: string): React.ReactNode {
  // Limpiar markdown residual y renderizar texto limpio
  const clean = text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .trim()
  return clean
}

function ExplainBlock({ data, onContinue }: { data: any; onContinue: () => void }) {
  const content = data?.content || data?.explanation || ''
  const keyIdea = data?.keyIdea || ''

  // Separar el "Para recordar" del resto si está en el contenido
  const paraRecordarMatch = content.match(/Para recordar:\s*(.+?)$/im)
  const cleanContent = content.replace(/Para recordar:.+$/im, '').trim()
  const finalKeyIdea = keyIdea || (paraRecordarMatch ? paraRecordarMatch[1] : '')

  const paragraphs = cleanContent.split(/\n\n+/).filter((p: string) => p.trim())

  return (
    <div>
      {paragraphs.map((para: string, i: number) => (
        <p key={i} style={{ fontSize: 14.5, lineHeight: 1.85, color: '#3a2e1f', marginBottom: 16 }}>
          {renderPlainText(para)}
        </p>
      ))}

      {finalKeyIdea && (
        <div style={{ padding: '12px 16px', background: 'rgba(214,178,111,0.12)', borderLeft: '3px solid #d6b26f', borderRadius: 6, marginBottom: 24, fontSize: 13.5, color: '#3a2e1f', fontWeight: 600, lineHeight: 1.5 }}>
          💡 Para recordar: {renderPlainText(finalKeyIdea.replace(/^Para recordar:\s*/i, ''))}
        </div>
      )}

      <button onClick={onContinue} style={btnPrimary}>Entendido, continuar →</button>
    </div>
  )
}

function ChatBlock({ type, concept, messages, input, loading, onInputChange, onSend, onContinue, onRequestPractice }: any) {
  const isReflectionChat = type === 'reflection_chat'
  const [expanded, setExpanded] = React.useState(isReflectionChat || messages.length > 0)
  const placeholder = isReflectionChat
    ? '¿Tienes alguna duda final? ¿O quieres más práctica?'
    : '¿Tienes alguna duda? Pregúntame...'

  // Si hay mensajes nuevos, expandir automáticamente
  React.useEffect(() => {
    if (messages.length > 0) setExpanded(true)
  }, [messages.length])

  return (
    <div>
      {/* Botón principal: continuar sin dudas — siempre visible y prominente */}
      {!isReflectionChat && (
        <button
          onClick={onContinue}
          style={{ ...btnPrimary, width: '100%', marginBottom: 12, fontSize: 15 }}
        >
          Continuar →
        </button>
      )}

      {/* Chat colapsable — solo si quiere preguntar */}
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          style={{
            width: '100%', padding: '8px 16px',
            background: 'transparent',
            border: '1px solid rgba(58,46,31,.2)',
            borderRadius: 8, color: 'rgba(58,46,31,.5)',
            fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif',
            letterSpacing: 0.5,
          }}
        >
          💬 Tengo una duda sobre "{concept}"
        </button>
      ) : (
        <div style={{ borderTop: isReflectionChat ? 'none' : '1px solid rgba(58,46,31,.1)', paddingTop: isReflectionChat ? 0 : 12 }}>
          {isReflectionChat && (
            <div style={{ padding: '12px 16px', background: 'rgba(58,46,31,.05)', borderLeft: '3px solid #d6b26f', borderRadius: 6, marginBottom: 16, fontSize: 13, color: '#3a2e1f', lineHeight: 1.6 }}>
              La sesión está casi lista. ¿Tienes alguna duda? También puedes pedir más práctica.
            </div>
          )}

          {/* Mensajes */}
          {messages.length > 0 && (
            <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.map((msg: any, i: number) => (
                <div key={i} style={{
                  padding: '9px 13px', borderRadius: 8, maxWidth: '85%',
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  background: msg.role === 'user' ? '#3a2e1f' : 'rgba(58,46,31,.08)',
                  color: msg.role === 'user' ? '#f5ecd5' : '#3a2e1f',
                  fontSize: 13, lineHeight: 1.6,
                }}>
                  {String(msg.text).replace(/\*\*/g,'').replace(/\*/g,'').replace(/#{1,6}\s/g,'')}
                </div>
              ))}
              {loading && (
                <div style={{ padding: '9px 13px', borderRadius: 8, background: 'rgba(58,46,31,.06)', fontSize: 13, color: 'rgba(58,46,31,.5)', fontStyle: 'italic' }}>
                  ALAI responde...
                </div>
              )}
            </div>
          )}

          {/* Input */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              value={input}
              onChange={e => onInputChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && onSend(input)}
              placeholder={placeholder}
              autoFocus={!isReflectionChat}
              style={{
                flex: 1, padding: '9px 13px', borderRadius: 6,
                border: '1.5px solid rgba(58,46,31,.25)', background: 'rgba(255,255,255,.6)',
                fontSize: 13, fontFamily: 'Georgia, serif', color: '#3a2e1f', outline: 'none',
              }}
            />
            <button
              onClick={() => onSend(input)}
              disabled={!input.trim() || loading}
              style={{ ...btnPrimary, padding: '9px 14px', opacity: !input.trim() || loading ? .4 : 1 }}
            >
              Enviar
            </button>
          </div>

          {/* Botones de cierre */}
          <div style={{ display: 'flex', gap: 10 }}>
            {isReflectionChat ? (
              <>
                <button onClick={onContinue} style={{ ...btnOutlineLocal, flex: 1 }}>
                  Cerrar sesión →
                </button>
                {onRequestPractice && (
                  <button onClick={onRequestPractice} style={{ ...btnPrimary, flex: 1 }}>
                    🎯 Más práctica
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={() => { setExpanded(false); onContinue() }}
                style={{ ...btnOutlineLocal, flex: 1, fontSize: 12 }}
              >
                Sin más dudas, continuar →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function QuizBlock({ questions, currentIdx, selectedOption, selectedOptions, fillBlankAnswer, shortAnswer, showFeedback, quizResult, matchingAnswer, onSelectOption, onToggleOption, onFillBlankChange, onShortAnswerChange, onMatchingChange, onSubmit, onAdvance }: any) {
  const q = questions[currentIdx]
  const [showWordBank, setShowWordBank] = useState(false)
  if (!q) return <div>Cargando pregunta...</div>

  // ── FEEDBACK ──────────────────────────────────────────────────
  if (showFeedback && quizResult) {
    return (
      <div>
        <div style={{ fontSize: 11, color: 'rgba(58,46,31,.5)', marginBottom: 10, fontStyle: 'italic' }}>
          Pregunta {currentIdx + 1} de {questions.length} · {q.type?.replace('_', ' ')}
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, lineHeight: 1.5, color: '#3a2e1f' }}>{q.question}</div>

        <div style={{ padding: '14px 18px', background: quizResult.correct ? 'rgba(90,138,58,.1)' : 'rgba(139,26,26,.1)', borderLeft: `4px solid ${quizResult.correct ? '#5a8a3a' : '#8b1a1a'}`, borderRadius: 6, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: quizResult.correct ? '#3a5a1e' : '#8b1a1a', marginBottom: 4, letterSpacing: 1 }}>
            {quizResult.correct ? '✓ CORRECTO' : '✗ INCORRECTO'}
          </div>
          {!quizResult.correct && quizResult.correctAnswer !== undefined && (
            <div style={{ fontSize: 13, color: '#3a5a1e', marginTop: 4 }}>
              <strong>Respuesta correcta:</strong> {quizResult.correctAnswer}
            </div>
          )}
        </div>

        {q.explanation && (
          <div style={{ padding: '14px 18px', background: 'rgba(214,178,111,.1)', borderLeft: '4px solid #a8854a', borderRadius: 6, marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: '#a8854a', marginBottom: 6 }}>✦ POR QUÉ</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: '#3a2e1f' }}>{q.explanation}</div>
          </div>
        )}

        <button onClick={onAdvance} style={btnPrimary}>
          {currentIdx + 1 < questions.length ? 'Siguiente pregunta →' : 'Terminar evaluación →'}
        </button>
      </div>
    )
  }

  // ── PREGUNTA ──────────────────────────────────────────────────
  const canSubmit =
    (q.type === 'multiple_choice' && selectedOption !== null) ||
    (q.type === 'true_false' && selectedOption !== null) ||
    (q.type === 'multi_select' && selectedOptions.length > 0) ||
    (q.type === 'fill_blank' && fillBlankAnswer.trim()) ||
    (q.type === 'short_answer' && shortAnswer.trim()) ||
    (q.type === 'matching' && matchingAnswer && Object.keys(matchingAnswer).length === (q.pairs?.length || 0))

  return (
    <div>
      <div style={{ fontSize: 11, color: 'rgba(58,46,31,.5)', marginBottom: 10, fontStyle: 'italic' }}>
        Pregunta {currentIdx + 1} de {questions.length} · {q.type?.replace(/_/g, ' ')}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 20, lineHeight: 1.5, color: '#3a2e1f' }}>{q.question}</div>

      {/* MULTIPLE CHOICE — click directo responde */}
      {q.type === 'multiple_choice' && (
        <div style={{ marginBottom: 16 }}>
          {(q.options || []).map((opt: string, i: number) => (
            <button key={i}
              onClick={() => { onSelectOption(i); onSubmit(i) }}
              style={{
                width: '100%', padding: '12px 16px', marginBottom: 8, borderRadius: 6,
                border: selectedOption === i ? '2px solid #3a2e1f' : '1.5px solid rgba(58,46,31,.25)',
                background: selectedOption === i ? 'rgba(58,46,31,.08)' : 'rgba(255,255,255,.4)',
                color: '#3a2e1f', fontFamily: 'Georgia, serif', fontSize: 13.5,
                cursor: 'pointer', textAlign: 'left' as const,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
              <span style={{ fontWeight: 700, color: 'rgba(58,46,31,.4)', minWidth: 20 }}>
                {String.fromCharCode(65 + i)}.
              </span>
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* TRUE FALSE — click directo */}
      {q.type === 'true_false' && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          {['Verdadero', 'Falso'].map((opt, i) => (
            <button key={i}
              onClick={() => { onSelectOption(i); onSubmit(i) }}
              style={{
                flex: 1, padding: '14px', borderRadius: 6,
                border: selectedOption === i ? '2px solid #3a2e1f' : '1.5px solid rgba(58,46,31,.25)',
                background: selectedOption === i ? 'rgba(58,46,31,.08)' : 'rgba(255,255,255,.4)',
                color: '#3a2e1f', fontFamily: 'Georgia, serif', fontSize: 14, fontWeight: 600,
                cursor: 'pointer',
              }}>
              {i === 0 ? 'V' : 'F'} — {opt}
            </button>
          ))}
        </div>
      )}

      {/* MULTI SELECT */}
      {q.type === 'multi_select' && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'rgba(58,46,31,.5)', marginBottom: 8 }}>Selecciona todas las correctas</div>
          {(q.options || []).map((opt: string, i: number) => (
            <button key={i} onClick={() => onToggleOption(i)}
              style={{
                width: '100%', padding: '11px 16px', marginBottom: 8, borderRadius: 6,
                border: selectedOptions.includes(i) ? '2px solid #3a2e1f' : '1.5px solid rgba(58,46,31,.25)',
                background: selectedOptions.includes(i) ? 'rgba(58,46,31,.08)' : 'rgba(255,255,255,.4)',
                color: '#3a2e1f', fontFamily: 'Georgia, serif', fontSize: 13.5,
                cursor: 'pointer', textAlign: 'left' as const,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
              <span style={{
                width: 18, height: 18, borderRadius: 3, border: '1.5px solid rgba(58,46,31,.4)',
                background: selectedOptions.includes(i) ? '#3a2e1f' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#f5ecd5', fontSize: 11, flexShrink: 0,
              }}>{selectedOptions.includes(i) ? '✓' : ''}</span>
              {opt}
            </button>
          ))}
          <button onClick={() => onSubmit(null)} disabled={selectedOptions.length === 0}
            style={{ ...btnPrimary, opacity: selectedOptions.length === 0 ? .4 : 1, marginTop: 4 }}>
            Responder →
          </button>
        </div>
      )}

      {/* FILL BLANK — con wordbank */}
      {q.type === 'fill_blank' && (
        <div style={{ marginBottom: 16 }}>
          <input
            value={fillBlankAnswer}
            onChange={e => onFillBlankChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && fillBlankAnswer.trim()) onSubmit(null) }}
            placeholder="Escribe la palabra aquí..."
            style={{
              width: '100%', padding: '14px 16px', borderRadius: 8,
              border: '2px solid rgba(58,46,31,.2)', background: 'rgba(255,255,255,.8)',
              fontSize: 15, fontFamily: 'Georgia, serif', color: '#3a2e1f',
              outline: 'none', boxSizing: 'border-box' as const, marginBottom: 10,
            }}
          />
          {/* Word Bank */}
          {q.wordBank && q.wordBank.length > 0 && (
            <div style={{ background: 'rgba(58,46,31,.04)', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(58,46,31,.1)', marginBottom: 10 }}>
              <button onClick={() => setShowWordBank(!showWordBank)}
                style={{ width: '100%', padding: '10px 16px', border: 'none', background: 'none', textAlign: 'left' as const, cursor: 'pointer', fontSize: 11, fontWeight: 800, color: 'rgba(58,46,31,.5)', fontFamily: 'Georgia, serif', display: 'flex', justifyContent: 'space-between' }}>
                <span>📦 BANCO DE PALABRAS</span><span>{showWordBank ? '▲' : '▼'}</span>
              </button>
              {showWordBank && (
                <div style={{ padding: '8px 16px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                  {q.wordBank.map((w: string) => (
                    <button key={w} onClick={() => onFillBlankChange(w)}
                      style={{ padding: '6px 14px', borderRadius: 8, background: fillBlankAnswer === w ? '#3a2e1f' : '#fff', color: fillBlankAnswer === w ? '#f5ecd5' : '#3a2e1f', border: `1.5px solid ${fillBlankAnswer === w ? '#3a2e1f' : 'rgba(58,46,31,.2)'}`, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Georgia, serif' }}>
                      {w}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!q.wordBank?.length && (
            <div style={{ fontSize: 11, color: 'rgba(58,46,31,.45)', fontStyle: 'italic', marginBottom: 8 }}>
              💡 Pista: la respuesta tiene {(q.answer || '').split(' ').length} palabra(s)
            </div>
          )}
          <button onClick={() => onSubmit(null)} disabled={!fillBlankAnswer.trim()}
            style={{ ...btnPrimary, opacity: !fillBlankAnswer.trim() ? .4 : 1 }}>
            Responder →
          </button>
        </div>
      )}

      {/* MATCHING — MatchingCanvas interactivo */}
      {q.type === 'matching' && q.pairs && (
        <div style={{ marginBottom: 16 }}>
          <MatchingCanvas
            pairs={q.pairs}
            value={matchingAnswer || {}}
            onChange={onMatchingChange}
            locked={false}
            themeColor="#d6b26f"
          />
          <button onClick={() => onSubmit(null)}
            disabled={!matchingAnswer || Object.keys(matchingAnswer).length < (q.pairs?.length || 0)}
            style={{ ...btnPrimary, marginTop: 16, opacity: (!matchingAnswer || Object.keys(matchingAnswer).length < (q.pairs?.length || 0)) ? .4 : 1 }}>
            Verificar conexiones →
          </button>
        </div>
      )}

      {/* SHORT ANSWER */}
      {q.type === 'short_answer' && (
        <div style={{ marginBottom: 16 }}>
          <textarea value={shortAnswer} onChange={e => onShortAnswerChange(e.target.value)}
            placeholder="Escribe tu respuesta..."
            rows={4}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && shortAnswer.trim()) { e.preventDefault(); onSubmit(null) } }}
            style={{ width: '100%', padding: '14px 16px', borderRadius: 8, border: '2px solid rgba(58,46,31,.2)', background: 'rgba(255,255,255,.8)', fontSize: 15, fontFamily: 'Georgia, serif', color: '#3a2e1f', outline: 'none', resize: 'vertical' as const, boxSizing: 'border-box' as const, lineHeight: 1.5 }}
          />
          <button onClick={() => onSubmit(null)} disabled={!shortAnswer.trim()}
            style={{ ...btnPrimary, marginTop: 8, opacity: !shortAnswer.trim() ? .4 : 1 }}>
            Responder →
          </button>
        </div>
      )}

      {/* Solo multiple_choice y true_false no tienen botón extra — responden al click */}
      {(q.type !== 'multiple_choice' && q.type !== 'true_false') && !canSubmit && (
        <div style={{ fontSize: 11, color: 'rgba(58,46,31,.4)', fontStyle: 'italic', marginTop: 8 }}>
          {q.type === 'matching' ? 'Conecta todos los pares para continuar' : ''}
        </div>
      )}
    </div>
  )
}

function FlashcardsBlock({ cards, currentIdx, flipped, onFlip, onAnswer }: any) {
  const card = cards[currentIdx]
  if (!card) return null
  return (
    <div>
      <div style={{ fontSize: 11, color: 'rgba(58,46,31,.5)', marginBottom: 12, textAlign: 'center', fontStyle: 'italic' }}>
        Tarjeta {currentIdx + 1} de {cards.length} — Lee y memoriza
      </div>
      <div onClick={onFlip} style={{
        background: 'rgba(255,255,255,.5)', border: '1.5px solid rgba(58,46,31,.25)',
        borderRadius: 8, padding: '36px 24px', minHeight: 160,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', cursor: 'pointer', marginBottom: 16,
        fontSize: 15, fontWeight: flipped ? 500 : 600, color: '#3a2e1f', lineHeight: 1.6,
        transition: 'all .2s ease',
      }}>
        {flipped ? card.back : card.front}
      </div>
      {flipped ? (
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => onAnswer(false)} style={btnDanger}>✗ No la sabía</button>
          <button onClick={() => onAnswer(true)} style={btnSuccess}>✓ La sabía</button>
        </div>
      ) : (
        <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(58,46,31,.5)' }}>
          Toca la tarjeta para ver la respuesta
        </div>
      )}
    </div>
  )
}

function FlashcardRepasoBlock({ cards, currentIdx, flipped, round, complete, onFlip, onAnswer, onFinish, onInit }: any) {
  useEffect(() => {
    if (cards.length > 0 && currentIdx === 0) onInit(cards)
  }, [])

  const card = cards[currentIdx]

  if (complete) {
    return (
      <div>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#3a2e1f', marginBottom: 8 }}>
            ¡Las dominaste todas!
          </div>
          <div style={{ fontSize: 13, color: 'rgba(58,46,31,.6)', marginBottom: 24 }}>
            Completaste {round} ronda{round > 1 ? 's' : ''} de repaso
          </div>
        </div>
        <button onClick={onFinish} style={btnPrimary}>Continuar →</button>
      </div>
    )
  }

  if (!card) return <div>Cargando repaso...</div>

  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 12,
      }}>
        <div style={{ fontSize: 11, color: 'rgba(58,46,31,.5)', fontStyle: 'italic' }}>
          Ronda {round} · Tarjeta {currentIdx + 1} de {cards.length}
        </div>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
          color: '#a8854a', background: 'rgba(214,178,111,.15)',
          padding: '3px 8px', borderRadius: 999,
        }}>
          🔄 REPASO
        </div>
      </div>

      <div onClick={onFlip} style={{
        background: 'rgba(255,255,255,.5)', border: '1.5px solid rgba(58,46,31,.25)',
        borderRadius: 8, padding: '36px 24px', minHeight: 160,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', cursor: 'pointer', marginBottom: 16,
        fontSize: 15, fontWeight: flipped ? 500 : 600, color: '#3a2e1f', lineHeight: 1.6,
      }}>
        {flipped ? card.back : card.front}
      </div>

      {flipped ? (
        <div>
          <div style={{ fontSize: 12, color: 'rgba(58,46,31,.5)', marginBottom: 10, textAlign: 'center' }}>
            ¿Lo sabías sin mirar?
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => onAnswer(false)} style={btnDanger}>✗ No — repetir</button>
            <button onClick={() => onAnswer(true)} style={btnSuccess}>✓ Sí, lo sé</button>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(58,46,31,.5)' }}>
          Intenta recordar la respuesta antes de voltear
        </div>
      )}
    </div>
  )
}

function RecallBlock({ instruction, concept, text, feedback, loading, onChange, onSubmit, onContinue }: any) {
  const isGood = (feedback?.score || 0) >= 70
  const isMedium = (feedback?.score || 0) >= 40

  if (feedback) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            background: isGood ? 'rgba(90,138,58,.12)' : isMedium ? 'rgba(214,178,111,.15)' : 'rgba(139,26,26,.1)',
            border: `2px solid ${isGood ? '#5a8a3a' : isMedium ? '#d6b26f' : '#8b1a1a'}`,
            fontSize: 20, fontWeight: 900, color: isGood ? '#3a5a1e' : isMedium ? '#a8854a' : '#8b1a1a',
          }}>{feedback.score}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#3a2e1f', marginBottom: 3 }}>
              {isGood ? '¡Lo tienes!' : isMedium ? 'Casi — falta algo' : 'Necesitamos repasar esto'}
            </div>
          </div>
        </div>

        {feedback.correctThings && (
          <div style={feedbackBox('#5a8a3a', 'rgba(90,138,58,.08)')}>
            <div style={feedbackLabel('#5a8a3a')}>✓ LO QUE ESTUVO BIEN</div>
            <div style={feedbackText}>{feedback.correctThings}</div>
          </div>
        )}
        {feedback.wrongOrMissing && (
          <div style={feedbackBox(isGood ? '#a8854a' : '#8b1a1a', isGood ? 'rgba(214,178,111,.08)' : 'rgba(139,26,26,.06)')}>
            <div style={feedbackLabel(isGood ? '#a8854a' : '#8b1a1a')}>{isGood ? '💡 PARA COMPLETAR' : '✗ LO QUE FALTÓ'}</div>
            <div style={feedbackText}>{feedback.wrongOrMissing}</div>
          </div>
        )}
        {feedback.keyExplanation && (
          <div style={feedbackBox('#d6b26f', 'rgba(214,178,111,.1)')}>
            <div style={feedbackLabel('#a8854a')}>✦ LA EXPLICACIÓN CORRECTA</div>
            <div style={feedbackText}>{feedback.keyExplanation}</div>
          </div>
        )}
        {feedback.answerToDubts && (
          <div style={feedbackBox('#3a2e1f', 'rgba(58,46,31,.05)')}>
            <div style={feedbackLabel('rgba(58,46,31,.6)')}>🤔 RESPUESTA A TU DUDA</div>
            <div style={feedbackText}>{feedback.answerToDubts}</div>
          </div>
        )}
        {feedback.keyIdea && (
          <div style={{ padding: '10px 14px', background: 'rgba(58,46,31,.05)', borderRadius: 6, marginBottom: 20, fontSize: 12, color: 'rgba(58,46,31,.7)', fontStyle: 'italic' }}>
            💡 <strong>Para recordar:</strong> {feedback.keyIdea}
          </div>
        )}

        <button onClick={onContinue} style={btnPrimary}>
          {isGood ? 'Continuar →' : 'Entendido, seguimos →'}
        </button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ padding: '14px 18px', background: 'rgba(58,46,31,.06)', borderLeft: '3px solid #d6b26f', borderRadius: 6, marginBottom: 18, fontSize: 14, lineHeight: 1.6, color: '#3a2e1f', fontWeight: 500, whiteSpace: 'pre-wrap' }}>
        {instruction}
      </div>
      <textarea
        value={text} onChange={e => onChange(e.target.value)}
        placeholder="Escribe aquí tu respuesta..."
        rows={5}
        style={{ width: '100%', padding: 14, borderRadius: 6, border: '1.5px solid rgba(58,46,31,.25)', background: 'rgba(255,255,255,.6)', fontSize: 14, fontFamily: 'Georgia, serif', lineHeight: 1.6, resize: 'vertical', outline: 'none', marginBottom: 14, color: '#3a2e1f', boxSizing: 'border-box' as const }}
      />
      <button onClick={onSubmit} disabled={!text.trim() || loading} style={{ ...btnPrimary, opacity: !text.trim() || loading ? .4 : 1 }}>
        {loading ? 'Evaluando...' : 'Enviar →'}
      </button>
    </div>
  )
}

function ReflectionBlock({ instruction, text, feedback, loading, onChange, onSubmit, onContinue }: any) {
  if (feedback) {
    return (
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#3a2e1f', marginBottom: 16 }}>
          {(feedback.score || 0) >= 70 ? '¡Excelente reflexión!' : 'Gracias por tu honestidad'}
        </div>

        {feedback.keyExplanation && (
          <div style={feedbackBox('#d6b26f', 'rgba(214,178,111,.1)')}>
            <div style={feedbackLabel('#a8854a')}>✦ LO QUE FALTÓ O PUEDES MEJORAR</div>
            <div style={feedbackText}>{feedback.keyExplanation}</div>
          </div>
        )}
        {feedback.answerToDubts && (
          <div style={feedbackBox('#3a2e1f', 'rgba(58,46,31,.05)')}>
            <div style={feedbackLabel('rgba(58,46,31,.6)')}>🤔 RESPUESTA A TUS DUDAS</div>
            <div style={feedbackText}>{feedback.answerToDubts}</div>
          </div>
        )}
        {feedback.keyIdea && (
          <div style={{ padding: '10px 14px', background: 'rgba(58,46,31,.05)', borderRadius: 6, marginBottom: 20, fontSize: 12, fontStyle: 'italic', color: 'rgba(58,46,31,.7)' }}>
            💡 <strong>Lo más importante de hoy:</strong> {feedback.keyIdea}
          </div>
        )}

        <button onClick={onContinue} style={btnPrimary}>Continuar al cierre →</button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ padding: '14px 18px', background: 'rgba(58,46,31,.06)', borderLeft: '3px solid #d6b26f', borderRadius: 6, marginBottom: 18, fontSize: 14, lineHeight: 1.7, color: '#3a2e1f', whiteSpace: 'pre-wrap' }}>
        {instruction || `Para cerrar la sesión:\n1. ¿Qué fue lo más importante que aprendiste hoy?\n2. ¿Qué todavía no tienes del todo claro?\n3. ¿Puedes explicar el tema con tus propias palabras?\n\nSé honesto — esto me ayuda a preparar tu próxima sesión.`}
      </div>
      <textarea
        value={text} onChange={e => onChange(e.target.value)}
        placeholder="Escribe tu reflexión aquí..."
        rows={5}
        style={{ width: '100%', padding: 14, borderRadius: 6, border: '1.5px solid rgba(58,46,31,.25)', background: 'rgba(255,255,255,.6)', fontSize: 14, fontFamily: 'Georgia, serif', lineHeight: 1.6, resize: 'vertical', outline: 'none', marginBottom: 14, color: '#3a2e1f', boxSizing: 'border-box' as const }}
      />
      <button onClick={onSubmit} disabled={!text.trim() || loading} style={{ ...btnPrimary, opacity: !text.trim() || loading ? .4 : 1 }}>
        {loading ? 'Analizando...' : 'Enviar reflexión →'}
      </button>
    </div>
  )
}

// ── Estilos compartidos ──────────────────────────────────────────
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 100,
  background: 'radial-gradient(ellipse at center, #1a1410 0%, #0a0806 100%)',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', padding: 24, overflow: 'auto',
  fontFamily: 'Georgia, serif',
}

const cardStyle: React.CSSProperties = {
  width: '100%', maxWidth: 720, minHeight: 500,
  background: 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)',
  borderRadius: 8, padding: '36px 48px',
  fontFamily: 'Georgia, serif', color: '#3a2e1f',
  boxShadow: '0 30px 80px rgba(0,0,0,.7)',
}

const btnPrimary: React.CSSProperties = {
  padding: '12px 28px', background: '#3a2e1f', color: '#f5ecd5',
  border: 'none', borderRadius: 6, fontFamily: 'Georgia, serif',
  fontSize: 13, fontWeight: 700, cursor: 'pointer',
}

const btnGold: React.CSSProperties = {
  padding: '12px 24px', borderRadius: 8,
  border: '1.5px solid #d4a544', background: '#d4a544',
  color: '#1a1410', fontFamily: 'Georgia, serif', fontSize: 14, fontWeight: 700, cursor: 'pointer',
}

const btnOutline: React.CSSProperties = {
  padding: '12px 24px', borderRadius: 8,
  border: '1.5px solid #a8854a', background: 'transparent',
  color: '#a8854a', fontFamily: 'Georgia, serif', fontSize: 14, fontWeight: 700, cursor: 'pointer',
}

const btnOutlineLocal: React.CSSProperties = {
  padding: '11px 18px', borderRadius: 6,
  border: '1.5px solid rgba(58,46,31,.3)', background: 'transparent',
  color: 'rgba(58,46,31,.7)', fontFamily: 'Georgia, serif', fontSize: 13, fontWeight: 700, cursor: 'pointer',
}

const btnSuccess: React.CSSProperties = {
  flex: 1, padding: '12px 16px', borderRadius: 6,
  border: '1.5px solid #5a8a3a', background: 'rgba(90,138,58,.15)',
  color: '#3a5a1e', fontFamily: 'Georgia, serif', fontSize: 13, fontWeight: 700, cursor: 'pointer',
}

const btnDanger: React.CSSProperties = {
  flex: 1, padding: '12px 16px', borderRadius: 6,
  border: '1.5px solid #8b1a1a', background: 'rgba(139,26,26,.1)',
  color: '#8b1a1a', fontFamily: 'Georgia, serif', fontSize: 13, fontWeight: 700, cursor: 'pointer',
}

// Feedback boxes
const feedbackBox = (borderColor: string, bg: string): React.CSSProperties => ({
  padding: '14px 18px', background: bg, borderLeft: `3px solid ${borderColor}`,
  borderRadius: 6, marginBottom: 12,
})

const feedbackLabel = (color: string): React.CSSProperties => ({
  fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color, marginBottom: 6,
})

const feedbackText: React.CSSProperties = {
  fontSize: 13.5, lineHeight: 1.6, color: '#3a2e1f',
}
