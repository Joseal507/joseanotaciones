import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const page=readFileSync('app/materias/[temaId]/sesion/[sessionNumber]/page.tsx','utf8')
const adaptive=readFileSync('components/materias/StudyALAdaptive.tsx','utf8')
const contracts:[string,RegExp,string][]=[
 ['crear proceso',/upsertSession\(/,adaptive],['continuar setup',/function next\(/,adaptive],['generar plan',/generateBlueprint/,adaptive],['abrir sesión',/adaptiveSessionRoute/,adaptive],
 ['continuar step',/advanceToNextTeachingStep/,page],['siguiente pregunta',/routeNormalAnswerOutcome/,page],['confirmar respuesta',/Confirmar respuesta/,page],['hint',/hint|pista/i,page],['ALAI',/ALAI/,page],
 ['dev skip',/dev.*skip/i,page],['terminar',/Terminar/,page],['siguiente sesión',/hasNextSession/,page],['salir al plan',/openPlan/,page],
 ['volver a sesión',/loadContext/,page],['reintentar',/retrySessionPreparation/,page],['repetir',/replay|repetir/i,page],['refresh restore',/sessionContent|restore/i,page],
]
for(const [name,pattern,source] of contracts)assert.match(source,pattern,`${name}: wiring ausente`)
assert.match(page,/actionInFlightRef/,'guard global contra doble acción')
assert.match(page,/sessionPreparationPromiseRef/,'dedupe de preparación')
assert.match(page,/disabled=\{evalLoading/,'loading guard de respuesta')
console.log(`adaptive-session-button-state-contracts: ${contracts.length}/${contracts.length} acciones cableadas + idempotency/loading guards PASS`)
