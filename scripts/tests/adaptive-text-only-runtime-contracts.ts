import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { classifyPersistedAdaptiveProgram, mayGenerateAfterRestore } from '../../lib/adaptive/programRestore'
import { normalizeAssessmentObjective } from '../../lib/adaptive/evaluation/assessmentBlueprint'

const runtimeFiles = [
  'app/api/adaptive/session-teach/route.ts',
  'app/api/adaptive/session-check/route.ts',
  'app/materias/[temaId]/sesion/[sessionNumber]/page.tsx',
  'lib/ai/sessionPreparationFactory.ts',
  'lib/adaptive/evaluation/questionContract.ts',
  'lib/adaptive/evaluation/sessionEvaluation.ts',
]
const forbidden = /VisualRenderer|visualSpec|visualRequirement|visualEvidenceKind|visualBlockIds|visualBlocks|visual-check/
for (const file of runtimeFiles) assert.doesNotMatch(readFileSync(file, 'utf8'), forbidden, `${file} no debe depender del runtime visual`)
assert.equal(existsSync('app/api/adaptive/visual-check/route.ts'), false, 'visual-check no debe ser una ruta funcional')

const validProgram = {
  id: 'restore', adaptiveSetup: { completedAt: 1 }, blueprint: { version: 1 },
  journey: { chapters: [{ chapterNumber: 1 }] },
} as any
assert.equal(classifyPersistedAdaptiveProgram(validProgram), 'FOUND_VALID_PROGRAM')
assert.equal(mayGenerateAfterRestore(classifyPersistedAdaptiveProgram(validProgram)), false)
assert.equal(classifyPersistedAdaptiveProgram({ id: 'partial', adaptiveState: 'generating' } as any), 'FOUND_PARTIAL_PROGRAM')
assert.equal(classifyPersistedAdaptiveProgram(null), 'NOTHING_EXISTS')

const restoredObjective = normalizeAssessmentObjective({
  objectiveId: 'o1', sessionId: 's', stepId: 'step', microId: 'm', factKeys: ['f1'],
  demonstratedFactKeys: [], requiredEvidenceKind: 'visual_construction',
})
assert.ok(restoredObjective)
assert.equal('requiredEvidenceKind' in restoredObjective!, false, 'metadata visual legacy debe ignorarse al restaurar mastery')

console.log('adaptive-text-only-runtime-contracts: 10/10 PASS')
