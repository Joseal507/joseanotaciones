import assert from 'node:assert/strict'
import { factoryTeaching } from '../../app/api/adaptive/session-teach/route'
import type { TeachingContent } from '../../lib/ai/teachingContentContract'
import type { VisualEngine } from '../../lib/adaptive/visual/visualContract'

// StudyAL_Visual_System_Stress_Test — Bug 6 (hallazgo Codex D): las pruebas
// existentes (visual-foundation-contracts.ts, dev-tool-canonical-answer-
// contracts.ts) solo ejercitan classifyVisualNeed/buildVisualSpec/grading
// DIRECTAMENTE — nunca la función de producción real que los une para
// producir classContent (factoryTeaching, session-teach/route.ts:1229). Esta
// prueba ejercita factoryTeaching REAL (misma función que usa el POST vivo
// en generateTeachingStrict) con contenido docente representativo del
// stress test de 8 topics, y verifica la matriz TOPIC -> ENGINE completa,
// incluyendo el caso adversarial que NUNCA debe producir un visual.

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-pretest'

function step(overrides: Partial<TeachingContent['steps'][number]> & { title: string; content: string }): TeachingContent['steps'][number] {
  return {
    id: overrides.id || `step_${Math.random().toString(36).slice(2)}`,
    type: 'concept',
    title: overrides.title,
    content: overrides.content,
    keyPoints: overrides.keyPoints || [{ id: 'kp1', text: 'punto clave' } as any],
    microId: overrides.microId || overrides.id || 'micro',
    importance: 'important',
    cognitiveTarget: overrides.cognitiveTarget || 'application',
    relatedBlockIds: [],
    factKeys: overrides.factKeys || ['f1'],
    sourceReferences: [],
  }
}

const session = { id: 'chapter-2', chapterNumber: 2, title: 'Sesión', objective: 'Aprender', topicIds: [], blockIds: [], concepts: [], pages: [], kind: 'learning' as const }

// Matriz de los 8 topics del stress test real (Bug 3/Bug 6) -> engine
// esperado. "Document Purpose/Map" no aparece: es contenido de intro/mapa,
// nunca un step de aprendizaje real, y no participa de la matriz de visuales.
const cases: Array<{ topic: string; title: string; content: string; expectedEngine: VisualEngine | null }> = [
  {
    topic: 'FUNCIONES (lineal/cuadrática)',
    title: 'Función lineal',
    content: 'La función f(x) = 2x + 3 tiene dominio -5 <= x <= 5. La gráfica muestra pendiente positiva y una intersección con el eje y.',
    expectedEngine: 'graph_2d',
  },
  {
    topic: 'ICE (equilibrio químico)',
    title: 'Tabla ICE',
    content: 'Reacción: H2 + I2 ⇌ 2HI. Concentraciones iniciales: [H2] = 1.00, [I2] = 1.00, [HI] = 0. Cambio: [H2] = -x, [I2] = -x, [HI] = +2x. En el equilibrio: [H2] = 1-x, [I2] = 1-x, [HI] = 2x.',
    expectedEngine: 'structured_grid',
  },
  {
    topic: 'DCL (fuerzas concurrentes)',
    title: 'Diagrama de cuerpo libre',
    content: 'Sobre el bloque actúan las siguientes fuerzas concurrentes. Peso = 50 N a 270°. Normal = 50 N a 90°. Analiza el equilibrio en el eje vertical.',
    expectedEngine: 'spatial_vector',
  },
  {
    topic: '2-METILBUTANO (conectividad molecular)',
    title: 'Estructura del 2-metilbutano',
    content: 'Átomos: C1=carbono, C2=carbono, C3=carbono, C4=carbono. Enlaces: C1-C2 (enlace simple), C2-C3 (enlace simple), C3-C4 (enlace simple).',
    expectedEngine: 'chemistry_2d',
  },
  {
    topic: 'CÓDIGO (traza de estado del programa)',
    title: 'Traza de ejecución',
    content: '```python\nx = 3\ny = x * 2\nprint(y)\n```\nTraza: línea 1 x=3; línea 2 y=6; línea 3 salida=6.',
    expectedEngine: 'code_execution',
  },
  {
    topic: 'LÍNEA DE TIEMPO (secuencia temporal)',
    title: 'Cronología de eventos',
    content: 'En 1848 ocurrió el descubrimiento inicial. En 1859 se publicó el estudio que lo formalizó. La secuencia cronológica conecta ambos hitos.',
    expectedEngine: 'timeline',
  },
  {
    topic: 'ADVERSARIAL (texto no-visual)',
    title: 'Reflexión sobre el método científico',
    content: 'El método científico avanza mediante observación, hipótesis y contraste con la evidencia disponible. Ningún paso garantiza la verdad definitiva; cada conclusión permanece abierta a revisión futura conforme aparece nueva evidencia relevante para el problema estudiado.',
    expectedEngine: null,
  },
]

const source: TeachingContent = {
  sessionIntro: 'Inicio de la sesión.',
  steps: cases.map(c => step({ id: c.topic, microId: c.topic, title: c.title, content: c.content })),
  closing: 'Cierre de la sesión.',
}

const prepared = factoryTeaching(source, session)
assert.equal(prepared.steps.length, cases.length, 'factoryTeaching debe preservar un step por cada topic de la matriz')

const byId = new Map(prepared.steps.map(s => [s.id, s]))

for (const c of cases) {
  const preparedStep = byId.get(c.topic)
  assert.ok(preparedStep, `matriz: falta el step preparado para "${c.topic}"`)
  if (c.expectedEngine === null) {
    assert.equal(preparedStep!.visualSpec, undefined, `matriz: "${c.topic}" (adversarial, sin señal visual real) NO debe producir ningún VisualSpec — se detectó "${preparedStep!.visualSpec?.engine}"`)
    assert.equal(preparedStep!.visualRequirement, undefined, `matriz: "${c.topic}" no debe producir ni siquiera un VisualRequirement clasificado`)
  } else {
    assert.ok(preparedStep!.visualSpec, `matriz: "${c.topic}" debe producir un VisualSpec real (esperado engine=${c.expectedEngine})`)
    assert.equal(preparedStep!.visualSpec!.engine, c.expectedEngine, `matriz: "${c.topic}" produjo engine="${preparedStep!.visualSpec!.engine}", esperado "${c.expectedEngine}"`)
    // El VisualSpec debe venir firmado (server-authoritative) — misma garantía
    // que exige el gate de mastery en producción (visualSpecIntegrity.ts).
    assert.ok((preparedStep!.visualSpec as any).integrity, `matriz: "${c.topic}" debe producir un VisualSpec firmado (campo "integrity"), no uno sin firmar`)
  }
}

// Verificación cruzada explícita: el engine de FUNCIONES nunca se confunde
// con el de ICE/DCL/2-METILBUTANO/CÓDIGO/TIMELINE entre sí (matriz completa,
// no solo presencia/ausencia) — cada topic debe apuntar a un engine ÚNICO
// entre los 6 disponibles, sin colisiones cruzadas.
const engines = cases.filter(c => c.expectedEngine).map(c => byId.get(c.topic)!.visualSpec!.engine)
assert.equal(new Set(engines).size, engines.length, 'matriz: cada topic con visual esperado debe mapear a un engine DISTINTO — una colisión indicaría que el clasificador está confundiendo dos dominios de contenido')

console.log('visual-engine-pipeline-matrix-contracts: PASS (8-topic matrix vía factoryTeaching real: graph_2d, structured_grid, spatial_vector, chemistry_2d, code_execution, timeline, + adversarial sin visual — session preparation -> classContent -> VisualSpec firmado)')
