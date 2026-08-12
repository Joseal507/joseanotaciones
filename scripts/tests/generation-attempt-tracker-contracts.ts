import assert from 'node:assert/strict'
import { GenerationAttemptTracker } from '../../lib/adaptive/generationAttemptTracker'

// StudyAL_Visual_System_Stress_Test — Layer B GAP C ("cancellation — demuestra
// ahorro", pedido explícito del usuario, sección 9): "attempt A token=1,
// attempt B token=2, A resolves late, stillCurrent(A) === false, A cannot
// commit blueprint/journey/state, B remains authoritative." Prueba el
// contrato REAL (GenerationAttemptTracker, extraído verbatim de
// StudyALAdaptive.tsx — mismo objeto que usa la UI real, ver
// components/materias/StudyALAdaptive.tsx) al nivel correcto: lifecycle/
// token/AbortController, sin inventar una carrera de UI artificial (el
// propio código ya impide dos intentos simultáneos vía el guard
// `blueprintLoading` — la carrera real que puede ocurrir es cross-mount/
// cross-intento, exactamente lo que este tracker gobierna).

// A — contrato básico: begin() incrementa el token y nunca lo repite.
{
  const tracker = new GenerationAttemptTracker()
  const a = tracker.begin()
  const b = tracker.begin()
  assert.equal(a.token, 1, 'A: primer intento -> token=1')
  assert.equal(b.token, 2, 'A: segundo intento -> token=2, nunca repite')
  assert.notEqual(a.token, b.token, 'A: tokens de intentos distintos nunca coinciden')
  console.log('generation-attempt-tracker: A (tokens monotónicos, nunca repetidos) PASS')
}

// B — EL CASO EXACTO PEDIDO: A resuelve tarde, stillCurrent(A) === false,
// B sigue siendo autoritativo.
{
  const tracker = new GenerationAttemptTracker()
  const attemptA = tracker.begin()
  assert.equal(attemptA.token, 1, 'B: intento A = token 1')

  // Simula que A sigue "en vuelo" (su fetch aún no resolvió) cuando el
  // usuario dispara un segundo intento (p.ej. reintento tras error, o un
  // segundo montaje para el mismo sessionId) — begin() invalida A
  // automáticamente sin que A se entere todavía.
  const attemptB = tracker.begin()
  assert.equal(attemptB.token, 2, 'B: intento B = token 2')

  // A "resuelve tarde" — su closure comprueba stillCurrent con SU PROPIO
  // token capturado (1), no con el actual del tracker.
  assert.equal(tracker.stillCurrent(attemptA.token), false, 'B: stillCurrent(A) DEBE ser false tras B — A nunca debe poder aplicar su resultado')
  assert.equal(tracker.stillCurrent(attemptB.token), true, 'B: stillCurrent(B) DEBE ser true — B es el intento vigente/autoritativo')

  // Simula el patrón real usado en StudyALAdaptive.tsx: `if (!stillCurrent()) return;`
  // antes de aplicar cualquier estado (blueprint/journey/setBlueprintError/etc).
  let committedByA = false
  let committedByB = false
  function applyResultIfCurrent(token: number, commit: () => void) {
    if (!tracker.stillCurrent(token)) return // A cae aquí — nunca comete nada.
    commit()
  }
  applyResultIfCurrent(attemptA.token, () => { committedByA = true })
  applyResultIfCurrent(attemptB.token, () => { committedByB = true })

  assert.equal(committedByA, false, 'B: A NUNCA debe poder comprometer blueprint/journey/state — resultado tardío descartado')
  assert.equal(committedByB, true, 'B: B SÍ debe poder comprometer su resultado — es el intento autoritativo')
  console.log('generation-attempt-tracker: B (A resuelve tarde, stillCurrent(A)=false, B sigue autoritativo, A nunca comete estado) PASS')
}

// C — begin() aborta el AbortController del intento anterior (el mecanismo
// que evita SEGUIR pagando la SIGUIENTE etapa cara del intento abandonado,
// además del guard de token que protege contra el resultado tardío).
{
  const tracker = new GenerationAttemptTracker()
  const attemptA = tracker.begin()
  assert.equal(attemptA.signal.aborted, false, 'C: signal de A empieza sin abortar')
  const attemptB = tracker.begin()
  assert.equal(attemptA.signal.aborted, true, 'C: al iniciar B, el signal de A debe quedar abortado — evita que A dispare su SIGUIENTE llamada cara')
  assert.equal(attemptB.signal.aborted, false, 'C: el signal de B (el intento vigente) nunca debe abortarse a sí mismo')
  console.log('generation-attempt-tracker: C (begin() aborta el AbortController del intento anterior) PASS')
}

// D — abortCurrent() (cleanup de unmount): aborta sin iniciar un nuevo
// intento — currentToken no cambia.
{
  const tracker = new GenerationAttemptTracker()
  const attempt = tracker.begin()
  tracker.abortCurrent()
  assert.equal(attempt.signal.aborted, true, 'D: abortCurrent debe abortar el signal vigente (cleanup de unmount)')
  assert.equal(tracker.currentToken, 1, 'D: abortCurrent NO debe iniciar un nuevo intento — el token no avanza')
  assert.equal(tracker.stillCurrent(1), true, 'D: tras abortCurrent, el token 1 sigue siendo "vigente" en términos de identidad — solo su red quedó cortada, no reemplazada por otro intento')
  console.log('generation-attempt-tracker: D (abortCurrent corta la red sin iniciar un intento nuevo) PASS')
}

// E — tres intentos consecutivos (A, B, C): solo el ÚLTIMO es autoritativo,
// sin importar en qué orden "resuelvan" A y B tardíamente.
{
  const tracker = new GenerationAttemptTracker()
  const a = tracker.begin()
  const b = tracker.begin()
  const c = tracker.begin()
  assert.deepEqual(
    [tracker.stillCurrent(a.token), tracker.stillCurrent(b.token), tracker.stillCurrent(c.token)],
    [false, false, true],
    'E: de tres intentos consecutivos, únicamente el último (C) debe ser autoritativo, sin importar el orden de resolución de A/B',
  )
  console.log('generation-attempt-tracker: E (3 intentos consecutivos, solo el último autoritativo) PASS')
}

console.log('generation-attempt-tracker-contracts: PASS (GAP C — A tardío nunca sobrescribe a B, probado al nivel de lifecycle/token/AbortController real, sin UI artificial)')
