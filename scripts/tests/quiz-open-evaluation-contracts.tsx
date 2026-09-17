import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'
import { __quizEvaluatorDeps, evaluateQuizOpenAnswer, normalizeQuizEvaluation, recoverQuizEvaluationJson } from '../../lib/materialBrain/quiz/evaluator'
import type { GroundedQuizQuestion } from '../../lib/materialBrain/quiz/types'
import { compareAcademicAnswer } from '../../lib/quiz/academicEquivalence'
import { isGradedQuizEvaluation, safeUngradedEvaluation } from '../../lib/quiz/evaluationFeedback'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { upsertSession } from '../../lib/studySessions'
import { readFreeToolState, writeFreeToolState } from '../../lib/freeToolState'

Object.assign(globalThis, { React })
const formula = '$1s^{2}2s^{2}2p^{2}$'
const question: GroundedQuizQuestion = {
  id: 'hybridization', type: 'short_answer', caseInsensitive: true,
  question: '¿Qué es la hibridación de orbitales?',
  acceptedAnswers: ['Combinación de orbitales atómicos para formar orbitales híbridos equivalentes.'],
  explanation: 'Se combinan orbitales del mismo átomo para formar orbitales híbridos equivalentes.',
  grounding: { planId: 'evaluation', sourceUnitIds: [], sourceRelationIds: [], evidence: [],
    supportingText: 'La hibridación combina orbitales atómicos de un mismo átomo y forma orbitales híbridos equivalentes orientados en el espacio.' },
}
const semanticAnswer = 'Se mezclan los orbitales de un átomo y se forman otros equivalentes.'
// Observed on a real synthetic probe with the OLD prompt: valid fenced JSON, nivel=Excelente.
const observedShape = { nivel: 'Excelente', porcentaje: 100,
  analisis: 'La respuesta recoge la mezcla de orbitales del mismo átomo y la formación de otros equivalentes.',
  explicacion: question.explanation, respuestaCorrecta: 'Untrusted provider answer', consejo: '' }
let passed = 0
async function test(name: string, run: () => unknown | Promise<unknown>) {
  await run(); passed++; console.log(`PASS ${name}`)
}
async function withTransport(outputs: Array<string | Error>, run: (stages: string[]) => Promise<void>) {
  const original = __quizEvaluatorDeps.alai
  const stages: string[] = []
  __quizEvaluatorDeps.alai = async params => {
    assert.equal(params.transportRetries, 0)
    assert.equal(params.maxProviderAttempts, 1)
    stages.push(params.stage || '')
    const output = outputs[stages.length - 1]
    if (output === undefined) throw new Error('UNEXPECTED_PROVIDER_CALL')
    if (output instanceof Error) throw output
    return { text: output, provider: 'fixture', model: 'fixture' }
  }
  try { await run(stages) } finally { __quizEvaluatorDeps.alai = original }
}

async function main() {
    const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>')
    const storage = new Map<string, string>()
    const localStorage = { getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) }
    const requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0)
    const cancelAnimationFrame = (handle: number) => window.clearTimeout(handle)
    Object.assign(window, { requestAnimationFrame, cancelAnimationFrame })
    Object.assign(globalThis, { window, document, localStorage, requestAnimationFrame, cancelAnimationFrame,
      HTMLElement: window.HTMLElement, Element: window.Element, SVGElement: window.SVGElement, IS_REACT_ACT_ENVIRONMENT: true })
    Object.defineProperty(window, 'localStorage', { value: localStorage, configurable: true })
    window.HTMLElement.prototype.scrollIntoView = () => {}
  const { default: Quiz, FeedbackBox } = await import('../../components/materias/ALAIStudyALQuizzes')
  await test('orbital notation variants, zero provider calls, wrong occupancy stays incorrect', async () => {
    const orbitalQuestion = { ...question, acceptedAnswers: [formula] }
    await withTransport([], async stages => {
      for (const answer of ['1s2 2s2 2p2', '1s^2 2s^2 2p^2', '1s²2s²2p²', '1s^{2}2s^{2}2p^{2}', formula,
        '**1s² 2s² 2p²**', '\\(1s^{2}2s^{2}2p^{2}\\)', '1S2 2S2 2P2']) {
        const result = await evaluateQuizOpenAnswer(orbitalQuestion, answer)
        assert.equal(result.nivel, 'correcta', answer)
        assert.equal(result.providerAttempts, 0)
      }
      const wrong = await evaluateQuizOpenAnswer(orbitalQuestion, '1s2 2s2 2p3')
      assert.equal(wrong.nivel, 'incorrecta'); assert.equal(wrong.porcentaje, 0)
      assert.match(wrong.analisis, /2p escribiste 3 electrones; se esperan 2/)
      assert.equal(stages.length, 0)
    })
  })
  await test('general scientific syntax, units/sign/case/grouping remain significant', () => {
    for (const [a, b] of [['3d10 4s2', '$3d^{10}4s^{2}$'], ['x² + y²', '$x^{2}+y^{2}$'],
      ['H₂O', 'H_2O'], ['1.2 × 10³ kg', '1200 kg'], ['**energía luminosa**', 'ENERGÍA LUMINOSA']]) {
      assert.ok(['exact', 'academic_equivalence'].includes(compareAcademicAnswer(a, b)), `${a} / ${b}`)
    }
    for (const [a, b] of [['1s2 2s2 2p3', formula], ['-2', '2'], ['1.2', '12'], ['x^2', 'x2'],
      ['x^23', 'x^2 3'], ['CO', 'Co'], ['COOH', 'cooh'], ['5 m', '5 M'], ['5', '5 kg'], ['1 2', '12'], ['100.9', '100'],
      ['(x+1)^2', 'x+1^2'], ['H2O2', 'H2O']]) {
      assert.ok(['different', 'undecided'].includes(compareAcademicAnswer(a, b)), `${a} / ${b}`)
    }
  })
  await test('every accepted answer is compared individually', async () => {
    await withTransport([], async stages => {
      const result = await evaluateQuizOpenAnswer({ ...question, acceptedAnswers: [formula, '1s²2s²2p²'] }, '1s2 2s2 2p2')
      assert.equal(result.nivel, 'correcta'); assert.equal(stages.length, 0)
    })
  })
  await test('real observed Excelente + wrapped JSON is recovered in the initial call', async () => {
    for (const raw of [JSON.stringify(observedShape), '```json\n' + JSON.stringify(observedShape) + '\n```',
      'Evaluación:\n```json\n' + JSON.stringify({ resultado: observedShape }) + '\n```\nFin.']) {
      await withTransport([raw], async stages => {
        const result = await evaluateQuizOpenAnswer(question, semanticAnswer)
        assert.equal(result.nivel, 'correcta'); assert.equal(result.evaluationMode, 'semantic_provider')
        assert.equal(result.respuestaCorrecta, question.acceptedAnswers[0]); assert.equal(result.providerAttempts, 1)
        assert.deepEqual(stages, ['normal'])
      })
    }
  })
  await test('partial and wrong semantic answers preserve actual provider judgement', async () => {
    for (const [nivel, porcentaje, answer, analisis] of [
      ['medio_correcta', 60, 'Mezcla orbitales.', 'Acertaste la combinación; falta que pertenecen al mismo átomo y forman orbitales híbridos equivalentes.'],
      ['incorrecta', 0, 'Los electrones se destruyen.', 'Los electrones no se destruyen; se combinan orbitales del mismo átomo.'],
    ] as const) {
      await withTransport([JSON.stringify({ ...observedShape, nivel, porcentaje, analisis })], async stages => {
        const result = await evaluateQuizOpenAnswer(question, answer)
        assert.equal(result.nivel, nivel); assert.equal(result.porcentaje, porcentaje)
        assert.equal(result.analisis, analisis); assert.equal(stages.length, 1)
      })
    }
  })
  await test('malformed output: exactly one format repair; successful repair retains the grade', async () => {
    await withTransport(['{bad', JSON.stringify(observedShape)], async stages => {
      const result = await evaluateQuizOpenAnswer(question, semanticAnswer)
      assert.equal(result.nivel, 'correcta'); assert.equal(result.providerAttempts, 2)
      assert.deepEqual(stages, ['normal', 'format_repair'])
    })
    await withTransport(['{}', '{}'], async stages => {
      const result = await evaluateQuizOpenAnswer(question, semanticAnswer)
      assert.equal(result.evaluationMode, 'safe_ungraded'); assert.equal(result.porcentaje, null)
      assert.equal(result.nivel, 'sin_evaluar'); assert.equal(result.providerAttempts, 2)
      assert.deepEqual(stages, ['normal', 'format_repair']); assert.equal(isGradedQuizEvaluation(result), false)
    })
  })
  await test('transport failure and explicit uncertainty: ungraded, no invented score, no repair calls', async () => {
    for (const output of [new Error('provider unavailable'), JSON.stringify({ nivel: 'sin_evaluar', porcentaje: null })]) {
      await withTransport([output], async stages => {
        const result = await evaluateQuizOpenAnswer(question, semanticAnswer)
        assert.equal(result.evaluationMode, 'safe_ungraded'); assert.equal(result.porcentaje, null)
        assert.equal(result.nivel, 'sin_evaluar'); assert.equal(result.providerAttempts, 1)
        assert.equal(isGradedQuizEvaluation(result), false); assert.deepEqual(stages, ['normal'])
      })
    }
  })
  await test('invalid, contradictory, truncated and conflicting grades cannot become mastery evidence', () => {
    for (const value of [{ ...observedShape, porcentaje: null }, { ...observedShape, porcentaje: '' },
      { ...observedShape, porcentaje: 101 }, { ...observedShape, porcentaje: 0 }, { ...observedShape, nivel: 'unknown' }]) {
      assert.equal(normalizeQuizEvaluation(value), null)
    }
    assert.equal(recoverQuizEvaluationJson(JSON.stringify(observedShape).slice(0, -1)), null)
    assert.equal(recoverQuizEvaluationJson(JSON.stringify(observedShape) + JSON.stringify({ ...observedShape, nivel: 'incorrecta', porcentaje: 0 })), null)
    assert.equal(isGradedQuizEvaluation({ ...observedShape, nivel: 'medio_correcta', porcentaje: 50, evaluationMode: 'safe_fallback' }), false)
    const client = readFileSync('components/materias/ALAIStudyALQuizzes.tsx', 'utf8')
    const guard = client.slice(client.indexOf('if ((q.type ==='), client.indexOf('const entry: HistoryEntry'))
    assert.match(guard, /!isGradedQuizEvaluation\(evaluation\)/); assert.match(guard, /return;/)
    assert.ok(client.indexOf('const entry: HistoryEntry') < client.indexOf('onMasteryEvent?.('))
  })
  await test('actual Quiz feedback uses AcademicContent/KaTeX, no visible raw LaTeX or repeated correct answer', () => {
    for (const nivel of ['correcta', 'medio_correcta', 'incorrecta', 'sin_evaluar']) {
      const feedback = nivel === 'sin_evaluar' ? safeUngradedEvaluation(formula, `La configuración es ${formula}.`)
        : { nivel, porcentaje: nivel === 'correcta' ? 100 : nivel === 'medio_correcta' ? 60 : 0,
          analisis: 'Revisa la ocupación de los orbitales.', respuestaCorrecta: formula, explicacion: `La configuración es ${formula}.` }
      const html = renderToStaticMarkup(<FeedbackBox correct={nivel === 'correcta'} question={question}
        userAnswer="1s2 2s2 2p3" themeColor="gold" evaluation={feedback} />)
      const { document } = parseHTML(html)
      assert.ok(document.querySelector('[data-academic-content] .katex'), nivel)
      assert.ok(document.querySelector('[role="math"]'))
      assert.doesNotMatch(document.textContent || document.documentElement.textContent || '', /\$|\\\{|\\\}/)
      assert.doesNotMatch(html, /Fórmula no disponible/)
      if (nivel === 'sin_evaluar') { assert.doesNotMatch(html, /saq-feedback-pct/); assert.doesNotMatch(html, /Incorrecto|Casi…/) }
      if (nivel === 'correcta') assert.equal(document.querySelectorAll('.katex').length, 1)
    }
  })
  await test('mounted Quiz: failed evaluation writes no history/mastery; manual retry records exactly once', async () => {
    const originalFetch = globalThis.fetch
    let evaluationCalls = 0
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'))
      if (body.mode === 'evaluate') {
        evaluationCalls++
        return evaluationCalls === 1 ? Response.json({ success: false }, { status: 503 })
          : Response.json({ success: true, resultado: { ...observedShape, nivel: 'correcta', evaluationMode: 'semantic_provider' } })
      }
      return Response.json({ success: true, status: 'ready', artifactIdentity: 'mounted-eval', quiz: questions,
        manifest: { totalSlots: 2, readyCount: 2, status: 'ready' } })
    }
    const selection = buildSourceSelectionSnapshot(['eval-material'], { 'eval-material': [1] })
    const questions = [question, { ...question, id: 'next-question' }]
    upsertSession({ id: 'mounted-eval-session', temaId: 'eval-tema', enfoque: 'teorico', processMode: 'free',
      materialIds: selection.materialIds, selectedPages: selection.selectedPages })
    writeFreeToolState('mounted-eval-session', selection.fingerprint, 'quiz', {
      quizState: 'playing', difficulty: 'medium', selectedTypes: ['short_answer'], questionCount: 2, requestedCount: 2,
      questions, questionIds: questions.map(q => q.id), currentIndex: 0, userAnswer: semanticAnswer, isLocked: false,
      history: [], quizVersion: '4.0.0-enjoyer', artifactIdentity: 'mounted-eval', generationId: 'mounted-generation',
      quizStartTime: Date.now(), questionStartTime: Date.now(),
    })
    assert.ok(readFreeToolState('mounted-eval-session', selection.fingerprint, 'quiz'), 'seeded durable state')
    const mastery: unknown[] = []
    const root = createRoot(document.getElementById('root')!)
    const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) }) }
    const click = async (text: string) => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent?.includes(text))
      assert.ok(button, `${text}: ${document.body.textContent?.slice(0, 1500)}`)
      await act(async () => { button.dispatchEvent(new window.Event('click', { bubbles: true })) }); await settle()
    }
    try {
      await act(async () => root.render(<Quiz materiales={[]} seleccion={[]} sourceSelection={selection}
        sessionId="mounted-eval-session" onBack={() => {}} onMasteryEvent={(event: unknown) => mastery.push(event)} />))
      await settle()
      await click('Responder →')
      assert.equal(evaluationCalls, 1); assert.equal(mastery.length, 0)
      assert.equal(document.querySelector('[data-next-question]'), null)
      assert.equal(readFreeToolState<{ history: unknown[] }>('mounted-eval-session', selection.fingerprint, 'quiz')?.state.history.length, 0)
      assert.match(document.getElementById('quiz-feedback')!.textContent || '', /suficiente confianza/)
      await click('Reintentar evaluación')
      assert.equal(evaluationCalls, 2); assert.equal(mastery.length, 1)
      assert.equal(readFreeToolState<{ history: unknown[] }>('mounted-eval-session', selection.fingerprint, 'quiz')?.state.history.length, 1)
      assert.match(document.getElementById('quiz-feedback')!.textContent || '', /¡Correcto!/)
    } finally { await act(async () => root.unmount()); globalThis.fetch = originalFetch }
  })
  console.log(`quiz-open-evaluation-contracts: ${passed} PASS`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
