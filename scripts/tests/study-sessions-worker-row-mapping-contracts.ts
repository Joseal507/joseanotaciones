import assert from 'node:assert/strict'
import { mapStudySessionRow } from '../../cloudflare/studyal-api/src/index'

// StudyAL_Visual_System_Stress_Test — Layer B GAP "persistence — una prueba
// final" (pedido explícito del usuario). Prueba la función REAL de mapeo
// GET del Worker de Cloudflare (extraída de app.fetch como
// `mapStudySessionRow`, sin cambiar su comportamiento — mismo patrón que
// exportar factoryTeaching/certifyBlueprint en este mismo round), contra un
// objeto plano que simula EXACTAMENTE una fila D1 real (snake_case, JSON
// serializado como string, tal como lo escribe /study-sessions/upsert). No
// requiere wrangler/miniflare/D1 real — mapStudySessionRow es una función
// pura sin dependencia de env/D1Database.
//
// Esta prueba habría FALLADO antes de esta ronda para dos hallazgos
// distintos:
//   1) adaptiveSetup/setupHash (ya reportado en el reporte anterior de
//      Layer B) — el mapeo los omitía por completo.
//   2) currentSessionNumber/status/adaptiveState (hallazgo NUEVO de esta
//      ronda, al investigar el GAP de persistencia pedido explícitamente):
//      route.ts (el proxy Next.js) YA construía y enviaba estos 3 campos en
//      cada POST a /study-sessions/upsert dando por hecho que sobrevivían,
//      pero NINGUNO de los tres tenía columna en el INSERT/bind() del Worker
//      ni aparecía en este mapeo — se descartaban en silencio en cada
//      escritura, así que un restore server-authoritative real (dispositivo
//      distinto, caché borrada) SIEMPRE perdía "sesión actual" y el estado
//      'ready' necesario para que restoreGapAfterReady (StudyALAdaptive.tsx)
//      funcione — degradando de vuelta a regeneración silenciosa
//      exactamente para el escenario cross-device que Bug 1 pretendía
//      cerrar. Corregido en el mismo Worker: ALTER TABLE dinámico +
//      columnas en INSERT/bind + COALESCE en UPDATE + este mapeo.

const fullRow = {
  id: 'sess-1',
  user_id: 'user-1',
  tema_id: 'tema-1',
  enfoque: 'teorico',
  process_mode: 'adaptive',
  study_mode: 'adaptive',
  material_ids: JSON.stringify(['mat-1']),
  selected_pages: null,
  flashcards: null,
  notes: null,
  material_text: null,
  current_phase: null,
  adaptive_program: JSON.stringify({ id: 'journey-1', totalChapters: 3, chapters: [{ id: 'chapter-1' }] }),
  process_style: null,
  target_score: 80,
  exam_date: null,
  exam_date_custom: null,
  material_blueprint: JSON.stringify({ version: 1, blocks: [{ id: 'b1' }], topics: [] }),
  mastery_snapshot: null,
  adaptive_setup: JSON.stringify({ knowledgeLevel: 'never_seen', examDateType: 'just_studying', completedAt: 12345 }),
  setup_hash: 'hash-abc',
  current_session_number: 3,
  status: 'in_progress',
  adaptive_state: 'ready',
  // AUDITORÍA (misma misión, hallazgo posterior): idéntico patrón — route.ts
  // ya enviaba estos campos en cada upsert, ninguno tenía columna.
  primary_material_id: 'mat-1',
  mastery_material_key: 'key-1',
  current_step: 2,
  completed_session_numbers: JSON.stringify([1, 2]),
  replay_session_number: null,
  replay_attempt: null,
  session_content: JSON.stringify({ '3': { sessionId: 'chapter-3' } }),
  session_preparation: JSON.stringify({ '4': { preparationStatus: 'teaching_generation' } }),
  is_program_complete: 0,
  unresolved_micro_ids: JSON.stringify(['micro-b']),
  active_study_ms: 60000,
  break_hours_acknowledged: 1,
  material_names: JSON.stringify(['Material 1']),
  recovery_queues: JSON.stringify({ '3': [{ recoveryId: 'r1', status: 'unresolved' }] }),
  created_at: 1000,
  last_opened_at: 2000,
}

// A — fila completa: TODOS los campos deben sobrevivir el mapeo real,
// incluyendo los 2 grupos que se perdían antes de esta ronda.
{
  const mapped = mapStudySessionRow(fullRow) as any
  assert.equal(mapped.id, 'sess-1')
  assert.deepEqual(mapped.adaptiveProgram, { id: 'journey-1', totalChapters: 3, chapters: [{ id: 'chapter-1' }] }, 'A: journey (adaptiveProgram) debe sobrevivir')
  assert.deepEqual(mapped.materialBlueprint, { version: 1, blocks: [{ id: 'b1' }], topics: [] }, 'A: blueprint (materialBlueprint) debe sobrevivir')
  assert.deepEqual(mapped.adaptiveSetup, { knowledgeLevel: 'never_seen', examDateType: 'just_studying', completedAt: 12345 }, 'A: adaptiveSetup debe sobrevivir (hallazgo previo de esta misión)')
  assert.equal(mapped.setupHash, 'hash-abc', 'A: setupHash debe sobrevivir (hallazgo previo de esta misión)')
  assert.equal(mapped.currentSessionNumber, 3, 'A: currentSessionNumber debe sobrevivir (hallazgo NUEVO de esta ronda)')
  assert.equal(mapped.status, 'in_progress', 'A: status debe sobrevivir (hallazgo NUEVO de esta ronda)')
  assert.equal(mapped.adaptiveState, 'ready', 'A: adaptiveState debe sobrevivir (hallazgo NUEVO — crítico para restoreGapAfterReady en StudyALAdaptive.tsx)')
  assert.equal(mapped.primaryMaterialId, 'mat-1', 'A: primaryMaterialId debe sobrevivir')
  assert.equal(mapped.currentStep, 2, 'A: currentStep debe sobrevivir')
  assert.deepEqual(mapped.completedSessionNumbers, [1, 2], 'A: completedSessionNumbers debe sobrevivir')
  assert.deepEqual(mapped.sessionContent, { '3': { sessionId: 'chapter-3' } }, 'A: sessionContent debe sobrevivir')
  assert.deepEqual(mapped.sessionPreparation, { '4': { preparationStatus: 'teaching_generation' } }, 'A: sessionPreparation debe sobrevivir')
  assert.equal(mapped.isProgramComplete, false, 'A: isProgramComplete=0 debe mapear a false')
  assert.deepEqual(mapped.unresolvedMicroIds, ['micro-b'], 'A: unresolvedMicroIds debe sobrevivir')
  assert.equal(mapped.activeStudyMs, 60000, 'A: activeStudyMs debe sobrevivir')
  assert.deepEqual(mapped.recoveryQueues, { '3': [{ recoveryId: 'r1', status: 'unresolved' }] }, 'A: recoveryQueues debe sobrevivir')
  console.log('study-sessions-worker-row-mapping: A (fila completa, todos los campos sobreviven) PASS')
}

// B — fila SIN los 3 campos nuevos (fila legacy escrita antes de este fix,
// o cualquier sesión no-adaptativa): no debe lanzar, deben quedar undefined,
// nunca fabricar un valor falso.
{
  const legacyRow = { ...fullRow, current_session_number: null, status: null, adaptive_state: null }
  const mapped = mapStudySessionRow(legacyRow) as any
  assert.equal(mapped.currentSessionNumber, undefined, 'B: fila legacy sin el campo -> undefined, no 0/null fabricado')
  assert.equal(mapped.status, undefined, 'B: fila legacy sin el campo -> undefined')
  assert.equal(mapped.adaptiveState, undefined, 'B: fila legacy sin el campo -> undefined')
  console.log('study-sessions-worker-row-mapping: B (fila legacy sin los campos nuevos, no fabrica valores) PASS')
}

// C — currentSessionNumber=0 es un valor legítimo (no debe confundirse con
// "ausente" por un chequeo `truthy` descuidado).
{
  const zeroRow = { ...fullRow, current_session_number: 0 }
  const mapped = mapStudySessionRow(zeroRow) as any
  assert.equal(mapped.currentSessionNumber, 0, 'C: currentSessionNumber=0 es un valor real, no debe convertirse en undefined')
  console.log('study-sessions-worker-row-mapping: C (currentSessionNumber=0 no se confunde con ausente) PASS')
}

console.log('study-sessions-worker-row-mapping-contracts: PASS (mapStudySessionRow real del Worker — adaptiveSetup/setupHash + currentSessionNumber/status/adaptiveState sobreviven el mapeo GET real)')
