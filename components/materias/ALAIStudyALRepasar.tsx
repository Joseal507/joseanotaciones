'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildSourceSelectionFromMaterials, type SourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { readFreeToolState, writeFreeToolState } from '../../lib/freeToolState'
import { useAuthorizedSource } from '../../lib/materials/useAuthorizedSource'
import {
  createActiveReaderNavigation,
  changeRepasoReaderMaterial,
  moveRepasoReader,
  openRecoveryReader,
  setRepasoReaderZoom,
  type RepasoReaderNavigation,
} from '../../lib/repasoReaderNavigation'

const RepasarViewer = dynamic(() => import('./RepasarViewer'), { ssr: false })
const HAND = 'var(--font-hand)'
const BODY = 'var(--font-body)'

type Phase = 'read' | 'explain' | 'diagnosis' | 'recovery' | 'recovery_reading' | 'recovery_feedback' | 'verification' | 'mastery'

interface Props {
  materiales: any[]
  seleccion?: any[] | null
  tema: any
  materia: any
  onBack: () => void
  onMasteryEvent?: (event: any) => void
  masteryContext?: any
  sessionId?: string | null
  sourceSelection?: SourceSelectionSnapshot
}

interface TargetAnnotation {
  targetId: string
  status: 'covered' | 'partial' | 'missing' | 'incorrect'
  evidence: string
  demonstrated: string
  missingDetail: string
}

interface DiagnosisFeedbackItem {
  targetId: string
  status: 'covered' | 'partial' | 'missing' | 'incorrect'
  title: string
  targetLabel: string
  demonstrated: string
  missing: string
  pages: number[]
  importance: 'critical' | 'supporting' | 'contextual'
  topicId: string | null
  topicTitle: string | null
}

interface VerificationCheck {
  checkId: string
  question: string
  status: 'pending' | 'passed' | 'failed'
  studentAnswer: string | null
}

interface RepasoView {
  artifactId: string
  initialScore?: number
  initialLetterGrade?: string
  initialPaper: {
    explanation: string
    score: number
    letterGrade: string
    annotations: TargetAnnotation[]
    feedback: DiagnosisFeedbackItem[]
  }
  score: number
  letterGrade: string
  masteryStatus: 'not_ready' | 'verification_ready' | 'verifying' | 'mastered'
  scoreHistory: { eventId: string; scoreAfter: number; letterAfter: string; cause: string }[]
  recoveryAttemptCount: number
  groupId?: string
  question?: string
  pagesToReview?: number[]
  recoveryMaterialId?: string
  nextGroupId?: string | null
  finalVerification?: { checks: VerificationCheck[]; passed: boolean } | null
  studentEvidencePaper: { provenance: string; text: string; groupId: string | null; targetIds: string[] }[]
  /** ANTES VS. AHORA — the "after" side: current, post-Recovery canonical
   * target state, same shape as `initialPaper.annotations`. Deterministic,
   * straight from the persisted RepasoArtifact. */
  currentAnnotations?: TargetAnnotation[]
  /** System-coverage-failure targets (never a student mastery failure) —
   * excluded from "remaining unresolved" the same way completion is. */
  nonAssessableTargetIds?: string[]
  // RAW shape as received from the server or restored from persisted/local
  // state. New responses include every pedagogical field; feedback restored
  // from BEFORE the pedagogical-feedback extension (an in-flight session, a
  // stale localStorage snapshot) legitimately omits didWell/needsWork/
  // correction/summary/suggestion/betterExplanation/hint/pages — those are
  // optional here on purpose. Never read this shape directly in JSX; go
  // through normalizeRepasoRecoveryFeedback first (see below).
  feedback?: {
    status: 'correct' | 'partial' | 'incorrect' | 'missing'
    title: string
    summary?: string
    demonstrated: string[]
    missing: string[]
    didWell?: string[]
    needsWork?: string[]
    correction?: string[]
    suggestion?: string
    betterExplanation?: string
    hint?: string
    enrichment?: string[]
    pages?: number[]
    scoreBefore: number
    scoreAfter: number
    letterBefore: string
    letterAfter: string
    scoreChanged: boolean
    groupResolved: boolean
  }
}

/** Render-safe shape — every field guaranteed present, never `undefined`. */
interface NormalizedRepasoRecoveryFeedback {
  status: 'correct' | 'partial' | 'incorrect' | 'missing'
  title: string
  summary: string
  didWell: string[]
  needsWork: string[]
  correction: string[]
  suggestion: string
  betterExplanation: string
  hint: string
  enrichment: string[]
  pages: number[]
  scoreBefore: number
  scoreAfter: number
  letterBefore: string
  letterAfter: string
  scoreChanged: boolean
  groupResolved: boolean
}

/**
 * Normalizes a Recovery feedback payload at the render boundary so legacy
 * feedback (persisted/restored from before the pedagogical-feedback
 * extension) never crashes the renderer. Legacy data maps its old
 * `demonstrated`/`missing` arrays onto the new `didWell`/`needsWork` slots;
 * every genuinely new-only field (correction/suggestion/betterExplanation/
 * hint/pages/summary) simply defaults to an empty value — nothing is
 * fabricated for old attempts, sections are just omitted by the JSX when
 * their normalized value is empty.
 */
function normalizeRepasoRecoveryFeedback(feedback: NonNullable<RepasoView['feedback']>): NormalizedRepasoRecoveryFeedback {
  return {
    status: feedback.status,
    title: feedback.title,
    summary: feedback.summary ?? '',
    didWell: feedback.didWell ?? feedback.demonstrated ?? [],
    needsWork: feedback.needsWork ?? feedback.missing ?? [],
    correction: feedback.correction ?? [],
    suggestion: feedback.suggestion ?? '',
    betterExplanation: feedback.betterExplanation ?? '',
    hint: feedback.hint ?? '',
    enrichment: feedback.enrichment ?? [],
    pages: feedback.pages ?? [],
    scoreBefore: feedback.scoreBefore,
    scoreAfter: feedback.scoreAfter,
    letterBefore: feedback.letterBefore,
    letterAfter: feedback.letterAfter,
    scoreChanged: feedback.scoreChanged,
    groupResolved: feedback.groupResolved,
  }
}

interface PersistedState {
  artifactId: string | null
  phase: Phase
  explanation: string
  answer: string
  readerNavigation?: RepasoReaderNavigation
  readerPage?: number | null
  view: RepasoView | null
}

const paper: React.CSSProperties = {
  backgroundColor: '#fffdf8',
  backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 31px, rgba(91,127,166,.13) 32px)',
  color: '#222', border: '1px solid #dfd7c7', borderRadius: 5,
  boxShadow: '0 16px 45px rgba(0,0,0,.13)', padding: '34px clamp(22px,5vw,64px)',
}
const button: React.CSSProperties = {
  border: 0, borderRadius: 12, padding: '12px 18px', background: 'var(--gold)',
  color: '#171717', fontFamily: BODY, fontWeight: 900, cursor: 'pointer',
}
const textarea: React.CSSProperties = {
  width: '100%', minHeight: 190, resize: 'vertical', boxSizing: 'border-box',
  border: '1px solid #cfc6b4', borderRadius: 5, padding: 18, background: 'rgba(255,255,255,.72)',
  color: '#222', font: `16px/1.75 ${BODY}`, outline: 'none',
}

function phaseFor(view: RepasoView): Phase {
  if (view.masteryStatus === 'mastered') return 'mastery'
  if (view.groupId || view.nextGroupId) return 'recovery'
  return 'diagnosis'
}

/**
 * Centralized, deterministic grade→color mapping — F red, D orange/amber,
 * C yellow/gold, B cyan/blue-green, A family green — so the letter grade
 * itself visually communicates improvement without scattering ad hoc CSS
 * conditionals across the component. Only the grade accent changes color;
 * the page keeps StudyAL's dark visual identity.
 */
function repasoGradeColor(letter: string): string {
  const base = String(letter || '').trim().charAt(0).toUpperCase()
  switch (base) {
    case 'A': return '#34d399' // green
    case 'B': return '#22c3d6' // cyan / blue-green
    case 'C': return '#f2c94c' // yellow / gold
    case 'D': return '#f2994a' // orange / warm amber
    default: return '#e5484d' // F and anything unrecognized -> red
  }
}

function attemptId(prefix: string) {
  return `${prefix}_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`}`
}

interface RecoveryGroupSnapshot {
  groupId?: string
  question?: string
  pagesToReview?: number[]
  recoveryMaterialId?: string
}

/**
 * The Recovery group's identity (groupId/question/pagesToReview/
 * recoveryMaterialId) must always come from ONE response, as one atomic
 * unit — never a groupId from one payload paired with a question left over
 * from a previous one. A response that carries a groupId but no matching
 * question is refused outright rather than silently mixed with the
 * previous snapshot, which is exactly the class of desync a live Recovery
 * bug traced back to (Group B's id entering the view while Group A's
 * frozen question text stayed on screen).
 */
function applyRecoveryGroupSnapshot(
  previous: RecoveryGroupSnapshot | null | undefined,
  incoming: RecoveryGroupSnapshot,
): RecoveryGroupSnapshot {
  const hasGroupIdentity = Boolean(incoming.groupId)
  const hasQuestion = Boolean(incoming.question)
  if (hasGroupIdentity && !hasQuestion) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[repaso-recovery-client-snapshot] refused: groupId without a matching question', { incomingGroupId: incoming.groupId })
    }
    return {
      groupId: previous?.groupId,
      question: previous?.question,
      pagesToReview: previous?.pagesToReview,
      recoveryMaterialId: previous?.recoveryMaterialId,
    }
  }
  return {
    groupId: incoming.groupId,
    question: incoming.question,
    pagesToReview: incoming.pagesToReview,
    recoveryMaterialId: incoming.recoveryMaterialId,
  }
}

function statusLabel(status: TargetAnnotation['status']) {
  if (status === 'covered') return 'Bien demostrado'
  if (status === 'partial') return 'Parcial'
  if (status === 'incorrect') return 'Necesita corrección'
  return 'No apareció'
}

const REPASO_RETRYABLE_ERROR_CODES = new Set([
  'REPASO_RECOVERY_GROUNDING_INCOMPLETE',
  'REPASO_RECOVERY_QUESTION_UNSUPPORTED',
  'REPASAR_COVERAGE_INCOMPLETE_RETRYABLE',
])

function friendlyRepasoError(code: string) {
  if (REPASO_RETRYABLE_ERROR_CODES.has(code)) {
    const suffix = process.env.NODE_ENV !== 'production' ? ` (${code})` : ''
    return `No pudimos preparar esta parte del repaso. Inténtalo de nuevo.${suffix}`
  }
  return code
}

const IMPORTANCE_ORDER: Record<DiagnosisFeedbackItem['importance'], number> = { critical: 0, supporting: 1, contextual: 2 }
const STATUS_BORDER: Record<DiagnosisFeedbackItem['status'], string> = {
  covered: '#3d8b57', partial: '#b58a1a', missing: '#8a7f6a', incorrect: '#b62424',
}

function groupDiagnosisFeedback(feedback: DiagnosisFeedbackItem[]) {
  const sorted = [...feedback].sort((a, b) => IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance])
  const groups = new Map<string, { topicTitle: string; items: DiagnosisFeedbackItem[] }>()
  for (const item of sorted) {
    const key = item.topicId || '__sin_tema__'
    if (!groups.has(key)) groups.set(key, { topicTitle: item.topicTitle || 'General', items: [] })
    groups.get(key)!.items.push(item)
  }
  return [...groups.values()]
}

function DiagnosisFeedbackCard({ item }: { item: DiagnosisFeedbackItem }) {
  return (
    <div style={{ borderLeft: `3px solid ${STATUS_BORDER[item.status]}`, paddingLeft: 12 }}>
      <strong>{item.title}: {item.targetLabel}</strong>
      {item.demonstrated && <div>{item.demonstrated}</div>}
      {item.missing && <div style={{ color: '#9d2828' }}>{item.status === 'covered' ? '' : 'Te faltó: '}{item.missing}</div>}
    </div>
  )
}

export default function ALAIStudyALRepasar({
  materiales, seleccion, tema, materia, onBack, onMasteryEvent, sessionId, sourceSelection,
}: Props) {
  const selection = useMemo(
    () => sourceSelection || buildSourceSelectionFromMaterials(materiales, seleccion),
    [sourceSelection, materiales, seleccion],
  )
  const { status: sourceStatus } = useAuthorizedSource(selection, 'ALAIStudyALRepasar')
  const initialMaterialId = selection.materialIds[0] || null
  const [phase, setPhase] = useState<Phase>('read')
  const [explanation, setExplanation] = useState('')
  const [answer, setAnswer] = useState('')
  const [readerNavigation, setReaderNavigation] = useState<RepasoReaderNavigation>(() => createActiveReaderNavigation({
    materialId: initialMaterialId,
    selectedPages: initialMaterialId ? selection.selectedPages[initialMaterialId] || [] : [],
  }))
  const [artifactId, setArtifactId] = useState<string | null>(null)
  const [view, setView] = useState<RepasoView | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const flightRef = useRef<string | null>(null)
  const masteryReportedRef = useRef(false)

  const persist = useCallback((next: PersistedState) => {
    if (!sessionId) return
    writeFreeToolState(sessionId, selection.fingerprint, 'repasar', next)
  }, [sessionId, selection.fingerprint])

  const request = useCallback(async (identity: string, body: Record<string, unknown>) => {
    if (!sessionId || flightRef.current) return null
    flightRef.current = identity
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/alai-studyal-repasar', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        signal: controller.signal, body: JSON.stringify({ sessionId, ...body }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(friendlyRepasoError(data?.error || 'No se pudo continuar el repaso.'))
      return data as RepasoView
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'No se pudo continuar el repaso.')
      return null
    } finally {
      if (flightRef.current === identity) flightRef.current = null
      setBusy(false)
    }
  }, [sessionId])

  useEffect(() => {
    const saved = readFreeToolState<PersistedState>(sessionId, selection.fingerprint, 'repasar')?.state
    if (saved) {
      setArtifactId(saved.artifactId || null)
      setExplanation(saved.explanation || '')
      setAnswer(saved.answer || '')
      const legacyAllowedPages = (saved.readerNavigation as unknown as { allowedPages?: number[] } | undefined)?.allowedPages
      setReaderNavigation(saved.readerNavigation ? {
        ...saved.readerNavigation,
        selectedPages: saved.readerNavigation.selectedPages || legacyAllowedPages || [],
        recommendedPages: saved.readerNavigation.recommendedPages || [],
        zoom: saved.readerNavigation.zoom || 1.18,
      } : createActiveReaderNavigation({
        materialId: initialMaterialId,
        selectedPages: initialMaterialId ? selection.selectedPages[initialMaterialId] || [] : [],
        restoredPage: saved.readerPage,
      }))
      // CANONICAL RESTORE IS AUTHORITATIVE: the persisted RepasoArtifact on
      // the server, not this local navigation cache, decides what
      // academic question/pages/groupId are current — the server may
      // repair or replace them (e.g. the stale-deictic self-heal) on
      // repaso-restore. A cached `view`/`phase` implying an open Recovery
      // question (or its feedback) must never be rendered as current
      // before that canonical response arrives — not even briefly — since
      // a live bug showed a stale/misleading question rendering forever
      // whenever the restore request never actually fired (e.g. `sessionId`
      // not yet resolved at mount). Only non-academic UI convenience state
      // (the student's own draft explanation/answer, reader position) is
      // safe to hydrate immediately from cache.
      if (saved.artifactId) {
        if (sessionId) {
          void request(`restore:${saved.artifactId}`, { kind: 'repaso-restore', artifactId: saved.artifactId })
            .then(restored => {
              if (!restored) return
              const restoreFeedback = saved.phase === 'recovery_feedback' && saved.view?.feedback
              const restoredView = restoreFeedback ? { ...restored, feedback: saved.view!.feedback } : restored
              const nextPhase = restoreFeedback
                ? 'recovery_feedback'
                : saved.phase === 'recovery_reading' && restored.groupId
                  ? 'recovery_reading'
                  : phaseFor(restored)
              setView(restoredView); setPhase(nextPhase)
              persist({ artifactId: restored.artifactId, phase: nextPhase, explanation: restored.initialPaper.explanation, answer: saved.answer || '', readerNavigation: saved.readerNavigation, view: restoredView })
            })
        }
        // else: sessionId not resolved yet — this effect re-runs once it
        // is (sessionId is a dependency below), and canonical restore
        // fires then. `view`/`phase` stay at their safe defaults
        // (null/'read') in the meantime, never the stale cached academic
        // state.
      } else {
        setView(saved.view || null)
        setPhase(saved.phase || 'read')
      }
    } else {
      setReaderNavigation(createActiveReaderNavigation({
        materialId: initialMaterialId,
        selectedPages: initialMaterialId ? selection.selectedPages[initialMaterialId] || [] : [],
      }))
      setPhase('read')
    }
    setReady(true)
    return () => controllerRef.current?.abort()
  }, [sessionId, selection.fingerprint, request, persist])

  useEffect(() => {
    if (!ready) return
    persist({ artifactId, phase, explanation, answer, readerNavigation, view })
  }, [ready, artifactId, phase, explanation, answer, readerNavigation, view, persist])

  useEffect(() => {
    if (view?.masteryStatus !== 'mastered' || masteryReportedRef.current) return
    masteryReportedRef.current = true
    onMasteryEvent?.({ type: 'repaso_mastered', score: view.score, artifactId: view.artifactId })
  }, [view, onMasteryEvent])

  const accept = useCallback((next: RepasoView) => {
    if (process.env.NODE_ENV !== 'production') {
      const snapshot = applyRecoveryGroupSnapshot(view, next)
      console.log('[repaso-recovery-client-response]', {
        previousGroupId: view?.groupId ?? null,
        previousQuestion: view?.question ?? null,
        responseGroupId: next.groupId ?? null,
        responseQuestion: next.question ?? null,
        nextGroupId: next.nextGroupId ?? null,
        resultingGroupId: snapshot.groupId ?? null,
        resultingQuestion: snapshot.question ?? null,
      })
    }
    setView(next); setArtifactId(next.artifactId); setAnswer('')
    setPhase(phaseFor(next))
  }, [view])

  const startDiagnosis = async () => {
    if (!explanation.trim()) return setError('Escribe tu explicación antes de entregarla.')
    const next = await request('initial', { kind: 'repaso-initial', explanation })
    if (next) { accept(next); setPhase('diagnosis') }
  }

  const openRecovery = async () => {
    if (!artifactId) return
    const next = await request(`recovery-open:${artifactId}`, { kind: 'repaso-recovery-open', artifactId })
    if (!next) return
    accept(next)
    if (!next.groupId && next.masteryStatus === 'verification_ready') await openVerification(next.artifactId)
  }

  const submitRecovery = async () => {
    if (!artifactId || !view?.groupId || !answer.trim()) return
    if (process.env.NODE_ENV !== 'production') {
      console.log('[repaso-recovery-client-submit]', {
        phase, groupId: view?.groupId ?? null, question: view?.question ?? null,
        pagesToReview: view?.pagesToReview ?? [], recoveryAttemptCount: view?.recoveryAttemptCount ?? null,
      })
    }
    const id = attemptId('recovery')
    const next = await request(id, {
      kind: 'repaso-recovery-answer', artifactId, groupId: view.groupId,
      attemptClientId: id, answer,
    })
    if (!next) return
    // The answer response snapshots the group JUST ANSWERED (never the
    // group `nextGroupId` merely points at) — applyRecoveryGroupSnapshot
    // additionally refuses to ever pair one response's groupId with a
    // DIFFERENT response's question, so the feedback/retry screen can never
    // show a mismatched academic identity even if a future response shape
    // regresses this invariant.
    const snapshot = applyRecoveryGroupSnapshot(view, next)
    if (process.env.NODE_ENV !== 'production') {
      console.log('[repaso-recovery-client-response]', {
        previousGroupId: view.groupId ?? null,
        previousQuestion: view.question ?? null,
        responseGroupId: next.groupId ?? null,
        responseQuestion: next.question ?? null,
        nextGroupId: next.nextGroupId ?? null,
        resultingGroupId: snapshot.groupId ?? null,
        resultingQuestion: snapshot.question ?? null,
      })
    }
    setView({ ...next, ...snapshot }); setArtifactId(next.artifactId); setAnswer(''); setPhase('recovery_feedback')
  }

  const continueAfterRecoveryFeedback = async () => {
    if (!artifactId || !view?.feedback?.groupResolved) return
    if (view.masteryStatus === 'verification_ready') return openVerification(artifactId)
    await openRecovery()
  }

  const openVerification = async (id = artifactId) => {
    if (!id) return
    const next = await request(`final-open:${id}`, { kind: 'repaso-final-open', artifactId: id })
    if (next) accept(next)
  }

  const pendingCheck = view?.finalVerification?.checks.find(check => check.status === 'pending') || null
  const submitVerification = async () => {
    if (!artifactId || !pendingCheck || !answer.trim()) return
    const id = attemptId('verification')
    const next = await request(id, {
      kind: 'repaso-final-answer', artifactId, checkId: pendingCheck.checkId,
      attemptClientId: id, answer,
    })
    if (!next) return
    accept(next)
    if (next.masteryStatus === 'not_ready') await openRecovery()
  }

  const reset = () => {
    controllerRef.current?.abort(); setArtifactId(null); setView(null); setExplanation(''); setAnswer(''); setError(''); setPhase('read')
    const navigation = createActiveReaderNavigation({
      materialId: initialMaterialId,
      selectedPages: initialMaterialId ? selection.selectedPages[initialMaterialId] || [] : [],
    })
    setReaderNavigation(navigation)
    persist({ artifactId: null, phase: 'read', explanation: '', answer: '', readerNavigation: navigation, view: null })
  }

  const selectReaderMaterial = useCallback((materialId: string) => {
    setReaderNavigation(current => changeRepasoReaderMaterial(
      current,
      materialId,
      selection.selectedPages[materialId] || [],
    ))
  }, [selection.selectedPages])

  const selectReaderPage = useCallback((absolutePage: number) => {
    setReaderNavigation(current => moveRepasoReader(current, absolutePage))
  }, [])

  const selectReaderZoom = useCallback((zoom: number) => {
    setReaderNavigation(current => setRepasoReaderZoom(current, zoom))
  }, [])

  const beginRecoveryReading = () => {
    if (!view?.groupId || !view.pagesToReview?.length) return
    const materialId = view.recoveryMaterialId || readerNavigation.materialId
    setReaderNavigation(current => openRecoveryReader(current, {
      materialId,
      selectedPages: materialId ? selection.selectedPages[materialId] || [] : [],
      recommendedPages: view.pagesToReview || [],
      recoveryGroupId: view.groupId,
    }))
    setPhase('recovery_reading')
  }

  const PaperHeader = ({ title, score, letter }: { title: string; score: number; letter: string }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'start', borderBottom: '1px solid #cabfa9', paddingBottom: 18, marginBottom: 24 }}>
      <div><div style={{ font: `800 13px ${BODY}`, letterSpacing: '.14em', color: '#756c5e' }}>STUDYAL · REPASO</div><h2 style={{ font: `42px/1 ${HAND}`, margin: '8px 0 0' }}>{title}</h2></div>
      <div style={{ color: repasoGradeColor(letter), textAlign: 'center', transform: 'rotate(-3deg)' }}><div style={{ font: `76px/.8 ${HAND}`, fontWeight: 900 }}>{letter}</div><div style={{ font: `800 15px ${BODY}`, color: '#5c5346' }}>{score}/100</div></div>
    </div>
  )

  // ANTES VS. AHORA — deterministic counts straight from the persisted
  // RepasoArtifact's own annotations (initial vs current canonical target
  // state). Non-assessable targets (a system coverage fact, never a
  // student mastery fact) are excluded from BOTH sides' totals and from
  // "remaining unresolved" — never fabricated, never re-adjudicated.
  const beforeAfter = useMemo(() => {
    if (!view) return null
    const nonAssessable = new Set(view.nonAssessableTargetIds || [])
    const countBy = (annotations: TargetAnnotation[] | undefined) => {
      const scoped = (annotations || []).filter(a => !nonAssessable.has(a.targetId))
      return {
        total: scoped.length,
        covered: scoped.filter(a => a.status === 'covered').length,
        partial: scoped.filter(a => a.status === 'partial').length,
        missingOrIncorrect: scoped.filter(a => a.status === 'missing' || a.status === 'incorrect').length,
      }
    }
    return { before: countBy(view.initialPaper.annotations), after: countBy(view.currentAnnotations) }
  }, [view])

  return <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: BODY, padding: '14px clamp(10px,2vw,28px) 42px' }}>
    <div style={{ maxWidth: 1640, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <button onClick={onBack} style={{ ...button, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>← Volver al proceso</button>
        <div style={{ textAlign: 'center' }}><h1 style={{ font: `48px/1 ${HAND}`, margin: 0 }}>Repaso</h1><div style={{ color: 'var(--text-muted)', fontSize: 13 }}>LECTURA ACTIVA → DIAGNÓSTICO → RECUPERACIÓN → DOMINIO</div></div>
        <button onClick={reset} style={{ ...button, background: 'transparent', color: 'var(--text-muted)', border: '1px dashed var(--border-color)', fontSize: 12 }}>Nuevo</button>
      </header>

      {phase === 'read' && <div style={{ display: 'grid', gap: 16 }}>
        <RepasarViewer materiales={materiales} seleccion={seleccion} phase="lectura" themeColor="#55e6c1" activeColor="rgba(85,230,193,.42)" currentPage={readerNavigation.currentPage} currentMaterialId={readerNavigation.materialId} zoom={readerNavigation.zoom} onZoomChange={selectReaderZoom} onPageChange={selectReaderPage} onMaterialChange={selectReaderMaterial} />
        <div style={{ display: 'grid', placeItems: 'center', gap: 9 }}><div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 900, letterSpacing: '.18em' }}>LECTURA ACTIVA</div><button style={{ ...button, minWidth: 220, background: '#55e6c1', boxShadow: '0 12px 28px rgba(85,230,193,.16)', opacity: sourceStatus === 'loading' ? .5 : 1 }} disabled={sourceStatus === 'loading'} onClick={() => setPhase('explain')}>{sourceStatus === 'loading' ? 'Preparando lectura…' : 'Ya terminé de leer'}</button></div>
      </div>}

      {phase === 'explain' && <section style={{ ...paper, maxWidth: 800, margin: '0 auto' }}><button onClick={() => setPhase('read')} style={{ ...button, background: 'transparent', color: '#6f6658', paddingLeft: 0 }}>← Volver al material</button><h2 style={{ font: `44px/1.05 ${HAND}`, marginTop: 18 }}>Explica con tus propias palabras todo lo que aprendiste de estas lecturas.</h2><p style={{ color: '#716858', lineHeight: 1.65 }}>No necesitas recordar cada detalle. Explica lo que puedas sin mirar el material.</p><textarea value={explanation} onChange={event => setExplanation(event.target.value)} style={textarea} placeholder="Escribe aquí tu explicación…" disabled={busy} /><div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><button style={{ ...button, opacity: explanation.trim() && !busy ? 1 : .5 }} disabled={!explanation.trim() || busy} onClick={startDiagnosis}>{busy ? 'Corrigiendo…' : 'Entregar explicación'}</button></div></section>}

      {phase === 'diagnosis' && view && (() => {
        const feedback = view.initialPaper.feedback && view.initialPaper.feedback.length
          ? view.initialPaper.feedback
          : view.initialPaper.annotations.map(annotation => ({
            targetId: annotation.targetId, status: annotation.status, title: statusLabel(annotation.status),
            targetLabel: annotation.targetId, demonstrated: annotation.demonstrated,
            missing: annotation.missingDetail || (annotation.status !== 'covered' ? `${annotation.targetId}.` : ''),
            pages: [], importance: 'contextual' as const, topicId: null, topicTitle: null,
          }))
        const demonstrated = feedback.filter(item => item.status === 'covered').length
        const partial = feedback.filter(item => item.status === 'partial').length
        const porTrabajar = feedback.length - demonstrated - partial
        const groups = groupDiagnosisFeedback(feedback)
        return <section style={{ ...paper, maxWidth: 860, margin: '0 auto' }}>
          <PaperHeader title="Tu diagnóstico" score={view.initialPaper.score} letter={view.initialPaper.letterGrade} />
          <div style={{ whiteSpace: 'pre-wrap', font: `17px/2 ${BODY}`, padding: '0 8px 20px', borderLeft: '3px solid #d9cfbb' }}>{view.initialPaper.explanation}</div>
          <div style={{ display: 'flex', gap: 18, fontWeight: 900, margin: '8px 0 18px' }}>
            <span style={{ color: '#3d8b57' }}>Demostraste: {demonstrated}</span>
            <span style={{ color: '#b58a1a' }}>Parcial: {partial}</span>
            <span style={{ color: '#9d2828' }}>Por trabajar: {porTrabajar}</span>
          </div>
          <details style={{ marginTop: 8 }} open>
            <summary style={{ cursor: 'pointer', fontWeight: 900 }}>Ver el detalle completo ({feedback.length})</summary>
            <div style={{ display: 'grid', gap: 18, marginTop: 12 }}>
              {groups.map(group => <div key={group.topicTitle}>
                <div style={{ fontWeight: 900, color: '#6f6658', marginBottom: 8 }}>{group.topicTitle}</div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {group.items.map(item => <DiagnosisFeedbackCard key={item.targetId} item={item} />)}
                </div>
              </div>)}
            </div>
          </details>
          <div style={{ marginTop: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            <div style={{ color: '#6f6658' }}>{view.score === 100 ? 'Cobertura recuperada: 100% · Verificación final pendiente' : 'Vamos a trabajar exactamente lo que falta.'}</div>
            <button style={button} onClick={view.masteryStatus === 'verification_ready' ? () => openVerification() : openRecovery}>{view.masteryStatus === 'verification_ready' ? 'Empezar verificación final' : 'Vamos a mejorar tu nota.'}</button>
          </div>
        </section>
      })()}

      {phase === 'recovery' && view?.groupId && <section style={{ ...paper, maxWidth: 780, margin: '0 auto' }}><PaperHeader title="Recuperación" score={view.score} letter={view.letterGrade} /><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}><div style={{ color: '#716858', fontWeight: 800 }}>Páginas recomendadas: {view.pagesToReview?.length ? view.pagesToReview.join(', ') : 'selección actual'}</div><button style={{ ...button, background: '#efe8d8' }} disabled={!view.pagesToReview?.length} onClick={beginRecoveryReading}>Revisar estas páginas</button></div><h2 style={{ font: `38px/1.15 ${HAND}`, margin: '24px 0 16px' }}>{view.question}</h2><textarea style={textarea} value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Explícalo con tus palabras…" disabled={busy} /><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: 14, flexWrap: 'wrap' }}><span style={{ color: '#716858' }}>{view.recoveryAttemptCount} respuestas de recuperación</span><button style={{ ...button, opacity: answer.trim() && !busy ? 1 : .5 }} disabled={!answer.trim() || busy} onClick={submitRecovery}>{busy ? 'Evaluando…' : 'Entregar respuesta'}</button></div></section>}

      {phase === 'recovery_feedback' && view?.feedback && (() => {
        const feedback = normalizeRepasoRecoveryFeedback(view.feedback)
        return <section style={{ ...paper, maxWidth: 720, margin: '0 auto' }}><PaperHeader title="Resultado de recuperación" score={view.score} letter={view.letterGrade} /><div style={{ border: `1px solid ${feedback.status === 'correct' ? '#3d8b57' : feedback.status === 'partial' ? '#b48b26' : '#b62424'}`, borderRadius: 10, padding: 22, background: 'rgba(255,255,255,.62)' }}><h2 style={{ font: `38px/1.1 ${HAND}`, margin: 0, color: feedback.status === 'correct' ? '#287044' : feedback.status === 'partial' ? '#8b6716' : '#9d2828' }}>{feedback.status === 'correct' ? '✓' : feedback.status === 'partial' ? '◐' : feedback.status === 'incorrect' ? '✕' : '○'} {feedback.title}</h2><p style={{ lineHeight: 1.7 }}>{feedback.summary || (feedback.status === 'missing' ? 'Vamos a reforzarlo. Revisa el material y vuelve a intentarlo.' : 'Revisa la evidencia y vuelve a explicarlo con tus palabras.')}</p>{feedback.didWell.length > 0 && <div style={{ marginTop: 14 }}><strong>LO QUE HICISTE BIEN</strong><div style={{ marginTop: 5 }}>{feedback.didWell.join(' · ')}</div></div>}{feedback.status === 'incorrect' && feedback.correction.length > 0 ? <div style={{ marginTop: 14, color: '#8f2020' }}><strong>LO QUE HAY QUE CORREGIR</strong><div style={{ marginTop: 5 }}>{feedback.correction.join(' · ')}</div></div> : feedback.needsWork.length > 0 && <div style={{ marginTop: 14, color: '#8f2020' }}><strong>LO QUE TE FALTÓ</strong><div style={{ marginTop: 5 }}>{feedback.needsWork.join(' · ')}</div></div>}{feedback.suggestion && <div style={{ marginTop: 14 }}><strong>CÓMO MEJORARLO</strong><div style={{ marginTop: 5 }}>{feedback.suggestion}</div></div>}{feedback.status === 'missing' && feedback.hint && <div style={{ marginTop: 14 }}><strong>PISTA</strong><div style={{ marginTop: 5 }}>{feedback.hint}</div></div>}{feedback.betterExplanation && <div style={{ marginTop: 14 }}><strong>UNA MEJOR FORMA DE EXPLICARLO</strong><div style={{ marginTop: 5 }}>{feedback.betterExplanation}</div></div>}{feedback.enrichment.length > 0 && <div style={{ marginTop: 14, color: '#6f6658' }}>{feedback.enrichment.join(' ')}</div>}<div style={{ marginTop: 16 }}>{feedback.status === 'missing' ? 'Vuelve al material y después inténtalo otra vez.' : feedback.status === 'correct' ? '' : 'Ahora inténtalo otra vez con tus palabras.'}</div><div style={{ marginTop: 20, fontWeight: 900 }}>{feedback.scoreChanged ? `${feedback.letterBefore} ${feedback.scoreBefore} → ${feedback.letterAfter} ${feedback.scoreAfter}` : `Tu nota se mantiene en ${feedback.letterAfter} · ${feedback.scoreAfter}/100`}</div></div><div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>{feedback.groupResolved ? <button style={button} onClick={continueAfterRecoveryFeedback}>Continuar</button> : <><button style={{ ...button, background: '#efe8d8' }} onClick={beginRecoveryReading}>Volver a estudiar</button><button style={button} onClick={() => setPhase('recovery')}>Intentar de nuevo</button></>}</div></section>
      })()}

      {phase === 'recovery_reading' && view?.groupId && <div style={{ display: 'grid', gap: 14 }}><div style={{ position: 'sticky', top: 8, zIndex: 60, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: 'rgba(8,10,15,.94)', border: '1px solid rgba(85,230,193,.28)', borderRadius: 12, padding: 10 }}><button style={{ ...button, background: '#55e6c1' }} onClick={() => setPhase('recovery')}>← Volver a la pregunta</button><div style={{ color: 'var(--text-muted)', fontWeight: 800 }}>Punto de partida recomendado: {readerNavigation.recommendedPages.join(', ')}</div></div><RepasarViewer materiales={materiales} seleccion={seleccion} phase="lectura" themeColor="#55e6c1" activeColor="rgba(85,230,193,.42)" currentPage={readerNavigation.currentPage} currentMaterialId={readerNavigation.materialId} pageFilter={readerNavigation.selectedPages} recommendedPages={readerNavigation.recommendedPages} zoom={readerNavigation.zoom} onZoomChange={selectReaderZoom} onPageChange={selectReaderPage} onMaterialChange={selectReaderMaterial} /></div>}

      {phase === 'verification' && view && <section style={{ ...paper, maxWidth: 760, margin: '0 auto' }}><PaperHeader title="Verificación final" score={view.score} letter={view.letterGrade} /><div style={{ padding: 14, border: '2px solid #b62424', color: '#8f2020', fontWeight: 900, textAlign: 'center', marginBottom: 22 }}>A LIBRO CERRADO · Sin pistas ni páginas</div>{pendingCheck ? <><div style={{ color: '#716858' }}>Pregunta {view.finalVerification!.checks.filter(c => c.status !== 'pending').length + 1} de {view.finalVerification!.checks.length}</div><h2 style={{ font: `38px/1.15 ${HAND}` }}>{pendingCheck.question}</h2><textarea style={textarea} value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Responde sin consultar el material…" disabled={busy} /><div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><button style={{ ...button, opacity: answer.trim() && !busy ? 1 : .5 }} disabled={!answer.trim() || busy} onClick={submitVerification}>{busy ? 'Verificando…' : 'Confirmar respuesta'}</button></div></> : <button style={button} onClick={() => openVerification()}>Preparar verificación</button>}</section>}

      {phase === 'mastery' && view && <div style={{ display: 'grid', gap: 28 }}>
        <section style={{ ...paper, textAlign: 'center', paddingTop: 34, paddingBottom: 34 }}>
          <div style={{ font: `800 13px ${BODY}`, letterSpacing: '.18em', color: '#756c5e' }}>STUDYAL · REPASO</div>
          <h1 style={{ font: `54px/1.05 ${HAND}`, margin: '10px 0 18px' }}>REPASO COMPLETADO</h1>
          <div style={{ color: repasoGradeColor(view.letterGrade), fontWeight: 900 }}>
            <div style={{ font: `96px/.85 ${HAND}` }}>{view.letterGrade}</div>
            <div style={{ font: `800 20px ${BODY}`, marginTop: 6 }}>{view.score}/100</div>
          </div>
        </section>
        {beforeAfter && <section style={{ ...paper, paddingTop: 25, paddingBottom: 25 }}>
          <h2 style={{ font: `36px ${HAND}`, margin: '0 0 18px' }}>ANTES VS. AHORA</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <div style={{ font: `800 13px ${BODY}`, letterSpacing: '.1em', color: '#9d8b6f', marginBottom: 8 }}>ANTES</div>
              <div style={{ color: repasoGradeColor(view.initialPaper.letterGrade), fontWeight: 900, font: `34px/1 ${HAND}` }}>{view.initialPaper.letterGrade} · {view.initialPaper.score}/100</div>
              <ul style={{ marginTop: 12, paddingLeft: 18, lineHeight: 1.9 }}>
                <li>Demostrado: {beforeAfter.before.covered}</li>
                <li>Parcial: {beforeAfter.before.partial}</li>
                <li>Faltante/incorrecto: {beforeAfter.before.missingOrIncorrect}</li>
              </ul>
            </div>
            <div>
              <div style={{ font: `800 13px ${BODY}`, letterSpacing: '.1em', color: '#9d8b6f', marginBottom: 8 }}>AHORA</div>
              <div style={{ color: repasoGradeColor(view.letterGrade), fontWeight: 900, font: `34px/1 ${HAND}` }}>{view.letterGrade} · {view.score}/100</div>
              <ul style={{ marginTop: 12, paddingLeft: 18, lineHeight: 1.9 }}>
                <li>Dominado: {beforeAfter.after.covered}</li>
                <li>Parcial: {beforeAfter.after.partial}</li>
                <li>Sin resolver: {beforeAfter.after.missingOrIncorrect}</li>
              </ul>
            </div>
          </div>
        </section>}
        <section style={paper}><PaperHeader title="Tu primera explicación" score={view.initialPaper.score} letter={view.initialPaper.letterGrade} /><div style={{ whiteSpace: 'pre-wrap', lineHeight: 2 }}>{view.initialPaper.explanation}</div></section>
        <section style={paper}><PaperHeader title="Lo que ahora puedes explicar" score={view.score} letter={view.letterGrade} /><div style={{ display: 'grid', gap: 22 }}>{view.studentEvidencePaper.map((section, index) => <article key={`${section.provenance}-${index}`}><div style={{ color: '#9d2828', fontWeight: 900, fontSize: 13 }}>{section.provenance}</div><div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.9, marginTop: 6 }}>{section.text}</div></article>)}</div></section>
        <section style={{ ...paper, paddingTop: 25, paddingBottom: 25 }}>
          <h2 style={{ font: `36px ${HAND}`, margin: 0 }}>Tu recorrido</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
            {view.scoreHistory.map((entry, index) => <span key={entry.eventId} style={{ fontWeight: 900, color: repasoGradeColor(entry.letterAfter) }}>{index > 0 && <span style={{ color: '#9d8b6f', marginRight: 10 }}>→</span>}{entry.letterAfter} {entry.scoreAfter}</span>)}
          </div>
        </section>
      </div>}

      {error && <div role="alert" style={{ maxWidth: 760, margin: '18px auto 0', color: '#f87171', background: 'rgba(127,29,29,.15)', border: '1px solid #ef4444', borderRadius: 12, padding: 13, fontWeight: 800, display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{error}</span>
        {artifactId && phase === 'diagnosis' && <button style={{ ...button, padding: '8px 14px' }} onClick={openRecovery}>Reintentar</button>}
      </div>}
    </div>
  </div>
}
