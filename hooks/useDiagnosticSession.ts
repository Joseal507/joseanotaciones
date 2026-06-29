'use client'

import { useState, useCallback, useRef } from 'react'

export interface MicroAction {
  thought: string
  content: string
  expectAnswer: boolean
  questionToAsk?: string
  questionType?: string
  conceptBeingTested?: string
  analogyUsedHere?: string
  exampleUsedHere?: string
}

interface Options {
  adaptiveContext: any
  topic: any
  materialSlice: string
  totalStagesPlanned?: number
}

export function useDiagnosticSession(options: Options) {
  const [studentModel, setStudentModel] = useState<any>(null)
  const [hypothesis, setHypothesis] = useState<any>(null)
  const [currentAction, setCurrentAction] = useState<any>(null)
  const [microAction, setMicroAction] = useState<MicroAction | null>(null)
  const [diagnosis, setDiagnosis] = useState<string>('')
  const [stagesCompleted, setStagesCompleted] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sessionScores = useRef<number[]>([])

  // ── Pedir la siguiente micro-acción ──────────────────────
  const nextMicroAction = useCallback(async (lastResponse?: {
    questionAsked: string
    answerGiven: string
    score: number
    conceptTested?: string
  }) => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/adaptive/micro-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adaptiveContext: options.adaptiveContext,
          topic: options.topic,
          materialSlice: options.materialSlice,
          studentModel,
          hypothesis,
          lastResponse,
          stagesCompleted,
          totalStagesPlanned: options.totalStagesPlanned || 6,
        }),
      })

      if (!res.ok) throw new Error(`API error ${res.status}`)
      const data = await res.json()

      if (!data.success) throw new Error(data.error || 'Error desconocido')

      setStudentModel(data.studentModel)
      setHypothesis(data.hypothesis)
      setCurrentAction(data.action)
      setMicroAction(data.microAction)
      setDiagnosis(data.diagnosis || '')

      if (lastResponse) {
        sessionScores.current.push(lastResponse.score)
      }

      setStagesCompleted(prev => prev + 1)
      return data.microAction
    } catch (err: any) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [options, studentModel, hypothesis, stagesCompleted])

  const isSessionComplete = currentAction?.type === 'close_session' ||
                            stagesCompleted >= (options.totalStagesPlanned || 6)

  const sessionSummary = {
    totalStages: stagesCompleted,
    avgScore: sessionScores.current.length > 0
      ? Math.round(sessionScores.current.reduce((a, b) => a + b, 0) / sessionScores.current.length)
      : 0,
    finalHypothesis: hypothesis?.belief || '',
    conceptsImproved: studentModel
      ? Object.entries(studentModel.conceptBeliefs || {})
          .filter(([_, b]: any) => b.understood >= 60)
          .map(([name]) => name)
      : [],
  }

  return {
    studentModel,
    hypothesis,
    currentAction,
    microAction,
    diagnosis,
    stagesCompleted,
    loading,
    error,
    nextMicroAction,
    isSessionComplete,
    sessionSummary,
  }
}
