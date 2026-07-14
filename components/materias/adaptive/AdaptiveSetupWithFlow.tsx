'use client'

// ═══════════════════════════════════════════════════════════════
// AdaptiveSetupWithFlow
// Wrapper que conecta el Setup de 4 preguntas con el flujo real:
// Setup → Analizar Material → Diagnóstico → Plan → Libro
// ═══════════════════════════════════════════════════════════════

import { useEffect, useCallback } from 'react'
import AdaptiveProgramSetupModal from './AdaptiveProgramSetup'
import AdaptiveDiagnosis from './AdaptiveDiagnosis'
import AdaptiveFlowLoader from './AdaptiveFlowLoader'
import { useAdaptiveFlow } from '../../../hooks/useAdaptiveFlow'
import type { AdaptiveProgramSetup } from '../../../lib/adaptive'
import type { StudentIntake, AdaptiveProgramPlan, MaterialAnalysis } from '../../../lib/adaptive/types'

interface Props {
  materialText: string
  materialTitle: string
  materialIds: string[]
  userId?: string | null
  onComplete: (result: {
    plan: AdaptiveProgramPlan
    analysis: MaterialAnalysis
    intake: StudentIntake
    diagnosticResult: any
  }) => void
  onCancel: () => void
}

// Convertir setup de 4 pasos → StudentIntake del sistema nuevo
function setupToIntake(setup: AdaptiveProgramSetup, materialIds: string[], userId?: string | null): StudentIntake {
  const minutesMap: Record<string, number> = {
    short: 12,
    medium: 22,
    long: 35,
  }

  const gradeMap: Record<number, string> = {}
  const grade = String(setup.targetScore)

  return {
    selfReportedLevel: setup.initialKnowledgeLevel as any,
    sessionDurationMinutes: minutesMap[setup.sessionLength] || 22,
    examDate: setup.examDate || 'no_exam',
    targetGrade: grade,
    materialIds,
    userId: userId || undefined,
    evalPreference: (setup as any).evalPreference || 'mix_everything',
  }
}

export default function AdaptiveSetupWithFlow({
  materialText,
  materialTitle,
  materialIds,
  userId,
  onComplete,
  onCancel,
}: Props) {
  const flow = useAdaptiveFlow()

  // Cuando el phase pasa a 'planning', ejecutar la creación del plan
  useEffect(() => {
    if (flow.phase !== 'planning' || !flow.analysis) return

    // Recuperar el intake guardado temporalmente
    const intakeRaw = sessionStorage.getItem('adaptive_flow_intake')
    if (!intakeRaw) return

    const intake: StudentIntake = JSON.parse(intakeRaw)
    flow.executePlanning(intake)
  }, [flow.phase, flow.analysis])

  // Cuando el plan está listo, notificar al padre
  useEffect(() => {
    if (flow.phase !== 'ready' || !flow.plan || !flow.analysis) return

    const intakeRaw = sessionStorage.getItem('adaptive_flow_intake')
    if (!intakeRaw) return

    const intake: StudentIntake = JSON.parse(intakeRaw)

    onComplete({
      plan: flow.plan,
      analysis: flow.analysis,
      intake,
      diagnosticResult: flow.diagnosticResult,
    })
  }, [flow.phase, flow.plan, flow.analysis])

  // Manejar el submit del setup
  const handleSetupComplete = useCallback(async (setup: AdaptiveProgramSetup) => {
    const intake = setupToIntake(setup, materialIds, userId)

    // Guardar intake para recuperarlo más tarde
    sessionStorage.setItem('adaptive_flow_intake', JSON.stringify(intake))

    // Arrancar el flujo en background
    await flow.runFullFlow(materialText, materialTitle, materialIds, intake)
  }, [flow.runFullFlow, materialText, materialTitle, materialIds])

  // Manejar la finalización del diagnóstico
  const handleDiagnosisComplete = useCallback((result: any) => {
    flow.completeDiagnosis(result)
  }, [flow.completeDiagnosis])

  // ── RENDERS según fase ───────────────────────────────────────

  // Error
  if (flow.phase === 'error') {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,.9)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, fontFamily: 'Georgia, serif',
      }}>
        <div style={{
          maxWidth: 480, width: '100%',
          background: 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)',
          borderRadius: 12, padding: '36px 40px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>😓</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#3a2e1f', marginBottom: 8 }}>
            Algo salió mal
          </div>
          <div style={{ fontSize: 13, color: 'rgba(58,46,31,.6)', marginBottom: 24, lineHeight: 1.5 }}>
            {flow.error}
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={() => flow.reset()}
              style={{
                padding: '12px 24px', borderRadius: 8,
                border: '2px solid #3a2e1f', background: '#3a2e1f',
                color: '#f5ecd5', fontFamily: 'Georgia, serif',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Reintentar
            </button>
            <button
              onClick={onCancel}
              style={{
                padding: '12px 24px', borderRadius: 8,
                border: '1.5px solid rgba(58,46,31,.3)', background: 'transparent',
                color: 'rgba(58,46,31,.6)', fontFamily: 'Georgia, serif',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Loading (analyzing, evaluating, planning)
  // Mostrar IntroSession en vez del loader genérico
  if (flow.phase === 'analyzing' || flow.phase === 'evaluating' || flow.phase === 'planning') {
    const IntroSession = require('./IntroSession').default
    const topics = flow.analysis
      ? (flow.analysis.totalCoverageUnits || []).map((u: any) => u.title).filter(Boolean)
      : []
    return (
      <IntroSession
        materialTitle={materialTitle}
        materialText={materialText}
        topicsFound={topics}
        isReady={false}
        onReady={() => {}}
      />
    )
  }

  // Diagnóstico interactivo
  if (flow.phase === 'diagnosis' && flow.diagnosticQuestions.length > 0) {
    return (
      <AdaptiveDiagnosis
        questions={flow.diagnosticQuestions}
        materialTitle={materialTitle}
        onComplete={handleDiagnosisComplete}
      />
    )
  }

  // Setup inicial (idle o fase 'ready' ya manejada en useEffect)
  return (
    <AdaptiveProgramSetupModal
      onComplete={handleSetupComplete}
      onCancel={onCancel}
    />
  )
}
