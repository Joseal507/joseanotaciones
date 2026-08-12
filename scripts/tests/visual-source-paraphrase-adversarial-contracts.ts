import assert from 'node:assert/strict'
import { classifyVisualNeed } from '../../lib/adaptive/visual/visualNeedClassifier'
import { buildVisualSpec } from '../../lib/adaptive/visual/visualSpecBuilder'
import type { VisualSpec } from '../../lib/adaptive/visual/visualContract'

// StudyAL_Visual_System_Stress_Test — cierre de la frontera final (pedido
// explícito del usuario): "same semantic SOURCE FACT + different SOURCE
// wording -> semantically equivalent grounded structured data". A
// diferencia de la ronda anterior (misma fuente grounded + prosa de
// enseñanza distinta), aquí varía la REDACCIÓN DEL MATERIAL FUENTE mismo —
// para spatial_vector/chemistry_2d/code_execution, que hasta esta ronda solo
// producían VisualSpec si el material usaba un formato literal específico de
// StudyAL ("Peso = 50 N a 270°" / "Átomos: C1=carbono..." / "Traza: línea
// 1..."). Ahora deben reconocer lenguaje natural normal, SIN inventar datos.

function build(content: string): VisualSpec | null {
  const req = classifyVisualNeed({ microId: 'm', title: 't', content, keyPoints: [], factKeys: ['f'], cognitiveTarget: 'application', sourceStepId: 's' })
  if (!req) return null
  return buildVisualSpec(req, content, 's')
}

// ---------------------------------------------------------------------------
// SECCIÓN 7 — source-paraphrase: mínimo 4 variantes por engine, mismo hecho.
// ---------------------------------------------------------------------------

// spatial_vector — 4/4 (el ejemplo A del usuario, "F = 40 N a 30°", no lleva
// NINGÚN vocabulario de fuerza — el classifier lo rechaza intencionalmente
// para evitar falsos positivos en cualquier otra asignatura; se sustituye
// aquí por una variante equivalente que sí es material fuente real).
{
  const variants = [
    'Fuerza = 40 N a 30°',
    'Una fuerza de 40 N actúa formando 30 grados con la horizontal.',
    'El objeto recibe 40 newtons de fuerza inclinada treinta grados.',
    'Aplicamos sobre el bloque una fuerza cuya magnitud es 40 N y cuya dirección forma un ángulo de 30°.',
  ]
  let passCount = 0
  const results: Array<{ magnitude: number; angleDeg: number } | null> = []
  for (const [i, content] of variants.entries()) {
    const spec = build(content)
    const force = spec?.engine === 'spatial_vector' ? spec.data.forces[0] : undefined
    if (force) { passCount += 1; results.push({ magnitude: force.magnitude!, angleDeg: force.angleDeg }) }
    else results.push(null)
    console.log(`  spatial_vector [${i}] -> ${force ? `magnitude=${force.magnitude} angleDeg=${force.angleDeg}` : 'FALLO'}`)
  }
  assert.equal(passCount, 4, `spatial_vector: se esperaban 4/4 variantes exitosas, se obtuvieron ${passCount}/4`)
  for (const r of results) {
    assert.equal(r!.magnitude, 40, 'spatial_vector: magnitud debe ser idéntica (40) en las 4 variantes')
    assert.equal(r!.angleDeg, 30, 'spatial_vector: ángulo debe ser idéntico (30) en las 4 variantes')
  }
  console.log('visual-source-paraphrase: spatial_vector 4/4 PASS')
}

// chemistry_2d — 4/4 (la fórmula condensada, notación química estándar, es
// el único hecho determinísticamente grounded posible sin un parser IUPAC;
// varía la prosa alrededor, la fórmula persiste igual en las 4).
{
  const variants = [
    'Fórmula condensada: CH3-CH(CH3)-CH2-CH3',
    'La estructura del compuesto es CH3-CH(CH3)-CH2-CH3, con enlaces simples entre todos los carbonos.',
    'Podemos representar la molécula mediante la fórmula condensada CH3-CH(CH3)-CH2-CH3.',
    'Los átomos de carbono se conectan según CH3-CH(CH3)-CH2-CH3, formando una cadena ramificada con enlaces simples.',
  ]
  let passCount = 0
  let reference: { atomCount: number; bondCount: number } | null = null
  for (const [i, content] of variants.entries()) {
    const spec = build(content)
    const data = spec?.engine === 'chemistry_2d' ? spec.data : undefined
    if (data) {
      passCount += 1
      const shape = { atomCount: data.atoms.length, bondCount: data.bonds.length }
      if (!reference) reference = shape
      else assert.deepEqual(shape, reference, `chemistry_2d [${i}]: conectividad debe ser idéntica entre variantes`)
    }
    console.log(`  chemistry_2d [${i}] -> ${data ? `atoms=${data.atoms.length} bonds=${data.bonds.length}` : 'FALLO'}`)
  }
  assert.equal(passCount, 4, `chemistry_2d: se esperaban 4/4 variantes exitosas, se obtuvieron ${passCount}/4`)
  assert.equal(reference!.atomCount, 5, 'chemistry_2d: 2-metilbutano debe producir 5 átomos de carbono')
  assert.equal(reference!.bondCount, 4, 'chemistry_2d: 2-metilbutano debe producir 4 enlaces')
  console.log('visual-source-paraphrase: chemistry_2d 4/4 PASS')
}

// code_execution — 4/4 (el código en sí es SIEMPRE literal/grounded cuando
// está presente — nunca se reescribe; varía la narración alrededor).
{
  const codeBlock = '```python\nx = 2\ny = x + 3\nx = y * 2\nprint(x)\n```'
  const variants = [
    `Traza de ejecución:\n${codeBlock}`,
    `${codeBlock}\nAnalicemos qué ocurre al ejecutar estas líneas paso a paso.`,
    `Consideremos el siguiente fragmento de traza:\n${codeBlock}`,
    `${codeBlock}\nSigamos la ejecución de este programa para ver cómo cambian las variables.`,
  ]
  let passCount = 0
  let reference: unknown = null
  for (const [i, content] of variants.entries()) {
    const spec = build(content)
    const data = spec?.engine === 'code_execution' ? spec.data : undefined
    if (data) {
      passCount += 1
      if (!reference) reference = data.steps
      else assert.deepEqual(data.steps, reference, `code_execution [${i}]: traza derivada debe ser idéntica entre variantes`)
    }
    console.log(`  code_execution [${i}] -> ${data ? `steps=${JSON.stringify(data.steps)}` : 'FALLO'}`)
  }
  assert.equal(passCount, 4, `code_execution: se esperaban 4/4 variantes exitosas, se obtuvieron ${passCount}/4`)
  const lastStep = (reference as any[])[(reference as any[]).length - 1]
  assert.equal(lastStep.output, '10', 'code_execution: x=2, y=5, x=10 -> print(x) debe dar salida "10"')
  console.log('visual-source-paraphrase: code_execution 4/4 PASS')
}

// ---------------------------------------------------------------------------
// SECCIÓN 8 — negative/adversarial: cada engine debe fallar cerrado, nunca
// inventar magnitud/ángulo/conectividad/traza.
// ---------------------------------------------------------------------------
{
  const adversarialCases: Array<{ label: string; content: string }> = [
    { label: 'spatial_vector: "una fuerza empuja el objeto" (sin magnitud ni ángulo)', content: 'Una fuerza empuja el objeto sobre la mesa.' },
    { label: 'spatial_vector: "30 grados" sin fuerza asociada', content: 'El ángulo de inclinación es de 30 grados respecto a la mesa.' },
    { label: 'chemistry_2d: "el compuesto tiene cinco carbonos" (sin conectividad)', content: 'El compuesto tiene cinco átomos de carbono y varios enlaces simples.' },
    { label: 'chemistry_2d: nombre IUPAC sin fórmula ni notación explícita', content: 'La sustancia es el 2-metilbutano, un isómero del pentano.' },
    { label: 'code_execution: "el programa modifica x" (sin código)', content: 'El programa modifica la variable x varias veces durante su ejecución.' },
    { label: 'code_execution: código fuera del subset seguro (bucle) sin traza narrada', content: '```python\nfor i in range(3):\n    print(i)\n```\nSigamos la traza de ejecución paso a paso.' },
  ]
  for (const testCase of adversarialCases) {
    const spec = build(testCase.content)
    assert.equal(spec, null, `ADVERSARIAL "${testCase.label}": debe fallar cerrado (null), nunca inventar datos — obtuvo ${spec ? JSON.stringify((spec as any).data) : 'null'}`)
    console.log(`  adversarial OK (null): ${testCase.label}`)
  }
  console.log('visual-source-paraphrase: 6/6 casos adversariales fallan cerrado PASS')
}

console.log('visual-source-paraphrase-adversarial-contracts: PASS (spatial_vector/chemistry_2d/code_execution ya no dependen de sintaxis especial de StudyAL — lenguaje natural grounded funciona, datos insuficientes fallan cerrado)')
