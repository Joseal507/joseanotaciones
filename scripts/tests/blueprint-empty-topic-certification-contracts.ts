import assert from 'node:assert/strict'
import { certifyBlueprint } from '../../app/api/adaptive/blueprint/route'

// REGRESSION (StudyAL_Visual_System_Stress_Test, Bug 3 — hallazgo Codex C):
// certifyBlueprint solo bloqueaba un topic sin bloques si abarcaba MÁS de 1
// página (isMultiPage) — un topic real confinado a una sola página cuya
// extracción de bloques falló quedaba sin ninguna señal de certificación:
// sobrevivía como metadata/preview pero nunca producía un unit/arc/sesión de
// aprendizaje real (buildLearningPath agrupa por blueprint.blocks, nunca
// itera blueprint.topics). Esto es exactamente el patrón que puede explicar
// que "2-Metilbutano"/código/timeline queden mencionados solo en la intro sin
// llegar nunca a una sesión de aprendizaje real.

const okQuality = { status: 'complete', reasons: [] }
const passedAudit = { passed: true, issues: [], uncoveredFragments: [] }

function blueprintWith(topics: any[], blocks: any[]) {
  return { topics, blocks }
}

// A — topic de UNA sola página sin bloques: antes NO bloqueaba (bug real),
// ahora SÍ debe bloquear.
{
  const blueprint = blueprintWith(
    [{ id: 't1', title: 'Conectividad molecular: 2-Metilbutano', pages: [7] }],
    [],
  )
  const result = certifyBlueprint(blueprint, okQuality, passedAudit)
  assert.equal(result.coverageCertified, false, 'A: topic de 1 página sin bloques debe bloquear certificación (antes no lo hacía)')
  assert.equal(result.planGenerationAllowed, false, 'A: no debe permitir generar el plan mientras un topic con página asignada no tenga bloque')
  assert.ok(result.certificationReasons.some(r => r.includes('2-Metilbutano')), 'A: la razón debe identificar el topic afectado')
}

// B — topic SIN ninguna página asignada (nunca vinculado a contenido real):
// no debe bloquear — no representa un micro perdido.
{
  const blueprint = blueprintWith(
    [{ id: 't2', title: 'Topic sin páginas', pages: [] }],
    [],
  )
  const result = certifyBlueprint(blueprint, okQuality, passedAudit)
  assert.equal(result.coverageCertified, true, 'B: un topic sin páginas asignadas no debe bloquear')
}

// C — topic con al menos un bloque real: nunca bloquea, sin importar páginas.
{
  const blueprint = blueprintWith(
    [{ id: 't3', title: 'Equilibrio químico: Tabla ICE', pages: [3] }],
    [{ id: 'b1', topicId: 't3' }],
  )
  const result = certifyBlueprint(blueprint, okQuality, passedAudit)
  assert.equal(result.coverageCertified, true, 'C: un topic con bloque real nunca debe bloquear')
}

// D — regresión: el caso multi-página sin bloques (el que YA bloqueaba antes
// del fix) debe seguir bloqueando.
{
  const blueprint = blueprintWith(
    [{ id: 't4', title: 'Fuerzas concurrentes y DCL', pages: [10, 11, 12] }],
    [],
  )
  const result = certifyBlueprint(blueprint, okQuality, passedAudit)
  assert.equal(result.coverageCertified, false, 'D: el caso multi-página ya bloqueaba antes del fix — debe seguir bloqueando')
}

// E — múltiples topics vacíos con página asignada: todos deben identificarse,
// no solo el primero.
{
  const blueprint = blueprintWith(
    [
      { id: 't5', title: 'Traza de ejecución de código', pages: [20] },
      { id: 't6', title: 'Línea de tiempo', pages: [22] },
      { id: 't7', title: 'Funciones lineales', pages: [1, 2] },
    ],
    [{ id: 'b1', topicId: 't7' }],
  )
  const result = certifyBlueprint(blueprint, okQuality, passedAudit)
  assert.equal(result.coverageCertified, false, 'E: cualquier topic vacío con página asignada debe bloquear')
  assert.ok(result.certificationReasons.some(r => r.includes('Traza de ejecución de código') && r.includes('Línea de tiempo')), 'E: ambos topics vacíos deben aparecer en la misma razón')
  assert.ok(!result.certificationReasons.some(r => r.includes('Funciones lineales')), 'E: el topic CON bloque no debe aparecer como razón de bloqueo')
}

console.log('blueprint-empty-topic-certification-contracts: PASS (A: 1 página sin bloques bloquea; B: sin páginas no bloquea; C: con bloque no bloquea; D: multi-página sin bloques sigue bloqueando; E: múltiples topics vacíos se identifican todos)')
