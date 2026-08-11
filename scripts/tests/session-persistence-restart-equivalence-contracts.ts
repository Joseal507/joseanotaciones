// Misión: auditoría de ciclo de vida y persistencia — TEST DE RESTART REAL (sección
// 17, "si no pasa este test, la persistencia no está terminada"). Usa las funciones
// REALES de lib/studySessions.ts (loadAll/saveAll internos vía upsertSession/
// updateSessionById/getSessionById) contra un localStorage simulado en memoria — NO
// reimplementa la lógica de persistencia, la EJECUTA. "PROCESO A" escribe; se
// destruye todo estado en memoria de proceso; "PROCESO B" arranca leyendo
// EXCLUSIVAMENTE lo que quedó en el localStorage simulado (como si fuera un proceso
// nuevo, un navegador reabierto) y debe reconstruir el mismo estado pedagógico
// relevante.
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// localStorage simulado (Storage real, no un mock parcial) + window/fetch mínimos —
// necesarios porque lib/studySessions.ts usa `typeof window === 'undefined'` como
// guard y llama a fetch() en syncToServer.
// ---------------------------------------------------------------------------
class FakeLocalStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null }
  setItem(key: string, value: string): void { this.store.set(key, String(value)) }
  removeItem(key: string): void { this.store.delete(key) }
  clear(): void { this.store.clear() }
  // Exporta/importa el contenido crudo — simula "lo que hay en disco".
  snapshot(): Record<string, string> { return Object.fromEntries(this.store) }
  restoreFrom(data: Record<string, string>): void { this.store = new Map(Object.entries(data)) }
}

const fakeStorage = new FakeLocalStorage()
;(global as any).window = (global as any).window || {}
;(global as any).localStorage = fakeStorage
;(global as any).fetch = async () => ({ ok: true, json: async () => ({ success: true, session: {}, sessions: [] }) })

async function main() {
  const { upsertSession, updateSessionById, getSessionById } = await import('../../lib/studySessions')
  const { buildAssessmentBlueprint, recordAssessmentEvidence, canCompleteSessionFromAssessment } = await import('../../lib/adaptive/evaluation/assessmentBlueprint')
  const { startAdaptiveSession } = await import('../../lib/adaptive/resume')

  // =========================================================================
  // PROCESO A: crear programa, preparar sesión, estudiar varias actividades,
  // persistir — usando SOLO las funciones reales de producción.
  // =========================================================================
  const temaId = 'restart-tema-1'
  const created = upsertSession({
    temaId, enfoque: 'teorico', processMode: 'adaptive',
    materialIds: ['material-restart-1'], primaryMaterialId: 'material-restart-1',
    adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, evalPreference: 'mix_everything', planView: 'book', completedAt: 1 } as any,
    blueprint: { version: 1, blocks: [{ id: 'b1' }], topics: [] },
    journey: { id: 'journey-restart-1', version: 1, chapters: [
      { id: 'chapter-1', chapterNumber: 1, kind: 'introduction', status: 'available', blockIds: [], unitIds: [] },
      { id: 'chapter-2', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['b1'], unitIds: ['u1'] },
    ], totalChapters: 2 },
  })
  const sessionId = created.id
  assert.ok(sessionId, 'PROCESO A: upsertSession debe devolver un id real')

  // Preparar sesión 2 (simula lo que loadContext hace al recibir classContent).
  const teachingSteps = [
    { id: 'step-a', title: 'Concepto A', content: 'Contenido A', keyPoints: ['kp-a'], importance: 'important' as const, relatedBlockIds: [], microId: 'micro-a', factKeys: ['fact-a'] },
    { id: 'step-b', title: 'Concepto B', content: 'Contenido B', keyPoints: ['kp-b'], importance: 'important' as const, relatedBlockIds: [], microId: 'micro-b', factKeys: ['fact-b'] },
  ]
  const assessmentBlueprint = buildAssessmentBlueprint(
    teachingSteps.map(step => ({ ...step, importance: 0.7 })),
    sessionId, 1,
  )
  const classContent2 = {
    sessionId: 'chapter-2', sessionTitle: 'Sesión 2', sessionNumber: 2, sessionKind: 'learning',
    steps: teachingSteps, sessionIntro: 'Inicio', sessionClosing: 'Cierre', totalSteps: 2,
    evaluationBlocks: [{ id: 'block-1', afterStepId: 'step-b', coveredStepIds: ['step-a', 'step-b'], coveredKeyPoints: ['kp-a', 'kp-b'], questions: [] }],
    assessmentBlueprint,
  }
  updateSessionById(sessionId, (current: any) => ({
    ...startAdaptiveSession(current, 2, 0),
    sessionContent: { ...(current.sessionContent || {}), '2': classContent2 },
  }))

  // Estudiar varias actividades: avanzar pasos + registrar evidencia real (fact-a
  // demostrado independientemente, fact-b todavía no).
  const [objectiveA, objectiveB] = assessmentBlueprint.objectives
  let updatedBlueprint = recordAssessmentEvidence(assessmentBlueprint, [objectiveA.objectiveId], ['fact-a'], {
    valid: true, correct: true, independent: true, evidenceId: 'ev-fact-a',
  })
  updateSessionById(sessionId, (current: any) => ({
    ...current,
    currentStep: 1,
    sessionContent: { ...(current.sessionContent || {}), '2': { ...current.sessionContent['2'], assessmentBlueprint: updatedBlueprint } },
    recoveryQueues: { ...(current.recoveryQueues || {}), '2': [{ recoveryId: 'r1', status: 'unresolved', latestFactKeys: ['fact-b'] }] },
  }))

  const beforeRestartSession = getSessionById(sessionId)!
  assert.equal(beforeRestartSession.currentStep, 1, 'PROCESO A: currentStep debe reflejar el avance real')
  assert.equal((beforeRestartSession.sessionContent as any)['2'].assessmentBlueprint.objectives.find((o: any) => o.objectiveId === objectiveA.objectiveId).independentlyCorrect, true)
  assert.equal((beforeRestartSession.sessionContent as any)['2'].assessmentBlueprint.objectives.find((o: any) => o.objectiveId === objectiveB.objectiveId).independentlyCorrect, false)
  assert.equal(canCompleteSessionFromAssessment(updatedBlueprint, ['r1']), false, 'PROCESO A: con fact-b unresolved y recovery activo, la sesión NO puede completarse')

  // =========================================================================
  // DESTRUIR ESTADO EN MEMORIA — captura SOLO lo que quedó en el localStorage
  // simulado, descarta cualquier referencia JS en memoria de "PROCESO A", y crea un
  // localStorage TOTALMENTE NUEVO poblado únicamente desde ese snapshot — exactamente
  // como si el navegador se hubiera cerrado y reabierto (o el proceso hubiera muerto).
  // =========================================================================
  const persistedSnapshot = fakeStorage.snapshot()
  assert.ok(Object.keys(persistedSnapshot).length > 0, 'debe haber algo realmente persistido en localStorage antes de "reiniciar"')
  const freshStorage = new FakeLocalStorage()
  freshStorage.restoreFrom(persistedSnapshot)
  ;(global as any).localStorage = freshStorage

  // =========================================================================
  // PROCESO B: leer ÚNICAMENTE persistencia, restaurar programa, restaurar sesión,
  // continuar — usando las MISMAS funciones reales importadas arriba (module cache
  // de Node, pero leen `global.localStorage` dinámicamente en cada llamada, no una
  // referencia capturada al importar — por eso el swap de localStorage es válido).
  // =========================================================================
  const restored = getSessionById(sessionId)
  assert.ok(restored, 'PROCESO B: debe poder leer la sesión desde CERO solo con lo persistido')
  assert.equal(restored!.currentStep, 1, 'PROCESO B: currentStep debe sobrevivir el restart')
  assert.equal(restored!.blueprint?.version, 1, 'PROCESO B: blueprint debe sobrevivir el restart')
  assert.equal(restored!.journey?.chapters?.length, 2, 'PROCESO B: journey debe sobrevivir el restart')

  const restoredContent = (restored!.sessionContent as any)?.['2']
  assert.ok(restoredContent, 'PROCESO B: sessionContent[2] debe sobrevivir el restart')
  assert.equal(restoredContent.steps.length, 2, 'PROCESO B: los steps enseñados deben sobrevivir')

  const restoredBlueprint = restoredContent.assessmentBlueprint
  const restoredObjectiveA = restoredBlueprint.objectives.find((o: any) => o.objectiveId === objectiveA.objectiveId)
  const restoredObjectiveB = restoredBlueprint.objectives.find((o: any) => o.objectiveId === objectiveB.objectiveId)
  assert.equal(restoredObjectiveA.independentlyCorrect, true, 'PROCESO B: fact-a demostrado debe sobrevivir el restart (mastered no se pierde)')
  assert.equal(restoredObjectiveB.independentlyCorrect, false, 'PROCESO B: fact-b unresolved debe SEGUIR unresolved tras el restart (no se convierte en mastered por accidente)')
  assert.deepEqual(restoredObjectiveA.demonstratedFactKeys, ['fact-a'], 'PROCESO B: demonstratedFactKeys exacto debe sobrevivir')

  const restoredRecoveryQueue = (restored!.recoveryQueues as any)?.['2']
  assert.equal(restoredRecoveryQueue?.[0]?.status, 'unresolved', 'PROCESO B: recovery pendiente debe sobrevivir el restart')

  assert.equal(
    canCompleteSessionFromAssessment(restoredBlueprint, restoredRecoveryQueue.filter((i: any) => i.status !== 'resolved').map((i: any) => i.recoveryId)),
    false,
    'PROCESO B: el mismo estado pedagógico (no completable) debe reproducirse exactamente tras el restart',
  )

  // PROCESO B continúa: resuelve el recovery pendiente y demuestra fact-b — la
  // sesión AHORA sí debe poder completarse, probando que el restart no dejó el
  // estado en un limbo que impida progresar.
  const afterResolving = recordAssessmentEvidence(restoredBlueprint, [objectiveB.objectiveId], ['fact-b'], {
    valid: true, correct: true, independent: true, evidenceId: 'ev-fact-b-after-restart',
  })
  updateSessionById(sessionId, (current: any) => ({
    ...current,
    recoveryQueues: { ...(current.recoveryQueues || {}), '2': [{ recoveryId: 'r1', status: 'resolved', latestFactKeys: ['fact-b'] }] },
    sessionContent: { ...(current.sessionContent || {}), '2': { ...current.sessionContent['2'], assessmentBlueprint: afterResolving } },
  }))
  const finalState = getSessionById(sessionId)!
  const finalBlueprint = (finalState.sessionContent as any)['2'].assessmentBlueprint
  assert.equal(canCompleteSessionFromAssessment(finalBlueprint, []), true, 'tras continuar post-restart y resolver todo, la sesión SÍ debe poder completarse')

  console.log('session-persistence-restart-equivalence: PROCESO A -> destruir estado -> PROCESO B produce el MISMO estado pedagógico relevante PASS')
  console.log('session-persistence-restart-equivalence-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
