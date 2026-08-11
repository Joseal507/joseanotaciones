// Misión: auditoría de ciclo de vida y persistencia — preparación idempotente y
// concurrencia (secciones 4 y 8). Usa runSessionPreparationFactory REAL (no
// reimplementado) para probar que dos requests concurrentes con la MISMA
// generationKey comparten exactamente UNA ejecución — nunca generan artefactos
// divergentes ni llaman al generador dos veces.
import assert from 'node:assert/strict'
import { runSessionPreparationFactory } from '../../lib/ai/sessionPreparationFactory'
import { updateSessionById, upsertSession, getSessionById } from '../../lib/studySessions'

class FakeLocalStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null }
  setItem(key: string, value: string): void { this.store.set(key, String(value)) }
  removeItem(key: string): void { this.store.delete(key) }
  clear(): void { this.store.clear() }
}
;(global as any).window = (global as any).window || {}
;(global as any).localStorage = new FakeLocalStorage()
;(global as any).fetch = async () => ({ ok: true, json: async () => ({ success: true, session: {}, sessions: [] }) })

async function main() {
  // ---------------------------------------------------------------------------
  // TEST 3: prepare(sessionId) concurrente (misma generationKey) -> UNA sola
  // ejecución real del generador — la fábrica real deduplica vía el Map `active`.
  // ---------------------------------------------------------------------------
  {
    let generateTeachingCalls = 0
    const store = new Map<string, any>()
    const generationKey = 'concurrent-key-1'
    const runOnce = () => runSessionPreparationFactory({
      sessionKind: 'introduction',
      generationKey,
      evalPreference: 'mix_everything',
      load: async () => store.get(generationKey) || null,
      persist: async value => { store.set(generationKey, value) },
      generateTeaching: async () => {
        generateTeachingCalls += 1
        await new Promise(resolve => setTimeout(resolve, 20))
        return {
          sessionId: 'chapter-1', title: 'Introducción', introduction: 'Inicio', closing: 'Cierre',
          steps: [{ stepId: 's1', id: 's1', microId: 'm1', title: 'Bienvenida', type: 'intro', content: 'Contenido', keyPoints: ['kp1'], keyPointIds: ['kp1id'], factKeys: ['f1'], importance: 'important' as const, cognitiveTarget: 'recognition', sourceReferences: [] }],
        }
      },
      planEvaluations: async () => ({ blocks: [] }),
      generateEvaluationBlock: async (block: any) => ({ ...block, questions: [] }),
      repairEvaluationBlock: async () => [],
    })

    const [resultA, resultB] = await Promise.all([runOnce(), runOnce()])
    assert.equal(generateTeachingCalls, 1, 'TEST 3: dos prepare() concurrentes con la misma generationKey deben invocar generateTeaching UNA sola vez')
    assert.equal(resultA, resultB, 'TEST 3: ambos callers deben recibir la MISMA referencia de resultado — nunca sesiones divergentes')
    assert.equal(resultA.preparationStatus, 'ready')
    console.log('session-idempotent-preparation: TEST 3 (prepare concurrente -> una sola ejecución) PASS')
  }

  // ---------------------------------------------------------------------------
  // TEST 2: prepare(S1) dos veces SECUENCIALMENTE (no concurrente) -> la segunda
  // reutiliza el estado ya persistido ('ready') sin volver a generar — misma sesión,
  // no efectos duplicados.
  // ---------------------------------------------------------------------------
  {
    let generateTeachingCalls = 0
    const store = new Map<string, any>()
    const generationKey = 'sequential-key-1'
    const runOnce = () => runSessionPreparationFactory({
      sessionKind: 'introduction',
      generationKey,
      evalPreference: 'mix_everything',
      load: async () => store.get(generationKey) || null,
      persist: async value => { store.set(generationKey, value) },
      generateTeaching: async () => {
        generateTeachingCalls += 1
        return {
          sessionId: 'chapter-1', title: 'Introducción', introduction: 'Inicio', closing: 'Cierre',
          steps: [{ stepId: 's1', id: 's1', microId: 'm1', title: 'Bienvenida', type: 'intro', content: 'Contenido', keyPoints: ['kp1'], keyPointIds: ['kp1id'], factKeys: ['f1'], importance: 'important' as const, cognitiveTarget: 'recognition', sourceReferences: [] }],
        }
      },
      planEvaluations: async () => ({ blocks: [] }),
      generateEvaluationBlock: async (block: any) => ({ ...block, questions: [] }),
      repairEvaluationBlock: async () => [],
    })

    const first = await runOnce()
    const second = await runOnce()
    assert.equal(generateTeachingCalls, 1, 'TEST 2: un segundo prepare() sobre una sesión YA ready no debe regenerar teaching')
    assert.deepEqual(first.teachingContent, second.teachingContent, 'TEST 2: el contenido devuelto debe ser idéntico, no un artefacto nuevo')
    console.log('session-idempotent-preparation: TEST 2 (prepare dos veces secuencial -> misma sesión, sin regenerar) PASS')
  }

  // ---------------------------------------------------------------------------
  // TEST 16/29 (proxy de concurrencia real): múltiples updateSessionById()
  // "simultáneos" (disparados sin esperar el anterior, como haría código real que no
  // serializa sus propias llamadas) sobre la MISMA sesión no deben perderse entre sí
  // — usa la función REAL, que hace read-modify-write síncrono (loadAll+saveAll sin
  // await de por medio), por eso incluso llamadas disparadas "a la vez" desde el
  // mismo proceso Node son en realidad secuenciales a nivel de motor JS.
  // ---------------------------------------------------------------------------
  {
    const session = upsertSession({
      temaId: 'concurrency-tema', enfoque: 'teorico', processMode: 'adaptive',
      materialIds: ['material-concurrency'],
    })
    const writes = Array.from({ length: 20 }, (_, i) => i)
    for (const i of writes) {
      updateSessionById(session.id, (current: any) => ({
        ...current,
        recoveryQueues: { ...(current.recoveryQueues || {}), '1': [...(current.recoveryQueues?.['1'] || []), { recoveryId: `r${i}`, status: 'unresolved' }] },
      }))
    }
    const finalSession = getSessionById(session.id)!
    const queue = (finalSession.recoveryQueues as any)['1']
    assert.equal(queue.length, 20, 'las 20 escrituras read-modify-write deben acumularse SIN perder ninguna (mismo proceso, síncronas)')
    assert.deepEqual(queue.map((q: any) => q.recoveryId), writes.map(i => `r${i}`), 'el orden y contenido exacto debe preservarse, ninguna escritura debe pisar a otra')
    console.log('session-idempotent-preparation: same-process sequential updateSessionById writes never lost PASS')
  }

  console.log('session-idempotent-preparation-concurrency-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
