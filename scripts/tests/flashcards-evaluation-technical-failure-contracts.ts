import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { POST as evaluateRoute } from '../../app/api/evaluar/route'
import {
  FLASHCARD_EVALUATION_RETRY_MESSAGE,
  FlashcardEvaluationGate,
  FlashcardEvaluationTechnicalError,
  requestFlashcardEvaluation,
} from '../../lib/flashcards/evaluationClient'

const request = {
  pregunta: '¿Capital de Panamá?',
  respuestaCorrecta: 'Ciudad de Panamá',
  respuestaUsuario: 'Ciudad de Panamá',
  idioma: 'es',
  contexto: 'Panamá.',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function expectTechnicalFailure(run: () => Promise<unknown>) {
  await assert.rejects(run, error => {
    assert.ok(error instanceof FlashcardEvaluationTechnicalError)
    assert.equal(error.message, FLASHCARD_EVALUATION_RETRY_MESSAGE)
    return true
  })
}

async function testSuccessfulAcademicResultsRemainAuthoritative() {
  let calls = 0
  const gate = new FlashcardEvaluationGate()
  const correct = await gate.evaluate(request, {
    fetchImpl: async () => {
      calls += 1
      return jsonResponse({ success: true, resultado: { nivel: 'correcta', porcentaje: 95 } })
    },
  })
  assert.equal(correct?.nivel, 'correcta')

  const incorrect = await gate.evaluate(request, {
    fetchImpl: async () => {
      calls += 1
      return jsonResponse({ success: true, resultado: { nivel: 'incorrecta', porcentaje: 15 } })
    },
  })
  assert.equal(incorrect?.nivel, 'incorrecta')
  assert.equal(calls, 2, 'cada evaluación académica exitosa se procesa una vez')
}

async function testTechnicalFailuresHaveNoAcademicResult() {
  await expectTechnicalFailure(() => requestFlashcardEvaluation(request, {
    fetchImpl: async () => jsonResponse({ success: false }, 500),
  }))
  await expectTechnicalFailure(() => requestFlashcardEvaluation(request, {
    fetchImpl: async () => { throw new TypeError('network down') },
  }))
  await expectTechnicalFailure(() => requestFlashcardEvaluation(request, {
    fetchImpl: async () => new Response('{bad json', { status: 200 }),
  }))
  await expectTechnicalFailure(() => requestFlashcardEvaluation(request, {
    fetchImpl: async () => jsonResponse({ success: true, resultado: { porcentaje: 50 } }),
  }))
  await expectTechnicalFailure(() => requestFlashcardEvaluation(request, {
    timeoutMs: 1,
    fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true })
    }),
  }))
}

async function testFlashcardRouteOptsIntoRecoverableErrors() {
  const response = await evaluateRoute(new NextRequest('http://localhost/api/evaluar', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-studyal-technical-errors': 'recoverable',
    },
    body: '{invalid json',
  }))
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { success: false, error: 'EVALUATION_PROVIDER_ERROR' })
}

async function testRetryAndDoubleSubmitGate() {
  const gate = new FlashcardEvaluationGate()
  let calls = 0
  let advances = 0
  let score: number | undefined
  let answer = request.respuestaUsuario
  let masteryEvents = 0

  await expectTechnicalFailure(() => gate.evaluate(request, {
    fetchImpl: async () => {
      calls += 1
      return jsonResponse({ success: false }, 503)
    },
  }))
  assert.equal(advances, 0)
  assert.equal(score, undefined)
  assert.equal(masteryEvents, 0)
  assert.equal(answer, request.respuestaUsuario)

  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const retry = gate.evaluate(request, {
    fetchImpl: async () => {
      calls += 1
      await pending
      return jsonResponse({ success: true, resultado: { nivel: 'correcta', porcentaje: 100 } })
    },
  })
  const duplicate = await gate.evaluate(request, {
    fetchImpl: async () => {
      calls += 1
      return jsonResponse({ success: true, resultado: { nivel: 'correcta', porcentaje: 100 } })
    },
  })
  assert.equal(duplicate, null, 'el doble clic no inicia una segunda solicitud')
  release()
  const result = await retry
  if (result) {
    score = result.porcentaje
    advances += 1
    masteryEvents += 1
    answer = ''
  }
  assert.equal(calls, 2, 'un fallo y un único reintento')
  assert.equal(advances, 1)
  assert.equal(score, 100)
  assert.equal(masteryEvents, 1)
  assert.equal(answer, '')
}

function testBothStudyModesUseFailClosedFlow() {
  const source = readFileSync('components/materias/ALAIStudyALCards.tsx', 'utf8')
  const repite = source.slice(source.indexOf('function StudyRepite'), source.indexOf('function StudyRapido'))
  const rapido = source.slice(source.indexOf('function StudyRapido'), source.indexOf('function StudySelector'))

  for (const [name, block] of [['StudyRepite', repite], ['StudyRapido', rapido]] as const) {
    assert.match(block, /new FlashcardEvaluationGate\(\)/, `${name} usa el gate anti doble envío`)
    assert.match(block, /evaluationSubmittingRef\.current/, `${name} bloquea el segundo clic antes de abortar el primero`)
    assert.match(block, /setEvaluationError\(FLASHCARD_EVALUATION_RETRY_MESSAGE\)/, `${name} expone error recuperable`)
    assert.match(block, /Reintentar evaluación/, `${name} ofrece reintento`)
    assert.doesNotMatch(block, /nivel:\s*['"]medio_correcta['"]\s*,\s*porcentaje:\s*50/, `${name} no fabrica resultado`)
    const catchBlock = block.match(/catch \(e\) \{[\s\S]*?\n\s*\} finally/)?.[0] || ''
    assert.doesNotMatch(catchBlock, /setEvaluation\(|continueNext|setResults|onMasteryEvent/, `${name} no muta aprendizaje al fallar`)
    assert.doesNotMatch(catchBlock, /setUserAnswer/, `${name} conserva la respuesta escrita`)
  }

  const route = readFileSync('app/api/evaluar/route.ts', 'utf8')
  assert.match(route, /success:\s*false[\s\S]*status:\s*503/, 'el proveedor caído ya no se disfraza de incorrecta')
}

async function main() {
  await testSuccessfulAcademicResultsRemainAuthoritative()
  await testTechnicalFailuresHaveNoAcademicResult()
  await testFlashcardRouteOptsIntoRecoverableErrors()
  await testRetryAndDoubleSubmitGate()
  testBothStudyModesUseFailClosedFlow()
  console.log('✅ flashcards-evaluation-technical-failure-contracts: PASS')
}

main().catch(error => {
  console.error('❌ flashcards-evaluation-technical-failure-contracts: FAIL')
  console.error(error)
  process.exit(1)
})
