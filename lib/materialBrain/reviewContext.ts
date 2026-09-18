import { academicLanguageInstruction } from '../materialLanguage'
import type { KnowledgeUnit, MaterialBrain } from './types'
import { computeGroundedCoverage, liveKnowledgeUnits, liveRelationsAmong, primaryEvidenceFor } from './groundedContext'

// ============================================================
// Repasar review-context — grounded, structured view of a READY
// Material Brain built specifically for Repasar (free-form review/
// explanation), not for Quiz. Lives in lib/materialBrain/ per the
// migration contract: reusable location, Repasar-only contract,
// zero behavior change for any other tool that doesn't import it.
//
// Repasar's "review universe" = every non-superseded KnowledgeUnit
// in the Brain for the exact selected scope. This is intentionally
// broader than Quiz's assessable-target notion (Repasar is learning,
// not exam) — no tier/type filtering, no allocation, no candidate
// generation. One review target per surviving unit, id-stable.
// ============================================================

export interface RepasarReviewTarget {
  materialLanguage?: string
  id: string
  unitId: string
  kind: KnowledgeUnit['kind'] | string
  label: string
  statement: string
  importanceTier: 'critical' | 'supporting' | 'contextual'
  materialId: string | null
  page: number | null
  pages?: number[]
  sourceSpans?: { page: number; quote: string }[]
  difficulty?: string | null
  topicId?: string | null
  topicTitle?: string | null
  sourceOrder?: number
  derivation: 'native_text' | 'ocr' | 'vision' | null
  evidenceText: string | null
}

export interface RepasarRelationContext {
  id: string
  type: string
  statement: string
  fromTargetId: string
  toTargetId: string
}

export interface RepasarGroundedContext {
  materialLanguage?: string
  fingerprint: string
  builderVersion: string
  authorityType?: 'studyal_material_enjoyer' | 'material_brain'
  targets: RepasarReviewTarget[]
  relations: RepasarRelationContext[]
  topics?: { id: string; title: string; order: number }[]
}

/** The deterministic denominator: one review target per surviving unit. */
export function buildRepasarReviewTargets(brain: MaterialBrain): RepasarReviewTarget[] {
  return liveKnowledgeUnits(brain).map(unit => {
    const evidence = primaryEvidenceFor(unit)
    return {
      id: unit.id,
      unitId: unit.id,
      kind: unit.kind,
      label: unit.label,
      statement: unit.statement,
      importanceTier: unit.importance.tier,
      ...evidence,
    }
  })
}

export function buildRepasarGroundedContext(brain: MaterialBrain): RepasarGroundedContext {
  const targets = buildRepasarReviewTargets(brain)
  const knownIds = new Set(targets.map(t => t.id))
  const relations = liveRelationsAmong(knownIds, brain.relations || [])
    .map(relation => ({
      id: relation.id, type: relation.type, statement: relation.statement,
      fromTargetId: relation.fromUnitId, toTargetId: relation.toUnitId,
    }))
  return { fingerprint: brain.scope.fingerprint, builderVersion: brain.meta.builderVersion, targets, relations }
}

/**
 * Structured, labeled prompt block — every fact is tagged with its
 * TARGET id so a provider response can only reference ids we handed it
 * (validated server-side; unknown ids are dropped, never trusted).
 */
export function renderRepasarGroundedContextForPrompt(context: RepasarGroundedContext, maxChars = 60000): string {
  const lines: string[] = [academicLanguageInstruction(context.materialLanguage)]
  for (const target of context.targets) {
    lines.push(`[TARGET ${target.id}] kind=${target.kind}${target.importanceTier === 'critical' ? ' importance=critical' : ''}`)
    lines.push(`Etiqueta: ${target.label}`)
    lines.push(`Contenido autorizado: ${target.statement}`)
    if (target.evidenceText) lines.push(`Evidencia (${target.derivation || 'desconocida'}): "${target.evidenceText}"`)
    if (target.materialId) lines.push(`Fuente: material=${target.materialId}${target.page != null ? ` página=${target.page}` : ''}`)
    lines.push('')
  }
  if (context.relations.length) {
    lines.push('RELACIONES AUTORIZADAS:')
    for (const relation of context.relations) {
      lines.push(`- ${relation.fromTargetId} --${relation.type}--> ${relation.toTargetId}: ${relation.statement}`)
    }
  }
  const rendered = lines.join('\n')
  if (rendered.length <= maxChars) return rendered
  return rendered.slice(0, maxChars) + '\n\n[Contexto recortado para el análisis]'
}

// ============================================================
// Domain map — the ACADEMIC UNIVERSE, N-agnostic by construction.
// `targets` is always every live unit in the frozen snapshot (1, 5, 50,
// 1000 — no cap, no slice). This is deliberately separate from any
// LLM-authored "concepts" taxonomy: a provider-invented micro-list (e.g.
// 5 high-level concepts for a 40-unit material) must never become the
// denominator shown to the student ("0 de 5 conceptos necesitan
// refuerzo" when the real material has 40). "omitted" (never
// demonstrated) is never conflated with "demonstrated_incorrect" — an
// unmentioned target is not evidence of a wrong understanding.
// ============================================================

export type RepasarTargetStatus =
  | 'demonstrated_correct'
  | 'demonstrated_partial'
  | 'demonstrated_incorrect'
  | 'omitted'

export interface RepasarDomainMap {
  totalAcademicTargets: number
  demonstratedCorrect: number
  demonstratedPartial: number
  demonstratedIncorrect: number
  omitted: number
  coveragePercent: number
  criticalGapCount: number
  statusByTargetId: Record<string, RepasarTargetStatus>
  // Importance-weighted breakdown — see IMPORTANCE_WEIGHT below. A
  // critical-tier gap counts more than a contextual one, consistently,
  // wherever "how much of the material" is measured (recall, mastery,
  // reinforcement) — never just a raw target COUNT, and never a binary
  // "any critical gap exists" cliff (that was the P0 bug: one omitted
  // critical target among 76 collapsed mastery to ~50 regardless of the
  // other 63 correct).
  totalWeight: number
  correctWeight: number
  partialWeight: number
  incorrectWeight: number
  omittedWeight: number
}

// Transparent, testable weighting contract — reuses Material Brain's
// existing importanceTier (never a new/invented taxonomy). Ratio 3:2:1
// is deliberately mild: a critical gap matters more than a contextual
// one, but three contextual gaps already outweigh one critical gap —
// no single target can single-handedly cap the whole score.

export type RepasarCoverageStatus =
  | 'covered'
  | 'partial'
  | 'missing'
  | 'incorrect'

export const IMPORTANCE_WEIGHT: Record<RepasarReviewTarget['importanceTier'], number> = {
  critical: 3,
  supporting: 2,
  contextual: 1,
}

/**
 * Deterministic, server-computed domain map. `verdicts` is whatever the
 * provider returned for the targets it actually judged (validated
 * server-side against `targets` before this call — unknown ids are
 * never passed in). Every target NOT present in `verdicts` — because it
 * was never mentioned, or because it fell outside a bounded batch for a
 * very large material — is honestly `omitted`, never silently dropped
 * from the total and never upgraded to "incorrect".
 */
export function computeRepasarDomainMap(
  targets: readonly RepasarReviewTarget[],
  verdicts: readonly { targetId: string; status: 'covered' | 'partial' | 'missing' | 'incorrect' }[],
): RepasarDomainMap {
  const verdictById = new Map(verdicts.map(v => [v.targetId, v.status]))
  const statusByTargetId: Record<string, RepasarTargetStatus> = {}
  let correct = 0, partial = 0, incorrect = 0, omitted = 0, criticalGapCount = 0
  let totalWeight = 0, correctWeight = 0, partialWeight = 0, incorrectWeight = 0, omittedWeight = 0
  for (const target of targets) {
    const verdict = verdictById.get(target.id)
    const status: RepasarTargetStatus =
      verdict === 'covered' ? 'demonstrated_correct'
        : verdict === 'partial' ? 'demonstrated_partial'
          : verdict === 'incorrect' ? 'demonstrated_incorrect'
            : 'omitted'
    statusByTargetId[target.id] = status
    const weight = IMPORTANCE_WEIGHT[target.importanceTier] ?? IMPORTANCE_WEIGHT.supporting
    totalWeight += weight
    if (status === 'demonstrated_correct') { correct++; correctWeight += weight }
    else if (status === 'demonstrated_partial') { partial++; partialWeight += weight }
    else if (status === 'demonstrated_incorrect') { incorrect++; incorrectWeight += weight }
    else { omitted++; omittedWeight += weight }
    if (status !== 'demonstrated_correct' && target.importanceTier === 'critical') criticalGapCount++
  }
  const total = targets.length
  const coveragePercent = total > 0 ? Math.round(((correct + partial * 0.5) / total) * 100) : 0
  return {
    totalAcademicTargets: total,
    demonstratedCorrect: correct,
    demonstratedPartial: partial,
    demonstratedIncorrect: incorrect,
    omitted,
    coveragePercent,
    criticalGapCount,
    statusByTargetId,
    totalWeight,
    correctWeight,
    partialWeight,
    incorrectWeight,
    omittedWeight,
  }
}

export interface RepasarMastery {
  // RECORDASTE — importance-weighted breadth of the academic universe
  // successfully recalled/demonstrated. Reader-invariant (depends only
  // on the canonical domain map, never on persona).
  recallPercent: number
  // DOMINIO — overall combined result: breadth (recallPercent) composed
  // with quality-of-what-was-addressed, then penalized for incorrect
  // (mis)understanding — never a persona-specific floor/ceiling. See
  // formula rationale at the call site (route.ts calibrateRepasarScore).
  masteryPercent: number
  // FALTA REFORZAR — remaining ACADEMIC gaps, weighted, derived directly
  // from partial+incorrect+omitted targets. Deliberately NOT `100 -
  // masteryPercent`: mastery already folds in a quality signal and an
  // incorrect penalty, so its complement is not "how much material is
  // left" — that must come from the gap weight fraction directly, or a
  // materially-tiny gap set can misleadingly inflate to "50% left".
  reinforcementPercent: number
}

/**
 * qualityFrac: 0-1, the persona/feedback call's judgment of how well the
 * student explained the material it DID address (never how much of the
 * material was covered — that's recallPercent, computed independently).
 */
export function computeRepasarMastery(domainMap: RepasarDomainMap, qualityFrac: number): RepasarMastery {
  const total = domainMap.totalWeight || 1
  const recallWeight = domainMap.correctWeight + domainMap.partialWeight * 0.5
  const recallPercent = Math.round((recallWeight / total) * 100)
  const clampedQuality = Math.max(0, Math.min(1, qualityFrac))
  // Breadth composed with quality — quality alone can never push mastery
  // ABOVE recall (at quality=100%, baseMastery==recallPercent; quality
  // only ever pulls mastery DOWN from full recall), directly preventing
  // "95% explanation quality" from producing a score disconnected from
  // how much of the material was actually addressed.
  const baseMastery = recallPercent * (0.5 + 0.5 * clampedQuality)
  // Incorrect claims (active misconceptions) matter more than silence —
  // but a single incorrect target among many correct ones must not
  // collapse the score; penalty is proportional to its weighted share.
  const incorrectPenalty = (domainMap.incorrectWeight / total) * 100 * 1.5
  const masteryPercent = Math.max(0, Math.min(100, Math.round(baseMastery - incorrectPenalty)))
  const gapWeight = domainMap.partialWeight + domainMap.incorrectWeight + domainMap.omittedWeight
  const reinforcementPercent = Math.round((gapWeight / total) * 100)
  return { recallPercent, masteryPercent, reinforcementPercent }
}

/**
 * REPASO SCORE V2 — the canonical, deterministic score for the new Repaso
 * product flow (initial explanation, recovery, and final verification all
 * share this SAME formula — never a second scoring system per stage).
 * Pure function of the domain map's importance-weighted status breakdown:
 * covered=1.0, partial=0.5, missing/incorrect=0 credit. Reuses the
 * EXISTING IMPORTANCE_WEIGHT tiers via domainMap's own weighted fields —
 * no new/duplicated weighting system, no provider input, no word-count
 * clamp, no reader/persona effect, no incorrect penalty beyond simply
 * earning zero credit. Legacy/default Repasar deliberately does NOT use
 * this — it keeps its existing provider-quality-composed formula
 * (calibrateRepasarScore/computeRepasarMastery) unchanged.
 */
export function computeRepasoCanonicalScore(domainMap: RepasarDomainMap): number {
  if (domainMap.totalWeight <= 0) return 0
  const credit = domainMap.correctWeight + domainMap.partialWeight * 0.5
  return Math.max(0, Math.min(100, Math.round((credit / domainMap.totalWeight) * 100)))
}

/**
 * Bounded batches over the FULL academic universe — for scale, targets
 * are split into fixed-size groups so a single provider call never has
 * to enumerate an unbounded number of targets. Every target still
 * belongs to exactly one batch (nothing silently dropped from the
 * universe); batches beyond the first are evaluated with a lighter,
 * coverage-only call (see route.ts) so provider cost grows as
 * O(ceil(N/batchSize)), never O(N) calls and never one unbounded prompt.
 */
export function chunkRepasarTargets<T>(targets: readonly T[], batchSize: number): T[][] {
  if (batchSize <= 0) return [targets as T[]]
  const batches: T[][] = []
  for (let i = 0; i < targets.length; i += batchSize) batches.push(targets.slice(i, i + batchSize) as T[])
  return batches.length ? batches : [[]]
}

export interface RepasarCoverageResult {
  totalReviewTargets: number
  coveredReviewTargets: number
  coveragePercent: number
  missingTargetIds: string[]
}

/**
 * Deterministic coverage: the denominator is always every known review
 * target id; any id in `coveredTargetIds` that isn't a known target is
 * silently dropped — a provider (or external knowledge) can never grow
 * the denominator or claim coverage of a target that doesn't exist.
 */
export function computeRepasarCoverage(
  targets: readonly RepasarReviewTarget[],
  coveredTargetIds: readonly string[],
): RepasarCoverageResult {
  const generic = computeGroundedCoverage(targets.map(target => target.id), coveredTargetIds)
  return {
    totalReviewTargets: generic.totalTargets,
    coveredReviewTargets: generic.representedTargets,
    coveragePercent: generic.coveragePercent,
    missingTargetIds: generic.missingTargetIds,
  }
}

// ============================================================
// ACTIONABLE GAPS — "Te falta cubrir" (mission: gaps must be shown as
// meaningful study blocks grounded in real target ids, never a single
// provider-imagined extra example). Groups are formed via existing,
// AUTHORIZED Brain relations between gap targets (union-find over
// `relations`) — never invented semantic clustering. Any target with no
// relation to another gap target becomes its own singleton group. This
// never drops a target: every gap id ends up in exactly one returned
// group, or in `remainderTargetIds` if display is bounded — the caller
// can always still resolve the full list, it is just not rendered as
// individual UI cards past `limit`.
// ============================================================

export interface RepasarGapGroup {
  key: string
  label: string
  importanceTier: 'critical' | 'supporting' | 'contextual'
  targetIds: string[]
}

const GAP_TIER_RANK: Record<string, number> = { critical: 0, supporting: 1, contextual: 2 }

export function buildRepasarGapGroups(
  targets: readonly RepasarReviewTarget[],
  domainMap: RepasarDomainMap,
  relations: readonly RepasarRelationContext[],
  limit = 8,
): { groups: RepasarGapGroup[]; remainderCount: number; remainderTargetIds: string[] } {
  const byId = new Map(targets.map(t => [t.id, t]))
  const gapIds = targets.filter(t => domainMap.statusByTargetId[t.id] !== 'demonstrated_correct').map(t => t.id)
  const gapSet = new Set(gapIds)
  const parent = new Map<string, string>(gapIds.map(id => [id, id]))
  function find(x: string): string {
    while (parent.get(x) !== x) { const p = parent.get(x)!; parent.set(x, parent.get(p) || p); x = p }
    return x
  }
  function union(a: string, b: string) {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const relation of relations) {
    if (gapSet.has(relation.fromTargetId) && gapSet.has(relation.toTargetId)) union(relation.fromTargetId, relation.toTargetId)
  }
  const clusters = new Map<string, string[]>()
  for (const id of gapIds) {
    const root = find(id)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root)!.push(id)
  }
  const groupList: RepasarGapGroup[] = Array.from(clusters.entries()).map(([root, ids]) => {
    const representative = byId.get(root) || byId.get(ids[0])!
    const importanceTier: RepasarGapGroup['importanceTier'] =
      ids.some(id => byId.get(id)?.importanceTier === 'critical') ? 'critical'
        : ids.some(id => byId.get(id)?.importanceTier === 'supporting') ? 'supporting' : 'contextual'
    return { key: root, label: representative.label, importanceTier, targetIds: ids }
  })
  groupList.sort((a, b) => (GAP_TIER_RANK[a.importanceTier] - GAP_TIER_RANK[b.importanceTier]) || (b.targetIds.length - a.targetIds.length))
  const groups = groupList.slice(0, limit)
  const remainder = groupList.slice(limit)
  return { groups, remainderCount: remainder.length, remainderTargetIds: remainder.flatMap(g => g.targetIds) }
}

// "Corrige primero" — deterministic gap priority ordering, never an
// arbitrary provider pick or Set iteration order. Priority: incorrect
// (active misconception) before partial before omitted; within that,
// critical before supporting before contextual; ties broken by relation
// centrality (how many authorized relations touch this target — a rough
// proxy for "prerequisite-ness" using only existing Brain data). O(k log
// k) in the gap count k, computed once — never re-sorted per candidate.
export function sortRepasarGapsByPriority(
  targets: readonly RepasarReviewTarget[],
  domainMap: RepasarDomainMap,
  relations: readonly RepasarRelationContext[],
): string[] {
  const gapTargets = targets.filter(t => domainMap.statusByTargetId[t.id] !== 'demonstrated_correct')
  if (!gapTargets.length) return []
  const centrality = new Map<string, number>()
  for (const relation of relations) {
    centrality.set(relation.fromTargetId, (centrality.get(relation.fromTargetId) || 0) + 1)
    centrality.set(relation.toTargetId, (centrality.get(relation.toTargetId) || 0) + 1)
  }
  const statusRank: Record<string, number> = { demonstrated_incorrect: 0, demonstrated_partial: 1, omitted: 2 }
  return [...gapTargets].sort((a, b) => {
    const statusDiff = (statusRank[domainMap.statusByTargetId[a.id]] ?? 3) - (statusRank[domainMap.statusByTargetId[b.id]] ?? 3)
    if (statusDiff !== 0) return statusDiff
    const tierDiff = GAP_TIER_RANK[a.importanceTier] - GAP_TIER_RANK[b.importanceTier]
    if (tierDiff !== 0) return tierDiff
    return (centrality.get(b.id) || 0) - (centrality.get(a.id) || 0)
  }).map(t => t.id)
}

export function selectRepasarNextPriorityTargetId(
  targets: readonly RepasarReviewTarget[],
  domainMap: RepasarDomainMap,
  relations: readonly RepasarRelationContext[],
): string | null {
  return sortRepasarGapsByPriority(targets, domainMap, relations)[0] || null
}
