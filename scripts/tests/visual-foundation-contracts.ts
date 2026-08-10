import assert from 'node:assert/strict'
import { classifyVisualNeed } from '../../lib/adaptive/visual/visualNeedClassifier'
import { buildVisualSpec } from '../../lib/adaptive/visual/visualSpecBuilder'
import { gradeVisualInteraction } from '../../lib/adaptive/visual/visualGrading'
import { describeVisualSpec } from '../../components/visual/VisualRenderer'
import type { VisualSpec } from '../../lib/adaptive/visual/visualContract'

// ---------------------------------------------------------------------------
// Vertical 1: gráfica matemática (Matemáticas) — material/fixture -> VisualRequirement
// -> VisualSpec -> grading -> evidenceKind, todo determinista, sin LLM.
// ---------------------------------------------------------------------------
{
  const content = 'La función f(x) = 2x + 3 tiene dominio -5 <= x <= 5. La gráfica muestra pendiente positiva y una intersección con el eje y.'
  const req = classifyVisualNeed({
    microId: 'micro:graph', title: 'Función lineal', content, keyPoints: [], factKeys: ['f1'],
    cognitiveTarget: 'application', sourceStepId: 'step1',
  })
  assert.ok(req, 'graph requirement debe detectarse')
  assert.equal(req!.engine, 'graph_2d')
  assert.equal(req!.requiredness, 'required_for_mastery')
  assert.ok(!req!.cognitiveSignals.some(s => /matematic/i.test(s)), 'no debe depender del nombre de la asignatura')

  const spec = buildVisualSpec(req!, content, 'step1')
  assert.ok(spec, 'graph spec debe construirse desde el texto real')
  assert.equal(spec!.engine, 'graph_2d')
  assert.equal((spec as Extract<VisualSpec, { engine: 'graph_2d' }>).data.expression, '2x + 3')
  assert.deepEqual((spec as Extract<VisualSpec, { engine: 'graph_2d' }>).data.domain, [-5, 5])

  const correct = gradeVisualInteraction(spec!, { visualSpecId: spec!.id, verb: 'select_region', response: { x: 2, y: 7 } })
  assert.equal(correct.correct, true)
  assert.equal(correct.evidenceKind, 'visual_interpretation')
  const wrong = gradeVisualInteraction(spec!, { visualSpecId: spec!.id, verb: 'select_region', response: { x: 2, y: 40 } })
  assert.equal(wrong.correct, false)
  console.log('visual-foundation: graph_2d vertical PASS')
}

// ---------------------------------------------------------------------------
// Vertical 2: ICE (Química)
// ---------------------------------------------------------------------------
{
  const content = 'Reacción: N2 + 3H2 ⇌ 2NH3. Concentraciones iniciales: [N2]=1.00, [H2]=3.00, [NH3]=0.00. Cambio: [N2]=-x, [H2]=-3x, [NH3]=+2x. En el equilibrio: [N2]=1.00-x, [H2]=3.00-3x, [NH3]=2x.'
  const req = classifyVisualNeed({
    microId: 'micro:ice', title: 'Equilibrio químico', content, keyPoints: [], factKeys: ['f2'],
    cognitiveTarget: 'application', sourceStepId: 'step2',
  })
  assert.ok(req)
  assert.equal(req!.engine, 'structured_grid')
  assert.equal(req!.requiredness, 'required_for_mastery')

  const spec = buildVisualSpec(req!, content, 'step2')
  assert.ok(spec)
  const grid = spec as Extract<VisualSpec, { engine: 'structured_grid' }>
  assert.deepEqual(grid.data.species, ['N2', 'H2', 'NH3'])
  assert.equal(grid.data.equilibrium.N2, '1.00-x')

  const correct = gradeVisualInteraction(spec!, {
    visualSpecId: spec!.id, verb: 'fill_cell',
    response: { N2: '1.00-x', H2: '3.00-3x', NH3: '2x' },
  })
  assert.equal(correct.correct, true)
  assert.equal(correct.evidenceKind, 'visual_construction')
  const wrong = gradeVisualInteraction(spec!, { visualSpecId: spec!.id, verb: 'fill_cell', response: { N2: 'algo mal' } })
  assert.equal(wrong.correct, false)
  console.log('visual-foundation: structured_grid (ICE) vertical PASS')
}

// ---------------------------------------------------------------------------
// Vertical 3: DCL (Física)
// ---------------------------------------------------------------------------
{
  const content = 'Diagrama de cuerpo libre: Sobre el bloque actúan: Peso = 50 N a 270°, Normal = 43.3 N a 90°, Tension = 25 N a 30°.'
  const req = classifyVisualNeed({
    microId: 'micro:dcl', title: 'Fuerzas sobre un bloque', content, keyPoints: [], factKeys: ['f3'],
    cognitiveTarget: 'application', sourceStepId: 'step3',
  })
  assert.ok(req)
  assert.equal(req!.engine, 'spatial_vector')

  const spec = buildVisualSpec(req!, content, 'step3')
  assert.ok(spec)
  const vector = spec as Extract<VisualSpec, { engine: 'spatial_vector' }>
  assert.equal(vector.data.forces.length, 3)

  const submission = Object.fromEntries(vector.data.forces.map(force => [force.id, { angleDeg: force.angleDeg, magnitude: force.magnitude }]))
  const correct = gradeVisualInteraction(spec!, { visualSpecId: spec!.id, verb: 'place_vector', response: submission })
  assert.equal(correct.correct, true)
  const wrong = gradeVisualInteraction(spec!, { visualSpecId: spec!.id, verb: 'place_vector', response: { force_1: { angleDeg: 0, magnitude: 1 } } })
  assert.equal(wrong.correct, false)
  console.log('visual-foundation: spatial_vector (DCL) vertical PASS')
}

// ---------------------------------------------------------------------------
// Vertical 4: estructura orgánica simple (Química orgánica)
// ---------------------------------------------------------------------------
{
  const content = 'Átomos: C1=carbono, C2=carbono, O3=oxigeno. Enlaces: C1-C2 (enlace simple), C2-O3 (enlace doble).'
  const req = classifyVisualNeed({
    microId: 'micro:organic', title: 'Estructura esquelética', content, keyPoints: [], factKeys: ['f4'],
    cognitiveTarget: 'comprehension', sourceStepId: 'step4',
  })
  assert.ok(req)
  assert.equal(req!.engine, 'chemistry_2d')
  assert.equal(req!.requiredness, 'required_for_understanding')

  const spec = buildVisualSpec(req!, content, 'step4')
  assert.ok(spec)
  const chem = spec as Extract<VisualSpec, { engine: 'chemistry_2d' }>
  assert.equal(chem.data.atoms.length, 3)
  assert.equal(chem.data.bonds.length, 2)
  assert.equal(chem.data.bonds[1].order, 2)

  const correct = gradeVisualInteraction(spec!, {
    visualSpecId: spec!.id, verb: 'label_structure',
    response: { C1: 'C', C2: 'C', O3: 'O' },
  })
  assert.equal(correct.correct, true)
  assert.equal(correct.evidenceKind, 'visual_construction')
  console.log('visual-foundation: chemistry_2d (orgánica) vertical PASS')
}

// ---------------------------------------------------------------------------
// Vertical 5: code trace (Programación)
// ---------------------------------------------------------------------------
{
  const content = '```python\nx = 3\ny = x * 2\nprint(y)\n```\nTraza: línea 1 x=3; línea 2 y=6; línea 3 salida=6.'
  const req = classifyVisualNeed({
    microId: 'micro:code', title: 'Ejecución de un programa', content, keyPoints: [], factKeys: ['f5'],
    cognitiveTarget: 'application', sourceStepId: 'step5',
  })
  assert.ok(req)
  assert.equal(req!.engine, 'code_execution')

  const spec = buildVisualSpec(req!, content, 'step5')
  assert.ok(spec)
  const code = spec as Extract<VisualSpec, { engine: 'code_execution' }>
  assert.equal(code.data.steps.length, 3)
  assert.equal(code.data.steps[1].variables.y, 6)

  const correct = gradeVisualInteraction(spec!, { visualSpecId: spec!.id, verb: 'predict_output', response: { line: 3, variable: 'output', value: '6' } })
  assert.equal(correct.correct, true)
  const wrong = gradeVisualInteraction(spec!, { visualSpecId: spec!.id, verb: 'predict_output', response: { line: 3, variable: 'output', value: '99' } })
  assert.equal(wrong.correct, false)
  console.log('visual-foundation: code_execution vertical PASS')
}

// ---------------------------------------------------------------------------
// Vertical 6: timeline (Historia) — SUPPORTIVE ONLY, nunca required
// ---------------------------------------------------------------------------
{
  const content = 'Cronología: 1848: comienza el proceso. 1861: el conflicto se agrava. 1865: finaliza el periodo.'
  const req = classifyVisualNeed({
    microId: 'micro:timeline', title: 'Cronología de eventos', content, keyPoints: [], factKeys: ['f6'],
    cognitiveTarget: 'application', sourceStepId: 'step6',
  })
  assert.ok(req)
  assert.equal(req!.engine, 'timeline')
  assert.equal(req!.requiredness, 'supportive', 'timeline nunca debe ser required, ni con cognitiveTarget=application')

  const spec = buildVisualSpec(req!, content, 'step6')
  assert.ok(spec)
  const timeline = spec as Extract<VisualSpec, { engine: 'timeline' }>
  assert.equal(timeline.data.events.length, 3)
  assert.equal(timeline.data.events[0].date, '1848')

  const correct = gradeVisualInteraction(spec!, { visualSpecId: spec!.id, verb: 'order_sequence', response: timeline.data.events.map(e => e.id) })
  assert.equal(correct.correct, true)
  console.log('visual-foundation: timeline (supportive) vertical PASS')
}

// ---------------------------------------------------------------------------
// Grounding: nunca fabricar — datos insuficientes deben devolver null, no un spec
// con valores inventados.
// ---------------------------------------------------------------------------
{
  const req = classifyVisualNeed({
    microId: 'micro:none', title: 'Texto sin señales visuales', content: 'Este es un párrafo puramente descriptivo sin estructura visual detectable.',
    keyPoints: [], factKeys: ['f7'], cognitiveTarget: 'comprehension', sourceStepId: 'step7',
  })
  assert.equal(req, null, 'texto sin señales cognitivas no debe clasificar ningún engine')

  const partialContent = 'Reacción: A + B ⇌ C. Se discuten cualitativamente los conceptos de concentración inicial, cambio y equilibrio, sin valores numéricos concretos.'
  const partialReq = classifyVisualNeed({
    microId: 'micro:partial', title: 'Reacción incompleta', content: partialContent,
    keyPoints: [], factKeys: ['f8'], cognitiveTarget: 'application', sourceStepId: 'step8',
  })
  assert.ok(partialReq, 'debe detectar la señal estructural (arrow + vocabulario ICE) aunque falten datos numéricos')
  const partialSpec = buildVisualSpec(partialReq!, partialContent, 'step8')
  assert.equal(partialSpec, null, 'sin concentraciones/cambio/equilibrio explícitos, nunca se debe fabricar un VisualSpec')
  console.log('visual-foundation: grounding refusal (no fabricar datos) PASS')
}

// ---------------------------------------------------------------------------
// Accesibilidad (FASE 13 / criterio de cierre #8): describeVisualSpec debe producir
// una descripción textual no vacía para los 6 engines — nunca depender EXCLUSIVAMENTE
// del SVG/canvas para transmitir el contenido pedagógico.
// ---------------------------------------------------------------------------
{
  const fixtures: Array<{ content: string; cognitiveTarget: string; expectFragment: string }> = [
    { content: 'La función f(x) = 2x + 3 tiene dominio -5 <= x <= 5. La gráfica muestra pendiente.', cognitiveTarget: 'application', expectFragment: '2x + 3' },
    { content: 'Reacción: N2 + 3H2 ⇌ 2NH3. Concentraciones iniciales: [N2]=1.00, [H2]=3.00, [NH3]=0.00. Cambio: [N2]=-x, [H2]=-3x, [NH3]=+2x. En el equilibrio: [N2]=1.00-x, [H2]=3.00-3x, [NH3]=2x.', cognitiveTarget: 'application', expectFragment: 'N2' },
    { content: 'Sobre el bloque actúan: Peso = 50 N a 270°, Normal = 43.3 N a 90°.', cognitiveTarget: 'application', expectFragment: 'bloque' },
    { content: 'Átomos: C1=carbono, C2=carbono. Enlaces: C1-C2 (enlace simple).', cognitiveTarget: 'comprehension', expectFragment: 'C1' },
    { content: '```python\nx = 3\nprint(x)\n```\nTraza: línea 1 x=3; línea 2 salida=3.', cognitiveTarget: 'application', expectFragment: 'python' },
    { content: 'Cronología: 1848: A. 1861: B. 1865: C.', cognitiveTarget: 'comprehension', expectFragment: '1848' },
  ]
  for (const fixture of fixtures) {
    const requirement = classifyVisualNeed({ microId: 'm', title: 't', content: fixture.content, keyPoints: [], factKeys: ['f'], cognitiveTarget: fixture.cognitiveTarget, sourceStepId: 's' })!
    const spec = buildVisualSpec(requirement, fixture.content, 's')!
    const description = describeVisualSpec(spec)
    assert.ok(description.length > 10, `describeVisualSpec debe producir texto sustantivo para engine=${spec.engine}`)
    assert.ok(description.includes(fixture.expectFragment), `descripción de ${spec.engine} debe incluir un dato real del material ("${fixture.expectFragment}")`)
  }
  console.log('visual-foundation: describeVisualSpec accessible fallback for all 6 engines PASS')
}

console.log('visual-foundation-contracts: ALL PASS')
