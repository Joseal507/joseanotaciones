process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-pretest'
import assert from 'node:assert/strict'
import { classifyVisualNeed } from '../../lib/adaptive/visual/visualNeedClassifier'
import { buildVisualSpec } from '../../lib/adaptive/visual/visualSpecBuilder'
import { gradeVisualInteraction } from '../../lib/adaptive/visual/visualGrading'
import { signVisualSpec, verifyVisualSpecIntegrity } from '../../lib/adaptive/visual/visualSpecIntegrity'
import { buildAssessmentBlueprint, recordAssessmentEvidence } from '../../lib/adaptive/evaluation/assessmentBlueprint'

const iceContent = 'Reacción: N2 + 3H2 ⇌ 2NH3. Concentraciones iniciales: [N2]=1.00, [H2]=3.00, [NH3]=0.00. Cambio: [N2]=-x, [H2]=-3x, [NH3]=+2x. En el equilibrio: [N2]=1.00-x, [H2]=3.00-3x, [NH3]=2x.'
const req = classifyVisualNeed({
  microId: 'micro:ice', title: 'Equilibrio', content: iceContent, keyPoints: [], factKeys: ['f:ice'],
  cognitiveTarget: 'application', sourceStepId: 'step1',
})!
const spec = signVisualSpec(buildVisualSpec(req, iceContent, 'step1')!)

// ---------------------------------------------------------------------------
// Integridad server-authoritative: firma válida vs. dataSpec forjado.
// ---------------------------------------------------------------------------
{
  assert.equal(verifyVisualSpecIntegrity(spec), true, 'una firma recién emitida debe verificar')
  const tampered = { ...spec, data: { ...spec.data, equilibrium: { ...spec.data.equilibrium, N2: '999' } } }
  assert.equal(verifyVisualSpecIntegrity(tampered), false, 'un dataSpec mutado por el cliente debe invalidar la firma')
  const stripped = { ...spec, integrity: undefined }
  assert.equal(verifyVisualSpecIntegrity(stripped as typeof spec), false, 'sin firma, nunca se debe confiar en el spec')
  console.log('visual-integrity: server-authoritative signature PASS')
}

// ---------------------------------------------------------------------------
// FASE 5: un objective con requiredEvidenceKind='visual_construction' NO puede
// demostrarse con evidencia 'textual' (p.ej. una MCQ correcta) — pero SÍ con
// evidencia 'visual_construction'. Objectives sin requiredEvidenceKind no cambian
// de comportamiento (regresión cero para el flujo textual existente).
// ---------------------------------------------------------------------------
{
  const blueprint = buildAssessmentBlueprint([
    { id: 'step1', type: 'concept', microId: 'micro:ice', factKeys: ['f:ice'], cognitiveTarget: 'application', importance: 1, requiredEvidenceKind: 'visual_construction' },
    { id: 'step2', type: 'concept', microId: 'micro:textual', factKeys: ['f:textual'], cognitiveTarget: 'comprehension', importance: 0.7 },
  ], 'session1')
  const visualObjective = blueprint.objectives.find(o => o.microId === 'micro:ice')!
  const textualObjective = blueprint.objectives.find(o => o.microId === 'micro:textual')!

  // Intento 1: evidencia textual (MCQ) correcta contra el objective visual-required —
  // NUNCA debe demostrarlo (false mastery si lo hiciera).
  const afterTextualAttempt = recordAssessmentEvidence(blueprint, [visualObjective.objectiveId], ['f:ice'], {
    valid: true, correct: true, independent: true, evidenceId: 'ev1', evidenceKind: 'textual',
  })
  const stillUnresolved = afterTextualAttempt.objectives.find(o => o.objectiveId === visualObjective.objectiveId)!
  assert.equal(stillUnresolved.demonstratedFactKeys.length, 0, 'evidencia textual NUNCA debe demostrar un objective que exige visual_construction')
  assert.equal(stillUnresolved.assessed, true, 'el intento sigue quedando registrado (assessed=true), solo no demuestra')

  // Intento 2: evidencia visual_construction correcta -> SÍ demuestra.
  const afterVisualAttempt = recordAssessmentEvidence(afterTextualAttempt, [visualObjective.objectiveId], ['f:ice'], {
    valid: true, correct: true, independent: true, evidenceId: 'ev2', evidenceKind: 'visual_construction',
  })
  const resolved = afterVisualAttempt.objectives.find(o => o.objectiveId === visualObjective.objectiveId)!
  assert.equal(resolved.demonstratedFactKeys.length, 1, 'evidencia visual_construction sí debe demostrar el objective visual-required')
  assert.equal(resolved.independentlyCorrect, true)

  // Objective SIN requiredEvidenceKind: comportamiento textual histórico intacto.
  const textualFlow = recordAssessmentEvidence(blueprint, [textualObjective.objectiveId], ['f:textual'], {
    valid: true, correct: true, independent: true, evidenceId: 'ev3', evidenceKind: 'textual',
  })
  const textualResolved = textualFlow.objectives.find(o => o.objectiveId === textualObjective.objectiveId)!
  assert.equal(textualResolved.independentlyCorrect, true, 'objectives sin requiredEvidenceKind deben seguir demostrándose con evidencia textual (regresión cero)')

  console.log('visual-integrity: mastery gating (visual_construction vs textual) PASS')
}

// ---------------------------------------------------------------------------
// End-to-end determinista: grade -> evidenceKind -> recordAssessmentEvidence,
// usando el resultado REAL de gradeVisualInteraction (no un evidenceKind inventado
// a mano en el test).
// ---------------------------------------------------------------------------
{
  const blueprint = buildAssessmentBlueprint([
    { id: 'step1', type: 'concept', microId: 'micro:ice', factKeys: ['f:ice'], cognitiveTarget: 'application', importance: 1, requiredEvidenceKind: 'visual_construction' },
  ], 'session2')
  const objective = blueprint.objectives[0]
  const grading = gradeVisualInteraction(spec, {
    visualSpecId: spec.id, verb: 'fill_cell', response: { N2: '1.00-x', H2: '3.00-3x', NH3: '2x' },
  })
  assert.equal(grading.correct, true)
  const updated = recordAssessmentEvidence(blueprint, [objective.objectiveId], ['f:ice'], {
    valid: true, correct: grading.correct, independent: true, evidenceId: 'ev-e2e', evidenceKind: grading.evidenceKind,
  })
  assert.equal(updated.demonstratedObjectiveIds.includes(objective.objectiveId), true)
  console.log('visual-integrity: end-to-end grade -> evidence -> mastery PASS')
}

console.log('visual-integrity-mastery-gating-contracts: ALL PASS')
