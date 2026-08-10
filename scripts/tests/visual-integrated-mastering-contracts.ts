// End-to-end real (misión: cerrar gaps del reporte anterior, punto 3) usando la
// autoridad de mastery REALMENTE en producción: buildAssessmentBlueprint +
// recordAssessmentEvidence + canCompleteSessionFromAssessment
// (lib/adaptive/evaluation/assessmentBlueprint.ts) — NO lib/adaptive/v3/engine
// (confirmado por Codex A como simulación muerta, sin imports externos).
import assert from 'node:assert/strict'
import {
  buildAssessmentBlueprint,
  canCompleteSessionFromAssessment,
  recordAssessmentEvidence,
} from '../../lib/adaptive/evaluation/assessmentBlueprint'

// ---------------------------------------------------------------------------
// CASO A: visual REQUIRED_FOR_MASTERY
// ---------------------------------------------------------------------------
{
  // Blueprint con DOS objectives — replica el escenario real de producción: el step
  // visual-required recibe tanto una pregunta textual (LLM eval block) como el
  // checkpoint visual, apuntando al MISMO objectiveId; un segundo step normal (sin
  // visual) también debe demostrarse para que la sesión se declare completa — así
  // se prueba "puede mastered SI EL RESTO del contrato también pasa", no solo el
  // objective visual aislado.
  const blueprint = buildAssessmentBlueprint([
    { id: 'step-ice', type: 'concept', microId: 'micro:ice-required', factKeys: ['f:ice'], cognitiveTarget: 'application', importance: 1, requiredEvidenceKind: 'visual_construction' },
    { id: 'step-other', type: 'concept', microId: 'micro:other', factKeys: ['f:other'], cognitiveTarget: 'comprehension', importance: 0.7 },
  ], 'session-caso-a')
  const visualObjective = blueprint.objectives.find(o => o.microId === 'micro:ice-required')!
  const otherObjective = blueprint.objectives.find(o => o.microId === 'micro:other')!

  // Paso 1: textual question CORRECTA sobre el micro visual-required + el otro
  // objective también resuelto por vía textual normal.
  let state = recordAssessmentEvidence(blueprint, [visualObjective.objectiveId], ['f:ice'], {
    valid: true, correct: true, independent: true, evidenceId: 'textual-1', evidenceKind: 'textual',
  })
  state = recordAssessmentEvidence(state, [otherObjective.objectiveId], ['f:other'], {
    valid: true, correct: true, independent: true, evidenceId: 'textual-2', evidenceKind: 'textual',
  })
  const afterTextualOnly = state.objectives.find(o => o.objectiveId === visualObjective.objectiveId)!
  assert.equal(afterTextualOnly.independentlyCorrect, false, 'CASO A.1: textual correcta sobre un micro visual-required NO debe demostrarlo')
  assert.equal(canCompleteSessionFromAssessment(state, []), false, 'CASO A.1: micro NO mastered — la sesión no puede completarse mientras el objective visual siga sin evidencia del tipo correcto')

  // Paso 2 (visual assessment SIGUE sin completar) — la sesión sigue bloqueada,
  // exactamente igual que en el paso 1 (ninguna acción adicional cambió nada).
  assert.equal(canCompleteSessionFromAssessment(state, []), false, 'CASO A.2: mientras el checkpoint visual no se complete, la sesión permanece no mastered')

  // Paso 3: evidencia visual VÁLIDA sobre el mismo objective.
  state = recordAssessmentEvidence(state, [visualObjective.objectiveId], ['f:ice'], {
    valid: true, correct: true, independent: true, evidenceId: 'visual-1', evidenceKind: 'visual_construction',
  })
  const afterVisualEvidence = state.objectives.find(o => o.objectiveId === visualObjective.objectiveId)!
  assert.equal(afterVisualEvidence.independentlyCorrect, true, 'CASO A.3: evidencia visual_construction SÍ debe demostrar el objective visual-required')
  // "resto del MasteryContract" (el otro objective) YA estaba resuelto desde el
  // paso 1 -> ahora la sesión completa SÍ debe declararse mastered.
  assert.equal(canCompleteSessionFromAssessment(state, []), true, 'CASO A.3: con el objective visual demostrado Y el resto del contrato (otherObjective) ya resuelto, la sesión SÍ debe poder completarse')

  console.log('visual-integrated-mastering: CASO A (required_for_mastery gate + unlock) PASS')
}

// Control negativo para CASO A: si el "resto del contrato" (otherObjective) NUNCA se
// resuelve, la evidencia visual del objective required-for-mastery NO basta sola —
// aísla que el criterio realmente exige AMBOS, no solo el visual.
{
  const blueprint = buildAssessmentBlueprint([
    { id: 'step-ice', type: 'concept', microId: 'micro:ice-required', factKeys: ['f:ice'], cognitiveTarget: 'application', importance: 1, requiredEvidenceKind: 'visual_construction' },
    { id: 'step-other', type: 'concept', microId: 'micro:other', factKeys: ['f:other'], cognitiveTarget: 'comprehension', importance: 0.7 },
  ], 'session-caso-a-control')
  const visualObjective = blueprint.objectives.find(o => o.microId === 'micro:ice-required')!
  const state = recordAssessmentEvidence(blueprint, [visualObjective.objectiveId], ['f:ice'], {
    valid: true, correct: true, independent: true, evidenceId: 'visual-only', evidenceKind: 'visual_construction',
  })
  assert.equal(state.objectives.find(o => o.objectiveId === visualObjective.objectiveId)!.independentlyCorrect, true)
  assert.equal(canCompleteSessionFromAssessment(state, []), false, 'CONTROL: evidencia visual del objective required NO basta si otro objective del contrato sigue sin resolver')
  console.log('visual-integrated-mastering: CASO A control (visual solo no basta si falta el resto del contrato) PASS')
}

// ---------------------------------------------------------------------------
// CASO B: visual SUPPORTIVE — el estudiante NUNCA interactúa con el visual;
// evidencia textual suficiente debe alcanzar mastery de todas formas.
// ---------------------------------------------------------------------------
{
  // requiredEvidenceKind ausente = supportive/required_for_understanding en
  // producción (solo required_for_mastery lo setea — ver factoryTeaching).
  const blueprint = buildAssessmentBlueprint([
    { id: 'step-supportive', type: 'concept', microId: 'micro:supportive', factKeys: ['f:supportive'], cognitiveTarget: 'comprehension', importance: 0.7 },
  ], 'session-caso-b')
  const objective = blueprint.objectives[0]
  assert.equal(objective.requiredEvidenceKind, undefined, 'un objective supportive nunca debe traer requiredEvidenceKind seteado')

  // El estudiante responde SOLO la pregunta textual — jamás abre/usa el visual.
  const state = recordAssessmentEvidence(blueprint, [objective.objectiveId], ['f:supportive'], {
    valid: true, correct: true, independent: true, evidenceId: 'textual-only', evidenceKind: 'textual',
  })
  assert.equal(state.objectives[0].independentlyCorrect, true, 'CASO B: evidencia textual sola debe demostrar completamente un objective supportive')
  assert.equal(canCompleteSessionFromAssessment(state, []), true, 'CASO B: la sesión debe poder completarse sin que el estudiante haya tocado el visual — supportive NUNCA bloquea')
  console.log('visual-integrated-mastering: CASO B (supportive nunca bloquea, evidencia textual basta) PASS')
}

console.log('visual-integrated-mastering-contracts: ALL PASS')
