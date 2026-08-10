import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildRegisterInstruction } from '../../app/api/adaptive/session-reteach/route'

// PROBLEMA PEDAGÓGICO 5 (prueba humana real): la reexplicación usaba
// analogías genéricas ("bolsa de caramelos", "equipo de fútbol") como
// registro por defecto, sin importar el perfil real del estudiante — aunque
// StudyAL ya conoce AdaptiveSetup.knowledgeLevel/mainConcern (disponibles en
// el cliente), ese dato nunca llegaba a session-reteach. Causa raíz real
// (auditada antes de tocar código): la reexplicación EFECTIVAMENTE mostrada
// al usuario sale del campo "explanation" del combinedPrompt (la rama
// includeVerificationQuestions===true, que es la ÚNICA que page.tsx invoca
// en producción — confirmado: page.tsx solo tiene un fetch a session-reteach
// y siempre envía includeVerificationQuestions:true). La rama "Reteach
// simple" más abajo en el mismo archivo, con su propio prompt separado,
// nunca se alcanza desde el cliente real — cualquier fix que solo tocara esa
// rama no habría cambiado nada visible. Fix: pasar un studentProfile
// genérico (knowledgeLevel/mainConcern, ya existentes en AdaptiveSetup, sin
// inventar ningún campo nuevo) y usarlo como SEÑAL en AMBOS prompts —
// especialmente el combinedPrompt, que es el que realmente se ejecuta.

function testPageSendsStudentProfileToSessionReteach() {
  const source = readFileSync("app/materias/[temaId]/sesion/[sessionNumber]/page.tsx", 'utf8')
  assert.match(
    source,
    /studentProfile:\s*sessionData\?\.adaptiveSetup/,
    'page.tsx debe enviar studentProfile (derivado de AdaptiveSetup ya existente) al llamar a session-reteach',
  )
}

function testCombinedPromptTheOnlyLiveOneUsesRegisterInstruction() {
  const source = readFileSync('app/api/adaptive/session-reteach/route.ts', 'utf8')
  const combinedPromptStart = source.indexOf('const combinedPrompt = ')
  const combinedPromptEnd = source.indexOf('"questions": [ { pregunta 1 }, { pregunta 2 } ]')
  assert.ok(combinedPromptStart > -1 && combinedPromptEnd > combinedPromptStart, 'debe existir combinedPrompt (la única rama que page.tsx invoca realmente)')
  const combinedPromptSource = source.slice(combinedPromptStart, combinedPromptEnd)
  assert.match(
    combinedPromptSource,
    /buildRegisterInstruction\(studentProfile\)/,
    'BUG DE ORIGEN SI FALLA: combinedPrompt (la rama REALMENTE ejecutada por el cliente) debe incluir la instrucción de registro — no basta con tocar la rama "Reteach simple", que nunca se alcanza desde producción',
  )
}

function testBuildRegisterInstructionNeverHardcodesASpecificProfile() {
  const source = readFileSync('app/api/adaptive/session-reteach/route.ts', 'utf8')
  const fnStart = source.indexOf('function buildRegisterInstruction')
  const fnEnd = source.indexOf('\n}', fnStart)
  const fnSource = source.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnSource, /universitario|medicina|carrera\s*===|knowledgeLevel\s*===\s*['"](?!string['"])/i, 'NO debe hardcodear ningún perfil/carrera/nivel específico — la decisión de registro es del LLM, informada por el dato real')
  assert.match(fnSource, /knowledgeLevel/i)
}

// ═══ Contrato funcional del helper, importado directamente (misma función que ejecuta el prompt real) ═══
function testHelperReturnsEmptyWithoutProfile() {
  assert.equal(buildRegisterInstruction(null), '')
  assert.equal(buildRegisterInstruction(undefined), '')
  assert.equal(buildRegisterInstruction({}), '')
}

function testHelperIncludesRealProfileSignalsVerbatim() {
  const instruction = buildRegisterInstruction({ knowledgeLevel: 'already_know', mainConcern: 'Estudio medicina y necesito precisión clínica' })
  assert.match(instruction, /already_know/, 'debe incluir el nivel declarado real, no una categoría inventada')
  assert.match(instruction, /Estudio medicina y necesito precisión clínica/, 'debe incluir el contexto real del estudiante tal cual lo escribió')
  assert.doesNotMatch(instruction, /bolsa de caramelos|equipo de fútbol/i, 'no debe fijar ninguna analogía específica como obligatoria')
}

function testHelperWorksWithPartialProfile() {
  const onlyLevel = buildRegisterInstruction({ knowledgeLevel: 'never_seen' })
  assert.match(onlyLevel, /never_seen/)
  const onlyConcern = buildRegisterInstruction({ mainConcern: 'Voy a repasar para un examen técnico' })
  assert.match(onlyConcern, /examen técnico/)
}

testPageSendsStudentProfileToSessionReteach()
testCombinedPromptTheOnlyLiveOneUsesRegisterInstruction()
testBuildRegisterInstructionNeverHardcodesASpecificProfile()
testHelperReturnsEmptyWithoutProfile()
testHelperIncludesRealProfileSignalsVerbatim()
testHelperWorksWithPartialProfile()

console.log('reteach-register-personalization-contracts: PASS (perfil real llega al prompt REALMENTE ejecutado, sin hardcodear ningún registro)')
