'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { AdaptiveSession } from '../../../../lib/adaptive'
import PaginatedBookPage from './PaginatedBookPage'
import AskWidget from './AskWidget'
import { formatScoreDisplay } from '../../../../lib/adaptive/v3/ui/formatScore'
import { beginPresentation, canRenderSessionComplete, shouldRenderActiveContent, type InteractionPhase } from '../../../../lib/adaptive/v3/ui/interactionMachine'
import { normalizeEvalPreference, prepareInteractionForDelivery } from '../../../../lib/adaptive/v3/engine/interactionContract'
import { nextAssistanceLevel, type AssistanceLevel, type HelpUsage } from '../../../../lib/adaptive/v3/engine/helpContract'

interface Props {
  session: AdaptiveSession
  materialContent: string
  masteryContext: any
  onSessionComplete: (result: {
    domainGain: number
    conceptsImproved: string[]
    stepResults: Array<{ stepId: string; score?: number; correct?: boolean }>
    materialCoveragePercent?: number
    masteryPercent?: number
    studiedMicros?: number
    totalMicros?: number
    weakMicroIds?: string[]
    weakMicroNames?: string[]
    studiedMicroIds: string[]
    provisionallyMasteredMicroIds: string[]
    reinforcementMicroIds: string[]
    // Fase 9 — resultado pedagógico real
    isProgramComplete?: boolean
    unresolvedMicroIds?: string[]
    sessionMasteryPercent?: number
    sessionCoveragePercent?: number
    closeReason?: string | null
    confidenceAverage?: number
    assistanceRate?: number
  }) => void
  onClose: () => void
}

type Phase = 'building_graph' | 'loading' | 'ready' | 'evaluating' | 'closing' | 'error'
export default function StudyALSessionV3({
  session, materialContent, masteryContext,
  onSessionComplete, onClose,
}: Props) {
  const [phase, setPhase] = useState<Phase>('building_graph')
  const [interactionPhase, setInteractionPhase] = useState<InteractionPhase>('presenting')
  const [loadingMsg, setLoadingMsg] = useState('Preparando la sesión...')
  const [errorMsg, setErrorMsg] = useState('')
  const [paused, setPaused] = useState(false)

  const [sessionId, setSessionId] = useState<string | null>(session.id || null)
  const [currentPage, setCurrentPage] = useState<any>(null)
  const [lastEvaluation, setLastEvaluation] = useState<any>(null)
  const [sessionSummary, setSessionSummary] = useState<any>(null)
  const [systemInfo, setSystemInfo] = useState<any>(null)
  const [showEvaluation, setShowEvaluation] = useState(false)
  const [coveragePercent, setCoveragePercent] = useState(0)
  const [lastCoverageReport, setLastCoverageReport] = useState<any>(null)
  // Contexto pedagógico real de la actividad actual — proviene del route, no de globals
  const [activityContext, setActivityContext] = useState<{
    isSpacedReview: boolean
    isInterleaving: boolean
  }>({ isSpacedReview: false, isInterleaving: false })
  const [pendingNextPage, setPendingNextPage] = useState<any>(null)
  const [pendingSystemInfo, setPendingSystemInfo] = useState<any>(null)
  const [pendingSessionComplete, setPendingSessionComplete] = useState(false)
  const [interactionIdentity, setInteractionIdentity] = useState<{ interactionId: string; questionId: string } | null>(null)
  const [submittedAnswer, setSubmittedAnswer] = useState<any>(undefined)
  const [helpUsages, setHelpUsages] = useState<HelpUsage[]>([])

  // Resultado pedagógico final de la última respuesta del tutor
  const latestCompletionRef = useRef<{
    isProgramComplete?: boolean
    unresolvedMicroIds?: string[]
    sessionMasteryPercent?: number
    sessionCoveragePercent?: number
    closeReason?: string | null
  }>({})

  const hasStarted = useRef(false)
  const mountedAtRef = useRef(typeof performance !== 'undefined' ? performance.now() : 0)
  const materialId = useRef<string>('')
  const userId = useRef<string>('')
  const evaluationInFlightRef = useRef(false)
  const advancingRef = useRef(false)
  const latestRequestIdRef = useRef<string | null>(null)
  const restoredSnapshotRef = useRef(false)
  const usedQuestionIdsRef = useRef<Set<string>>(new Set())
  const usedFactKeysRef = useRef<Set<string>>(new Set())
  const usedPromptFingerprintsRef = useRef<Set<string>>(new Set())

  const persistenceKey = `studyal_v3_interaction_${masteryContext?.userId || masteryContext?.userProfile?.userId || 'user'}_${masteryContext?.materialId || masteryContext?.material?.id || 'material'}_${session.id}`

  const normalizePrompt = (value: unknown) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

  const requiresUniquePrompt = (interaction: any) => {
    const repetitionIntent = normalizePrompt(interaction?.repetitionIntent)
    const activityStage = normalizePrompt(interaction?.stage || interaction?.purpose || interaction?.activityStage)
    const identity = normalizePrompt(interaction?.id)
    return repetitionIntent.includes('final review') || activityStage.includes('final review') || identity.includes('final review')
  }

  const rememberAcceptedPage = (page: any) => {
    if (!page?.interaction) return
    const questionId = String(page.interaction.id || page.id)
    const factKey = String(page.interaction.factKey || '')
    const promptFingerprint = normalizePrompt(page.interaction.prompt)
    usedQuestionIdsRef.current.add(questionId)
    if (factKey) usedFactKeysRef.current.add(factKey)
    if (promptFingerprint) usedPromptFingerprintsRef.current.add(promptFingerprint)
  }

  // ── Telemetría de interacción (Fase 3) ──────────────────────
  // Mide tiempo desde que la actividad aparece hasta que el estudiante responde
  const activityStartTimeRef = useRef<number | null>(null)
  // Nivel de ayuda máximo usado en la actividad actual
  const currentAssistanceLevelRef = useRef<'independent' | 'minimal_hint' | 'guided' | 'assisted' | 'revealed'>('independent')
  // Confianza reportada por el estudiante (0-100 o undefined)
  const [selfReportedConfidence, setSelfReportedConfidence] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true
    initSession()
  }, [])

  useEffect(() => {
    if (phase === 'ready' && currentPage && mountedAtRef.current > 0) {
      console.info('[v3 timings] firstRenderMs=', Math.round(performance.now() - mountedAtRef.current))
    }
  }, [phase, currentPage?.id])

  const initSession = async () => {
    setPhase('building_graph')
    setLoadingMsg('Construyendo el mapa de conocimiento del material...')

    try {
      const profile = masteryContext?.userProfile || {}
      // userId canónico: DEBE venir del contexto real.
      // 'user_default' causa contaminación de grafos entre usuarios.
      userId.current = profile.userId ||
        masteryContext?.userId ||
        masteryContext?.material?.userId ||
        masteryContext?.materials?.[0]?.userId ||
        profile.id || ''
      if (!userId.current) {
        throw new Error('userId requerido para cargar el grafo correcto. Recarga la página.')
      }

      const material = masteryContext?.materials?.[0] || masteryContext?.material
      // FIX: usar materialId real del context (no session.id que cambia entre sesiones)
      // Orden de prioridad: materialId explícito > material.materialId > material.id > mat_default
      materialId.current = masteryContext?.materialId ||
        material?.materialId || material?.id || 'mat_default'

      const materialTitle = material?.nombre || material?.name ||
                            (masteryContext as any)?.materialTitle ||
                            session.title || 'Material'

      const graphStartedAt = performance.now()
      const graphRes = await fetch('/api/adaptive/v3/build-graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId.current,
          materialId: materialId.current,
          materialTitle,
          materialText: materialContent,
        }),
      })

      if (!graphRes.ok) {
        const err = await graphRes.text()
        throw new Error(`No se pudo construir el grafo: ${err}`)
      }

      const graphData = await graphRes.json()
      if (!graphData.success) throw new Error(graphData.error || 'Error del grafo')
      console.info('[v3 timings] graphMs=', Math.round(performance.now() - graphStartedAt), 'bankMs=', graphData.stats?.bankMs ?? 0)

      console.log(`[v3] Grafo listo: ${graphData.graph?.totalMicros} micros${graphData.fromCache ? ' (cache)' : ''}`)

      setPhase('loading')
      setLoadingMsg('Iniciando tu tutor...')

      const setup = masteryContext?.setup || {}
      const targetMinutes = setup.sessionLength === 'short' ? 12 :
                            setup.sessionLength === 'long' ? 35 : 20

      const rawSnapshot = localStorage.getItem(persistenceKey)
      if (rawSnapshot) {
        const snapshot = JSON.parse(rawSnapshot)
        setSessionId(snapshot.sessionId || session.id)
        setCurrentPage(snapshot.currentPage || null)
        setLastEvaluation(snapshot.lastEvaluation || null)
        setShowEvaluation(!!snapshot.showEvaluation)
        setInteractionIdentity(snapshot.interactionIdentity || null)
        setInteractionPhase(snapshot.interactionPhase || 'presenting')
        setSubmittedAnswer(snapshot.submittedAnswer)
        setSelfReportedConfidence(snapshot.selfReportedConfidence)
        setHelpUsages(Array.isArray(snapshot.helpUsages) ? snapshot.helpUsages : [])
        currentAssistanceLevelRef.current = snapshot.assistanceLevel || 'independent'
        setPendingNextPage(snapshot.pendingNextPage || null)
        setPendingSystemInfo(snapshot.pendingSystemInfo || null)
        setPendingSessionComplete(!!snapshot.pendingSessionComplete)
        setSystemInfo(snapshot.systemInfo || null)
        setSessionSummary(snapshot.sessionSummary || null)
        setPaused(snapshot.paused === true)
        usedQuestionIdsRef.current = new Set(snapshot.usedQuestionIds || [])
        usedFactKeysRef.current = new Set(snapshot.usedFactKeys || [])
        usedPromptFingerprintsRef.current = new Set(snapshot.usedPromptFingerprints || [])
        restoredSnapshotRef.current = true
        setPhase('ready')
        return
      }

      await callTutor(undefined, undefined, targetMinutes, profile)

    } catch (err: any) {
      console.error('[v3] init error:', err.message)
      setErrorMsg(err.message)
      setPhase('error')
    }
  }

  interface TelemetryPayload {
    responseTimeMs?: number
    assistanceLevel?: 'independent' | 'minimal_hint' | 'guided' | 'assisted' | 'revealed'
    selfReportedConfidence?: number
    interactionContext?: 'learning' | 'immediate_practice' | 'interleaving' | 'delayed_retrieval' | 'spaced_review'
    helpUsageKinds?: string[]
  }

  const callTutorWithTelemetry = async (
    currentSessionId?: string,
    studentAnswer?: any,
    targetMinutes?: number,
    profile?: any,
    telemetry?: TelemetryPayload,
  ) => {
    return callTutor(currentSessionId, studentAnswer, targetMinutes, profile, telemetry)
  }

  const callTutor = async (
    currentSessionId?: string,
    studentAnswer?: any,
    targetMinutes: number = 20,
    profile?: any,
    telemetry?: TelemetryPayload,
  ) => {
    const requestId = `tutor_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    latestRequestIdRef.current = requestId
    try {
      const setup = masteryContext?.setup || {}
      const res = await fetch('/api/adaptive/v3/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId.current,
          materialId: materialId.current,
          sessionId: currentSessionId || sessionId,
          targetMinutes,
          studentProfile: profile || masteryContext?.userProfile,
          studentAnswer,
          requestId,
          // Identidad de la actividad actual — evita heredar ayuda entre actividades
          lastInteractionId: currentPage?.interaction?.id || currentPage?.id || undefined,
          evalPreference: session.evaluationPreference || setup.evalPreference || 'mix_everything',
          examFormat: session.examFormat || setup.examFormat || 'unknown',
          initialKnowledgeLevel: setup.initialKnowledgeLevel || 'some',
          // Propósito pedagógico de la sesión — cambia el comportamiento del tutor
          sessionPurpose: session.purpose || 'understand',
          sessionFormat: session.sessionFormat || 'discovery',
          // ← nuevo: enviar los topics de la sesión para que el tutor filtre micros
          sessionTopicTitles: [
            ...(session.targetConcepts || []),
            ...(session.topicTitle ? [session.topicTitle] : []),
            // Fallback: usar title de la sesión si los anteriores están vacíos
            ...((!(session.targetConcepts?.length) && !session.topicTitle && session.title)
              ? [session.title]
              : []),
          ].filter(Boolean),
          // Restricción determinista — micros asignados a esta sesión del programa
          assignedMicroIds: (session as any).assignedMicroIds || [],
          // ── Telemetría real de la interacción (Fase 3) ──────────
          ...(telemetry?.responseTimeMs !== undefined ? { responseTimeMs: telemetry.responseTimeMs } : {}),
          ...(telemetry?.assistanceLevel ? { assistanceLevel: telemetry.assistanceLevel } : {}),
          ...(telemetry?.selfReportedConfidence !== undefined ? { selfReportedConfidence: telemetry.selfReportedConfidence } : {}),
          ...(telemetry?.interactionContext ? { interactionContext: telemetry.interactionContext } : {}),
          ...(telemetry?.helpUsageKinds?.length ? { helpUsageKinds: telemetry.helpUsageKinds } : {}),
        }),
      })

      if (!res.ok) {
        let errorData: any = {}
        try { errorData = await res.json() } catch {}
        if (res.status === 409 && errorData.code === 'MATERIAL_GRAPH_MISMATCH') {
          throw new Error('MATERIAL_GRAPH_MISMATCH: El programa necesita regenerarse para este material. Por favor, cierra y vuelve a abrir el material.')
        }
        throw new Error(`Error del tutor (${res.status}): ${errorData.error || 'Error desconocido'}`)
      }
      const data = await res.json()
      if (latestRequestIdRef.current !== requestId || data.requestId !== requestId) return
      if (!data.success) throw new Error(data.error || 'Error del tutor')

      if (data.sessionId) setSessionId(data.sessionId)

      // Guardar resultado pedagógico real de la última respuesta
      if (typeof data.isProgramComplete === 'boolean') {
        latestCompletionRef.current = {
          isProgramComplete: data.isProgramComplete,
          unresolvedMicroIds: data.unresolvedMicroIds || [],
          sessionMasteryPercent: data.sessionMasteryPercent ?? undefined,
          sessionCoveragePercent: data.sessionCoveragePercent ?? undefined,
          closeReason: data.closeReason ?? undefined,
        }
      }

      // Siempre preparar la siguiente página
      let nextPage = data.page ? {
        id: 'page_' + Date.now(),
        pageType: data.page.type || 'theory',
        title: data.page.title,
        content: data.page.content || { blocks: [] },
        interaction: data.page.interaction,
        topicId: data.systemInfo?.microId || '',
        createdAt: Date.now(),
      } : null
      console.info('[v3 transition] ASSIGN nextPage', {
        pageId: nextPage?.id || null,
        interactionId: nextPage?.interaction?.id || null,
        questionId: nextPage?.interaction?.questionId || null,
      })

      if (nextPage?.interaction) {
        const preference = normalizeEvalPreference(session.evaluationPreference || setup.evalPreference)
        const prepared = prepareInteractionForDelivery(nextPage.interaction, preference, {
          microId: nextPage.topicId,
          microName: data.systemInfo?.activeMicro || nextPage.title || 'Concepto actual',
          objective: nextPage.title || data.systemInfo?.activeMicro || 'Comprobar comprensión',
        })
        if (prepared.status !== 'valid') {
          console.warn('[v3] INTERACTION_REPAIRED_AT_CLIENT_BOUNDARY', {
            status: prepared.status,
            reasonCodes: prepared.reasonCodes,
            requestId,
          })
        }
        nextPage.interaction = prepared.interaction
      }

      if (nextPage?.interaction) {
        const questionId = String(nextPage.interaction.questionId || nextPage.interaction.id || nextPage.id)
        const factKey = String(nextPage.interaction.factKey || '')
        const promptFingerprint = normalizePrompt(nextPage.interaction.prompt)
        const repetitionIntent = nextPage.interaction.repetitionIntent
        const intentionalFactRepetition = ['spaced_retrieval', 'misconception_retest', 'delayed_recall'].includes(repetitionIntent)
        const repeatsQuestion = usedQuestionIdsRef.current.has(questionId)
        const repeatsFact = !!factKey && usedFactKeysRef.current.has(factKey) && !intentionalFactRepetition
        const repeatsPrompt = !!promptFingerprint && usedPromptFingerprintsRef.current.has(promptFingerprint)
        // Un mismo concepto/factKey puede requerir evidencia nueva. Solo es una
        // repetición real si repite la identidad, o si repite a la vez hecho y prompt.
        const isRepeatedActivity = repeatsQuestion || (repeatsFact && repeatsPrompt)
        if (isRepeatedActivity) {
          console.warn('[v3 transition] REJECT repeated activity', { questionId, factKey, promptFingerprint, repeatsQuestion, repeatsFact, repeatsPrompt })
          nextPage = null
        }
      }

      // Coverage siempre se actualiza
      // Usar materialCoveragePercent (cobertura real estudiada) si existe
      // Fallback a materialLearned (mastery ponderado) para compatibilidad
      const coveragePct = data.coverageReport?.materialCoveragePercent
        ?? data.coverageReport?.materialLearned
      if (coveragePct !== undefined) {
        setCoveragePercent(coveragePct)
      }
      if (data.coverageReport) {
        setLastCoverageReport(data.coverageReport)
      }

      const hasEvaluation = !!data.evaluation
      if (hasEvaluation) {
        const evaluatedInteractionId = data.evaluation.interactionId || interactionIdentity?.interactionId
        const evaluatedQuestionId = data.evaluation.questionId || interactionIdentity?.questionId
        if (!interactionIdentity || evaluatedInteractionId !== interactionIdentity.interactionId || evaluatedQuestionId !== interactionIdentity.questionId) {
          throw new Error('La evaluación recibida no corresponde a la pregunta visible.')
        }
        setLastEvaluation({ ...data.evaluation, interactionId: evaluatedInteractionId, questionId: evaluatedQuestionId })
        setShowEvaluation(true)
        console.info('[v3 transition] SET interactionPhase', 'collecting_confidence')
        setInteractionPhase('collecting_confidence')

        // Guardar la siguiente página Y systemInfo para mostrar después del feedback
        if (nextPage) {
          console.info('[v3 transition] ASSIGN pendingNextPage', { pageId: nextPage.id, interactionId: nextPage.interaction?.id || null })
          setPendingNextPage(nextPage)
        }
        if (data.systemInfo) {
          setPendingSystemInfo(data.systemInfo)
          // Contexto real también cuando hay evaluación
          setActivityContext({
            isSpacedReview: !!data.systemInfo.isSpacedReview,
            isInterleaving: !!data.systemInfo.isInterleaving,
          })
        }
      } else {
        setLastEvaluation(null)
        setShowEvaluation(false)
        setSystemInfo(data.systemInfo)
        if (nextPage) {
          const nextInteractionId = String(nextPage.interaction?.id || nextPage.id)
          const nextQuestionId = String(nextPage.interaction?.questionId || nextPage.interaction?.id || nextPage.id)
          console.info('[v3 transition] CALL setCurrentPage', { pageId: nextPage.id, interactionId: nextPage.interaction?.id || null })
          setCurrentPage(nextPage)
          setInteractionIdentity({ interactionId: nextInteractionId, questionId: nextQuestionId })
          setSubmittedAnswer(undefined)
          setSelfReportedConfidence(undefined)
          setHelpUsages([])
          activityStartTimeRef.current = performance.now()
          currentAssistanceLevelRef.current = 'independent'
          const assignedPhase = nextPage.interaction ? 'answering' : beginPresentation(nextInteractionId).phase
          console.info('[v3 transition] SET interactionPhase', assignedPhase)
          setInteractionPhase(assignedPhase)
          rememberAcceptedPage(nextPage)
        }
        // Guardar contexto pedagógico real desde la respuesta del route
        if (data.systemInfo) {
          setActivityContext({
            isSpacedReview: !!data.systemInfo.isSpacedReview,
            isInterleaving: !!data.systemInfo.isInterleaving,
          })
        }
      }

      if (data.shouldCloseSession) {
        if (!canRenderSessionComplete(data.shouldCloseSession, data.sessionPersisted === true)) {
          throw new Error('La sesión no confirmó su persistencia; no se puede mostrar el cierre.')
        }
        // Guardar el summary del backend (contiene microsCompleted/Total reales)
        if (data.summary) setSessionSummary(data.summary)
        // La evaluación debe seguir visible. El cierre solo se consume en Continuar.
        setPendingSessionComplete(true)
        if (!hasEvaluation) {
          setInteractionPhase('ready_to_continue')
        }
        setPhase('ready')
      } else {
        setPhase('ready')
      }
    } catch (err: any) {
      if (latestRequestIdRef.current !== requestId) return
      console.error('[v3 callTutor]', err.message)
      setErrorMsg(err.message)
      setPhase('error')
    }
  }

  // Niveles canónicos — mismo orden que confidenceTracker.ts
  const ASSISTANCE_ORDER = ['independent', 'minimal_hint', 'guided', 'assisted', 'revealed'] as const
  type AssistanceLevelLocal = typeof ASSISTANCE_ORDER[number]

  // Registrar que el estudiante usó ayuda (llamar cuando abra una pista)
  const registerHintUsed = useCallback((level: AssistanceLevelLocal) => {
    const currentIdx = ASSISTANCE_ORDER.indexOf(currentAssistanceLevelRef.current)
    const newIdx = ASSISTANCE_ORDER.indexOf(level)
    if (newIdx > currentIdx) {
      currentAssistanceLevelRef.current = level
    }
  }, [])

  const handleHelpUsed = useCallback((usage: HelpUsage) => {
    currentAssistanceLevelRef.current = nextAssistanceLevel(currentAssistanceLevelRef.current as AssistanceLevel, usage.assistanceLevel)
    setHelpUsages(current => [...current, usage])
  }, [])

  const submitAnswerWithTelemetry = useCallback(async (answer: any, confidence?: number) => {
    if (evaluationInFlightRef.current || interactionPhase !== 'answering' || !interactionIdentity) return
    evaluationInFlightRef.current = true
    setInteractionPhase('evaluating')
    setPhase('evaluating')
    setLoadingMsg('ALAI está evaluando...')
    setSubmittedAnswer(answer)

    // Calcular responseTimeMs
    const responseTimeMs = activityStartTimeRef.current !== null
      ? Math.round(performance.now() - activityStartTimeRef.current)
      : undefined

    // Determinar interactionContext desde estado React real (no globals)
    // El route ya devuelve isSpacedReview e isInterleaving en systemInfo
    const resolvedContext: 'spaced_review' | 'interleaving' | 'immediate_practice' =
      activityContext.isSpacedReview ? 'spaced_review' :
      activityContext.isInterleaving ? 'interleaving' :
      'immediate_practice'

    try {
      await callTutorWithTelemetry(sessionId || undefined, answer, undefined, undefined, {
        responseTimeMs,
        assistanceLevel: currentAssistanceLevelRef.current,
        selfReportedConfidence: confidence,
        interactionContext: resolvedContext,
        helpUsageKinds: helpUsages.map(usage => usage.kind),
      })
    } finally {
      evaluationInFlightRef.current = false
    }
  }, [interactionPhase, interactionIdentity, sessionId, activityContext, helpUsages])

  const handleAnswer = useCallback(async (answer: any) => {
    await submitAnswerWithTelemetry(answer)
  }, [submitAnswerWithTelemetry])

  const handleContinue = async () => {
    if (advancingRef.current || interactionPhase !== 'ready_to_continue') return
    advancingRef.current = true
    console.info('[v3 transition] SET interactionPhase', 'advancing')
    setInteractionPhase('advancing')

    if (pendingSessionComplete) {
      setInteractionPhase('session_complete')
      setPhase('closing')
      advancingRef.current = false
      return
    }

    // Si hay página pendiente del feedback anterior, mostrarla SIN llamar al tutor
    if (pendingNextPage) {
      const nextPage = pendingNextPage
      const nextSystemInfo = pendingSystemInfo || systemInfo
      const nextInteractionId = String(nextPage.interaction?.id || nextPage.id)
      const nextQuestionId = String(nextPage.interaction?.questionId || nextPage.interaction?.id || nextPage.id)
      setShowEvaluation(false)
      setLastEvaluation(null)
      console.info('[v3 transition] CALL setCurrentPage', { pageId: nextPage.id, interactionId: nextPage.interaction?.id || null })
      setCurrentPage(nextPage)
      if (pendingSystemInfo) setSystemInfo(pendingSystemInfo)
      console.info('[v3 transition] ASSIGN pendingNextPage', null)
      setPendingNextPage(null)
      setPendingSystemInfo(null)
      setInteractionIdentity({ interactionId: nextInteractionId, questionId: nextQuestionId })
      setSubmittedAnswer(undefined)
      setSelfReportedConfidence(undefined)
      setHelpUsages([])
      activityStartTimeRef.current = performance.now()
      currentAssistanceLevelRef.current = 'independent'
      const nextInteractionPhase = nextPage.interaction ? 'answering' : beginPresentation(nextInteractionId).phase
      console.info('[v3 transition] SET interactionPhase', nextInteractionPhase)
      setInteractionPhase(nextInteractionPhase)
      setPhase('ready')
      rememberAcceptedPage(nextPage)
      persistSnapshot({
        currentPage: nextPage,
        lastEvaluation: null,
        showEvaluation: false,
        interactionIdentity: { interactionId: nextInteractionId, questionId: nextQuestionId },
        interactionPhase: nextInteractionPhase,
        submittedAnswer: undefined,
        selfReportedConfidence: undefined,
        helpUsages: [],
        assistanceLevel: 'independent',
        pendingNextPage: null,
        pendingSystemInfo: null,
        systemInfo: nextSystemInfo,
      })
      advancingRef.current = false
      return
    }

    // Si no hay página pendiente, pedir siguiente al tutor
    setPhase('evaluating')
    setShowEvaluation(false)
    setLastEvaluation(null)
    setLoadingMsg('Preparando siguiente paso...')
    try {
      await callTutor(sessionId || undefined)
    } finally { advancingRef.current = false }
  }

  const closeSession = () => {
    setPhase('closing')
    setTimeout(() => {
      onSessionComplete({
        domainGain: Math.round(Math.min(100, (systemInfo?.progress || 0))),
        conceptsImproved: lastCoverageReport?.provisionallyMasteredMicroNames || [],
        stepResults: [],
        materialCoveragePercent: lastCoverageReport?.materialCoveragePercent ?? coveragePercent,
        masteryPercent: Math.round(lastCoverageReport?.overallCoverage ?? Math.min(100, (systemInfo?.progress || 0))),
        studiedMicros: lastCoverageReport?.studiedMicros ?? 0,
        totalMicros: lastCoverageReport?.totalMicros ?? 0,
        weakMicroIds: Array.isArray(lastCoverageReport?.weakMicros) ? lastCoverageReport.weakMicros.map((m: any) => m.microId) : [],
        weakMicroNames: Array.isArray(lastCoverageReport?.weakMicros) ? lastCoverageReport.weakMicros.map((m: any) => m.microName) : [],
        studiedMicroIds: lastCoverageReport?.studiedMicroIds || [],
        provisionallyMasteredMicroIds: lastCoverageReport?.provisionallyMasteredMicroIds || [],
        reinforcementMicroIds: lastCoverageReport?.reinforcementMicroIds || [],
        // Resultado pedagógico real del motor (fuente canónica)
        isProgramComplete: latestCompletionRef.current.isProgramComplete,
        unresolvedMicroIds: latestCompletionRef.current.unresolvedMicroIds,
        sessionMasteryPercent: latestCompletionRef.current.sessionMasteryPercent,
        sessionCoveragePercent: latestCompletionRef.current.sessionCoveragePercent,
        closeReason: latestCompletionRef.current.closeReason,
        confidenceAverage: selfReportedConfidence ?? 50,
        assistanceRate: currentAssistanceLevelRef.current === 'independent' ? 0 : 1,
      })
    }, 2000)
  }

  const persistSnapshot = (overrides: Record<string, unknown> = {}) => {
    localStorage.setItem(persistenceKey, JSON.stringify({
      sessionId, currentPage, lastEvaluation, showEvaluation, interactionIdentity,
      interactionPhase, submittedAnswer, selfReportedConfidence, helpUsages,
      assistanceLevel: currentAssistanceLevelRef.current, pendingNextPage,
      pendingSystemInfo, pendingSessionComplete, systemInfo, sessionSummary,
      paused,
      usedQuestionIds: [...usedQuestionIdsRef.current],
      usedFactKeys: [...usedFactKeysRef.current],
      usedPromptFingerprints: [...usedPromptFingerprintsRef.current],
      savedAt: Date.now(),
      ...overrides,
    }))
  }

  useEffect(() => {
    if (phase !== 'ready' || !currentPage) return
    persistSnapshot()
  }, [phase, sessionId, currentPage, lastEvaluation, showEvaluation, interactionIdentity, interactionPhase, submittedAnswer, selfReportedConfidence, helpUsages, pendingNextPage, pendingSystemInfo, pendingSessionComplete, systemInfo, sessionSummary, paused, persistenceKey])

  if (phase === 'building_graph' || phase === 'loading') {
    return (
      <div style={overlayStyle} data-testid="adaptive-loading" data-phase={phase}>
        <div style={{ fontSize: 52, animation: 'pulse 1.5s ease-in-out infinite' }}>
          {phase === 'building_graph' ? '🕸️' : '📖'}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#f5e6b8', marginTop: 20, textAlign: 'center', maxWidth: 420 }}>
          {loadingMsg}
        </div>
        {phase === 'building_graph' && (
          <div style={{ fontSize: 12, color: '#a8854a', marginTop: 12, fontStyle: 'italic' }}>
            Esto puede tomar 10-30 segundos la primera vez
          </div>
        )}
        <style>{`@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.7;transform:scale(1.05)} }`}</style>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div style={overlayStyle}>
        <div style={{ fontSize: 44, marginBottom: 16 }}>😓</div>
        <div style={{ fontSize: 15, color: '#f5e6b8', marginBottom: 8 }}>Algo salió mal</div>
        <div style={{ fontSize: 13, color: '#a8854a', marginBottom: 24, maxWidth: 400, textAlign: 'center' }}>{errorMsg}</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => { hasStarted.current = false; initSession() }} style={btnGold}>🔄 Reintentar</button>
          <button onClick={onClose} style={btnOutline}>← Volver</button>
        </div>
      </div>
    )
  }

  if (phase === 'closing') {
    // Leer del summary del backend (fuente de verdad); fallback a systemInfo
    const completed = sessionSummary?.microsCompleted ?? systemInfo?.microsCompleted ?? 0
    const total = sessionSummary?.microsTotal ?? systemInfo?.microsTotal ?? 0
    const totalCorrect = sessionSummary?.totalCorrect ?? 0
    const totalIncorrect = sessionSummary?.totalIncorrect ?? 0
    const totalAnswered = totalCorrect + totalIncorrect
    const accuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0

    return (
      <div style={overlayStyle} data-testid="adaptive-session-summary">
        <div style={bookCardStyle} data-testid="adaptive-summary-scroll">
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✨</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#3a2e1f' }}>
              Sesión completada
            </div>
            <div style={{ fontSize: 14, color: '#5a4a2f', marginTop: 6, fontStyle: 'italic' }}>
              {completed} de {total} microconceptos trabajados
            </div>
          </div>

          {/* Métricas rápidas */}
          {totalAnswered > 0 && (
            <div style={{
              display: 'flex', gap: 10, marginBottom: 14,
            }}>
              <div style={{
                flex: 1, padding: '10px 12px', textAlign: 'center',
                background: 'rgba(90,138,58,.08)', borderRadius: 6,
              }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#5a8a3a' }}>{totalCorrect}</div>
                <div style={{ fontSize: 10, color: '#5a4a2f', letterSpacing: 1 }}>ACIERTOS</div>
              </div>
              <div style={{
                flex: 1, padding: '10px 12px', textAlign: 'center',
                background: 'rgba(214,178,111,.12)', borderRadius: 6,
              }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#a8854a' }}>{accuracy}%</div>
                <div style={{ fontSize: 10, color: '#5a4a2f', letterSpacing: 1 }}>PRECISIÓN</div>
              </div>
            </div>
          )}

          {/* Lo que aprendiste */}
          {(['studiedMicroNames', 'provisionallyMasteredMicroNames', 'reinforcementMicroNames'] as const).map((key) => {
            const labels = { studiedMicroNames: 'CONCEPTOS TRABAJADOS', provisionallyMasteredMicroNames: 'DOMINADOS PROVISIONALMENTE', reinforcementMicroNames: 'NECESITAN REFUERZO' }
            const testIds = { studiedMicroNames: 'summary-studied', provisionallyMasteredMicroNames: 'summary-mastered', reinforcementMicroNames: 'summary-reinforcement' }
            const names: string[] = sessionSummary?.[key] || lastCoverageReport?.[key] || []
            if (names.length === 0) return null
            return (
            <div data-testid={testIds[key]} style={{
              padding: '14px 16px',
              background: 'rgba(90,138,58,.08)',
              borderLeft: '4px solid #5a8a3a',
              borderRadius: 6, marginBottom: 14,
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: '#5a8a3a', marginBottom: 8 }}>
                {labels[key]}
              </div>
              {names.map((c, i) => (
                <div key={i} style={{ fontSize: 13, color: '#3a2e1f', marginBottom: 3 }}>
                  ✓ {c}
                </div>
              ))}
            </div>
            )
          })}

          {/* Botón */}
          <button
            onClick={() => {
              onSessionComplete({
                domainGain: Math.round(Math.min(100, systemInfo?.progress || 0)),
                conceptsImproved: sessionSummary?.provisionallyMasteredMicroNames || lastCoverageReport?.provisionallyMasteredMicroNames || [],
                stepResults: [],
                materialCoveragePercent: lastCoverageReport?.materialCoveragePercent ?? coveragePercent,
                masteryPercent: Math.round(lastCoverageReport?.overallCoverage ?? Math.min(100, systemInfo?.progress || 0)),
                studiedMicros: lastCoverageReport?.studiedMicros ?? 0,
                totalMicros: lastCoverageReport?.totalMicros ?? 0,
                weakMicroIds: Array.isArray(lastCoverageReport?.weakMicros) ? lastCoverageReport.weakMicros.map((m: any) => m.microId) : [],
                weakMicroNames: Array.isArray(lastCoverageReport?.weakMicros) ? lastCoverageReport.weakMicros.map((m: any) => m.microName) : [],
                studiedMicroIds: sessionSummary?.studiedMicroIds || lastCoverageReport?.studiedMicroIds || [],
                provisionallyMasteredMicroIds: sessionSummary?.provisionallyMasteredMicroIds || lastCoverageReport?.provisionallyMasteredMicroIds || [],
                reinforcementMicroIds: sessionSummary?.reinforcementMicroIds || lastCoverageReport?.reinforcementMicroIds || [],
                // Resultado pedagógico real del motor (fuente canónica)
                isProgramComplete: latestCompletionRef.current.isProgramComplete,
                unresolvedMicroIds: latestCompletionRef.current.unresolvedMicroIds,
                sessionMasteryPercent: latestCompletionRef.current.sessionMasteryPercent,
                sessionCoveragePercent: latestCompletionRef.current.sessionCoveragePercent,
                closeReason: latestCompletionRef.current.closeReason,
              })
            }}
            style={{
              width: '100%', padding: '14px',
              background: '#3a2e1f', color: '#f5ecd5',
              border: 'none', borderRadius: 8,
              fontFamily: 'Georgia, serif',
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
              marginTop: 8,
            }}
          >
            Ver mi progreso →
          </button>
        </div>
      </div>
    )
  }

  const progressPct = systemInfo?.progress || 0
  const learningStatus = objectiveLearningStatus(systemInfo?.objective)
  const adaptationMessage = objectiveAdaptationMessage(systemInfo?.objective)

  return (
    <div
      style={overlayStyle}
      data-testid="adaptive-session"
      data-interaction-phase={interactionPhase}
      data-interaction-id={interactionIdentity?.interactionId || ''}
      data-question-id={interactionIdentity?.questionId || ''}
    >
      <button onClick={() => { localStorage.removeItem('studyal_v3_paused_session'); persistSnapshot({ paused: false }); onClose() }} style={{
        position: 'absolute', top: 20, left: 24,
        background: 'rgba(214,178,111,0.08)', border: '1px solid rgba(214,178,111,0.3)',
        color: 'rgba(214,178,111,0.9)', padding: '8px 16px', borderRadius: 999,
        fontSize: 11, cursor: 'pointer', letterSpacing: 1.5,
        fontFamily: 'Georgia, serif', zIndex: 200,
      }}>← VOLVER AL LIBRO</button>
      <button data-testid="pause-session" onClick={() => { setPaused(true); localStorage.setItem('studyal_v3_paused_session', JSON.stringify({ paused: true, sessionId: session.id })); persistSnapshot({ paused: true }) }} disabled={paused} style={{ position: 'absolute', top: 20, right: 24, zIndex: 200, padding: '8px 16px', borderRadius: 999, border: '1px solid rgba(214,178,111,.3)', background: 'rgba(214,178,111,.08)', color: 'rgba(214,178,111,.9)', cursor: paused ? 'default' : 'pointer' }}>Pausar</button>
      {paused && <div data-testid="session-paused" role="dialog" aria-modal="true" style={{ position: 'absolute', inset: 0, zIndex: 500, display: 'grid', placeItems: 'center', background: 'rgba(20,16,12,.82)', backdropFilter: 'blur(4px)' }}><div style={{ background: '#f5ecd5', color: '#3a2e1f', padding: 28, borderRadius: 14, textAlign: 'center' }}><h2>Sesión en pausa</h2><p>Tu actividad y progreso siguen guardados.</p><button data-testid="resume-session" onClick={() => { setPaused(false); localStorage.removeItem('studyal_v3_paused_session'); persistSnapshot({ paused: false }) }} style={{ padding: '12px 20px', border: 0, borderRadius: 8, background: '#3a2e1f', color: '#f5ecd5', fontWeight: 700 }}>Continuar con mi plan</button></div></div>}

      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'rgba(214,178,111,0.15)' }}>
        <div style={{
          height: '100%', width: `${progressPct}%`,
          background: 'linear-gradient(90deg, #d6b26f, #a8854a)',
          transition: 'width .5s ease',
        }} />
      </div>

      <div style={bookCardStyle}>
        {/* Header limpio sin telemetría */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 20, paddingBottom: 14,
          borderBottom: '2px solid rgba(42,31,20,.06)',
        }}>
          <div style={{ flex: 1 }}>
            {/* Breadcrumb pedagógico */}
            {systemInfo && (
              <div data-testid="study-progress-breakdown" style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 1.2,
                color: '#a8854a', marginBottom: 6, textTransform: 'uppercase',
              }}>
                <span>{learningStatus}</span>
              </div>
            )}
            <div style={{ fontSize: 24, fontWeight: 800, color: '#2a1f14', lineHeight: 1.2 }}>
              {systemInfo?.activeMicro || session.title}
            </div>
            {systemInfo && <div style={{ marginTop: 7, fontSize: 13, color: '#7a6a4f' }}>
              Trabajados {lastCoverageReport?.studiedMicroIds?.length || systemInfo.microsCompleted || 0}/{systemInfo.microsTotal || '?'}
              <span aria-hidden="true"> · </span>
              Dominados {lastCoverageReport?.provisionallyMasteredMicroIds?.length || 0}/{systemInfo.microsTotal || '?'}
            </div>}
          </div>
          {systemInfo && (
            <div style={{
              padding: '6px 14px', borderRadius: 999,
              background: 'rgba(214,178,111,.15)',
              fontSize: 13, fontWeight: 700, color: '#a8854a',
            }}>
              {coveragePercent}% del material
            </div>
          )}
        </div>

        {adaptationMessage && !showEvaluation && phase === 'ready' && (
          <div data-testid="adaptive-explanation" style={{ margin: '-8px 0 16px', padding: '10px 14px', borderRadius: 9, background: 'rgba(214,178,111,.1)', color: '#5a4a2f', fontSize: 14, lineHeight: 1.5 }}>
            <strong>Por qué hacemos esto:</strong> {adaptationMessage}
          </div>
        )}

        {/* Razonamiento del motor oculto en producción */}

        {/* Feedback movido a PaginatedBookPage — inline debajo de la pregunta */}

        {phase === 'evaluating' && (
          <div aria-busy="true" data-testid="adaptive-evaluating" style={{ padding: '28px 8px', pointerEvents: 'none' }}>
            <div data-testid="adaptive-loading-indicator" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, color: '#5a4a2f', fontSize: 14, fontWeight: 700 }}>
              <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: '50%', background: '#d6b26f', animation: 'v3LoadingPulse 1s ease-in-out infinite' }} />
              {loadingMsg === 'Preparando siguiente paso...'
                ? 'ALAI está preparando la siguiente actividad'
                : loadingMsg}
            </div>
            {[92, 76, 84, 58].map((width, index) => (
              <div key={width} style={{
                width: `${width}%`, height: index === 0 ? 22 : 14,
                borderRadius: 7, marginBottom: 14,
                background: 'linear-gradient(90deg, rgba(58,46,31,.06), rgba(214,178,111,.2), rgba(58,46,31,.06))',
                backgroundSize: '200% 100%', animation: 'v3Skeleton 1.2s ease-in-out infinite',
              }} />
            ))}
            <style>{`@keyframes v3Skeleton { 0%{background-position:200% 0} 100%{background-position:-200% 0} } @keyframes v3LoadingPulse { 0%,100%{opacity:.35;transform:scale(.85)} 50%{opacity:1;transform:scale(1)} }`}</style>
          </div>
        )}

        {phase === 'ready' && currentPage && !currentPage.interaction && !showEvaluation && systemInfo?.activeMicro && (
          <AskWidget
            microName={systemInfo.activeMicro}
            microDefinition={currentPage.content?.blocks?.map((b: any) => b?.text).filter(Boolean).join(' ').slice(0, 500)}
            microExamples={currentPage.content?.blocks?.filter((b: any) => b?.type === 'example')}
            microFormulas={currentPage.content?.blocks?.filter((b: any) => b?.type === 'formula')}
          />
        )}
        {/* ── Selector de confianza (Fase 3) ── */}
        {interactionPhase === 'collecting_confidence' && showEvaluation && (
          <div data-testid="adaptive-confidence" style={{
            flexShrink: 0, zIndex: 50,
            background: 'rgba(245,236,213,0.94)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            borderRadius: 10, padding: 14, marginBottom: 10,
            border: '1px solid rgba(214,178,111,.35)',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#3a2e1f', marginBottom: 8, textAlign: 'center' }}>
              ¿Qué tan seguro/a estabas?
            </div>
            <div style={{ fontSize: 13, color: '#7c5a0e', marginBottom: 12, textAlign: 'center' }}>
              Esto ayuda a ALAI a calibrar tu aprendizaje
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              {[
                { label: 'No estaba seguro/a', value: 20 },
                { label: 'Más o menos', value: 50 },
                { label: 'Bastante seguro/a', value: 80 },
                { label: 'Totalmente seguro/a', value: 100 },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setSelfReportedConfidence(opt.value)
                    setInteractionPhase('ready_to_continue')
                  }}
                  style={{
                    padding: '12px 18px',
                    borderRadius: 8,
                    border: '1.5px solid #d4a544',
                    background: 'transparent',
                    color: '#3a2e1f',
                    fontFamily: 'Georgia, serif',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setInteractionPhase('ready_to_continue')}
              style={{
                marginTop: 16,
                background: 'transparent',
                border: 'none',
                color: '#a8854a',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'Georgia, serif',
              }}
            >
              Omitir
            </button>
          </div>
        )}

        {shouldRenderActiveContent(phase === 'ready' ? 'ready' : phase === 'evaluating' ? 'evaluating' : 'loading') && currentPage && (
          <PaginatedBookPage
            page={currentPage}
            onSubmitAnswer={handleAnswer}
            onContinue={handleContinue}
            disabled={currentPage.interaction
              ? interactionPhase !== 'answering'
              : interactionPhase !== 'ready_to_continue'}
            evaluation={showEvaluation && lastEvaluation ? lastEvaluation : null}
            showContinue={interactionPhase === 'ready_to_continue'}
            helpUsages={helpUsages}
            onHelpUsed={handleHelpUsed}
            activeMicroName={systemInfo?.activeMicro}
          />
        )}
      </div>

    </div>
  )
}

function objectiveLearningStatus(objective?: string): string {
  if (objective === 'introduce') return 'Aprendiendo una idea nueva'
  if (['reconstruct_from_error', 'address_misconception', 'reveal_answer'].includes(objective || '')) return 'Aclarando una dificultad'
  if (objective === 'illustrate_with_example') return 'Viendo un ejemplo'
  if (['test_application', 'test_transfer'].includes(objective || '')) return 'Aplicando lo aprendido'
  if (objective === 'consolidate') return 'Consolidando el concepto'
  return 'Comprobando tu comprensión'
}

function objectiveAdaptationMessage(objective?: string): string {
  if (objective === 'introduce') return 'Primero construimos una base clara; todavía no tienes que demostrar dominio.'
  if (objective === 'reconstruct_from_error') return 'La respuesta anterior mostró una confusión concreta. Vamos a reconstruir la idea desde otro ángulo.'
  if (objective === 'address_misconception') return 'Tu seguridad y tu respuesta no coincidieron; contrastaremos las dos ideas para que la diferencia quede clara.'
  if (objective === 'reveal_answer') return 'Antes de volver a intentarlo, necesitas ver qué relación decide la respuesta y por qué.'
  if (objective === 'illustrate_with_example') return 'Una explicación abstracta no basta aquí; veremos la misma idea en un caso concreto.'
  if (objective === 'test_application') return 'Ya reconoces la idea. Ahora comprobaremos si puedes usarla en un caso nuevo.'
  if (objective === 'test_transfer') return 'Ya puedes aplicarla en su contexto habitual; ahora veremos si puedes transferirla.'
  if (objective === 'verify_understanding') return 'No buscamos memoria mecánica: esta actividad comprueba una evidencia distinta.'
  return ''
}

function EvidenceProfileBadge({ profile, missing }: { profile: any; missing: string[] }) {
  const evidenceTypes = [
    { key: 'recognized', short: 'Re' },
    { key: 'recalled', short: 'Me' },
    { key: 'explained', short: 'Ex' },
    { key: 'applied', short: 'Ap' },
    { key: 'connected', short: 'Co' },
    { key: 'transferred', short: 'Tr' },
  ]

  return (
    <div style={{
      display: 'flex', gap: 3, alignItems: 'center',
      padding: '4px 8px', background: 'rgba(58,46,31,.04)',
      borderRadius: 6, border: '1px solid rgba(58,46,31,.08)',
    }}>
      {evidenceTypes.map(({ key, short }) => {
        const strong = profile?.strongCount?.[key] || 0
        const medium = profile?.mediumCount?.[key] || 0
        const isMissing = (missing || []).includes(key)

        let color = '#c8c8c8'
        if (strong > 0) color = '#5a8a3a'
        else if (medium > 0) color = '#d4a544'
        else if (isMissing) color = '#e74c3c'

        return (
          <div key={key} style={{
            width: 20, height: 20, borderRadius: 4,
            background: color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 8, fontWeight: 800, color: '#fff',
          }}>
            {short}
          </div>
        )
      })}
      <div style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#3a2e1f' }}>
        {formatScoreDisplay(profile?.masteryScore)}%
      </div>
    </div>
  )
}

function getMasteryLabel(level: string): string {
  const map: Record<string, string> = {
    unseen: 'Sin ver',
    introduced: 'Introducido',
    partially_understood: 'Casi',
    understood: 'Entendido',
    applied: 'Aplicado',
    connected: 'Conectado',
    mastered: 'Dominado',
    struggling: 'Cuesta',
  }
  return map[level] || level
}

function getMasteryColor(level: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    unseen: { bg: 'rgba(107,107,107,.15)', text: '#5c5c5c' },
    introduced: { bg: 'rgba(59,130,246,.15)', text: '#1e40af' },
    partially_understood: { bg: 'rgba(214,178,111,.2)', text: '#7c5a0e' },
    understood: { bg: 'rgba(90,138,58,.15)', text: '#3a5a1e' },
    applied: { bg: 'rgba(90,138,58,.2)', text: '#2d4a17' },
    connected: { bg: 'rgba(90,138,58,.25)', text: '#1f3a0f' },
    mastered: { bg: 'rgba(212,165,68,.2)', text: '#7a5d17' },
    struggling: { bg: 'rgba(139,26,26,.1)', text: '#8b1a1a' },
  }
  return map[level] || map.unseen
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 100,
  background: 'radial-gradient(ellipse at center, #1a1410 0%, #0a0806 100%)',
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  padding: 24, overflow: 'hidden',
  fontFamily: 'Georgia, serif',
}

const bookCardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 920,
  height: 'calc(100vh - 60px)',
  background: 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)',
  borderRadius: 14,
  padding: '28px 48px',
  fontFamily: 'Georgia, serif',
  color: '#2a1f14',
  boxShadow: '0 30px 80px rgba(0,0,0,.7)',
  display: 'flex',
  flexDirection: 'column',
  overflowX: 'hidden',
  overflowY: 'auto',
  position: 'relative',
}

const btnGold: React.CSSProperties = {
  padding: '12px 24px', borderRadius: 8,
  border: '1.5px solid #d4a544', background: '#d4a544',
  color: '#1a1410', fontFamily: 'Georgia, serif',
  fontSize: 14, fontWeight: 700, cursor: 'pointer',
}

const btnOutline: React.CSSProperties = {
  padding: '12px 24px', borderRadius: 8,
  border: '1.5px solid #a8854a', background: 'transparent',
  color: '#a8854a', fontFamily: 'Georgia, serif',
  fontSize: 14, fontWeight: 700, cursor: 'pointer',
}
