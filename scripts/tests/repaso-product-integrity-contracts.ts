import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRepasoArtifact, buildRepasoStudentEvidencePaper } from '../../lib/materialBrain/repasoArtifact'
import {
  effectiveRepasoPagesToReview,
  isSpecificRepasoRecoveryQuestion,
} from '../../app/api/alai-studyal-repasar/route'

const route = readFileSync('app/api/alai-studyal-repasar/route.ts', 'utf8')
const ui = readFileSync('components/materias/ALAIStudyALRepasar.tsx', 'utf8')
const viewer = readFileSync('components/materias/RepasarViewer.tsx', 'utf8')

assert.ok(route.includes("kind === 'repaso-recovery-open'"))
assert.ok(route.includes("kind === 'repaso-recovery-answer'"))
assert.ok(route.includes("kind === 'repaso-final-open'"))
assert.ok(route.includes("kind === 'repaso-final-answer'"))
assert.ok(route.includes('currentRepasoRecoveryGroup(artifact)'))
assert.ok(route.includes('artifact.recoveryAttempts.find(a => a.attemptId === attemptClientId)'))
assert.ok(route.includes('previewRepasoTransitions({'))
assert.ok(!route.includes("from '../../../lib/materialBrain/build'"), 'new Repaso must not invoke Material Brain build')
assert.ok(!route.includes('buildMaterialBrain('), 'new Repaso must not reanalyze material')

assert.ok(!ui.includes("type ExplainMode"), 'new Repaso has one evaluator voice')
assert.ok(!ui.includes("setMode("), 'new Repaso has no persona selector')
assert.ok(ui.includes('flightRef.current'), 'UI has a single-flight guard')
assert.ok(ui.includes('AbortController'), 'UI aborts stale lifecycle requests')
assert.ok(ui.includes("kind: 'repaso-restore'"), 'reopen restores the durable server artifact')
assert.ok(ui.includes('A LIBRO CERRADO'))
assert.ok(!ui.includes('improvedAnswer'), 'UI never presents a provider-authored answer as student work')

// The product begins in the existing active reader, not in the explanation form.
assert.ok(ui.includes("useState<Phase>('read')"))
assert.ok(ui.includes("phase === 'read'"))
assert.ok(ui.includes('Ya terminé de leer'))
assert.ok(ui.includes("onClick={() => setPhase('explain')}"))
assert.ok(ui.includes('← Volver al material'))
assert.ok(ui.includes('value={explanation}'), 'the explanation draft remains controlled across the reader round trip')

// Recovery reading is a state-only navigation loop: it uses the same frozen view,
// does not call request(), and retains the controlled answer draft.
assert.ok(ui.includes('Revisar estas páginas'))
assert.ok(ui.includes("setPhase('recovery_reading')"))
assert.ok(ui.includes('← Volver a la pregunta'))
assert.ok(ui.includes("setPhase('recovery')"))
assert.ok(ui.includes('value={answer}'))
assert.ok(ui.includes('pageFilter={readerNavigation.selectedPages}'))
assert.ok(ui.includes('currentMaterialId={readerNavigation.materialId}'))
assert.ok(viewer.includes('currentPage?: number | null'))
assert.ok(viewer.includes('pageFilter?: number[]'))

const verificationView = ui.slice(ui.indexOf("phase === 'verification'"), ui.indexOf("phase === 'mastery'"))
assert.ok(!verificationView.includes('RepasarViewer'), 'final verification remains closed book')
assert.ok(!verificationView.includes('pagesToReview'), 'final verification exposes no page hints')
assert.ok(!verificationView.includes('Revisar estas páginas'), 'final verification has no reader shortcut')

const bohrTargets = [{
  id: 'bohr-model', label: 'Modelo atómico de Bohr',
  statement: 'Bohr resolvió la inestabilidad de Rutherford proponiendo órbitas cuantizadas.',
  sourceSpans: [
    { page: 1, quote: 'Niels Bohr' },
    { page: 3, quote: 'Bohr propuso que los electrones ocupan órbitas cuantizadas estables alrededor del núcleo.' },
  ],
}] as any
const bohrGroup = { targetIds: ['bohr-model'], pages: [1, 3] } as any
assert.equal(isSpecificRepasoRecoveryQuestion(
  '¿Cuál es la idea académica principal que se presenta en el contexto?',
  bohrTargets,
), false)
assert.equal(isSpecificRepasoRecoveryQuestion(
  '¿Qué problema del modelo de Rutherford intentó resolver Bohr y qué propuso sobre los electrones?',
  bohrTargets,
), true)
assert.deepEqual(effectiveRepasoPagesToReview(bohrGroup, bohrTargets), [3],
  'substantive grounded spans outrank decorative/title-only associations')

const artifact = createRepasoArtifact({
  artifactId: 'integrity', sessionId: 'session', snapshotId: 'snapshot', fingerprint: 'fingerprint',
  explanation: 'Texto inicial exacto del estudiante', createdAt: '2026-01-01T00:00:00.000Z',
  initialScore: 50, initialLetterGrade: 'F',
  adjudications: [{ targetId: 't1', status: 'covered', evidence: 'evidence', demonstrated: 'demonstrated', missingDetail: '' }],
})
artifact.recoveryAttempts.push({
  attemptId: 'a1', groupId: 'g1', createdAt: '2026-01-02T00:00:00.000Z', answer: 'Respuesta exacta de recuperación',
  requestedTargetIds: ['t2'], adjudicatedTargetIds: ['t2'],
  adjudications: [{ targetId: 't2', status: 'covered', evidence: '', demonstrated: '', missingDetail: '' }],
  transitions: [{ targetId: 't2', before: 'missing', after: 'covered' }],
  scoreBefore: 50, scoreAfter: 100, letterBefore: 'F', letterAfter: 'A+',
})
artifact.finalVerification = {
  verificationId: 'v1', createdAt: '2026-01-03T00:00:00.000Z', passed: true,
  checks: [{
    checkId: 'c1', targetIds: ['t1'], question: 'Q', questionProvenance: 'provider',
    studentAnswer: 'Respuesta exacta de verificación', adjudicatedTargetIds: ['t1'],
    adjudications: [], transitions: [], status: 'passed', attemptId: 'v-a1',
  }],
}
const paper = buildRepasoStudentEvidencePaper(artifact)
assert.deepEqual(paper.map(section => section.text), [
  'Texto inicial exacto del estudiante',
  'Respuesta exacta de recuperación',
  'Respuesta exacta de verificación',
])
assert.ok(paper.every(section => /Explicación inicial|Recuperado en pregunta|Confirmado en verificación final/.test(section.provenance)))

console.log('repaso-product-integrity-contracts: ALL PASS')
