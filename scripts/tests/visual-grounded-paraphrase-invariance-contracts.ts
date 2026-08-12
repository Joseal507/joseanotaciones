import assert from 'node:assert/strict'
import { factoryTeaching } from '../../app/api/adaptive/session-teach/route'
import type { TeachingContent } from '../../lib/ai/teachingContentContract'
import type { VisualEngine } from '../../lib/adaptive/visual/visualContract'

// StudyAL_Visual_System_Stress_Test — cierre arquitectónico (pedido explícito
// del usuario, sección 5: "PARAPHRASE INVARIANCE... esta es la prueba
// fundamental"). Para cada uno de los 6 engines: UN block grounded fijo
// (mismo sourceSpans, extraído del documento) + TRES redacciones de teaching
// prose radicalmente distintas de la MISMA sesión (A/B/C — la que produciría
// sessionPreparationFactory en tres corridas distintas del LLM de
// enseñanza) deben producir el MISMO engine y los MISMOS datos —porque
// factoryTeaching real ahora extrae DESDE EL BLOCK grounded (ver
// lib/adaptive/visual/groundedVisualSource.ts), nunca desde la prosa,
// cuando existe un bloque relacionado con datos suficientes. La prosa deja
// de tener el poder de hacer desaparecer o cambiar el visual.
//
// Usa factoryTeaching REAL (misma función que el POST vivo), sin mockear
// nada — la única frontera es la prosa de enseñanza en sí (fixture, ya que
// requeriría una llamada LLM real para generarla).

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-pretest'

const session = { id: 'chapter-2', chapterNumber: 2, title: 'Sesión', objective: 'Aprender', topicIds: [], blockIds: [], concepts: [], pages: [], kind: 'learning' as const }

interface EngineCase {
  engine: VisualEngine
  block: { id: string; label: string; summary: string; sourceSpans: Array<{ quote: string; page: number; certainty: 'supported' }>; bloomLevel: string }
  prose: [string, string, string] // A, B, C — redacciones deliberadamente distintas, ninguna reutiliza el formato literal del quote
}

const cases: EngineCase[] = [
  {
    engine: 'graph_2d',
    block: {
      id: 'b_graph', label: 'Función lineal', bloomLevel: 'apply',
      summary: 'Función lineal con dominio acotado.',
      sourceSpans: [{ quote: 'f(x) = 2x + 3, dominio -5 <= x <= 5', page: 3, certainty: 'supported' }],
    },
    prose: [
      'La función f(x) = 2x + 3 tiene dominio -5 <= x <= 5.',
      'Consideremos una relación lineal cuya pendiente es 2 y cuya ordenada al origen es 3, definida entre -5 y 5.',
      'El comportamiento descrito muestra una proporción constante con un desplazamiento vertical fijo, acotada a un intervalo específico.',
    ],
  },
  {
    engine: 'structured_grid',
    block: {
      id: 'b_ice', label: 'Equilibrio químico', bloomLevel: 'apply',
      summary: 'Tabla ICE de la reacción H2 + I2.',
      sourceSpans: [{ quote: 'Reacción: H2 + I2 ⇌ 2HI. Concentraciones iniciales: [H2] = 1.00, [I2] = 1.00, [HI] = 0. Cambio: [H2] = -x, [I2] = -x, [HI] = +2x. En el equilibrio: [H2] = 1-x, [I2] = 1-x, [HI] = 2x.', page: 7, certainty: 'supported' }],
    },
    prose: [
      'Reacción: H2 + I2 ⇌ 2HI, con las concentraciones iniciales, cambio y equilibrio ya conocidos.',
      'Al mezclar hidrógeno y yodo se forma yoduro de hidrógeno; ambos reactivos disminuyen mientras el producto aumenta hasta el equilibrio.',
      'El sistema evoluciona desde una composición inicial pura de reactivos hacia una mezcla en equilibrio dinámico.',
    ],
  },
  {
    engine: 'spatial_vector',
    block: {
      id: 'b_dcl', label: 'Fuerza aplicada', bloomLevel: 'apply',
      summary: 'Fuerza sobre un bloque, magnitud y ángulo respecto al eje horizontal.',
      sourceSpans: [{ quote: 'Fuerza aplicada = 40 N a 30°', page: 11, certainty: 'supported' }],
    },
    // Exactamente el ejemplo del usuario (sección 5).
    prose: [
      'Fuerza aplicada = 40 N a 30°',
      'Sobre el bloque actúa una fuerza de 40 N formando un ángulo de 30 grados.',
      'El cuerpo recibe una fuerza inclinada treinta grados cuya magnitud es cuarenta newtons.',
    ],
  },
  {
    engine: 'chemistry_2d',
    block: {
      id: 'b_chem', label: 'Estructura molecular', bloomLevel: 'understand',
      summary: 'Cadena de carbonos con enlaces simples.',
      sourceSpans: [{ quote: 'Átomos: C1=carbono, C2=carbono, C3=carbono, C4=carbono. Enlaces: C1-C2 (enlace simple), C2-C3 (enlace simple), C3-C4 (enlace simple).', page: 14, certainty: 'supported' }],
    },
    prose: [
      'Átomos: C1=carbono, C2=carbono, C3=carbono, C4=carbono. Enlaces: C1-C2 (enlace simple), C2-C3 (enlace simple), C3-C4 (enlace simple).',
      'La molécula tiene cuatro carbonos conectados en cadena mediante enlaces simples.',
      'Se trata de una estructura alifática lineal de cuatro átomos de carbono sin insaturaciones.',
    ],
  },
  {
    engine: 'code_execution',
    block: {
      id: 'b_code', label: 'Traza de ejecución', bloomLevel: 'apply',
      summary: 'Ejecución de un programa simple.',
      sourceSpans: [{ quote: '```python\nx = 3\ny = x * 2\nprint(y)\n```\nTraza: línea 1 x=3; línea 2 y=6; línea 3 salida=6.', page: 18, certainty: 'supported' }],
    },
    prose: [
      '```python\nx = 3\ny = x * 2\nprint(y)\n```\nTraza: línea 1 x=3; línea 2 y=6; línea 3 salida=6.',
      'Si seguimos la ejecución paso a paso, x toma el valor 3, y se calcula como el doble, y la salida impresa refleja ese resultado.',
      'El programa asigna un valor inicial, lo duplica, y muestra el resultado final por consola.',
    ],
  },
  {
    engine: 'timeline',
    block: {
      id: 'b_timeline', label: 'Cronología', bloomLevel: 'understand',
      summary: 'Dos hitos históricos relacionados.',
      sourceSpans: [{ quote: 'En 1848 ocurrió el descubrimiento inicial. En 1859 se publicó el estudio.', page: 22, certainty: 'supported' }],
    },
    prose: [
      'En 1848 ocurrió el descubrimiento inicial. En 1859 se publicó el estudio.',
      'El hallazgo original data de mediados del siglo XIX, y su formalización llegó algo más de una década después.',
      'Primero se produjo el hallazgo; años más tarde se consolidó mediante una publicación formal.',
    ],
  },
]

for (const testCase of cases) {
  const results: Array<{ label: string; spec: any }> = []
  for (const [i, prose] of testCase.prose.entries()) {
    const label = ['A', 'B', 'C'][i]
    const source: TeachingContent = {
      sessionIntro: 'Inicio.',
      steps: [{
        id: `step_${testCase.block.id}_${label}`, type: 'concept', title: testCase.block.label, content: prose,
        keyPoints: [{ id: 'kp1', text: 'punto clave' } as any], microId: testCase.block.id,
        importance: 'important', cognitiveTarget: 'application', relatedBlockIds: [testCase.block.id],
        factKeys: [`fk_${testCase.block.id}`], sourceReferences: [],
      }],
      closing: 'Cierre.',
    }
    const prepared = factoryTeaching(source, session, [testCase.block])
    const step = prepared.steps[0]
    assert.ok(step.visualSpec, `${testCase.engine} (${label}): debe producir un VisualSpec grounded pese a la redacción "${prose.slice(0, 50)}..."`)
    assert.equal(step.visualSpec!.engine, testCase.engine, `${testCase.engine} (${label}): engine debe coincidir`)
    assert.equal((step.visualSpec as any).sourceGrounding.sourceSpans[0]?.blockId, testCase.block.id, `${testCase.engine} (${label}): provenance debe apuntar al block grounded, no al step`)
    assert.ok((step.visualSpec as any).integrity, `${testCase.engine} (${label}): debe estar firmado (server-authoritative)`)
    results.push({ label, spec: step.visualSpec })
  }

  const [a, b, c] = results
  assert.deepEqual(a.spec.data, b.spec.data, `${testCase.engine}: A y B deben producir datos IDÉNTICOS pese a redacción distinta — la prosa no debe alterar el visual grounded`)
  assert.deepEqual(b.spec.data, c.spec.data, `${testCase.engine}: B y C deben producir datos IDÉNTICOS pese a redacción distinta`)
  console.log(`visual-grounded-paraphrase-invariance: ${testCase.engine} — A/B/C (misma fuente grounded, prosa radicalmente distinta) -> mismo engine, mismos datos PASS`)
}

console.log('visual-grounded-paraphrase-invariance-contracts: PASS (6/6 engines — el visual ya no depende de la redacción del LLM de enseñanza cuando existe un block grounded)')
