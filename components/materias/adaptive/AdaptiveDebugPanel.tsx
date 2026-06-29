'use client'

// ═══════════════════════════════════════════════════════════════
// StudyAL — Adaptive Debug Panel
// Panel temporal para verificar que el sistema funciona.
// Solo visible en desarrollo. No afecta el flujo de producción.
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react'
import type { AdaptiveProgram } from '../../../lib/adaptive'

interface Props {
  program: AdaptiveProgram | null
  materialContent: string
  masteryState: any
  masterySnapshot: any
  materialBlueprint: any
  isBuildingBlueprint: boolean
  lastApiPayload?: Record<string, any> | null
  learningMemory?: any
}

function Badge({ label, value, color }: { label: string; value: string | number | boolean; color?: string }) {
  const c = color || (value === true ? '#4ade80' : value === false ? '#ef4444' : '#d6b26f')
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 999,
      border: `1px solid ${c}40`,
      background: `${c}12`,
      fontSize: 10,
      fontWeight: 800,
      color: c,
      marginRight: 4,
      marginBottom: 4,
    }}>
      <span style={{ color: `${c}80` }}>{label}:</span>
      <span>{String(value)}</span>
    </div>
  )
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderBottom: '1px solid #ffffff10', marginBottom: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          color: '#d6b26f',
          fontSize: 11,
          fontWeight: 800,
          padding: '8px 0',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          letterSpacing: 0.5,
        }}
      >
        {title}
        <span style={{ color: '#ffffff40' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ paddingBottom: 12 }}>
          {children}
        </div>
      )}
    </div>
  )
}

function JsonBlock({ data }: { data: any }) {
  return (
    <pre style={{
      fontSize: 9,
      color: '#ffffff80',
      background: '#00000030',
      padding: '8px 10px',
      borderRadius: 6,
      overflow: 'auto',
      maxHeight: 200,
      margin: '4px 0',
      lineHeight: 1.5,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
    }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

export default function AdaptiveDebugPanel({
  program,
  materialContent,
  masteryState,
  masterySnapshot,
  materialBlueprint,
  isBuildingBlueprint,
  lastApiPayload,
  learningMemory,
}: Props) {
  const [visible, setVisible] = useState(false)
  const [tab, setTab] = useState<'blueprint' | 'sessions' | 'mastery' | 'api' | 'obs'>('blueprint')

  const blueprint = materialBlueprint || program?.materialBlueprint
  const currentSession = program
    ? program.sessions[program.currentSessionIndex]
    : null

  const topicMastery = (masterySnapshot as any)?.topicMastery

  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        style={{
          position: 'fixed',
          bottom: 16,
          left: 16,
          zIndex: 9999,
          background: '#111',
          border: '1px solid #d6b26f40',
          borderRadius: 8,
          color: '#d6b26f',
          fontSize: 11,
          fontWeight: 800,
          padding: '6px 12px',
          cursor: 'pointer',
          opacity: 0.7,
        }}
      >
        🔍 DEBUG
      </button>
    )
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      background: '#0a0a0f',
      border: '1px solid #d6b26f30',
      borderBottom: 'none',
      borderRadius: '16px 16px 0 0',
      maxHeight: '60vh',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'monospace',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid #ffffff10',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 900, color: '#d6b26f' }}>🔍 ADAPTIVE DEBUG</span>
          {isBuildingBlueprint && (
            <span style={{ fontSize: 10, color: '#fbbf24', fontWeight: 700 }}>⏳ Construyendo blueprint...</span>
          )}
          {blueprint && (
            <Badge label="blueprint" value={blueprint.fallbackUsed ? 'fallback' : 'real'} color={blueprint.fallbackUsed ? '#f97316' : '#4ade80'} />
          )}
          {blueprint && (
            <Badge label="confidence" value={`${blueprint.confidence}%`} color={blueprint.confidence >= 70 ? '#4ade80' : blueprint.confidence >= 40 ? '#fbbf24' : '#ef4444'} />
          )}
          {blueprint && (
            <Badge label="valid" value={blueprint.validationPassed} />
          )}
        </div>
        <button
          onClick={() => setVisible(false)}
          style={{ background: 'transparent', border: 'none', color: '#ffffff40', fontSize: 16, cursor: 'pointer' }}
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: 2,
        padding: '6px 16px 0',
        borderBottom: '1px solid #ffffff10',
        flexShrink: 0,
      }}>
        {(['blueprint', 'sessions', 'mastery', 'api', 'obs'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '4px 12px',
              borderRadius: '6px 6px 0 0',
              border: 'none',
              background: tab === t ? '#d6b26f20' : 'transparent',
              color: tab === t ? '#d6b26f' : '#ffffff40',
              fontSize: 10,
              fontWeight: 800,
              cursor: 'pointer',
              letterSpacing: 0.5,
            }}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>

        {/* ── TAB: BLUEPRINT ── */}
        {tab === 'blueprint' && (
          <div>
            {!blueprint && !isBuildingBlueprint && (
              <div style={{ color: '#ef4444', fontSize: 11, fontWeight: 700 }}>
                ❌ Sin blueprint. handleSetupComplete no llamó a fetchAndBuildBlueprint o falló silenciosamente.
              </div>
            )}

            {blueprint && (
              <>
                <Section title="METADATA" defaultOpen>
                  <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                    <Badge label="topics" value={blueprint.topicCount} />
                    <Badge label="confidence" value={`${blueprint.confidence}%`} color={blueprint.confidence >= 70 ? '#4ade80' : '#fbbf24'} />
                    <Badge label="valid" value={blueprint.validationPassed} />
                    <Badge label="fallback" value={blueprint.fallbackUsed} color={blueprint.fallbackUsed ? '#f97316' : '#4ade80'} />
                    <Badge label="lang" value={blueprint.language} color="#38bdf8" />
                    <Badge label="pages" value={blueprint.totalPages} color="#a78bfa" />
                    {blueprint.coverageScore !== undefined && (
                      <Badge
                        label="coverage"
                        value={`${blueprint.coverageScore}%`}
                        color={blueprint.coverageScore >= 70 ? '#4ade80' : blueprint.coverageScore >= 40 ? '#fbbf24' : '#ef4444'}
                      />
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: '#ffffff60', marginTop: 6 }}>
                    Q central: {blueprint.centralQuestion || '—'}
                  </div>
                  <div style={{ fontSize: 10, color: '#ffffff60', marginTop: 2 }}>
                    Key insight: {blueprint.keyInsight || '—'}
                  </div>
                </Section>

                <Section title={`TOPICS (${blueprint.topics?.length || 0})`} defaultOpen>
                  {(blueprint.topics || []).map((topic: any, i: number) => (
                    <div key={topic.id} style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: '#ffffff08',
                      marginBottom: 6,
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 900, color: '#d6b26f', marginBottom: 4 }}>
                        {i + 1}. {topic.title}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
                        <Badge label="difficulty" value={topic.difficulty} color="#a78bfa" />
                        <Badge label="importance" value={topic.importance} color="#38bdf8" />
                        <Badge label="concepts" value={topic.concepts?.length || 0} />
                        {topic.prerequisites?.length > 0 && (
                          <Badge label="prereqs" value={topic.prerequisites.join(', ')} color="#fbbf24" />
                        )}
                      </div>
                      <div style={{ fontSize: 9, color: '#ffffff50' }}>
                        Conceptos: {(topic.concepts || []).map((c: any) => c.name).join(', ')}
                      </div>
                    </div>
                  ))}
                </Section>

                <Section title="LEARNING PATH">
                  {(blueprint.learningPath || []).map((step: string, i: number) => (
                    <div key={i} style={{ fontSize: 10, color: '#ffffff70', marginBottom: 2 }}>
                      {i + 1}. {step}
                    </div>
                  ))}
                </Section>
              </>
            )}
          </div>
        )}

        {/* ── TAB: SESSIONS ── */}
        {tab === 'sessions' && (
          <div>
            {!program && (
              <div style={{ color: '#ef4444', fontSize: 11 }}>❌ Sin programa adaptativo</div>
            )}
            {program && (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 10 }}>
                  <Badge label="total sessions" value={program.sessions.length} />
                  <Badge label="current idx" value={program.currentSessionIndex} color="#38bdf8" />
                  <Badge label="strategy" value={program.strategy?.type || '—'} color="#a78bfa" />
                  <Badge label="status" value={program.status} color="#4ade80" />
                </div>

                {/* Sesión actual */}
                {currentSession && (
                  <Section title="SESIÓN ACTUAL" defaultOpen>
                    <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 6 }}>
                      <Badge label="title" value={currentSession.title} color="#d6b26f" />
                      <Badge label="topicId" value={currentSession.topicId || 'NONE'} color={currentSession.topicId ? '#4ade80' : '#ef4444'} />
                      <Badge label="topicTitle" value={currentSession.topicTitle || 'NONE'} color={currentSession.topicTitle ? '#4ade80' : '#ef4444'} />
                      <Badge label="blueprintConf" value={`${currentSession.blueprintConfidence ?? '—'}%`} />
                    </div>
                    {currentSession.targetConcepts && currentSession.targetConcepts.length > 0 && (
                      <div style={{ fontSize: 10, color: '#4ade80', marginBottom: 4 }}>
                        ✅ targetConcepts: {currentSession.targetConcepts.join(', ')}
                      </div>
                    )}
                    {(!currentSession.targetConcepts || currentSession.targetConcepts.length === 0) && (
                      <div style={{ fontSize: 10, color: '#ef4444', marginBottom: 4 }}>
                        ❌ Sin targetConcepts — APIs usarán material completo
                      </div>
                    )}
                    {currentSession.sourcePages && currentSession.sourcePages.length > 0 && (
                      <div style={{ fontSize: 10, color: '#38bdf8', marginBottom: 4 }}>
                        📄 sourcePages: {currentSession.sourcePages.join(', ')}
                      </div>
                    )}
                    {currentSession.evidenceGoal && (
                      <div style={{ fontSize: 10, color: '#ffffff60', marginBottom: 4 }}>
                        🎯 evidenceGoal: {currentSession.evidenceGoal}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: '#ffffff50', marginTop: 6 }}>
                      Steps: {currentSession.steps.map(s => `${s.engine}(${s.type})`).join(' → ')}
                    </div>
                  </Section>
                )}

                {/* Todas las sesiones */}
                <Section title={`TODAS LAS SESIONES (${program.sessions.length})`}>
                  {program.sessions.map((s, i) => (
                    <div key={s.id} style={{
                      padding: '6px 8px',
                      borderRadius: 6,
                      background: i === program.currentSessionIndex ? '#d6b26f12' : '#ffffff06',
                      marginBottom: 4,
                      border: i === program.currentSessionIndex ? '1px solid #d6b26f30' : '1px solid transparent',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: i === program.currentSessionIndex ? '#d6b26f' : '#ffffff60' }}>
                          {i + 1}. {s.title}
                        </span>
                        <span style={{ fontSize: 9, color: '#ffffff40' }}>{s.status}</span>
                      </div>
                      {s.topicTitle ? (
                        <div style={{ fontSize: 9, color: '#4ade80', marginTop: 2 }}>
                          📌 {s.topicTitle} | {s.targetConcepts?.length || 0} conceptos
                        </div>
                      ) : (
                        <div style={{ fontSize: 9, color: '#f9731660', marginTop: 2 }}>
                          ⚠️ Sin topic context
                        </div>
                      )}
                    </div>
                  ))}
                </Section>
              </>
            )}
          </div>
        )}

        {/* ── TAB: MASTERY ── */}
        {tab === 'mastery' && (
          <div>
            <Section title="SNAPSHOT GENERAL" defaultOpen>
              {masterySnapshot ? (
                <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                  <Badge label="overall" value={`${masterySnapshot.overallMastery}%`} color="#d6b26f" />
                  <Badge label="understanding" value={`${masterySnapshot.understanding}%`} />
                  <Badge label="memory" value={`${masterySnapshot.memory}%`} />
                  <Badge label="application" value={`${masterySnapshot.application}%`} />
                  <Badge label="examPass" value={`${masterySnapshot.examPassProbability}%`} color="#4ade80" />
                  <Badge label="weakConcepts" value={masterySnapshot.weakConcepts?.length || 0} color="#fbbf24" />
                  <Badge label="criticalConcepts" value={masterySnapshot.criticalConcepts?.length || 0} color="#ef4444" />
                </div>
              ) : (
                <div style={{ color: '#ef4444', fontSize: 11 }}>❌ Sin snapshot</div>
              )}
            </Section>

            <Section title={`TOPIC MASTERY (${topicMastery?.length || 0} topics)`} defaultOpen>
              {!topicMastery && (
                <div style={{ color: '#f97316', fontSize: 11 }}>
                  ⚠️ Sin topicMastery — blueprint no conectado con mastery o concepts vacíos
                </div>
              )}
              {topicMastery && topicMastery.map((tm: any) => (
                <div key={tm.topicId} style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: tm.critical ? '#ef444412' : tm.weak ? '#f9731612' : '#4ade8008',
                  marginBottom: 4,
                  border: `1px solid ${tm.critical ? '#ef444430' : tm.weak ? '#f9731630' : '#4ade8020'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: tm.critical ? '#ef4444' : tm.weak ? '#f97316' : '#4ade80' }}>
                      {tm.topicTitle}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 900, color: tm.critical ? '#ef4444' : tm.weak ? '#f97316' : '#4ade80' }}>
                      {tm.score}%
                    </span>
                  </div>
                  <div style={{ fontSize: 9, color: '#ffffff50', marginTop: 2 }}>
                    {tm.coveredCount}/{tm.conceptCount} conceptos cubiertos
                    {tm.critical ? ' ⚠️ CRÍTICO' : tm.weak ? ' ⚡ DÉBIL' : tm.dominated ? ' ✅ DOMINADO' : ''}
                  </div>
                  {tm.weakConcepts?.length > 0 && (
                    <div style={{ fontSize: 9, color: '#f9731680', marginTop: 2 }}>
                      Débiles: {tm.weakConcepts.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </Section>

            <Section title="LEARNING MEMORY" defaultOpen>
              {!learningMemory && (
                <div style={{ color: '#ffffff50', fontSize: 11 }}>
                  Sin learningMemory todavía.
                </div>
              )}
              {learningMemory && (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 6 }}>
                    <Badge label="style" value={learningMemory.learningStyle || 'unknown'} color="#38bdf8" />
                    <Badge label="styleConf" value={`${learningMemory.styleConfidence || 0}%`} color="#a78bfa" />
                    <Badge label="sessions" value={learningMemory.totalSessions || 0} />
                    <Badge label="optLen" value={`${learningMemory.optimalSessionLength || 0}m`} color="#4ade80" />
                    <Badge label="prefDiff" value={learningMemory.preferredDifficulty || 50} color="#fbbf24" />
                  </div>
                  {(learningMemory.patterns || []).length > 0 && (
                    <div style={{ fontSize: 10, color: '#ffffff70', marginBottom: 6 }}>
                      Patterns: {(learningMemory.patterns || []).join(', ')}
                    </div>
                  )}
                </>
              )}
            </Section>

            <Section title="MASTERY STATE">
              <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 6 }}>
                <Badge label="concepts" value={masteryState?.concepts?.length || 0} />
                <Badge label="conceptsExtracted" value={masteryState?.conceptsExtracted} />
                <Badge label="processMode" value={masteryState?.processMode || '—'} color="#38bdf8" />
                <Badge label="hasBlueprint" value={!!(masteryState?.materialBlueprint)} />
              </div>
            </Section>
          </div>
        )}

        {/* ── TAB: OBSERVABILIDAD ── */}
        {tab === 'obs' && (
          <div>
            <Section title="ENDPOINTS ADAPTATIVOS" defaultOpen>
              {[
                'adaptive/explain',
                'adaptive/quiz',
                'adaptive/flashcards',
                'adaptive/exam',
                'adaptive/chat',
                'adaptive/repair',
              ].map(ep => (
                <div key={ep} style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: '#ffffff06',
                  marginBottom: 4,
                  fontSize: 10,
                  color: '#ffffff70',
                  fontFamily: 'monospace',
                }}>
                  <span style={{ color: '#4ade80' }}>POST</span> /{ep}
                </div>
              ))}
            </Section>

            <Section title="ÚLTIMO API PAYLOAD" defaultOpen>
              {lastApiPayload ? (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                    <Badge label="endpoint" value={lastApiPayload._endpoint || '—'} color="#38bdf8" />
                    <Badge label="chars" value={lastApiPayload._charsEnviados || 0} color="#a78bfa" />
                    {lastApiPayload.topicTitle && (
                      <Badge label="topic" value={lastApiPayload.topicTitle} color="#4ade80" />
                    )}
                    {lastApiPayload.targetConcepts?.length > 0 && (
                      <Badge label="concepts" value={lastApiPayload.targetConcepts.length} color="#fbbf24" />
                    )}
                  </div>
                  <pre style={{
                    fontSize: 9,
                    color: '#ffffff60',
                    background: '#00000030',
                    padding: 8,
                    borderRadius: 6,
                    overflow: 'auto',
                    maxHeight: 160,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}>
                    {JSON.stringify(lastApiPayload, null, 2).slice(0, 800)}
                  </pre>
                </>
              ) : (
                <div style={{ color: '#ffffff40', fontSize: 11 }}>
                  Sin payload registrado aún.
                </div>
              )}
            </Section>
          </div>
        )}

        {/* ── TAB: API ── */}
        {tab === 'api' && (
          <div>
            <Section title="ÚLTIMO PAYLOAD A API" defaultOpen>
              {!lastApiPayload && (
                <div style={{ color: '#ffffff50', fontSize: 11 }}>
                  Sin payload registrado. Inicia una sesión para ver el payload.
                </div>
              )}
              {lastApiPayload && (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 6 }}>
                    <Badge label="endpoint" value={lastApiPayload._endpoint || '—'} color="#38bdf8" />
                    {lastApiPayload.topicTitle && (
                      <Badge label="topicTitle" value={lastApiPayload.topicTitle} color="#4ade80" />
                    )}
                    {!lastApiPayload.topicTitle && (
                      <Badge label="topicTitle" value="MISSING" color="#ef4444" />
                    )}
                    {lastApiPayload.targetConcepts?.length > 0 && (
                      <Badge label="targetConcepts" value={lastApiPayload.targetConcepts.length} color="#4ade80" />
                    )}
                  </div>
                  <JsonBlock data={lastApiPayload} />
                </>
              )}
            </Section>

            <Section title="MATERIAL CONTENT">
              <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 6 }}>
                <Badge label="chars" value={materialContent.length} />
                <Badge label="~pages" value={Math.max(1, Math.round(materialContent.length / 1600))} color="#a78bfa" />
                <Badge label="sliceToAPIs" value="8000 chars" color="#38bdf8" />
              </div>
              <div style={{ fontSize: 9, color: '#ffffff40', fontFamily: 'monospace' }}>
                {materialContent.slice(0, 200)}...
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}
