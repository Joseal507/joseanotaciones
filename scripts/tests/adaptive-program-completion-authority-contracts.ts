import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  completeAdaptiveSession,
  deriveIsProgramComplete,
  isAdaptiveJourneyFullyTraversed,
  type AdaptiveResumeSession,
} from '../../lib/adaptive/resume'

// P1-B — PROGRAM COMPLETION SERVER-AUTHORITATIVE
//
// Root cause real: completeAdaptiveSession (la única función que el producto vivo llama
// para cerrar una sesión adaptativa) tomaba canonicalCompletion.isProgramComplete como
// entrada — pero su único caller (page.tsx) le pasaba current.isProgramComplete, el
// valor YA almacenado en la propia sesión. Era circular: solo podía PRESERVAR un true
// existente, nunca DERIVAR uno nuevo. La única vía real para que isProgramComplete
// llegara a true era que el cliente lo mandara directo por POST /api/study-sessions,
// que lo reenviaba sin verificación al backend externo.
//
// Fix: deriveIsProgramComplete calcula isProgramComplete a partir de datos verificables
// (todas las sesiones del journey realmente en completedSessionNumbers + unresolvedMicroIds
// vacío) — nunca de un booleano recibido. completeAdaptiveSession (cliente) y
// app/api/study-sessions/route.ts (servidor) usan la MISMA función — no hay lógica
// duplicada, y el servidor nunca confía en body.isProgramComplete.
//
// evaluateSessionCompletion/isMicroMastered (v3 engine) NO se tocan — confirmado (ver
// auditoría previa) que operan sobre SessionState/MicroConcept, un modelo de datos que
// el producto vivo nunca puebla; conectarlos de verdad exigiría construir esa
// infraestructura en vivo, decisión explícitamente diferida por el usuario. Este fix
// usa las señales YA vivas: completedSessionNumbers (que solo gana una sesión tras
// pasar por el motor de sessionFinalTransition.ts ya corregido esta sesión, con
// assessmentComplete real) y unresolvedMicroIds.

function chapter(chapterNumber: number, kind: 'introduction' | 'learning' | 'final_review' = 'learning') {
  return { chapterNumber, kind, status: 'available' as const }
}

const journeyThree = { chapters: [chapter(1, 'introduction'), chapter(2, 'learning'), chapter(3, 'final_review')], totalChapters: 3 }

// ═══ A. coverage 100%, mastery incompleto → programComplete FALSE ═══
// "coverage 100%" aquí = todas las sesiones visitadas (completedSessionNumbers completo),
// pero unresolvedMicroIds NO vacío (mastery real todavía pendiente para algún micro).
assert.equal(
  deriveIsProgramComplete({ journey: journeyThree, completedSessionNumbers: [1, 2, 3], unresolvedMicroIds: ['micro-x'] }),
  false,
  'A: todas las sesiones visitadas pero con un micro sin resolver debe ser FALSE',
)

// ═══ B. todas las sesiones visitadas pero unresolved micros → FALSE ═══
// (mismo invariante que A, con más de un micro sin resolver — refuerza el contrato)
assert.equal(
  deriveIsProgramComplete({ journey: journeyThree, completedSessionNumbers: [1, 2, 3], unresolvedMicroIds: ['micro-a', 'micro-b'] }),
  false,
  'B: unresolvedMicroIds no vacío siempre bloquea, sin importar cuántos micros falten',
)

// ═══ C. último micro realmente mastered (todas las sesiones + 0 unresolved) → TRUE ═══
assert.equal(
  deriveIsProgramComplete({ journey: journeyThree, completedSessionNumbers: [1, 2, 3], unresolvedMicroIds: [] }),
  true,
  'C: todas las sesiones completadas y ningún micro sin resolver debe ser TRUE',
)

// Coverage-sin-mastery explícito: sesiones visitadas pero el journey tiene MÁS capítulos
// de los que aparecen en completedSessionNumbers (sesión pendiente real).
assert.equal(
  isAdaptiveJourneyFullyTraversed(journeyThree, [1, 2]),
  false,
  'coverage parcial (falta capítulo 3) nunca debe leerse como journey completo',
)
assert.equal(
  deriveIsProgramComplete({ journey: journeyThree, completedSessionNumbers: [1, 2], unresolvedMicroIds: [] }),
  false,
  'coverage parcial con 0 unresolved sigue siendo FALSE — coverage no es mastery',
)

// journey vacío/ausente nunca puede considerarse completo (fail-closed, no fail-open)
assert.equal(isAdaptiveJourneyFullyTraversed(undefined, [1, 2, 3]), false, 'journey ausente → nunca completo')
assert.equal(isAdaptiveJourneyFullyTraversed({ chapters: [] }, []), false, 'journey sin capítulos → nunca completo')

// ═══ completeAdaptiveSession (cliente) ya no es circular ═══
const baseSession: AdaptiveResumeSession = {
  id: 's1', temaId: 't1', materialIds: ['m1'], journey: journeyThree,
  completedSessionNumbers: [1, 2], currentSessionNumber: 3, currentStep: 0,
  unresolvedMicroIds: [],
}
// Un cliente que ya trae isProgramComplete:true almacenado (posible manipulación o bug
// previo) NO debe poder simplemente "reafirmarlo" — debe derivarse de nuevo cada vez.
const maliciousStoredTrue: AdaptiveResumeSession = { ...baseSession, isProgramComplete: true, completedSessionNumbers: [1] }
const resultMalicious = completeAdaptiveSession(maliciousStoredTrue, 2, { isProgramComplete: (maliciousStoredTrue as any).isProgramComplete, unresolvedMicroIds: maliciousStoredTrue.unresolvedMicroIds })
assert.equal(resultMalicious.isProgramComplete, false, 'un isProgramComplete=true ya almacenado no debe autoconfirmarse si faltan capítulos reales (capítulo 3 pendiente)')

// La sesión que sí completa el ÚLTIMO capítulo con 0 unresolved → TRUE, derivado, no heredado.
const resultLegit = completeAdaptiveSession(baseSession, 3, { isProgramComplete: (baseSession as any).isProgramComplete, unresolvedMicroIds: baseSession.unresolvedMicroIds })
assert.equal(resultLegit.isProgramComplete, true, 'completar el último capítulo real con 0 unresolved debe derivar TRUE')
assert.equal(resultLegit.status, 'completed')
assert.equal(resultLegit.adaptiveState, 'completed')

// ═══ E. cliente manda is_program_complete:true prematuramente → servidor NO lo acepta ═══
// Verificación ESTRUCTURAL: el route de study-sessions ya no debe reenviar
// body.isProgramComplete verbatim — debe pasar por deriveIsProgramComplete.
const routeSource = readFileSync('app/api/study-sessions/route.ts', 'utf8')
assert.ok(
  routeSource.includes('deriveIsProgramComplete'),
  'E: app/api/study-sessions/route.ts debe importar y usar deriveIsProgramComplete — no puede confiar en body.isProgramComplete',
)
assert.ok(
  !/if\s*\(\s*body\.isProgramComplete\s*===\s*true\s*\)\s*payload\.is_program_complete\s*=\s*true;/.test(routeSource),
  'E: ya no debe existir el reenvío directo, sin verificar, de body.isProgramComplete al backend',
)
const routeDeriveIdx = routeSource.indexOf('deriveIsProgramComplete(')
const routePayloadWriteIdx = routeSource.indexOf('payload.is_program_complete = true')
assert.ok(routeDeriveIdx >= 0 && routePayloadWriteIdx >= 0, 'E: deben existir tanto la derivación como la escritura del payload')
assert.ok(routeDeriveIdx < routePayloadWriteIdx, 'E: la derivación server-side debe ocurrir ANTES de decidir si se persiste is_program_complete')

console.log('adaptive-program-completion-authority-contracts: 13 contracts PASS (A, B, C, E + invariantes de coverage/journey)')
