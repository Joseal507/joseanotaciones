// ═══════════════════════════════════════════════════════════════
// REPORT — Agrega métricas y genera output
// ═══════════════════════════════════════════════════════════════

import type { SimulationRunResult, SimulationReport, StudentProfileId } from './types'
import type { StudentProfileSegment, SegmentMetrics } from './types'
import { ACCEPTANCE_PROFILE_IDS, ACCEPTANCE_PROFILE_NAMES } from './studentProfiles'
import type { AssistanceLevel } from '../../../lib/adaptive/v3/engine/confidenceTracker'
import * as fs from 'fs'
import * as path from 'path'

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m', blue: '\x1b[34m',
}

export function aggregateResults(results: SimulationRunResult[]): SimulationReport {
  const total = results.length
  const programComplete = results.filter(r => r.outcome === 'program_complete').length
  const sessionCompleteOnly = results.filter(r => r.outcome === 'session_complete_program_pending').length
  const validIncomplete = results.filter(r => r.outcome === 'valid_incomplete').length
  const invariantFailures = results.filter(r => r.invariantFailures.length > 0).length
  const loopFailures = results.filter(r => r.outcome === 'invalid_loop').length
  const restoreDivergences = results.reduce((s, r) => s + r.restoreDivergences, 0)
  const falseMasteryCases = results.reduce((s, r) => s + r.falseMasteryCount, 0)

  // Sesiones promedio a mastery por perfil
  const byProfile: Record<string, number[]> = {}
  for (const r of results) {
    if (!byProfile[r.profileId]) byProfile[r.profileId] = []
    byProfile[r.profileId].push(r.sessionCount)
  }
  const avgSessionsToMastery = {} as Record<StudentProfileId, number>
  for (const [profileId, counts] of Object.entries(byProfile)) {
    avgSessionsToMastery[profileId as StudentProfileId] =
      Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10
  }

  // Turns promedio por micro
  const avgTurnsPerMicro = results.length > 0
    ? Math.round(results.reduce((s, r) => s + (r.totalTurns / Math.max(1, r.totalMicros)), 0) / results.length * 10) / 10
    : 0

  const avgVirtualDurationMs = results.length > 0
    ? results.reduce((s, r) => s + r.virtualDurationMs, 0) / results.length
    : 0
  const maxTurnsPerMicro = results.reduce((max, result) => Math.max(max, result.maxTurnsOnSingleMicro), 0)
  const maxConsecutiveTeachingTurns = results.reduce((max, result) => Math.max(max, result.maxConsecutiveTeachingTurns), 0)
  const evidenceDiversitySatisfied = results.reduce((sum, result) => sum + result.evidenceDiversitySatisfiedMicros, 0)
  const masteredMicros = results.reduce((sum, result) => sum + result.masteredMicros, 0)
  const retainedMastered = results.reduce((sum, result) => sum + result.retainedMasteredMicros, 0)
  const completedCoverages = results
    .filter(result => result.outcome === 'program_complete')
    .map(result => result.requiredCoveragePercent)
  const correctChangeOpportunities = results.reduce((sum, result) => sum + result.activityChangeOpportunitiesAfterCorrect, 0)
  const incorrectChangeOpportunities = results.reduce((sum, result) => sum + result.activityChangeOpportunitiesAfterIncorrect, 0)

  // Calibración
  const totalMicroEvals = results.reduce((s, r) => s + r.totalMicros, 0)
  const totalFalsePos = results.reduce((s, r) => s + r.latentFalsePositiveCount, 0)
  const totalFalseNeg = results.reduce((s, r) => s + r.falseMissCount, 0)
  const falsePositiveRate = totalMicroEvals > 0 ? totalFalsePos / totalMicroEvals : 0
  const falseNegativeRate = totalMicroEvals > 0 ? totalFalseNeg / totalMicroEvals : 0

  const repairSuccess = results.reduce((sum, result) => sum + result.repairResolutions, 0)
  const repairTotal = results.reduce((sum, result) => sum + result.repairAttempts, 0)
  const repairSuccessRate = repairTotal > 0 ? repairSuccess / repairTotal : 0

  const strategyOpportunities = results.reduce((sum, result) => sum + result.strategyChangeOpportunities, 0)
  const strategyChanges = results.reduce((sum, result) => sum + result.strategyChangesAfterRepeatedFailure, 0)
  const strategyChangeRate = strategyOpportunities > 0 ? strategyChanges / strategyOpportunities : 0

  const segments = {} as Record<StudentProfileSegment, SegmentMetrics>
  for (const segment of ['capable', 'recoverable', 'adversarial'] as const) {
    const segmentRuns = results.filter(r => ACCEPTANCE_PROFILE_IDS[segment].includes(r.profileId))
    segments[segment] = aggregateGroupMetrics(segmentRuns)
  }

  const profiles: Partial<Record<StudentProfileId, SegmentMetrics>> = {}
  for (const profileId of new Set(results.map(result => result.profileId))) {
    profiles[profileId] = aggregateGroupMetrics(results.filter(result => result.profileId === profileId))
  }

  // Distribución de formatos
  const formatDist: Record<string, number> = {}
  const assistanceDist: Record<string, number> = {}
  for (const r of results) {
    for (const t of r.turns) {
      if (t.format && t.format !== 'none') {
        formatDist[t.format] = (formatDist[t.format] || 0) + 1
      }
      const al = t.response.assistanceLevel
      assistanceDist[al] = (assistanceDist[al] || 0) + 1
    }
  }

  const failureSeeds = results
    .filter(r => r.invariantFailures.length > 0)
    .flatMap(r => r.invariantFailures.map(f => ({
      seed: r.seed,
      profileId: r.profileId,
      programId: r.programId,
      invariantId: f.invariantId,
    })))

  return {
    generatedAt: Date.now(),
    totalRuns: total,
    deterministicRuns: 0,
    stochasticRuns: total,
    programComplete,
    sessionCompleteOnly,
    validIncomplete,
    invariantFailures,
    loopFailures,
    restoreDivergences,
    falseMasteryCases,
    avgSessionsToMastery,
    avgTurnsPerMicro,
    maxTurnsPerMicro,
    maxConsecutiveTeachingTurns,
    repeatedQuestionIds: null,
    repeatedFactKeys: null,
    repeatedNormalizedPrompts: null,
    evidenceDiversityRate: masteredMicros > 0 ? evidenceDiversitySatisfied / masteredMicros : 0,
    prematureFuseCount: results.reduce((sum, result) => sum + result.prematureFuseCount, 0),
    unresolvedMicros: results.reduce((sum, result) => sum + result.unresolvedMicros, 0),
    requiredCoverageForCompletedPrograms: completedCoverages.length ? Math.min(...completedCoverages) : 0,
    retainedMasteryRate: masteredMicros > 0 ? retainedMastered / masteredMicros : 0,
    programClosureWithoutEngineConfirmation: results.reduce((sum, result) => sum + result.programClosureWithoutEngineConfirmation, 0),
    independentSuccesses: results.reduce((sum, result) => sum + result.independentSuccesses, 0),
    activityChangeAfterCorrectRate: correctChangeOpportunities > 0
      ? results.reduce((sum, result) => sum + result.activityChangesAfterCorrect, 0) / correctChangeOpportunities
      : 0,
    activityChangeAfterIncorrectRate: incorrectChangeOpportunities > 0
      ? results.reduce((sum, result) => sum + result.activityChangesAfterIncorrect, 0) / incorrectChangeOpportunities
      : 0,
    avgVirtualDurationMs,
    masteryCalibration: { falsePositiveRate, falseNegativeRate },
    repairSuccessRate,
    strategyChangeRate,
    segments,
    profiles,
    activityFormatDistribution: formatDist,
    assistanceDistribution: assistanceDist as Record<AssistanceLevel, number>,
    sessionCloseReasons: {},
    failureSeeds,
  }
}

function aggregateGroupMetrics(groupRuns: SimulationRunResult[]): SegmentMetrics {
  const completed = groupRuns.filter(result => result.outcome === 'program_complete').length
  const repairAttempts = groupRuns.reduce((sum, result) => sum + result.repairAttempts, 0)
  const repairResolutions = groupRuns.reduce((sum, result) => sum + result.repairResolutions, 0)
  const strategyOpportunities = groupRuns.reduce((sum, result) => sum + result.strategyChangeOpportunities, 0)
  const strategyChanges = groupRuns.reduce((sum, result) => sum + result.strategyChangesAfterRepeatedFailure, 0)
  return {
    runs: groupRuns.length,
    programComplete: completed,
    programCompletionRate: groupRuns.length ? completed / groupRuns.length : 0,
    avgTurnsPerMicro: groupRuns.length
      ? groupRuns.reduce((sum, result) => sum + result.totalTurns / Math.max(1, result.totalMicros), 0) / groupRuns.length
      : 0,
    maxTurnsPerMicro: groupRuns.reduce((max, result) => Math.max(max, result.maxTurnsOnSingleMicro), 0),
    repairSuccessRate: repairAttempts > 0 ? repairResolutions / repairAttempts : null,
    strategyChangeRate: strategyOpportunities > 0 ? strategyChanges / strategyOpportunities : null,
    strategyChangeOpportunities: strategyOpportunities,
    strategyChanges,
    falseMasteryCases: groupRuns.reduce((sum, result) => sum + result.falseMasteryCount, 0),
  }
}

export function printReport(report: SimulationReport, failures: SimulationRunResult[]): void {
  const pct = (n: number, total: number) => total > 0 ? ` (${Math.round(n / total * 100)}%)` : ''

  console.log(`\n${C.bold}${C.cyan}${'═'.repeat(60)}${C.reset}`)
  console.log(`${C.bold}${C.cyan}  SIMULATION REPORT${C.reset}`)
  console.log(`${C.cyan}${'═'.repeat(60)}${C.reset}`)

  console.log(`\n${C.bold}RUNS${C.reset}`)
  console.log(`  Total:                ${report.totalRuns}`)
  console.log(`  Program complete:     ${C.green}${report.programComplete}${pct(report.programComplete, report.totalRuns)}${C.reset}`)
  console.log(`  Session only:         ${report.sessionCompleteOnly}${pct(report.sessionCompleteOnly, report.totalRuns)}`)
  console.log(`  Valid incomplete:     ${report.validIncomplete}${pct(report.validIncomplete, report.totalRuns)}`)

  console.log(`\n${C.bold}FALLOS CRÍTICOS${C.reset}`)
  const inv = report.invariantFailures
  const loops = report.loopFailures
  const restore = report.restoreDivergences
  const falseMastery = report.falseMasteryCases

  console.log(`  Invariant failures:   ${inv > 0 ? C.red : C.green}${inv}${C.reset}`)
  console.log(`  Infinite loops:       ${loops > 0 ? C.red : C.green}${loops}${C.reset}`)
  console.log(`  Restore divergences:  ${restore > 0 ? C.red : C.green}${restore}${C.reset}`)
  console.log(`  False mastery:        ${falseMastery > 0 ? C.red : C.green}${falseMastery}${C.reset}`)

  console.log(`\n${C.bold}MÉTRICAS PEDAGÓGICAS${C.reset}`)
  console.log(`  Avg turns/micro:      ${report.avgTurnsPerMicro}`)
  console.log(`  Max turns/micro:      ${report.maxTurnsPerMicro}`)
  console.log(`  Max teaching streak:  ${report.maxConsecutiveTeachingTurns}`)
  console.log(`  Avg duration:         ${Math.round(report.avgVirtualDurationMs / 1000 / 60)} min (virtual)`)
  console.log(`  Repair success:       ${Math.round(report.repairSuccessRate * 100)}%`)
  console.log(`  Strategy changed:     ${Math.round(report.strategyChangeRate * 100)}%`)
  console.log(`  False positive rate:  ${(report.masteryCalibration.falsePositiveRate * 100).toFixed(1)}%`)
  console.log(`  False negative rate:  ${(report.masteryCalibration.falseNegativeRate * 100).toFixed(1)}%`)
  console.log(`  Evidence diversity:   ${(report.evidenceDiversityRate * 100).toFixed(1)}%`)
  console.log(`  Premature fuse:       ${report.prematureFuseCount}`)
  console.log(`  Required coverage:    ${report.requiredCoverageForCompletedPrograms}% (completed programs)`)
  console.log(`  Retained mastery:     ${(report.retainedMasteryRate * 100).toFixed(1)}%`)
  console.log(`  Closure w/o engine:   ${report.programClosureWithoutEngineConfirmation}`)
  console.log(`  Activity Δ correct:   ${(report.activityChangeAfterCorrectRate * 100).toFixed(1)}%`)
  console.log(`  Activity Δ incorrect: ${(report.activityChangeAfterIncorrectRate * 100).toFixed(1)}%`)

  console.log(`\n${C.bold}MÉTRICAS SEGMENTADAS${C.reset}`)
  for (const [segment, metrics] of Object.entries(report.segments)) {
    console.log(`  ${segment}: runs=${metrics.runs} completion=${Math.round(metrics.programCompletionRate * 100)}% turns/micro=${metrics.avgTurnsPerMicro.toFixed(1)} max=${metrics.maxTurnsPerMicro} repair=${metrics.repairSuccessRate === null ? 'n/a' : Math.round(metrics.repairSuccessRate * 100) + '%'} strategy=${metrics.strategyChangeRate === null ? 'n/a' : `${Math.round(metrics.strategyChangeRate * 100)}% (${metrics.strategyChanges}/${metrics.strategyChangeOpportunities})`} falseMastery=${metrics.falseMasteryCases}`)
  }

  console.log(`\n${C.bold}MÉTRICAS POR PERFIL${C.reset}`)
  for (const [profile, metrics] of Object.entries(report.profiles)) {
    const canonicalName = ACCEPTANCE_PROFILE_NAMES[profile as StudentProfileId] || profile
    console.log(`  ${canonicalName}: runs=${metrics.runs} completion=${Math.round(metrics.programCompletionRate * 100)}% turns/micro=${metrics.avgTurnsPerMicro.toFixed(1)} max=${metrics.maxTurnsPerMicro} repair=${metrics.repairSuccessRate === null ? 'n/a' : Math.round(metrics.repairSuccessRate * 100) + '%'} strategy=${metrics.strategyChangeRate === null ? 'n/a' : `${Math.round(metrics.strategyChangeRate * 100)}% (${metrics.strategyChanges}/${metrics.strategyChangeOpportunities})`} falseMastery=${metrics.falseMasteryCases}`)
  }

  if (Object.keys(report.avgSessionsToMastery).length > 0) {
    console.log(`\n${C.bold}SESIONES PROMEDIO POR PERFIL${C.reset}`)
    for (const [profile, avg] of Object.entries(report.avgSessionsToMastery)) {
      const canonicalName = ACCEPTANCE_PROFILE_NAMES[profile as StudentProfileId] || profile
      console.log(`  ${canonicalName.padEnd(35)} ${avg}`)
    }
  }

  if (Object.keys(report.activityFormatDistribution).length > 0) {
    console.log(`\n${C.bold}FORMATOS MÁS USADOS${C.reset}`)
    const sorted = Object.entries(report.activityFormatDistribution).sort((a, b) => b[1] - a[1]).slice(0, 8)
    for (const [fmt, count] of sorted) {
      console.log(`  ${fmt.padEnd(30)} ${count}`)
    }
  }

  if (failures.length > 0) {
    console.log(`\n${C.bold}${C.red}FALLOS PARA INVESTIGAR${C.reset}`)
    for (const r of failures.slice(0, 5)) {
      for (const f of r.invariantFailures) {
        console.log(`  ${C.red}[${f.invariantId}]${C.reset} seed=${r.seed} profile=${r.profileId} program=${r.programId}`)
        console.log(`    ${f.description}`)
        console.log(`    Replay: ${C.cyan}${f.replayCommand}${C.reset}`)
      }
    }
  }

  // Criterios de aceptación
  console.log(`\n${C.bold}CRITERIOS DE ACEPTACIÓN${C.reset}`)
  const checks = [
    { label: '0 false mastery', pass: report.falseMasteryCases === 0 },
    { label: '0 invariant failures', pass: report.invariantFailures === 0 },
    { label: '0 restore divergences', pass: report.restoreDivergences === 0 },
    { label: '0 infinite loops', pass: report.loopFailures === 0 },
    { label: 'capable avg <= 12 turns/micro', pass: report.segments.capable.avgTurnsPerMicro <= 12 },
    { label: 'recoverable repair success >= 60%', pass: (report.segments.recoverable.repairSuccessRate ?? 0) >= 0.60 },
    { label: 'strategy change after repeated failure >= 80%', pass: Object.values(report.segments).every(s => s.strategyChangeRate === null || s.strategyChangeRate >= 0.80) },
    { label: 'adversarial false mastery = 0', pass: report.segments.adversarial.falseMasteryCases === 0 },
  ]
  for (const c of checks) {
    console.log(`  ${c.pass ? C.green + '✓' : C.red + '✗'}${C.reset} ${c.label}`)
  }

  const allPass = checks.every(c => c.pass)
  console.log(`\n${C.bold}${allPass ? C.green + 'TODOS LOS CRITERIOS: PASS' : C.red + 'FALLOS DETECTADOS'}${C.reset}`)
  console.log(`${C.cyan}${'═'.repeat(60)}${C.reset}\n`)
}

export function saveReports(report: SimulationReport, failures: SimulationRunResult[]): void {
  const dir = 'reports'
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  fs.writeFileSync(
    path.join(dir, 'adaptive-v3-simulation-summary.json'),
    JSON.stringify(report, null, 2),
  )

  const failureData = failures.map(r => ({
    seed: r.seed, profileId: r.profileId, programId: r.programId,
    outcome: r.outcome, invariantFailures: r.invariantFailures,
    turns: r.turns.slice(-20),  // últimos 20 turnos para contexto
  }))

  fs.writeFileSync(
    path.join(dir, 'adaptive-v3-simulation-failures.json'),
    JSON.stringify(failureData, null, 2),
  )

  console.log(`Reportes guardados en reports/`)
}
