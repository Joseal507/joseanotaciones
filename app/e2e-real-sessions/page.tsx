'use client'

import { useEffect, useMemo, useState } from 'react'
import IntroSession from '../../components/materias/adaptive/IntroSession'
import PaginatedBookPage from '../../components/materias/adaptive/v3/PaginatedBookPage'
import { emptyEvidenceProfile, getMissingEvidences, isMicroMastered, recordEvidence, type EvidenceProfile, type EvidenceType } from '../../lib/adaptive/v3/engine/evidenceEngine'
import { getContractForType } from '../../lib/adaptive/v3/engine/masteryContracts'
import { evaluateSessionCompletion } from '../../lib/adaptive/v3/engine/stateMachine'
import type { AssistanceLevel } from '../../lib/adaptive/v3/engine/confidenceTracker'
import type { CognitiveType, MicroConcept, SessionState } from '../../lib/adaptive/v3/types'

type Profile = 'capable' | 'misconception_prone' | 'assistance_dependent' | 'low_confidence' | 'random_guesser'
type Phase = 'upload' | 'intro' | 'book' | 'answering' | 'feedback' | 'collecting_confidence' | 'summary' | 'complete'
type Extracted = { materialId: string; file: { name: string; size: number; type: string }; extraction: { text: string; chars: number; pages?: number }; graph: { micros: Array<{ id: string; name: string }> } }
type History = { questionId: string; factKey: string; prompt: string; microId: string; format: string; strategy: string; objective: string; outcome: string; assistance: AssistanceLevel; repetitionIntent: boolean }[]
type Snapshot = { material: Extracted; profile: Profile; phase: Phase; introDone: boolean; microIndex: number; evidence: Record<string, EvidenceProfile>; studied: string[]; processed: string[]; repairs: string[]; interaction: number; answer: unknown; evaluation: Evaluation | null; confidence: number | null; history: History; wrongOnce: string[]; assistance: AssistanceLevel; revealedOnce: boolean; sessionAttempts: Record<string, number>; sessionCount: number; fuseReason: string | null }
type Evaluation = { outcome: 'correct' | 'incorrect'; whatWasCorrect: string; whatWasMissing: string; correctAnswer: string }

const STORAGE = 'studyal:e2e-real-sessions:v1'
const MAX_TURNS = 80

function cognitiveType(name: string, fileName: string): CognitiveType {
  if (/Matematico|Calculo/i.test(fileName)) return 'mathematical'
  if (/Medico|Cardiovascular/i.test(fileName)) return 'applicative'
  if (/causa|efecto|transicion/i.test(name)) return 'causal'
  return 'conceptual'
}

function toMicro(raw: { id: string; name: string }, material: Extracted): MicroConcept {
  const type = cognitiveType(raw.name, material.file.name)
  return {
    id: raw.id, name: raw.name, shortDescription: raw.name, fullDefinition: raw.name,
    cognitiveType: type, difficulty: type === 'mathematical' ? 55 : 45, estimatedMinutes: 4,
    sourceQuotes: [raw.name], sourceChunkIds: [raw.id], sourcePages: material.extraction.pages ? [1] : [],
    examples: [], formulas: [], procedures: [], commonErrors: [], prerequisites: [], enables: [], related: [],
    importance: 'medium', topicGroup: material.file.name, extractedAt: 0,
  }
}

function evidenceSequence(type: CognitiveType): Array<{ format: string; objective: string }> {
  if (type === 'mathematical') return [
    { format: 'fill_blank', objective: 'verify_understanding' },
    { format: 'calculator_check', objective: 'test_application' },
    { format: 'step_by_step_solver', objective: 'test_application' },
    { format: 'practical_case', objective: 'test_transfer' },
  ]
  if (type === 'applicative') return [
    { format: 'fill_blank', objective: 'verify_understanding' },
    { format: 'step_by_step_solver', objective: 'test_application' },
    { format: 'practical_case', objective: 'test_transfer' },
    { format: 'matching', objective: 'test_integration' },
  ]
  if (type === 'causal') return [
    { format: 'multiple_choice', objective: 'verify_understanding' },
    { format: 'teach_back', objective: 'explain_cause_effect' },
    { format: 'prediction', objective: 'test_application' },
  ]
  return [
    { format: 'multiple_choice', objective: 'verify_understanding' },
    { format: 'teach_back', objective: 'verify_understanding' },
    { format: 'matching', objective: 'connect_to_previous' },
  ]
}

const EVIDENCE_ACTIVITY: Record<EvidenceType, { format: string; objective: string }> = {
  recognized: { format: 'multiple_choice', objective: 'verify_understanding' },
  recalled: { format: 'fill_blank', objective: 'verify_understanding' },
  explained: { format: 'teach_back', objective: 'verify_understanding' },
  applied: { format: 'step_by_step_solver', objective: 'test_application' },
  connected: { format: 'matching', objective: 'connect_to_previous' },
  transferred: { format: 'practical_case', objective: 'test_transfer' },
  retained: { format: 'quick_check', objective: 'recall_check' },
}

function canonicalCompletion(state: Snapshot, micros: MicroConcept[]) {
  const required = micros.map(micro => micro.id)
  const session: SessionState = {
    sessionId: `session-${state.microIndex + 1}`, userId: 'e2e-local-user', materialId: state.material.materialId,
    requiredMicroIds: required, retentionMicroIds: [], startedAt: 0, currentTurn: state.history.length,
    totalTurnsCompleted: state.history.length, elapsedSeconds: 0, targetMinutes: 20,
    microStates: Object.fromEntries(micros.map(micro => {
      const profile = state.evidence[micro.id]
      const correct = profile.evidences.filter(evidence => evidence.outcome === 'correct').length
      return [micro.id, {
        microId: micro.id, timeline: [], evidence: {
          introduced: state.studied.includes(micro.id), explainedByTutor: state.studied.includes(micro.id),
          explainedByStudent: profile.strongCount.explained > 0, answeredCorrectly: correct,
          answeredIncorrectly: profile.totalIncorrect, applied: profile.strongCount.applied > 0,
          transferred: profile.hasTransfer, connected: profile.hasIntegration, recalled: profile.strongCount.recalled > 0,
        }, masteryLevel: isMicroMastered(profile, micro) ? 'mastered' : profile.totalIncorrect > 0 ? 'struggling' : 'introduced',
        isReady: isMicroMastered(profile, micro), needsReview: !isMicroMastered(profile, micro),
        totalInteractions: state.processed.includes(micro.id) && !isMicroMastered(profile, micro) ? 12 : profile.totalEvidences + profile.totalIncorrect,
        lastInteractionAt: null, timeSpentSeconds: 0, errorsCommitted: [], misunderstandings: [], evidenceProfile: profile,
        microName: micro.name, sourcePages: micro.sourcePages,
      }]
    })),
    queue: {
      sessionId: `session-${state.microIndex + 1}`, pendingMicroIds: required.filter(id => !state.processed.includes(id)),
      activeMicroId: null, completedMicroIds: state.processed, postponedMicroIds: [], totalPlanned: required.length, createdAt: 0,
    },
    recentTurns: [], totalCorrect: state.history.filter(item => item.outcome === 'correct').length,
    totalIncorrect: state.history.filter(item => item.outcome === 'incorrect').length, totalPartial: 0,
    consecutiveCorrect: 0, consecutiveIncorrect: 0,
    studentState: { energy: 'engaged', pace: 'medium', confidence: state.profile === 'low_confidence' ? 'low' : 'medium' },
  }
  return evaluateSessionCompletion(session, { microConcepts: micros })
}

export default function RealSessionsHarness() {
  const [state, setState] = useState<Snapshot | null>(null)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [profile, setProfile] = useState<Profile>('capable')

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE)
    if (saved) setState(JSON.parse(saved))
    setReady(true)
  }, [])
  useEffect(() => { if (ready && state) localStorage.setItem(STORAGE, JSON.stringify(state)) }, [ready, state])

  const micros = useMemo(() => state ? state.material.graph.micros.map(m => toMicro(m, state.material)) : [], [state])
  const current = micros[state?.microIndex ?? 0]
  const currentProfile = current && state ? state.evidence[current.id] : null
  const sequence = current ? evidenceSequence(current.cognitiveType) : []
  const missingEvidence = current && currentProfile ? getMissingEvidences(currentProfile, current)[0] : undefined
  const activity = missingEvidence ? EVIDENCE_ACTIVITY[missingEvidence] : sequence[0]
  const qid = current && state ? `${state.material.file.name.replace(/\W+/g, '-').toLowerCase()}-${current.id}-${state.interaction}` : ''
  const factKey = current ? `${current.id}:${activity?.format}` : ''
  const strategy = state?.repairs.includes(current?.id || '') ? `repair-${activity?.format}` : `direct-${activity?.format}`
  const prompt = current ? (current.cognitiveType === 'mathematical'
      ? `${activity?.objective} (${activity?.format}, variante ${state?.interaction}): resuelve una situación basada en “${current.name}” y selecciona la conclusión coherente.`
    : current.cognitiveType === 'applicative'
      ? `${activity?.objective} (${activity?.format}, variante ${state?.interaction}): aplica únicamente lo indicado en el documento sobre “${current.name}” al caso descrito.`
      : `${activity?.objective} (${activity?.format}, variante ${state?.interaction}): demuestra comprensión de “${current.name}” sin repetir la formulación anterior.`) : ''
  const correct = current?.name || ''
  const visualFormat = state?.profile === 'misconception_prone' && state.interaction === 2
    ? 'true_false'
    : state?.profile === 'misconception_prone' && state.interaction === 3
    ? 'fill_blank_bank'
    : 'multiple_choice'
  const interactionData = visualFormat === 'true_false'
    ? { statement: `${current?.name || 'El concepto'} aparece como parte del material.`, correctAnswer: true, explanation: 'La afirmación se basa en el material extraído.' }
    : visualFormat === 'fill_blank_bank'
    ? { template: 'La evidencia del material describe ___.', correctAnswers: [correct], bank: [correct, 'una hipótesis alternativa', 'un mecanismo complementario'] }
    : { options: [correct, 'Ninguna relación con el texto', 'Una afirmación externa al documento'], correctIndex: 0 }
  const page = current ? {
    id: qid, type: 'practice', title: 'Actividad basada en el material',
    content: { blocks: [
      { type: 'text', text: state!.material.extraction.text.slice(0, 360) },
      ...(current.cognitiveType === 'mathematical' ? [{ type: 'formula', latex: 'f(x)=x^2', explanation: 'Representación matemática del documento' }] : []),
    ] },
    interaction: { id: qid, questionId: qid, factKey, interactionType: visualFormat, prompt, data: interactionData },
  } : null

  async function ingest(file: File) {
    setLoading(true)
    const form = new FormData(); form.append('file', file)
    const response = await fetch('/api/e2e-real-materials/extract', { method: 'POST', body: form })
    const extracted = await response.json() as Omit<Extracted, 'materialId'>
    if (!response.ok) throw new Error('No se pudo extraer el material')
    const materialId = `mat-e2e-${crypto.randomUUID()}`
    const material: Extracted = {
      ...extracted,
      materialId,
      graph: { ...extracted.graph, micros: extracted.graph.micros.map(micro => ({ ...micro, id: `${materialId}:${micro.id}` })) },
    }
    const selected = material.graph.micros
    const evidence = Object.fromEntries(selected.map(m => [m.id, emptyEvidenceProfile(m.id)]))
    setState({ material, profile, phase: 'intro', introDone: false, microIndex: 0, evidence, studied: [], processed: [], repairs: [], interaction: 1, answer: null, evaluation: null, confidence: null, history: [], wrongOnce: [], assistance: 'independent', revealedOnce: false, sessionAttempts: {}, sessionCount: 1, fuseReason: null })
    setLoading(false)
  }

  function submit(answer: unknown) {
    if (!state || !current || !activity || state.phase !== 'answering') return
    const shouldFail = state.profile === 'random_guesser' || (state.profile === 'misconception_prone' && !state.wrongOnce.includes(current.id))
    const isCorrectAnswer = visualFormat === 'true_false' ? answer === true : visualFormat === 'fill_blank_bank' ? answer === correct : answer === 0
    const outcome: 'correct' | 'incorrect' = !shouldFail && isCorrectAnswer ? 'correct' : 'incorrect'
    const assistance = state.assistance
    const updated = recordEvidence(state.evidence[current.id], {
      formatUsed: activity.format, outcome, score: outcome === 'correct' ? 100 : 0,
      turnNumber: state.history.length + 1, assistanceLevel: assistance,
      selfReportedConfidence: state.profile === 'low_confidence' ? 20 : 80,
      isTransferContext: activity.objective === 'test_transfer',
      connectsToOtherMicro: activity.format === 'matching' ? micros[0]?.id : undefined,
      activityAttemptNumber: 1,
    })
    const repetitionIntent = state.history.some(item => item.factKey === factKey)
    const history: History = [...state.history, { questionId: qid, factKey, prompt, microId: current.id, format: activity.format, strategy, objective: activity.objective, outcome, assistance, repetitionIntent }]
    setState({ ...state, phase: 'feedback', answer, evidence: { ...state.evidence, [current.id]: updated }, studied: [...new Set([...state.studied, current.id])], history, repairs: outcome === 'incorrect' ? [...new Set([...state.repairs, current.id])] : state.repairs, wrongOnce: outcome === 'incorrect' ? [...new Set([...state.wrongOnce, current.id])] : state.wrongOnce, sessionAttempts: { ...state.sessionAttempts, [current.id]: (state.sessionAttempts[current.id] || 0) + 1 }, evaluation: { outcome, whatWasCorrect: 'La respuesta se apoya en el contenido extraído.', whatWasMissing: 'La siguiente actividad cambiará estrategia y representación.', correctAnswer: correct } })
  }

  function continueAfterFeedback() { if (state) setState({ ...state, phase: 'collecting_confidence' }) }
  function setConfidence(confidence: number) { if (state) setState({ ...state, confidence }) }
  function advance() {
    if (!state || !current) return
    const mastered = isMicroMastered(state.evidence[current.id], current)
    const exhausted = state.history.length >= MAX_TURNS
    const microAttempts = state.sessionAttempts[current.id] || 0
    const fused = microAttempts >= 6 || state.profile === 'random_guesser' && state.evidence[current.id].totalIncorrect >= 3
    if (mastered || exhausted || fused) {
      const processed = [...new Set([...state.processed, current.id])]
      if (state.microIndex + 1 < micros.length && !exhausted) setState({ ...state, processed, microIndex: state.microIndex + 1, interaction: state.interaction + 1, phase: 'answering', answer: null, evaluation: null, confidence: null, assistance: 'independent' })
      else setState({ ...state, processed, phase: 'summary', answer: null, evaluation: null, confidence: null, fuseReason: exhausted ? 'global_budget_exhausted' : fused && !mastered ? 'micro_fuse' : null })
    } else setState({ ...state, interaction: state.interaction + 1, phase: 'answering', answer: null, evaluation: null, confidence: null, assistance: 'independent' })
  }

  if (!ready) return <main>Preparando…</main>
  if (!state) return <main data-testid="real-sessions-upload" style={{ padding: 32 }}>
    <h1>Recorrido visual con material real</h1>
    <label>Perfil <select data-testid="student-profile" value={profile} onChange={e => setProfile(e.target.value as Profile)}>{['capable','misconception_prone','assistance_dependent','low_confidence','random_guesser'].map(p => <option key={p}>{p}</option>)}</select></label>
    <input data-testid="real-session-upload" type="file" accept=".pdf,.docx" onChange={e => { const f = e.target.files?.[0]; if (f) void ingest(f) }} />
    {loading && <p>Extrayendo y construyendo el programa…</p>}
  </main>
  if (state.phase === 'intro') return <>
    <style>{`[data-testid="intro-session"] { justify-content: flex-start !important; overflow-y: auto; }`}</style>
    <IntroSession materialTitle={state.material.file.name} materialText={state.material.extraction.text.slice(0, 800)} topicsFound={state.material.graph.micros.map(m => m.name)} isReady onReady={() => setState({ ...state, introDone: true, phase: 'book' })} />
  </>

  const canonical = canonicalCompletion(state, micros)
  const masteredIds = Object.entries(canonical.microResolutions).filter(([, resolution]) => resolution.status === 'mastered').map(([id]) => id)
  const unresolved = canonical.unresolvedMicroIds
  const coverage = canonical.coveragePercent
  const mastery = canonical.masteryPercent
  const isProgramComplete = canonical.isProgramComplete
  const phase = state.phase
  const diagnostics = micros.map(micro => {
    const evidenceProfile = state.evidence[micro.id]
    return { microId: micro.id, cognitiveType: micro.cognitiveType, contract: getContractForType(micro.cognitiveType), evidences: evidenceProfile.evidences, strengths: { strong: evidenceProfile.strongCount, medium: evidenceProfile.mediumCount, weak: evidenceProfile.weakCount }, assistance: evidenceProfile.bestAssistanceByEvidenceType, independentSuccesses: evidenceProfile.independentSuccessesByType, masteryScore: evidenceProfile.masteryScore, missingEvidences: getMissingEvidences(evidenceProfile, micro), resolution: canonical.microResolutions[micro.id], totalInteractions: state.sessionAttempts[micro.id] || 0 }
  })
  const rootAttrs = {
    'data-testid': 'real-session-harness', 'data-material-id': state.material.materialId, 'data-session-id': `session-${state.microIndex + 1}`,
    'data-required-count': micros.length, 'data-studied-count': state.studied.length, 'data-mastered-count': masteredIds.length,
    'data-unresolved-count': unresolved.length, 'data-is-session-complete': String(canonical.isSessionComplete),
    'data-is-program-complete': String(isProgramComplete), 'data-close-reason': canonical.closeReason || '',
    'data-interaction-id': qid, 'data-question-id': qid, 'data-fact-key': factKey, 'data-objective': activity?.objective || '',
    'data-strategy': strategy, 'data-format': activity?.format || '', 'data-assistance-level': state.assistance, 'data-interaction-phase': phase,
    'data-session-count': state.sessionCount, 'data-fuse-reason': state.fuseReason || '', 'data-evidence-diagnostics': JSON.stringify(diagnostics),
    'data-coverage-percent': coverage, 'data-mastery-percent': mastery,
    'data-required-ids': micros.map(micro => micro.id).join(','), 'data-studied-ids': state.studied.join(','),
    'data-mastered-ids': masteredIds.join(','), 'data-unresolved-ids': unresolved.join(','),
    'data-processed-ids': state.processed.join(','), 'data-repair-ids': state.repairs.join(','),
    'data-history': JSON.stringify(state.history),
    'data-graph-ids': micros.map(micro => micro.id).join(','), 'data-assigned-ids': micros.map(micro => micro.id).join(','),
  }
  if (phase === 'book') return <main {...rootAttrs} style={{ padding: 32 }}><h1>Libro canónico — {state.material.file.name}</h1><p>{micros.length} microconceptos requeridos · cobertura {coverage}% · dominio {mastery}%</p><button data-testid="start-session" onClick={() => setState({ ...state, phase: 'answering' })}>Iniciar sesión</button></main>
  if (phase === 'summary' || phase === 'complete') return <main {...rootAttrs} style={{ padding: 32 }}>
    <h1>{isProgramComplete ? 'Programa completado' : 'Sesión completa: refuerzo pendiente'}</h1><p>Cobertura {coverage}% · dominio {mastery}%</p><button data-testid={isProgramComplete ? 'close-program' : 'continue-repair'} onClick={() => {
      if (isProgramComplete) return setState({ ...state, phase: 'complete' })
      const nextId = unresolved[0]
      const nextIndex = Math.max(0, micros.findIndex(micro => micro.id === nextId))
      setState({ ...state, phase: 'book', microIndex: nextIndex, processed: state.processed.filter(id => !unresolved.includes(id)), sessionAttempts: { ...state.sessionAttempts, ...Object.fromEntries(unresolved.map(id => [id, 0])) }, sessionCount: state.sessionCount + 1, fuseReason: null })
    }}>{isProgramComplete ? 'Cerrar programa' : 'Continuar con repair'}</button>
  </main>
  return <main {...rootAttrs} style={{ padding: 24 }}>
    <button data-testid="back-to-book" onClick={() => setState({ ...state, phase: 'book' })}>VOLVER AL LIBRO</button>
    <PaginatedBookPage page={page} onSubmitAnswer={submit} onContinue={continueAfterFeedback} evaluation={state.evaluation} showContinue={phase === 'feedback'} disabled={phase !== 'answering'} />
    {phase === 'answering' && <div><button data-testid="request-hint" onClick={() => setState({ ...state, assistance: 'minimal_hint' })}>Pedir pista</button><button data-testid="reveal-answer" onClick={() => setState({ ...state, assistance: 'revealed', revealedOnce: true })}>Ver respuesta</button></div>}
    {phase === 'collecting_confidence' && <div data-testid="adaptive-confidence"><button onClick={() => setConfidence(20)}>No estaba seguro/a</button><button onClick={() => setConfidence(60)}>Más o menos</button><button onClick={() => setConfidence(90)}>Bastante seguro/a</button>{state.confidence !== null && <button data-testid="confidence-continue" onClick={advance}>Continuar →</button>}</div>}
  </main>
}
