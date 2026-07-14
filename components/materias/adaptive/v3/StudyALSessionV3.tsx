'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { AdaptiveSession } from '../../../../lib/adaptive'
import PaginatedBookPage from './PaginatedBookPage'
import AskWidget from './AskWidget'

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
  }) => void
  onClose: () => void
}

type Phase = 'building_graph' | 'loading' | 'ready' | 'evaluating' | 'closing' | 'error'

export default function StudyALSessionV3({
  session, materialContent, masteryContext,
  onSessionComplete, onClose,
}: Props) {
  const [phase, setPhase] = useState<Phase>('building_graph')
  const [loadingMsg, setLoadingMsg] = useState('Preparando la sesión...')
  const [errorMsg, setErrorMsg] = useState('')

  const [sessionId, setSessionId] = useState<string | null>(session.id || null)
  const [currentPage, setCurrentPage] = useState<any>(null)
  const [lastEvaluation, setLastEvaluation] = useState<any>(null)
  const [sessionSummary, setSessionSummary] = useState<any>(null)
  const [systemInfo, setSystemInfo] = useState<any>(null)
  const [showEvaluation, setShowEvaluation] = useState(false)
  const [conceptsMastered, setConceptsMastered] = useState<string[]>([])
  const [coveragePercent, setCoveragePercent] = useState(0)
  const [lastCoverageReport, setLastCoverageReport] = useState<any>(null)
  const [pendingNextPage, setPendingNextPage] = useState<any>(null)
  const [pendingSystemInfo, setPendingSystemInfo] = useState<any>(null)

  const hasStarted = useRef(false)
  const materialId = useRef<string>('')
  const userId = useRef<string>('')

  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true
    initSession()
  }, [])

  const initSession = async () => {
    setPhase('building_graph')
    setLoadingMsg('Construyendo el mapa de conocimiento del material...')

    try {
      const profile = masteryContext?.userProfile || {}
      userId.current = profile.userId || 'user_default'

      const material = masteryContext?.materials?.[0] || masteryContext?.material
      // FIX: usar materialId real del context (no session.id que cambia entre sesiones)
      // Orden de prioridad: materialId explícito > material.materialId > material.id > mat_default
      materialId.current = masteryContext?.materialId ||
        material?.materialId || material?.id || 'mat_default'

      const materialTitle = material?.nombre || material?.name ||
                            (masteryContext as any)?.materialTitle ||
                            session.title || 'Material'

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

      console.log(`[v3] Grafo listo: ${graphData.graph?.totalMicros} micros${graphData.fromCache ? ' (cache)' : ''}`)

      setPhase('loading')
      setLoadingMsg('Iniciando tu tutor...')

      const setup = masteryContext?.setup || {}
      const targetMinutes = setup.sessionLength === 'short' ? 12 :
                            setup.sessionLength === 'long' ? 35 : 20

      await callTutor(undefined, undefined, targetMinutes, profile)

    } catch (err: any) {
      console.error('[v3] init error:', err.message)
      setErrorMsg(err.message)
      setPhase('error')
    }
  }

  const callTutor = async (
    currentSessionId?: string,
    studentAnswer?: any,
    targetMinutes: number = 20,
    profile?: any,
  ) => {
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
          evalPreference: setup.evalPreference || 'mix_everything',
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
        }),
      })

      if (!res.ok) throw new Error(`tutor ${res.status}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Error del tutor')

      if (data.sessionId) setSessionId(data.sessionId)

      // Siempre preparar la siguiente página
      const nextPage = data.page ? {
        id: 'page_' + Date.now(),
        pageType: data.page.type || 'theory',
        title: data.page.title,
        content: data.page.content || { blocks: [] },
        interaction: data.page.interaction,
        topicId: data.systemInfo?.microId || '',
        createdAt: Date.now(),
      } : null

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
        setLastEvaluation(data.evaluation)
        setShowEvaluation(true)

        if (data.evaluation.outcome === 'correct' && data.systemInfo?.activeMicro) {
          setConceptsMastered(prev =>
            prev.includes(data.systemInfo.activeMicro) ? prev : [...prev, data.systemInfo.activeMicro]
          )
        }

        // Guardar la siguiente página Y systemInfo para mostrar después del feedback
        if (nextPage) setPendingNextPage(nextPage)
        if (data.systemInfo) setPendingSystemInfo(data.systemInfo)
      } else {
        setLastEvaluation(null)
        setShowEvaluation(false)
        setSystemInfo(data.systemInfo)
        if (nextPage) setCurrentPage(nextPage)
      }

      if (data.shouldCloseSession) {
        // Guardar el summary del backend (contiene microsCompleted/Total reales)
        if (data.summary) setSessionSummary(data.summary)
        // NO cerrar automáticamente. Que el usuario haga clic en el botón.
        setPhase('closing')
      } else {
        setPhase('ready')
      }
    } catch (err: any) {
      console.error('[v3 callTutor]', err.message)
      setErrorMsg(err.message)
      setPhase('error')
    }
  }

  const handleAnswer = async (answer: any) => {
    if (phase === 'evaluating') return
    setPhase('evaluating')
    setLastEvaluation(null)  // Limpiar feedback anterior antes de evaluar nuevo
    setLoadingMsg('ALAI está evaluando...')
    await callTutor(sessionId || undefined, answer)
  }

  const handleContinue = async () => {
    if (phase === 'evaluating') return

    // Si hay página pendiente del feedback anterior, mostrarla SIN llamar al tutor
    if (pendingNextPage) {
      setShowEvaluation(false)
      setLastEvaluation(null)
      setCurrentPage(pendingNextPage)
      if (pendingSystemInfo) setSystemInfo(pendingSystemInfo)
      setPendingNextPage(null)
      setPendingSystemInfo(null)
      setPhase('ready')
      return
    }

    // Si no hay página pendiente, pedir siguiente al tutor
    setPhase('evaluating')
    setShowEvaluation(false)
    setLastEvaluation(null)
    setLoadingMsg('Preparando siguiente paso...')
    await callTutor(sessionId || undefined)
  }

  const closeSession = () => {
    setPhase('closing')
    setTimeout(() => {
      onSessionComplete({
        domainGain: Math.min(100, (systemInfo?.progress || 0)),
        conceptsImproved: conceptsMastered,
        stepResults: [],
        materialCoveragePercent: lastCoverageReport?.materialCoveragePercent ?? coveragePercent,
        masteryPercent: lastCoverageReport?.overallCoverage ?? Math.min(100, (systemInfo?.progress || 0)),
        studiedMicros: lastCoverageReport?.studiedMicros ?? 0,
        totalMicros: lastCoverageReport?.totalMicros ?? 0,
        weakMicroIds: Array.isArray(lastCoverageReport?.weakMicros) ? lastCoverageReport.weakMicros.map((m: any) => m.microId) : [],
        weakMicroNames: Array.isArray(lastCoverageReport?.weakMicros) ? lastCoverageReport.weakMicros.map((m: any) => m.microName) : [],
      })
    }, 2000)
  }

  if (phase === 'building_graph' || phase === 'loading') {
    return (
      <div style={overlayStyle}>
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
      <div style={overlayStyle}>
        <div style={bookCardStyle}>
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
          {conceptsMastered.length > 0 && (
            <div style={{
              padding: '14px 16px',
              background: 'rgba(90,138,58,.08)',
              borderLeft: '4px solid #5a8a3a',
              borderRadius: 6, marginBottom: 14,
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: '#5a8a3a', marginBottom: 8 }}>
                HOY APRENDISTE
              </div>
              {conceptsMastered.map((c, i) => (
                <div key={i} style={{ fontSize: 13, color: '#3a2e1f', marginBottom: 3 }}>
                  ✓ {c}
                </div>
              ))}
            </div>
          )}

          {/* Botón */}
          <button
            onClick={() => {
              onSessionComplete({
                domainGain: Math.min(100, systemInfo?.progress || 0),
                conceptsImproved: conceptsMastered,
                stepResults: [],
                materialCoveragePercent: lastCoverageReport?.materialCoveragePercent ?? coveragePercent,
                masteryPercent: lastCoverageReport?.overallCoverage ?? Math.min(100, systemInfo?.progress || 0),
                studiedMicros: lastCoverageReport?.studiedMicros ?? 0,
                totalMicros: lastCoverageReport?.totalMicros ?? 0,
                weakMicroIds: Array.isArray(lastCoverageReport?.weakMicros) ? lastCoverageReport.weakMicros.map((m: any) => m.microId) : [],
                weakMicroNames: Array.isArray(lastCoverageReport?.weakMicros) ? lastCoverageReport.weakMicros.map((m: any) => m.microName) : [],
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

  return (
    <div style={overlayStyle}>
      <button onClick={onClose} style={{
        position: 'absolute', top: 20, left: 24,
        background: 'rgba(214,178,111,0.08)', border: '1px solid rgba(214,178,111,0.3)',
        color: 'rgba(214,178,111,0.9)', padding: '8px 16px', borderRadius: 999,
        fontSize: 11, cursor: 'pointer', letterSpacing: 1.5,
        fontFamily: 'Georgia, serif', zIndex: 200,
      }}>← VOLVER AL LIBRO</button>

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
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 1.2,
                color: '#a8854a', marginBottom: 6, textTransform: 'uppercase',
              }}>
                {session.title ? `${session.title} · ` : ''}
                Esta sesión: {systemInfo.microsCompleted || 0}/{systemInfo.microsTotal || '?'} conceptos · Material {coveragePercent}%
              </div>
            )}
            <div style={{ fontSize: 24, fontWeight: 800, color: '#2a1f14', lineHeight: 1.2 }}>
              {systemInfo?.activeMicro || session.title}
            </div>
          </div>
          {systemInfo && (
            <div style={{
              padding: '6px 14px', borderRadius: 999,
              background: 'rgba(214,178,111,.15)',
              fontSize: 13, fontWeight: 700, color: '#a8854a',
            }}>
              {systemInfo.microsCompleted}/{systemInfo.microsTotal} sesión
            </div>
          )}
        </div>

        {/* Razonamiento del motor oculto en producción */}

        {/* Feedback movido a PaginatedBookPage — inline debajo de la pregunta */}

        {phase === 'evaluating' && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📖</div>
            <div style={{ fontSize: 13, color: 'rgba(58,46,31,.6)', fontStyle: 'italic' }}>
              {loadingMsg}
            </div>
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
        {phase === 'ready' && currentPage && (
          <PaginatedBookPage
            page={currentPage}
            onSubmitAnswer={handleAnswer}
            onContinue={handleContinue}
            disabled={false}
            evaluation={showEvaluation && lastEvaluation ? lastEvaluation : null}
          />
        )}
      </div>

      <button onClick={() => { if (confirm('¿Terminar sesión ahora?')) closeSession() }}
        style={{
          position: 'fixed', bottom: 16, right: 16, zIndex: 9999,
          background: 'rgba(42,31,20,.06)',
          border: '1px solid rgba(42,31,20,.15)',
          color: 'rgba(42,31,20,.4)', padding: '8px 14px',
          borderRadius: 8, fontSize: 11, fontWeight: 600,
          cursor: 'pointer',
        }}>
        Terminar
      </button>
    </div>
  )
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
        {profile?.masteryScore || 0}%
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
  overflow: 'hidden',
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
