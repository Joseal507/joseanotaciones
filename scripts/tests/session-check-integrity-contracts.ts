process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-pretest'

import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST as sessionCheckPOST } from '../../app/api/adaptive/session-check/route'
import { signQuestionIntegrity, signQuestionsInPlace, verifyQuestionIntegrity } from '../../lib/adaptive/evaluation/questionIntegrity'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'
import { buildAssessmentBlueprint, recordAssessmentEvidence } from '../../lib/adaptive/evaluation/assessmentBlueprint'

// AUDITORÍA ADVERSARIAL CODEX — Finding 2 (P0, CONFIRMED, dos mitades: A =
// grading authority, B = evidence-target authority). Reproducción real
// (Fase A, contra el código productivo de entonces): tomar una pregunta
// válida, forjar correctAnswer en el payload para que coincida con la
// respuesta objetivamente incorrecta enviada -> el servidor devolvía
// correct:true. Forjar targetObjectiveIds/factKeys -> el cliente acreditaría
// evidencia a objetivos arbitrarios (misma causa raíz: session-check no
// tenía ninguna fuente de verdad más allá del propio payload del cliente).
//
// Fix: SERVER-AUTHORITATIVE QUESTION CONTRACT — cada pregunta generada por
// el servidor (session-teach/session-eval/session-reteach) se firma
// (HMAC-SHA256 sobre id/format/correctAnswer/targetObjectiveIds/factKeys,
// usando NEXTAUTH_SECRET, secreto server-only ya existente). session-check
// verifica esa firma ANTES de confiar en esos campos — payload adulterado
// después de la firma invalida la firma, la pregunta se trata como inválida
// (mismo camino de degradación que cualquier otro fallo de validación,
// fail-closed).
//
// Este archivo prueba dos capas:
//  1. questionIntegrity.ts en aislamiento (sign/verify puro).
//  2. El contrato END-TO-END contra el POST REAL de session-check — sin
//     generación real de IA (innecesaria: la pregunta se construye a mano y
//     se firma con la MISMA función que usan las rutas de generación,
//     exactamente lo que verify comprueba), determinista y rápido, apto para
//     pretest.

function baseQuestion(): CanonicalQuestion {
  return {
    id: 'q-integrity-1', conceptId: 'c1', conceptLabel: 'Concepto', teachingBlockId: 'step_1',
    questionFamily: 'mcq_best_answer', variant: 'mcq_best_answer', difficulty: 'medium',
    targetDimension: 'comprehension', questionText: 'Pregunta de prueba con longitud suficiente.',
    explanation: 'Explicación.', hint: '', estimatedSeconds: 30, evidencesNeeded: 1, factKey: 'fact-1',
    factKeys: ['fact-1'], targetObjectiveIds: ['obj-1'],
    format: 'multiple_choice', options: [{ id: 'a', text: 'Correcta' }, { id: 'b', text: 'Incorrecta' }], correctAnswer: 'a',
  } as CanonicalQuestion
}

// ═══ 1. questionIntegrity.ts en aislamiento ═══
function testSignVerifyRoundtrip() {
  const question = { ...baseQuestion(), integrity: undefined } as CanonicalQuestion
  const signature = signQuestionIntegrity(question)
  assert.ok(signature.length > 0)
  const signed = { ...question, integrity: signature }
  assert.equal(verifyQuestionIntegrity(signed), true, 'una pregunta firmada correctamente debe verificar OK')
}

function testTamperedCorrectAnswerFailsVerification() {
  const question = baseQuestion()
  const signed = { ...question, integrity: signQuestionIntegrity(question) }
  const tampered = { ...signed, correctAnswer: 'b' }
  assert.equal(verifyQuestionIntegrity(tampered), false, 'BUG DE CODEX SI FALLA: correctAnswer alterado después de firmar debe invalidar la firma')
}

function testTamperedTargetObjectiveIdsFailsVerification() {
  const question = baseQuestion()
  const signed = { ...question, integrity: signQuestionIntegrity(question) }
  const tampered = { ...signed, targetObjectiveIds: ['obj-FORGED'] }
  assert.equal(verifyQuestionIntegrity(tampered), false, 'BUG DE CODEX SI FALLA: targetObjectiveIds alterado después de firmar debe invalidar la firma')
}

function testTamperedFactKeysFailsVerification() {
  const question = baseQuestion()
  const signed = { ...question, integrity: signQuestionIntegrity(question) }
  const tampered = { ...signed, factKeys: ['fact-FORGED'] }
  assert.equal(verifyQuestionIntegrity(tampered), false, 'BUG DE CODEX SI FALLA: factKeys alterado después de firmar debe invalidar la firma')
}

function testMissingSignatureFailsVerification() {
  const question = baseQuestion()
  assert.equal(verifyQuestionIntegrity(question), false, 'una pregunta sin integrity nunca debe verificar OK — payload construido enteramente por el cliente')
}

function testGarbageSignatureNeverThrows() {
  const question = baseQuestion()
  for (const garbage of [null, undefined, '', 'not-hex', 123, {}, 'a'.repeat(1000)] as unknown[]) {
    const tampered = { ...question, integrity: garbage } as CanonicalQuestion
    assert.doesNotThrow(() => verifyQuestionIntegrity(tampered), `verifyQuestionIntegrity nunca debe lanzar con integrity=${JSON.stringify(garbage)}`)
    assert.equal(verifyQuestionIntegrity(tampered), false)
  }
}

function testSignQuestionsInPlaceSignsEveryQuestion() {
  const questions = [baseQuestion(), { ...baseQuestion(), id: 'q-integrity-2' }]
  signQuestionsInPlace(questions)
  for (const q of questions) {
    assert.ok((q as CanonicalQuestion).integrity, `cada pregunta debe recibir integrity`)
    assert.equal(verifyQuestionIntegrity(q), true)
  }
}

// ═══ 2. Contrato end-to-end contra el POST real de session-check ═══
async function callSessionCheck(question: unknown, answer: unknown) {
  const req = new NextRequest('http://localhost/api/adaptive/session-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, answer, teachingContent: 'Contenido enseñado.', mode: 'mix_everything', materialTitle: 'Material' }),
  })
  const res = await sessionCheckPOST(req)
  return res.json()
}

async function testRealPostAcceptsGenuinelySignedQuestion() {
  const question = baseQuestion()
  const signed = { ...question, integrity: signQuestionIntegrity(question) }
  const correct = await callSessionCheck(signed, 'a')
  assert.equal(correct.success, true)
  assert.equal(correct.result.outcome === 'invalid', false, `pregunta genuinamente firmada no debe rechazarse (result: ${JSON.stringify(correct.result)})`)
  assert.equal(correct.result.correct, true, 'respuesta objetivamente correcta contra pregunta genuina debe calificar correct:true')

  const incorrect = await callSessionCheck(signed, 'b')
  assert.equal(incorrect.result.correct, false, 'respuesta objetivamente incorrecta contra pregunta genuina debe calificar correct:false')
}

async function testRealPostRejectsForgedCorrectAnswer() {
  // REPRODUCCIÓN EXACTA DEL EXPLOIT DE CODEX (2A): firmar la pregunta real,
  // luego alterar correctAnswer para que coincida con la respuesta
  // objetivamente incorrecta que se va a enviar.
  const question = baseQuestion()
  const signed = { ...question, integrity: signQuestionIntegrity(question) }
  const forged = { ...signed, correctAnswer: 'b' } // 'b' es la opción incorrecta real
  const result = await callSessionCheck(forged, 'b')
  assert.equal(result.result.outcome, 'invalid', 'FIX CONFIRMADO SI PASA / BUG DE CODEX SI FALLA: correctAnswer forjado debe rechazarse, nunca calificar correct:true')
  assert.equal(result.result.correct, false)
}

async function testRealPostRejectsForgedTargets() {
  // Reproducción del exploit de Codex (2B): targetObjectiveIds/factKeys
  // forjados para acreditar evidencia a objetivos arbitrarios.
  const question = baseQuestion()
  const signed = { ...question, integrity: signQuestionIntegrity(question) }
  const forged = { ...signed, targetObjectiveIds: ['obj-FORGED'], factKeys: ['fact-FORGED'] }
  const result = await callSessionCheck(forged, 'a')
  assert.equal(result.result.outcome, 'invalid', 'FIX CONFIRMADO SI PASA / BUG DE CODEX SI FALLA: targetObjectiveIds/factKeys forjados deben rechazarse')
}

async function testRealPostRejectsUnsignedQuestion() {
  const question = baseQuestion() // sin integrity
  const result = await callSessionCheck(question, 'a')
  assert.equal(result.result.outcome, 'invalid', 'una pregunta sin firma en absoluto (payload enteramente construido por el cliente) debe rechazarse')
}

// ═══ Subfinding de Finding 2: double-submit/replay en el MISMO boundary
// (session-check -> recordAssessmentEvidence). Verificación (Fase A):
// evidenceId usa `normal:${question.id}:${Date.now()}` — dos submits reales
// (doble click, retry de red) generan evidenceId DISTINTOS, así que el guard
// por evidenceId (assessmentBlueprint.ts:291) NO los deduplica. La
// protección real es estructural: demonstratedFactKeys es una unión de Set
// (línea 299) — un segundo registro del mismo factKey es un no-op para
// mastery, sin importar el evidenceId. Clasificación: ALREADY FIXED
// (estructuralmente, no por diseño de evidenceId) — este test lo demuestra
// explícitamente en vez de solo documentarlo. ═══
function testDoubleSubmitDoesNotInflateMastery() {
  const steps = [{ id: 'step-1', title: 'Paso 1', content: 'contenido', keyPoints: ['kp-1'], importance: 0.8 }]
  const blueprint = buildAssessmentBlueprint(steps, 'sess-double-submit', 1)
  const [objectiveId] = blueprint.objectives.map(o => o.objectiveId)
  const factKeys = blueprint.objectives[0].factKeys

  // Primer submit real.
  const once = recordAssessmentEvidence(blueprint, [objectiveId], factKeys, {
    valid: true, correct: true, independent: true, evidenceId: `normal:q1:${Date.now()}`,
  })
  // "Doble click" / retry de red: MISMA pregunta, MISMO resultado, pero un
  // evidenceId DISTINTO (Date.now() avanzó) — exactamente el caso real que
  // el guard por evidenceId NO detecta.
  const twice = recordAssessmentEvidence(once, [objectiveId], factKeys, {
    valid: true, correct: true, independent: true, evidenceId: `normal:q1:${Date.now() + 1}`,
  })

  const objectiveOnce = once.objectives.find(o => o.objectiveId === objectiveId)!
  const objectiveTwice = twice.objectives.find(o => o.objectiveId === objectiveId)!
  assert.deepEqual(
    new Set(objectiveTwice.demonstratedFactKeys), new Set(objectiveOnce.demonstratedFactKeys),
    'un segundo registro (evidenceId distinto) del MISMO resultado no debe añadir nada nuevo a demonstratedFactKeys — double-submit no puede inflar mastery',
  )
  assert.equal(twice.demonstratedObjectiveIds.includes(objectiveId), once.demonstratedObjectiveIds.includes(objectiveId), 'el estado de "demostrado" no debe cambiar entre el primer y el segundo registro idéntico')
  assert.equal(canCompleteFromBoth(once) , canCompleteFromBoth(twice), 'completion no debe depender de cuántas veces se repitió el mismo submit')

  function canCompleteFromBoth(b: typeof once) { return b.unresolvedObjectiveIds.length === 0 }
}

function testDoubleSubmitOfIncorrectDoesNotDoublePenalizeMastery() {
  // Un doble-submit de una respuesta INCORRECTA sí incrementa failedAttempts
  // dos veces (contador informativo) — pero eso nunca puede, por sí solo,
  // demostrar un factKey ni completar la sesión; solo hace recovery más
  // probable, nunca infla mastery. Confirmar explícitamente que
  // demonstratedFactKeys permanece vacío en ambos casos.
  const steps = [{ id: 'step-1', title: 'Paso 1', content: 'contenido', keyPoints: ['kp-1'], importance: 0.8 }]
  const blueprint = buildAssessmentBlueprint(steps, 'sess-double-submit-2', 1)
  const [objectiveId] = blueprint.objectives.map(o => o.objectiveId)
  const factKeys = blueprint.objectives[0].factKeys
  const once = recordAssessmentEvidence(blueprint, [objectiveId], factKeys, { valid: true, correct: false, independent: true, evidenceId: `normal:q1:${Date.now()}` })
  const twice = recordAssessmentEvidence(once, [objectiveId], factKeys, { valid: true, correct: false, independent: true, evidenceId: `normal:q1:${Date.now() + 1}` })
  const objectiveTwice = twice.objectives.find(o => o.objectiveId === objectiveId)!
  assert.deepEqual(objectiveTwice.demonstratedFactKeys, [], 'doble-submit de una respuesta incorrecta nunca puede demostrar un factKey')
  assert.equal(twice.demonstratedObjectiveIds.includes(objectiveId), false)
}

async function main() {
  testSignVerifyRoundtrip()
  testTamperedCorrectAnswerFailsVerification()
  testTamperedTargetObjectiveIdsFailsVerification()
  testTamperedFactKeysFailsVerification()
  testMissingSignatureFailsVerification()
  testGarbageSignatureNeverThrows()
  testSignQuestionsInPlaceSignsEveryQuestion()
  testDoubleSubmitDoesNotInflateMastery()
  testDoubleSubmitOfIncorrectDoesNotDoublePenalizeMastery()
  await testRealPostAcceptsGenuinelySignedQuestion()
  await testRealPostRejectsForgedCorrectAnswer()
  await testRealPostRejectsForgedTargets()
  await testRealPostRejectsUnsignedQuestion()
  console.log('session-check-integrity-contracts: PASS (sign/verify aislado + contrato end-to-end contra el POST real: acepta firmada genuina, rechaza correctAnswer/targets forjados, rechaza sin firma)')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
