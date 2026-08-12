import assert from 'node:assert/strict'
import {
  computeSessionDependencyFingerprint,
  isPrefetchStillValid,
  shouldPrefetchSession,
  sharedSessionPreparationRequests,
  type PrefetchDependencyInput,
} from '../../lib/adaptive/sessionPrefetch'

const base: PrefetchDependencyInput = {
  chapterId: 'chapter-2', chapterBlockIds: ['b1', 'b2'], blueprintVersion: 3,
  journeyId: 'journey-1', journeyVersion: 1, setupSnapshot: { knowledgeLevel: 'novato', evalPreference: 'mix_everything' },
  materialHash: 'material-abc',
}

{
  const a = computeSessionDependencyFingerprint(base)
  const b = computeSessionDependencyFingerprint({ ...base })
  assert.equal(a, b, 'mismo input -> mismo fingerprint (determinista)')

  const orderInsensitive = computeSessionDependencyFingerprint({ ...base, chapterBlockIds: ['b2', 'b1'] })
  assert.equal(a, orderInsensitive, 'el orden de chapterBlockIds no debe afectar el fingerprint')
  console.log('session-prefetch: fingerprint determinism PASS')
}

{
  const a = computeSessionDependencyFingerprint(base)
  const changedBlueprint = computeSessionDependencyFingerprint({ ...base, blueprintVersion: 4 })
  const changedJourney = computeSessionDependencyFingerprint({ ...base, journeyVersion: 2 })
  const changedSetup = computeSessionDependencyFingerprint({ ...base, setupSnapshot: { knowledgeLevel: 'avanzado' } })
  const changedBlocks = computeSessionDependencyFingerprint({ ...base, chapterBlockIds: ['b1', 'b2', 'b3'] })
  const changedMaterial = computeSessionDependencyFingerprint({ ...base, materialHash: 'material-xyz' })
  for (const other of [changedBlueprint, changedJourney, changedSetup, changedBlocks, changedMaterial]) {
    assert.notEqual(a, other, 'cualquier cambio en una dependencia real debe cambiar el fingerprint')
  }
  console.log('session-prefetch: fingerprint sensitivity PASS')
}

{
  assert.equal(shouldPrefetchSession('learning'), true)
  assert.equal(shouldPrefetchSession('final_review'), false, 'final_review depende de la evidencia real de N — nunca se prefetchea por adelantado')
  assert.equal(shouldPrefetchSession('introduction'), false)
  console.log('session-prefetch: shouldPrefetchSession gating PASS')
}

{
  const fingerprint = computeSessionDependencyFingerprint(base)
  const meta = { sessionNumber: 3, sourceBlueprintVersion: 3, journeyVersion: 1, setupFingerprint: 'x', dependencyFingerprint: fingerprint, preparedAt: Date.now(), status: 'ready' as const }
  assert.equal(isPrefetchStillValid(meta, fingerprint), true, 'fingerprint coincide -> válido')
  assert.equal(isPrefetchStillValid(meta, computeSessionDependencyFingerprint({ ...base, blueprintVersion: 99 })), false, 'fingerprint distinto -> stale, nunca se sirve')
  assert.equal(isPrefetchStillValid(undefined, fingerprint), false, 'sin meta -> nunca válido (nada que servir)')
  assert.equal(isPrefetchStillValid(null, fingerprint), false)
  console.log('session-prefetch: isPrefetchStillValid PASS')
}

console.log('session-prefetch-contracts: ALL PASS')

async function testSharedPrefetchColdAuthority(){
  let remoteCalls=0
  const key='journey:chapter_2:stable-fingerprint'
  const prepare=()=>sharedSessionPreparationRequests.run(key,async()=>{
    remoteCalls+=1
    await new Promise(resolve=>setTimeout(resolve,20))
    return {success:true,classContent:{sessionId:'chapter_2'}}
  })
  const [prefetch,cold]=await Promise.all([prepare(),prepare()])
  assert.equal(remoteCalls,1,'prefetch+cold concurrentes deben compartir una única petición remota')
  assert.equal(prefetch,cold,'ambos consumidores deben recibir el mismo resultado coherente')
  console.log('session-prefetch: prefetch+cold shared request authority PASS')
}
testSharedPrefetchColdAuthority().catch(error=>{console.error(error);process.exitCode=1})
