import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// This is a UI-level backward-compatibility fix — the normalization helper
// lives in the client component (not exported from the route module), so
// this contract statically loads the source and exercises the extracted
// normalization logic via a structural re-implementation check plus source
// assertions, matching the pattern already used by
// repaso-recovery-live-fix-contracts.ts for this same file.

const ui = readFileSync('components/materias/ALAIStudyALRepasar.tsx', 'utf8')

function testNormalizationHelperExists() {
  assert.match(ui, /function normalizeRepasoRecoveryFeedback\(/, 'a dedicated normalization boundary must exist')
  assert.match(ui, /didWell:\s*feedback\.didWell\s*\?\?\s*feedback\.demonstrated\s*\?\?\s*\[\]/)
  assert.match(ui, /needsWork:\s*feedback\.needsWork\s*\?\?\s*feedback\.missing\s*\?\?\s*\[\]/)
  assert.match(ui, /correction:\s*feedback\.correction\s*\?\?\s*\[\]/)
  assert.match(ui, /suggestion:\s*feedback\.suggestion\s*\?\?\s*''/)
  assert.match(ui, /betterExplanation:\s*feedback\.betterExplanation\s*\?\?\s*''/)
  assert.match(ui, /hint:\s*feedback\.hint\s*\?\?\s*''/)
  assert.match(ui, /pages:\s*feedback\.pages\s*\?\?\s*\[\]/)
  assert.match(ui, /summary:\s*feedback\.summary\s*\?\?\s*''/)
}

function testRendererGoesThroughNormalizationNotRawFeedback() {
  const section = ui.slice(ui.indexOf("phase === 'recovery_feedback' && view?.feedback"), ui.indexOf("phase === 'mastery'"))
  assert.match(section, /const feedback = normalizeRepasoRecoveryFeedback\(view\.feedback\)/,
    'the renderer must normalize once at the boundary rather than reading view.feedback.* directly')
  // No raw unguarded `.length` access on the optional new-only fields.
  assert.doesNotMatch(section, /view\.feedback\.didWell/)
  assert.doesNotMatch(section, /view\.feedback\.needsWork/)
  assert.doesNotMatch(section, /view\.feedback\.correction/)
}

function testOptionalFieldsAreOptionalInRawType() {
  const typeSection = ui.slice(ui.indexOf('feedback?: {'), ui.indexOf('/** Render-safe shape'))
  for (const field of ['didWell', 'needsWork', 'correction', 'suggestion', 'betterExplanation', 'hint', 'pages', 'summary']) {
    assert.match(typeSection, new RegExp(`${field}\\?:`), `${field} must be optional in the raw/transport type, not lied about as required`)
  }
  // demonstrated/missing/status/title/score* remain required — legacy
  // feedback always had these.
  assert.match(typeSection, /demonstrated: string\[\]/)
  assert.match(typeSection, /missing: string\[\]/)
}

/* ------------------------------------------------------------------ */
/* Behavioral re-implementation of normalizeRepasoRecoveryFeedback,    */
/* kept in lockstep with the component's own logic via the source      */
/* assertions above, to exercise every legacy/malformed shape without  */
/* needing a DOM/React renderer in this test harness.                  */
/* ------------------------------------------------------------------ */

function normalize(feedback: any) {
  return {
    status: feedback.status,
    title: feedback.title,
    summary: feedback.summary ?? '',
    didWell: feedback.didWell ?? feedback.demonstrated ?? [],
    needsWork: feedback.needsWork ?? feedback.missing ?? [],
    correction: feedback.correction ?? [],
    suggestion: feedback.suggestion ?? '',
    betterExplanation: feedback.betterExplanation ?? '',
    hint: feedback.hint ?? '',
    pages: feedback.pages ?? [],
    scoreBefore: feedback.scoreBefore,
    scoreAfter: feedback.scoreAfter,
    letterBefore: feedback.letterBefore,
    letterAfter: feedback.letterAfter,
    scoreChanged: feedback.scoreChanged,
    groupResolved: feedback.groupResolved,
  }
}

function renderSafe(normalized: ReturnType<typeof normalize>) {
  // Exercises exactly the `.length` accesses the live crash hit.
  void normalized.didWell.length
  void normalized.needsWork.length
  void normalized.correction.length
  return true
}

const legacyPartial = {
  status: 'partial', title: 'Casi lo tienes',
  demonstrated: ['La reacción directa y su ley de velocidad, incluyendo la definición de kf y [N2O4].'],
  missing: ['Falta explicar por qué la velocidad depende únicamente de [N2O4].'],
  scoreBefore: 8, scoreAfter: 10, letterBefore: 'F', letterAfter: 'F', scoreChanged: true, groupResolved: false,
}

function testLegacyPartialFeedback() {
  const normalized = normalize(legacyPartial)
  assert.doesNotThrow(() => renderSafe(normalized), 'legacy partial feedback must never throw on .length access')
  assert.deepEqual(normalized.didWell, legacyPartial.demonstrated, 'demonstrated -> didWell')
  assert.deepEqual(normalized.needsWork, legacyPartial.missing, 'missing -> needsWork')
  assert.deepEqual(normalized.correction, [])
  assert.equal(normalized.suggestion, '')
  assert.equal(normalized.betterExplanation, '', 'legacy data must never fabricate a model explanation')
  assert.equal(normalized.hint, '')
  assert.deepEqual(normalized.pages, [])
  assert.equal(normalized.summary, '')
}

const legacyMissing = {
  status: 'missing', title: 'Vamos a reforzarlo',
  demonstrated: [], missing: [],
  scoreBefore: 8, scoreAfter: 8, letterBefore: 'F', letterAfter: 'F', scoreChanged: false, groupResolved: false,
}

function testLegacyMissingFeedback() {
  const normalized = normalize(legacyMissing)
  assert.doesNotThrow(() => renderSafe(normalized))
  assert.equal(normalized.hint, '', 'no fabricated hint for legacy missing feedback')
  assert.equal(normalized.betterExplanation, '', 'no fabricated answer for legacy missing feedback')
  assert.equal(normalized.scoreChanged, false)
}

const legacyIncorrect = {
  status: 'incorrect', title: 'Todavía no',
  demonstrated: [], missing: ['Confunde Keq con velocidad'],
  scoreBefore: 10, scoreAfter: 4, letterBefore: 'F', letterAfter: 'F', scoreChanged: true, groupResolved: false,
}

function testLegacyIncorrectFeedback() {
  const normalized = normalize(legacyIncorrect)
  assert.doesNotThrow(() => renderSafe(normalized), 'legacy incorrect feedback (no correction field) must never throw')
  assert.deepEqual(normalized.correction, [])
  assert.deepEqual(normalized.needsWork, legacyIncorrect.missing)
}

const richFeedback = {
  status: 'partial', title: 'Casi lo tienes', summary: 'Ya demostraste parte de esto.',
  demonstrated: ['legacy demonstrated ignored when didWell present'],
  missing: ['legacy missing ignored when needsWork present'],
  didWell: ['Concepto A: demostrado bien'],
  needsWork: ['Concepto A: falta profundidad'],
  correction: [],
  suggestion: 'Agrega el detalle que falta.',
  betterExplanation: 'Proposición canónica completa.',
  hint: '',
  pages: [7],
  scoreBefore: 8, scoreAfter: 10, letterBefore: 'F', letterAfter: 'F', scoreChanged: true, groupResolved: false,
}

function testNewRichFeedbackUnchanged() {
  const normalized = normalize(richFeedback)
  assert.deepEqual(normalized.didWell, richFeedback.didWell, 'new didWell must win over legacy demonstrated')
  assert.deepEqual(normalized.needsWork, richFeedback.needsWork, 'new needsWork must win over legacy missing')
  assert.equal(normalized.suggestion, richFeedback.suggestion)
  assert.equal(normalized.betterExplanation, richFeedback.betterExplanation)
  assert.deepEqual(normalized.pages, [7])
  assert.equal(normalized.summary, richFeedback.summary)
}

function testMalformedPartialPayloadIsSafe() {
  // Arrays AND strings entirely omitted (not even present as keys).
  const malformed = {
    status: 'partial', title: 'Casi lo tienes',
    demonstrated: undefined, missing: undefined,
    scoreBefore: 8, scoreAfter: 8, letterBefore: 'F', letterAfter: 'F', scoreChanged: false, groupResolved: false,
  } as any
  const normalized = normalize(malformed)
  assert.doesNotThrow(() => renderSafe(normalized))
  assert.deepEqual(normalized.didWell, [])
  assert.deepEqual(normalized.needsWork, [])
}

function testRestoreReopenPathIsPresent() {
  // The restore effect must be able to carry an old-shaped feedback into
  // recovery_feedback without triggering any new POST/provider call — this
  // is a structural guarantee already provided by readFreeToolState/
  // restoreFeedback wiring; assert that wiring is still intact.
  assert.match(ui, /restoreFeedback = saved\.phase === 'recovery_feedback' && saved\.view\?\.feedback/)
  assert.match(ui, /const restoredView = restoreFeedback \? \{ \.\.\.restored, feedback: saved\.view!\.feedback \} : restored/)
}

function main() {
  testNormalizationHelperExists()
  testRendererGoesThroughNormalizationNotRawFeedback()
  testOptionalFieldsAreOptionalInRawType()
  testLegacyPartialFeedback()
  testLegacyMissingFeedback()
  testLegacyIncorrectFeedback()
  testNewRichFeedbackUnchanged()
  testMalformedPartialPayloadIsSafe()
  testRestoreReopenPathIsPresent()
  console.log('repaso-recovery-feedback-restore-contracts: ALL PASS')
}

main()
