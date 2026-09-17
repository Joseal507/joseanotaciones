import { normalizeSemanticText } from '../identity'
import type { KnowledgeRelation, KnowledgeUnit, MaterialBrain } from '../types'
import type { FlashcardPlan, PlannedCard, SkippedTarget, PlannedCardMergeDiagnostic, MetadataEligibilityDiagnostic } from './types'
import { FLASHCARD_PLANNER_VERSION } from './types'
import {
  resolveAcademicRole,
  STRUCTURAL_METADATA_PATTERNS,
  DOCUMENT_METADATA_TOPIC_PATTERN,
  looksLikeBareColophon
} from '../academicRole'

function hashKey(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function plannedCardIdentity(unitIds: string[], relationIds: string[], retrievalObjective: string): string {
  const normalized = normalizeSemanticText(retrievalObjective)
  const parts = [
    [...unitIds].sort().join(','),
    [...relationIds].sort().join(','),
    normalized,
  ].join('||')
  return hashKey(parts)
}

function buildCard(
  unitIds: string[],
  relationIds: string[],
  retrievalObjective: string,
  cognitiveType: PlannedCard['cognitiveType'],
  rationale: string,
): PlannedCard {
  return {
    id: plannedCardIdentity(unitIds, relationIds, retrievalObjective),
    sourceUnitIds: unitIds,
    sourceRelationIds: relationIds,
    retrievalObjective,
    cognitiveType,
    rationale,
    conceptClusterId: '',
  }
}

function conceptClusterKeyFor(unit: KnowledgeUnit): string {
  const semanticKey = (unit.identity?.semanticKey || '').trim()
  if (semanticKey) return `sk:${normalizeSemanticText(semanticKey)}`
  const canonicalSubject = (unit.identity?.canonicalSubject || '').trim()
  if (canonicalSubject) return `cs:${normalizeSemanticText(canonicalSubject)}`
  return `label:${normalizeSemanticText(unit.label)}`
}

const MATH_FUNCTIONS = new Set(['log', 'ln', 'sin', 'cos', 'tan', 'exp', 'sqrt', 'abs'])

function tokenizeMathIdentifiers(expression: string): string[] {
  const bracketTokens = expression.match(/\[[^\]]+\]/g) || []
  let stripped = expression
  for (const token of bracketTokens) {
    stripped = stripped.split(token).join(' ')
  }
  const plainTokens = stripped.match(/[A-Za-z][A-Za-z0-9_]*/g) || []
  return [...plainTokens, ...bracketTokens]
}

function isSimpleAlgebraic(expression: string): boolean {
  const lower = expression.toLowerCase()
  if ([...MATH_FUNCTIONS].some(f => lower.includes(f))) return false

  const tokens = tokenizeMathIdentifiers(expression)
  let stripped = expression
  for (const token of tokens) {
    stripped = stripped.split(token).join('')
  }
  stripped = stripped.replace(/\s+/g, '').replace(/[\d.,]+/g, '')
  return /^[+\-*/·×=()^]+$/.test(stripped)
}

function formulaSides(expression: string): { lhs: string; rhs: string } {
  const idx = expression.indexOf('=')
  if (idx === -1) return { lhs: '', rhs: expression }
  return { lhs: expression.slice(0, idx), rhs: expression.slice(idx + 1) }
}

function getInvolvedVariables(
  expression: string,
  variables: { symbol: string; meaning: string }[],
): { symbol: string; meaning: string }[] {
  const tokens = tokenizeMathIdentifiers(expression)
  const tokenSet = new Set(tokens)
  const baseSet = new Set(tokens.map(t => t.replace(/[^A-Za-z0-9_]/g, '')))
  return variables.filter(v => tokenSet.has(v.symbol) || baseSet.has(v.symbol))
}

function isTargetableImportance(unit: KnowledgeUnit): boolean {
  return unit.importance.tier !== 'contextual'
}

function buildNarrativeObjective(unit: KnowledgeUnit): string {
  const qualifierPart = unit.identity.qualifiers.length > 0
    ? ` (${unit.identity.qualifiers.join(', ')})`
    : ''

  const words = unit.statement.trim().split(/\s+/)
  const statementCore = words.slice(0, Math.min(10, words.length)).join(' ')
  const hasMore = words.length > 10 ? '...' : ''

  switch (unit.kind) {
    case 'definition':
      return `Define ${unit.label}${qualifierPart}: ${statementCore}${hasMore}`
    case 'concept':
      return `Explain the concept of ${unit.label}${qualifierPart}: ${statementCore}${hasMore}`
    case 'fact':
      return `Recall the fact about ${unit.label}${qualifierPart}: ${statementCore}${hasMore}`
    case 'terminology':
      return `Identify and explain the term ${unit.label}${qualifierPart}: ${statementCore}${hasMore}`
    default:
      return `Recall ${unit.label}${qualifierPart}: ${statementCore}${hasMore}`
  }
}

export function planFlashcards(brain: MaterialBrain): FlashcardPlan {
  const plannedCards: PlannedCard[] = []
  const seenIds = new Set<string>()
  const skipped: SkippedTarget[] = []

  const unitById = new Map(brain.units.map(u => [u.id, u]))

  const unitsWithRelations = new Set<string>()
  for (const relation of brain.relations) {
    unitsWithRelations.add(relation.fromUnitId)
    unitsWithRelations.add(relation.toUnitId)
  }

  const subsumedByExample = new Set<string>()
  const criticalChildrenByExample = new Map<string, KnowledgeUnit[]>()
  for (const relation of brain.relations) {
    if (relation.type !== 'example_of') continue
    const from = unitById.get(relation.fromUnitId)
    const to = unitById.get(relation.toUnitId)
    if (!from || !to) continue
    const parentIsExample = from.kind === 'example' || to.kind === 'example'
    if (!parentIsExample) continue
    const parent = from.kind === 'example' ? from : to
    const childUnit = from.kind === 'example' ? to : from
    if (childUnit.kind === 'example') continue
    if (resolveAcademicRole(childUnit, unitsWithRelations) === 'document_metadata') continue
    if (childUnit.importance.tier !== 'critical') {
      subsumedByExample.add(childUnit.id)
      continue
    }
    const arr = criticalChildrenByExample.get(parent.id) || []
    arr.push(childUnit)
    criticalChildrenByExample.set(parent.id, arr)
  }
  const consolidatedExampleCards: PlannedCard[] = []
  for (const [parentId, children] of criticalChildrenByExample) {
    if (children.length < 2) continue
    for (const child of children) subsumedByExample.add(child.id)
    const parent = unitById.get(parentId)
    const labels = children.map(c => c.label).join(', ')
    consolidatedExampleCards.push(buildCard(
      children.map(c => c.id),
      [],
      `Given the worked example${parent ? ` "${parent.label}"` : ''}, determine the key results: ${labels}`,
      'application',
      `Worked-example conclusion consolidation: ${children.length} co-critical data points of the same example (${labels}) merged into one retrieval task instead of one card each`,
    ))
  }

  // Single SOURCE-metadata authority: Material Brain's resolveAcademicRole()
  // on each card's own source units. No parallel text-pattern check on the
  // assembled card text — a card is metadata-shaped only because at least
  // one of the units it targets IS document_metadata, never because its
  // generated retrievalObjective happens to contain metadata-sounding words.
  function isMetadataSourced(card: PlannedCard): boolean {
    return card.sourceUnitIds.some(id => {
      const u = unitById.get(id)
      return !!u && resolveAcademicRole(u, unitsWithRelations) === 'document_metadata'
    })
  }

  function tryAdd(card: PlannedCard) {
    if (seenIds.has(card.id)) return
    seenIds.add(card.id)
    if (!card.conceptClusterId) {
      const firstUnit = card.sourceUnitIds.map(id => unitById.get(id)).find((u): u is KnowledgeUnit => !!u)
      card.conceptClusterId = firstUnit ? conceptClusterKeyFor(firstUnit) : `card:${card.id}`
    }
    if (isMetadataSourced(card)) {
      for (const unitId of card.sourceUnitIds) skipped.push({ unitId, reason: 'non_studyable_metadata' })
      for (const relationId of card.sourceRelationIds) skipped.push({ relationId, reason: 'non_studyable_metadata' })
      return
    }
    plannedCards.push(card)
  }

  function skipUnit(unit: KnowledgeUnit, reason: SkippedTarget['reason']) {
    skipped.push({ unitId: unit.id, reason })
  }

  for (const card of consolidatedExampleCards) tryAdd(card)

  const artifactClusters = new Map<string, KnowledgeUnit[]>()
  for (const u of brain.units) {
    if (u.supersededBy) continue
    if (u.kind !== 'fact' && u.kind !== 'event_or_data') continue
    if (subsumedByExample.has(u.id)) continue
    if (resolveAcademicRole(u, unitsWithRelations) === 'document_metadata') continue
    if (u.identity.qualifiers.length === 0) continue
    // Sharing qualifiers only proves the units concern the SAME entity/
    // instance (e.g. both are "about H2") — it says nothing about whether
    // they carry the SAME knowledge. Two units are only treated as
    // consolidation candidates when they ALSO share the same normalized
    // statement (the same deterministic proposition-equality signal
    // already used elsewhere in this module for duplicate detection) —
    // distinct facts about the same qualifier (e.g. initial concentration
    // vs. change vs. equilibrium concentration of H2) get distinct keys
    // and are never merged or dropped by this cluster. Default: preserve
    // as a separate unit unless there is real evidence of equivalence.
    const key = [...u.identity.qualifiers].sort().join('||') + '::' + hashKey(normalizeSemanticText(u.statement))
    const arr = artifactClusters.get(key) || []
    arr.push(u)
    artifactClusters.set(key, arr)
  }
  const subsumedByArtifact = new Set<string>()
  const consolidatedArtifactCards: PlannedCard[] = []
  for (const members of artifactClusters.values()) {
    if (members.length < 2) continue
    const critical = members.filter(m => m.importance.tier === 'critical')
    const nonCritical = members.filter(m => m.importance.tier !== 'critical')
    if (critical.length > 0) {
      for (const m of nonCritical) subsumedByArtifact.add(m.id)
    } else if (nonCritical.length >= 2) {
      for (const m of nonCritical) subsumedByArtifact.add(m.id)
      const labels = nonCritical.map(c => c.label).join(', ')
      consolidatedArtifactCards.push(buildCard(
        nonCritical.map(c => c.id), [],
        `Given ${members[0].identity.qualifiers.join(', ')}, summarize: ${labels}`,
        'comprehension',
        `Shared-artifact consolidation (qualifiers=${members[0].identity.qualifiers.join(', ')}): ${nonCritical.length} support-only facts sharing the same table/figure/case/code context merged into one retrieval task instead of one card each`,
      ))
    }
  }
  for (const card of consolidatedArtifactCards) tryAdd(card)

  for (const unit of brain.units) {
    if (unit.supersededBy) continue
    if (resolveAcademicRole(unit, unitsWithRelations) === 'document_metadata') { skipUnit(unit, 'non_studyable_metadata'); continue }
    if (subsumedByExample.has(unit.id)) { skipUnit(unit, 'consolidated_into_worked_example'); continue }
    if (subsumedByArtifact.has(unit.id)) { skipUnit(unit, 'consolidated_into_shared_artifact'); continue }

    const baseRationale = `Unit ${unit.kind}: ${unit.label} (importance=${unit.importance.tier})`

    switch (unit.kind) {
      case 'concept':
      case 'definition':
      case 'terminology':
      case 'fact': {
        if (!isTargetableImportance(unit)) {
          skipUnit(unit, 'contextual_importance')
          break
        }
        tryAdd(buildCard(
          [unit.id],
          [],
          buildNarrativeObjective(unit),
          'recall',
          `${baseRationale}; core recall objective`,
        ))
        break
      }

      case 'formula': {
        if (!isTargetableImportance(unit)) {
          skipUnit(unit, 'contextual_importance')
          break
        }
        tryAdd(buildCard(
          [unit.id],
          [],
          `State the formula ${unit.label} and the meaning of each variable`,
          'recall',
          `${baseRationale}; formula recall`,
        ))

        const involved = getInvolvedVariables(unit.expression, unit.variables)
        if (involved.length === 0) break

        if (involved.length === 1) {
          const input = involved[0]
          tryAdd(buildCard(
            [unit.id],
            [],
            `Apply the formula ${unit.label} to calculate ${unit.label} from ${input.meaning} (${input.symbol})`,
            'application',
            `${baseRationale}; direct application with ${input.symbol}`,
          ))
          break
        }

        const { lhs, rhs } = formulaSides(unit.expression)
        const lhsTokens = tokenizeMathIdentifiers(lhs)
        const output = involved.find(v => lhsTokens.includes(v.symbol))
        const inputs = output ? involved.filter(v => v !== output) : involved.slice(1)

        if (output && inputs.length > 0) {
          tryAdd(buildCard(
            [unit.id],
            [],
            `Apply the formula ${unit.label} to calculate ${output.meaning} (${output.symbol}) given the other variables`,
            'application',
            `${baseRationale}; compute ${output.symbol} from inputs`,
          ))
        }
        break
      }

      case 'process': {
        if (!isTargetableImportance(unit)) {
          skipUnit(unit, 'contextual_importance')
          break
        }
        tryAdd(buildCard(
          [unit.id],
          [],
          `Describe the steps of the process ${unit.label}`,
          'procedure',
          `${baseRationale}; procedure recall`,
        ))

        if (unit.steps.length >= 4) {
          tryAdd(buildCard(
            [unit.id],
            [],
            `Reconstruct the correct order of the steps of the process ${unit.label}`,
            'procedure',
            `${baseRationale}; step ordering`,
          ))
        }
        break
      }

      case 'example': {
        if (!isTargetableImportance(unit)) {
          skipUnit(unit, 'contextual_importance')
          break
        }
        tryAdd(buildCard(
          [unit.id],
          [],
          `Explain how the example ${unit.label} illustrates ${unit.illustrates}`,
          'comprehension',
          `${baseRationale}; example comprehension`,
        ))
        break
      }

      case 'event_or_data': {
        if (!isTargetableImportance(unit)) {
          skipUnit(unit, 'contextual_importance')
          break
        }
        tryAdd(buildCard(
          [unit.id],
          [],
          `Identify the event or data ${unit.label} and its significance`,
          'recall',
          `${baseRationale}; event/data recall`,
        ))
        break
      }
    }
  }

  for (const relation of brain.relations) {
    const from = unitById.get(relation.fromUnitId)
    const to = unitById.get(relation.toUnitId)
    if (!from || !to) continue
    if (
      resolveAcademicRole(from, unitsWithRelations) === 'document_metadata' ||
      resolveAcademicRole(to, unitsWithRelations) === 'document_metadata'
    ) {
      skipped.push({ relationId: relation.id, reason: 'non_studyable_metadata' })
      continue
    }

    const baseRationale = `Relation ${relation.type}: ${from.label} → ${to.label}`

    switch (relation.type) {
      case 'example_of':
        break

      case 'depends_on':
      case 'causes':
      case 'precedes':
      case 'defined_by':
      case 'part_of': {
        tryAdd(buildCard(
          [relation.fromUnitId, relation.toUnitId],
          [relation.id],
          `Explain the relationship: ${from.label} ${relation.type.replace(/_/g, ' ')} ${to.label}`,
          'comprehension',
          `${baseRationale}; relational comprehension`,
        ))
        break
      }

      case 'contrasts_with': {
        tryAdd(buildCard(
          [relation.fromUnitId, relation.toUnitId],
          [relation.id],
          `Compare and contrast ${from.label} and ${to.label}`,
          'comparison',
          `${baseRationale}; comparison objective`,
        ))
        break
      }

      case 'applies_formula': {
        tryAdd(buildCard(
          [relation.fromUnitId, relation.toUnitId],
          [relation.id],
          `Apply the formula or concept ${from.label} to solve ${to.label}`,
          'application',
          `${baseRationale}; formula/concept application`,
        ))
        break
      }

      default: {
        skipped.push({ relationId: relation.id, reason: 'unsupported_relation_type' })
      }
    }
  }

  const AUTO_MERGE_THRESHOLD = 0.62
  function jaccardTokens(a: string, b: string): number {
    const ta = new Set(a.split(/\s+/).filter(Boolean))
    const tb = new Set(b.split(/\s+/).filter(Boolean))
    if (!ta.size || !tb.size) return 0
    let inter = 0
    for (const t of ta) if (tb.has(t)) inter++
    const union = ta.size + tb.size - inter
    return union ? inter / union : 0
  }
  const CONTRAST_PAIRS: [string, string][] = [
    ['aumenta', 'disminuye'], ['aumentar', 'disminuir'], ['incrementa', 'reduce'], ['incrementar', 'reducir'],
    ['mayor', 'menor'], ['mas', 'menos'], ['positivo', 'negativo'], ['verdadero', 'falso'],
    ['presente', 'ausente'], ['con', 'sin'], ['siempre', 'nunca'], ['antes', 'despues'],
    ['directa', 'inversa'], ['endotermica', 'exotermica'], ['aumento', 'disminucion'],
    ['favorece', 'desfavorece'], ['acelera', 'desacelera'], ['si', 'no'],
  ]
  function hasContrastFlip(a: string, b: string): boolean {
    const ta = new Set(a.split(/\s+/))
    const tb = new Set(b.split(/\s+/))
    return CONTRAST_PAIRS.some(([x, y]) => (ta.has(x) && tb.has(y)) || (ta.has(y) && tb.has(x)))
  }
  function dedupeText(card: PlannedCard): string {
    if (card.sourceUnitIds.length === 1) {
      const u = unitById.get(card.sourceUnitIds[0])
      if (u) return normalizeSemanticText(u.statement)
    }
    return normalizeSemanticText(card.retrievalObjective)
  }
  const survivors: PlannedCard[] = []
  const ambiguousByCluster = new Map<string, Set<string>>()
  const autoMergeByCardId = new Map<string, { inputPlannedCardIds: [string, string]; similarityScore: number; rule: string }>()
  for (const card of plannedCards) {
    const normText = dedupeText(card)
    const cluster = card.conceptClusterId || null
    const sortedUnits = [...card.sourceUnitIds].sort().join(',')

    let mergedInto: PlannedCard | null = null
    const ambiguousAgainst: PlannedCard[] = []
    for (const s of survivors) {
      if ([...s.sourceUnitIds].sort().join(',') === sortedUnits) continue
      const sameCluster = cluster !== null && s.conceptClusterId === cluster
      const sText = dedupeText(s)
      if (hasContrastFlip(sText, normText)) continue
      const overlap = jaccardTokens(sText, normText)
      if (overlap >= AUTO_MERGE_THRESHOLD) {
        mergedInto = s
        autoMergeByCardId.set(s.id, { inputPlannedCardIds: [s.id, card.id], similarityScore: overlap, rule: 'AUTO_MERGE_THRESHOLD' })
        break
      }
      if (sameCluster) ambiguousAgainst.push(s)
    }

    if (mergedInto) {
      for (const unitId of card.sourceUnitIds) skipped.push({ unitId, reason: 'semantic_duplicate_of_target', mergedIntoCardId: mergedInto.id, method: 'deterministic' })
      for (const relationId of card.sourceRelationIds) skipped.push({ relationId, reason: 'semantic_duplicate_of_target', mergedIntoCardId: mergedInto.id, method: 'deterministic' })
      continue
    }
    survivors.push(card)
    if (ambiguousAgainst.length > 0 && cluster) {
      const group = ambiguousByCluster.get(cluster) || new Set<string>()
      group.add(card.id)
      for (const other of ambiguousAgainst) group.add(other.id)
      ambiguousByCluster.set(cluster, group)
    }
  }

  const ambiguousDuplicateGroups = [...ambiguousByCluster.entries()]
    .filter(([, cardIds]) => cardIds.size >= 2)
    .map(([label, cardIds]) => ({ label, cardIds: [...cardIds] }))

  const targetedUnitIds = [...new Set(survivors.flatMap(c => c.sourceUnitIds))]
  const targetedRelationIds = [...new Set(survivors.flatMap(c => c.sourceRelationIds))]

  const consolidatedExampleCardIds = new Set(consolidatedExampleCards.map(c => c.id))
  const mergeDiagnostics: PlannedCardMergeDiagnostic[] = survivors.map(card => {
    const autoMerge = autoMergeByCardId.get(card.id)
    const mergeProvenance: PlannedCardMergeDiagnostic['mergeProvenance'] = autoMerge
      ? 'deterministic_auto_merge'
      : consolidatedExampleCardIds.has(card.id)
        ? 'worked_example_consolidation'
        : card.sourceRelationIds.length > 0
          ? 'relation_expansion'
          : 'created_directly'
    return {
      plannedCardId: card.id,
      conceptClusterId: card.conceptClusterId,
      sourceUnitIds: card.sourceUnitIds,
      sourceUnitKinds: card.sourceUnitIds.map(id => unitById.get(id)?.kind || 'unknown'),
      retrievalObjectiveFingerprint: hashKey(normalizeSemanticText(card.retrievalObjective)),
      sourcePropositionFingerprints: card.sourceUnitIds.map(id => hashKey(normalizeSemanticText(unitById.get(id)?.statement || ''))),
      mergeProvenance,
      ...(autoMerge ? { autoMerge } : {}),
    }
  })

  const metadataTextSurfaceMatches = (text: string): boolean =>
    STRUCTURAL_METADATA_PATTERNS.some(p => p.test(text)) || DOCUMENT_METADATA_TOPIC_PATTERN.test(text)
  const metadataDiagnostics: MetadataEligibilityDiagnostic[] = survivors
    .map(card => {
      const unitId = card.sourceUnitIds[0]
      const unit = unitId ? unitById.get(unitId) : undefined
      if (!unit) return null
      const labelMatch = metadataTextSurfaceMatches(unit.label || '')
      const statementMatch = metadataTextSurfaceMatches(unit.statement || '')
      const provenanceMatch = unit.provenance.some(p => metadataTextSurfaceMatches(p.quote || ''))
      const objectiveMatch = metadataTextSurfaceMatches(card.retrievalObjective)
      let reasonCode: MetadataEligibilityDiagnostic['metadataReasonCode'] = 'not_metadata'
      if (STRUCTURAL_METADATA_PATTERNS.some(p => p.test(`${unit.label} ${unit.statement}`))) reasonCode = 'structural'
      else if (looksLikeBareColophon(unit, unitsWithRelations)) reasonCode = 'bare_colophon'
      else if (labelMatch || statementMatch || provenanceMatch || objectiveMatch) reasonCode = 'ambiguous_topic_excluded'
      return {
        sourceUnitId: unit.id,
        conceptClusterId: card.conceptClusterId,
        metadataPredicateResult: resolveAcademicRole(unit, unitsWithRelations) === 'document_metadata',
        metadataReasonCode: reasonCode,
        whichTextSurfacesMatched: { label: labelMatch, statement: statementMatch, provenance: provenanceMatch, retrievalObjective: objectiveMatch },
      }
    })
    .filter((d): d is MetadataEligibilityDiagnostic => !!d)

  return {
    plannerVersion: FLASHCARD_PLANNER_VERSION,
    mergeDiagnostics,
    metadataDiagnostics,
    plannedCards: survivors,
    targetedUnitIds,
    targetedRelationIds,
    skipped,
    ambiguousDuplicateGroups,
  }
}
