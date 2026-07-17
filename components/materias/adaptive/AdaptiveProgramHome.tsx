'use client'

import type { AdaptiveProgram, AdaptiveSession } from '../../../lib/adaptive'
import {
  SESSION_PURPOSE_EMOJI,
  SESSION_PURPOSE_LABELS,
  getExamDateLabel,
  getCurrentSession,
  getProgramProgress,
} from '../../../lib/adaptive'

interface Props {
  program: AdaptiveProgram
  currentDomain: number
  onStartSession: () => void
  onClose: () => void
  strategyChangeMessage?: string | null
  topicMastery?: Array<{
    topicId: string
    topicTitle: string
    score: number
    weak: boolean
    critical: boolean
    dominated: boolean
    weakConcepts: string[]
  }> | null
}

function SessionRow({ session, isCurrent }: { session: AdaptiveSession; isCurrent: boolean }) {
  const emoji = SESSION_PURPOSE_EMOJI[session.purpose]
  const isDone = session.status === 'completed'
  const isSkipped = session.status === 'skipped'
  const isLocked = session.status === 'locked'

  // Título: preferir topicTitle si existe
  const displayTitle = session.topicTitle
    ? `${emoji} ${session.title}`
    : `${emoji} Sesión ${session.sessionNumber} — ${SESSION_PURPOSE_LABELS[session.purpose]}`

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '10px 12px',
      borderRadius: 10,
      background: isCurrent
        ? 'color-mix(in srgb, var(--gold) 10%, transparent)'
        : 'transparent',
      border: isCurrent
        ? '1.5px solid color-mix(in srgb, var(--gold) 35%, transparent)'
        : '1.5px solid transparent',
      opacity: isLocked ? 0.4 : 1,
    }}>
      <span style={{ fontSize: 16, minWidth: 20, textAlign: 'center', flexShrink: 0, marginTop: 2 }}>
        {isDone ? '✅' : isSkipped ? '⏭️' : isCurrent ? '▶️' : isLocked ? '🔒' : '⬜'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13,
          fontWeight: isCurrent ? 900 : 700,
          color: isCurrent ? 'var(--gold)' : isDone ? 'var(--text-faint)' : 'var(--text-primary)',
          textDecoration: isDone ? 'line-through' : 'none',
          lineHeight: 1.4,
        }}>
          {displayTitle}
        </div>
        {/* Mostrar topicTitle como subtítulo si el título de sesión ya lo incluye */}
        {isCurrent && session.objective && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
            {session.objective}
          </div>
        )}
        {/* Conceptos objetivo — solo en sesión actual */}
        {isCurrent && session.targetConcepts && session.targetConcepts.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {session.targetConcepts.slice(0, 3).map(c => (
              <span key={c} style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--gold)',
                background: 'color-mix(in srgb, var(--gold) 12%, transparent)',
                borderRadius: 999,
                padding: '1px 6px',
              }}>
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{
        fontSize: 11,
        color: 'var(--text-faint)',
        fontWeight: 700,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>
        
      </div>
    </div>
  )
}

export default function AdaptiveProgramHome({
  program,
  currentDomain,
  onStartSession,
  onClose,
  strategyChangeMessage,
  topicMastery,
}: Props) {
  const current = getCurrentSession(program)
  const { completedSessions, totalSessions } = getProgramProgress(program)
  const target = program.setup.targetScore
  const examLabel = getExamDateLabel(program.setup.examDate)
  const domainGap = Math.max(0, target - currentDomain)
  const isProgramComplete = program.status === 'completed'
  const studyPlan = program.studyPlan
  const plannedNext = studyPlan?.sessions.find(session => ['available', 'planned', 'repair', 'review', 'final_exam'].includes(session.status))

  // ── Lenguaje visible — sin tecnicismos ──────────────────────
  const hasBlueprintContext = !!(program.materialBlueprint?.validationPassed)
  const weakTopicsCount = program.sessions.filter(
    s => s.status !== 'completed' && s.status !== 'skipped'
  ).length

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--bg-primary)',
      overflowY: 'auto',
      zIndex: 50,
    }}>
      {/* Fondo sutil */}
      <div style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        background: 'radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--gold) 6%, transparent), transparent 55%)',
      }} />

      {/* Topbar */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '14px 24px',
        background: 'linear-gradient(to bottom, var(--bg-primary) 70%, transparent)',
      }}>
        <button onClick={onClose} style={{
          background: 'transparent',
          border: '2px solid var(--border-color2)',
          borderRadius: 10,
          padding: '8px 14px',
          color: 'var(--text-faint)',
          fontWeight: 800,
          fontSize: 13,
          cursor: 'pointer',
        }}>
          ← Volver
        </button>
        <div style={{
          fontSize: 12,
          fontWeight: 800,
          color: 'var(--text-faint)',
          letterSpacing: 0.5,
        }}>
          MODO ADAPTATIVO
        </div>
      </div>

      {/* Contenido */}
      <div style={{
        maxWidth: 520,
        margin: '0 auto',
        padding: '8px 24px 48px',
        position: 'relative',
        zIndex: 5,
      }}>
        {/* Título */}
        <div style={{ marginBottom: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--gold)', letterSpacing: 0.5, marginBottom: 6 }}>
            TU PROGRAMA DE ESTUDIO
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
            {completedSessions} de {totalSessions} sesiones completadas
          </div>
        </div>

        {/* ALAI explica la estrategia */}
        {program.strategy && (
          <div style={{
            background: 'color-mix(in srgb, var(--gold) 7%, var(--bg-card))',
            border: '1.5px solid color-mix(in srgb, var(--gold) 30%, transparent)',
            borderRadius: 14,
            padding: '16px 18px',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--gold)', marginBottom: 8, letterSpacing: 0.5 }}>
              🤖 POR QUÉ ALAI ELIGIÓ ESTA RUTA
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, marginBottom: 10 }}>
              {program.strategy.why}
              {/* Si hay topics débiles, mencionar el más crítico */}
              {topicMastery && topicMastery.filter(t => t.critical).length > 0 && (
                <span style={{ display: 'block', marginTop: 6, color: 'var(--gold)', fontWeight: 700, fontSize: 12 }}>
                  Foco principal: {topicMastery.filter(t => t.critical)[0].topicTitle} ({topicMastery.filter(t => t.critical)[0].score}% dominado)
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {program.strategy.goals.slice(0, 3).map((goal, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
                  <span style={{ color: 'var(--gold)', flexShrink: 0 }}>✓</span>
                  <span>{goal}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Temas que ALAI identificó — solo si hay blueprint */}
        {hasBlueprintContext && program.materialBlueprint && (
          <div style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-color2)',
            borderRadius: 14,
            padding: '14px 16px',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', marginBottom: 10, letterSpacing: 0.5 }}>
              📚 TEMAS QUE ALAI ANALIZÓ
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {program.materialBlueprint.topics.slice(0, 5).map((topic, i) => (
                <div key={topic.id} style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: 'var(--gold)',
                    background: 'color-mix(in srgb, var(--gold) 12%, transparent)',
                    borderRadius: 999,
                    padding: '1px 6px',
                    flexShrink: 0,
                  }}>
                    {i + 1}
                  </span>
                  <span>{topic.title}</span>
                  <span style={{ color: 'var(--text-faint)', fontSize: 10, marginLeft: 'auto', flexShrink: 0 }}>
                    {topic.concepts.length} conceptos
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notificación de cambio de estrategia */}
        {strategyChangeMessage && (
          <div style={{
            background: 'color-mix(in srgb, #fbbf24 8%, var(--bg-card))',
            border: '1.5px solid color-mix(in srgb, #fbbf24 40%, transparent)',
            borderRadius: 14,
            padding: '14px 16px',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#fbbf24', marginBottom: 6, letterSpacing: 0.5 }}>
              ⚡ ALAI ACTUALIZÓ TU PROGRAMA
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
              {strategyChangeMessage}
            </div>
          </div>
        )}

        {/* Topic Mastery — dominio por tema */}
        {topicMastery && topicMastery.length > 0 && (
          <div style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-color2)',
            borderRadius: 14,
            padding: '14px 16px',
            marginBottom: 16,
          }}>
            <div style={{
              fontSize: 11,
              fontWeight: 800,
              color: 'var(--text-faint)',
              marginBottom: 12,
              letterSpacing: 0.5,
            }}>
              DOMINIO POR TEMA
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {topicMastery.map(tm => (
                <div key={tm.topicId}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 4,
                  }}>
                    <div style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: tm.critical
                        ? '#ef4444'
                        : tm.weak
                        ? '#f97316'
                        : tm.dominated
                        ? '#4ade80'
                        : 'var(--text-primary)',
                    }}>
                      {tm.critical ? '⚠️ ' : tm.dominated ? '✅ ' : ''}
                      {tm.topicTitle}
                    </div>
                    <div style={{
                      fontSize: 12,
                      fontWeight: 900,
                      color: tm.critical
                        ? '#ef4444'
                        : tm.weak
                        ? '#f97316'
                        : tm.dominated
                        ? '#4ade80'
                        : 'var(--gold)',
                    }}>
                      {tm.score}%
                    </div>
                  </div>
                  <div style={{
                    height: 5,
                    borderRadius: 999,
                    background: 'var(--border-color2)',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, tm.score)}%`,
                      background: tm.critical
                        ? '#ef4444'
                        : tm.weak
                        ? '#f97316'
                        : tm.dominated
                        ? '#4ade80'
                        : 'var(--gold)',
                      borderRadius: 999,
                      transition: 'width 0.6s ease',
                    }} />
                  </div>
                  {tm.weak && tm.weakConcepts.length > 0 && (
                    <div style={{
                      fontSize: 10,
                      color: 'var(--text-faint)',
                      marginTop: 3,
                    }}>
                      Reforzar: {tm.weakConcepts.slice(0, 2).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

                {/* Puntos del material que ALAI va a reforzar */}
        {current && (
          <div style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-color2)',
            borderRadius: 14,
            padding: '14px 16px',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', marginBottom: 10, letterSpacing: 0.5 }}>
              {/* Lenguaje visible correcto — sin "conceptos críticos" */}
              HOY ALAI VA A TRABAJAR
            </div>
            {current.topicTitle && (
              <div style={{
                fontSize: 14,
                fontWeight: 900,
                color: 'var(--gold)',
                marginBottom: 8,
              }}>
                {current.topicTitle}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {current.steps
                .filter(s => s.evidenceRequired)
                .slice(0, 3)
                .map((step, i) => (
                  <div key={i} style={{
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                  }}>
                    <span style={{ color: '#4ade80', flexShrink: 0 }}>✓</span>
                    <span>{step.instruction}</span>
                  </div>
                ))}
            </div>
            {/* Puntos del material — lenguaje correcto */}
            {weakTopicsCount > 0 && (
              <div style={{
                marginTop: 10,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'color-mix(in srgb, var(--gold) 6%, transparent)',
                fontSize: 12,
                color: 'var(--text-muted)',
                lineHeight: 1.5,
              }}>
                ALAI identificó <strong style={{ color: 'var(--gold)' }}>{weakTopicsCount} punto{weakTopicsCount !== 1 ? 's' : ''} del material</strong> que todavía no dominas.
              </div>
            )}
          </div>
        )}

        {/* Dominio vs Objetivo */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1.5px solid var(--border-color2)',
          borderRadius: 16,
          padding: '20px 24px',
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', marginBottom: 4 }}>
                DOMINIO ACTUAL
              </div>
              <div style={{ fontSize: 42, fontWeight: 900, color: 'var(--gold)', lineHeight: 1 }}>
                {currentDomain}%
              </div>
            </div>
            <div style={{ fontSize: 20, color: 'var(--text-faint)', paddingBottom: 8 }}>→</div>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', marginBottom: 4 }}>
                OBJETIVO
              </div>
              <div style={{
                fontSize: 42,
                fontWeight: 900,
                color: domainGap === 0 ? '#4ade80' : 'var(--text-secondary)',
                lineHeight: 1,
              }}>
                {target}%
              </div>
            </div>
          </div>

          <div style={{
            height: 8,
            borderRadius: 999,
            background: 'var(--border-color2)',
            overflow: 'hidden',
            marginBottom: 8,
          }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, currentDomain)}%`,
              background: domainGap === 0
                ? 'linear-gradient(to right, #4ade80, #22c55e)'
                : 'linear-gradient(to right, var(--gold), #f59e0b)',
              borderRadius: 999,
              transition: 'width 0.6s ease',
            }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-faint)' }}>
            <span>
              {domainGap > 0
                ? `Faltan ${domainGap} puntos para tu objetivo`
                : '✅ Objetivo alcanzado'}
            </span>
            <span>📅 {examLabel}</span>
          </div>

          {/* Alerta de conflicto */}
          {program.strategy?.conflictDetected && program.strategy.conflictMessage && (
            <div style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'color-mix(in srgb, #f97316 10%, transparent)',
              border: '1px solid color-mix(in srgb, #f97316 40%, transparent)',
              fontSize: 12,
              color: 'var(--text-primary)',
              lineHeight: 1.5,
            }}>
              <span style={{ color: '#f97316', fontWeight: 800 }}>⚠️ ALAI ajustó tu objetivo: </span>
              {program.strategy.conflictMessage}
            </div>
          )}

          {/* Proyección — conexión 5 */}
          {program.strategy?.projectedDomain && program.strategy.projectedDomain.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 6,
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)' }}>
                  PROYECCIÓN SESIÓN A SESIÓN
                </div>
                {program.strategy.projectedDomain.length > 1 && (
                  <div style={{ fontSize: 10, color: 'var(--gold)', fontWeight: 700 }}>
                    +{Math.max(0, program.strategy.projectedDomain[program.strategy.projectedDomain.length - 1] - program.strategy.projectedDomain[0])} pts esperados
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 40 }}>
                {program.strategy.projectedDomain.slice(0, 6).map((d, i) => {
                  const sessionForBar = program.sessions[i]
                  const label = sessionForBar?.topicTitle
                    ? sessionForBar.topicTitle.slice(0, 8) + (sessionForBar.topicTitle.length > 8 ? '…' : '')
                    : `S${i + 1}`
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <div style={{
                        width: '100%',
                        height: `${Math.max(4, (d / 100) * 32)}px`,
                        background: i === 0 ? 'var(--border-color2)' : 'var(--gold)',
                        borderRadius: 3,
                        opacity: 0.3 + (i / 6) * 0.7,
                      }} />
                      <div style={{ fontSize: 8, color: 'var(--text-faint)', fontWeight: 700, textAlign: 'center' }}>
                        {d}%
                      </div>
                      <div style={{ fontSize: 7, color: 'var(--text-faint)', textAlign: 'center', lineHeight: 1.2 }}>
                        {label}
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* Si hay studyImpactForecast disponible, mostrar predicción de aprobación */}
            </div>
          )}
        </div>

        {/* Sesión actual */}
        {!isProgramComplete && current && (
          <div data-testid="next-study-session" style={{
            background: 'var(--bg-card)',
            border: '2px solid var(--gold)',
            borderRadius: 16,
            padding: '20px 24px',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--gold)', marginBottom: 8, letterSpacing: 0.5 }}>
              TU PRÓXIMA SESIÓN
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 4 }}>
              {SESSION_PURPOSE_EMOJI[current.purpose]} {current.title}
            </div>
            {current.topicTitle && current.topicTitle !== current.title && (
              <div style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 700, marginBottom: 6 }}>
                {current.topicTitle}
              </div>
            )}
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
              {plannedNext?.objective || current.objective}
            </div>
            <div data-testid="next-session-duration" style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 8 }}>
              ⏱ {plannedNext?.plannedDuration || current.estimatedMinutes} minutos estimados
            </div>
            <div data-testid="next-session-reason" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.45 }}>
              {plannedNext?.reason || current.planRationale || 'Esta sesión continúa tu secuencia de aprendizaje.'}
            </div>
            {studyPlan?.feasibility.level === 'insufficient_time' && (
              <div data-testid="study-plan-risk" style={{ padding: 10, borderRadius: 8, background: 'rgba(249,115,22,.1)', color: '#f97316', fontSize: 12, marginBottom: 12 }}>
                {studyPlan.feasibility.riskMessage}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 20 }}>
              Examen: {studyPlan ? new Date(studyPlan.examContext.examAt).toLocaleDateString() : examLabel}
            </div>

            <button
              onClick={onStartSession}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: 12,
                border: '2px solid var(--gold)',
                background: 'var(--gold)',
                color: '#111',
                fontWeight: 900,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              Empezar sesión →
            </button>
          </div>
        )}

        {/* Programa completado */}
        {isProgramComplete && (
          <div style={{
            background: 'color-mix(in srgb, #4ade80 10%, var(--bg-card))',
            border: '2px solid #4ade80',
            borderRadius: 16,
            padding: '24px',
            marginBottom: 16,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#4ade80', marginBottom: 8 }}>
              Programa completado
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Completaste todas las sesiones de tu programa.<br />
              Tu dominio ha mejorado significativamente.
            </div>
          </div>
        )}

        {/* Lista de sesiones */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1.5px solid var(--border-color2)',
          borderRadius: 16,
          padding: '16px',
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-faint)', marginBottom: 12, letterSpacing: 0.5 }}>
            TODAS LAS SESIONES
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {program.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                isCurrent={
                  session.id === current?.id &&
                  !isProgramComplete
                }
              />
            ))}
          </div>
        </div>

        {/* Info del setup */}
        <div style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap' as const,
          justifyContent: 'center',
        }}>
          {[
            
            { icon: '📅', text: examLabel },
            { icon: '🎯', text: `Meta: ${target}%` },
          ].map((item) => (
            <div key={item.text} style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid var(--border-color2)',
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--text-faint)',
              display: 'flex',
              gap: 6,
              alignItems: 'center',
            }}>
              <span>{item.icon}</span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
