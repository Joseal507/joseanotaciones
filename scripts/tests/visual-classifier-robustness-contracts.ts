// Robustez del clasificador (misión: cerrar gaps del reporte anterior, punto 4).
// Objetivo: demostrar que la decisión depende de la COMBINACIÓN de señales
// cognitivas/estructurales reales (relación espacial+ángulo, tabla cuantitativa de
// cambio, notación funcional dependiente de x, traza de ejecución, topología de
// enlaces, densidad de marcadores temporales) — NUNCA de una única palabra clave
// frágil ni del nombre de la asignatura. Cada bloque usa contenido GENUINAMENTE
// distinto (otra reacción, otra fuerza, otra función, otro código, otra época
// histórica) al de los fixtures de visual-foundation-contracts.ts, para probar que
// no hay overfitting a una frase concreta.
import assert from 'node:assert/strict'
import { classifyVisualNeed } from '../../lib/adaptive/visual/visualNeedClassifier'

function classify(content: string, cognitiveTarget = 'comprehension') {
  return classifyVisualNeed({ microId: 'm', title: 't', content, keyPoints: [], factKeys: ['f'], cognitiveTarget, sourceStepId: 's' })
}

// ---------------------------------------------------------------------------
// TRUE POSITIVES — wording distinto por dominio, misma combinación de señales.
// ---------------------------------------------------------------------------
{
  const cases: Array<{ label: string; content: string; engine: string }> = [
    {
      label: 'ICE — otra reacción, otra redacción',
      content: 'Consideremos el sistema en fase gaseosa. Reacción: 2SO2 + O2 ⇌ 2SO3. Las concentraciones iniciales medidas fueron: [SO2]=2.00, [O2]=1.00, [SO3]=0.00. A medida que avanza, el cambio es: [SO2]=-2x, [O2]=-x, [SO3]=+2x. Una vez alcanzado el equilibrio: [SO2]=2.00-2x, [O2]=1.00-x, [SO3]=2x.',
      engine: 'structured_grid',
    },
    {
      label: 'DCL — otro cuerpo, otras fuerzas, orden distinto',
      content: 'Analicemos un cajón apoyado sobre una rampa. Sobre el cajón actúan tres fuerzas: la Fricción = 12 N a 180°, el Peso = 80 N a 250°, y la Normal = 60 N a 70° respecto al eje horizontal.',
      engine: 'spatial_vector',
    },
    {
      label: 'Gráfica — otra función, otra forma de presentarla',
      content: 'Estudiemos ahora una parábola. Se define f(x) = x^2 - 4x + 3, y queremos analizar su vértice, su dominio y su comportamiento cerca de las raíces.',
      engine: 'graph_2d',
    },
    {
      label: 'Orgánica — otra molécula, otra redacción',
      content: 'Consideremos un compuesto simple con tres átomos. Átomos: N1=nitrogeno, C2=carbono, O3=oxigeno. Enlaces: N1-C2 (enlace simple), C2-O3 (enlace triple).',
      engine: 'chemistry_2d',
    },
    {
      label: 'Código — otro lenguaje, otra traza',
      content: 'Analicemos este fragmento.\n```javascript\nlet total = 0\nfor (let i = 1; i <= 3; i++) total += i\n```\nTraza: línea 1 total=0; línea 2 total=1; línea 2 total=3; línea 2 salida=6.',
      engine: 'code_execution',
    },
    {
      label: 'Timeline — otra época, otros eventos',
      content: 'Cronología del proceso: 1917: comienza la etapa inicial. 1929: se produce el quiebre económico. 1945: culmina el periodo con la reorganización.',
      engine: 'timeline',
    },
  ]
  for (const testCase of cases) {
    const result = classify(testCase.content, 'application')
    assert.ok(result, `debe detectar ${testCase.label}`)
    assert.equal(result!.engine, testCase.engine, `${testCase.label} debe clasificar como ${testCase.engine}, obtuvo ${result?.engine}`)
    console.log(`visual-classifier-robustness: TP ${testCase.label} -> ${result!.engine} PASS`)
  }
}

// ---------------------------------------------------------------------------
// FALSE NEGATIVES evitados: la combinación completa de señales SIEMPRE dispara,
// incluso variando cuál señal aparece primero en la oración.
// ---------------------------------------------------------------------------
{
  const reordered = 'A ángulo de 45° respecto al eje vertical se aplica una Tensión = 30 N; también actúa el Peso = 40 N a 270°.'
  const result = classify(reordered, 'application')
  assert.ok(result && result.engine === 'spatial_vector', 'el orden de las señales (ángulo antes que fuerza) no debe impedir la detección')
  console.log('visual-classifier-robustness: FN guard (orden de señales) PASS')
}

// ---------------------------------------------------------------------------
// FALSE POSITIVES evitados: presencia de UNA sola señal parcial (de las que
// requieren combinación) NUNCA debe disparar un engine — prueba que no depende de
// una palabra clave aislada y frágil.
// ---------------------------------------------------------------------------
{
  const partialCases: Array<{ label: string; content: string }> = [
    { label: 'solo "fuerza" sin ángulo/eje', content: 'La fuerza del argumento convenció a todo el jurado durante el juicio.' },
    { label: 'solo "inicial" sin cambio/equilibrio', content: 'La etapa inicial del proyecto fue la más difícil de planificar.' },
    { label: 'solo flecha de reacción sin vocabulario ICE', content: 'El proceso general puede resumirse como A + B ⇌ C, sin más detalle por ahora.' },
    { label: 'solo "enlace" sin patrón de elementos', content: 'El enlace emocional entre los personajes se fortalece a lo largo de la historia.' },
    { label: 'un solo año sin vocabulario de secuencia', content: 'En 1969 ocurrió un evento relevante que cambiaría la narrativa del siglo.' },
    { label: 'código sin vocabulario de traza/ejecución', content: '```\nconst x = 1\n```\nEste fragmento ilustra la sintaxis básica de declaración de variables.' },
    { label: 'y= dentro de otra palabra (excelente/extra)', content: 'Tuvo un desempeño extra y = excelente en su presentación final.' },
  ]
  for (const testCase of partialCases) {
    const result = classify(testCase.content, 'application')
    assert.equal(result, null, `FALSO POSITIVO: "${testCase.label}" no debería clasificar ningún engine (señal parcial/aislada), obtuvo ${result?.engine}`)
  }
  console.log('visual-classifier-robustness: false-positive guards (7 casos de señal parcial/aislada) PASS')
}

// ---------------------------------------------------------------------------
// Historia narrativa SIN necesidad visual real (prosa histórica sin cronología
// densa ni ninguna otra señal estructural) -> TEXT_SUFFICIENT (null), incluso con
// cognitiveTarget='application' (para confirmar que no es la dimensión cognitiva la
// que decide, sino la AUSENCIA de señal).
// ---------------------------------------------------------------------------
{
  const narrative = 'El movimiento social surgió como respuesta a décadas de desigualdad estructural. Sus líderes articularon un discurso que combinaba reivindicaciones económicas con demandas de reconocimiento cultural, generando una base de apoyo amplia y heterogénea a lo largo de distintas regiones del país.'
  const result = classify(narrative, 'application')
  assert.equal(result, null, 'prosa histórica narrativa sin señales estructurales debe ser TEXT_SUFFICIENT, incluso con cognitiveTarget=application')
  console.log('visual-classifier-robustness: historia narrativa sin necesidad visual (TEXT_SUFFICIENT) PASS')
}

// ---------------------------------------------------------------------------
// Independencia real del nombre de la asignatura: el MISMO texto estructural
// (fuerza+ángulo) clasifica igual sin importar si se etiqueta como "física",
// "ingeniería" o no se etiqueta en absoluto — la señal nunca lee subject/domain.
// ---------------------------------------------------------------------------
{
  const withoutLabel = classify('Sobre el bloque actúan: Peso = 50 N a 270°, Normal = 43.3 N a 90°.', 'application')
  const withUnrelatedLabel = classify('[Materia: Arte Contemporáneo] Sobre el bloque actúan: Peso = 50 N a 270°, Normal = 43.3 N a 90°.', 'application')
  assert.ok(withoutLabel && withUnrelatedLabel)
  assert.equal(withoutLabel!.engine, withUnrelatedLabel!.engine, 'una etiqueta de asignatura no relacionada no debe cambiar la clasificación — depende solo de las señales del contenido')
  console.log('visual-classifier-robustness: subject-name independence PASS')
}

console.log('visual-classifier-robustness-contracts: ALL PASS')
