process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-pretest'

import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST as sessionCheckPOST } from '../../app/api/adaptive/session-check/route'
import { signQuestionIntegrity } from '../../lib/adaptive/evaluation/questionIntegrity'
import { stripOptionSelfReferences } from '../../lib/adaptive/evaluation/answerPresentation'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

// BUG 1 (prueba humana real, ciclo Claude → producto): el grading de una MCQ
// fue correcto (opción 3, "HCl, HBr, HI, HNO3"), pero el feedback mostrado
// decía "La opción 'a' lista cuatro de ellos correctamente" — una letra que
// no corresponde a ninguna opción real seleccionada ni mostrada (la UI nunca
// muestra letras/números junto a las opciones). Causa raíz: `explanation` es
// texto libre del LLM generado en el mismo payload que la pregunta, sin
// ningún vínculo estructural con `correctAnswer` — session-check/route.ts
// usaba ese texto verbatim como feedback. No podemos saber a qué opción real
// se refería la letra del LLM (podría incluso estar describiendo
// correctamente por qué una opción DISTINTA es incorrecta), así que la única
// corrección genérica y segura es eliminar la autorreferencia de letra, no
// intentar reescribirla — nunca hardcodeamos el ejemplo real ni una letra
// específica.

// ═══ 1. stripOptionSelfReferences en aislamiento ═══

function testStripsRealObservedCase() {
  const out = stripOptionSelfReferences("La opción 'a' lista cuatro de ellos correctamente.")
  assert.ok(!/opci[oó]n/i.test(out), `no debe quedar ninguna autorreferencia a "opción": "${out}"`)
  assert.ok(!/\ba\b/i.test(out) || out.includes('cuatro'), `no debe sobrevivir la letra huérfana: "${out}"`)
}

function testStripsNumericAndEnglishVariants() {
  assert.ok(!/option/i.test(stripOptionSelfReferences("Option 2 is correct because it lists only strong acids.")))
  assert.ok(!/alternativa/i.test(stripOptionSelfReferences("La alternativa 3 es la única con ácidos fuertes.")))
  assert.ok(!/\bopci[oó]n\b/i.test(stripOptionSelfReferences('La opción "c" es correcta.')))
}

function testStripsMultipleLetterLists() {
  const out = stripOptionSelfReferences('Las opciones a y c son incorrectas porque incluyen ácidos débiles.')
  assert.ok(!/opci[oó]n/i.test(out), `debe eliminar listas de letras: "${out}"`)
  assert.ok(out.includes('incorrectas') && out.includes('ácidos débiles'), `debe conservar el resto del contenido: "${out}"`)
}

function testDoesNotOverStripUnrelatedText() {
  const out = stripOptionSelfReferences('HCl, HBr, HI y HNO3 son ácidos fuertes porque se disocian completamente en agua.')
  assert.equal(out, 'HCl, HBr, HI y HNO3 son ácidos fuertes porque se disocian completamente en agua.', 'texto sin autorreferencia a opciones no debe alterarse')
}

function testEmptyAndUndefinedExplanation() {
  assert.equal(stripOptionSelfReferences(undefined), '')
  assert.equal(stripOptionSelfReferences(null), '')
  assert.equal(stripOptionSelfReferences(''), '')
}

// ═══ 2. Contrato end-to-end contra el POST real de session-check ═══

function acidQuestion(): CanonicalQuestion {
  return {
    id: 'q-mcq-feedback-1', conceptId: 'c1', conceptLabel: 'Ácidos fuertes', teachingBlockId: 'step_1',
    questionFamily: 'mcq_best_answer', variant: 'mcq_best_answer', difficulty: 'medium',
    targetDimension: 'comprehension',
    questionText: '¿Cuál de las siguientes opciones contiene únicamente ácidos fuertes?',
    explanation: "La opción 'a' lista cuatro de ellos correctamente.",
    hint: '', estimatedSeconds: 30, evidencesNeeded: 1, factKey: 'fact-acidos-fuertes',
    factKeys: ['fact-acidos-fuertes'], targetObjectiveIds: ['obj-1'],
    format: 'multiple_choice',
    options: [
      { id: 'opt1', text: 'CH3COOH, HBr, HI, HClO4' },
      { id: 'opt2', text: 'H3PO4, HNO3, H2SO4, HCl' },
      { id: 'opt3', text: 'HCl, HBr, HI, HNO3' },
      { id: 'opt4', text: 'HF, H2SO4, HClO3, HClO4' },
    ],
    correctAnswer: 'opt3',
  } as CanonicalQuestion
}

async function callSessionCheck(question: unknown, answer: unknown) {
  const req = new NextRequest('http://localhost/api/adaptive/session-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, answer, teachingContent: 'Contenido enseñado.', mode: 'mix_everything', materialTitle: 'Material' }),
  })
  const res = await sessionCheckPOST(req)
  return res.json()
}

async function testRealCaseFeedbackNoLongerReferencesWrongLetter() {
  const question = acidQuestion()
  const signed = { ...question, integrity: signQuestionIntegrity(question) }
  const result = await callSessionCheck(signed, 'opt3')
  assert.equal(result.result.correct, true, 'grading debe seguir marcando opt3 como correcta (reproducción exacta del caso real)')
  assert.ok(!/opci[oó]n/i.test(result.result.feedback), `BUG DE ORIGEN SI FALLA: el feedback no debe contener ninguna autorreferencia a "opción": "${result.result.feedback}"`)
}

async function testIncorrectAnswerFeedbackGroundedInRealCorrectOption() {
  const question = acidQuestion()
  const signed = { ...question, integrity: signQuestionIntegrity(question) }
  const result = await callSessionCheck(signed, 'opt1')
  assert.equal(result.result.correct, false)
  assert.ok(!/opci[oó]n/i.test(result.result.feedback), `feedback de respuesta incorrecta tampoco debe autorreferenciar letras: "${result.result.feedback}"`)
  assert.ok(result.result.whatWasWrong.includes('HCl, HBr, HI, HNO3'), 'whatWasWrong debe derivar de la opción realmente correcta (presentAnswer), no de una letra libre')
}

async function testFeedbackFallsBackToGenericWhenExplanationIsPurelyLetterReference() {
  const question = { ...acidQuestion(), explanation: 'La opción b es la correcta.' }
  const signed = { ...question, integrity: signQuestionIntegrity(question) }
  const result = await callSessionCheck(signed, 'opt3')
  assert.equal(result.result.correct, true)
  assert.ok(result.result.feedback.length > 0, 'un feedback vacío tras strip debe caer al mensaje genérico ("Correcto."), nunca quedar en blanco')
}

async function run() {
  testStripsRealObservedCase()
  testStripsNumericAndEnglishVariants()
  testStripsMultipleLetterLists()
  testDoesNotOverStripUnrelatedText()
  testEmptyAndUndefinedExplanation()
  await testRealCaseFeedbackNoLongerReferencesWrongLetter()
  await testIncorrectAnswerFeedbackGroundedInRealCorrectOption()
  await testFeedbackFallsBackToGenericWhenExplanationIsPurelyLetterReference()
  console.log('mcq-feedback-consistency-contracts: PASS (strip aislado A-E + contrato end-to-end contra el POST real, reproducción exacta del caso observado)')
}

run()
