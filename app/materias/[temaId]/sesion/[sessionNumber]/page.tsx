"use client"

import {
  initRecoveryMetrics,
  recordAutoRetry,
  recordGenerationAttempt,
  recordResolved,
  buildRetryScheduledPayload,
  buildRetryStartedPayload,
  buildRetrySucceededPayload,
  buildRetryAbandonedPayload,
  buildRoundQualitySummary,
  buildSessionSummary,
  clearAllRecoveryMetrics,
} from "../../../../../lib/adaptive/evaluation/recoveryTelemetry"
import { useEffect, useState, useRef, useCallback } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { AcademicContent } from "../../../../../components/academic/AcademicContent"
import { AcademicListbox } from "../../../../../components/academic/AcademicListbox"
import { toLatexSafeText } from "../../../../../lib/academic-content/composition"
import { AlaiSessionChat, type AlaiChatMessage } from "../../../../../components/materias/AlaiSessionChat"
import { isAdministrativeQuery } from "../../../../../lib/adaptive/evaluation/chatAssistanceClassifier"
import { presentAnswer } from "../../../../../lib/adaptive/evaluation/answerPresentation"
import {
  beginRecoveryReteach,
  beginRecoveryVerification,
  deferNormalBlockFailures,
  latestRecoveryFailure,
  nextRecoveryItem,
  normalizeRestoredRecoveryItem,
  persistRecoveryVerificationQuestions,
  prepareVerificationGenerationRetry,
  presentRecoveryVerificationQuestion,
  recordRecoveryCheck,
  recordRecoveryReteachContent,
  recordVerificationGenerationAttempt,
  releaseNormalBlockRecoveries,
  recoveryCompletionAudit,
  recoveryVisibilityAudit,
  RECOVERY_SEMANTIC_EQUIVALENCE_THRESHOLD,
  selectRecoveryStrategy,
  validateRecoveryTargetAlignment,
  type RecoveryItem,
} from "../../../../../lib/adaptive/evaluation/recoveryQueue"

import {
  getSessionById,
  syncSessionsFromServer,
  updateSessionById,
} from "../../../../../lib/studySessions"
import {
  adaptivePlanRoute,
  adaptiveSessionRoute,
  completeAdaptiveSession,
  replayAdaptiveSession,
  startAdaptiveSession,
  navigateToExistingPlan,
} from "../../../../../lib/adaptive/resume"

import {
  buildCoverageMap,
  getStepsForCheckpoint,
  type CoverageMap,
} from "../../../../../lib/adaptive/evaluation/coverageExtractor"
import { isRecord, matchingCorrectPairs, matchingDisplayOptions, questionSimilarity, realFactKeysOf, type CanonicalQuestion } from "../../../../../lib/adaptive/evaluation/questionContract"
import { computeGenerationHistorySignals } from "../../../../../lib/adaptive/evaluation/generationHistorySignals"
import { parsePreparedRecoveryRound, type PreparedRecoveryRound } from "../../../../../lib/adaptive/evaluation/preparedRecoveryRound"
import {
  EVALUATION_MODE_VIOLATION,
  normalizeEvaluationMode,
  validateQuestionTypeForMode,
} from "../../../../../lib/adaptive/evaluation/evaluationModeContract"
import {
  buildAssessmentBlueprint,
  canCompleteSessionFromAssessment,
  normalizeAssessmentBlueprint,
  planAssessmentQuestions,
  recordAssessmentEvidence,
  type AssessmentBlueprint,
} from "../../../../../lib/adaptive/evaluation/assessmentBlueprint"
import {
  closeNormalEvaluationBlock,
  createEvaluationBlockProgress,
  markRecoveryReady,
  recordNormalBlockAnswer,
  RecoveryGenerationCoordinator,
  resolveBlockRecovery,
  type EvaluationBlock,
  type EvaluationBlockProgress,
  type SessionEvaluationQuestion,
} from "../../../../../lib/adaptive/evaluation/sessionEvaluation"
import {
  resolveSessionKind,
  shouldEvaluateSession,
  validateSessionEvaluationForKind,
  type SessionKind,
} from "../../../../../lib/adaptive/sessionKind"
import {
  clampTeachingStepIndex,
  deriveNextSessionAction,
  getPrimaryActionLabel,
  getRecoveryActionLabel,
  type SessionAction,
  type SessionTransitionState,
} from "../../../../../lib/adaptive/sessionFinalTransition"

type SessionPhase = "teaching" | "evaluating" | "feedback" | "reteaching" | "verification_generation"

interface ClassStep {
  id: string
  type: string
  title: string
  content: string
  keyPoint: string | null
  keyPoints?: string[]
  relatedBlockIds: string[]
  microId?: string
  factKeys?: string[]
  cognitiveTarget?: CanonicalQuestion["targetDimension"]
  objectiveIds?: string[]
  importance?: "supporting" | "important" | "critical"
}

interface ClassContent {
  sessionId: string
  sessionTitle: string
  sessionNumber: number
  sessionKind: SessionKind
  materialType: string
  sessionIntro: string
  steps: ClassStep[]
  sessionClosing: string
  totalSteps: number
  checkpoints?: any[]
  recoveryQueue?: RecoveryItem[]
  assessmentBlueprint?: AssessmentBlueprint
  contentVersion?: string
  assessmentPlanVersion?: number
  evaluationBlocks?: EvaluationBlock[]
  evaluationProgress?: Record<string, EvaluationBlockProgress>
  evaluationCoverage?: { coverageRatio: number }
  chatHistory?: AlaiChatMessage[]
  // AUDITORÍA ADVERSARIAL (post-7a3c3f7, Finding 1 CONFIRMADO): hintShownRef
  // y chatAssistedRef eran refs efímeros en memoria, sin persistencia — un
  // refresh a mitad de una pregunta/verificación ya asistida los reseteaba a
  // false SIN resetear la pregunta en sí (el bloque persistido re-presenta
  // la MISMA pregunta), permitiendo responder "de nuevo" y que
  // currentAssistanceLevel() devolviera 'independent' incorrectamente. Fix:
  // la asistencia pertenece al INTENTO (questionId + recoveryId/round si
  // aplica), se persiste igual que chatHistory/assessmentBlueprint, y solo
  // se restaura si coincide EXACTAMENTE con el intento activo — nunca se
  // aplica a una pregunta distinta.
  pendingAssistance?: { attemptKey: string; assistanceLevel: "minimal_hint" | "assisted" } | null
}

const SI = { intro: "🎯", concept: "💡", formula: "🔢", example: "📝", connection: "🔗", warning: "⚠️", recap: "📋", closing: "🏁" } as Record<string, string>
const SL = { intro: "Introducción", concept: "Concepto", formula: "Fórmula", example: "Ejemplo", connection: "Conexión", warning: "Atención", recap: "Repaso", closing: "Cierre" } as Record<string, string>

export default function SessionPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const temaId = params?.temaId as string
  const sessionNumber = parseInt(params?.sessionNumber as string)
  const adaptiveSessionId = searchParams?.get("adaptiveSessionId") || ""

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [classContent, setClassContent] = useState<ClassContent | null>(null)
  const classContentRef = useRef<ClassContent | null>(null)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [sessionData, setSessionData] = useState<any>(null)
  const [hasNextSession, setHasNextSession] = useState(false)
  const [sessionKind, setSessionKind] = useState<SessionKind>("learning")
  const actionInFlightRef = useRef(false)
  const transitionIdRef = useRef(0)
  const completionRenderedRef = useRef(false)
  const inFlightGenerationKeyRef = useRef<string | null>(null)
  const sessionPreparationPromiseRef = useRef<Promise<any> | null>(null)
  const recoveryPrefetchRef = useRef(new Map<string, Promise<any>>())
  const recoveryGenerationCoordinatorRef = useRef(new RecoveryGenerationCoordinator<any>(2))
  const verificationClickStartedAtRef = useRef<number | null>(null)
  const autoRecoveryRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Auditoría adversarial (Codex Finding 1): fuente REAL de assistance por
  // intento — se activa únicamente cuando el bloque de pista realmente se
  // renderizó para currentQuestion (misma condición que el JSX de abajo), no
  // por la mera presencia de question.hint (algunos formatos, p.ej. ordering,
  // nunca llegan a mostrarla porque isAnswerReady() ya es true desde el primer
  // render). Se resetea a false en cada cambio de pregunta.
  const hintShownRef = useRef(false)

  const [sessionPhase, setSessionPhase] = useState<SessionPhase>("teaching")
  const [coverageMap, setCoverageMap] = useState<CoverageMap | null>(null)
  const [assessmentBlueprint, setAssessmentBlueprint] = useState<AssessmentBlueprint | null>(null)
  const assessmentBlueprintRef = useRef<AssessmentBlueprint | null>(null)
  const [skipEvaluation, setSkipEvaluation] = useState(false)
  const [pendingQuestions, setPendingQuestions] = useState<CanonicalQuestion[]>([])
  const [previousQuestions, setPreviousQuestions] = useState<CanonicalQuestion[]>([])
  const [currentQuestion, setCurrentQuestion] = useState<CanonicalQuestion | null>(null)
  const [userAnswer, setUserAnswer] = useState<any>(null)
  // Codex Finding 1: la pista debe ser opt-in (el estudiante la pide
  // explícitamente), no auto-visible — de lo contrario "assisted" pasaría a
  // ser el estado por defecto de CUALQUIER pregunta con hint (la gran
  // mayoría del contenido real generado), y ninguna respuesta normal podría
  // volver a demostrar un factKey independientemente. Con reveal explícito,
  // "sin ayuda" es el caso común real, "asistido" solo ocurre cuando el
  // estudiante genuinamente pide ayuda — la distinción vuelve a ser
  // pedagógicamente significativa en vez de un hardcode inverso.
  const [hintRevealed, setHintRevealed] = useState(false)
  // PARTE B — chat ALAI. chatAssistedRef sigue el MISMO patrón que
  // hintShownRef: fuente real de asistencia (ref, no state — no debe
  // disparar un re-render por sí sola), se resetea en el mismo efecto que
  // hintShownRef (por currentQuestion?.id), y solo se activa por una acción
  // explícita del estudiante (enviar un mensaje académico), nunca por abrir
  // el panel. chatOpen/chatMessages/chatSending son UI/estado de
  // presentación puros, sin ningún efecto sobre evidence.
  const chatAssistedRef = useRef(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<AlaiChatMessage[]>([])
  const [chatSending, setChatSending] = useState(false)
  // Finding 1 (auditoría adversarial post-7a3c3f7): registro de asistencia
  // restaurado tras un refresh/remount — SOLO se aplica si su attemptKey
  // coincide exactamente con el intento actualmente activo (ver
  // currentAssistanceLevel()/currentAttemptKey() más abajo). Nunca se limpia
  // por el efecto de "nueva pregunta" (eso destruiría el valor que acaba de
  // restaurarse cuando currentQuestion pasa de null a la pregunta
  // reactivada) — se limpia únicamente cuando el intento se CONSUME
  // (recordNormalAnswerOutcome/recordRecoveryVerificationOutcome), momento
  // en el que además queda persistido null explícitamente.
  const restoredAssistanceRef = useRef<{ attemptKey: string; assistanceLevel: "minimal_hint" | "assisted" } | null>(null)
  const [evalResult, setEvalResult] = useState<any>(null)
  const [evalLoading, setEvalLoading] = useState(false)
  const [evalError, setEvalError] = useState<string | null>(null)
  const [reteachingContent, setReteachingContent] = useState<string | null>(null)
  const [failedQuestions, setFailedQuestions] = useState<Array<{ question: CanonicalQuestion; answer: any; result: any }>>([])
  const failedQuestionsRef = useRef<Array<{ question: CanonicalQuestion; answer: any; result: any }>>([])
  const [recoveryQueue, setRecoveryQueue] = useState<RecoveryItem[]>([])
  const recoveryQueueRef = useRef<RecoveryItem[]>([])
  const [activeRecoveryId, setActiveRecoveryId] = useState<string | null>(null)
  const [activeEvaluationBlockId, setActiveEvaluationBlockId] = useState<string | null>(null)
  const [evaluationProgress, setEvaluationProgress] = useState<Record<string, EvaluationBlockProgress>>({})
  const evaluationProgressRef = useRef<Record<string, EvaluationBlockProgress>>({})
  const lastEvalStepsRef = useRef<ClassStep[]>([])
  const recoveryRestoreStartedRef = useRef(false)
  const pendingRecoveryOutcomeRef = useRef<{
    questionId: string
    recorded: ReturnType<typeof recordRecoveryCheck>
    nextQueue: RecoveryItem[]
  } | null>(null)
  const pendingNormalAnswerOutcomeRef = useRef<{
    questionId: string
    block: EvaluationBlock | null
    nextProgress: EvaluationBlockProgress | null
    queueAfterAnswer: RecoveryItem[]
  } | null>(null)

  // Break timer
  const [showBreak, setShowBreak] = useState(false)
  const activeStudyMsRef = useRef(0)
  const breakHoursAcknowledgedRef = useRef(0)

  // Word bank state
  const [wordBankAnswers, setWordBankAnswers] = useState<string[]>([])
  // Ordering state
  const [orderingAnswers, setOrderingAnswers] = useState<string[]>([])
  // Matching state
  const [matchingAnswers, setMatchingAnswers] = useState<Record<string, string>>({})

  // Active study time excludes hidden tabs and an open break prompt.
  useEffect(() => {
    let secondsSincePersist = 0
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible" || showBreak) return
      activeStudyMsRef.current += 1000
      secondsSincePersist += 1
      const completedHours = Math.floor(activeStudyMsRef.current / (60 * 60 * 1000))
      if (completedHours > breakHoursAcknowledgedRef.current) {
        setShowBreak(true)
      }
      if (secondsSincePersist >= 60 && sessionData?.id) {
        secondsSincePersist = 0
        updateSessionById(sessionData.id, current => ({
          ...current,
          activeStudyMs: activeStudyMsRef.current,
          breakHoursAcknowledged: breakHoursAcknowledgedRef.current,
        }))
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [showBreak, sessionData?.id])

  useEffect(() => { if (temaId && sessionNumber) void loadContext() }, [temaId, sessionNumber, adaptiveSessionId])
  useEffect(() => { recoveryQueueRef.current = recoveryQueue }, [recoveryQueue])
  useEffect(() => { failedQuestionsRef.current = failedQuestions }, [failedQuestions])

  function persistFailedQuestions(
    nextOrUpdater:
      | Array<{ question: CanonicalQuestion; answer: any; result: any }>
      | ((previous: Array<{ question: CanonicalQuestion; answer: any; result: any }>) => Array<{ question: CanonicalQuestion; answer: any; result: any }>)
  ) {
    const next =
      typeof nextOrUpdater === "function"
        ? (nextOrUpdater as (previous: Array<{ question: CanonicalQuestion; answer: any; result: any }>) => Array<{ question: CanonicalQuestion; answer: any; result: any }>)(failedQuestionsRef.current)
        : nextOrUpdater
    failedQuestionsRef.current = next
    setFailedQuestions(next)
  }
  useEffect(() => { evaluationProgressRef.current = evaluationProgress }, [evaluationProgress])
  useEffect(() => { classContentRef.current = classContent }, [classContent])
  useEffect(() => { assessmentBlueprintRef.current = assessmentBlueprint }, [assessmentBlueprint])
  // hintShownRef se marca true SOLO por la acción explícita de pedir la
  // pista (ver el botón "Ver pista" en el render) — no por su mera
  // disponibilidad. Se resetea con cada pregunta nueva.
  useEffect(() => { hintShownRef.current = false; setHintRevealed(false) }, [currentQuestion?.id])
  // chatAssistedRef pertenece al INTENTO actual (misma pregunta/verificación),
  // igual que hintShownRef — debe resetear con cada pregunta nueva para que
  // la asistencia de una pregunta NUNCA se filtre a la siguiente.
  useEffect(() => { chatAssistedRef.current = false }, [currentQuestion?.id])
  // OBJETIVO A: si el estudiante dejó el panel abierto y la sesión entra en
  // evaluación/reevaluación independiente (p.ej. al pulsar "Siguiente
  // pregunta"), el componente deja de montarse (ver render) — cerrar
  // chatOpen aquí evita que, al volver más tarde a un contexto donde el
  // chat sí se monta (feedback/teaching/reteaching), reaparezca ya abierto
  // por sorpresa en vez de arrancar cerrado como cualquier apertura nueva.
  useEffect(() => {
    if (sessionPhase === "evaluating" && currentQuestion) setChatOpen(false)
  }, [sessionPhase, currentQuestion?.id])
  useEffect(() => {
    clearAllRecoveryMetrics()
    return () => {
      if (autoRecoveryRetryTimerRef.current) clearTimeout(autoRecoveryRetryTimerRef.current)
      clearAllRecoveryMetrics()
    }
  }, [])
  useEffect(() => {
    if (!completed || completionRenderedRef.current) return
    completionRenderedRef.current = true
    console.info("[adaptive-session-transition]", JSON.stringify({
      event:"session_completion_rendered", sessionId:sessionData?.id,
      transitionId:transitionIdRef.current,
    }))
  }, [completed, sessionData?.id])

  useEffect(() => {
    if (loading || !classContent || !shouldEvaluateSession(sessionKind) || sessionPhase !== "teaching" || activeRecoveryId) return
    const stepId = classContent.steps[currentStepIndex]?.id
    const block = classContent.evaluationBlocks?.find(candidate => candidate.afterStepId === stepId)
    if (!block) return
    const progress = evaluationProgressRef.current[block.id]
    if (progress?.status === "answering" && progress.currentQuestionIndex > 0) {
      startEvaluationBlock(block)
    }
  }, [loading, classContent, currentStepIndex, sessionPhase, activeRecoveryId, sessionKind])

  useEffect(() => {
    if (loading || !classContent || !shouldEvaluateSession(sessionKind) || recoveryRestoreStartedRef.current || sessionPhase !== "teaching") return
    const pending = nextRecoveryItem(recoveryQueue)
    if (!pending) return
    recoveryRestoreStartedRef.current = true
    const restored = normalizeRestoredRecoveryItem(pending)
    const restoredQueue = recoveryQueue.map(item => item.recoveryId === restored.recoveryId ? restored : item)
    if (restored !== pending) persistRecoveryQueue(restoredQueue)
    if (restored.status === "verification_ready" || restored.status === "verification_active") {
      setActiveRecoveryId(restored.recoveryId)
      const roundId = `${restored.recoveryId}:round:${restored.verificationRound}`
      const roundWasPresented = restored.verificationQuestions.some(question =>
        question.roundId === roundId && question.presentedAt !== null
      )
      if (restored.status === "verification_ready" &&
          restored.preparedReteachContent &&
          !roundWasPresented) {
        void startRecoveryReteach(restoredQueue, restored.recoveryId)
        return
      }
      const presented = presentRecoveryVerificationQuestion(restored)
      const presentedQueue = restoredQueue.map(item => item.recoveryId === restored.recoveryId ? presented.item : item)
      persistRecoveryQueue(presentedQueue)
      if (presented.question) {
        activateQuestion(presented.question)
        setSessionPhase("evaluating")
      } else {
        void generateRecoveryQuestions(presented.item, presentedQueue)
      }
    } else if (restored.status === "pending_verification") {
      setActiveRecoveryId(restored.recoveryId)
      void generateRecoveryQuestions(restored, restoredQueue)
    } else {
      void startRecoveryReteach(restoredQueue, restored.recoveryId)
    }
  }, [loading, classContent, recoveryQueue, sessionPhase, sessionKind])

  async function loadContext() {
    setLoading(true)
    setError(null)
    try {
      if (!adaptiveSessionId) { setError("Falta sesión adaptativa"); setLoading(false); return }
      await syncSessionsFromServer(temaId)
      let as_ = getSessionById(adaptiveSessionId)
      if (!as_ || as_.temaId !== temaId || as_.processMode !== "adaptive") { setError("Sesión no encontrada"); setLoading(false); return }

      // Blueprint se borra del localStorage para ahorrar espacio.
      // Si no está en local, pedirlo directo al servidor.
      if (!as_.blueprint || !as_.journey) {
        try {
          const r = await fetch(`/api/study-sessions?sessionId=${encodeURIComponent(adaptiveSessionId)}`, { cache: "no-store" })
          const j = await r.json()
          const srv = (j.sessions || []).find((s: any) => s.id === adaptiveSessionId)
          if (srv) {
            if (!as_.blueprint && (srv.blueprint || srv.materialBlueprint || srv.material_blueprint)) {
              as_ = { ...as_, blueprint: srv.blueprint || srv.materialBlueprint || srv.material_blueprint }
            }
            if (!as_.journey && (srv.journey || srv.adaptiveProgram)) {
              as_ = { ...as_, journey: srv.journey || srv.adaptiveProgram }
            }
            if (!as_.sessionContent && (srv.sessionContent || srv.session_content)) {
              as_ = { ...as_, sessionContent: srv.sessionContent || srv.session_content }
            }
          }
        } catch {}
      }

      const bp = as_.blueprint, jy = as_.journey
      if (!bp || !jy) { setError("Falta blueprint/plan — intenta volver al plan y abrirlo de nuevo"); setLoading(false); return }
      const chapter = (jy.chapters || []).find((c: any) => c.chapterNumber === sessionNumber)
      setHasNextSession((jy.chapters || []).some((c: any) => c.chapterNumber === sessionNumber + 1))
      if (!chapter) { setError(`Sesión ${sessionNumber} no encontrada`); setLoading(false); return }
      let resolvedKind: SessionKind
      try {
        resolvedKind = resolveSessionKind(chapter).kind
      } catch {
        setError("Este plan antiguo no identifica con seguridad el tipo de sesión. Vuelve al plan para recuperar el snapshot explícitamente.")
        setLoading(false)
        return
      }
      setSessionKind(resolvedKind)
      console.info("[adaptive-session-kind]", JSON.stringify({
        event: "session_kind_resolved", sessionId: chapter.id, kind: resolvedKind,
        planId: jy.id || as_.id, materialId: as_.primaryMaterialId || as_.materialIds?.[0] || null,
      }))
      const cached = as_.sessionContent?.[String(sessionNumber)] as ClassContent | undefined
      const pStep = Number(as_.currentSessionNumber) === sessionNumber ? Math.max(0, Number(as_.currentStep || 0)) : 0
      const cachedHasNoBlocks = resolvedKind === 'learning' && (!cached?.evaluationBlocks || cached.evaluationBlocks.length === 0)

      if (cachedHasNoBlocks) {
        console.warn("[session] caché ignorado: sesión learning sin evaluationBlocks")
      }

      if (cached && !cachedHasNoBlocks) {
        const cachedBlocks = cached.evaluationBlocks || []
        // Validar caché — pero con tolerancia para sesiones learning con lazy blocks
        const cachedHasQuestions = cachedBlocks.some((b: any) => Array.isArray(b.questions) && b.questions.length > 0)
        const cachedHasLazyBlocks = cachedBlocks.some((b: any) => b.lazyGeneration === true && b.questions?.length === 0)
        const cachedValidation = validateSessionEvaluationForKind({
          sessionId: cached.sessionId || chapter.id,
          kind: resolvedKind,
          steps: cached.steps.map(step => ({
            id: step.id, type: step.type, title: step.title, content: step.content,
            keyPoints: step.keyPoints || (step.keyPoint ? [step.keyPoint] : []),
            importance: step.importance || "supporting", relatedBlockIds: step.relatedBlockIds,
          })),
          evaluationBlocks: cachedBlocks,
        }, as_.adaptiveSetup?.evalPreference || "mix_everything")

        // Para learning: solo rechazar si NO hay pasos válidos
        // Aceptar si hay preguntas reales O bloques lazy (se hidratan on-demand)
        const cachedIsAcceptable = !cachedValidation.valid
          ? resolvedKind === 'learning' && cached.steps?.length > 0 && (cachedHasQuestions || cachedHasLazyBlocks)
          : true

        if (!cachedValidation.valid && !cachedIsAcceptable) {
          console.error("[adaptive-session-kind]", JSON.stringify({
            event: shouldEvaluateSession(resolvedKind) ? "learning_session_missing_evaluation" : "evaluation_forbidden_for_session_kind",
            sessionId: chapter.id, kind: resolvedKind, planId: jy.id || as_.id,
            materialId: as_.primaryMaterialId || as_.materialIds?.[0] || null,
            errors: cachedValidation.errors,
          }))
          setError("El contenido guardado no cumple el contrato de este tipo de sesión y no será presentado.")
          setLoading(false)
          return
        }
        if (!cachedValidation.valid && cachedIsAcceptable) {
          console.warn("[adaptive-session-kind] caché con validación parcial aceptada:", cachedValidation.errors.slice(0, 2))
        }
        // Normalizar evaluationBlocks del cache también
      const cachedStepIds = new Set((cached.steps || []).map((s: any) => s.id));
      if (Array.isArray(cached.evaluationBlocks)) {
        cached.evaluationBlocks = cached.evaluationBlocks.filter(
          (b: any) => cachedStepIds.has(b.afterStepId)
        );
      } else {
        cached.evaluationBlocks = [];
      }
      // Auditoría adversarial (Codex Finding 4): un assessmentBlueprint
      // persistido de una versión anterior (objetivos sin demonstratedFactKeys)
      // debe normalizarse ANTES de cualquier lectura — restore, coverage o
      // registro de evidencia — o crashea con TypeError en cuanto algo lo lee
      // (unresolvedFactKeys/recordAssessmentEvidence acceden
      // .demonstratedFactKeys sin guard). Fail-closed: si no puede migrarse,
      // se descarta (null) y cae al fallback buildAssessmentBlueprint de abajo
      // — nunca inventa demonstration evidence, nunca conserva mastery falso.
      // Se normaliza una sola vez, aquí, mutando `cached` in-place (mismo
      // patrón que evaluationBlocks arriba) para que TODOS los sitios que
      // leen cached.assessmentBlueprint más abajo —incluido initCoverage,
      // que lo recibe como su 4º argumento— reciban la versión ya segura.
      if (cached.assessmentBlueprint) {
        cached.assessmentBlueprint = normalizeAssessmentBlueprint(cached.assessmentBlueprint)
      }

      setClassContent(cached); setSessionData(as_)
        // PARTE B — chat ALAI: historial session-scoped, restaurado del mismo
        // objeto persistido que assessmentBlueprint/evaluationProgress —
        // sobrevive a refresh por el mismo mecanismo (localStorage + sync
        // servidor), sin infraestructura nueva.
        setChatMessages(Array.isArray(cached.chatHistory) ? cached.chatHistory : [])
        // Finding 1: hidrata el registro de asistencia persistido — solo se
        // APLICARÁ más tarde (currentAssistanceLevel()) si su attemptKey
        // termina coincidiendo con el intento realmente reactivado; nunca se
        // asume aquí que la restauración de contenido implica que la MISMA
        // pregunta ya está activa (currentQuestion sigue null en este punto).
        restoredAssistanceRef.current = cached.pendingAssistance || null
        evaluationProgressRef.current = cached.evaluationProgress || {}
        setEvaluationProgress(evaluationProgressRef.current)
        activeStudyMsRef.current = Number(as_.activeStudyMs || 0)
        breakHoursAcknowledgedRef.current = Number(as_.breakHoursAcknowledged || 0)
        const restoredQueue = Array.isArray(as_.recoveryQueues?.[String(sessionNumber)])
          ? as_.recoveryQueues?.[String(sessionNumber)] as RecoveryItem[]
          : Array.isArray(cached.recoveryQueue) ? cached.recoveryQueue : []
        setRecoveryQueue(restoredQueue)
        setCurrentStepIndex(Math.min(pStep, Math.max(0, cached.steps.length - 1)))
        const restoredAssessment = shouldEvaluateSession(resolvedKind)
          ? cached.assessmentBlueprint || buildAssessmentBlueprint(
              cached.steps.map(step => ({
                ...step,
                importance: step.importance === "critical" ? 1 : step.importance === "important" ? 0.7 : 0.4,
              })),
              as_.id,
              Number(cached.assessmentPlanVersion || 1),
            )
          : null
        const assessmentRequired = shouldEvaluateSession(resolvedKind)
        setCompleted(
          as_.completedSessionNumbers?.includes(sessionNumber) &&
          as_.replaySessionNumber !== sessionNumber &&
          (!assessmentRequired || (restoredAssessment !== null && canCompleteSessionFromAssessment(
            restoredAssessment,
            restoredQueue.filter(item => item.status !== "resolved").map(item => item.recoveryId),
          ))),
        )
        initCoverage(cached.steps, as_, resolvedKind, cached)
        setLoading(false); return
      }

      // Calcular contexto de sesiones anteriores y futuras para anti-repetición
      const allChapters = jy.chapters || [];
      const prevChapter = allChapters.find((c: any) => c.chapterNumber === sessionNumber - 1) || null;
      const nextChapter = allChapters.find((c: any) => c.chapterNumber === sessionNumber + 1) || null;

      // Bloques ya enseñados en sesiones anteriores
      const prevBlockIdSet = new Set(
        allChapters
          .filter((c: any) => c.chapterNumber < sessionNumber)
          .flatMap((c: any) => c.blockIds || [])
      );
      const previouslyTaughtBlocks = (bp.blocks || [])
        .filter((b: any) => prevBlockIdSet.has(b.id))
        .map((b: any) => ({ id: b.id, label: b.label, summary: b.summary, kind: b.kind }));

      // Bloques de sesiones futuras
      const futureBlockIdSet = new Set(
        allChapters
          .filter((c: any) => c.chapterNumber > sessionNumber)
          .flatMap((c: any) => c.blockIds || [])
      );
      const upcomingBlocks = (bp.blocks || [])
        .filter((b: any) => futureBlockIdSet.has(b.id))
        .map((b: any) => ({ id: b.id, label: b.label, kind: b.kind }));

      // Contenido ya enseñado (para el prompt)
      const previouslyTaught = allChapters
        .filter((c: any) => c.chapterNumber < sessionNumber)
        .map((c: any) => ({
          sessionTitle: c.title || `Sesión ${c.chapterNumber}`,
          conceptsCovered: (c.blockIds || [])
            .map((bid: string) => (bp.blocks || []).find((b: any) => b.id === bid))
            .filter(Boolean)
            .map((b: any) => b.label)
            .slice(0, 10),
        }))
        .filter((s: any) => s.conceptsCovered.length > 0);

      // Auditoría adversarial (Codex, Intro/Review #2): final_review no
      // recibía NADA del recorrido real — ni contenido efectivamente
      // enseñado (solo labels de bloques del blueprint), ni factKeys
      // demostrados, ni errores/recuperaciones. Con blockIds:[] (capítulo
      // final), buildTeachingOnlyPrompt caía en TODOS los bloques del
      // blueprint como si fuera una sesión normal, generando un paso por
      // bloque — regeneración lineal, nunca síntesis. finalReviewContext
      // reúne, SOLO para este kind, el contenido REAL ya presentado
      // (steps.title/content/keyPoints, no labels de blueprint),
      // demonstratedFactKeys reales del assessmentBlueprint de cada sesión,
      // y un resumen compacto de qué factKeys necesitaron recovery — nunca
      // el material completo, para mantener el prompt acotado.
      const finalReviewContext = resolvedKind === "final_review" ? (() => {
        const priorSessionNumbers = allChapters
          .filter((c: any) => c.chapterNumber < sessionNumber && c.kind !== "final_review")
          .map((c: any) => c.chapterNumber)
        const sessions = priorSessionNumbers.map((num: number) => {
          const content = as_.sessionContent?.[String(num)] as ClassContent | undefined
          if (!content) return null
          const steps = (content.steps || []).map((step: any) => ({
            title: String(step.title || ""),
            content: String(step.content || "").slice(0, 400),
            keyPoints: Array.isArray(step.keyPoints) ? step.keyPoints.slice(0, 6) : [],
          }))
          const blueprint = content.assessmentBlueprint
          const demonstratedFactKeys = blueprint
            ? [...new Set((blueprint.objectives || []).flatMap((o: any) => o.demonstratedFactKeys || []))]
            : []
          const recoveryQueue = (as_.recoveryQueues as any)?.[String(num)] || []
          const recoverySummary = recoveryQueue.map((item: any) => ({
            factKeys: item.latestFactKeys || [],
            resolved: item.status === "resolved",
          }))
          return {
            sessionNumber: num,
            sessionTitle: content.sessionTitle || `Sesión ${num}`,
            steps,
            demonstratedFactKeys,
            recoverySummary,
          }
        }).filter(Boolean)
        return { sessions }
      })() : undefined

      const requestBody = {
        session: { ...chapter, kind: resolvedKind },
        blueprint: { version: bp.version, topics: bp.topics, blocks: bp.blocks },
        setup: as_.adaptiveSetup,
        materialTitle: as_.materialNames?.[0] || "Material",
        materialHash: as_.masteryMaterialKey || as_.primaryMaterialId || as_.materialIds?.join(","),
        planVersion: jy.id || jy.version || "current",
        totalSessions: jy.chapters?.length || 0,
        userId: as_.userId,
        // Contexto anti-repetición
        previouslyTaughtBlocks,
        upcomingBlocks,
        allBlocks: bp.blocks || [],
        allTopics: bp.topics || [],
        previousSessionTitle: prevChapter?.title || null,
        nextSessionTitle: nextChapter?.title || null,
        previouslyTaught,
        primaryBlockIds: chapter.blockIds || [],
        preparationState: (as_.sessionPreparation as any)?.[String(sessionNumber)] || undefined,
        // Señales reales (no inventadas) de sesiones ya generadas en este mismo
        // journey — desempate de variedad y nivel cognitivo ya demostrado por
        // factKey (P3.2). Nunca criterio principal de selección.
        generationHistory: computeGenerationHistorySignals(as_.sessionContent, { excludeSessionNumber: sessionNumber }),
        finalReviewContext,
      }
      if (!sessionPreparationPromiseRef.current) {
        const operation = fetch("/api/adaptive/session-teach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody) })
          .then(response => response.json())
        sessionPreparationPromiseRef.current = operation
        void operation.finally(() => {
          if (sessionPreparationPromiseRef.current === operation) sessionPreparationPromiseRef.current = null
        }).catch(() => undefined)
      }
      const d = await sessionPreparationPromiseRef.current
      if (!d.success || !d.classContent) {
        if (d.preparationState) updateSessionById(as_.id, (current: any) => ({ ...current, sessionPreparation: { ...(current.sessionPreparation || {}), [String(sessionNumber)]: d.preparationState } }))
        setError("No pudimos preparar esta sesión. Vuelve al plan e inténtalo de nuevo."); setLoading(false); return
      }

      // Normalizar evaluationBlocks — garantizar que sea array y que afterStepId coincida con step.id real
      const generatedStepIds = new Set((d.classContent.steps || []).map((s: any) => s.id));
      const normalizedEvalBlocks = Array.isArray(d.classContent.evaluationBlocks)
        ? d.classContent.evaluationBlocks.filter((b: any) => {
            const matches = generatedStepIds.has(b.afterStepId);
            if (!matches) {
              console.warn("[session] evaluationBlock con afterStepId sin match:", b.afterStepId, "| steps disponibles:", [...generatedStepIds].join(", "));
            }
            return matches;
          })
        : [];

      // Si hay bloques huérfanos, asignarlos al último paso enseñable
      const orphanBlocks = Array.isArray(d.classContent.evaluationBlocks)
        ? d.classContent.evaluationBlocks.filter((b: any) => !generatedStepIds.has(b.afterStepId))
        : [];
      if (orphanBlocks.length > 0) {
        const learningSteps = (d.classContent.steps || []).filter(
          (s: any) => !["intro", "closing"].includes(s.type)
        );
        const lastLearningStep = learningSteps[learningSteps.length - 1];
        if (lastLearningStep) {
          orphanBlocks.forEach((b: any) => {
            b.afterStepId = lastLearningStep.id;
            normalizedEvalBlocks.push(b);
            console.warn("[session] evaluationBlock huérfano reasignado a:", lastLearningStep.id);
          });
        }
      }

      d.classContent.evaluationBlocks = normalizedEvalBlocks;

      setClassContent(d.classContent); setSessionData(as_)
      setChatMessages(Array.isArray(d.classContent.chatHistory) ? d.classContent.chatHistory : [])
      restoredAssistanceRef.current = d.classContent.pendingAssistance || null
      evaluationProgressRef.current = d.classContent.evaluationProgress || {}
      setEvaluationProgress(evaluationProgressRef.current)
      activeStudyMsRef.current = Number(as_.activeStudyMs || 0)
      breakHoursAcknowledgedRef.current = Number(as_.breakHoursAcknowledged || 0)
      setRecoveryQueue(
        Array.isArray(as_.recoveryQueues?.[String(sessionNumber)])
          ? as_.recoveryQueues?.[String(sessionNumber)] as RecoveryItem[]
          : Array.isArray(d.classContent.recoveryQueue) ? d.classContent.recoveryQueue : []
      )
      setCurrentStepIndex(Math.max(0, Math.min(pStep, (d.classContent.steps || []).length - 1)))
      initCoverage(d.classContent.steps || [], as_, resolvedKind, d.classContent)
      updateSessionById(as_.id, (c: any) => ({ ...startAdaptiveSession(c, sessionNumber, Math.max(0, pStep)), sessionPreparation: { ...(c.sessionPreparation || {}), [String(sessionNumber)]: d.classContent.preparationState }, sessionContent: { ...(c.sessionContent || {}), [String(sessionNumber)]: d.classContent } }))
      setLoading(false)
    } catch { setError("No pudimos preparar esta sesión. Vuelve al plan e inténtalo de nuevo."); setLoading(false) }
  }

  function initCoverage(steps: ClassStep[], si: any, kind: SessionKind, cd?: any) {
    const skip = !shouldEvaluateSession(kind)
    setSkipEvaluation(skip)
    if (skip) {
      setAssessmentBlueprint(null)
      setCoverageMap({ sessionId: si?.id || "", sessionNumber, totalObjectives: 0, objectives: [], checkpoints: [] })
      return
    }
    // Auditoría adversarial (Codex Finding 4), defensa en profundidad: este
    // es el sitio que siembra assessmentBlueprintRef.current para el resto
    // del ciclo de vida de la sesión — normaliza aquí también, sin importar
    // si el caller ya normalizó, para que ningún camino futuro reintroduzca
    // el crash por asumir que cd.assessmentBlueprint ya viene seguro.
    const restoredAssessment = cd?.assessmentBlueprint
      ? normalizeAssessmentBlueprint(cd.assessmentBlueprint) ?? undefined
      : undefined
    const builtAssessment = restoredAssessment || buildAssessmentBlueprint(
      steps.map(step => ({
        ...step,
        importance: step.importance === "critical" ? 1 : step.importance === "important" ? 0.7 : 0.4,
      })),
      si?.id || "",
      Number(cd?.assessmentPlanVersion || 1),
    )
    setAssessmentBlueprint(builtAssessment)
    setCoverageMap(buildCoverageMap(steps, si?.id || "", sessionNumber, cd?.checkpoints))
  }

  function persistAssessmentBlueprint(next: AssessmentBlueprint) {
    assessmentBlueprintRef.current = next
    setAssessmentBlueprint(next)
    setClassContent(previous => previous ? { ...previous, assessmentBlueprint: next } : previous)
    if (!sessionData?.id) return
    updateSessionById(sessionData.id, current => {
      const currentContent = current.sessionContent?.[String(sessionNumber)] as ClassContent | undefined
      return {
        ...current,
        sessionContent: {
          ...(current.sessionContent || {}),
          [String(sessionNumber)]: {
            ...(currentContent || classContent),
            assessmentBlueprint: next,
          },
        },
      }
    })
  }

  // PARTE B — chat ALAI: mismo patrón exacto que persistAssessmentBlueprint
  // (state + classContent + sessionContent[sessionNumber] vía
  // updateSessionById) — reutiliza el mecanismo de persistencia existente
  // sin infraestructura nueva.
  function persistChatHistory(next: AlaiChatMessage[]) {
    setChatMessages(next)
    setClassContent(previous => previous ? { ...previous, chatHistory: next } : previous)
    if (!sessionData?.id) return
    updateSessionById(sessionData.id, current => {
      const currentContent = current.sessionContent?.[String(sessionNumber)] as ClassContent | undefined
      return {
        ...current,
        sessionContent: {
          ...(current.sessionContent || {}),
          [String(sessionNumber)]: {
            ...(currentContent || classContent),
            chatHistory: next,
          },
        },
      }
    })
  }

  // PARTE B — chat ALAI: envía el mensaje del estudiante, decide si cuenta
  // como asistencia académica (SOLO si hay una pregunta/verificación activa
  // Y el mensaje no es administrativo — heurística conservadora compartida,
  // ver chatAssistanceClassifier.ts), construye el contexto real de la
  // sesión (pasos YA enseñados, pregunta activa, recovery activo, perfil) y
  // persiste el historial resultante. Nunca marca asistencia por abrir el
  // panel — solo por un mensaje efectivamente enviado.
  async function handleSendChatMessage(text: string) {
    // Defensa en profundidad: con el gate de OBJETIVO A, el componente ya no
    // se monta mientras isIndependentEvaluationActive() es true, así que
    // esta rama en teoría es inalcanzable — pero se mantiene por si algún
    // mensaje quedó en vuelo justo en el instante de la transición.
    const isQuestionActive = isIndependentEvaluationActive()
    if (isQuestionActive && !isAdministrativeQuery(text)) {
      chatAssistedRef.current = true
      // Finding 1: persistir de inmediato — si el estudiante refresca ANTES
      // de responder, este intento debe seguir contando como asistido tras
      // la restauración (chatAssistedRef, un ref en memoria, no sobrevive un
      // remount por sí solo).
      const attemptKey = currentAttemptKey()
      if (attemptKey) persistPendingAssistance({ attemptKey, assistanceLevel: "assisted" })
    }
    const userMessage: AlaiChatMessage = { id: `chat-u-${Date.now()}`, role: "user", content: text, timestamp: Date.now() }
    const withUser = [...chatMessages, userMessage]
    persistChatHistory(withUser)
    setChatSending(true)
    try {
      const taughtSteps = (classContent?.steps || []).slice(0, currentStepIndex + 1).map(step => ({
        id: step.id, title: step.title, content: step.content, keyPoint: step.keyPoint || undefined,
      }))
      const activeRecoveryItem = activeRecoveryId
        ? recoveryQueueRef.current.find(item => item.recoveryId === activeRecoveryId) || null
        : null
      const sourceFailure = activeRecoveryItem ? latestRecoveryFailure(activeRecoveryItem) : null
      const response = await fetch("/api/adaptive/session-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: text,
          chatHistory: withUser.slice(-8).map(message => ({ role: message.role, content: message.content })),
          sessionTitle: classContent?.sessionTitle || "",
          materialTitle: sessionData?.materialNames?.[0] || "Material",
          studentProfile: sessionData?.adaptiveSetup ? {
            knowledgeLevel: sessionData.adaptiveSetup.knowledgeLevel || null,
            mainConcern: sessionData.adaptiveSetup.mainConcern || null,
          } : null,
          taughtSteps,
          activeQuestion: isQuestionActive && currentQuestion ? {
            questionText: currentQuestion.questionText,
            format: currentQuestion.format,
          } : null,
          activeRecovery: activeRecoveryItem ? {
            conceptLabel: activeRecoveryItem.conceptLabel,
            originalQuestionText: sourceFailure?.question?.questionText || "",
            studentAnswerDisplay: sourceFailure ? presentAnswer(sourceFailure.question, sourceFailure.answer) : "",
            correctAnswerDisplay: sourceFailure ? presentAnswer(sourceFailure.question, sourceFailure.question.correctAnswer) : "",
            errorType: activeRecoveryItem.latestErrorType || undefined,
            reteachContent: reteachingContent || undefined,
          } : null,
        }),
      })
      const data = await response.json().catch(() => null)
      const assistantMessage: AlaiChatMessage = {
        id: `chat-a-${Date.now()}`,
        role: "assistant",
        content: typeof data?.reply === "string" && data.reply.trim() ? data.reply.trim() : "No pude responder en este momento. Intenta de nuevo en unos segundos.",
        references: Array.isArray(data?.references) ? data.references : [],
        usedExternalKnowledge: Boolean(data?.usedExternalKnowledge),
        timestamp: Date.now(),
      }
      persistChatHistory([...withUser, assistantMessage])
    } catch (error) {
      console.error("[adaptive-chat] Error:", error)
      persistChatHistory([...withUser, {
        id: `chat-a-${Date.now()}`,
        role: "assistant",
        content: "No pude responder en este momento. Intenta de nuevo en unos segundos.",
        timestamp: Date.now(),
      }])
    } finally {
      setChatSending(false)
    }
  }

  // Navega al step referenciado SOLO si ya fue enseñado (índice <= paso
  // actual) y SOLO durante teaching — nunca interrumpe una evaluación o
  // verificación de recovery activa, y nunca permite saltar a contenido
  // todavía bloqueado (defensa en profundidad: el componente ya filtra por
  // taughtStepIds, esto vuelve a comprobarlo del lado de la fuente real).
  function handleChatReferenceClick(stepId: string) {
    if (sessionPhase !== "teaching") return
    const targetIndex = (classContent?.steps || []).findIndex(step => step.id === stepId)
    if (targetIndex === -1 || targetIndex > currentStepIndex) return
    setCurrentStepIndex(targetIndex)
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function persistRecoveryQueue(next: RecoveryItem[]) {
    recoveryQueueRef.current = next
    setRecoveryQueue(next)
    setClassContent(previous => previous ? { ...previous, recoveryQueue: next } : previous)
    if (!sessionData?.id || !classContent) return
    const persistedContent = { ...classContent, recoveryQueue: next }
    const updated = updateSessionById(sessionData.id, current => {
      return {
        ...current,
        recoveryQueues: {
          ...(current.recoveryQueues || {}),
          [String(sessionNumber)]: next,
        },
        sessionContent: {
          ...(current.sessionContent || {}),
          [String(sessionNumber)]: persistedContent,
        },
        unresolvedMicroIds: [
          ...new Set(current.unresolvedMicroIds || []),
        ],
      }
    })
    if (updated) setSessionData(updated)
  }

  async function proceedToNextStep() {
    if (!classContent) return

    const debugState = sessionTransitionState()
    const debugAction = deriveNextSessionAction(debugState)
    console.info("[adaptive-debug]", JSON.stringify({
      event: "teaching_continue_clicked",
      sessionId: sessionData?.id,
      stepIndex: currentStepIndex,
      totalSteps: classContent.steps.length,
      stepId: classContent.steps[currentStepIndex]?.id,
      action: debugAction,
      state: debugState,
      activeEvaluationBlockId,
      activeRecoveryId,
      phase: sessionPhase,
      assessment: assessmentBlueprintRef.current ? {
        coverageRatio: assessmentBlueprintRef.current.coverageRatio,
        taughtObjectiveIds: assessmentBlueprintRef.current.taughtObjectiveIds,
        assessedObjectiveIds: assessmentBlueprintRef.current.assessedObjectiveIds,
        demonstratedObjectiveIds: assessmentBlueprintRef.current.demonstratedObjectiveIds,
        unresolvedObjectiveIds: assessmentBlueprintRef.current.unresolvedObjectiveIds,
      } : null,
      blocks: (classContent.evaluationBlocks || []).map(block => ({
        id: block.id,
        afterStepId: block.afterStepId,
        questionCount: block.questions.length,
        progress: evaluationProgressRef.current[block.id] || null,
      })),
    }))
    
    // Si la sesión es de aprendizaje, verificar si el paso actual tiene una evaluación programada
    if (shouldEvaluateSession(sessionKind)) {
      const currentStep = classContent.steps[currentStepIndex]
      const stepId = currentStep?.id
      
      // Buscar si hay un bloque de evaluación que deba ir DESPUÉS de este paso
      const block = classContent.evaluationBlocks?.find(b => b.afterStepId === stepId)
      
      if (block) {
        const progress = evaluationProgressRef.current[block.id]
        // Solo interrumpir si el bloque no está completado
        if (progress?.status !== "completed") {
          console.log("🛑 Interrumpiendo para evaluación tras paso:", stepId)
          startEvaluationBlock(block)
          return
        }
      }
    }
    
    await executeDerivedSessionAction()
  }

  function advanceToNextTeachingStep(recoverySnapshot: RecoveryItem[] = recoveryQueueRef.current) {
    if (!classContent) return
    const blockingRecovery = nextRecoveryItem(recoverySnapshot)
    if (blockingRecovery) {
      console.info("[adaptive-recovery]", JSON.stringify({
        event: "blocked_step_advance",
        sessionId: sessionData?.id,
        recoveryId: blockingRecovery.recoveryId,
        roundId: `${blockingRecovery.recoveryId}:round:${blockingRecovery.verificationRound}`,
        recoveryStatus: blockingRecovery.status,
        currentStep: currentStepIndex,
      }))
      setActiveRecoveryId(blockingRecovery.recoveryId)
      recoveryRestoreStartedRef.current = false
      setSessionPhase("teaching")
      return
    }
    if (currentStepIndex < classContent.steps.length - 1) {
      const n = clampTeachingStepIndex(currentStepIndex + 1, classContent.steps.length); setCurrentStepIndex(n)
      if (sessionData?.id) updateSessionById(sessionData.id, (c: any) => startAdaptiveSession(c, sessionNumber, n))
      window.scrollTo({ top: 0, behavior: "smooth" })
    }
  }

  function persistEvaluationProgress(next: Record<string, EvaluationBlockProgress>) {
    evaluationProgressRef.current = next
    setEvaluationProgress(next)
    setClassContent(previous => previous ? { ...previous, evaluationProgress: next } : previous)
    if (!sessionData?.id) return
    updateSessionById(sessionData.id, current => {
      const persisted = current.sessionContent?.[String(sessionNumber)] as ClassContent | undefined
      return {
        ...current,
        sessionContent: {
          ...(current.sessionContent || {}),
          [String(sessionNumber)]: {
            ...(persisted || classContent),
            evaluationProgress: next,
          },
        },
      }
    })
  }


  async function hydrateEvaluationBlockQuestions(block: EvaluationBlock): Promise<EvaluationBlock | null> {
    // Usar ref para evitar stale closure — la ref siempre tiene el valor más reciente
    const currentClassContent = classContentRef.current || classContent
    if (!currentClassContent) {
      console.warn('[hydrate] classContent es null al llamar hydrateEvaluationBlockQuestions')
      return null
    }

    const coveredSteps = currentClassContent.steps.filter(step => block.coveredStepIds.includes(step.id))
    console.log('[hydrate] block.coveredStepIds:', block.coveredStepIds)
    console.log('[hydrate] currentClassContent steps:', currentClassContent.steps.map(s => s.id))
    console.log('[hydrate] coveredSteps encontrados:', coveredSteps.length)

    if (coveredSteps.length === 0) {
      setEvalError("No encontramos los pasos que debían evaluarse.")
      console.warn('[hydrate] coveredSteps.length === 0 — IDs no coinciden')
      return null
    }

    setEvalLoading(true)
    setSessionPhase("evaluating")
    setCurrentQuestion(null)
    setEvalError(null)

    try {
      const requiredQuestionCount = Math.max(
        2,
        Math.min(4, Math.ceil((block.coveredKeyPoints?.length || 1) / 2))
      )

      // Auditoría adversarial (Codex Finding 3): la hidratación lazy no
      // enviaba assessmentQuestionPlan/assessmentBlueprint — normalizeBatch
      // en session-eval/route.ts entonces filtraba targetObjectiveIds/
      // factKeys contra un `planned` indefinido, colapsándolos a [] SIEMPRE,
      // aunque el modelo declarara targets legítimos. La pregunta pasaba la
      // validación (options bien formadas) pero recordNormalAnswerOutcome
      // nunca podía registrar evidencia — el objective quedaba unresolved
      // para siempre sin que la UI mostrara ningún error.
      //
      // Fix: derivar el plan AUTORITATIVO desde el assessmentBlueprint real
      // ya presente en el cliente (planAssessmentQuestions, función pura ya
      // existente y usada en el resto del pipeline, nunca antes conectada a
      // este caller) — no se confía en targetObjectiveIds/factKeys que el
      // modelo o el cliente pudieran inventar; solo se aceptan los que el
      // plan derivado del blueprint real autoriza para estos steps.
      const relevantObjectives = (assessmentBlueprintRef.current?.objectives || [])
        .filter(objective => block.coveredStepIds.includes(objective.stepId))
      const assessmentQuestionPlan = relevantObjectives.length
        ? planAssessmentQuestions({
            objectives: relevantObjectives,
            evaluationPreference: sessionData?.adaptiveSetup?.evalPreference || "mix_everything",
          })
        : undefined

      const response = await fetch("/api/adaptive/session-eval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taughtSteps: coveredSteps.map(step => ({
            id: step.id,
            type: step.type,
            title: step.title,
            content: step.content,
            keyPoint: step.keyPoint,
          })),
          mode: sessionData?.adaptiveSetup?.evalPreference || "mix_everything",
          sessionTitle: classContent.sessionTitle,
          materialTitle: sessionData?.materialNames?.[0] || "Material",
          previousQuestions: previousQuestions.map(question => ({
            id: question.id,
            factKey: question.factKey,
            questionText: question.questionText,
            format: question.format,
          })),
          requiredQuestionCount,
          assessmentBlueprint: assessmentBlueprintRef.current || undefined,
          assessmentQuestionPlan,
        }),
      })

      const data = await response.json()
      if (!response.ok || !data.success || !Array.isArray(data.questions) || data.questions.length === 0) {
        setEvalError("No pudimos preparar las preguntas de esta parte. Reintenta.")
        setEvalLoading(false)
        return null
      }

      const hydratedQuestions = data.questions.map((question: any) => ({
        ...question,
        coveredStepIds: Array.isArray(question.coveredStepIds) && question.coveredStepIds.length
          ? question.coveredStepIds
          : block.coveredStepIds,
        coveredKeyPoints: Array.isArray(question.coveredKeyPoints) && question.coveredKeyPoints.length
          ? question.coveredKeyPoints
          : (block.coveredKeyPoints?.length ? block.coveredKeyPoints.slice(0, 2) : ["Comprensión del contenido enseñado"]),
      }))

      const hydratedBlock = {
        ...block,
        questions: hydratedQuestions,
        lazyGeneration: false,
      } as EvaluationBlock

      const nextBlocks = (currentClassContent.evaluationBlocks || []).map(candidate =>
        candidate.id === block.id ? hydratedBlock : candidate
      )

      const nextContent = {
        ...currentClassContent,
        evaluationBlocks: nextBlocks,
      }

      setClassContent(nextContent)
      if (sessionData?.id) {
        updateSessionById(sessionData.id, current => ({
          ...current,
          sessionContent: {
            ...(current.sessionContent || {}),
            [String(sessionNumber)]: nextContent,
          },
        }))
      }

      setPreviousQuestions(previous => [...previous, ...hydratedQuestions])
      setEvalLoading(false)
      return hydratedBlock
    } catch (error) {
      console.error("[session] error hidratando evaluation block:", error)
      setEvalError("No pudimos preparar las preguntas de esta parte. Reintenta.")
      setEvalLoading(false)
      return null
    }
  }


  function startEvaluationBlock(block: EvaluationBlock) {
    const currentProgress = evaluationProgressRef.current
    const progress = currentProgress[block.id] || createEvaluationBlockProgress(block)
    if (progress.status === "completed") {
      void executeDerivedSessionAction({ progress:currentProgress })
      return
    }

    if (!Array.isArray(block.questions) || block.questions.length === 0) {
      void (async () => {
        console.log('[eval] bloque lazy detectado:', block.id, '| coveredStepIds:', block.coveredStepIds, '| classContent steps:', classContent?.steps?.map(s => s.id))
        const hydrated = await hydrateEvaluationBlockQuestions(block)
        if (hydrated) {
          startEvaluationBlock(hydrated)
        } else {
          console.warn('[eval] hydrateEvaluationBlockQuestions devolvió null — avanzando sin evaluación')
          setEvalLoading(false)
          setSessionPhase("teaching")
          void executeDerivedSessionAction()
        }
      })()
      return
    }

    const question = block.questions[progress.currentQuestionIndex]
    if (!question) {
      const closed = closeNormalEvaluationBlock(block, progress)
      const released = releaseNormalBlockRecoveries(recoveryQueueRef.current)
      const first = nextRecoveryItem(released)

      const repairedClosed = closed.pendingRecoveryIds.length > 0 && !first
        ? {
            ...closed,
            pendingRecoveryIds: [],
            readyRecoveryIds: [],
            status: "completed" as const,
          }
        : closed

      persistEvaluationProgress({ ...currentProgress, [block.id]: repairedClosed })

      if (closed.pendingRecoveryIds.length) {
        persistRecoveryQueue(released)
        if (first) {
          void startRecoveryReteach(released, first.recoveryId)
        } else {
          console.info("[adaptive-recovery]", JSON.stringify({
            event: "stale_block_recovery_repaired",
            sessionId: sessionData?.id,
            blockId: block.id,
            stalePendingRecoveryIds: closed.pendingRecoveryIds,
          }))
          void executeDerivedSessionAction({
            progress: { ...currentProgress, [block.id]: repairedClosed },
            queue: released,
            activeRecovery: false,
          })
        }
      } else {
        void executeDerivedSessionAction({
          progress: { ...currentProgress, [block.id]: repairedClosed },
          queue: released,
          activeRecovery: false,
        })
      }
      return
    }
    setActiveEvaluationBlockId(block.id)
    setSessionPhase("evaluating"); setEvalLoading(false)
    setEvalError(null); setCurrentQuestion(null); setUserAnswer(null); setEvalResult(null); setReteachingContent(null)
    const delivered = activateQuestion(question)
    if (delivered) {
      const nextProgress = currentProgress[block.id] ? currentProgress : {
        ...currentProgress,
        [block.id]: progress,
      }
      if (nextProgress !== currentProgress) persistEvaluationProgress(nextProgress)
      setPendingQuestions(block.questions.slice(progress.currentQuestionIndex + 1))
      setPreviousQuestions(previous => previous.some(item => item.id === question.id)
        ? previous
        : [...previous, ...block.questions])
      console.info("[adaptive-evaluation]", JSON.stringify({
        event: "normal_block_question_presented",
        sessionId: sessionData?.id,
        blockId: block.id,
        questionId: question.id,
        questionIndex: progress.currentQuestionIndex,
        normal_block_question_count: block.questions.length,
        providerRequests: 0,
      }))
    }
  }

  function logModeBlocked(question: CanonicalQuestion, recoveryStatus: string) {
    console.info("[adaptive-evaluation]", JSON.stringify({
      event: "evaluation_mode_frontend_blocked",
      reason: EVALUATION_MODE_VIOLATION,
      mode: normalizeEvaluationMode(sessionData?.adaptiveSetup?.evalPreference),
      rejectedQuestionType: question.format,
      sessionId: sessionData?.id,
      microId: question.conceptId,
      recoveryStatus,
    }))
  }

  function shuffleOptions(q: CanonicalQuestion): CanonicalQuestion {
    if (q.format !== "multiple_choice" && q.format !== "scenario" &&
        q.format !== "find_the_error" && q.format !== "multi_select") return q
    if (q.options.length === 0) return q
    // Mezclar opciones con Fisher-Yates
    const shuffled = [...q.options]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return { ...q, options: shuffled }
  }

  function activateQuestion(q: CanonicalQuestion): boolean {
    if (!validateQuestionTypeForMode(sessionData?.adaptiveSetup?.evalPreference, q.format).valid) {
      logModeBlocked(q, activeRecoveryId ? "verification_active" : "normal")
      setCurrentQuestion(null)
      setEvalError("La actividad recibida no respeta tu modo de evaluación. Solicita otra pregunta.")
      return false
    }
    setEvalError(null)
    const shuffledQ = shuffleOptions(q)
    setCurrentQuestion(shuffledQ); setUserAnswer(null); setEvalResult(null)
    if (q.format === "word_bank" && Array.isArray(q.correctAnswer)) setWordBankAnswers(new Array(q.correctAnswer.length).fill(""))
    if (q.format === "ordering" && Array.isArray(q.options)) {
      const shuffled = [...(q.options as any[])].sort(() => Math.random() - 0.5)
      setOrderingAnswers(shuffled.map((o: any) => o.id))
    }
    if (q.format === "matching") setMatchingAnswers({})
    return true
  }

  function getCompositeAnswer(): any {
    if (!currentQuestion) return userAnswer
    if (currentQuestion.format === "word_bank") return wordBankAnswers
    if (currentQuestion.format === "ordering") return orderingAnswers
    if (currentQuestion.format === "matching") return matchingAnswers
    return userAnswer
  }

  function isAnswerReady(): boolean {
    if (!currentQuestion) return false

    if (currentQuestion.format === "word_bank") {
      return wordBankAnswers.length > 0 && wordBankAnswers.every(w => w !== "")
    }

    if (currentQuestion.format === "ordering") {
      return Array.isArray(currentQuestion.options) && orderingAnswers.length === currentQuestion.options.length
    }

    if (currentQuestion.format === "matching") {
      return Array.isArray(currentQuestion.options) && Object.keys(matchingAnswers).length === currentQuestion.options.length
    }
    if (currentQuestion.format === "multi_select") {
      return Array.isArray(userAnswer) && userAnswer.length > 0
    }
    if (currentQuestion.format === "classify") {
      return typeof userAnswer === "object" && userAnswer !== null &&
        Object.keys(userAnswer).length === currentQuestion.options.items.length
    }

    return userAnswer !== null && userAnswer !== undefined && userAnswer !== ""
  }

  function retryCompatibleEvaluation() {
    setEvalError(null)
    if (activeRecoveryId) {
      const item = recoveryQueue.find(candidate => candidate.recoveryId === activeRecoveryId)
      if (item) {
        void generateRecoveryQuestions(item)
        return
      }
    }
    setSessionPhase("teaching")
  }

  async function submitAnswer() {
    if (!currentQuestion || !isAnswerReady()) return
    setEvalLoading(true)
    const answer = getCompositeAnswer()
    try {
      const target = currentQuestion as CanonicalQuestion & { coveredStepIds?: string[] }
      const sourceStepIds = target.coveredStepIds?.length ? target.coveredStepIds : [currentQuestion.teachingBlockId]
      const teachingContent = (classContent?.steps || [])
        .filter(step => sourceStepIds.includes(step.id))
        .map(step => step.content)
        .join("\n\n")
      const r = await fetch("/api/adaptive/session-check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: currentQuestion, answer, teachingContent, mode: sessionData?.adaptiveSetup?.evalPreference || "mix_everything", materialTitle: sessionData?.materialNames?.[0] || "Material" }) })
      const d = await r.json()
      if (d.success) {
        if (activeRecoveryId) {
          pendingRecoveryOutcomeRef.current = null
          const outcome = recordRecoveryVerificationOutcome(currentQuestion, d.result)
          if (outcome) pendingRecoveryOutcomeRef.current = { questionId: currentQuestion.id, ...outcome }
        } else if (d.result?.outcome !== "invalid") {
          pendingNormalAnswerOutcomeRef.current = {
            questionId: currentQuestion.id,
            ...recordNormalAnswerOutcome(currentQuestion, d.result),
          }
        }
        setEvalResult(d.result); setSessionPhase("feedback")
      }
    } catch (e) { console.error(e) }
    setEvalLoading(false)
  }

  // Identidad del intento actualmente activo — questionId, y adicionalmente
  // recoveryId+ronda cuando es una verificación de recovery (dos rondas
  // distintas de la MISMA recovery nunca deben compartir asistencia
  // restaurada, aunque la pregunta reutilizara un id). null si no hay
  // pregunta activa (nada que registrar/restaurar).
  function currentAttemptKey(): string | null {
    if (!currentQuestion) return null
    if (activeRecoveryId) {
      const item = recoveryQueueRef.current.find(candidate => candidate.recoveryId === activeRecoveryId)
      if (item) return `recovery:${activeRecoveryId}:${item.verificationRound}:${currentQuestion.id}`
    }
    return `normal:${currentQuestion.id}`
  }

  // OBJETIVO A (auditoría adversarial post-319a5bc): "Preguntar a ALAI" NO
  // debe EXISTIR en el DOM (nunca solo oculto/deshabilitado visualmente)
  // durante ninguna actividad cuyo estado pedagógico sea evaluación o
  // reevaluación independiente. Fuente ÚNICA de verdad: la MISMA condición
  // que YA decide si un mensaje de chat cuenta como asistencia
  // (handleSendChatMessage, Finding 1) — sessionPhase 'evaluating' con una
  // pregunta activa. Cubre por igual assessment normal y verificación de
  // recovery (reevaluación independiente): ambas presentan su pregunta con
  // sessionPhase 'evaluating', y ambas exigen currentAssistanceLevel() ===
  // 'independent' para producir evidencia (recordNormalAnswerOutcome /
  // recordRecoveryVerificationOutcome) — no hay ninguna distinción entre
  // "evaluación" y "reevaluación independiente" a nivel de este gate,
  // porque el motor tampoco la hace: currentAttemptKey()/
  // currentAssistanceLevel() ya tratan ambos casos de forma unificada.
  // Nunca se basa en texto/título de la actividad, solo en este estado real
  // del motor. Fuera de esa ventana exacta el chat sigue disponible:
  // enseñanza (teaching), explicación de recovery (reteaching — "recovery
  // con asistencia": el estudiante aún no está respondiendo nada, pedir
  // ayuda ahí no puede contaminar ninguna evidencia), espera de generación
  // de verificación sin pregunta aún presentada (verification_generation),
  // y revisión de feedback tras responder (feedback: la evidencia de ESA
  // pregunta ya quedó capturada de forma síncrona ANTES de esta fase, ver
  // recordNormalAnswerOutcome/recordRecoveryVerificationOutcome llamados
  // justo antes de setSessionPhase("feedback") — pedir ayuda revisando el
  // resultado no puede alterar retroactivamente evidencia ya registrada).
  function isIndependentEvaluationActive(): boolean {
    return sessionPhase === "evaluating" && Boolean(currentQuestion)
  }

  // Finding 1 — persiste/limpia el registro de asistencia del intento activo
  // con el MISMO mecanismo (state + classContent + sessionContent vía
  // updateSessionById) que persistChatHistory/persistAssessmentBlueprint ya
  // usan — sobrevive a refresh sin infraestructura nueva. `null` limpia el
  // campo (el intento se consumió o no hay nada que registrar).
  function persistPendingAssistance(record: { attemptKey: string; assistanceLevel: "minimal_hint" | "assisted" } | null) {
    restoredAssistanceRef.current = record
    setClassContent(previous => previous ? { ...previous, pendingAssistance: record } : previous)
    if (!sessionData?.id) return
    updateSessionById(sessionData.id, current => {
      const currentContent = current.sessionContent?.[String(sessionNumber)] as ClassContent | undefined
      return {
        ...current,
        sessionContent: {
          ...(current.sessionContent || {}),
          [String(sessionNumber)]: {
            ...(currentContent || classContent),
            pendingAssistance: record,
          },
        },
      }
    })
  }

  // Fuente ÚNICA de AssistanceLevel para el intento actual — combina
  // hintShownRef (pista pedida) y chatAssistedRef (ayuda académica pedida al
  // chat mientras esta pregunta/verificación estaba activa), Y (Finding 1)
  // un registro de asistencia PERSISTIDO que sobrevivió a un refresh/remount
  // — pero SOLO si su attemptKey coincide exactamente con el intento
  // actualmente activo; un registro de una pregunta distinta se ignora
  // siempre (nunca contamina la siguiente pregunta). El chat/la asistencia
  // restaurada cuentan como asistencia MÁS fuerte que el hint (pueden llegar
  // a explicar más que una pista), así que tienen prioridad si varias
  // señales están activas — pero cualquiera basta para que el intento deje
  // de ser 'independent'. Nunca se hardcodea independent:true en ningún call
  // site; todos leen de aquí.
  function currentAssistanceLevel(): "independent" | "minimal_hint" | "assisted" {
    if (chatAssistedRef.current) return "assisted"
    if (hintShownRef.current) return "minimal_hint"
    const attemptKey = currentAttemptKey()
    if (attemptKey && restoredAssistanceRef.current?.attemptKey === attemptKey) {
      return restoredAssistanceRef.current.assistanceLevel
    }
    return "independent"
  }

  // Registra el resultado de una pregunta normal TAN PRONTO como se conoce (desde
  // submitAnswer, antes de mostrar el panel de feedback) — incluyendo el cierre del
  // bloque si esta era la última pregunta. Así el botón de feedback puede leer el
  // estado YA real (misma máquina canónica) en vez de predecir con el estado previo
  // a esta respuesta, que nunca podía mostrar "🎉 Terminar" en la última pregunta.
  function recordNormalAnswerOutcome(
    question: CanonicalQuestion,
    freshResult: any,
  ): { block: EvaluationBlock | null; nextProgress: EvaluationBlockProgress | null; queueAfterAnswer: RecoveryItem[] } {
    let queueAfterAnswer = recoveryQueueRef.current
    let createdRecoveryId: string | undefined
    // Fijar el nivel UNA vez, antes de limpiar el registro persistido — el
    // intento se está consumiendo AHORA (Finding 1: "debe eliminarse cuando
    // el intento se consume").
    const assistanceLevelForThisAttempt = currentAssistanceLevel()
    const attemptKeyForThisAttempt = currentAttemptKey()
    if (attemptKeyForThisAttempt && restoredAssistanceRef.current?.attemptKey === attemptKeyForThisAttempt) {
      persistPendingAssistance(null)
    }

    if (assessmentBlueprintRef.current && question.targetObjectiveIds?.length) {
      const questionFactKeys = realFactKeysOf(question)
      persistAssessmentBlueprint(recordAssessmentEvidence(
        assessmentBlueprintRef.current,
        question.targetObjectiveIds,
        questionFactKeys,
        {
          valid: true,
          correct: freshResult?.correct === true,
          // Codex Finding 1 + PARTE B (chat): una respuesta correcta obtenida
          // viendo la pista O pidiendo ayuda académica al chat NO es
          // evidencia independiente — currentAssistanceLevel() refleja si
          // cualquiera de las dos vías de asistencia se usó para ESTA
          // pregunta antes de responder (incluida asistencia restaurada tras
          // un refresh mid-pregunta).
          independent: assistanceLevelForThisAttempt === "independent",
          evidenceId: `normal:${question.id}:${Date.now()}`,
        },
      ))
    }

    // Persist the debt immediately, but keep it ineligible while this normal
    // assessment block still has questions.
    if (!freshResult?.correct) {
      const failure = {
        question,
        answer: getCompositeAnswer(),
        result: freshResult
      }
      persistFailedQuestions(prev => [...prev, failure])
      queueAfterAnswer = deferNormalBlockFailures(recoveryQueueRef.current, [failure])
      persistRecoveryQueue(queueAfterAnswer)
      const inlineRecovery = queueAfterAnswer.find(item =>
        item.sourceQuestionIds.includes(question.id) && item.status !== "resolved"
      )
      createdRecoveryId = inlineRecovery?.recoveryId
      if (inlineRecovery) initRecoveryMetrics(inlineRecovery.recoveryId)
      console.info("[adaptive-recovery]", JSON.stringify({
        event: "inline_recovery_created",
        sessionId: sessionData?.id,
        recoveryId: inlineRecovery?.recoveryId,
        microId: question.conceptId,
        questionId: question.id,
        currentStep: currentStepIndex,
      }))
      // PUNTO 9 SPEC: arrancar prefetch INMEDIATAMENTE al primer fallo
      // No esperar a que terminen las demás preguntas del bloque
      if (inlineRecovery) {
        console.log("[prefetch] arrancando en segundo plano para recovery:", inlineRecovery.recoveryId)
        void prefetchRecoveryRound(inlineRecovery)
      }
    }

    const block = classContent?.evaluationBlocks?.find(candidate => candidate.id === activeEvaluationBlockId) || null
    const currentProgress = evaluationProgressRef.current
    const priorProgress = block
      ? currentProgress[block.id] || createEvaluationBlockProgress(block)
      : null
    let nextProgress = priorProgress
      ? recordNormalBlockAnswer(
          priorProgress,
          question as SessionEvaluationQuestion,
          getCompositeAnswer(),
          freshResult?.correct === true,
          createdRecoveryId,
        )
      : null
    if (block && nextProgress) {
      const hasNext = Boolean(block.questions[nextProgress.currentQuestionIndex])
      if (!hasNext) nextProgress = closeNormalEvaluationBlock(block, nextProgress)
      persistEvaluationProgress({ ...currentProgress, [block.id]: nextProgress })
    }

    return { block, nextProgress, queueAfterAnswer }
  }

  // Actúa sobre un resultado YA registrado — dispara con el click del usuario en
  // el panel de feedback, nunca vuelve a registrar la respuesta.
  async function routeNormalAnswerOutcome(outcome: {
    block: EvaluationBlock | null
    nextProgress: EvaluationBlockProgress | null
    queueAfterAnswer: RecoveryItem[]
  }) {
    const { block, nextProgress, queueAfterAnswer } = outcome
    if (block && nextProgress) {
      const next = block.questions[nextProgress.currentQuestionIndex]
      if (next) {
        setPendingQuestions(block.questions.slice(nextProgress.currentQuestionIndex + 1))
        activateQuestion(next)
        setSessionPhase("evaluating")
        return
      }
    }

    // El bloque cerró. Liberar recuperaciones y procesarlas.
    const releasedQueue = releaseNormalBlockRecoveries(queueAfterAnswer)

    // Prefetch en paralelo para todas las recuperaciones pendientes
    // (según spec punto 9: preparar en segundo plano mientras el usuario termina)
    const pendingRecoveries = releasedQueue.filter(item => item.status === "pending_reteach")
    for (const recoveryItem of pendingRecoveries) {
      void prefetchRecoveryRound(recoveryItem)
    }

    if (releasedQueue.some(item => item.status !== "resolved")) {
      persistRecoveryQueue(releasedQueue)
      const first = nextRecoveryItem(releasedQueue)
      if (first) await startRecoveryReteach(releasedQueue, first.recoveryId)
      return
    }

    // Todo correcto — continuar enseñanza
    persistFailedQuestions([])
    setActiveEvaluationBlockId(null)
    setCurrentQuestion(null); setUserAnswer(null); setEvalResult(null)
    setReteachingContent(null); setSessionPhase("teaching"); await executeDerivedSessionAction({ progress:evaluationProgressRef.current, queue:releasedQueue })
  }

  async function handleFeedbackNext() {
    if (!currentQuestion) return
    if (activeRecoveryId) {
      await handleRecoveryFeedback(currentQuestion)
      return
    }
    if (evalResult?.outcome === "invalid") {
      if (pendingQuestions.length > 0) {
        const [next, ...rest] = pendingQuestions
        setPendingQuestions(rest)
        activateQuestion(next)
        setSessionPhase("evaluating")
      } else {
        setCurrentQuestion(null)
        setEvalResult(null)
        setSessionPhase("teaching")
        await executeDerivedSessionAction()
      }
      return
    }

    const cached = pendingNormalAnswerOutcomeRef.current
    pendingNormalAnswerOutcomeRef.current = null
    const outcome = cached && cached.questionId === currentQuestion.id
      ? cached
      // Red de seguridad defensiva: si por algún motivo no se registró antes
      // (no debería ocurrir en el flujo normal), registrar ahora.
      : { questionId: currentQuestion.id, ...recordNormalAnswerOutcome(currentQuestion, evalResult) }
    await routeNormalAnswerOutcome(outcome)
  }

  function recoveryRoundGenerationKey(item: RecoveryItem): string {
    return [
      adaptiveSessionId,
      sessionNumber,
      item.recoveryTargetId,
      item.verificationRound + 1,
      item.verificationGenerationVersion,
    ].join(":")
  }

  function persistPreparedRecoveryRound(item: RecoveryItem, data: any, strategy: string): RecoveryItem {
    let prepared = beginRecoveryReteach(item, strategy)
    prepared = recordRecoveryReteachContent(prepared, typeof data.explanation === "string" ? data.explanation : "")
    // Auditoría adversarial (Codex, Reteach 3.1): un duplicado NUNCA debe
    // encadenar a verificación. beginRecoveryVerification y
    // persistRecoveryVerificationQuestions son "auto-reparadores" por diseño
    // (útiles ante inconsistencias reales), así que encadenarlos aquí
    // habría deshecho el bloqueo de recordRecoveryReteachContent — hay que
    // cortar explícitamente en este caller antes de llamarlos. El item ya
    // vuelve con status 'pending_reteach' y preparedReteachContent limpio;
    // se persiste tal cual para que el siguiente intento parta de un estado
    // realmente reintentable, nunca mostrando contenido de una ronda previa.
    if (prepared.reason === "duplicate_reteach_requires_alternate_content") {
      const latestQueue = recoveryQueueRef.current
      const nextQueue = latestQueue.map(candidate =>
        candidate.recoveryId === prepared.recoveryId ? prepared : candidate
      )
      persistRecoveryQueue(nextQueue)
      console.warn("[adaptive-recovery]", JSON.stringify({
        event: "recovery_reteach_content_duplicate_rejected",
        recoveryId: prepared.recoveryId,
        reteachAttempt: prepared.reteachAttempt,
      }))
      return prepared
    }
    prepared = beginRecoveryVerification(prepared)
    prepared = persistRecoveryVerificationQuestions(prepared, data.questions)
    const latestQueue = recoveryQueueRef.current
    const nextQueue = latestQueue.map(candidate =>
      candidate.recoveryId === prepared.recoveryId ? prepared : candidate
    )
    persistRecoveryQueue(nextQueue)
    if (activeEvaluationBlockId) {
      const currentProgress = evaluationProgressRef.current
      const progress = currentProgress[activeEvaluationBlockId]
      if (progress) persistEvaluationProgress({
        ...currentProgress,
        [activeEvaluationBlockId]: markRecoveryReady(progress, prepared.recoveryId),
      })
    }
    return prepared
  }

  function prefetchRecoveryRound(item: RecoveryItem): Promise<any> {
    const generationKey = recoveryRoundGenerationKey(item)
    const existing = recoveryPrefetchRef.current.get(generationKey)
    if (existing) {
      console.info("[adaptive-recovery]", JSON.stringify({
        event: "recovery_prefetch_joined",
        recoveryId: item.recoveryId,
        generationKey,
      }))
      return existing
    }
    const sourceFailure = latestRecoveryFailure(item) || item.failures[0]
    const sourceQuestion = sourceFailure.question
    const taughtSteps = (classContent?.steps || []).filter(step =>
      (sourceQuestion as SessionEvaluationQuestion).coveredStepIds?.includes(step.id) ||
      step.id === sourceQuestion.teachingBlockId
    )
    const strategy = selectRecoveryStrategy(item) || `alternative_${item.reteachAttempt + 1}`
    console.info("[adaptive-recovery]", JSON.stringify({
      event: "recovery_prefetch_started",
      recoveryId: item.recoveryId,
      generationKey,
      recovery_queue_depth: recoveryGenerationCoordinatorRef.current.queueDepth,
    }))
    const coordinated = recoveryGenerationCoordinatorRef.current.run(generationKey, async () => {
      const startedAt = Date.now()
      let response: Response | null = null
      let rawBody = ""
      try { response = await fetch("/api/adaptive/session-reteach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          includeVerificationQuestions: true,
          recoveryId: item.recoveryId,
          recoveryTargetId: item.recoveryTargetId,
          roundId: `${item.recoveryId}:round:${item.verificationRound + 1}`,
          recoveryRound: item.verificationRound + 1,
          generationKey,
          recoveryStrategy: strategy,
          evaluationMode: normalizeEvaluationMode(sessionData?.adaptiveSetup?.evalPreference),
          objective: {
            conceptLabel: sourceQuestion.conceptLabel,
            teachingContent: taughtSteps.map(step => step.content).join("\n\n") || sourceQuestion.explanation,
            keyPoint: (sourceQuestion as SessionEvaluationQuestion).coveredKeyPoints?.join("; ") || sourceQuestion.factKey,
            stepTitle: sourceQuestion.conceptLabel,
          },
          sourceQuestion,
          target: {
            sourceQuestionId: item.sourceQuestionId,
            sourceStepIds: item.sourceStepIds,
            sourceKeyPointIds: (sourceQuestion as SessionEvaluationQuestion & { coveredKeyPointIds?: string[] }).coveredKeyPointIds || item.sourceKeyPoints.map((_, index) => `${item.sourceStepIds[0]}:kp:${index + 1}`),
            sourceFactKeys: item.sourceFactKeys,
            microId: item.microId,
            cognitiveTarget: item.cognitiveTarget,
          },
          failedKeyPoints: (sourceQuestion as SessionEvaluationQuestion).coveredKeyPoints || item.latestFactKeys,
          studentAnswer: sourceFailure.answer,
          correctAnswer: sourceQuestion.correctAnswer,
          studentAnswerDisplay: presentAnswer(sourceQuestion, sourceFailure.answer),
          correctAnswerDisplay: presentAnswer(sourceQuestion, sourceQuestion.correctAnswer),
          questionText: sourceQuestion.questionText,
          feedback: sourceFailure.result.feedback,
          previousQuestions: [...item.failures.map(failure => failure.question), ...item.checks.map(check => check.question)],
          // Auditoría adversarial (Codex, Reteach #1.1): previousQuestions
          // solo llevaba el ENUNCIADO de intentos previos — nunca qué
          // respondió el estudiante en cada uno, así que el servidor no
          // podía distinguir "repitió el mismo distractor" de "cambió de
          // confusión entre rondas". item.failures YA tiene la respuesta y
          // el resultado completos de cada fallo real de este target.
          priorFailuresSummary: item.failures.map(failure => ({
            questionText: failure.question.questionText,
            studentAnswerDisplay: presentAnswer(failure.question, failure.answer),
            correctAnswerDisplay: presentAnswer(failure.question, failure.question.correctAnswer),
            errorType: failure.result.errorType || null,
          })),
          previousReteachFingerprints: item.reteachContentHistory,
          materialTitle: sessionData?.materialNames?.[0] || "Material",
          sessionTitle: classContent?.sessionTitle || "",
          studentProfile: sessionData?.adaptiveSetup ? {
            knowledgeLevel: sessionData.adaptiveSetup.knowledgeLevel || null,
            mainConcern: sessionData.adaptiveSetup.mainConcern || null,
          } : null,
        }),
      });rawBody=await response.text()}catch(error){rawBody="";console.error("[adaptive-recovery]",JSON.stringify({event:"recovery_round_generation_failed",errorCode:"RECOVERY_ROUND_NETWORK_FAILED",message:error instanceof Error?error.message:String(error),recoveryId:item.recoveryId,recoveryTargetId:item.recoveryTargetId,roundId:`${item.recoveryId}:round:${item.verificationRound+1}`,roundNumber:item.verificationRound+1,generationKey,durationMs:Date.now()-startedAt}))}
      let decoded:unknown=null;try{decoded=rawBody?JSON.parse(rawBody):null}catch(error){console.warn("[adaptive-recovery]",JSON.stringify({event:"recovery_round_response_invalid",errorCode:"RECOVERY_ROUND_INVALID_JSON",message:error instanceof Error?error.message:String(error),recoveryId:item.recoveryId,generationKey,raw:rawBody.slice(0,12000)}))}
      const record=decoded&&typeof decoded==="object"?decoded as Record<string,any>:{}
      console.info("[adaptive-recovery]",JSON.stringify({event:"recovery_round_response_received",status:response?.status||0,contentType:response?.headers.get("content-type")||"",raw:rawBody.slice(0,12000),success:record.success,explanationPresent:Boolean(record.explanation),questionsArray:Array.isArray(record.questions),questionCount:Array.isArray(record.questions)?record.questions.length:0,validationErrors:record.validationErrors||[],errorCode:record.errorCode||null,recoveryId:item.recoveryId,recoveryTargetId:item.recoveryTargetId,roundId:`${item.recoveryId}:round:${item.verificationRound+1}`,roundNumber:item.verificationRound+1,sourceQuestionId:item.sourceQuestionId,generationKey,provider:record.provider||null,model:record.model||null,durationMs:Date.now()-startedAt}))
      const parsed=parsePreparedRecoveryRound(decoded)
      if(!response?.ok||parsed.success===false){const validationErrors=parsed.success===false?parsed.validationErrors:[];const errorCode=record.errorCode||(!response?.ok?`HTTP_${response?.status||0}`:parsed.success===false?parsed.errorCode:"RECOVERY_ROUND_RESPONSE_INVALID");const latestQueue=recoveryQueueRef.current;const failedQueue=latestQueue.map(candidate=>candidate.recoveryId===item.recoveryId?{...candidate,status:"pending_reteach" as const,reason:"technical_retry_required",technicalStatus:"technical_retry_required" as const,activeGenerationKey:null,acceptedPartialExplanation:typeof record.partial?.explanation==="string"?record.partial.explanation:candidate.acceptedPartialExplanation||null,acceptedPartialQuestions:Array.isArray(record.partial?.questions)?record.partial.questions:candidate.acceptedPartialQuestions||[],technicalRetryCount:(candidate.technicalRetryCount||0)+1,lastTechnicalError:String(errorCode)}:candidate);persistRecoveryQueue(failedQueue);console.warn("[adaptive-recovery]",JSON.stringify({event:"recovery_round_generation_failed",errorCode,validationErrors,recoveryId:item.recoveryId,recoveryTargetId:item.recoveryTargetId,roundId:`${item.recoveryId}:round:${item.verificationRound+1}`,roundNumber:item.verificationRound+1,generationKey}));return {success:false,errorCode,validationErrors}}
      const data:PreparedRecoveryRound=parsed.value
      const latest = recoveryQueueRef.current.find(candidate => candidate.recoveryId === item.recoveryId)
      if (latest?.status === "pending_reteach") persistPreparedRecoveryRound(latest, data, strategy)
      console.info("[adaptive-recovery]", JSON.stringify({
        event: "recovery_round_generation_ready",
        recoveryId: item.recoveryId,
        generationKey,
        recovery_questions_per_target: data.questions.length,
      }))
      return data
    })
    const operation=coordinated.then(result=>{if(result?.success!==true)recoveryPrefetchRef.current.delete(generationKey);return result},error=>{recoveryPrefetchRef.current.delete(generationKey);return {success:false,errorCode:"RECOVERY_ROUND_NETWORK_FAILED",validationErrors:[error instanceof Error?error.message:String(error)]}})
    recoveryPrefetchRef.current.set(generationKey, operation)
    return operation
  }

  async function startRecoveryReteach(queue: RecoveryItem[], recoveryId: string) {
    const index = queue.findIndex(item => item.recoveryId === recoveryId)
    if (index < 0) return
    const current = queue[index]
    setActiveRecoveryId(current.recoveryId)
    setPendingQuestions([])
    setSessionPhase("reteaching")
    const sourceFailure = latestRecoveryFailure(current) || current.failures[0]
    setCurrentQuestion(sourceFailure.question)
    const ready = current.status === "verification_ready" && current.preparedReteachContent
    if (ready) {
      setReteachingContent(current.preparedReteachContent)
      setEvalLoading(false)
      setEvalError(null)
      return
    }
    setReteachingContent(null)
    setEvalLoading(true)
    try {
      const data = await prefetchRecoveryRound(current)
      let prepared = recoveryQueueRef.current.find(item => item.recoveryId === recoveryId)
      // Persistir si tiene reteachContent nuevo — sin importar el status actual
      const hasNewContent = data?.success === true && data?.explanation && Array.isArray(data?.questions) && data.questions.length === 2
      if (prepared?.status === "pending_reteach" && hasNewContent) {
        const strategy = selectRecoveryStrategy(prepared) || `alternative_${prepared.reteachAttempt + 1}`
        prepared = persistPreparedRecoveryRound(prepared, data, strategy)
      }
      if (!prepared?.preparedReteachContent) {
        setEvalError("La recuperación sigue activa. Reintenta la explicación sin perder tu progreso.")
        setReteachingContent(null)
        setEvalLoading(false)
        return
      }
      setReteachingContent(prepared.preparedReteachContent)
      setEvalError(null)
    } catch {
      setEvalError("La recuperación sigue activa. Reintentaremos la explicación adaptativa sin perder tu progreso.")
      setReteachingContent(null)
    }
    setEvalLoading(false)
  }

  function prepareRecoveryEvaluation(item: RecoveryItem, taughtStep?: ClassStep): Promise<any> {
    const generationKey = `${item.recoveryId}:round:${item.verificationRound}:v${item.verificationGenerationVersion}`
    const existing = recoveryPrefetchRef.current.get(generationKey)
    if (existing) return existing
    const source = latestRecoveryFailure(item)?.question || item.failures[0].question
    const step = taughtStep || classContent?.steps.find(candidate => candidate.id === source.teachingBlockId) || {
      id: source.teachingBlockId,
      type: "concept",
      title: source.conceptLabel,
      content: source.explanation,
      keyPoint: source.explanation,
      relatedBlockIds: [],
    }
    const roundId = `${item.recoveryId}:round:${item.verificationRound}`
    const persisted = item.verificationQuestions
      .filter(entry => entry.roundId === roundId && entry.answeredAt === null)
      .map(entry => entry.question)
    const history = [...item.failures.map(failure => failure.question), ...item.checks.map(check => check.question), ...persisted]
    const required = Math.max(1, item.requiredIndependentChecks - item.completedIndependentChecks - persisted.length)
    const operation = fetch("/api/adaptive/session-eval", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taughtSteps: [{ id: step.id, type: step.type, title: step.title, content: step.content, keyPoint: step.keyPoint }],
        mode: sessionData?.adaptiveSetup?.evalPreference || "mix_everything",
        sessionTitle: classContent?.sessionTitle || "",
        materialTitle: sessionData?.materialNames?.[0] || "Material",
        previousQuestions: history.map(question => ({
          id: question.id, factKey: question.factKey, questionText: question.questionText, format: question.format,
        })),
        isReevaluation: true,
        failedConcepts: [item.conceptLabel],
        activeConceptId: item.conceptId,
        activeConceptLabel: item.conceptLabel,
        requiredQuestionCount: required,
        recoveryAttempt: item.reteachAttempt,
        generationKey,
        recoveryId: item.recoveryId,
        roundId,
        assessmentBlueprint,
        sourceRecoveryTarget: {
          targetObjectiveIds: item.targetObjectiveIds,
          microId: item.microId,
          factKeys: item.sourceFactKeys,
          cognitiveTarget: item.cognitiveTarget,
        },
      }),
    }).then(async response => ({ response, data: await response.json(), generationKey }))
    recoveryPrefetchRef.current.set(generationKey, operation)
    return operation
  }


  function scheduleAutoRecoveryVerificationRetry(item: RecoveryItem) {
    if (autoRecoveryRetryTimerRef.current) clearTimeout(autoRecoveryRetryTimerRef.current)
    const delayMs = Math.min(6000, 1200 + item.verificationGenerationVersion * 800)
    initRecoveryMetrics(item.recoveryId)
    recordAutoRetry(item.recoveryId)
    const payload = buildRetryScheduledPayload({
      recoveryId: item.recoveryId,
      recoveryTargetId: item.recoveryTargetId,
      verificationRound: item.verificationRound,
      verificationGenerationVersion: item.verificationGenerationVersion,
      delayMs,
      sessionId: sessionData?.id,
    })
    console.info("[adaptive-recovery]", JSON.stringify(payload))
    autoRecoveryRetryTimerRef.current = setTimeout(() => {
      const latest = recoveryQueueRef.current.find(candidate => candidate.recoveryId === item.recoveryId)
      if (!latest) {
        console.info("[adaptive-recovery]", JSON.stringify(buildRetryAbandonedPayload({
          recoveryId: item.recoveryId,
          verificationRound: item.verificationRound,
          verificationGenerationVersion: item.verificationGenerationVersion,
          reason: 'item_not_found',
          sessionId: sessionData?.id,
        })))
        return
      }
      if (latest.status !== "pending_verification" && latest.status !== "verification_ready") {
        console.info("[adaptive-recovery]", JSON.stringify(buildRetryAbandonedPayload({
          recoveryId: latest.recoveryId,
          verificationRound: latest.verificationRound,
          verificationGenerationVersion: latest.verificationGenerationVersion,
          reason: 'status_changed',
          sessionId: sessionData?.id,
        })))
        return
      }
      console.info("[adaptive-recovery]", JSON.stringify(buildRetryStartedPayload({
        recoveryId: latest.recoveryId,
        verificationRound: latest.verificationRound,
        verificationGenerationVersion: latest.verificationGenerationVersion,
        sessionId: sessionData?.id,
      })))
      void generateRecoveryQuestions(latest, recoveryQueueRef.current)
    }, delayMs)
  }

  async function generateRecoveryQuestions(item: RecoveryItem, queueSnapshot: RecoveryItem[] = recoveryQueue) {
    const generationKey = `${item.recoveryId}:round:${item.verificationRound}:v${item.verificationGenerationVersion}`
    if (inFlightGenerationKeyRef.current === generationKey) {
      console.info("[adaptive-recovery]", JSON.stringify({
        event: "duplicateRequestSuppressed",
        generationKey,
        recoveryId: item.recoveryId,
      }))
      return
    }
    inFlightGenerationKeyRef.current = generationKey
    setEvalLoading(true)
    setSessionPhase("verification_generation")
    setCurrentQuestion(null)
    setReteachingContent(null)
    console.info("[adaptive-recovery]", JSON.stringify({
      event: "verification_generation_started",
      sessionId: sessionData?.id,
      recoveryId: item.recoveryId,
      roundId: `${item.recoveryId}:round:${item.verificationRound}`,
      currentStep: currentStepIndex,
    }))
    const source = latestRecoveryFailure(item)?.question || item.failures[0].question
    const taughtStep = classContent?.steps.find(step => item.sourceStepIds.includes(step.id))
      || lastEvalStepsRef.current.find(step => item.sourceStepIds.includes(step.id))
      || classContent?.steps[currentStepIndex]
      || {
        id: source.teachingBlockId,
        type: "concept",
        title: source.conceptLabel,
        content: source.explanation,
        keyPoint: source.explanation,
        relatedBlockIds: [],
      }

    const requiredNow = Math.max(1, item.requiredIndependentChecks - item.completedIndependentChecks)
    const currentRoundId = `${item.recoveryId}:round:${item.verificationRound}`
    const collected: CanonicalQuestion[] = item.verificationQuestions
      .filter(entry => entry.roundId === currentRoundId && entry.answeredAt === null)
      .map(entry => entry.question)
    let workingItem = item
    let workingQueue = queueSnapshot
    if (collected.length < requiredNow) {
      let generatedThisAttempt = false
      try {
        const history = [
          ...workingItem.failures.map(failure => failure.question),
          ...workingItem.checks.map(check => check.question),
          ...collected,
        ]
        const { data } = await prepareRecoveryEvaluation(workingItem, taughtStep)
        if (inFlightGenerationKeyRef.current !== generationKey) {
          console.info("[adaptive-recovery]", JSON.stringify({
            event: "stale_generation_result_blocked",
            generationKey,
            recoveryId: item.recoveryId,
            roundId: `${item.recoveryId}:round:${item.verificationRound}`,
          }))
          return
        }
        if (data.success && Array.isArray(data.questions)) {
          for (const received of data.questions as CanonicalQuestion[]) {
            // Validar el target REAL producido por la generación — ANTES de normalizarlo
            // con los valores canónicos del item. Validar después de sobrescribir
            // conceptId/coveredStepIds/etc. es tautológico: compara el target contra una
            // copia de sí mismo y nunca puede fallar.
            const alignment = validateRecoveryTargetAlignment(workingItem, received)
            if (!alignment.valid) {
              console.warn("[adaptive-recovery]", JSON.stringify({
                event: "recovery_target_drift_detected",
                stage: "session_eval_client",
                recoveryId: workingItem.recoveryId,
                recoveryTargetId: workingItem.recoveryTargetId,
                roundId: currentRoundId,
                questionId: received.id,
                errors: alignment.errors,
                generatedConceptId: received.conceptId,
                generatedTargetDimension: received.targetDimension,
                generatedCoveredStepIds: (received as CanonicalQuestion & { coveredStepIds?: string[] }).coveredStepIds,
                generatedCoveredKeyPoints: (received as CanonicalQuestion & { coveredKeyPoints?: string[] }).coveredKeyPoints,
                generatedFactKeys: received.factKeys,
                expectedMicroId: workingItem.microId,
                expectedCognitiveTarget: workingItem.cognitiveTarget,
                expectedSourceStepIds: workingItem.sourceStepIds,
                expectedSourceKeyPoints: workingItem.sourceKeyPoints,
                expectedSourceFactKeys: workingItem.sourceFactKeys,
              }))
              continue
            }
            const question = {
              ...received,
              conceptId: workingItem.microId,
              targetDimension: workingItem.cognitiveTarget as CanonicalQuestion["targetDimension"],
              targetObjectiveIds: workingItem.targetObjectiveIds,
              factKeys: workingItem.sourceFactKeys,
              factKey: workingItem.sourceFactKeys[0] || received.factKey,
              evidenceProduced: workingItem.targetObjectiveIds,
              coveredStepIds: workingItem.sourceStepIds,
              coveredKeyPoints: workingItem.sourceKeyPoints,
            } as CanonicalQuestion & { coveredStepIds: string[]; coveredKeyPoints: string[] }
            if (!validateQuestionTypeForMode(sessionData?.adaptiveSetup?.evalPreference, question.format).valid) {
              logModeBlocked(question, "verification_generation")
              continue
            }
            const prior = [...history, ...collected]
            const repeated = prior.some(existing =>
              existing.id === question.id ||
              questionSimilarity(existing, question) >= RECOVERY_SEMANTIC_EQUIVALENCE_THRESHOLD
            )
            if (question.conceptId === workingItem.conceptId && !repeated && collected.length < requiredNow) {
              collected.push(question)
              generatedThisAttempt = true
            }
          }
        } else if (Array.isArray(data.acceptedQuestions)) {
          for (const question of data.acceptedQuestions as CanonicalQuestion[]) {
            if (
              question.conceptId === workingItem.conceptId &&
              !collected.some(existing => existing.id === question.id)
            ) {
              collected.push(question)
              generatedThisAttempt = true
            }
          }
        }
      } catch {
        generatedThisAttempt = false
      }
      workingItem = recordVerificationGenerationAttempt(workingItem, generatedThisAttempt)
      workingQueue = workingQueue.map(candidate =>
        candidate.recoveryId === workingItem.recoveryId ? workingItem : candidate
      )
      persistRecoveryQueue(workingQueue)
    }

    if (collected.length < requiredNow) {
      if (collected.length > 0) {
        workingItem = persistRecoveryVerificationQuestions(workingItem, collected)
        workingQueue = workingQueue.map(candidate =>
          candidate.recoveryId === workingItem.recoveryId ? workingItem : candidate
        )
      }
      workingItem = prepareVerificationGenerationRetry(workingItem)
      const retryQueue = workingQueue.map(candidate =>
        candidate.recoveryId === workingItem.recoveryId ? workingItem : candidate
      )
      persistRecoveryQueue(retryQueue)
      setEvalLoading(true)
      setEvalError("Seguimos preparando preguntas adaptativas válidas para esta recuperación…")
      setSessionPhase("verification_generation")
      if (inFlightGenerationKeyRef.current === generationKey) inFlightGenerationKeyRef.current = null
      scheduleAutoRecoveryVerificationRetry(workingItem)
      return
    }
    workingItem = persistRecoveryVerificationQuestions(workingItem, collected)
    workingQueue = workingQueue.map(candidate =>
      candidate.recoveryId === workingItem.recoveryId ? workingItem : candidate
    )
    persistRecoveryQueue(workingQueue)
    const presented = presentRecoveryVerificationQuestion(workingItem)
    workingQueue = workingQueue.map(candidate =>
      candidate.recoveryId === presented.item.recoveryId ? presented.item : candidate
    )
    persistRecoveryQueue(workingQueue)
    if (!presented.question) {
      setEvalLoading(false)
      setEvalError("La recuperación sigue activa. Reintenta la generación de esta misma ronda.")
      if (inFlightGenerationKeyRef.current === generationKey) inFlightGenerationKeyRef.current = null
      return
    }
    if (autoRecoveryRetryTimerRef.current) {
      clearTimeout(autoRecoveryRetryTimerRef.current)
      autoRecoveryRetryTimerRef.current = null
      const successPayload = buildRetrySucceededPayload({
        recoveryId: workingItem.recoveryId,
        verificationRound: workingItem.verificationRound,
        verificationGenerationVersion: workingItem.verificationGenerationVersion,
        sessionId: sessionData?.id,
      })
      console.info("[adaptive-recovery]", JSON.stringify(successPayload))
    }
    setPreviousQuestions(previous => [...previous, ...collected])
    setPendingQuestions([])
    activateQuestion(presented.question)
    if (verificationClickStartedAtRef.current !== null) {
      console.info("[adaptive-latency]", JSON.stringify({
        event: "recovery_question_visible_after_click",
        sessionId: sessionData?.id,
        recoveryId: presented.item.recoveryId,
        durationMs: Date.now() - verificationClickStartedAtRef.current,
        prefetched: recoveryPrefetchRef.current.has(generationKey),
      }))
      verificationClickStartedAtRef.current = null
    }
    console.info("[adaptive-recovery]", JSON.stringify({
      event: "verification_question_presented",
      sessionId: sessionData?.id,
      recoveryId: presented.item.recoveryId,
      roundId: `${presented.item.recoveryId}:round:${presented.item.verificationRound}`,
      questionId: presented.question.id,
      currentStep: currentStepIndex,
    }))
    setSessionPhase("evaluating")
    setEvalLoading(false)
    if (inFlightGenerationKeyRef.current === generationKey) inFlightGenerationKeyRef.current = null
  }

  // Registra el resultado de una respuesta de verificación de recovery TAN PRONTO
  // como se conoce (desde submitAnswer, antes de mostrar la pantalla de feedback).
  // Así, cuando esa pantalla renderiza, la cola/progreso/blueprint YA reflejan el
  // resultado real — el botón de feedback puede leer la MISMA máquina canónica
  // (deriveNextSessionAction) que decide completion, en vez de predecir con
  // heurísticas que podían mostrar "Continuar →" justo antes de completar en silencio.
  function recordRecoveryVerificationOutcome(
    question: CanonicalQuestion,
    freshResult: { outcome?: string; correct?: boolean; errorType?: string | null } | null,
  ): { recorded: ReturnType<typeof recordRecoveryCheck>; nextQueue: RecoveryItem[] } | null {
    const index = recoveryQueueRef.current.findIndex(item => item.recoveryId === activeRecoveryId)
    if (index < 0) return null
    const current = recoveryQueueRef.current[index]
    const outcome = freshResult?.outcome === "invalid"
      ? "invalid"
      : freshResult?.correct
        ? "correct"
        : "incorrect"
    // Fijar el nivel UNA vez, antes de limpiar el registro persistido — el
    // intento (esta verificación de recovery) se está consumiendo AHORA
    // (Finding 1: "debe eliminarse cuando el intento se consume").
    const assistanceLevelForThisAttempt = currentAssistanceLevel()
    const attemptKeyForThisAttempt = currentAttemptKey()
    if (attemptKeyForThisAttempt && restoredAssistanceRef.current?.attemptKey === attemptKeyForThisAttempt) {
      persistPendingAssistance(null)
    }
    // Codex Finding 1 + PARTE B (chat): una verificación de recovery resuelta
    // con ayuda de la pista O del chat no puede contar como independiente —
    // recordRecoveryCheck ya exige assistanceLevel==='independent' para que
    // successfulIndependentChecks incremente (ver recoveryQueue.ts), pero
    // solo si aquí se le pasa el nivel real (currentAssistanceLevel(), nunca
    // un literal hardcodeado) en vez de solo consultar hintShownRef. Incluye
    // asistencia restaurada tras un refresh mid-verificación.
    const recorded = recordRecoveryCheck(
      current,
      question,
      { outcome, correct: freshResult?.correct === true, errorType: freshResult?.errorType || null },
      assistanceLevelForThisAttempt,
      getCompositeAnswer(),
    )
    const nextQueue = recoveryQueueRef.current.map((item, itemIndex) => itemIndex === index ? recorded.item : item)
    persistRecoveryQueue(nextQueue)
    console.info("[adaptive-recovery]", JSON.stringify({
      event: "verification_question_answered",
      sessionId: sessionData?.id,
      recoveryId: recorded.item.recoveryId,
      roundId: `${recorded.item.recoveryId}:round:${recorded.item.verificationRound}`,
      questionId: question.id,
      outcome,
      currentStep: currentStepIndex,
    }))
    if (recorded.item.status === "resolved") {
      if (activeEvaluationBlockId) {
        const currentProgress = evaluationProgressRef.current
        const progress = currentProgress[activeEvaluationBlockId]
        if (progress) persistEvaluationProgress({
          ...currentProgress,
          [activeEvaluationBlockId]: resolveBlockRecovery(progress, recorded.item.recoveryId),
        })
      }
      if (assessmentBlueprintRef.current && recorded.item.targetObjectiveIds.length) {
        persistAssessmentBlueprint(recordAssessmentEvidence(
          assessmentBlueprintRef.current,
          recorded.item.targetObjectiveIds,
          recorded.item.sourceFactKeys,
          {
            valid: true,
            correct: true,
            // status==='resolved' solo puede alcanzarse cuando successfulIndependentChecks
            // llega al mínimo requerido, y ese contador SOLO crece con
            // assistanceLevel==='independent' (recoveryQueue.ts) — así que el
            // check que acaba de resolver esta ronda fue, por construcción,
            // independiente. Se deriva del MISMO valor ya capturado arriba
            // (assistanceLevelForThisAttempt, que ya incluye chat + hint +
            // asistencia restaurada) en vez de volver a leer los refs (que
            // para este punto ya podrían no reflejar el intento que
            // realmente se está resolviendo) o hardcodear.
            independent: assistanceLevelForThisAttempt === "independent",
            evidenceId: `recovery:${recorded.item.recoveryId}:${recorded.item.verificationRound}`,
          },
        ))
      }
      console.info("[adaptive-recovery]", JSON.stringify({
        ...recorded.telemetry,
        ...recoveryVisibilityAudit(recorded.item),
      }))
      recordResolved(recorded.item.recoveryId)
      const roundSummary = buildRoundQualitySummary({
        recoveryId: recorded.item.recoveryId,
        verificationRound: recorded.item.verificationRound,
        questionsGenerated: recorded.item.verificationQuestions.filter(q =>
          q.roundId === `${recorded.item.recoveryId}:round:${recorded.item.verificationRound}`
        ).length,
        questionsAccepted: recorded.item.completedIndependentChecks,
        questionsRejected: recorded.item.checks.filter(c => !c.counted).length,
        providerUsed: 'ai',
        formatUsed: recorded.item.checks.at(-1)?.question.format || 'unknown',
        durationMs: 0,
        resolved: true,
        sessionId: sessionData?.id,
      })
      console.info("[adaptive-recovery]", JSON.stringify(roundSummary))
      console.info("[adaptive-recovery]", JSON.stringify({
        event: "recovery_resolved",
        sessionId: sessionData?.id,
        recoveryId: recorded.item.recoveryId,
        roundId: `${recorded.item.recoveryId}:round:${recorded.item.verificationRound}`,
        currentStep: currentStepIndex,
      }))
    }
    return { recorded, nextQueue }
  }

  // Actúa sobre un resultado YA registrado (por recordRecoveryVerificationOutcome).
  // Se dispara con el click del usuario en el panel de feedback — nunca vuelve a
  // registrar la respuesta, solo decide a dónde ir a partir del status ya persistido.
  async function routeRecoveryVerificationOutcome(
    outcome: { recorded: ReturnType<typeof recordRecoveryCheck>; nextQueue: RecoveryItem[] },
  ) {
    const { recorded, nextQueue } = outcome
    if (recorded.item.status === "resolved") {
      await continueAfterRecovery(nextQueue)
      return
    }
    if (recorded.item.status === "pending_reteach") {
      console.info("[adaptive-recovery]", JSON.stringify({
        ...recorded.telemetry,
        ...recoveryVisibilityAudit(recorded.item),
      }))
      console.info("[adaptive-recovery]", JSON.stringify({
        event: "recovery_round_restarted",
        sessionId: sessionData?.id,
        recoveryId: recorded.item.recoveryId,
        roundId: `${recorded.item.recoveryId}:round:${recorded.item.verificationRound}`,
        currentStep: currentStepIndex,
      }))
      await startRecoveryReteach(nextQueue, recorded.item.recoveryId)
      return
    }
    const index = nextQueue.findIndex(item => item.recoveryId === recorded.item.recoveryId)
    const presented = presentRecoveryVerificationQuestion(recorded.item)
    const presentedQueue = nextQueue.map((item, itemIndex) => itemIndex === index ? presented.item : item)
    persistRecoveryQueue(presentedQueue)
    console.info("[adaptive-recovery]", JSON.stringify({
      ...recorded.telemetry,
      ...recoveryVisibilityAudit(presented.item),
    }))
    if (presented.question) {
      activateQuestion(presented.question)
      console.info("[adaptive-recovery]", JSON.stringify({
        event: "verification_question_presented",
        sessionId: sessionData?.id,
        recoveryId: presented.item.recoveryId,
        roundId: `${presented.item.recoveryId}:round:${presented.item.verificationRound}`,
        questionId: presented.question.id,
        currentStep: currentStepIndex,
      }))
      setSessionPhase("evaluating")
      return
    }
    await generateRecoveryQuestions(presented.item, presentedQueue)
  }

  async function handleRecoveryFeedback(question: CanonicalQuestion) {
    const cached = pendingRecoveryOutcomeRef.current
    pendingRecoveryOutcomeRef.current = null
    const outcome = cached && cached.questionId === question.id
      ? cached
      // Red de seguridad defensiva: si por algún motivo no se registró antes
      // (no debería ocurrir en el flujo normal), registrar ahora con el
      // resultado ya conocido en evalResult.
      : recordRecoveryVerificationOutcome(question, evalResult)
    if (!outcome) return
    await routeRecoveryVerificationOutcome(outcome)
  }

  async function continueAfterRecovery(queue: RecoveryItem[]) {
    const next = nextRecoveryItem(queue)
    if (next) {
      await startRecoveryReteach(queue, next.recoveryId)
      return
    }
    // CRITICAL: limpiar activeRecoveryId ANTES de derivar la acción
    // para que sessionTransitionState compute isSessionComplete correctamente
    setActiveRecoveryId(null)
    setActiveEvaluationBlockId(null)
    persistFailedQuestions([])
    setPendingQuestions([])
    setCurrentQuestion(null)
    setUserAnswer(null)
    setEvalResult(null)
    setReteachingContent(null)
    setSessionPhase("teaching")
    console.info("[adaptive-recovery]", JSON.stringify({
      event: "recovery_completion_audit",
      sessionId: sessionData?.id,
      currentStep: currentStepIndex,
      ...recoveryCompletionAudit(queue),
    }))
    // Forzar progress actualizado: cerrar bloques pendientes si es necesario
    const latestProgress = evaluationProgressRef.current
    const content = classContentRef.current
    const allBlocks = content?.evaluationBlocks || []
    let finalProgress = { ...latestProgress }
    for (const block of allBlocks) {
      const bp = finalProgress[block.id]
      if (bp && bp.status !== "completed") {
        const { closeNormalEvaluationBlock } = await import("../../../../../lib/adaptive/evaluation/sessionEvaluation")
        finalProgress = { ...finalProgress, [block.id]: closeNormalEvaluationBlock(block, bp) }
      }
    }
    if (finalProgress !== latestProgress) {
      persistEvaluationProgress(finalProgress)
    }
    await executeDerivedSessionAction({ queue, activeRecovery: false, progress: finalProgress })
  }

  async function handleReteachNext() {
    const index = recoveryQueue.findIndex(item => item.recoveryId === activeRecoveryId)
    if (index < 0) return
    verificationClickStartedAtRef.current = Date.now()
    console.info("[adaptive-recovery]", JSON.stringify({
      event: "reteach_verify_button_clicked",
      sessionId: sessionData?.id,
      recoveryId: recoveryQueue[index].recoveryId,
      roundId: `${recoveryQueue[index].recoveryId}:round:${recoveryQueue[index].verificationRound + 1}`,
      currentStep: currentStepIndex,
    }))
    const current = recoveryQueue[index]
    const verifying = current.status === "verification_ready"
      ? current
      : beginRecoveryVerification(current)
    const nextQueue = recoveryQueue.map((item, itemIndex) => itemIndex === index ? verifying : item)
    if (verifying !== current) persistRecoveryQueue(nextQueue)
    setReteachingContent(null)
    await generateRecoveryQuestions(verifying, nextQueue)
  }



  function sessionTransitionState(overrides?:{
    progress?:Record<string,EvaluationBlockProgress>
    queue?:RecoveryItem[]
    activeRecovery?:boolean
    failedQuestionsCount?:number
  }):SessionTransitionState {
    const content=classContentRef.current || classContent
    const progress=overrides?.progress || evaluationProgressRef.current
    const queue=overrides?.queue || recoveryQueueRef.current
    const blocks=content?.evaluationBlocks || []
    const stepId=content?.steps[currentStepIndex]?.id
    const block=(activeEvaluationBlockId?blocks.find(item=>item.id===activeEvaluationBlockId):null)
      || blocks.find(item=>item.afterStepId===stepId) || null
    const blockProgress=block?progress[block.id]:null
    const completedBlockCount=blocks.filter(item=>progress[item.id]?.status==="completed").length
    const remainingQuestionCount=block&&blockProgress?.status!=="completed"
      ? Math.max(0,block.questions.length-(blockProgress?.currentQuestionIndex||0)) : 0
    const activeAssessment=assessmentBlueprintRef.current
    const objectiveCoverageRatio=skipEvaluation?1:Number(activeAssessment?.coverageRatio||0)
    const assessmentComplete=skipEvaluation||Boolean(activeAssessment&&canCompleteSessionFromAssessment(activeAssessment,[]))
    const allBlocksComplete=completedBlockCount===blocks.length
    const lastStep=currentStepIndex>=Math.max(0,(content?.steps.length||1)-1)

    // Un recovery diferido (deferredUntilNormalBlockComplete) todavía no fue liberado al
    // usuario — no debe contar como "pendingRecoveries" (eso saltaría a show_next_recovery
    // antes de que el bloque normal siquiera se marque cerrado). Solo cuenta una vez released.
    const unresolvedQueueCount = queue.filter(item=>item.status!=="resolved" && !item.deferredUntilNormalBlockComplete).length
    const pendingRecoveryIds = Array.isArray((blockProgress as any)?.pendingRecoveryIds)
      ? ((blockProgress as any).pendingRecoveryIds as unknown[]).map(String).filter(Boolean)
      : []
    const readyRecoveryIds = Array.isArray((blockProgress as any)?.readyRecoveryIds)
      ? ((blockProgress as any).readyRecoveryIds as unknown[]).map(String).filter(Boolean)
      : []
    // Recovery latente = el progreso del bloque referencia un recoveryId que ya no existe
    // en la cola (huérfano/perdido) — nunca debe permitir "🎉 Terminar". Un recovery que SÍ
    // sigue en la cola pero todavía diferido (deferredUntilNormalBlockComplete) no es
    // huérfano — ya lo cubre unresolvedQueueCount en cuanto se libera; contarlo aquí también
    // saltaría a show_next_recovery antes de que el bloque se marque siquiera cerrado.
    // Mismo criterio para failedQuestionsRef: una vez que el fallo ya generó su recoveryId
    // en la cola (aunque siga diferido), la cola es la fuente de verdad — contar el fallo
    // aparte aquí forzaría show_next_recovery antes de que el bloque se cierre.
    const untrackedFailedQuestions = failedQuestionsRef.current.filter(failure =>
      !queue.some(item => item.sourceQuestionIds?.includes(failure.question.id))
    )
    const latentFailedRecoveryCount = (overrides?.failedQuestionsCount ?? untrackedFailedQuestions.length) > 0 ? 1 : 0
    const queueRecoveryIds = new Set(queue.map(item => item.recoveryId))
    const latentBlockRecoveryCount =
      [...pendingRecoveryIds, ...readyRecoveryIds].some(id => !queueRecoveryIds.has(id))
        ? 1
        : 0
    const latentRecoveries = latentFailedRecoveryCount + latentBlockRecoveryCount

    return {
      currentStepIndex,
      currentEvaluationBlock:block?{id:block.id,completed:blockProgress?.status==="completed"}:null,
      currentQuestionIndex:blockProgress?.currentQuestionIndex||0,
      unansweredNormalQuestions:remainingQuestionCount,
      pendingRecoveries:unresolvedQueueCount,
      latentRecoveries,
      activeRecovery:overrides?.activeRecovery??Boolean(activeRecoveryId),
      completedEvaluationBlocks:completedBlockCount,
      totalEvaluationBlocks:blocks.length,
      totalTeachingSteps:content?.steps.length||0,
      sessionKind,
      sessionCompletionResult:{
        objectiveCoverageRatio,
        isSessionComplete:lastStep&&allBlocksComplete&&assessmentComplete,
      },
    }
  }

  function logDerivedSessionAction(action:SessionAction,state:SessionTransitionState,transitionId:number){
    console.info("[adaptive-session-transition]",JSON.stringify({
      event:"session_action_derived",action:action.type,currentStepIndex:state.currentStepIndex,
      totalSteps:state.totalTeachingSteps,pendingRecoveryCount:state.pendingRecoveries,
      latentRecoveryCount:state.latentRecoveries,
      remainingQuestionCount:state.unansweredNormalQuestions,
      completedBlockCount:state.completedEvaluationBlocks,transitionId,
    }))
  }

  function completeEvaluationBlock(progress:Record<string,EvaluationBlockProgress>):Record<string,EvaluationBlockProgress>{
    const content=classContentRef.current
    const block=content?.evaluationBlocks?.find(item=>item.id===activeEvaluationBlockId)
      || content?.evaluationBlocks?.find(item=>item.afterStepId===content.steps[currentStepIndex]?.id)
    if(!block)return progress
    const current=progress[block.id]||createEvaluationBlockProgress(block)
    const closed=closeNormalEvaluationBlock(block,current)
    const next={...progress,[block.id]:closed}
    persistEvaluationProgress(next)
    return next
  }

  async function completeLearningSession(transitionId:number,overrides?:{progress?:Record<string,EvaluationBlockProgress>;queue?:RecoveryItem[];activeRecovery?:boolean}){
    if(!sessionData?.id)return
    const finalState=sessionTransitionState(overrides)
    const finalAction=deriveNextSessionAction(finalState)
    if(finalAction.type!=="complete_session"){
      logDerivedSessionAction(finalAction,finalState,transitionId)
      // Guardia defensiva SOLO para desfases reactivos realmente limpios.
      // Nunca forzar completion si existe recovery activa o latente.
      const queueClean = (overrides?.queue ?? recoveryQueueRef.current).every(item => item.status === "resolved")
      const blueprintClean = assessmentBlueprintRef.current
        ? assessmentBlueprintRef.current.unresolvedObjectiveIds.length === 0
        : true
      const noNormalQuestions = finalState.unansweredNormalQuestions === 0
      const noRecoveryDebt = finalState.pendingRecoveries === 0 && finalState.latentRecoveries === 0 && !finalState.activeRecovery
      const noOpenBlock = !finalState.currentEvaluationBlock || finalState.currentEvaluationBlock.completed

      if (queueClean && blueprintClean && noNormalQuestions && noRecoveryDebt && noOpenBlock) {
        console.info("[adaptive-session-transition]", JSON.stringify({
          event: "session_completion_forced_clean_state",
          transitionId,
          sessionId: sessionData?.id,
          reason: finalAction.type,
        }))
      } else {
        setEvalError("La sesión aún tiene una transición pendiente.")
        return
      }
    }
    console.info("[adaptive-session-transition]",JSON.stringify({event:"session_completion_started",transitionId,sessionId:sessionData.id}))
    const updated=updateSessionById(sessionData.id,(current:any)=>completeAdaptiveSession(current,sessionNumber,{isProgramComplete:current.isProgramComplete,unresolvedMicroIds:current.unresolvedMicroIds}))
    if(transitionId!==transitionIdRef.current)return
    if(updated)setSessionData(updated)
    console.info("[adaptive-session-transition]",JSON.stringify({event:"session_completion_persisted",transitionId,sessionId:sessionData.id}))
    setCompleted(true)
    const allRecoveryIds = recoveryQueueRef.current.map(item => item.recoveryId)
    if (allRecoveryIds.length > 0) {
      try {
        const summary = buildSessionSummary(sessionData.id, allRecoveryIds)
        console.info("[adaptive-recovery]", JSON.stringify(summary))
      } catch (error) {
        console.warn("[adaptive-recovery]", JSON.stringify({
          event: "recovery_session_summary_failed",
          sessionId: sessionData.id,
          recoveryIdCount: allRecoveryIds.length,
          error: error instanceof Error ? error.message : String(error),
        }))
      }
    }
  }

  async function executeDerivedSessionAction(overrides?:{
    progress?:Record<string,EvaluationBlockProgress>
    queue?:RecoveryItem[]
    activeRecovery?:boolean
  }){
    if(actionInFlightRef.current){
      console.info("[adaptive-session-transition]",JSON.stringify({event:"duplicate_session_transition_blocked",transitionId:transitionIdRef.current,sessionId:sessionData?.id}))
      return
    }
    actionInFlightRef.current=true
    const transitionId=++transitionIdRef.current
    try{
      let progress=overrides?.progress||evaluationProgressRef.current
      let queue=overrides?.queue||recoveryQueueRef.current
      for(let iteration=0;iteration<3;iteration++){
        const state=sessionTransitionState({progress,queue,activeRecovery:overrides?.activeRecovery})
        const action=deriveNextSessionAction(state)
        logDerivedSessionAction(action,state,transitionId)
        if(transitionId!==transitionIdRef.current)return
        if(action.type==="complete_current_block"){
          progress=completeEvaluationBlock(progress)
          continue
        }
        if(action.type==="show_next_normal_question"){
          const content=classContentRef.current
          const block=content?.evaluationBlocks?.find(item=>item.id===activeEvaluationBlockId)
            || content?.evaluationBlocks?.find(item=>item.afterStepId===content.steps[currentStepIndex]?.id)
          if(block)startEvaluationBlock(block)
          return
        }
        if(action.type==="show_next_recovery"){
          const released=nextRecoveryItem(queue)?queue:releaseNormalBlockRecoveries(queue)
          if(released!==queue){queue=released;persistRecoveryQueue(released)}
          const next=nextRecoveryItem(released)
          if(next)await startRecoveryReteach(released,next.recoveryId)
          return
        }
        if(action.type==="show_next_teaching_step"){
          advanceToNextTeachingStep(queue)
          return
        }
        if(action.type==="complete_session"){
          await completeLearningSession(transitionId,{progress,queue,activeRecovery:overrides?.activeRecovery})
          return
        }
        console.warn("[adaptive-debug]", JSON.stringify({
          event: "session_transition_blocked",
          sessionId: sessionData?.id,
          transitionId,
          action,
          state,
          activeEvaluationBlockId,
          activeRecoveryId,
          phase: sessionPhase,
          assessment: assessmentBlueprintRef.current ? {
            coverageRatio: assessmentBlueprintRef.current.coverageRatio,
            taughtObjectiveIds: assessmentBlueprintRef.current.taughtObjectiveIds,
            assessedObjectiveIds: assessmentBlueprintRef.current.assessedObjectiveIds,
            demonstratedObjectiveIds: assessmentBlueprintRef.current.demonstratedObjectiveIds,
            unresolvedObjectiveIds: assessmentBlueprintRef.current.unresolvedObjectiveIds,
          } : null,
        }))
        setEvalError(action.reason==="objective_coverage_incomplete"?"Aún falta evidencia válida para completar los objetivos enseñados.":"Aún falta completar una evaluación de esta sesión.")
        return
      }
    }finally{
      if(transitionId===transitionIdRef.current)actionInFlightRef.current=false
    }
  }

  function handleReplay() {
    if (!sessionData?.id || actionInFlightRef.current) return
    actionInFlightRef.current = true
    const u = updateSessionById(sessionData.id, (c: any) => replayAdaptiveSession(c, sessionNumber))
    if (u) setSessionData(u); setCompleted(false); setCurrentStepIndex(0)
    setSessionPhase("teaching"); setCurrentQuestion(null); setPendingQuestions([])
    setPreviousQuestions([]); setUserAnswer(null); setEvalResult(null); setReteachingContent(null)
    setActiveRecoveryId(null)
    recoveryRestoreStartedRef.current = false
    const pendingRecovery = nextRecoveryItem(recoveryQueue)
    if (pendingRecovery) void startRecoveryReteach(recoveryQueue, pendingRecovery.recoveryId)
    actionInFlightRef.current = false
  }

  function handleNextSession() {
    if (!sessionData?.id) return
    if (!hasNextSession) { router.push(adaptivePlanRoute(temaId, sessionData.id)); return }
    router.push(adaptiveSessionRoute(temaId, sessionData.id, sessionNumber + 1))
  }

  function openPlan() {
    const id = String(sessionData?.id || adaptiveSessionId || "")
    if (!id) return
    if (actionInFlightRef.current && !completed) {
      console.info("[adaptive-navigation] plan_navigation_blocked_by_active_persistence", {
        sessionId: id,
        sessionNumber,
      })
      return
    }
    const result = navigateToExistingPlan({
      temaId,
      journeyId: id,
      persistedJourney: sessionData,
    }, {
      navigate: route => window.location.assign(route),
      telemetry: (event, details) => console.info(`[adaptive-navigation] ${event}`, details),
    })
    if (!result.ok) {
      setError("No encontramos el plan guardado. Vuelve al mapa para recuperar este proceso sin generar uno nuevo.")
    }
  }

  function retrySessionPreparation() {
    if (loading) return
    void loadContext()
  }

  function acknowledgeBreak(takeBreak: boolean) {
    breakHoursAcknowledgedRef.current = Math.max(
      breakHoursAcknowledgedRef.current,
      Math.floor(activeStudyMsRef.current / (60 * 60 * 1000)),
    )
    if (sessionData?.id) {
      updateSessionById(sessionData.id, current => ({
        ...current,
        activeStudyMs: activeStudyMsRef.current,
        breakHoursAcknowledged: breakHoursAcknowledgedRef.current,
      }))
    }
    setShowBreak(false)
    if (takeBreak) openPlan()
  }

  if (loading) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#e2e8f0" }}><div style={{ textAlign: "center" }}><div style={{ fontSize: 48, marginBottom: 16 }}>📚</div><div style={{ fontSize: 18, fontWeight: 600 }}>Preparando tu sesión…</div></div></div>
  if (error) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#e2e8f0", padding: 24 }}><div style={{ textAlign: "center", maxWidth: 500 }}><div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div><div style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>{error}</div><div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}><button data-testid="retry-session-preparation" onClick={retrySessionPreparation} style={{ padding: "12px 24px", background: "#4ade80", color: "#052e16", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Reintentar preparar sesión</button><button onClick={openPlan} style={{ padding: "12px 24px", background: "#3b82f6", color: "white", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Volver al plan</button></div></div></div>
  if (!classContent) return null

  if (completed) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, #0f172a 0%, #1e293b 100%)", color: "#e2e8f0", padding: 24 }}>
      <div style={{ maxWidth: 560, width: "100%", textAlign: "center", background: "rgba(30,41,59,0.6)", padding: 40, borderRadius: 20, border: "1px solid rgba(74,222,128,0.3)" }}>
        <div style={{ fontSize: 72, marginBottom: 20 }}>🎉</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 12, color: "#4ade80" }}>Sesión completada</h1>
        {/* Dominio final — SOLO para sesiones evaluativas (learning). Auditoría
            adversarial: introduction/final_review nunca tienen assessmentBlueprint
            (initCoverage hace setAssessmentBlueprint(null) para estos kinds), así
            que total=0 caía en el fallback `total > 0 ? ... : 100`, mostrando
            "Dominio alcanzado — 0 de 0 objetivos demostrados" con un 100% — un
            dato de mastery académico FABRICADO para una sesión que por diseño
            nunca produjo evidencia. Mostrar el aro de dominio solo cuando la
            sesión realmente evalúa evita afirmar dominio no demostrado. */}
        {!shouldEvaluateSession(sessionKind) ? (
          <div style={{ fontSize: 14, opacity: 0.75, marginBottom: 16 }}>
            {sessionKind === "introduction" ? "Familiarización completada" : "Repaso completado"}
          </div>
        ) : (() => {
          const demonstrated = assessmentBlueprint?.demonstratedObjectiveIds?.length ?? 0
          const total = assessmentBlueprint?.taughtObjectiveIds?.length ?? 0
          const mastery = total > 0 ? Math.round((demonstrated / total) * 100) : 100
          const color = mastery >= 80 ? "#4ade80" : mastery >= 50 ? "#fbbf24" : "#f97316"
          return (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
              marginBottom: 16, padding: "12px 20px",
              background: `${color}10`,
              border: `1px solid ${color}30`,
              borderRadius: 12,
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: `conic-gradient(${color} ${mastery * 3.6}deg, rgba(148,163,184,0.15) 0deg)`,
                display: "grid", placeItems: "center",
              }}>
                <div style={{
                  width: 38, height: 38, borderRadius: "50%",
                  background: "rgba(30,41,59,0.9)",
                  display: "grid", placeItems: "center",
                  fontSize: 14, fontWeight: 900, color,
                }}>
                  {mastery}%
                </div>
              </div>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color }}>Dominio alcanzado</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{demonstrated} de {total} objetivos demostrados</div>
              </div>
            </div>
          )
        })()}
        <div style={{ fontSize: 16, opacity: 0.85, marginBottom: 8 }}>{classContent.sessionTitle}</div>
        <div style={{ fontSize: 15, opacity: 0.7, marginBottom: 24, fontStyle: "italic" }}><AcademicContent content={classContent.sessionClosing} /></div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={handleReplay} style={{ padding: "12px 20px", background: "rgba(148,163,184,0.15)", color: "#e2e8f0", border: "1px solid rgba(148,163,184,0.3)", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>🔄 Repetir</button>
          <button onClick={openPlan} style={{ padding: "12px 20px", background: "rgba(59,130,246,0.15)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.4)", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>📋 Plan</button>
          {hasNextSession && <button onClick={handleNextSession} style={{ padding: "12px 24px", background: "#4ade80", color: "#052e16", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>Siguiente →</button>}
        </div>
      </div>
    </div>
  )

  const step = classContent.steps[currentStepIndex]
  const progress = ((currentStepIndex + 1) / classContent.steps.length) * 100
  // IMPORTANTE: usar recoveryQueueRef.current (siempre sincronizado)
  // en vez de recoveryQueue (state React, puede estar un render atrás)
  const primarySessionAction=deriveNextSessionAction(sessionTransitionState({
    queue: recoveryQueueRef.current,
  }))
  const primarySessionActionLabel=getPrimaryActionLabel(primarySessionAction)
  // handleRecoveryFeedback ya registró esta respuesta (desde submitAnswer, antes de
  // este render) — recoveryQueueRef/evaluationProgressRef/assessmentBlueprintRef YA
  // reflejan el resultado real. No hay nada que predecir: leer el status persistido.
  const activeRecoveryForLabel=activeRecoveryId
    ? recoveryQueueRef.current.find(item=>item.recoveryId===activeRecoveryId) || null
    : null
  const recoveryResolvedAfterAnswer = activeRecoveryForLabel?.status === "resolved"
  const recoveryRoundFailedAfterAnswer = activeRecoveryForLabel?.status === "pending_reteach"
  // Misma máquina canónica que decide completion (deriveNextSessionAction), sobre
  // el estado YA real post-registro — no una predicción. Solo falta simular que
  // failedQuestionsRef se limpiará (eso ocurre recién en continueAfterRecovery,
  // que todavía no corrió) cuando esta era la última recovery pendiente.
  const sessionCompletesAfterThisRecovery=Boolean(
    recoveryResolvedAfterAnswer &&
    activeRecoveryId &&
    !nextRecoveryItem(recoveryQueueRef.current) &&
    deriveNextSessionAction(sessionTransitionState({
      activeRecovery: false,
      failedQuestionsCount: 0,
    })).type === "complete_session"
  )

  const feedbackActionLabel =
    evalResult?.outcome==="invalid"
      ? "Generar otra →"
      : activeRecoveryId
        ? getRecoveryActionLabel({
            roundFailed: recoveryRoundFailedAfterAnswer,
            resolved: recoveryResolvedAfterAnswer,
            hasMoreTeachingSteps: !sessionCompletesAfterThisRecovery,
          })
        : pendingQuestions.length>0
          ? getPrimaryActionLabel({type:"show_next_normal_question"})
          : evalResult?.correct
            ? primarySessionActionLabel
            : "Revisar conceptos →"

  return (
    <div
      data-testid="adaptive-session-root"
      data-session-kind={sessionKind}
      data-assessment-coverage={assessmentBlueprint?.coverageRatio ?? 0}
      data-unresolved-objectives={assessmentBlueprint?.unresolvedObjectiveIds.length ?? 0}
      style={{ minHeight: "100vh", background: "linear-gradient(180deg, #0f172a 0%, #1e293b 100%)", color: "#e2e8f0" }}
    >
      <div className="alai-session-shell" data-chat-open={chatOpen} style={{ maxWidth: 780, margin: "0 auto", padding: "32px 24px", transition: "margin-right .25s ease" }}>

        {/* BREAK MODAL */}
        {showBreak && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "#1e293b", borderRadius: 20, padding: 40, maxWidth: 440, textAlign: "center", border: "1px solid rgba(250,204,21,0.3)" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⏰</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Llevas aproximadamente una hora estudiando</div>
              <div style={{ fontSize: 15, opacity: 0.8, marginBottom: 24 }}>Te recomendamos tomar un descanso corto antes de continuar. Tu recuperación y tus preguntas quedan guardadas.</div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                <button onClick={() => acknowledgeBreak(true)} style={{ padding: "12px 20px", background: "rgba(59,130,246,0.15)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.4)", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Tomar un descanso</button>
                <button onClick={() => acknowledgeBreak(false)} style={{ padding: "12px 24px", background: "#4ade80", color: "#052e16", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>Continuar estudiando</button>
              </div>
            </div>
          </div>
        )}

        {/* HEADER */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <button onClick={openPlan} style={{ background: "transparent", color: "#94a3b8", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>← Salir al plan</button>
          {/* DOMINIO — indicador visual arriba a la derecha. SOLO para sesiones
              evaluativas: introduction/final_review nunca tienen objectives
              (taughtObjectiveIds queda vacío), así que mostrar este badge ahí
              siempre decía "0/0 objetivos" con un aro fabricado — nunca dominio
              real. Ver también el bloque equivalente en la pantalla de
              completado, unas líneas más abajo. */}
          {!shouldEvaluateSession(sessionKind) ? (
            <div style={{ fontSize: 13, opacity: 0.7 }}>Sesión {classContent.sessionNumber}</div>
          ) : (() => {
            const coverage = assessmentBlueprint?.coverageRatio ?? 0
            const demonstrated = assessmentBlueprint?.demonstratedObjectiveIds?.length ?? 0
            const total = assessmentBlueprint?.taughtObjectiveIds?.length ?? 0
            const mastery = total > 0 ? Math.round((demonstrated / total) * 100) : (skipEvaluation ? 100 : 0)
            const color = mastery >= 80 ? "#4ade80" : mastery >= 50 ? "#fbbf24" : mastery > 0 ? "#f97316" : "#64748b"
            return (
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{ fontSize: 13, opacity: 0.7 }}>Sesión {classContent.sessionNumber}</div>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px",
                  background: `${color}15`,
                  border: `1px solid ${color}40`,
                  borderRadius: 999,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: `conic-gradient(${color} ${mastery * 3.6}deg, rgba(148,163,184,0.15) 0deg)`,
                    display: "grid", placeItems: "center",
                  }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: "50%",
                      background: "#1e293b",
                      display: "grid", placeItems: "center",
                      fontSize: 9, fontWeight: 900, color,
                    }}>
                      {mastery}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color, lineHeight: 1.1 }}>
                    <div>Dominio</div>
                    <div style={{ fontSize: 9, opacity: 0.7, fontWeight: 500 }}>
                      {demonstrated}/{total} objetivos
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

        <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid rgba(148,163,184,0.15)" }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.2 }}>{classContent.sessionTitle}</h1>
          {skipEvaluation && <div style={{ marginTop: 10, padding: 12, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 10, color: "#86efac", fontSize: 14 }}>Sesión sin evaluación.</div>}
          {currentStepIndex === 0 && <div style={{ fontSize: 15, opacity: 0.85, fontStyle: "italic", marginTop: 8, padding: 12, background: "rgba(59,130,246,0.08)", borderLeft: "3px solid #3b82f6", borderRadius: 4 }}><AcademicContent content={classContent.sessionIntro} /></div>}
        </div>

        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.7, marginBottom: 6 }}><span>Paso {currentStepIndex + 1} de {classContent.steps.length}</span><span>{Math.round(progress)}%</span></div>
          <div style={{ height: 6, background: "rgba(148,163,184,0.15)", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #3b82f6, #4ade80)", transition: "width 0.3s ease" }} /></div>
        </div>

        {sessionPhase === "teaching" && evalError && (
          <div style={{
            marginBottom: 16,
            padding: "12px 16px",
            background: "rgba(245,158,11,0.10)",
            border: "1px solid rgba(245,158,11,0.35)",
            borderRadius: 12,
            color: "#fde68a",
            fontSize: 14,
            lineHeight: 1.5,
          }}>
            {evalError}
          </div>
        )}

        {/* TEACHING */}
        {sessionPhase === "teaching" && (<>
          <div style={{ background: "rgba(30,41,59,0.55)", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 16, padding: 28, marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}><span style={{ fontSize: 24 }}>{SI[step.type]}</span><span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", padding: "3px 10px", background: "rgba(59,130,246,0.15)", color: "#60a5fa", borderRadius: 999 }}>{SL[step.type]}</span></div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, lineHeight: 1.3 }}><AcademicContent content={step.title} /></h2>
            <div style={{ fontSize: 16, lineHeight: 1.7, color: "#cbd5e1" }}><AcademicContent content={step.content} /></div>
            {step.keyPoint && <div style={{ marginTop: 20, padding: 16, background: "rgba(250,204,21,0.08)", border: "1px solid rgba(250,204,21,0.25)", borderRadius: 10 }}><div style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24", marginBottom: 6 }}>💡 Idea clave</div><div style={{ fontSize: 15, color: "#fde68a", fontWeight: 500 }}><AcademicContent content={step.keyPoint} /></div></div>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, opacity: 0.6 }}>
              {!skipEvaluation && (() => {
                const block = classContent.evaluationBlocks?.find(block => block.afterStepId === step.id)
                if (!block) return ""
                const progress = evaluationProgress[block.id]
                if (progress?.status === "completed") return ""
                return "Después de este paso toca verificar comprensión."
              })()}
            </div>
            <button data-testid="session-primary-action" onClick={proceedToNextStep} style={{ padding: "14px 32px", background: primarySessionAction.type==="complete_session" ? "linear-gradient(90deg, #4ade80, #22c55e)" : "linear-gradient(90deg, #3b82f6, #6366f1)", color: primarySessionAction.type==="complete_session" ? "#052e16" : "white", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>{primarySessionActionLabel}</button>
          </div>
        </>)}

        {/* EVALUATING — LOADING */}
        {(sessionPhase === "evaluating" || sessionPhase === "verification_generation") && evalLoading && !currentQuestion && (
          <div style={{ background: "rgba(30,41,59,0.55)", border: "1px solid rgba(99,102,241,0.35)", borderRadius: 16, padding: 28, textAlign: "center" }}>
            <div style={{ fontSize: 42, marginBottom: 12 }}>🧠</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{sessionPhase === "verification_generation" ? "Preparando tu verificación..." : "Preparando evaluación..."}</div>
            <div style={{ fontSize: 14, opacity: 0.75 }}>{sessionPhase === "verification_generation" ? "La recuperación sigue activa mientras preparamos dos preguntas nuevas." : "Generando preguntas basadas en lo que acabas de aprender."}</div>
          </div>
        )}

        {(sessionPhase === "evaluating" || sessionPhase === "verification_generation") && !evalLoading && !currentQuestion && evalError && (
          <div data-testid="evaluation-mode-error" style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 16, padding: 28, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>No mostramos una actividad incompatible</div>
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 18 }}>{evalError}</div>
            <button onClick={retryCompatibleEvaluation} style={{ padding: "12px 22px", background: "#f59e0b", color: "#1f2937", border: 0, borderRadius: 9, fontWeight: 700, cursor: "pointer" }}>Intentar otra pregunta</button>
          </div>
        )}

        {/* EVALUATING — QUESTION */}
        {sessionPhase === "evaluating" && currentQuestion && !evalLoading && (<div style={{ background: "rgba(30,41,59,0.55)", border: "1px solid rgba(99,102,241,0.35)", borderRadius: 16, padding: 28, marginBottom: 24 }}>
          {activeRecoveryId && <div style={{ fontSize: 12, color: "#fbbf24", marginBottom: 8 }}>{(() => {
            const active = recoveryQueue.find(item => item.recoveryId === activeRecoveryId)
            const round = Math.max(1, active?.verificationRound || active?.reteachAttempt || 1)
            const errorIndex = recoveryQueue.findIndex(item => item.recoveryId === activeRecoveryId) + 1
            return recoveryQueue.length > 1 ? `Ronda ${round} · Error ${errorIndex} de ${recoveryQueue.length}` : `Recuperación · Ronda ${round}`
          })()}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#a5b4fc", textTransform: "uppercase" }}>
              {activeRecoveryId ? "Verificación de recuperación" : "Pregunta de comprensión"}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginLeft: "auto" }}>
              {currentQuestion.difficulty === "easy" ? "🟢 Básica" : currentQuestion.difficulty === "hard" ? "🔴 Avanzada" : "🟡 Intermedia"}
              {" · "}
              {{
                multiple_choice: "Opción múltiple",
                multi_select: "Varias correctas",
                true_false: "Verdadero/Falso",
                word_bank: "Completar",
                ordering: "Ordenar",
                matching: "Relacionar",
                classify: "Clasificar",
                scenario: "Caso práctico",
                find_the_error: "Detectar error",
                short_response: "Respuesta abierta",
                numeric_problem: "Cálculo",
              }[currentQuestion.format] || currentQuestion.format}
            </div>
          </div>
          {/* word_bank compone su propio render de questionText (con los huecos
              rellenos) más abajo — mostrarlo aquí también duplicaba la oración
              completa en pantalla (una vez cruda con "___", otra vez interactiva). */}
          {currentQuestion.format !== "word_bank" && <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, lineHeight: 1.4 }}><AcademicContent content={currentQuestion.questionText} /></div>}

          {/* MCQ / SCENARIO / FIND ERROR */}
          {["multiple_choice", "scenario", "find_the_error"].includes(currentQuestion.format) && Array.isArray(currentQuestion.options) && <div style={{ display: "grid", gap: 12 }}>{(currentQuestion.options as any[]).map((o: any) => <button key={o.id} onClick={() => setUserAnswer(o.id)} style={{ textAlign: "left", padding: "14px 16px", background: userAnswer === o.id ? "rgba(59,130,246,0.18)" : "rgba(15,23,42,0.6)", color: "#e2e8f0", border: userAnswer === o.id ? "1px solid #60a5fa" : "1px solid rgba(148,163,184,0.2)", borderRadius: 10, cursor: "pointer", fontSize: 15 }}><AcademicContent content={o.text} inline /></button>)}</div>}

          {/* MULTI SELECT */}
          {currentQuestion.format === "multi_select" && <div style={{ display: "grid", gap: 12 }}>{currentQuestion.options.map(option => {
            const selected = Array.isArray(userAnswer) && userAnswer.includes(option.id)
            return <button key={option.id} aria-pressed={selected} onClick={() => setUserAnswer((previous: unknown) => {
              const selectedIds = Array.isArray(previous) ? previous as string[] : []
              return selectedIds.includes(option.id)
                ? selectedIds.filter(id => id !== option.id)
                : [...selectedIds, option.id]
            })} style={{ textAlign: "left", padding: "14px 16px", background: selected ? "rgba(59,130,246,0.18)" : "rgba(15,23,42,0.6)", color: "#e2e8f0", border: selected ? "1px solid #60a5fa" : "1px solid rgba(148,163,184,0.2)", borderRadius: 10, cursor: "pointer", fontSize: 15 }}><AcademicContent content={option.text} inline /></button>
          })}</div>}

          {/* TRUE/FALSE */}
          {currentQuestion.format === "true_false" && <div style={{ display: "grid", gap: 12 }}>{["true", "false"].map(v => <button key={v} onClick={() => setUserAnswer(v === "true")} style={{ textAlign: "left", padding: "14px 16px", background: userAnswer === (v === "true") ? "rgba(59,130,246,0.18)" : "rgba(15,23,42,0.6)", color: "#e2e8f0", border: userAnswer === (v === "true") ? "1px solid #60a5fa" : "1px solid rgba(148,163,184,0.2)", borderRadius: 10, cursor: "pointer", fontSize: 15 }}>{v === "true" ? "Verdadero" : "Falso"}</button>)}</div>}

          {/* WORD BANK — el questionText completo (con "___" en las posiciones de
              hueco) se parsea UNA sola vez a través de AcademicContent. Dos
              callbacks comparten el MISMO contador blankIndex (en orden real
              de aparición, coherente con el contrato "correctAnswer sigue el
              orden de los huecos"): renderBlank para huecos en texto plano
              (ficha interactiva independiente), renderMathBlank para huecos
              que quedaron DENTRO de un span matemático (p.ej. "$10^{-___}$")
              — ahí el valor se sustituye EN la posición matemática real
              (exponente/fracción/raíz) antes de invocar KaTeX, en vez de
              partir el string antes de parsear (que rompía el agrupamiento
              LaTeX y mostraba $/{/} literales — Finding 4, auditoría
              adversarial post-7a3c3f7). Toda estructura que no pueda
              sustituirse de forma segura ya se rechaza en generación
              (questionContract.ts: hasUnsupportedWordBankMathBlank) y, como
              red de seguridad adicional, AcademicContent nunca crashea ni
              muestra sintaxis rota si algo inesperado llega igual (fail-closed). */}
          {currentQuestion.format === "word_bank" && Array.isArray(currentQuestion.options) && (() => {
            let blankIndex = -1
            const nextBlankAnswer = () => {
              blankIndex += 1
              const i = blankIndex
              const answerId = wordBankAnswers[i] || ""
              const answerLabel = (currentQuestion.options as any[]).find((option: any) => option.id === answerId)?.text || ""
              return { i, answerId, answerLabel }
            }
            return <div>
              <div style={{ fontSize: 17, lineHeight: 2, marginBottom: 20, padding: 16, background: "rgba(15,23,42,0.5)", borderRadius: 12, border: "1px solid rgba(148,163,184,0.15)" }}>
                <AcademicContent
                  content={currentQuestion.questionText}
                  renderBlank={() => {
                    const { i, answerId, answerLabel } = nextBlankAnswer()
                    return <span style={{ display: "inline-block", minWidth: 100, padding: "4px 12px", margin: "0 4px", background: answerId ? "rgba(59,130,246,0.2)" : "rgba(148,163,184,0.1)", border: answerId ? "2px solid #60a5fa" : "2px dashed rgba(148,163,184,0.3)", borderRadius: 8, textAlign: "center", color: answerId ? "#93c5fd" : "#64748b", fontWeight: 600, cursor: "pointer", fontSize: 15 }} onClick={() => { if (answerId) { const n = [...wordBankAnswers]; n[i] = ""; setWordBankAnswers(n) } }}>
                      {answerLabel ? <AcademicContent content={answerLabel} inline /> : "___"}
                    </span>
                  }}
                  renderMathBlank={() => {
                    const { i, answerId, answerLabel } = nextBlankAnswer()
                    return {
                      latex: toLatexSafeText(answerLabel),
                      onClick: answerId ? () => { const n = [...wordBankAnswers]; n[i] = ""; setWordBankAnswers(n) } : undefined,
                    }
                  }}
                />
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase" }}>Banco de palabras</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {(currentQuestion.options as any[]).map((o: any) => {
                  const isUsed = wordBankAnswers.includes(o.id)
                  return <button key={o.id} disabled={isUsed} onClick={() => {
                    const firstEmpty = wordBankAnswers.findIndex(w => w === "")
                    if (firstEmpty !== -1) { const n = [...wordBankAnswers]; n[firstEmpty] = o.id; setWordBankAnswers(n) }
                  }} style={{ padding: "10px 18px", background: isUsed ? "rgba(148,163,184,0.05)" : "rgba(59,130,246,0.12)", color: isUsed ? "#475569" : "#93c5fd", border: isUsed ? "1px solid rgba(148,163,184,0.1)" : "1px solid rgba(59,130,246,0.3)", borderRadius: 999, cursor: isUsed ? "default" : "pointer", fontSize: 15, fontWeight: 600, opacity: isUsed ? 0.4 : 1, textDecoration: isUsed ? "line-through" : "none" }}>
                    <AcademicContent content={o.text} inline />
                  </button>
                })}
              </div>
            </div>
          })()}

          {/* ORDERING — drag & drop + botones ↑↓ */}
          {currentQuestion.format === "ordering" && Array.isArray(currentQuestion.options) && (() => {
            let dragItemIdx: number | null = null
            let dragOverIdx: number | null = null
            return (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
                  Arrastra para reordenar, o usa las flechas
                </div>
                {orderingAnswers.map((id, i) => {
                  const opt = (currentQuestion.options as any[]).find((o: any) => o.id === id)
                  return (
                    <div
                      key={id}
                      draggable
                      onDragStart={() => { dragItemIdx = i }}
                      onDragEnter={() => { dragOverIdx = i }}
                      onDragEnd={() => {
                        if (dragItemIdx === null || dragOverIdx === null) return
                        if (dragItemIdx === dragOverIdx) return
                        const n = [...orderingAnswers]
                        const dragged = n.splice(dragItemIdx, 1)[0]
                        n.splice(dragOverIdx, 0, dragged)
                        setOrderingAnswers(n)
                        dragItemIdx = null
                        dragOverIdx = null
                      }}
                      onDragOver={e => e.preventDefault()}
                      style={{
                        display: "flex", gap: 8, alignItems: "center",
                        cursor: "grab", userSelect: "none",
                        transition: "transform 0.15s ease",
                      }}
                    >
                      <span style={{ color: "#94a3b8", fontSize: 14, minWidth: 24, fontWeight: 700 }}>{i + 1}.</span>
                      <div style={{
                        flex: 1, padding: "12px 14px",
                        background: "rgba(15,23,42,0.6)",
                        border: "1px solid rgba(148,163,184,0.2)",
                        borderRadius: 8, color: "#e2e8f0", fontSize: 14,
                        display: "flex", alignItems: "center", gap: 8,
                      }}>
                        <span style={{ color: "#475569", fontSize: 16 }}>⠿</span>
                        <AcademicContent content={opt?.text || ""} />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <button
                          onClick={() => { if (i > 0) { const n = [...orderingAnswers]; [n[i-1], n[i]] = [n[i], n[i-1]]; setOrderingAnswers(n) }}}
                          disabled={i === 0}
                          style={{ background: i === 0 ? "rgba(148,163,184,0.05)" : "rgba(59,130,246,0.2)", border: "none", borderRadius: 4, color: i === 0 ? "#334155" : "#60a5fa", cursor: i === 0 ? "default" : "pointer", padding: "4px 8px", fontSize: 12 }}
                        >↑</button>
                        <button
                          onClick={() => { if (i < orderingAnswers.length-1) { const n = [...orderingAnswers]; [n[i], n[i+1]] = [n[i+1], n[i]]; setOrderingAnswers(n) }}}
                          disabled={i === orderingAnswers.length - 1}
                          style={{ background: i === orderingAnswers.length-1 ? "rgba(148,163,184,0.05)" : "rgba(59,130,246,0.2)", border: "none", borderRadius: 4, color: i === orderingAnswers.length-1 ? "#334155" : "#60a5fa", cursor: i === orderingAnswers.length-1 ? "default" : "pointer", padding: "4px 8px", fontSize: 12 }}
                        >↓</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* MATCHING */}
          {currentQuestion.format === "matching" && Array.isArray(currentQuestion.options) && (() => {
            const displayOptions = matchingDisplayOptions(currentQuestion)
            return <div style={{ display: "grid", gap: 12 }}>{currentQuestion.options.map(pair => {
              const selectedHere = matchingAnswers[pair.id] || ""
              const usedElsewhere = new Set(Object.entries(matchingAnswers).filter(([leftId]) => leftId !== pair.id).map(([, rightId]) => rightId))
              return <div key={pair.id} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}><div style={{ flex: 1, minWidth: 220, padding: 12, background: "rgba(15,23,42,0.6)", borderRadius: 8, border: "1px solid rgba(148,163,184,0.2)", fontSize: 14, color: "#e2e8f0" }}><AcademicContent content={pair.left} /></div><span aria-hidden="true" style={{ color: "#60a5fa" }}>→</span><AcademicListbox label={`Relacionar ${pair.left}`} value={selectedHere} onChange={rightId => setMatchingAnswers(previous => ({ ...previous, [pair.id]: rightId }))} options={displayOptions.map(option => ({ ...option, disabled: currentQuestion.matchingSemantics === "bijective" && option.id !== selectedHere && usedElsewhere.has(option.id) }))} /></div>
            })}</div>
          })()}

          {/* CLASSIFICATION */}
          {currentQuestion.format === "classify" && isRecord(currentQuestion.options) && Array.isArray(currentQuestion.options.items) && Array.isArray(currentQuestion.options.categories) && <div style={{ display: "grid", gap: 12 }}>{currentQuestion.options.items.map(item => {
            const assignments = typeof userAnswer === "object" && userAnswer !== null ? userAnswer as Record<string, string> : {}
            return <div key={item.id} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}><AcademicContent content={item.text} /></div>
              <AcademicListbox
                label={`Clasificar ${item.text}`}
                value={assignments[item.id] || ""}
                onChange={category => setUserAnswer((previous: unknown) => ({
                  ...(typeof previous === "object" && previous !== null ? previous as Record<string, string> : {}),
                  [item.id]: category,
                }))}
                options={currentQuestion.options.categories.map(category => ({ id: category, content: category }))}
              />
            </div>
          })}</div>}

          {/* SHORT RESPONSE */}
          {currentQuestion.format === "short_response" && <textarea value={typeof userAnswer === "string" ? userAnswer : ""} onChange={e => setUserAnswer(e.target.value)} placeholder="Escribe tu respuesta..." style={{ width: "100%", minHeight: 120, padding: 14, background: "rgba(15,23,42,0.6)", color: "#e2e8f0", border: "1px solid rgba(148,163,184,0.25)", borderRadius: 10, resize: "vertical", outline: "none", fontSize: 15 }} />}

          {/* NUMERIC */}
          {currentQuestion.format === "numeric_problem" && <input type="text" value={typeof userAnswer === "string" ? userAnswer : ""} onChange={e => setUserAnswer(e.target.value)} placeholder="Valor numérico..." style={{ width: "100%", padding: 14, background: "rgba(15,23,42,0.6)", color: "#e2e8f0", border: "1px solid rgba(148,163,184,0.25)", borderRadius: 10, outline: "none", fontSize: 15 }} />}

          <div style={{ marginTop: 22 }}>
            {currentQuestion.hint && !userAnswer && !isAnswerReady() && (
              hintRevealed ? (
                <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12, fontStyle: "italic", display: "flex", gap: 6, alignItems: "center" }}>
                  <span>💡</span>
                  <span>Pista: <AcademicContent content={currentQuestion.hint} inline /></span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    hintShownRef.current = true; setHintRevealed(true)
                    // Finding 1: persistir de inmediato — si el estudiante
                    // refresca ANTES de responder, este intento debe seguir
                    // contando como asistido tras la restauración.
                    const attemptKey = currentAttemptKey()
                    if (attemptKey) persistPendingAssistance({ attemptKey, assistanceLevel: "minimal_hint" })
                  }}
                  style={{ background: "none", border: "none", padding: 0, marginBottom: 12, color: "#64748b", fontSize: 13, fontStyle: "italic", cursor: "pointer", display: "flex", gap: 6, alignItems: "center" }}
                >
                  <span>💡</span><span>Ver pista</span>
                </button>
              )
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={submitAnswer}
                aria-label="Enviar respuesta"
                disabled={evalLoading || !isAnswerReady()}
                style={{
                  padding: "14px 32px",
                  background: isAnswerReady() ? "linear-gradient(90deg, #10b981, #059669)" : "#334155",
                  color: "white", border: "none", borderRadius: 10,
                  fontSize: 15, fontWeight: 700,
                  cursor: isAnswerReady() ? "pointer" : "not-allowed",
                  transition: "background 0.2s ease",
                  boxShadow: isAnswerReady() ? "0 4px 12px rgba(16,185,129,0.3)" : "none",
                }}
              >
                {evalLoading ? "Verificando…" : "Confirmar respuesta →"}
              </button>
            </div>
          </div>
        </div>)}

        {/* FEEDBACK */}
        {sessionPhase === "feedback" && evalResult && currentQuestion && (() => {
          const isInvalid = evalResult.outcome === "invalid"
          const isCorrect = evalResult.correct === true
          const showCorrectAnswer = !isCorrect && !isInvalid

          // Construir display de respuesta correcta según formato
          const correctAnswerDisplay = (() => {
            if (!showCorrectAnswer) return null
            const q = currentQuestion
            if (q.format === "multiple_choice" || q.format === "scenario" || q.format === "find_the_error") {
              const correctOpt = (q.options as any[]).find((o: any) => o.id === q.correctAnswer)
              return correctOpt ? <span style={{ fontWeight: 700, color: "#34d399" }}><AcademicContent content={correctOpt.text} inline /></span> : null
            }
            if (q.format === "true_false") {
              return <span style={{ fontWeight: 700, color: "#34d399" }}>{q.correctAnswer === true ? "Verdadero" : "Falso"}</span>
            }
            if (q.format === "multi_select") {
              const correctIds = Array.isArray(q.correctAnswer) ? q.correctAnswer as string[] : []
              const correctTexts = correctIds.map(id => (q.options as any[]).find((o: any) => o.id === id)?.text).filter(Boolean)
              return <span style={{ fontWeight: 700, color: "#34d399" }}>{correctTexts.join(", ")}</span>
            }
            if (q.format === "ordering") {
              const correctOrder = Array.isArray(q.correctAnswer) ? q.correctAnswer as string[] : []
              const labels = correctOrder.map((id, idx) => {
                const opt = (q.options as any[]).find((o: any) => o.id === id)
                return `${idx + 1}. ${opt?.text || id}`
              })
              return <ol style={{ margin: "6px 0", paddingLeft: 20 }}>{labels.map((label, i) => <li key={i} style={{ color: "#34d399", fontWeight: 600, fontSize: 14 }}>{label}</li>)}</ol>
            }
            if (q.format === "word_bank") {
              const correctIds = Array.isArray(q.correctAnswer) ? q.correctAnswer as string[] : []
              const labels = correctIds.map(id => (q.options as any[]).find((o: any) => o.id === id)?.text).filter(Boolean)
              return <span style={{ fontWeight: 700, color: "#34d399" }}>{labels.join(" → ")}</span>
            }
            if (q.format === "matching") {
              // Fuente única de verdad: la MISMA correctAnswer que usa el grader
              // (scoreQuestion). No reconstruir la solución leyendo pair.right directo
              // del mismo entry de options[] — eso puede divergir de correctAnswer y
              // mostrar como "correcta" una combinación distinta a la que realmente
              // calificó el grader.
              return (
                <ul style={{ margin: "6px 0", paddingLeft: 0, listStyle: "none" }}>
                  {matchingCorrectPairs(q as CanonicalQuestion & { format: "matching" }).map(pair => (
                    <li key={pair.pairId} style={{ color: "#34d399", fontSize: 14, marginBottom: 4 }}>
                      <AcademicContent content={pair.left} inline /> → <AcademicContent content={pair.rightText} inline />
                    </li>
                  ))}
                </ul>
              )
            }
            if (q.format === "classify") {
              if (!isRecord(q.options) || !Array.isArray(q.options.items)) return null
              const items = q.options.items
              return (
                <ul style={{ margin: "6px 0", paddingLeft: 0, listStyle: "none" }}>
                  {items.map((item: any) => (
                    <li key={item.id} style={{ color: "#34d399", fontSize: 14, marginBottom: 4 }}>
                      <AcademicContent content={item.text} inline />
                      <span style={{ color: "#64748b" }}> → </span>
                      <span style={{ fontWeight: 700 }}>{item.category}</span>
                    </li>
                  ))}
                </ul>
              )
            }
            if (q.format === "short_response") {
              return <span style={{ fontWeight: 700, color: "#34d399" }}><AcademicContent content={String(q.correctAnswer)} inline /></span>
            }
            if (q.format === "numeric_problem") {
              const ca = q.correctAnswer as { value: number; tolerance: number; unit?: string }
              return <span style={{ fontWeight: 700, color: "#34d399" }}>{ca.value}{ca.unit ? ` ${ca.unit}` : ""} {ca.tolerance > 0 ? `(±${ca.tolerance})` : ""}</span>
            }
            return null
          })()

          return (
            <div style={{
              background: isInvalid ? "rgba(245,158,11,0.1)" : isCorrect ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.08)",
              border: isInvalid ? "1px solid rgba(245,158,11,0.35)" : isCorrect ? "1px solid rgba(16,185,129,0.35)" : "1px solid rgba(239,68,68,0.35)",
              borderRadius: 16, padding: 28, marginBottom: 24,
            }}>
              {/* Resultado principal */}
              <div style={{ fontSize: 22, fontWeight: 800, color: isInvalid ? "#fbbf24" : isCorrect ? "#34d399" : "#f87171", marginBottom: 12 }}>
                {isInvalid ? "⚠️ Actividad no válida" : isCorrect ? "✅ ¡Correcto!" : "❌ Incorrecto"}
              </div>

              {/* Score si existe */}
              {typeof evalResult.score === "number" && evalResult.score < 100 && !isCorrect && (
                <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 12 }}>
                  Puntuación parcial: {evalResult.score}%
                </div>
              )}

              {/* Qué estuvo bien */}
              {evalResult.whatWasRight && (
                <div style={{ fontSize: 14, color: "#34d399", marginBottom: 8, display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0 }}>✅</span>
                  <AcademicContent content={evalResult.whatWasRight} inline />
                </div>
              )}

              {/* Qué estuvo mal */}
              {evalResult.whatWasWrong && (
                <div style={{ fontSize: 14, color: "#f87171", marginBottom: 8, display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0 }}>❌</span>
                  <AcademicContent content={evalResult.whatWasWrong} inline />
                </div>
              )}

              {/* Respuesta correcta — solo cuando falló */}
              {showCorrectAnswer && correctAnswerDisplay && (
                <div style={{
                  padding: "12px 16px",
                  background: "rgba(16,185,129,0.08)",
                  border: "1px solid rgba(16,185,129,0.2)",
                  borderRadius: 10,
                  marginBottom: 14,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#6ee7b7", textTransform: "uppercase", marginBottom: 6 }}>
                    Respuesta correcta
                  </div>
                  <div style={{ fontSize: 15 }}>{correctAnswerDisplay}</div>
                </div>
              )}

              {/* Feedback / explicación */}
              <div style={{ fontSize: 15, color: "#e2e8f0", lineHeight: 1.65, marginBottom: 18 }}>
                <AcademicContent content={
                  !activeRecoveryId && !evalResult.correct && !isInvalid && pendingQuestions.length > 0
                    ? "Lo revisaremos al terminar este bloque de preguntas."
                    : evalResult.feedback || ""
                } />
              </div>

              {/* Hint si falló */}
              {showCorrectAnswer && currentQuestion.hint && (
                <div style={{ fontSize: 13, color: "#a78bfa", marginBottom: 14, fontStyle: "italic", display: "flex", gap: 6 }}>
                  <span>💡</span>
                  <AcademicContent content={currentQuestion.hint} inline />
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  data-testid="session-feedback-action"
                  onClick={handleFeedbackNext}
                  disabled={evalLoading}
                  style={{
                    padding: "14px 32px",
                    background: isInvalid ? "#f59e0b" : isCorrect ? "#10b981" : "#ef4444",
                    color: "white", border: "none", borderRadius: 10,
                    fontSize: 15, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  {feedbackActionLabel}
                </button>
              </div>
            </div>
          )
        })()}

        {/* RETEACHING */}
        {sessionPhase === "reteaching" && (
          <div style={{ background: "rgba(30,41,59,0.8)", border: "1px solid #f59e0b", borderRadius: 16, padding: 28, marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24", textTransform: "uppercase" }}>📖 Reexplicación</div>
              {activeRecoveryId && <div style={{ fontSize: 12, color: "#fbbf24", opacity: 0.8 }}>{(() => {
                const active = recoveryQueue.find(item => item.recoveryId === activeRecoveryId)
                const round = Math.max(1, active?.verificationRound || active?.reteachAttempt || 1)
                const errorIndex = recoveryQueue.findIndex(item => item.recoveryId === activeRecoveryId) + 1
                return recoveryQueue.length > 1 ? `Ronda ${round} · Error ${errorIndex} de ${recoveryQueue.length}` : `Recuperación · Ronda ${round}`
              })()}</div>}
            </div>
            {currentQuestion && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: "#fde68a", marginBottom: 6, fontWeight: 600 }}>
                  Concepto: <AcademicContent content={currentQuestion.conceptLabel} inline />
                </div>
                <div style={{
                  padding: "10px 14px",
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  borderRadius: 8,
                  fontSize: 13, color: "#94a3b8",
                }}>
                  <span style={{ fontWeight: 600, color: "#f87171" }}>Pregunta que falló: </span>
                  <AcademicContent content={currentQuestion.questionText} inline />
                </div>
              </div>
            )}
            {evalLoading && !reteachingContent && <div style={{ fontSize: 15, opacity: 0.8 }}>Preparando una nueva explicación...</div>}
            {!evalLoading && reteachingContent && <div style={{ fontSize: 16, color: "#e2e8f0", lineHeight: 1.7, marginBottom: 24 }}><AcademicContent content={reteachingContent} /></div>}
            {!evalLoading && !reteachingContent && evalError && <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 18 }}>{evalError}</div>}
            {!evalLoading && <div style={{ display: "flex", justifyContent: "flex-end" }}>
              {reteachingContent
                ? <button onClick={handleReteachNext} style={{ padding: "14px 32px", background: "#f59e0b", color: "#451a03", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Verificar comprensión →</button>
                : <button onClick={() => {
                    const active = recoveryQueue.find(item => item.recoveryId === activeRecoveryId)
                    if (active) void startRecoveryReteach(recoveryQueue, active.recoveryId)
                  }} style={{ padding: "14px 32px", background: "#f59e0b", color: "#451a03", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Reintentar explicación →</button>}
            </div>}
          </div>
        )}

      </div>

      {/* OBJETIVO A: ni el botón flotante ni el panel de diálogo existen en
          el DOM mientras isIndependentEvaluationActive() es true — no es un
          ocultamiento visual (CSS/disabled), el componente completo se deja
          de montar. disclaimerVisible queda en false porque, con este gate,
          el componente nunca se monta en el único momento en que antes
          valía true (evaluando con pregunta activa) — dejarlo calculado
          sería lógica muerta. */}
      {!isIndependentEvaluationActive() && (
        <AlaiSessionChat
          isOpen={chatOpen}
          onOpen={() => setChatOpen(true)}
          onClose={() => setChatOpen(false)}
          messages={chatMessages}
          onSendMessage={handleSendChatMessage}
          isSending={chatSending}
          disclaimerVisible={false}
          onReferenceClick={handleChatReferenceClick}
          taughtStepIds={(classContent?.steps || []).slice(0, currentStepIndex + 1).map(step => step.id)}
        />
      )}
    </div>
  )
}
