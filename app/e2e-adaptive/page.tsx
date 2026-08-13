"use client"

import { useEffect, useState } from 'react'
import { AcademicContent } from '../../components/academic/AcademicContent'
import { AcademicListbox } from '../../components/academic/AcademicListbox'
import StudyALAdaptive from '../../components/materias/StudyALAdaptive'
import {
  normalizeEvaluationMode,
  validateQuestionTypeForMode,
} from '../../lib/adaptive/evaluation/evaluationModeContract'
import { semanticBlankSpacing } from '../../lib/academic-content/blankSpacing'
import { buildStableMatchingOrder, normalizeGeneratedQuestion, type CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'
import {
  beginRecoveryReteach,
  beginRecoveryVerification,
  createRecoveryQueue,
  deferNormalBlockFailures,
  nextRecoveryItem,
  persistRecoveryVerificationQuestions,
  presentRecoveryVerificationQuestion,
  recordRecoveryReteachContent,
  recordRecoveryCheck,
  recordVerificationGenerationAttempt,
  releaseNormalBlockRecoveries,
  type RecoveryItem,
} from '../../lib/adaptive/evaluation/recoveryQueue'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { fetchAuthorizedSource, sourceScopedKey } from '../../lib/materials/authorizedSource'

const matchingOptions = [
  { id: 'relation-pressure', content: '$K_p = K_c(RT)^{\\Delta n}$' },
  { id: 'ideal-gas', content: '$PV=nRT$' },
]
const matchingOrder = buildStableMatchingOrder('e2e-matching-instance', matchingOptions.map(option => option.id))
const orderedMatchingOptions = matchingOrder.map(id => matchingOptions.find(option => option.id === id)!).filter(Boolean)
const recoveryContext = {
  activeConceptId: 'e2e-concept',
  activeConceptLabel: 'Concepto E2E',
  teachingBlockId: 'e2e-step',
  targetDimension: 'comprehension' as const,
  questionFamily: 'mcq_best_answer',
  allowedConceptIds: ['e2e-concept'],
  forbiddenConceptIds: [],
}

function recoveryQuestion(id: string, text: string, conceptId = 'e2e-concept', conceptLabel = 'Concepto E2E'): CanonicalQuestion {
  const context = {
    ...recoveryContext,
    activeConceptId: conceptId,
    activeConceptLabel: conceptLabel,
    allowedConceptIds: [conceptId],
  }
  const question = normalizeGeneratedQuestion({
    conceptId,
    conceptLabel,
    variant: 'mcq_best_answer',
    targetDimension: 'comprehension',
    difficulty: 'medium',
    questionText: text,
    options: [{ id: 'correct', text: `Solución ${id}` }, { id: 'wrong', text: `Alternativa ${id}` }],
    correctAnswer: 'correct',
    explanation: 'Explicación.',
    hint: 'Pista.',
    factKey: `e2e:${id}`,
  }, context, id)
  if (!question) throw new Error('Invalid deterministic recovery fixture')
  return question
}

export default function AdaptiveE2EHarness() {
  const [planRestoreHarness, setPlanRestoreHarness] = useState(false)
  const [sourceAuthorityHarness, setSourceAuthorityHarness] = useState(false)
  const [freeSourceHarness, setFreeSourceHarness] = useState(false)
  const [freeTool, setFreeTool] = useState('hub')
  const [freeSourceText, setFreeSourceText] = useState('')
  const [evaluationModeHarness, setEvaluationModeHarness] = useState<'quick_test' | 'write_explain' | null>(null)
  const [deliveredFormat, setDeliveredFormat] = useState<string | null>(null)
  const [modeError, setModeError] = useState<string | null>(null)
  const [matching, setMatching] = useState('')
  const [secondMatching, setSecondMatching] = useState('')
  const [review, setReview] = useState(false)
  const [recovery, setRecovery] = useState<RecoveryItem | null>(null)
  const [blockQuestionIndex, setBlockQuestionIndex] = useState(0)
  const [blockRecoveryQueue, setBlockRecoveryQueue] = useState<RecoveryItem[]>([])
  const [blockPhase, setBlockPhase] = useState<'normal' | 'reteach' | 'verification' | 'next_step'>('normal')
  const [academicRetryCount, setAcademicRetryCount] = useState(0)
  const [blockRestoreReady, setBlockRestoreReady] = useState(false)
  const answer = '\\ce{H2O}'
  const before = 'La sustancia es'
  const after = '.'
  const spacing = semanticBlankSpacing(before, answer, after)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setPlanRestoreHarness(params.get('planRestore') === '1')
    setSourceAuthorityHarness(params.get('sourceAuthority') === '1')
    setFreeSourceHarness(params.get('freeSourceAuthority') === '1')
    setFreeTool(params.get('freeTool') || window.localStorage.getItem('e2e-free-tool') || 'hub')
    const requestedMode = params.get('evaluationMode')
    if (requestedMode === 'quick_test' || requestedMode === 'write_explain') {
      setEvaluationModeHarness(requestedMode)
    }
    const saved = window.localStorage.getItem('e2e-recovery-item')
    if (saved) setRecovery(JSON.parse(saved) as RecoveryItem)
    const savedBlock = window.localStorage.getItem('e2e-block-recovery')
    if (savedBlock) {
      const snapshot = JSON.parse(savedBlock) as {
        questionIndex: number
        queue: RecoveryItem[]
        phase: 'normal' | 'reteach' | 'verification' | 'next_step'
        retryCount: number
      }
      setBlockQuestionIndex(snapshot.questionIndex)
      setBlockRecoveryQueue(snapshot.queue)
      setBlockPhase(snapshot.phase)
      setAcademicRetryCount(snapshot.retryCount)
    }
    setBlockRestoreReady(true)
  }, [])

  useEffect(() => {
    if (!freeSourceHarness) return
    const snapshot = buildSourceSelectionSnapshot(['material-a', 'material-b'], { 'material-a': [2], 'material-b': [3] })
    fetchAuthorizedSource(snapshot).then(result => setFreeSourceText(result.combinedText)).catch(error => setFreeSourceText(`ERROR:${error.message}`))
  }, [freeSourceHarness])

  useEffect(() => {
    if (recovery) window.localStorage.setItem('e2e-recovery-item', JSON.stringify(recovery))
  }, [recovery])

  useEffect(() => {
    if (!blockRestoreReady) return
    window.localStorage.setItem('e2e-block-recovery', JSON.stringify({
      questionIndex: blockQuestionIndex,
      queue: blockRecoveryQueue,
      phase: blockPhase,
      retryCount: academicRetryCount,
    }))
  }, [academicRetryCount, blockPhase, blockQuestionIndex, blockRecoveryQueue, blockRestoreReady])

  const startRecovery = () => {
    const source = recoveryQuestion('source', 'Identifica el principio dentro del ejemplo original presentado.')
    const item = createRecoveryQueue([{
      question: source,
      answer: 'wrong',
      result: { outcome: 'incorrect', correct: false },
    }])[0]
    const reteaching = beginRecoveryReteach(item, 'contrastive_example')
    const explained = recordRecoveryReteachContent(reteaching, 'Explicación contrastiva del fallo actual.')
    setRecovery(recordVerificationGenerationAttempt(beginRecoveryVerification(explained), true))
  }

  const recordCorrect = () => {
    if (!recovery) return
    const sequence = recovery.successfulIndependentChecks + 1
    const question = sequence === 1
      ? recoveryQuestion('check-one', 'Clasifica una representación mediante una distinción conceptual nueva.')
      : recoveryQuestion('check-two', 'Predice una consecuencia dentro de un escenario de transferencia diferente.')
    const persisted = persistRecoveryVerificationQuestions(
      recovery.status === 'verification_active' ? { ...recovery, status: 'pending_verification' } : recovery,
      [question],
    )
    const presented = presentRecoveryVerificationQuestion(persisted)
    setRecovery(recordRecoveryCheck(presented.item, question, { outcome: 'correct', correct: true }).item)
  }

  const answerNormalBlock = (correct: boolean) => {
    const source = recoveryQuestion(
      `clutch-normal-${blockQuestionIndex + 1}`,
      blockQuestionIndex === 0
        ? 'Identifica la reacción inversa en el equilibrio presentado.'
        : `Resuelve la pregunta normal ${blockQuestionIndex + 1} del bloque sin interrumpirlo.`,
      blockQuestionIndex <= 1 ? 'micro-reaccion-inversa' : `micro-normal-${blockQuestionIndex + 1}`,
      blockQuestionIndex === 0 ? 'Identificación de la reacción inversa' : blockQuestionIndex === 1 ? 'Impacto de K en la dirección' : `Concepto normal ${blockQuestionIndex + 1}`,
    )
    let nextQueue = blockRecoveryQueue
    if (!correct) {
      nextQueue = deferNormalBlockFailures(nextQueue, [{
        question: source,
        answer: 'wrong',
        result: { outcome: 'incorrect', correct: false, errorType: 'conceptual' },
      }])
    }
    if (blockQuestionIndex < 3) {
      setBlockRecoveryQueue(nextQueue)
      setBlockQuestionIndex(index => index + 1)
      return
    }
    nextQueue = releaseNormalBlockRecoveries(nextQueue)
    setBlockRecoveryQueue(nextQueue)
    setBlockPhase(nextRecoveryItem(nextQueue) ? 'reteach' : 'next_step')
  }

  const beginBlockReteach = () => {
    const pending = nextRecoveryItem(blockRecoveryQueue)
    if (!pending) return
    const strategy = pending.verificationRound === 0 ? 'concept_boundary' : 'counterexample'
    let next = beginRecoveryReteach(pending, strategy)
    next = recordRecoveryReteachContent(next, `Reenseñanza ${next.reteachAttempt} basada en el fallo más reciente.`)
    next = beginRecoveryVerification(next)
    next = recordVerificationGenerationAttempt(next, true)
    const questions = [1, 2].map(checkNumber => recoveryQuestion(
      `${next.recoveryId}-round-${next.verificationRound}-check-${checkNumber}`,
      next.verificationRound === 1
        ? checkNumber === 1
          ? 'Distingue la reacción inversa en una ecuación de equilibrio nueva.'
          : 'Predice qué dirección aumenta cuando se retiran productos del sistema.'
        : checkNumber === 1
          ? 'Clasifica cuál transformación consume productos para reconstruir reactivos.'
          : 'Interpreta el perfil de velocidades y selecciona el proceso que avanza de derecha a izquierda.',
      next.conceptId,
      next.conceptLabel,
    ))
    next = persistRecoveryVerificationQuestions(next, questions)
    next = presentRecoveryVerificationQuestion(next).item
    setBlockRecoveryQueue(queue => queue.map(item => item.recoveryId === next.recoveryId ? next : item))
    setBlockPhase('verification')
  }

  const answerBlockVerification = (correct: boolean) => {
    const current = nextRecoveryItem(blockRecoveryQueue)
    if (!current) return
    const roundId = `${current.recoveryId}:round:${current.verificationRound}`
    const check = current.verificationQuestions.find(entry =>
      entry.roundId === roundId && entry.presentedAt !== null && entry.answeredAt === null)?.question
    if (!check) return
    const recorded = recordRecoveryCheck(
      current,
      check,
      { outcome: correct ? 'correct' : 'incorrect', correct, errorType: correct ? null : 'conceptual' },
      'independent',
      correct ? 'correct' : 'wrong',
    ).item
    const nextPresented = recorded.status === 'pending_verification'
      ? presentRecoveryVerificationQuestion(recorded).item
      : recorded
    const updatedQueue = blockRecoveryQueue.map(item => item.recoveryId === nextPresented.recoveryId ? nextPresented : item)
    setBlockRecoveryQueue(updatedQueue)
    if (nextPresented.status === 'resolved') {
      setBlockPhase(nextRecoveryItem(updatedQueue) ? 'reteach' : 'next_step')
    } else if (nextPresented.status === 'pending_reteach') setBlockPhase('reteach')
    else setBlockPhase('verification')
  }

  const blockVisibility = blockRecoveryQueue.reduce((audit, item) => {
    const itemAudit = item.verificationQuestions
    return {
      generated: audit.generated + itemAudit.length,
      presented: audit.presented + itemAudit.filter(entry => entry.presentedAt !== null).length,
      answered: audit.answered + itemAudit.filter(entry => entry.answeredAt !== null).length,
      neverPresented: audit.neverPresented + itemAudit.filter(entry => entry.presentedAt === null).length,
    }
  }, { generated: 0, presented: 0, answered: 0, neverPresented: 0 })

  if (planRestoreHarness) {
    return (
      <StudyALAdaptive
        materiales={[{
          id: 'doc-plan-e2e',
          materialId: 'mat-plan-e2e',
          nombre: 'Material persistido',
          contenido: '[Página 1] Contenido académico suficiente para la selección persistida.',
          tipo: 'pdf',
        }]}
        temaId="tema-plan-e2e"
        userId="e2e-user"
        sessionId="journey-plan-e2e"
        onClose={() => undefined}
      />
    )
  }

  if (freeSourceHarness) {
    const snapshot = buildSourceSelectionSnapshot(['material-a', 'material-b'], { 'material-a': [2], 'material-b': [3] })
    const sessionId = 'free-session-authority-e2e'
    const open = (tool: string) => {
      setFreeTool(tool)
      window.localStorage.setItem('e2e-free-tool', tool)
      const url = new URL(window.location.href)
      if (tool === 'studymap' || tool === 'truquitos') {
        url.searchParams.set('freeTool', tool)
        url.searchParams.set('freeSessionId', sessionId)
      } else {
        url.searchParams.delete('freeTool')
        url.searchParams.delete('freeSessionId')
      }
      window.history.replaceState({}, '', `${url.pathname}${url.search}`)
    }
    return <main data-testid="free-source-harness">
      <p data-testid="free-session-id">{sessionId}</p>
      <p data-testid="free-source-fingerprint">{snapshot.fingerprint}</p>
      <p data-testid="free-source-key">{sourceScopedKey('free', snapshot, { sessionId, temaId: 'tema-e2e' })}</p>
      <p data-testid="free-active-tool">{freeTool}</p>
      <pre data-testid="free-authorized-source">{freeSourceText}</pre>
      {['hub', 'repasar', 'flashcards', 'quiz', 'alai', 'studymap', 'truquitos'].map(tool => <button key={tool} onClick={() => open(tool)}>{tool}</button>)}
    </main>
  }

  if (sourceAuthorityHarness) {
    const pages = (count: number, prefix: string, selected: number[]) => Array.from({ length: count }, (_, index) =>
      `[Página ${index + 1}] ${selected.includes(index + 1) ? `AUTHORIZED_${prefix}_${index + 1}` : `FORBIDDEN_${prefix}_${index + 1}`}`
    ).join('\n')
    return (
      <StudyALAdaptive
        materiales={[
          { id: 'doc-a', materialId: 'mat-a', nombre: 'A.pdf', contenido: pages(2, 'A', [1, 2]), tipo: 'pdf' },
          { id: 'doc-b', materialId: 'mat-b', nombre: 'B.pdf', contenido: pages(5, 'B', [2, 5]), tipo: 'pdf' },
          { id: 'doc-c', materialId: 'mat-c', nombre: 'C.pdf', contenido: pages(43, 'C', [2, 5, 7, 43]), tipo: 'pdf' },
        ]}
        selectedPages={{ 'mat-a': [1, 2], 'mat-b': [2, 5], 'mat-c': [2, 5, 7, 43] }}
        temaId="tema-source-authority"
        userId="e2e-source-user"
        sessionId="program-source-authority"
        onClose={() => undefined}
      />
    )
  }

  if (evaluationModeHarness) {
    const requestQuestion = async () => {
      setModeError(null)
      setDeliveredFormat(null)
      const response = await fetch('/api/adaptive/session-eval', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: normalizeEvaluationMode(evaluationModeHarness),
          taughtSteps: [{ id: 'step-e2e', type: 'concept', title: 'Concepto E2E', content: 'Contenido E2E', keyPoint: 'Idea E2E' }],
        }),
      })
      const payload = await response.json()
      const candidate = payload.questions?.[0]
      if (candidate && validateQuestionTypeForMode(evaluationModeHarness, candidate.format).valid) {
        setDeliveredFormat(candidate.format)
        return
      }
      setModeError('No pudimos generar una pregunta compatible con tu modo de evaluación.')
    }
    return (
      <main style={{ maxWidth: 720, margin: '40px auto', padding: 24 }}>
        <h1>Evaluation mode contract</h1>
        <div data-testid="active-evaluation-mode">
          {evaluationModeHarness === 'quick_test' ? 'Evaluaciones rápidas sin escribir' : 'Evaluaciones escribiendo / explicando'}
        </div>
        <button onClick={requestQuestion}>Generar evaluación</button>
        {deliveredFormat && <div data-testid="delivered-format">{deliveredFormat}</div>}
        {deliveredFormat === 'multiple_choice' && <button>Respuesta cerrada</button>}
        {deliveredFormat === 'short_response' && <textarea aria-label="Respuesta escrita" />}
        {modeError && <div data-testid="evaluation-mode-error">{modeError}</div>}
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', padding: 24 }}>
      <h1>Academic content integration</h1>
      <AcademicListbox
        label="Relacionar ecuación"
        options={orderedMatchingOptions}
        value={matching}
        onChange={setMatching}
      />
      <AcademicListbox
        label="Relacionar segunda fila"
        options={orderedMatchingOptions.map(option => ({ ...option, disabled: option.id === matching && option.id !== secondMatching }))}
        value={secondMatching}
        onChange={setSecondMatching}
      />
      <div data-testid="selected-matching">{matching ? 'seleccionada' : 'sin selección'}</div>
      <div data-testid="word-bank-preview">
        <AcademicContent content={before} inline />
        {spacing.before}<span><AcademicContent content={answer} inline /></span>{spacing.after}
        <AcademicContent content={after} inline />
      </div>
      <div data-testid="quantity-preview">
        <AcademicContent content="entender las medidas de193 pies, 1,069 pies y 6.022×10^23 mol⁻¹." inline />
      </div>
      <div data-testid="latex-unit-preview">
        <AcademicContent content={'12 \\text{h}; 30 \\text{s}; 193 \\text{m}; 5 \\mathrm{kg}.'} inline />
      </div>
      <div data-testid="math-unit-preview">
        <AcademicContent content={'$v = 10\\,\\mathrm{m/s}$'} inline />
      </div>
      <section data-testid="markdown-math-preview">
        <AcademicContent content={'**Cociente de reacción ($Q$)**'} />
        <AcademicContent content={'**Constante de equilibrio ($K_c$ y $K_p$)**'} />
        <AcademicContent content={'**Marcador incompleto procedente de extracción'} />
        <AcademicContent content={'`x ** 2` conserva el código.'} />
      </section>
      <button onClick={() => setReview(true)}>Avanzar al repaso</button>
      {review && <section data-testid="review-safe-fallback"><AcademicContent content="Continúa con el repaso de las ideas principales." /></section>}
      <section>
        <button onClick={startRecovery}>Simular fallo</button>
        <button onClick={recordCorrect} disabled={!recovery}>Registrar verificación correcta</button>
        <div data-testid="recovery-status">{recovery ? `${recovery.status}:${recovery.successfulIndependentChecks}/${recovery.requiredIndependentChecks}` : 'sin recovery'}</div>
      </section>
      <section data-testid="clutch-recovery-sequence">
        <h2>CLUTCH 2 recovery sequence</h2>
        <div data-testid="block-phase">
          {blockPhase === 'normal'
            ? `normal:${blockQuestionIndex + 1}/4`
            : blockPhase === 'verification'
              ? `verification:${nextRecoveryItem(blockRecoveryQueue)?.verificationRound || 0}:${(nextRecoveryItem(blockRecoveryQueue)?.completedIndependentChecks || 0) + 1}/2`
              : blockPhase}
        </div>
        {blockPhase === 'normal' && <>
          <button onClick={() => answerNormalBlock(false)}>Responder normal incorrecta</button>
          <button onClick={() => answerNormalBlock(true)}>Responder normal correcta</button>
        </>}
        {blockPhase === 'reteach' && <button onClick={beginBlockReteach}>Reenseñar {nextRecoveryItem(blockRecoveryQueue)?.conceptLabel}</button>}
        {(blockPhase === 'reteach' || blockPhase === 'verification') && <div data-testid="block-recovery-position">{(() => {
          const active = nextRecoveryItem(blockRecoveryQueue)
          const errorIndex = Math.max(1, blockRecoveryQueue.findIndex(item => item.recoveryId === active?.recoveryId) + 1)
          const round = Math.max(1, active?.verificationRound || active?.reteachAttempt || 1)
          return blockRecoveryQueue.length > 1
            ? `Ronda ${round} · Error ${errorIndex} de ${blockRecoveryQueue.length}`
            : `Recuperación · Ronda ${round}`
        })()}</div>}
        {blockPhase === 'reteach' && <button onClick={() => setAcademicRetryCount(value => value + 1)}>Simular retry académico</button>}
        {blockPhase === 'verification' && <>
          <button onClick={() => answerBlockVerification(true)}>Responder reevaluación correcta</button>
          <button onClick={() => answerBlockVerification(false)}>Responder reevaluación incorrecta</button>
        </>}
        <div data-testid="block-recovery-count">{blockRecoveryQueue.length}</div>
        <div data-testid="block-round-credit">{nextRecoveryItem(blockRecoveryQueue)?.successfulIndependentChecks || 0}</div>
        <div data-testid="verification-presented">
          {nextRecoveryItem(blockRecoveryQueue)?.verificationQuestions.some(entry =>
            entry.roundId === `${nextRecoveryItem(blockRecoveryQueue)?.recoveryId}:round:${nextRecoveryItem(blockRecoveryQueue)?.verificationRound}` &&
            entry.presentedAt !== null &&
            entry.answeredAt === null,
          ) ? 'presented' : 'not_presented'}
        </div>
        <div data-testid="academic-retry-count">{academicRetryCount}</div>
        <div data-testid="verification-lifecycle">
          {`${blockVisibility.generated}:${blockVisibility.presented}:${blockVisibility.answered}:${blockVisibility.neverPresented}`}
        </div>
        <div data-testid="skipped-recovery-count">
          {blockPhase === 'next_step'
            ? blockRecoveryQueue.filter(item => item.status !== 'resolved' && item.status !== 'unresolved').length
            : 0}
        </div>
        <button disabled={blockPhase !== 'next_step'}>Avanzar al siguiente paso pedagógico</button>
      </section>
    </main>
  )
}
