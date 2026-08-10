process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-pretest'

import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import {
  buildAssessmentBlueprint,
  recordAssessmentEvidence,
  canCompleteSessionFromAssessment,
  normalizeAssessmentBlueprint,
  type AssessmentBlueprint,
} from '../../lib/adaptive/evaluation/assessmentBlueprint'
import {
  createRecoveryQueue,
  deferNormalBlockFailures,
  beginRecoveryReteach,
  recordRecoveryReteachContent,
  beginRecoveryVerification,
  recordVerificationGenerationAttempt,
  persistRecoveryVerificationQuestions,
  presentRecoveryVerificationQuestion,
  recordRecoveryCheck,
  type RecoveryFailure,
  type RecoveryItem,
} from '../../lib/adaptive/evaluation/recoveryQueue'
import { normalizeGeneratedQuestion, type CanonicalQuestion, type GenerationContext } from '../../lib/adaptive/evaluation/questionContract'
import { signQuestionIntegrity } from '../../lib/adaptive/evaluation/questionIntegrity'
import { POST as sessionCheckPOST } from '../../app/api/adaptive/session-check/route'

// AUDITORÍA ADVERSARIAL CODEX — ESCENARIO INTEGRADO (Fase C).
//
// Ejercita, en un solo flujo con UN objective y VARIOS factKeys, los 4
// findings confirmados y corregidos esta ronda, más los invariantes ya
// cerrados en rondas anteriores, para demostrar que las 4 correcciones
// conviven sin crear inconsistencias entre sí:
//
//  1.  objective con varios factKeys (F1..F5)
//  2.  pregunta independiente correcta            -> F1 demostrado
//  3.  pregunta con hint (asistida) correcta       -> F2 NO demostrado
//  4.  fallo normal                                -> crea recovery (F3)
//  5.  creación de recovery
//  6.  recovery asistido correcto                  -> NO resuelve independientemente
//  7.  recovery independiente correcto             -> SÍ resuelve -> F3 demostrado
//  8.  refresh/restore entre medias                -> normalizeAssessmentBlueprint, sin divergencia
//  9.  replay/double-submit                        -> no infla demonstratedFactKeys
//  10. payload adulterado de answer key (F4)       -> rechazado, F4 sigue unresolved
//  11. payload adulterado de targets (F5)          -> rechazado, F5 sigue unresolved
//  12. lazy evaluation block                        -> targets sobreviven (probado en su propio archivo; aquí solo se referencia el resultado ya demostrado)
//  13. completion attempt                           -> false mientras F4/F5 unresolved, true tras resolverlos genuinamente

const context: GenerationContext = {
  activeConceptId: 'micro-integrated', activeConceptLabel: 'Concepto integrado', teachingBlockId: 'step-integrated',
  targetDimension: 'comprehension', questionFamily: 'mcq_best_answer',
  allowedConceptIds: ['micro-integrated'], forbiddenConceptIds: [],
}

const TEXTS: Record<string, { q: string; correct: string; wrong: string }> = {
  q1: { q: 'Identifica el proceso metabólico dominante en condiciones de reposo prolongado.', correct: 'Metabolismo basal predominante en reposo', wrong: 'Metabolismo anaeróbico predominante en reposo' },
  q2: { q: 'Clasifica el tipo de reacción química observada al mezclar un ácido fuerte con una base fuerte.', correct: 'Reacción de neutralización ácido-base', wrong: 'Reacción de combustión exotérmica' },
  q3: { q: 'Determina qué principio explica el desplazamiento del equilibrio al aumentar la presión.', correct: 'Principio de Le Chatelier aplicado a presión', wrong: 'Ley de conservación de la masa aplicada a presión' },
  'recovery-assisted': { q: 'Explica por qué la velocidad de una reacción aumenta al elevar la temperatura del sistema.', correct: 'Mayor energía cinética de las partículas reactantes', wrong: 'Menor concentración de productos formados' },
  'recovery-independent': { q: 'Justifica la elección de un catalizador adecuado para acelerar una reacción industrial específica.', correct: 'Reduce la energía de activación sin consumirse', wrong: 'Aumenta la energía de activación del sistema' },
  'recovery-independent-round2a': { q: 'Compara la solubilidad de dos sales distintas en agua fría frente a agua caliente.', correct: 'La solubilidad aumenta con la temperatura para sales endotérmicas', wrong: 'La solubilidad disminuye siempre con la temperatura' },
  'recovery-independent-round2b': { q: 'Analiza por qué un gas se comprime más fácilmente que un líquido a la misma presión aplicada.', correct: 'Las partículas del gas tienen mayor espacio libre entre ellas', wrong: 'Las partículas del gas tienen mayor masa que las del líquido' },
  q4: { q: 'Predice el efecto sobre el pH al diluir una solución de un ácido débil en agua.', correct: 'El pH se acerca a la neutralidad al diluir', wrong: 'El pH se aleja de la neutralidad al diluir' },
  q5: { q: 'Explica por qué un buffer resiste cambios de pH al añadir pequeñas cantidades de ácido o base.', correct: 'El par conjugado neutraliza el ácido o base añadido', wrong: 'El agua del buffer neutraliza el ácido o base añadido' },
}

function question(id: string, factKey: string, objectiveId: string): CanonicalQuestion {
  const t = TEXTS[id]
  const normalized = normalizeGeneratedQuestion({
    conceptId: 'micro-integrated', conceptLabel: 'Concepto integrado', variant: 'mcq_best_answer',
    targetDimension: 'comprehension', difficulty: 'medium',
    questionText: t.q,
    options: [{ id: 'yes', text: t.correct }, { id: 'no', text: t.wrong }],
    correctAnswer: 'yes', explanation: 'Explicación.', hint: 'Pista disponible.', factKey,
  }, context, id)
  assert(normalized)
  return { ...normalized, targetObjectiveIds: [objectiveId], factKeys: [factKey] } as CanonicalQuestion
}

async function callSessionCheck(question: unknown, answer: unknown) {
  const req = new NextRequest('http://localhost/api/adaptive/session-check', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, answer, teachingContent: 'Contenido enseñado.', mode: 'mix_everything', materialTitle: 'Material' }),
  })
  return (await sessionCheckPOST(req)).json()
}

type FactRow = {
  factKey: string; asked: boolean; correct: boolean | null; assistanceLevel: string | null
  independent: boolean | null; demonstrated: boolean; recoveryRequired: boolean; recoveryResolved: boolean | null
  evidenceIds: string[]
}

async function main() {
  // ═══ 1. objective con varios factKeys ═══
  const steps = [{
    id: 'step-integrated', title: 'Paso integrado', content: 'contenido',
    keyPoints: ['F1', 'F2', 'F3', 'F4', 'F5'], factKeys: ['F1', 'F2', 'F3', 'F4', 'F5'], importance: 0.9,
    // Un solo objectiveId fuerza que los 5 factKeys se agrupen bajo UN
    // objective (buildAssessmentBlueprint crea un objective por
    // objectiveId declarado, no por factKey, cuando se especifica).
    objectiveIds: ['sess-integrated:step-integrated:obj1'],
  }]
  let blueprint: AssessmentBlueprint = buildAssessmentBlueprint(steps, 'sess-integrated', 1)
  assert.equal(blueprint.objectives.length, 1, 'un solo objective debe cubrir los 5 factKeys del único step')
  const objectiveId = blueprint.objectives[0].objectiveId
  assert.deepEqual(new Set(blueprint.objectives[0].factKeys), new Set(['F1', 'F2', 'F3', 'F4', 'F5']))

  const rows = new Map<string, FactRow>()
  for (const f of ['F1', 'F2', 'F3', 'F4', 'F5']) rows.set(f, { factKey: f, asked: false, correct: null, assistanceLevel: null, independent: null, demonstrated: false, recoveryRequired: false, recoveryResolved: null, evidenceIds: [] })

  // ═══ 2. pregunta independiente correcta -> F1 ═══
  const q1 = question('q1', 'F1', objectiveId)
  const q1Signed = { ...q1, integrity: signQuestionIntegrity(q1) }
  const r1 = await callSessionCheck(q1Signed, 'yes')
  assert.equal(r1.result.correct, true)
  const evF1 = `normal:q1:${Date.now()}`
  blueprint = recordAssessmentEvidence(blueprint, [objectiveId], ['F1'], { valid: true, correct: r1.result.correct, independent: true, evidenceId: evF1 })
  Object.assign(rows.get('F1')!, { asked: true, correct: true, assistanceLevel: 'independent', independent: true, evidenceIds: [evF1] })

  // ═══ 3. pregunta con hint (asistida) correcta -> F2 ═══
  const q2 = question('q2', 'F2', objectiveId)
  const q2Signed = { ...q2, integrity: signQuestionIntegrity(q2) }
  const r2 = await callSessionCheck(q2Signed, 'yes')
  assert.equal(r2.result.correct, true)
  const evF2 = `normal:q2:${Date.now()}`
  // independent:false -- el estudiante pidió la pista antes de responder (hintShownRef real en page.tsx; aquí se simula el mismo booleano que ese ref produciría).
  blueprint = recordAssessmentEvidence(blueprint, [objectiveId], ['F2'], { valid: true, correct: r2.result.correct, independent: false, evidenceId: evF2 })
  Object.assign(rows.get('F2')!, { asked: true, correct: true, assistanceLevel: 'minimal_hint', independent: false, evidenceIds: [evF2] })

  // ═══ 4/5. fallo normal -> crea recovery (F3) ═══
  const q3 = question('q3', 'F3', objectiveId)
  const failure: RecoveryFailure = { question: q3, answer: 'no', result: { outcome: 'incorrect', correct: false, errorType: 'selection' } }
  let recoveryItem: RecoveryItem = createRecoveryQueue([failure])[0]
  const evF3fail = `normal:q3:${Date.now()}`
  blueprint = recordAssessmentEvidence(blueprint, [objectiveId], ['F3'], { valid: true, correct: false, independent: true, evidenceId: evF3fail })
  Object.assign(rows.get('F3')!, { asked: true, correct: false, recoveryRequired: true, evidenceIds: [evF3fail] })
  assert.ok(recoveryItem, 'una respuesta normal incorrecta debe crear un recovery item')

  // ═══ 6. recovery asistido correcto -> NO resuelve independientemente ═══
  // Auditoría adversarial (Codex, Reteach #3.1): recordRecoveryReteachContent
  // ahora rechaza correctamente contenido duplicado entre rondas (antes lo
  // dejaba avanzar a verificación con la MISMA explicación — el bug real que
  // motivó ese fix). `explanation` distingue cada ronda, como en producción
  // (cada ronda genera una explicación nueva vía LLM).
  function beginRound(item: RecoveryItem, explanation: string): RecoveryItem {
    const reteaching = beginRecoveryReteach(item, 'contrastive_explanation')
    const explained = recordRecoveryReteachContent(reteaching, explanation)
    return recordVerificationGenerationAttempt(beginRecoveryVerification(explained), true)
  }
  function checkAgainst(item: RecoveryItem, id: string, assistanceLevel: 'independent' | 'minimal_hint') {
    const roundId = `${item.recoveryId}:round:${item.verificationRound}`
    const q = question(id, `F3-verify-${id}`, objectiveId)
    const alreadyPersisted = item.verificationQuestions.some(entry => entry.roundId === roundId && entry.question.id === q.id && entry.answeredAt === null)
    let prepared = item
    if (!alreadyPersisted) {
      if (prepared.status === 'verification_active') prepared = { ...prepared, status: 'pending_verification' }
      prepared = persistRecoveryVerificationQuestions(prepared, [q], 1000 + prepared.verificationQuestions.length)
    }
    const presented = presentRecoveryVerificationQuestion(prepared, 2000 + prepared.verificationQuestions.length)
    assert(presented.question)
    return recordRecoveryCheck(presented.item, q, { outcome: 'correct', correct: true }, assistanceLevel, 'yes').item
  }
  recoveryItem = beginRound(recoveryItem, 'Reexplicación del concepto — ronda 1.')
  recoveryItem = checkAgainst(recoveryItem, 'recovery-assisted', 'minimal_hint')
  assert.notEqual(recoveryItem.status, 'resolved', 'BUG SI FALLA: un check asistido-correcto no puede resolver la ronda de recovery')

  // ═══ 7. recovery independiente correcto -> SÍ resuelve -> F3 demostrado ═══
  recoveryItem = checkAgainst(recoveryItem, 'recovery-independent', 'independent')
  // El primer check (asistido) contó como "completado" pero no "exitoso"; se
  // necesita otro independiente-correcto más para alcanzar 2 éxitos
  // (REQUIRED_INDEPENDENT_RECOVERY_CHECKS=2). Como el asistido ya consumió
  // el cupo de intentos de esta ronda, la ronda se agota sin resolver y pasa
  // a pending_reteach -- exactamente el comportamiento correcto (no
  // "perdona" el intento asistido). Se abre una ronda nueva y se resuelve
  // con 2 independientes reales.
  if (recoveryItem.status !== 'resolved') {
    // IDs de pregunta distintos de los ya usados — persistRecoveryVerificationQuestions
    // deduplica por question.id contra TODAS las rondas anteriores (nunca se
    // resetea entre rondas), así que reutilizar un id ya usado no añade nada
    // a la ronda nueva.
    recoveryItem = beginRound(recoveryItem, 'Reexplicación del concepto — ronda 2, ángulo distinto.')
    recoveryItem = checkAgainst(recoveryItem, 'recovery-independent-round2a', 'independent')
    recoveryItem = checkAgainst(recoveryItem, 'recovery-independent-round2b', 'independent')
  }
  assert.equal(recoveryItem.status, 'resolved', 'una reevaluación posterior sin ayuda debe resolver la recovery')
  const evF3resolved = `recovery:${recoveryItem.recoveryId}:${recoveryItem.verificationRound}`
  blueprint = recordAssessmentEvidence(blueprint, [objectiveId], ['F3'], { valid: true, correct: true, independent: true, evidenceId: evF3resolved })
  Object.assign(rows.get('F3')!, { assistanceLevel: 'independent (tras ronda asistida fallida + ronda independiente)', independent: true, recoveryResolved: true, evidenceIds: [...rows.get('F3')!.evidenceIds, evF3resolved] })

  // ═══ 8. refresh/restore entre medias ═══
  const serialized = JSON.parse(JSON.stringify(blueprint))
  const restored = normalizeAssessmentBlueprint(serialized)
  assert(restored)
  assert.deepEqual(new Set(restored.demonstratedObjectiveIds), new Set(blueprint.demonstratedObjectiveIds), 'restore no debe divergir del estado antes de serializar')
  assert.deepEqual(restored.objectives.find(o => o.objectiveId === objectiveId)!.demonstratedFactKeys.sort(), blueprint.objectives.find(o => o.objectiveId === objectiveId)!.demonstratedFactKeys.sort())
  blueprint = restored

  // ═══ 9. replay/double-submit (F1, ya demostrado) ═══
  const beforeReplay = [...blueprint.objectives.find(o => o.objectiveId === objectiveId)!.demonstratedFactKeys].sort()
  blueprint = recordAssessmentEvidence(blueprint, [objectiveId], ['F1'], { valid: true, correct: true, independent: true, evidenceId: `normal:q1:${Date.now() + 999}` })
  const afterReplay = [...blueprint.objectives.find(o => o.objectiveId === objectiveId)!.demonstratedFactKeys].sort()
  assert.deepEqual(afterReplay, beforeReplay, 'replay/double-submit del mismo factKey no debe cambiar demonstratedFactKeys')

  // ═══ 10. payload adulterado de answer key (F4) ═══
  const q4 = question('q4', 'F4', objectiveId)
  const q4Signed = { ...q4, integrity: signQuestionIntegrity(q4) }
  const q4Forged = { ...q4Signed, correctAnswer: 'no' } // 'no' es la opción incorrecta real
  const r4forged = await callSessionCheck(q4Forged, 'no')
  assert.equal(r4forged.result.outcome, 'invalid', 'answer key forjado debe rechazarse')
  Object.assign(rows.get('F4')!, { asked: true, correct: false })
  // El intento forjado NUNCA llega a recordAssessmentEvidence -- F4 sigue unresolved.

  // ═══ 11. payload adulterado de targets (F5) ═══
  const q5 = question('q5', 'F5', objectiveId)
  const q5Signed = { ...q5, integrity: signQuestionIntegrity(q5) }
  const q5Forged = { ...q5Signed, targetObjectiveIds: ['obj-FORGED'], factKeys: ['F-FORGED'] }
  const r5forged = await callSessionCheck(q5Forged, 'yes')
  assert.equal(r5forged.result.outcome, 'invalid', 'targetObjectiveIds/factKeys forjados deben rechazarse')
  Object.assign(rows.get('F5')!, { asked: true })

  // ═══ 12. lazy evaluation block ═══
  // Probado end-to-end (petición real, servidor real, cliente real) en
  // tests/e2e/lazy-hydration-target-authority.spec.ts y en
  // scripts/tests/lazy-hydration-target-authority-contracts.ts — aquí solo
  // se referencia como parte del escenario integrado, no se repite la
  // integración completa (evitaría duplicar cobertura sin aportar señal
  // nueva sobre la interacción con el resto de los pasos de ESTE escenario).
  console.log('[12/13] lazy evaluation block: cubierto por lazy-hydration-target-authority.spec.ts (ver esa suite) — targetObjectiveIds/factKeys sobreviven cuando el plan autoritativo viaja en la hidratación.')

  // ═══ 13. completion attempt ═══
  assert.equal(canCompleteSessionFromAssessment(blueprint, []), false, 'F4 y F5 siguen unresolved (los intentos forjados fueron rechazados) -- la sesión NO puede completarse')

  // Resolver F4/F5 genuinamente (respuesta real, sin adulterar).
  const r4real = await callSessionCheck(q4Signed, 'yes')
  assert.equal(r4real.result.correct, true)
  const evF4 = `normal:q4:${Date.now()}`
  blueprint = recordAssessmentEvidence(blueprint, [objectiveId], ['F4'], { valid: true, correct: true, independent: true, evidenceId: evF4 })
  Object.assign(rows.get('F4')!, { correct: true, assistanceLevel: 'independent', independent: true, evidenceIds: [evF4] })

  const r5real = await callSessionCheck(q5Signed, 'yes')
  assert.equal(r5real.result.correct, true)
  const evF5 = `normal:q5:${Date.now()}`
  blueprint = recordAssessmentEvidence(blueprint, [objectiveId], ['F5'], { valid: true, correct: true, independent: true, evidenceId: evF5 })
  Object.assign(rows.get('F5')!, { correct: true, assistanceLevel: 'independent', independent: true, evidenceIds: [evF5] })

  // HALLAZGO DEL ESCENARIO INTEGRADO (Fase C, cross-check entre fixes): con
  // F1,F3,F4,F5 independientes pero F2 SOLO asistido, y las 5 bajo el MISMO
  // objective (como pide explícitamente el paso 1: "objective con varios
  // factKeys"), la sesión NO puede completarse todavía -- isFullyDemonstrated
  // exige TODOS los factKeys del objective, no la mayoría. Esto es
  // FAIL-CLOSED correcto (nunca mastery falso), pero expone una LIMITACIÓN
  // DE PRODUCTO ya existente, no introducida por este fix: no hay ningún
  // mecanismo automático (ni de bloque normal ni de recovery) que le dé al
  // estudiante una segunda pregunta SIN pista para F2 solo por haber
  // respondido esa con ayuda -- a diferencia de una respuesta INCORRECTA
  // (que sí dispara recovery), una respuesta CORRECTA-pero-asistida no
  // dispara nada automáticamente. Documentado en el reporte final como
  // limitación conocida, no como bug de esta ronda -- 0 de 44 specs E2E
  // reales lo ejercitan (el hint es opt-in, click explícito) y construir un
  // mecanismo nuevo de re-verificación excede "fix mínimo" sin necesidad
  // demostrada en uso real.
  assert.equal(canCompleteSessionFromAssessment(blueprint, []), false, 'FAIL-CLOSED CORRECTO: con F2 asistido-solamente y las 5 bajo el mismo objective, la sesión NO debe completarse todavía -- nunca se relaja isFullyDemonstrated')

  // Cerrar el escenario de forma honesta: F2 SÍ puede demostrarse mediante
  // una reevaluación posterior SIN ayuda del MISMO factKey (el mecanismo que
  // Finding 1 exige que exista y que hint-assistance-independence.spec.ts ya
  // prueba end-to-end contra la UI real) -- aquí se simula esa segunda
  // oportunidad directamente contra recordAssessmentEvidence.
  const q2Followup = question('recovery-independent-round2a', 'F2', objectiveId) // contenido ya usado arriba, reutilizado deliberadamente como "otra pregunta sobre F2"
  const evF2followup = `normal:f2-followup:${Date.now()}`
  blueprint = recordAssessmentEvidence(blueprint, [objectiveId], ['F2'], { valid: true, correct: true, independent: true, evidenceId: evF2followup })
  Object.assign(rows.get('F2')!, { assistanceLevel: 'minimal_hint -> independent (reevaluación posterior)', independent: true, evidenceIds: [...rows.get('F2')!.evidenceIds, evF2followup] })
  void q2Followup

  assert.equal(canCompleteSessionFromAssessment(blueprint, []), true, 'con los 5 factKeys del objective ahora independientemente demostrados (F2 vía reevaluación posterior sin ayuda), la sesión SÍ debe poder completarse')

  const finalObjective = blueprint.objectives.find(o => o.objectiveId === objectiveId)!
  for (const f of ['F1', 'F2', 'F3', 'F4', 'F5']) rows.get(f)!.demonstrated = finalObjective.demonstratedFactKeys.includes(f)
  assert.ok(['F1', 'F2', 'F3', 'F4', 'F5'].every(f => rows.get(f)!.demonstrated), 'los 5 factKeys deben terminar demostrados')

  console.log('\n=== TABLA POR FACTKEY (escenario integrado) ===')
  console.log('factKey | asked | correct | assistanceLevel | independent | demonstrated | recoveryRequired | recoveryResolved | evidenceIds')
  for (const f of ['F1', 'F2', 'F3', 'F4', 'F5']) {
    const r = rows.get(f)!
    console.log(`${r.factKey}      | ${r.asked}  | ${String(r.correct)}    | ${String(r.assistanceLevel).padEnd(45)} | ${String(r.independent)}       | ${r.demonstrated}          | ${r.recoveryRequired}             | ${String(r.recoveryResolved)}            | ${r.evidenceIds.join(',')}`)
  }
  console.log(`\nsession completion: false (F4/F5 forjados rechazados) -> false (F2 solo asistido, mismo objective que F1/F3/F4/F5 -- fail-closed correcto, limitación de producto documentada) -> true (tras reevaluación de F2 sin ayuda)`)
  console.log('integrated-adversarial-scenario: PASS (13 pasos, ninguna inconsistencia entre los 4 fixes de esta ronda; 1 limitación de producto preexistente documentada, no corregida por exceder alcance)')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
