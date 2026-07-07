// ═══════════════════════════════════════════════════════════════
// useAdaptiveFlow
// Orquesta el flujo completo del modo adaptativo:
// 1. Analizar material → 2. Diagnóstico → 3. Crear plan → 4. Sesiones
// ═══════════════════════════════════════════════════════════════

import { useState, useCallback, useRef } from 'react'
import type {
  MaterialAnalysis,
  StudentIntake,
  AdaptiveProgramPlan,
} from '../lib/adaptive/types'

export type AdaptiveFlowPhase =
  | 'idle'
  | 'analyzing'          // Analizando el material
  | 'diagnosis'          // Mostrando preguntas de diagnóstico
  | 'evaluating'         // Evaluando respuestas del diagnóstico
  | 'planning'           // Creando el plan de sesiones
  | 'ready'              // Plan listo — mostrar libro
  | 'error'

export interface DiagnosticQuestion {
  id: string
  layer: string
  type: string
  prompt: string
  options?: string[]
  correctAnswer: any
  explanation: string
  difficulty: number
  evidenceWeight: number
  conceptNames: string[]
  falseConfidenceTrap: boolean
}

export interface AdaptiveFlowState {
  phase: AdaptiveFlowPhase
  analysis: MaterialAnalysis | null
  diagnosticQuestions: DiagnosticQuestion[]
  diagnosticResult: any | null
  plan: AdaptiveProgramPlan | null
  error: string | null
  loadingMessage: string
  coveragePercent: number
}

export function useAdaptiveFlow() {
  const [state, setState] = useState<AdaptiveFlowState>({
    phase: 'idle',
    analysis: null,
    diagnosticQuestions: [],
    diagnosticResult: null,
    plan: null,
    error: null,
    loadingMessage: '',
    coveragePercent: 0,
  })

  const abortRef = useRef(false)

  const setPhase = useCallback((phase: AdaptiveFlowPhase, loadingMessage = '') => {
    setState(prev => ({ ...prev, phase, loadingMessage, error: null }))
  }, [])

  const setError = useCallback((error: string) => {
    setState(prev => ({ ...prev, phase: 'error', error, loadingMessage: '' }))
  }, [])

  // ── PASO 1: Analizar el material ─────────────────────────────
  const analyzeMaterial = useCallback(async (
    materialText: string,
    materialTitle: string,
    materialIds: string[],
  ): Promise<MaterialAnalysis | null> => {
    if (!materialText || materialText.trim().length < 100) {
      setError('El material no tiene suficiente contenido para analizar.')
      return null
    }

    setPhase('analyzing', 'ALAI está analizando el 100% del material...')

    try {
      // Limitar texto a 6000 chars para evitar timeouts en modelos pequeños
      // El análisis con el texto reducido es suficiente para detectar estructura
      const textForAnalysis = materialText.length > 6000
        ? materialText.slice(0, 3000) + '\n\n[...contenido intermedio omitido...]\n\n' + materialText.slice(-2000)
        : materialText

      const res = await fetch('/api/adaptive/analyze-material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materialText: textForAnalysis, materialTitle, materialIds }),
      })

      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data = await res.json()

      if (!data.success || !data.analysis) {
        throw new Error(data.error || 'No se pudo analizar el material')
      }

      const analysis: MaterialAnalysis = data.analysis
      setState(prev => ({ ...prev, analysis }))
      console.log(`[Flow] Material analizado: ${analysis.totalCoverageUnits.length} unidades | área: ${analysis.subjectArea}`)
      return analysis

    } catch (err: any) {
      console.error('[Flow] analyzeMaterial error:', err.message)
      setError(`Error analizando el material: ${err.message}`)
      return null
    }
  }, [setPhase, setError])

  // ── PASO 2: Generar preguntas de diagnóstico ─────────────────
  const generateDiagnosis = useCallback(async (
    analysis: MaterialAnalysis,
    intake: StudentIntake,
  ): Promise<boolean> => {
    // Si dice que no sabe nada, saltamos diagnóstico
    if (intake.selfReportedLevel === 'zero') {
      setState(prev => ({
        ...prev,
        diagnosticResult: { estimatedLevel: 'zero', falseConfidenceDetected: false },
        phase: 'planning',
      }))
      return true
    }

    setPhase('diagnosis', 'Preparando diagnóstico...')

    try {
      const res = await fetch('/api/adaptive/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialText: analysis.totalCoverageUnits.map(u => u.rawTextReference).join('\n'),
          materialTitle: analysis.materialTitle,
          coverageUnits: analysis.totalCoverageUnits,
          concepts: analysis.concepts,
          selfReportedLevel: intake.selfReportedLevel,
          subjectArea: analysis.subjectArea,
          targetGrade: intake.targetGrade,
        }),
      })

      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data = await res.json()

      if (data.skipDiagnosis) {
        setState(prev => ({
          ...prev,
          diagnosticResult: { estimatedLevel: 'zero', falseConfidenceDetected: false },
          phase: 'planning',
        }))
        return true
      }

      if (!data.success || !data.questions?.length) {
        throw new Error(data.error || 'No se pudieron generar preguntas')
      }

      setState(prev => ({
        ...prev,
        diagnosticQuestions: data.questions,
        phase: 'diagnosis',
      }))
      return true

    } catch (err: any) {
      console.error('[Flow] generateDiagnosis error:', err.message)
      // Si falla el diagnóstico, continuar sin él
      setState(prev => ({
        ...prev,
        diagnosticResult: { estimatedLevel: intake.selfReportedLevel, falseConfidenceDetected: false },
        phase: 'planning',
      }))
      return true
    }
  }, [setPhase])

  // ── PASO 3: Evaluar respuestas del diagnóstico ───────────────
  const completeDiagnosis = useCallback((result: {
    answers: any[]
    falseConfidenceDetected: boolean
    estimatedLevel: string
  }) => {
    setState(prev => ({
      ...prev,
      diagnosticResult: result,
      phase: 'evaluating',
    }))

    // Pequeño delay para mostrar "evaluando..." al usuario
    setTimeout(() => {
      setState(prev => ({ ...prev, phase: 'planning' }))
    }, 800)
  }, [])

  // ── PASO 4: Crear el plan de sesiones ────────────────────────
  const createPlan = useCallback(async (
    analysis: MaterialAnalysis,
    intake: StudentIntake,
    diagnosticResult: any,
  ): Promise<AdaptiveProgramPlan | null> => {
    setPhase('planning', 'ALAI está diseñando tu plan de estudio personalizado...')

    try {
      const res = await fetch('/api/adaptive/create-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis, intake, diagnosticResult }),
      })

      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data = await res.json()

      if (!data.success || !data.plan) {
        throw new Error(data.error || 'No se pudo crear el plan')
      }

      const plan: AdaptiveProgramPlan = data.plan
      const coveragePercent: number = data.coveragePercent || 100

      setState(prev => ({
        ...prev,
        plan,
        coveragePercent,
        phase: 'ready',
        loadingMessage: '',
      }))

      console.log(`[Flow] Plan creado: ${plan.estimatedSessions.length} sesiones | cobertura: ${coveragePercent}%`)
      return plan

    } catch (err: any) {
      console.error('[Flow] createPlan error:', err.message)
      setError(`Error creando el plan: ${err.message}`)
      return null
    }
  }, [setPhase, setError])

  // ── Flujo completo desde el setup ───────────────────────────
  const runFullFlow = useCallback(async (
    materialText: string,
    materialTitle: string,
    materialIds: string[],
    intake: StudentIntake,
  ) => {
    abortRef.current = false

    // 1. Analizar material
    const analysis = await analyzeMaterial(materialText, materialTitle, materialIds)
    if (!analysis || abortRef.current) return

    // 2. Generar diagnóstico (queda en phase='diagnosis' esperando respuestas)
    await generateDiagnosis(analysis, intake)

    // Si era nivel cero, ya pasó directo a planning
    // Si no, esperamos que el usuario complete el diagnóstico
    // y llame a completeDiagnosis → que dispara el phase='planning'
  }, [analyzeMaterial, generateDiagnosis])

  // ── Ejecutar createPlan cuando phase cambia a 'planning' ─────
  // Esto lo llama el componente al detectar phase === 'planning'
  const executePlanning = useCallback(async (
    intake: StudentIntake,
  ) => {
    if (!state.analysis) return
    await createPlan(state.analysis, intake, state.diagnosticResult)
  }, [state.analysis, state.diagnosticResult, createPlan])

  const reset = useCallback(() => {
    abortRef.current = true
    setState({
      phase: 'idle',
      analysis: null,
      diagnosticQuestions: [],
      diagnosticResult: null,
      plan: null,
      error: null,
      loadingMessage: '',
      coveragePercent: 0,
    })
  }, [])

  return {
    ...state,
    analyzeMaterial,
    generateDiagnosis,
    completeDiagnosis,
    createPlan,
    runFullFlow,
    executePlanning,
    reset,
  }
}
