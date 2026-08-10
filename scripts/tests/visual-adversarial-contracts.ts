process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-pretest'
import assert from 'node:assert/strict'
import { classifyVisualNeed } from '../../lib/adaptive/visual/visualNeedClassifier'
import { buildVisualSpec } from '../../lib/adaptive/visual/visualSpecBuilder'
import { gradeVisualInteraction } from '../../lib/adaptive/visual/visualGrading'
import { signVisualSpec, verifyVisualSpecIntegrity } from '../../lib/adaptive/visual/visualSpecIntegrity'
import { buildAssessmentBlueprint, recordAssessmentEvidence } from '../../lib/adaptive/evaluation/assessmentBlueprint'
import { describeVisualSpec } from '../../components/visual/VisualRenderer'
import type { VisualSpec } from '../../lib/adaptive/visual/visualContract'

const iceContent = 'Reacción: N2 + 3H2 ⇌ 2NH3. Concentraciones iniciales: [N2]=1.00, [H2]=3.00, [NH3]=0.00. Cambio: [N2]=-x, [H2]=-3x, [NH3]=+2x. En el equilibrio: [N2]=1.00-x, [H2]=3.00-3x, [NH3]=2x.'
const req = classifyVisualNeed({ microId: 'micro:ice', title: 'Equilibrio', content: iceContent, keyPoints: [], factKeys: ['f:ice'], cognitiveTarget: 'application', sourceStepId: 'step1' })!
const validSpec = signVisualSpec(buildVisualSpec(req, iceContent, 'step1')!)

// 1) Spoofed dataSpec (mutación de cliente) — integridad debe rechazar.
{
  const spoofed = { ...validSpec, data: { ...validSpec.data, equilibrium: { N2: '0', H2: '0', NH3: '0' } } }
  assert.equal(verifyVisualSpecIntegrity(spoofed), false, 'un dataSpec forjado nunca debe pasar la verificación de integridad')
  console.log('visual-adversarial: spoofed dataSpec rejected PASS')
}

// 2) Engine forjado (cambiar de structured_grid a otro) — integridad debe rechazar
// (engine forma parte de integrityFields).
{
  const spoofedEngine = { ...validSpec, engine: 'graph_2d' } as unknown as VisualSpec
  assert.equal(verifyVisualSpecIntegrity(spoofedEngine), false, 'cambiar engine sin re-firmar debe invalidar la firma')
  console.log('visual-adversarial: spoofed engine rejected PASS')
}

// 3) Grading mismatch: submission.visualSpecId no coincide con spec.id — nunca debe
// calificar como correcto ni lanzar.
{
  const result = gradeVisualInteraction(validSpec, { visualSpecId: 'otro-spec-id', verb: 'fill_cell', response: { N2: '1.00-x' } })
  assert.equal(result.correct, false)
  assert.equal(result.errorType, 'spec_mismatch')
  console.log('visual-adversarial: visualSpecId mismatch rejected PASS')
}

// 4) Respuestas malformadas/estado imposible del estudiante — cada engine debe
// fallar cerrado (correct:false) y NUNCA lanzar una excepción, sin importar la forma.
{
  const malformedResponses: unknown[] = [null, undefined, 42, 'texto', [], {}, { random: 'shape' }]
  for (const response of malformedResponses) {
    assert.doesNotThrow(() => gradeVisualInteraction(validSpec, { visualSpecId: validSpec.id, verb: 'fill_cell', response }))
    const result = gradeVisualInteraction(validSpec, { visualSpecId: validSpec.id, verb: 'fill_cell', response })
    assert.equal(result.correct, false)
  }
  console.log('visual-adversarial: malformed/impossible student responses fail-closed without throwing PASS')
}

// 5) Fuzz de forma malformada a través de los 6 engines — ninguno debe lanzar.
{
  const graphContent = 'La función f(x) = 2x + 3 tiene dominio -5 <= x <= 5. La gráfica muestra pendiente positiva.'
  const graphReq = classifyVisualNeed({ microId: 'm', title: 't', content: graphContent, keyPoints: [], factKeys: ['f'], cognitiveTarget: 'application', sourceStepId: 's' })!
  const graphSpec = signVisualSpec(buildVisualSpec(graphReq, graphContent, 's')!)

  const dclContent = 'Diagrama de cuerpo libre: Sobre el bloque actúan: Peso = 50 N a 270°, Normal = 43.3 N a 90°.'
  const dclReq = classifyVisualNeed({ microId: 'm', title: 't', content: dclContent, keyPoints: [], factKeys: ['f'], cognitiveTarget: 'application', sourceStepId: 's' })!
  const dclSpec = signVisualSpec(buildVisualSpec(dclReq, dclContent, 's')!)

  const orgContent = 'Átomos: C1=carbono, C2=carbono. Enlaces: C1-C2 (enlace simple).'
  const orgReq = classifyVisualNeed({ microId: 'm', title: 't', content: orgContent, keyPoints: [], factKeys: ['f'], cognitiveTarget: 'comprehension', sourceStepId: 's' })!
  const orgSpec = signVisualSpec(buildVisualSpec(orgReq, orgContent, 's')!)

  const codeContent = '```python\nx = 3\nprint(x)\n```\nTraza: línea 1 x=3; línea 2 salida=3.'
  const codeReq = classifyVisualNeed({ microId: 'm', title: 't', content: codeContent, keyPoints: [], factKeys: ['f'], cognitiveTarget: 'application', sourceStepId: 's' })!
  const codeSpec = signVisualSpec(buildVisualSpec(codeReq, codeContent, 's')!)

  const timelineContent = 'Cronología: 1848: A. 1861: B. 1865: C.'
  const timelineReq = classifyVisualNeed({ microId: 'm', title: 't', content: timelineContent, keyPoints: [], factKeys: ['f'], cognitiveTarget: 'comprehension', sourceStepId: 's' })!
  const timelineSpec = signVisualSpec(buildVisualSpec(timelineReq, timelineContent, 's')!)

  const specsWithVerb: Array<[VisualSpec, string]> = [
    [graphSpec, 'select_region'], [validSpec, 'fill_cell'], [dclSpec, 'place_vector'],
    [orgSpec, 'label_structure'], [codeSpec, 'predict_output'], [timelineSpec, 'order_sequence'],
  ]
  const malformed: unknown[] = [null, {}, { garbage: true }, [1, 2, 3], 'x']
  for (const [spec, verb] of specsWithVerb) {
    for (const response of malformed) {
      assert.doesNotThrow(
        () => gradeVisualInteraction(spec, { visualSpecId: spec.id, verb: verb as any, response }),
        `engine=${spec.engine} verb=${verb} no debe lanzar con response=${JSON.stringify(response)}`,
      )
    }
  }
  console.log('visual-adversarial: fuzz across all 6 engines never throws PASS')
}

// 6) Visual-supportive (sin requiredEvidenceKind) NUNCA bloquea mastery — CUALQUIER
// evidenceKind (incluida 'textual') debe poder demostrarlo. Confirma el criterio de
// cierre "visual-supportive never blocks mastery".
{
  const blueprint = buildAssessmentBlueprint([
    { id: 'step1', type: 'concept', microId: 'micro:supportive', factKeys: ['f:supportive'], cognitiveTarget: 'comprehension', importance: 0.7 },
  ], 'session-supportive')
  const objective = blueprint.objectives[0]
  assert.equal(objective.requiredEvidenceKind, undefined, 'un objective sin visual required_for_mastery nunca debe tener requiredEvidenceKind seteado')
  const updated = recordAssessmentEvidence(blueprint, [objective.objectiveId], ['f:supportive'], {
    valid: true, correct: true, independent: true, evidenceId: 'ev-textual', evidenceKind: 'textual',
  })
  assert.equal(updated.demonstratedObjectiveIds.includes(objective.objectiveId), true, 'evidencia textual SÍ debe demostrar un objective sin requiredEvidenceKind — supportive/understanding nunca bloquea')
  console.log('visual-adversarial: supportive/understanding never blocks textual mastery PASS')
}

// 7) required_for_mastery visual-required objective NUNCA se demuestra con evidencia
// de un tipo distinto al exigido, ni siquiera 'visual_interpretation' cuando exige
// 'visual_construction' — el chequeo es de IGUALDAD exacta, no "cualquier visual sirve".
{
  const blueprint = buildAssessmentBlueprint([
    { id: 'step1', type: 'concept', microId: 'micro:strict', factKeys: ['f:strict'], cognitiveTarget: 'application', importance: 1, requiredEvidenceKind: 'visual_construction' },
  ], 'session-strict')
  const objective = blueprint.objectives[0]
  const wrongKind = recordAssessmentEvidence(blueprint, [objective.objectiveId], ['f:strict'], {
    valid: true, correct: true, independent: true, evidenceId: 'ev-wrong-kind', evidenceKind: 'visual_interpretation',
  })
  assert.equal(wrongKind.objectives[0].demonstratedFactKeys.length, 0, 'visual_interpretation no debe satisfacer un objective que exige visual_construction — igualdad exacta de evidenceKind')
  console.log('visual-adversarial: exact evidenceKind equality enforced PASS')
}

// 8) describeVisualSpec (fallback textual/accesible, componentes/visual/VisualRenderer.tsx)
// NUNCA debe lanzar, sin importar cuán malformado esté `data` — se invoca tanto
// fuera del error boundary como DENTRO de su propio fallback (ningún boundary la
// protege ahí una segunda vez).
{
  const malformedSpecs: VisualSpec[] = [
    { id: 'x', requirementId: 'x', microId: 'x', engine: 'graph_2d', representation: 'x', sourceGrounding: { sourceSpans: [], factKeys: [] }, conceptual: false, data: {} as any },
    { id: 'x', requirementId: 'x', microId: 'x', engine: 'structured_grid', representation: 'x', sourceGrounding: { sourceSpans: [], factKeys: [] }, conceptual: false, data: {} as any },
    { id: 'x', requirementId: 'x', microId: 'x', engine: 'spatial_vector', representation: 'x', sourceGrounding: { sourceSpans: [], factKeys: [] }, conceptual: false, data: {} as any },
    { id: 'x', requirementId: 'x', microId: 'x', engine: 'chemistry_2d', representation: 'x', sourceGrounding: { sourceSpans: [], factKeys: [] }, conceptual: false, data: {} as any },
    { id: 'x', requirementId: 'x', microId: 'x', engine: 'code_execution', representation: 'x', sourceGrounding: { sourceSpans: [], factKeys: [] }, conceptual: false, data: {} as any },
    { id: 'x', requirementId: 'x', microId: 'x', engine: 'timeline', representation: 'x', sourceGrounding: { sourceSpans: [], factKeys: [] }, conceptual: false, data: {} as any },
    { id: 'x', requirementId: 'x', microId: 'x', engine: 'graph_2d', representation: 'x', sourceGrounding: { sourceSpans: [], factKeys: [] }, conceptual: false, data: null as any },
  ]
  for (const spec of malformedSpecs) {
    assert.doesNotThrow(() => describeVisualSpec(spec), `describeVisualSpec no debe lanzar para engine=${spec.engine} con data malformado`)
    assert.ok(describeVisualSpec(spec).length > 0, 'incluso el fallback debe producir texto no vacío')
  }
  console.log('visual-adversarial: describeVisualSpec never throws (fail-safe fallback, incluida su propia invocación dentro del error boundary) PASS')
}

console.log('visual-adversarial-contracts: ALL PASS')
