import assert from 'node:assert/strict'
import { safeParseJson } from '../../lib/alai'
import { runGenerationPipeline } from '../../lib/ai/generationPipeline'

// ============================================================
// Repasar P0 — real production bug: "Di lo que sabes" stayed in
// "analizando…" for ~89s and then 500'd with GENERATION_BUDGET_EXHAUSTED:
// INVALID_JSON after 6 provider attempts (1 normal + 2 format_repair + 2
// targeted_repair(academic) + 1 simplified).
//
// Root cause (see app/api/alai-studyal-repasar/route.ts:683-686 and
// lib/ai/generationPipeline.ts): the analysis prompt requires ONE
// targetCoverage entry PER MATERIAL TARGET (unbounded cardinality) plus
// conceptStatus/repair/feedback, but was capped at maxTokens:3000 — for a
// real multi-page material this truncates mid-JSON on every attempt
// (INVALID_JSON is a transport/format defect, not an academic one), and
// the generic STAGES loop marched through 'targeted_repair' (academic
// repair) twice anyway, which cannot fix a syntax error — pure waste.
//
// These contracts test the two concrete fixes directly at their real
// seams: safeParseJson (lib/alai.ts, extraction robustness) and
// runGenerationPipeline (lib/ai/generationPipeline.ts, failure-class
// routing) — both used by generateValidatedLegacyJson exactly as Repasar
// calls it. Provider network calls (`alai()`) are not mockable at a test
// seam, so `generate()` is the same injection point Repasar's own
// pipeline uses — mirroring the real parse-then-decide composition in
// lib/ai/legacyRouteGeneration.ts:74-115 without touching real network.
// ============================================================

function fakeValidate(value: any) {
  const errors: string[] = []
  if (!Number.isFinite(Number(value?.score))) errors.push('STRUCTURAL_VALIDATION_FAILED:review_score')
  if (!String(value?.feedback || '').trim()) errors.push('STRUCTURAL_VALIDATION_FAILED:review_feedback')
  return { valid: errors.length === 0, errors }
}

// Mirrors legacyRouteGeneration.ts's generate() composition: parse the
// "provider text" via safeParseJson, throw INVALID_JSON on failure.
function makeGenerateFromTexts(texts: string[]) {
  let call = 0
  return async () => {
    const text = texts[Math.min(call, texts.length - 1)]
    call++
    const parsed = safeParseJson(text)
    if (parsed === null) throw new Error('INVALID_JSON')
    return { value: parsed, provider: 'openrouter', model: 'google/gemini-2.5-flash' }
  }
}

const VALID_PAYLOAD = { score: 80, feedback: 'Bien hecho.' }

async function testJson1ValidJsonOneCall() {
  const generate = makeGenerateFromTexts([JSON.stringify(VALID_PAYLOAD)])
  const result = await runGenerationPipeline({
    taskType: 'summary',
    generate,
    validate: value => fakeValidate(value),
  })
  assert.equal(result.status, 'validated')
  assert.equal(result.attempts.length, 1, 'REPASAR-JSON-1: valid JSON must succeed on the first call')
  console.log('REPASAR-JSON-1 PASS — provider returns valid JSON -> 1 call -> success')
}

async function testJson2FencedRecovery() {
  const fenced = '```json\n' + JSON.stringify(VALID_PAYLOAD) + '\n```'
  const generate = makeGenerateFromTexts([fenced])
  const result = await runGenerationPipeline({
    taskType: 'summary',
    generate,
    validate: value => fakeValidate(value),
  })
  assert.equal(result.status, 'validated')
  assert.equal(result.attempts.length, 1, 'REPASAR-JSON-2: fenced JSON must be recovered locally, no extra provider call')
  assert.equal((result.content as any).score, 80)
  console.log('REPASAR-JSON-2 PASS — ```json fenced JSON -> local recovery -> 1 call')
}

async function testJson3ProseWrappedRecovery() {
  const wrapped = `Claro, aquí está mi análisis:\n${JSON.stringify(VALID_PAYLOAD)}\nEspero que ayude.`
  const generate = makeGenerateFromTexts([wrapped])
  const result = await runGenerationPipeline({
    taskType: 'summary',
    generate,
    validate: value => fakeValidate(value),
  })
  assert.equal(result.status, 'validated')
  assert.equal(result.attempts.length, 1, 'REPASAR-JSON-3: prose + one embedded JSON object must be recovered locally, no extra provider call')
  console.log('REPASAR-JSON-3 PASS — prose + single embedded JSON object -> local recovery -> 1 call')
}

async function testJson4BoundedFailure() {
  // Irrecoverable on every attempt: truncated mid-object (unbalanced
  // braces) — safeParseJson can never recover this locally, no matter
  // how many times it's retried, because the text is genuinely incomplete.
  const truncated = '{"score": 80, "feedback": "Bien hecho pero le faltó much'
  const generate = makeGenerateFromTexts([truncated])
  const result = await runGenerationPipeline({
    taskType: 'summary',
    generate,
    validate: value => fakeValidate(value),
  })
  assert.equal(result.status, 'budget_exhausted')
  const stages = result.attempts.map(a => a.stage)
  assert.ok(!stages.includes('targeted_repair'), 'REPASAR-JSON-4: pure INVALID_JSON must never reach targeted_repair (academic repair)')
  // normal(1) + format_repair(2, budgeted) + simplified(1) = 4, never 6
  assert.ok(result.attempts.length <= 4, `REPASAR-JSON-4: bounded budget expected <=4 attempts, got ${result.attempts.length}`)
  console.log(`REPASAR-JSON-4 PASS — irrecoverable malformed output -> ${result.attempts.length} bounded attempts (stages: ${stages.join(',')}), controlled failure`)
}

async function testJson5NeverEntersAcademicRepair() {
  const truncated = '{"score": 80, "feedback": "incompl'
  const generate = makeGenerateFromTexts([truncated])
  const result = await runGenerationPipeline({
    taskType: 'summary',
    generate,
    validate: value => fakeValidate(value),
  })
  assert.ok(!result.repairsApplied.includes('targeted_repair'), 'REPASAR-JSON-5: pure INVALID_JSON must never trigger academic/targeted repair')
  console.log('REPASAR-JSON-5 PASS — pure INVALID_JSON never enters academic repair')
}

async function testJson_academicFailureStillGetsTargetedRepair() {
  // Control test: a genuinely academic/content failure (parseable JSON,
  // schema-invalid — missing required "feedback") MUST still reach
  // targeted_repair — proves the fix is a precise, scoped skip and not a
  // blanket removal of academic repair for every failure class.
  const missingFeedback = JSON.stringify({ score: 80 })
  const generate = makeGenerateFromTexts([missingFeedback, missingFeedback, missingFeedback, missingFeedback, missingFeedback, missingFeedback])
  const result = await runGenerationPipeline({
    taskType: 'summary',
    generate,
    validate: value => fakeValidate(value),
  })
  const stages = result.attempts.map(a => a.stage)
  assert.ok(stages.includes('targeted_repair'), 'a genuine schema/content failure (not INVALID_JSON) must still be eligible for targeted_repair')
  console.log('REPASAR-JSON-5b PASS — a genuine schema-invalid (non-JSON) failure still reaches targeted_repair — the skip is failure-class-scoped, not global')
}

async function testSafeParseJsonExtraction() {
  assert.deepEqual(safeParseJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(safeParseJson('```JSON\n{"a":1}\n```'), { a: 1 }, 'fence marker must be matched case-insensitively')
  assert.deepEqual(safeParseJson('here is the result: {"a":1} thanks!'), { a: 1 })
  assert.deepEqual(safeParseJson('{"a":1}\n\ntrailing commentary with a stray { brace'), { a: 1 },
    'a stray unbalanced brace AFTER the real object must not corrupt extraction')
  assert.equal(safeParseJson('{"a": "incomple'), null, 'a genuinely truncated object must not be fabricated as valid')
  assert.deepEqual(safeParseJson('﻿{"a":1}'), { a: 1 }, 'BOM must be stripped')
  console.log('REPASAR-JSON-EXTRACT PASS — fences (case-insensitive), prose-wrapped, trailing-brace, BOM all handled deterministically')
}

async function testJson6And7And8ClientStateMachine() {
  // New Repaso uses one shared request single-flight for every phase.
  const source = require('node:fs').readFileSync('components/materias/ALAIStudyALRepasar.tsx', 'utf8') as string
  assert.match(source, /if \(!sessionId \|\| flightRef\.current\) return null/,
    'REPASAR-JSON-8: an in-flight request must block a second submit')
  assert.match(source, /finally \{[\s\S]{0,160}flightRef\.current = null[\s\S]{0,80}setBusy\(false\)/,
    'REPASAR-JSON-6: busy must be cleared in a finally block regardless of success/error/abort')
  assert.match(source, /catch \(cause\) \{\s*\n\s*if \(!controller\.signal\.aborted\) setError\(/,
    'REPASAR-JSON-6: an error path must set a recoverable error state, never leave the UI silently spinning')
  const catchBlock = source.match(/catch \(cause\) \{([\s\S]*?)\n\s*return null/)?.[1] || ''
  assert.ok(!catchBlock.includes('request('), 'REPASAR-JSON-7: errors must not auto-resubmit')
  console.log('REPASAR-JSON-6/7/8 PASS — analyzing always clears via finally, no auto-resubmit, double-submit blocked while in flight')
}

async function testEvaluatorMode(mode: 'nino' | 'universitario' | 'profesor' | 'libre', label: string) {
  const payload = { score: 72, feedback: `Feedback para modo ${mode}.`, conceptStatus: [] }
  const generate = makeGenerateFromTexts([JSON.stringify(payload)])
  const result = await runGenerationPipeline({
    taskType: 'summary',
    generate,
    validate: value => fakeValidate(value),
    telemetry: () => {},
  })
  assert.equal(result.status, 'validated', `${label} evaluator must complete correctly`)
  assert.equal((result.content as any).feedback, `Feedback para modo ${mode}.`)
  console.log(`REPASAR-EVAL-${label} PASS — ${mode} evaluator produces a valid result through the same pipeline`)
}

async function testEnjoyerRestoreNeverRegenerates() {
  const source = require('node:fs').readFileSync('app/api/alai-studyal-repasar/route.ts', 'utf8') as string
  assert.match(source, /lookupStudyalMaterialEnjoyer/)
  assert.doesNotMatch(source, /getOrCreateStudyalMaterialEnjoyer|restoreMaterialBrain|getOrBuildProductionBrain|resolveMaterialCapabilities/)
  console.log('REPASAR-ENJOYER-1 PASS — evaluation performs lookup-only Enjoyer restore, never Brain build or Enjoyer regeneration')
}

async function main() {
  await testJson1ValidJsonOneCall()
  await testJson2FencedRecovery()
  await testJson3ProseWrappedRecovery()
  await testJson4BoundedFailure()
  await testJson5NeverEntersAcademicRepair()
  await testJson_academicFailureStillGetsTargetedRepair()
  await testSafeParseJsonExtraction()
  await testJson6And7And8ClientStateMachine()
  await testEvaluatorMode('nino', '1')
  await testEvaluatorMode('universitario', '2')
  await testEvaluatorMode('profesor', '3')
  await testEvaluatorMode('libre', '4')
  await testEnjoyerRestoreNeverRegenerates()
  console.log('repasar-json-recovery-contracts: ALL PASS')
}

main().catch(err => { console.error(err); process.exit(1) })
