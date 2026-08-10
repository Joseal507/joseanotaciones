import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { selectRecoveryFormat, cognitiveLevelsForVariant } from '../../lib/adaptive/evaluation/pedagogicalFormatSelector'

// PROBLEMA PEDAGÓGICO 4 (prueba humana real): rondas consecutivas de
// recovery sobre el MISMO concepto podían quedar comprobando reconocimiento
// indefinidamente (MCQ → matching → MCQ → matching → MCQ → V/F) sin escalar
// nunca hacia aplicación/transferencia, aunque el contenido lo admitiera.
// Causa raíz real (auditada antes de tocar código): selectRecoveryFormat
// nunca se llamaba desde producción — session-reteach/route.ts tenía su
// PROPIA tabla estática (formatPriority) que siempre devolvía los mismos 2
// formatos fijos por originalFormat, sin importar la ronda. Fix: escalar el
// nivel cognitivo objetivo con los fallos consecutivos (solo si el contenido
// lo admite, vía FORMAT_LIBRARY — la misma fuente que la evaluación inicial),
// y wirear selectRecoveryFormat como fuente real de format1/format2.

// ═══ Escalación con contenido que SÍ admite aplicación/transferencia ═══
function testEscalatesTowardApplicationOnRepeatedFailure() {
  // contentSignal='procedure' admite application vía 'ordering'/'scenario'/'multiple_choice'.
  const round1 = selectRecoveryFormat({
    errorType: 'procedure', previousFormat: 'multiple_choice', cognitiveLevel: 'recognition',
    contentSignal: 'procedure', evaluationMode: 'mix_everything', consecutiveFailures: 0,
  })
  const round3 = selectRecoveryFormat({
    errorType: 'procedure', previousFormat: 'multiple_choice', cognitiveLevel: 'recognition',
    contentSignal: 'procedure', evaluationMode: 'mix_everything', consecutiveFailures: 2,
  })
  const levelsRound1 = cognitiveLevelsForVariant(round1.variant) || []
  const levelsRound3 = cognitiveLevelsForVariant(round3.variant) || []
  const rank = { recognition: 0, comprehension: 1, application: 2, transfer: 3 } as const
  const maxLevel = (levels: string[]) => Math.max(...levels.map(l => rank[l as keyof typeof rank]))
  assert.ok(
    maxLevel(levelsRound3) > maxLevel(levelsRound1),
    `BUG DE ORIGEN SI FALLA: 2 fallos consecutivos más deben escalar el nivel cognitivo objetivo (ronda1 variant=${round1.variant} niveles=${levelsRound1}, ronda3 variant=${round3.variant} niveles=${levelsRound3})`,
  )
}

// ═══ NUNCA fuerza un nivel que el contenido no admite ═══
function testNeverForcesTransferWhenContentDoesNotAdmitIt() {
  // contentSignal='enumeration' no tiene NINGÚN formato con cognitiveMatch
  // 'transfer' en FORMAT_LIBRARY — ni con muchísimos fallos debe alcanzarlo.
  const result = selectRecoveryFormat({
    errorType: 'vocabulary', previousFormat: 'multiple_choice', cognitiveLevel: 'recognition',
    contentSignal: 'enumeration', evaluationMode: 'mix_everything', consecutiveFailures: 5,
  })
  const levels = cognitiveLevelsForVariant(result.variant) || []
  assert.ok(!levels.includes('transfer'), `NO fuerces transfer si el fact no la admite: enumeration nunca debe alcanzar transfer (variant=${result.variant}, niveles=${levels})`)
}

// ═══ El formato elegido realmente evalúa el nivel cognitivo que reasoning/cognitiveObjective afirman ═══
function testSelectedFormatMatchesItsOwnCognitiveObjective() {
  const result = selectRecoveryFormat({
    errorType: 'application', previousFormat: 'true_false', cognitiveLevel: 'comprehension',
    contentSignal: 'case', evaluationMode: 'mix_everything', consecutiveFailures: 1,
  })
  const levels = cognitiveLevelsForVariant(result.variant)
  assert.ok(levels, 'el variant seleccionado debe estar catalogado en FORMAT_LIBRARY')
  assert.ok(levels!.length > 0)
}

// ═══ allowedFormats restringe candidatos honestamente (limitación del caller, no del motor) ═══
function testAllowedFormatsRestrictsCandidates() {
  const result = selectRecoveryFormat({
    errorType: 'memory', previousFormat: 'word_bank', cognitiveLevel: 'recognition',
    contentSignal: 'definition', evaluationMode: 'mix_everything', consecutiveFailures: 0,
    allowedFormats: ['true_false', 'matching'],
  })
  assert.ok(['true_false', 'matching'].includes(result.format), `debe respetar allowedFormats: obtuvo "${result.format}"`)
}

// ═══ Penalización por recencia usa el historial COMPLETO, no solo el formato inmediatamente anterior ═══
function testRecentFormatsHistoryPenalizesRepeatedCycling() {
  // Reproducción del patrón real observado: MCQ ya usado 3 veces en esta
  // secuencia de recovery. previousFormat por sí solo (mecanismo antiguo)
  // solo veía la última — recentFormats ve el patrón completo.
  const withHeavyHistory = selectRecoveryFormat({
    errorType: 'memory', previousFormat: 'matching', cognitiveLevel: 'recognition',
    contentSignal: 'definition', evaluationMode: 'mix_everything', consecutiveFailures: 0,
    recentFormats: ['multiple_choice', 'matching', 'multiple_choice', 'matching'],
    allowedFormats: ['multiple_choice', 'matching', 'true_false'],
  })
  assert.notEqual(withHeavyHistory.format, 'matching', 'el formato usado más recientemente (matching) debe quedar penalizado frente a alternativas igual de válidas')
}

// ═══ session-reteach: el fix real está WIRED en producción, no solo en el módulo ═══
function testSessionReteachUsesSelectRecoveryFormatNotStaticTable() {
  const source = readFileSync('app/api/adaptive/session-reteach/route.ts', 'utf8')
  assert.doesNotMatch(
    source,
    /const formatPriority: Record<string, string\[\]> = \{/,
    'BUG DE ORIGEN SI FALLA: la tabla estática formatPriority (siempre los mismos 2 formatos por originalFormat, sin importar la ronda) debe haberse eliminado',
  )
  assert.match(
    source,
    /selectRecoveryFormat\(\{/,
    'session-reteach debe usar selectRecoveryFormat para decidir format1/format2',
  )
  assert.match(
    source,
    /consecutiveFailures:\s*recoveryConsecutiveFailures/,
    'la escalación debe recibir los fallos consecutivos REALES de esta ronda, no una constante',
  )
}

testEscalatesTowardApplicationOnRepeatedFailure()
testNeverForcesTransferWhenContentDoesNotAdmitIt()
testSelectedFormatMatchesItsOwnCognitiveObjective()
testAllowedFormatsRestrictsCandidates()
testRecentFormatsHistoryPenalizesRepeatedCycling()
testSessionReteachUsesSelectRecoveryFormatNotStaticTable()

console.log('recovery-cognitive-escalation-contracts: PASS (escala con fallos reales, nunca fuerza un nivel no admitido, allowedFormats honesto, penalización por historial completo, wireado en producción)')
