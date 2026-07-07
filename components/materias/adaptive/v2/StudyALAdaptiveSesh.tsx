'use client'

// ═══════════════════════════════════════════════════════════════
// StudyALAdaptiveSesh
// 
// La sesión adaptativa real de StudyAL v2.
// Usa Teacher Brain + Content Generator.
// Reemplaza completamente al AdaptiveSessionView viejo.
// ═══════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { AdaptiveSession } from '../../../../lib/adaptive'
import type {
  StudentModel,
  MaterialIntelligence,
  SessionBlueprint,
  BookPage,
  TopicNode,
} from '../../../../lib/adaptive/v2/types'
import {
  buildInitialStudentModel,
  buildInitialPedagogicalState,
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

type Phase = 'loading' | 'ready' | 'evaluating' | 'closing' | 'error'

export default function StudyALAdaptiveSesh({
  session, materialContent, masteryContext,
  onSessionComplete, onClose,
}: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [loadingMsg, setLoadingMsg] = useState('ALAI está preparando la sesión...')
  const [errorMsg, setErrorMsg] = useState('')

  const [student, setStudent] = useState<StudentModel | null>(null)
  const [material, setMaterial] = useState<MaterialIntelligence | null>(null)
  const [sessionBlueprint, setSessionBlueprint] = useState<SessionBlueprint | null>(null)
  const [pedagogicalState, setPedagogicalState] = useState<any>(null)
  const [microConcepts, setMicroConcepts] = useState<Record<string, any[]>>({})

  const [currentPage, setCurrentPage] = useState<BookPage | null>(null)
  const [pagesShown, setPagesShown] = useState<BookPage[]>([])
  const [lastEvaluation, setLastEvaluation] = useState<any>(null)
  const [showEvaluation, setShowEvaluation] = useState(false)
  const [conceptsMastered, setConceptsMastered] = useState<string[]>([])

  // Debug info visible
  const [teacherReasoning, setTeacherReasoning] = useState('')

  const hasStarted = useRef(false)
  const stateRef = useRef<any>(null)
  useEffect(() => {
    stateRef.current = { pedagogicalState, pagesShown, microConcepts }
  }, [pedagogicalState, pagesShown, microConcepts])

  // ═══════════════════════════════════════════════════════════
  // INICIALIZACIÓN
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true
    initSession()
  }, [])

  const initSession = async () => {
    setPhase('loading')
    setLoadingMsg('ALAI está preparando tu sesión...')

    try {
      // Construir student
      const profile = masteryContext?.userProfile || {}
      const setup = masteryContext?.setup || {
        initialKnowledgeLevel: 'some', sessionLength: 'medium',
        targetScore: 80, examDate: 'in_1_week',
      }
      const studentModel = buildInitialStudentModel(profile, setup)
      setStudent(studentModel)

      // Obtener material intelligence
      let materialIntel: MaterialIntelligence | null =
        masteryContext?.materialAnalysis || masteryContext?.materialIntelligenceV2 || null

      if (!materialIntel) {
        // Convertir desde blueprint viejo si es necesario
        materialIntel = buildFromLegacy(session, materialContent, masteryContext)
      }
      setMaterial(materialIntel)

      // Blueprint
      const blueprint: SessionBlueprint = {
        sessionId: session.id || 'sess_' + Date.now(),
        sessionNumber: session.sessionNumber || 1,
        mission: session.objective || 'Dominar los conceptos',
        targetTopics: materialIntel.topics.map(t => t.id),
        estimatedMinutes: session.estimatedMinutes || 20,
        learningObjectives: [],
        sessionKind: 'first_contact',
        createdAt: Date.now(),
        status: 'in_progress',
      }
      setSessionBlueprint(blueprint)

      // Estado inicial
      const initialState = {
        ...buildInitialPedagogicalState(blueprint.sessionId),
        currentTopicId: blueprint.targetTopics[0],
        currentTopicTitle: materialIntel.topics.find(t => t.id === blueprint.targetTopics[0])?.title || '',
        currentTopicStartedAt: Date.now(),
        conversationHistory: [],
        topicsCoveredThisSession: [],
      }
      setPedagogicalState(initialState)

      // Primera llamada al tutor
      await callTutor(initialState, studentModel, materialIntel, blueprint, [], {}, undefined)

    } catch (err: any) {
      console.error('[StudyALAdaptiveSesh] init:', err.message)
      setErrorMsg(err.message)
      setPhase('error')
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LLAMAR AL TUTOR
  // ═══════════════════════════════════════════════════════════
  const callTutor = async (
    state: any,
    studentM: StudentModel,
    materialI: MaterialIntelligence,
    blueprint: SessionBlueprint,
    pages: BookPage[],
    micros: Record<string, any[]>,
    lastResponse: any,
  ) => {
    try {
      const res = await fetch('/api/adaptive/v2/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state, student: studentM, material: materialI,
          sessionBlueprint: blueprint,
          sessionHistory: { pagesShown: pages },
          lastResponse,
          microConcepts: micros,
        }),
      })

      if (!res.ok) throw new Error(`tutor ${res.status}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Error del tutor')

      // Procesar respuesta
      if (data.evaluation) {
        setLastEvaluation(data.evaluation)
        setShowEvaluation(true)
      } else {
        setLastEvaluation(null)
        setShowEvaluation(false)
      }

      if (data.teacherDecision) {
        setTeacherReasoning(data.teacherDecision.reasoning || '')
        console.log(`[Teacher] ${data.teacherDecision.need} — ${data.teacherDecision.reasoning}`)
      }

      if (data.page) {
        setCurrentPage(data.page)
        setPagesShown(prev => [...prev, data.page])
      }

      if (data.updatedState) setPedagogicalState(data.updatedState)
      if (data.microConcepts) setMicroConcepts(data.microConcepts)

      // Trackear conceptos dominados
      if (data.microConcepts) {
        const mastered: string[] = []
        Object.values(data.microConcepts as any).forEach((micros: any) => {
          micros.forEach((m: any) => {
            if (['mastered', 'applied'].includes(m.state)) {
              mastered.push(m.name)
            }
          })
        })
        setConceptsMastered(mastered)
      }

      if (data.shouldCloseSession) {
        setTimeout(() => closeSession(), 3000)
      } else {
        setPhase('ready')
      }

    } catch (err: any) {
      console.error('[callTutor]', err.message)
      setErrorMsg(err.message)
      setPhase('error')
    }
  }

  // ═══════════════════════════════════════════════════════════
  // MANEJAR RESPUESTA
  // ═══════════════════════════════════════════════════════════
  const handleAnswer = async (answer: any, confidence?: string, responseTime?: number) => {
    if (!currentPage || !pedagogicalState || !student || !material || !sessionBlueprint) return
    if (phase === 'evaluating') return

    setPhase('evaluating')
    setLoadingMsg('ALAI está pensando...')

    const lastResponse = {
      interactionId: currentPage.interaction?.id || 'unknown',
      studentAnswer: answer,
      responseTimeSeconds: responseTime || 30,
      confidence: confidence || 'medium',
    }

    await callTutor(
      pedagogicalState, student, material, sessionBlueprint,
      pagesShown, microConcepts, lastResponse,
    )
  }

  const handleContinue = async () => {
    if (!pedagogicalState || !student || !material || !sessionBlueprint) return
    if (phase === 'evaluating') return

    setPhase('evaluating')
    setShowEvaluation(false)
    setLoadingMsg('Preparando siguiente paso...')

    await callTutor(
      pedagogicalState, student, material, sessionBlueprint,
      pagesShown, microConcepts, undefined,
    )
  }

  const closeSession = () => {
    setPhase('closing')

    // Calcular resultados basados en microconceptos
    let totalMicros = 0
    let masteredMicros = 0
    Object.values(microConcepts).forEach(micros => {
      micros.forEach((m: any) => {
        totalMicros++
        if (['mastered', 'applied', 'understood'].includes(m.state)) masteredMicros++
      })
    })

    const successRate = totalMicros > 0 ? (masteredMicros / totalMicros) : 0
    const domainGain = Math.round(successRate * (session.expectedDomainGain || 20))

    setTimeout(() => {
      onSessionComplete({
        domainGain,
        conceptsImproved: conceptsMastered,
        stepResults: pagesShown.map(p => ({
          stepId: p.id,
          score: 80,
          correct: true,
        })),
      })
    }, 2000)
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  if (phase === 'loading') {
    return (
      <div style={overlayStyle}>
        <div style={{ fontSize: 52, animation: 'pulse 1.5s ease-in-out infinite' }}>📖</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#f5e6b8', marginTop: 20, textAlign: 'center', maxWidth: 400 }}>
          {loadingMsg}
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
        <div style={{ fontSize: 13, color: '#a8854a', marginBottom: 24, maxWidth: 400, textAlign: 'center' }}>{errorMsg}</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => { hasStarted.current = false; initSession() }} style={btnGold}>🔄 Reintentar</button>
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

  // Contar micros dominados
  const totalMicros = Object.values(microConcepts).reduce((sum, arr) => sum + arr.length, 0)
  const dominadosMicros = Object.values(microConcepts).reduce((sum, arr) =>
    sum + arr.filter((m: any) => ['mastered', 'applied', 'understood'].includes(m.state)).length, 0
  )
  const progressPct = totalMicros > 0 ? Math.round((dominadosMicros / totalMicros) * 100) : 0

  return (
    <div style={overlayStyle}>
      <button onClick={onClose} style={{
        position: 'absolute', top: 20, left: 24,
        background: 'rgba(214,178,111,0.08)', border: '1px solid rgba(214,178,111,0.3)',
        color: 'rgba(214,178,111,0.9)', padding: '8px 16px', borderRadius: 999,
        fontSize: 11, cursor: 'pointer', letterSpacing: 1.5,
        fontFamily: 'Georgia, serif', zIndex: 200,
      }}>← VOLVER AL LIBRO</button>

      {/* Barra de progreso */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'rgba(214,178,111,0.15)' }}>
        <div style={{
          height: '100%', width: `${progressPct}%`,
          background: 'linear-gradient(90deg, #d6b26f, #a8854a)',
          transition: 'width .5s ease',
        }} />
      </div>

      <div style={bookCardStyle}>
        {/* Header */}
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
              {pedagogicalState?.currentTopicTitle || session.title}
            </div>
          </div>
          <div style={{
            padding: '4px 10px', borderRadius: 999,
            background: 'rgba(90,138,58,.15)',
            fontSize: 10, fontWeight: 700, color: '#3a5a1e', letterSpacing: 0.5,
          }}>
            {dominadosMicros}/{totalMicros} dominados
          </div>
        </div>

        {/* Razonamiento del tutor (debug visible) */}
        {teacherReasoning && (
          <div style={{
            padding: '8px 12px', marginBottom: 12,
            background: 'rgba(214,178,111,.06)', borderLeft: '2px solid rgba(214,178,111,.3)',
            fontSize: 11, color: 'rgba(58,46,31,.55)', fontStyle: 'italic',
          }}>
            💭 {teacherReasoning}
          </div>
        )}

        {/* Feedback de evaluación */}
        {showEvaluation && lastEvaluation && (
          <div style={{
            padding: '14px 16px', marginBottom: 16,
            background: lastEvaluation.outcome === 'correct' ? 'rgba(90,138,58,.08)' :
              lastEvaluation.outcome === 'partial' ? 'rgba(214,178,111,.08)' :
              'rgba(139,26,26,.08)',
            borderLeft: `4px solid ${lastEvaluation.outcome === 'correct' ? '#5a8a3a' :
              lastEvaluation.outcome === 'partial' ? '#d6b26f' : '#8b1a1a'}`,
            borderRadius: 6,
          }}>
            <div style={{
              fontSize: 12, fontWeight: 800, letterSpacing: 0.5, marginBottom: 8,
              color: lastEvaluation.outcome === 'correct' ? '#3a5a1e' :
                lastEvaluation.outcome === 'partial' ? '#a8854a' : '#8b1a1a',
            }}>
              {lastEvaluation.outcome === 'correct' ? '✓ CORRECTO' :
                lastEvaluation.outcome === 'partial' ? '◐ CASI' : '✗ INCORRECTO'}
              <span style={{ marginLeft: 10, opacity: 0.7, fontWeight: 600 }}>
                {lastEvaluation.score}/100
              </span>
            </div>

            {lastEvaluation.whatWasCorrect && (
              <div style={{ fontSize: 12.5, color: '#3a2e1f', marginBottom: 6, lineHeight: 1.5 }}>
                <strong>Bien:</strong> {lastEvaluation.whatWasCorrect}
              </div>
            )}
            {lastEvaluation.whatWasMissing && (
              <div style={{ fontSize: 12.5, color: '#3a2e1f', marginBottom: 6, lineHeight: 1.5 }}>
                <strong>Faltó:</strong> {lastEvaluation.whatWasMissing}
              </div>
            )}
            {lastEvaluation.correctAnswer && lastEvaluation.outcome !== 'correct' && (
              <div style={{
                padding: '10px 12px', marginTop: 8,
                background: 'rgba(214,178,111,.1)', borderRadius: 4,
                fontSize: 12.5, color: '#3a2e1f', lineHeight: 1.5,
              }}>
                <div style={{ fontSize: 9, letterSpacing: 1.5, color: '#a8854a', fontWeight: 700, marginBottom: 4 }}>
                  ✦ RESPUESTA CORRECTA
                </div>
                {lastEvaluation.correctAnswer}
              </div>
            )}
          </div>
        )}

        {phase === 'evaluating' && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📖</div>
            <div style={{ fontSize: 13, color: 'rgba(58,46,31,.6)', fontStyle: 'italic' }}>
              {loadingMsg}
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
// FALLBACK: construir MaterialIntelligence desde legacy
// ═══════════════════════════════════════════════════════════════
function buildFromLegacy(session: any, materialContent: string, masteryContext: any): MaterialIntelligence {
  const blueprint = masteryContext?.materialBlueprint
  if (blueprint?.topics) {
    return {
      materialId: blueprint.materialId || 'mat_legacy',
      materialTitle: blueprint.materialTitle || 'Material',
      subjectArea: blueprint.subjectArea || 'general',
      difficultyLevel: 'intermediate',
      topics: blueprint.topics.map((t: any, i: number) => ({
        id: t.id || `t_${i}`,
        title: t.title,
        rawText: materialContent.slice(i * 800, (i + 1) * 800 + 500) || t.title,
        keyFacts: (t.concepts || []).map((c: any) => c.name || c),
        keyIdeas: [],
        topicType: 'conceptual' as const,
        cognitiveLoad: 'medium' as const,
        prerequisites: [],
        relatedTopics: [],
        subtopics: [],
        formulaIds: [], procedureIds: [], exampleIds: [], mistakeIds: [],
        learningObjectives: [`Aprender sobre ${t.title}`],
        importance: 'high' as const,
        estimatedMinutes: 8,
      })),
      formulas: [], procedures: [], keyExamples: [], commonMistakes: [],
      totalPages: 1,
      analyzedAt: Date.now(),
    }
  }

  // Fallback mínimo
  return {
    materialId: 'mat_min',
    materialTitle: session.title || 'Material',
    subjectArea: 'general',
    difficultyLevel: 'intermediate',
    topics: [{
      id: 't_1',
      title: session.topicTitle || session.title,
      rawText: materialContent.slice(0, 2000),
      keyFacts: session.targetConcepts || [],
      keyIdeas: [],
      topicType: 'conceptual' as const,
      cognitiveLoad: 'medium' as const,
      prerequisites: [], relatedTopics: [], subtopics: [],
      formulaIds: [], procedureIds: [], exampleIds: [], mistakeIds: [],
      learningObjectives: [`Aprender sobre ${session.topicTitle || session.title}`],
      importance: 'high' as const,
      estimatedMinutes: 8,
    }],
    formulas: [], procedures: [], keyExamples: [], commonMistakes: [],
    totalPages: 1,
    analyzedAt: Date.now(),
  }
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
