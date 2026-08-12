import assert from 'node:assert/strict'
import { classifyVisualNeed } from '../../lib/adaptive/visual/visualNeedClassifier'
import { buildVisualSpec } from '../../lib/adaptive/visual/visualSpecBuilder'
import type { VisualSpec } from '../../lib/adaptive/visual/visualContract'

// StudyAL_Visual_System_Stress_Test — GAP 2 (pedido explícito del usuario):
// "determina si ESO explica por qué en mi recorrido real solo apareció
// graph_2d". Prueba empírica confirmó fragilidad real y severa en los 5
// engines no-graph: paráfrasis pedagógicamente equivalentes (mismos datos
// grounded, redacción distinta — la clase de rewrite que produciría
// sessionPreparationFactory al generar teaching content) fallaban en el
// EXTRACTOR (clasificador correcto, buildVisualSpec devolvía null) para
// structured_grid y timeline. Corregido con patrones ESTRUCTURALES generales
// (posición relativa de anclas conceptuales para ICE; segmentación por
// cláusula para timeline) — nunca frases ni asignaturas específicas, sin
// regex por caso. spatial_vector/chemistry_2d/code_execution permanecen
// frágiles ante paráfrasis (documentado, no arreglado en esta ronda — ver
// reporte: cambiarlos de forma segura requiere más superficie de cambio de
// la que justifica esta corrección mínima).

function build(content: string): VisualSpec | null {
  const req = classifyVisualNeed({ microId: 'm', title: 't', content, keyPoints: [], factKeys: ['f'], cognitiveTarget: 'application', sourceStepId: 's' })
  if (!req) return null
  return buildVisualSpec(req, content, 's')
}

// ---------------------------------------------------------------------------
// structured_grid: 3 paráfrasis distintas del MISMO hecho grounded (misma
// reacción, mismos valores) — todas deben producir la MISMA tabla ICE.
// ---------------------------------------------------------------------------
{
  const literal = 'Reacción: H2 + I2 ⇌ 2HI. Concentraciones iniciales: [H2] = 1.00, [I2] = 1.00, [HI] = 0. Cambio: [H2] = -x, [I2] = -x, [HI] = +2x. En el equilibrio: [H2] = 1-x, [I2] = 1-x, [HI] = 2x.'
  const semicolonParaphrase = 'Para la reacción H2 + I2 ⇌ 2HI: las concentraciones iniciales son [H2]=1.00, [I2]=1.00, [HI]=0; el cambio es [H2]=-x, [I2]=-x, [HI]=+2x; y en el equilibrio quedan [H2]=1-x, [I2]=1-x, [HI]=2x.'
  const prosePararaphrase = 'Considerando el equilibrio químico H2 + I2 ⇌ 2HI, inicialmente tenemos concentración inicial de [H2] = 1.00 y [I2] = 1.00 con [HI] = 0. Durante el cambio: [H2] = -x, [I2] = -x, [HI] = +2x. Finalmente, en el equilibrio: [H2] = 1-x, [I2] = 1-x, [HI] = 2x.'
  const noStructuredData = 'La reacción H2 + I2 se transforma en 2HI. Al inicio hay 1.00 M de H2 y 1.00 M de I2, sin HI presente, y en el equilibrio ambos disminuyen mientras el HI aumenta.'

  for (const [label, content] of [['literal', literal], ['punto y coma', semicolonParaphrase], ['prosa con "y"/"con"', prosePararaphrase]] as const) {
    const spec = build(content)
    assert.ok(spec, `structured_grid (${label}): debe producir un VisualSpec — paráfrasis grounded no debe perderse`)
    assert.equal(spec!.engine, 'structured_grid')
    const grid = spec as Extract<VisualSpec, { engine: 'structured_grid' }>
    assert.deepEqual(grid.data.species, ['H2', 'I2', 'HI'], `structured_grid (${label}): especies exactas`)
    assert.equal(grid.data.equilibrium.H2, '1-x', `structured_grid (${label}): equilibrium.H2 exacto, sin punto final colado`)
    assert.equal(grid.data.equilibrium.I2, '1-x', `structured_grid (${label}): equilibrium.I2 exacto`)
    assert.equal(grid.data.equilibrium.HI, '2x', `structured_grid (${label}): equilibrium.HI exacto, sin punto final colado`)
    assert.equal(grid.data.change.H2, '-x', `structured_grid (${label}): change.H2 exacto`)
  }

  // Sin NINGÚN dato estructurado (solo prosa libre) — debe seguir fallando
  // cerrado: no hay nada grounded que extraer, no se inventa una tabla.
  assert.equal(build(noStructuredData), null, 'structured_grid: prosa sin corchetes [especie]=valor debe seguir devolviendo null — fail-closed, nunca inventar números')

  console.log('visual-engine-paraphrase-robustness: structured_grid (3 paráfrasis + 1 caso sin datos estructurados) PASS')
}

// ---------------------------------------------------------------------------
// timeline: 2 años en la MISMA oración de contraste (formato que el anterior
// extractor no podía manejar en absoluto).
// ---------------------------------------------------------------------------
{
  const sameSentence = 'El descubrimiento inicial data de 1848, mientras que la publicación formal del estudio llegó en 1859, once años después.'
  const spec = build(sameSentence)
  assert.ok(spec, 'timeline: dos años en la misma oración de contraste debe producir un VisualSpec')
  assert.equal(spec!.engine, 'timeline')
  const timeline = spec as Extract<VisualSpec, { engine: 'timeline' }>
  assert.equal(timeline.data.events.length, 2, 'timeline: debe detectar los 2 eventos aunque compartan oración')
  assert.equal(timeline.data.events[0].date, '1848')
  assert.equal(timeline.data.events[1].date, '1859')
  console.log('visual-engine-paraphrase-robustness: timeline (2 años en una sola oración de contraste) PASS')
}

console.log('visual-engine-paraphrase-robustness-contracts: PASS (structured_grid + timeline sobreviven paráfrasis pedagógicas realistas, grounding fail-closed intacto)')
