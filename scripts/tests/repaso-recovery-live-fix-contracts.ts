import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildRepasoRecoveryQuestionGrounding,
  effectiveRepasoPagesToReview,
  isRepasoRecoveryQuestionSupported,
  projectRepasoRecoveryFeedback,
} from '../../app/api/alai-studyal-repasar/route'
import { createActiveReaderNavigation, moveRepasoReader, openRecoveryReader } from '../../lib/repasoReaderNavigation'

const ui = readFileSync('components/materias/ALAIStudyALRepasar.tsx', 'utf8')
const route = readFileSync('app/api/alai-studyal-repasar/route.ts', 'utf8')
const viewer = readFileSync('components/materias/RepasarViewer.tsx', 'utf8')

const selectedPages = Array.from({ length: 12 }, (_, index) => index + 1)
const active = createActiveReaderNavigation({ materialId: 'chem', selectedPages })
const recovery = openRecoveryReader(active, {
  materialId: 'chem', selectedPages, recommendedPages: [7], recoveryGroupId: 'g-keq',
})
assert.equal(recovery.currentPage, 7)
assert.deepEqual(recovery.selectedPages, selectedPages)
assert.deepEqual(recovery.recommendedPages, [7])
assert.equal(moveRepasoReader(recovery, 8).currentPage, 8)
assert.equal(moveRepasoReader(recovery, 6).currentPage, 6)
assert.ok(ui.includes('recommendedPages={readerNavigation.recommendedPages}'))
assert.ok(viewer.includes('recommendedPages.includes(item)'))

const targets = [{
  id: 'keq', label: 'Constante de equilibrio Keq', statement: 'Keq puede relacionarse con kf y kr.',
  sourceSpans: [
    { page: 7, quote: 'Equilibrio químico' },
    { page: 8, quote: 'La constante de equilibrio Keq caracteriza la composición del sistema cuando alcanza el equilibrio.' },
  ],
  sourceOrder: 1,
}] as any
const group = { targetIds: ['keq'], pages: [7, 8] } as any
const grounding = buildRepasoRecoveryQuestionGrounding(group, targets)
assert.deepEqual(grounding.targetIds, ['keq'])
assert.deepEqual(grounding.recommendedPages, [8])
assert.deepEqual(effectiveRepasoPagesToReview(group, targets), [8])
assert.equal(isRepasoRecoveryQuestionSupported('¿Qué caracteriza la constante de equilibrio Keq?', grounding), true)
assert.equal(isRepasoRecoveryQuestionSupported('¿Cómo se relaciona Keq con kf y kr?', grounding), false)
const relationGrounding = buildRepasoRecoveryQuestionGrounding(group, [{ ...targets[0], sourceSpans: [{
  page: 9, quote: 'En este tratamiento, la relación Keq = kf / kr conecta la constante de equilibrio con ambas constantes de velocidad.',
}] }] as any)
assert.equal(isRepasoRecoveryQuestionSupported('¿Cómo se relaciona Keq con kf y kr?', relationGrounding), true)
assert.equal(isRepasoRecoveryQuestionSupported('¿Cómo se relaciona Keq con kf y kr?', {
  targetIds: ['keq'], targets: [{ ...targets[0], sourceSpans: [] }], recommendedPages: [], evidenceText: '',
}), false)
assert.ok(route.includes('isRepasoRecoveryQuestionSupported(question, grounding)'))

const baseAttempt = {
  attemptId: 'a', groupId: 'g', createdAt: 'now', answer: 'student answer',
  requestedTargetIds: ['t1'], adjudicatedTargetIds: ['t1'], transitions: [],
  scoreBefore: 6, scoreAfter: 11, letterBefore: 'F', letterAfter: 'F',
} as any
const feedback = (adjudications: any[], scoreAfter = 11) => projectRepasoRecoveryFeedback({ ...baseAttempt, scoreAfter, adjudications })
const correct = feedback([{ targetId: 't1', status: 'covered', evidence: 'texto exacto', demonstrated: 'Comprendió Keq', missingDetail: '' }])
assert.equal(correct.status, 'correct'); assert.equal(correct.groupResolved, true)
const partial = feedback([{ targetId: 't1', status: 'partial', evidence: 'texto parcial', demonstrated: 'Reconoció el equilibrio', missingDetail: 'Falta explicar la constante' }])
assert.equal(partial.status, 'partial'); assert.deepEqual(partial.demonstrated, ['t1: Reconoció el equilibrio']); assert.deepEqual(partial.missing, ['t1: Falta explicar la constante'])
assert.equal(feedback([{ targetId: 't1', status: 'incorrect', evidence: 'afirmación errónea', demonstrated: '', missingDetail: 'Confunde Keq con velocidad' }]).status, 'incorrect')
const missing = feedback([{ targetId: 't1', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' }], 6)
assert.equal(missing.status, 'missing'); assert.deepEqual(missing.demonstrated, []); assert.equal(missing.scoreChanged, false)
assert.ok(ui.includes('Vamos a reforzarlo. Revisa el material y vuelve a intentarlo.'))
const feedbackProjection = route.slice(route.indexOf('export function projectRepasoRecoveryFeedback'), route.indexOf('function normalizedQuestionText'))
assert.ok(!feedbackProjection.includes('generateValidatedLegacyJson'))

const submitSection = ui.slice(ui.indexOf('const submitRecovery'), ui.indexOf('const continueAfterRecoveryFeedback'))
assert.ok(submitSection.includes("setPhase('recovery_feedback')"))
assert.ok(!submitSection.includes('openRecovery()'))
assert.ok(ui.includes('Intentar de nuevo'))
assert.ok(ui.includes('Volver a estudiar'))
assert.ok(ui.includes('continueAfterRecoveryFeedback'))
assert.ok(ui.includes('scoreChanged ?'))
const verificationView = ui.slice(ui.indexOf("phase === 'verification'"), ui.indexOf("phase === 'mastery'"))
assert.ok(!verificationView.includes('RepasarViewer'))
assert.ok(!verificationView.includes('recommendedPages'))

console.log('repaso-recovery-live-fix-contracts: ALL PASS')
