'use client'

// ═══════════════════════════════════════════════════════════════
// AdaptiveSessionV2View
// 
// Sesión adaptativa conectada al cerebro pedagógico v2.
// Cada interacción llama a /api/adaptive/v2/decide-next
// que decide qué mostrar siguiente.
// ═══════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { AdaptiveSession } from '../../../../lib/adaptive'
import type {
  StudentModel,
  MaterialIntelligence,
  PedagogicalState,
  SessionBlueprint,
  StudyGoal,
  BookPage,
  EvidenceRecord,
  TopicMastery,
  TopicNode,
} from '../../../../lib/adaptive/v2/types'
import {
  buildInitialStudentModel,
  buildInitialPedagogicalState,
  buildStudyGoal,
} from '../../../../lib/adaptive/v2/contracts'
import AdaptiveBookPage from './AdaptiveBookPage'

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

type SessionPhase = 'loading' | 'ready' | 'answering' | 'evaluating' | 'closing' | 'error'

export default function AdaptiveSessionV2View({
  session,
  materialContent,
  masteryContext,
  onSessionComplete,
  onClose,
}: Props) {
  // ── Estado principal ──────────────────────────────────────
  const [phase, setPhase] = useState<SessionPhase>('loading')
  const [loadingMessage, setLoadingMessage] = useState('ALAI está preparando tu sesión...')
  const [errorMessage, setErrorMessage] = useState('')

  // ── Estado v2 ─────────────────────────────────────────────
  const [student, setStudent] = useState<StudentModel | null>(null)
  const [material, setMaterial] = useState<MaterialIntelligence | null>(null)
  const [sessionBlueprint, setSessionBlueprint] = useState<SessionBlueprint | null>(null)
  const [goal, setGoal] = useState<StudyGoal | null>(null)
  const [pedagogicalState, setPedagogicalState] = useState<PedagogicalState | null>(null)

  // ── Historial de sesión ───────────────────────────────────
  const [currentPage, setCurrentPage] = useState<BookPage | null>(null)
  const [pagesShown, setPagesShown] = useState<BookPage[]>([])
  const [evidenceCollected, setEvidenceCollected] = useState<EvidenceRecord[]>([])
  const [interactionsCompleted, setInteractionsCompleted] = useState(0)
  const [lastEvaluation, setLastEvaluation] = useState<any>(null)
  const [showEvaluation, setShowEvaluation] = useState(false)
  const [masteryByTopic, setMasteryByTopic] = useState<Record<string, TopicMastery>>({})

  // ── Refs ──────────────────────────────────────────────────
  const hasStarted = useRef(false)
  const stateRef = useRef<any>(null)
  useEffect(() => {
    stateRef.current = { pedagogicalState, pagesShown, evidenceCollected, interactionsCompleted }
  }, [pedagogicalState, pagesShown, evidenceCollected, interactionsCompleted])

  // ═══════════════════════════════════════════════════════════
  // INICIALIZACIÓN
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true
    initializeSession()
  }, [])

  const initializeSession = async () => {
    setPhase('loading')
    setLoadingMessage('ALAI está analizando el material y preparando tu sesión...')

    try {
      // 1. Construir StudentModel desde el contexto existente
      const profile = masteryContext?.userProfile || {}
      const setup = masteryContext?.setup || {
        initialKnowledgeLevel: 'some',
        sessionLength: 'medium',
        targetScore: 80,
        examDate: 'in_1_week',
      }
      const studentModel = buildInitialStudentModel(profile, setup)
      setStudent(studentModel)

      // 2. Construir StudyGoal
      const studyGoal = buildStudyGoal(setup)
      setGoal(studyGoal)

      // 3. Obtener/construir MaterialIntelligence
      let materialIntel: MaterialIntelligence | null = 
        masteryContext?.materialIntelligenceV2 || null

      if (!materialIntel) {
        // Intentar convertir el análisis existente al formato v2
        const analysis = masteryContext?.materialAnalysis
        if (analysis?.totalCoverageUnits) {
          materialIntel = convertAnalysisToIntelligence(analysis, session)
        } else {
          // Construir mínimo desde la sesión
          materialIntel = buildMinimalIntelligence(session, materialContent)
        }
      }
      setMaterial(materialIntel)

      // 4. Construir SessionBlueprint
      const blueprint = buildSessionBlueprint(session, materialIntel)
      setSessionBlueprint(blueprint)

      // 5. Construir estado pedagógico inicial
      const initialState: PedagogicalState = {
        ...buildInitialPedagogicalState(session.id || 'sess_' + Date.now()),
        currentTopicId: blueprint.targetTopics[0],
        currentTopicTitle: materialIntel.topics.find(t => t.id === blueprint.targetTopics[0])?.title || '',
        topicsRemaining: blueprint.targetTopics.slice(1),
      }
      setPedagogicalState(initialState)

      // 6. Llamar al cerebro para la primera página
      await callBrain(
        initialState,
        studentModel,
        materialIntel,
        blueprint,
        studyGoal,
        [],
        [],
        undefined,
      )

    } catch (err: any) {
      console.error('[initializeSession]', err.message)
      setErrorMessage(err.message)
      setPhase('error')
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LLAMAR AL CEREBRO
  // ═══════════════════════════════════════════════════════════
  const callBrain = async (
    state: PedagogicalState,
    studentM: StudentModel,
    materialI: MaterialIntelligence,
    blueprint: SessionBlueprint,
    studyGoal: StudyGoal,
    pages: BookPage[],
    evidence: EvidenceRecord[],
    lastResponse: any,
  ) => {
    try {
      const res = await fetch('/api/adaptive/v2/decide-next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state,
          student: studentM,
          material: materialI,
          sessionBlueprint: blueprint,
          goal: studyGoal,
          sessionHistory: {
            pagesShown: pages,
            evidenceCollected: evidence,
            interactionsCompleted,
          },
          lastResponse,
        }),
      })

      if (!res.ok) throw new Error(`decide-next ${res.status}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Error del cerebro')

      // Procesar respuesta del cerebro
      if (data.evaluation) {
        setLastEvaluation(data.evaluation)
        setShowEvaluation(true)
        setEvidenceCollected(prev => [...prev, data.evaluation.evidenceRecord])
      }

      if (data.updatedMastery) {
        setMasteryByTopic(prev => ({
          ...prev,
          [data.updatedMastery.topicId]: data.updatedMastery,
        }))
      }

      if (data.decision?.page) {
        setCurrentPage(data.decision.page)
        setPagesShown(prev => [...prev, data.decision.page])
      }

      if (data.updatedState) {
        setPedagogicalState(data.updatedState)
      }

      if (data.shouldCloseSession) {
        setTimeout(() => closeSession(), 2500)
      } else {
        setPhase('ready')
      }

    } catch (err: any) {
      console.error('[callBrain]', err.message)
      setErrorMessage(err.message)
      setPhase('error')
    }
  }

  // ═══════════════════════════════════════════════════════════
  // MANEJAR RESPUESTA DEL ESTUDIANTE
  // ═══════════════════════════════════════════════════════════
  const handleAnswer = async (answer: any, confidence?: string, responseTime?: number) => {
    if (!currentPage || !pedagogicalState || !student || !material || !sessionBlueprint || !goal) return
    if (phase === 'evaluating') return

    setPhase('evaluating')
    setLoadingMessage('ALAI está analizando tu respuesta...')

    const lastResponse = {
      interactionId: currentPage.interaction?.id || 'unknown',
      studentAnswer: answer,
      responseTimeSeconds: responseTime || 30,
      confidence: confidence || 'medium',
    }

    setInteractionsCompleted(prev => prev + 1)

    await callBrain(
      pedagogicalState,
      student,
      material,
      sessionBlueprint,
      goal,
      pagesShown,
      evidenceCollected,
      lastResponse,
    )
  }

  // ═══════════════════════════════════════════════════════════
  // CONTINUAR (páginas sin interacción)
  // ═══════════════════════════════════════════════════════════
  const handleContinue = async () => {
    if (!pedagogicalState || !student || !material || !sessionBlueprint || !goal) return
    if (phase === 'evaluating') return

    setPhase('evaluating')
    setShowEvaluation(false)
    setLoadingMessage('Preparando siguiente paso...')

    await callBrain(
      pedagogicalState,
      student,
      material,
      sessionBlueprint,
      goal,
      pagesShown,
      evidenceCollected,
      undefined,
    )
  }

  // ═══════════════════════════════════════════════════════════
  // CERRAR SESIÓN
  // ═══════════════════════════════════════════════════════════
  const closeSession = () => {
    setPhase('closing')

    // Calcular resultados
    const totalScore = evidenceCollected.length > 0
      ? Math.round(evidenceCollected.reduce((s, e) => s + e.score, 0) / evidenceCollected.length)
      : 0

    const conceptsImproved = Object.values(masteryByTopic)
      .filter(m => m.overallMastery >= 70)
      .map(m => m.topicTitle)

    const domainGain = Math.round(totalScore * 0.4)

    onSessionComplete({
      domainGain,
      conceptsImproved,
      stepResults: evidenceCollected.map(e => ({
        stepId: e.id,
        score: e.score,
        correct: e.correct,
      })),
    })
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  if (phase === 'loading') {
    return (
      <div style={overlayStyle}>
        <div style={{ fontSize: 52, animation: 'pulse 1.5s ease-in-out infinite' }}>📖</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#f5e6b8', marginTop: 20, textAlign: 'center', maxWidth: 400 }}>
          {loadingMessage}
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.7;transform:scale(1.05)} }`}</style>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div style={overlayStyle}>
        <div style={{ fontSize: 44, marginBottom: 16 }}>😓</div>
        <div style={{ fontSize: 15, color: '#f5e6b8', marginBottom: 8 }}>Algo salió mal</div>
        <div style={{ fontSize: 13, color: '#a8854a', marginBottom: 24, maxWidth: 400, textAlign: 'center' }}>{errorMessage}</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => { hasStarted.current = false; initializeSession() }} style={btnGold}>🔄 Reintentar</button>
          <button onClick={onClose} style={btnOutline}>← Volver</button>
        </div>
      </div>
    )
  }

  if (phase === 'closing') {
    return (
      <div style={overlayStyle}>
        <div style={{ fontSize: 60, marginBottom: 20 }}>✨</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#d6b26f', fontFamily: 'Georgia, serif' }}>
          Sesión completada
        </div>
      </div>
    )
  }

  // Progreso visual
  const progressPct = sessionBlueprint
    ? Math.round((pedagogicalState?.topicsCoveredThisSession.length || 0) / sessionBlueprint.targetTopics.length * 100)
    : 0

  return (
    <div style={overlayStyle}>
      {/* Botón volver */}
      <button onClick={onClose} style={{
        position: 'absolute', top: 20, left: 24,
        background: 'rgba(214,178,111,0.08)', border: '1px solid rgba(214,178,111,0.3)',
        color: 'rgba(214,178,111,0.9)', padding: '8px 16px', borderRadius: 999,
        fontSize: 11, cursor: 'pointer', letterSpacing: 1.5,
        fontFamily: 'Georgia, serif', zIndex: 200,
      }}>← VOLVER AL LIBRO</button>

      {/* Barra progreso superior */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'rgba(214,178,111,0.15)' }}>
        <div style={{
          height: '100%',
          width: `${progressPct}%`,
          background: 'linear-gradient(90deg, #d6b26f, #a8854a)',
          transition: 'width .5s ease',
        }} />
      </div>

      {/* Contenedor principal — página del libro */}
      <div style={bookCardStyle}>
        {/* Header con topic actual + mastery */}
        <SessionHeader
          topicTitle={pedagogicalState?.currentTopicTitle || session.title}
          masteryByTopic={masteryByTopic}
          currentTopicId={pedagogicalState?.currentTopicId}
          interactionsCompleted={interactionsCompleted}
        />

        {/* Feedback de evaluación (si hubo respuesta) */}
        {showEvaluation && lastEvaluation && (
          <EvaluationFeedback
            evaluation={lastEvaluation}
            onDismiss={() => setShowEvaluation(false)}
          />
        )}

        {/* Página actual */}
        {phase === 'evaluating' && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📖</div>
            <div style={{ fontSize: 13, color: 'rgba(58,46,31,.6)', fontStyle: 'italic' }}>
              {loadingMessage}
            </div>
          </div>
        )}

        {phase === 'ready' && currentPage && (
          <AdaptiveBookPage
            page={currentPage}
            onSubmitAnswer={handleAnswer}
            onContinue={handleContinue}
            disabled={false}
          />
        )}
      </div>

      {/* Botón terminar */}
      <button onClick={() => { if (confirm('¿Terminar sesión ahora?')) closeSession() }}
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
          background: 'rgba(245,200,66,.15)',
          border: '1.5px solid rgba(245,200,66,.5)',
          color: '#f5c842', padding: '10px 18px',
          borderRadius: 12, fontSize: 13, fontWeight: 700,
          cursor: 'pointer', backdropFilter: 'blur(8px)',
        }}>
        ✓ Terminar sesión
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// SESSION HEADER
// ═══════════════════════════════════════════════════════════════
function SessionHeader({ topicTitle, masteryByTopic, currentTopicId, interactionsCompleted }: any) {
  const currentMastery = currentTopicId ? masteryByTopic[currentTopicId] : null
  const mastery = currentMastery?.overallMastery ?? 0

  const status = mastery >= 85 ? 'Dominado'
    : mastery >= 70 ? 'Bien'
    : mastery >= 50 ? 'En proceso'
    : mastery > 0 ? 'Empezando'
    : 'Sin evidencia'

  const statusColor = mastery >= 85 ? '#5a8a3a'
    : mastery >= 70 ? '#a8854a'
    : mastery >= 50 ? '#d6b26f'
    : mastery > 0 ? '#c66d3c'
    : '#8b7355'

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: 16, paddingBottom: 12,
      borderBottom: '1px solid rgba(58,46,31,.1)',
    }}>
      <div>
        <div style={{ fontSize: 10, letterSpacing: 2, color: 'rgba(58,46,31,.4)', fontWeight: 700, marginBottom: 4 }}>
          TOPIC ACTUAL
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#3a2e1f' }}>
          {topicTitle}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{
          padding: '4px 10px', borderRadius: 999,
          background: `${statusColor}20`,
          fontSize: 10, fontWeight: 700, color: statusColor, letterSpacing: 0.5,
        }}>
          {status}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(58,46,31,.4)' }}>
          {interactionsCompleted} respuestas
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// EVALUATION FEEDBACK
// ═══════════════════════════════════════════════════════════════
function EvaluationFeedback({ evaluation, onDismiss }: any) {
  const isCorrect = evaluation.correct
  const score = evaluation.score
  const feedback = evaluation.feedback || {}

  const bgColor = isCorrect ? 'rgba(90,138,58,.08)' : 'rgba(139,26,26,.08)'
  const borderColor = isCorrect ? '#5a8a3a' : '#8b1a1a'
  const iconColor = isCorrect ? '#3a5a1e' : '#8b1a1a'

  return (
    <div style={{
      padding: '14px 16px',
      background: bgColor,
      borderLeft: `4px solid ${borderColor}`,
      borderRadius: 6,
      marginBottom: 16,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 8,
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: iconColor, letterSpacing: 0.5 }}>
          {isCorrect ? '✓ CORRECTO' : '✗ INCORRECTO'}
          <span style={{ marginLeft: 10, opacity: 0.7, fontWeight: 600 }}>
            {score}/100
          </span>
        </div>
      </div>

      {feedback.whatWasCorrect && isCorrect && (
        <div style={{ fontSize: 12.5, color: '#3a2e1f', lineHeight: 1.5, marginBottom: 6 }}>
          <strong style={{ color: '#3a5a1e' }}>✓ </strong>
          {feedback.whatWasCorrect}
        </div>
      )}

      {feedback.whatWasMissing && !isCorrect && (
        <div style={{ fontSize: 12.5, color: '#3a2e1f', lineHeight: 1.5, marginBottom: 6 }}>
          <strong style={{ color: '#8b1a1a' }}>✗ </strong>
          {feedback.whatWasMissing}
        </div>
      )}

      {feedback.correctExplanation && (
        <div style={{
          padding: '10px 12px',
          background: 'rgba(214,178,111,.1)',
          borderLeft: '3px solid #d6b26f',
          borderRadius: 4,
          marginTop: 8,
          fontSize: 12.5, color: '#3a2e1f', lineHeight: 1.5,
        }}>
          <div style={{ fontSize: 9, letterSpacing: 1.5, color: '#a8854a', fontWeight: 700, marginBottom: 4 }}>
            ✦ EXPLICACIÓN CORRECTA
          </div>
          {feedback.correctExplanation}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// HELPERS: convertir análisis existente → MaterialIntelligence v2
// ═══════════════════════════════════════════════════════════════
function convertAnalysisToIntelligence(analysis: any, session: any): MaterialIntelligence {
  const topics: TopicNode[] = (analysis.totalCoverageUnits || []).map((u: any, i: number) => ({
    id: u.id || `t_${i}`,
    title: u.title || `Topic ${i + 1}`,
    rawText: u.rawTextReference || '',
    keyFacts: u.keyFacts || [],
    keyIdeas: [],
    topicType: mapKnowledgeTypeToTopicType(u.knowledgeType),
    cognitiveLoad: (u.importance === 'critical' ? 'heavy' : 'medium') as any,
    prerequisites: [],
    relatedTopics: [],
    subtopics: [],
    formulaIds: [],
    procedureIds: [],
    exampleIds: [],
    mistakeIds: [],
    learningObjectives: u.learningObjectives || [`Aprender sobre ${u.title}`],
    importance: u.importance || 'medium',
    estimatedMinutes: 8,
  }))

  return {
    materialId: session.id || 'material_v2',
    materialTitle: analysis.materialTitle || session.title || 'Material',
    subjectArea: analysis.subjectArea || 'general',
    difficultyLevel: analysis.difficultyLevel || 'intermediate',
    topics,
    formulas: [],
    procedures: [],
    keyExamples: [],
    commonMistakes: [],
    totalPages: topics.length,
    analyzedAt: Date.now(),
  }
}

function buildMinimalIntelligence(session: any, materialContent: string): MaterialIntelligence {
  const topics: TopicNode[] = (session.targetConcepts || [session.topicTitle || session.title])
    .filter(Boolean)
    .map((concept: string, i: number) => ({
      id: `t_${i}`,
      title: concept,
      rawText: materialContent.slice(i * 500, (i + 1) * 500 + 500) || concept,
      keyFacts: [],
      keyIdeas: [],
      topicType: 'conceptual' as const,
      cognitiveLoad: 'medium' as const,
      prerequisites: [],
      relatedTopics: [],
      subtopics: [],
      formulaIds: [],
      procedureIds: [],
      exampleIds: [],
      mistakeIds: [],
      learningObjectives: [`Aprender sobre ${concept}`],
      importance: 'high' as const,
      estimatedMinutes: 5,
    }))

  return {
    materialId: session.id || 'material_min',
    materialTitle: session.topicTitle || session.title || 'Material',
    subjectArea: 'general',
    difficultyLevel: 'intermediate',
    topics,
    formulas: [],
    procedures: [],
    keyExamples: [],
    commonMistakes: [],
    totalPages: topics.length,
    analyzedAt: Date.now(),
  }
}

function buildSessionBlueprint(session: any, material: MaterialIntelligence): SessionBlueprint {
  const targetIds = material.topics.map(t => t.id)

  return {
    sessionId: session.id || 'sess_' + Date.now(),
    sessionNumber: session.sessionNumber || 1,
    mission: session.objective || 'Dominar los conceptos de esta sesión',
    targetTopics: targetIds,
    estimatedMinutes: session.estimatedMinutes || 20,
    learningObjectives: material.topics.flatMap(t =>
      t.learningObjectives.map(obj => ({
        objective: obj,
        verificationCriteria: 'Responder correctamente ejercicios relacionados',
        priority: 'must_have' as const,
      }))
    ),
    sessionKind: 'first_contact',
    createdAt: Date.now(),
    status: 'in_progress',
  }
}

function mapKnowledgeTypeToTopicType(kt?: string): any {
  const map: Record<string, string> = {
    conceptual: 'conceptual',
    procedural: 'procedural',
    mathematical: 'mathematical',
    memorization: 'memorization',
    causal: 'causal',
    narrative: 'narrative',
    analysis: 'analytical',
    application: 'conceptual',
  }
  return map[kt || 'conceptual'] || 'conceptual'
}

// ═══════════════════════════════════════════════════════════════
// ESTILOS
// ═══════════════════════════════════════════════════════════════
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 100,
  background: 'radial-gradient(ellipse at center, #1a1410 0%, #0a0806 100%)',
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  padding: 24, overflow: 'auto',
  fontFamily: 'Georgia, serif',
}

const bookCardStyle: React.CSSProperties = {
  width: '100%', maxWidth: 720, minHeight: 480,
  background: 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)',
  borderRadius: 8, padding: '36px 48px',
  fontFamily: 'Georgia, serif', color: '#3a2e1f',
  boxShadow: '0 30px 80px rgba(0,0,0,.7)',
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
