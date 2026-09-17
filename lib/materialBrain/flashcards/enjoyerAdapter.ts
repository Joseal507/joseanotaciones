import type { BrainScope, Provenance } from '../types'
import type { FlashcardDeck, FlashcardDeckLookupStatus, FlashcardDeckStore, GeneratedFlashcard } from './types'
import { FLASHCARD_DECK_SCHEMA_VERSION } from './types'

export const ENJOYER_FLASHCARD_PLANNER_VERSION = 'enjoyer-generative-1.0.0'
export const ENJOYER_FLASHCARD_GENERATOR_VERSION = 'enjoyer-generative-atomic-1.1.0'
export const ENJOYER_FLASHCARD_VALIDATOR_VERSION = 'enjoyer-generative-1.0.0'

export interface EnjoyerSourceSpan {
  page: number
  quote: string
}

export interface EnjoyerSourceItem {
  id: string
  kind: string
  name: string
  content: string
  importance: number
  difficulty: string
  pages: number[]
  sourceSpans: EnjoyerSourceSpan[]
  materialId: string
  topicId: string | null
  topicTitle: string | null
  examTypes: string[]
  sourceOrder: number
}

export interface EnjoyerSourceExclusion {
  id: string
  reason: 'exact_duplicate' | 'explicit_non_academic_kind' | 'malformed_source_item'
  coveredBySourceId?: string
}

export interface EnjoyerFlashcardSource {
  fingerprint: string
  createdAt: number | string | undefined
  sourceItems: EnjoyerSourceItem[]
  excludedSourceItems: EnjoyerSourceExclusion[]
  topics: { id: string; title: string; order: number }[]
}

export interface ProviderFlashcard {
  question: string
  answer: string
  sourceItemIds: string[]
  pages: number[]
  sourceSpans: { sourceItemId: string; page: number; quote?: string }[]
}

export interface ValidatedEnjoyerCard extends GeneratedFlashcard {
  sourceItemIds: string[]
  pages: number[]
  sourceSpans: { sourceItemId: string; page: number; quote?: string }[]
}

export interface EnjoyerCoverageResult {
  relevantSourceIds: string[]
  coveredSourceIds: string[]
  uncoveredSourceIds: string[]
  coveragePercent: number
  coverageStatus: 'complete' | 'partial' | 'failed'
}

export interface EnjoyerFlashcardDeck extends Omit<FlashcardDeck, 'cards' | 'coverage'> {
  cards: ValidatedEnjoyerCard[]
  coverage: FlashcardDeck['coverage'] & EnjoyerCoverageResult
}

type Authority = {
  createdAt?: number | string
  sourceSelectionFingerprint?: string
  globalOrderedAnalysis?: unknown[]
  uniqueConceptsIndex?: unknown[]
  topicsIndex?: unknown[]
}

const NON_ACADEMIC_KINDS = new Set(['metadata', 'decorative', 'divider', 'heading'])

function normalize(value: string): string {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : []
}

function pages(value: unknown): number[] {
  return Array.isArray(value)
    ? [...new Set(value.map(Number).filter(page => Number.isInteger(page) && page > 0))].sort((a, b) => a - b)
    : []
}

function sourceSpans(value: unknown, fallbackPages: number[], fallbackContent: string): EnjoyerSourceSpan[] {
  if (!Array.isArray(value)) return fallbackPages.slice(0, 1).map(page => ({ page, quote: fallbackContent }))
  const valid = value.flatMap(raw => {
    const span = raw as Record<string, unknown>
    const page = Number(span.page)
    const quote = String(span.text || span.quote || '').trim()
    return Number.isInteger(page) && page > 0 && quote ? [{ page, quote }] : []
  })
  return valid.length ? valid : fallbackPages.slice(0, 1).map(page => ({ page, quote: fallbackContent }))
}

function authorityFrom(payload: unknown): Authority {
  const wrapper = payload as { blueprint?: Authority } | null
  return (wrapper?.blueprint ?? payload) as Authority
}

export function serializeEnjoyerForFlashcards(payload: unknown, fingerprint: string): EnjoyerFlashcardSource {
  const authority = authorityFrom(payload)
  if (authority?.sourceSelectionFingerprint !== fingerprint) throw new Error('SOURCE_SELECTION_FINGERPRINT_MISMATCH')
  const rawTopics = Array.isArray(authority.topicsIndex) ? authority.topicsIndex : []
  const topics = rawTopics.map((raw, index) => {
    const topic = raw as Record<string, unknown>
    return { id: String(topic.id || `topic_${index}`), title: String(topic.title || ''), order: Number(topic.order ?? index) }
  })
  const topicTitle = new Map(topics.map(topic => [topic.id, topic.title]))
  const items: EnjoyerSourceItem[] = []
  const exclusions: EnjoyerSourceExclusion[] = []
  const exactIdentity = new Map<string, string>()
  const seenIds = new Set<string>()

  const add = (raw: unknown, index: number, isConcept: boolean) => {
    const value = raw as Record<string, unknown>
    const id = String(value.id || `${isConcept ? 'concept' : 'block'}_${index}`)
    const name = String(value.name || value.label || '').trim()
    const content = String(value.summary || value.content || '').trim()
    const kind = String(value.kind || 'concept')
    if (!id || !name || !content || seenIds.has(id)) {
      exclusions.push({ id, reason: 'malformed_source_item' })
      return
    }
    if (NON_ACADEMIC_KINDS.has(kind)) {
      exclusions.push({ id, reason: 'explicit_non_academic_kind' })
      return
    }
    const identity = `${normalize(name)}::${normalize(content)}`
    const duplicate = exactIdentity.get(identity)
    if (duplicate) {
      exclusions.push({ id, reason: 'exact_duplicate', coveredBySourceId: duplicate })
      return
    }
    seenIds.add(id)
    exactIdentity.set(identity, id)
    const itemPages = pages(value.pages)
    const topicIds = strings(value.topicIds)
    const topicId = String(value.topicId || topicIds[0] || '') || null
    const materialIds = strings(value.materialIds)
    items.push({
      id, kind, name, content,
      importance: Number(value.importance ?? 50), difficulty: String(value.difficulty || 'basic'),
      pages: itemPages, sourceSpans: sourceSpans(value.sourceSpans, itemPages, content),
      materialId: String(value.materialId || materialIds[0] || ''),
      topicId, topicTitle: topicId ? topicTitle.get(topicId) || null : null,
      examTypes: strings(value.examTypes), sourceOrder: Number(value.globalOrder ?? value.firstAppearanceOrder ?? index),
    })
  }

  const blocks = Array.isArray(authority.globalOrderedAnalysis) ? authority.globalOrderedAnalysis : []
  const concepts = Array.isArray(authority.uniqueConceptsIndex) ? authority.uniqueConceptsIndex : []
  blocks.forEach((raw, index) => add(raw, index, false))
  concepts.forEach((raw, index) => add(raw, blocks.length + index, true))
  items.sort((a, b) => a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id))
  return { fingerprint, createdAt: authority.createdAt, sourceItems: items, excludedSourceItems: exclusions, topics }
}

export function validateProviderCards(
  rawCards: unknown[],
  source: EnjoyerFlashcardSource,
  existingQuestions: Set<string> = new Set(),
  allowedSourceIds?: Set<string>,
): { cards: ProviderFlashcard[]; rejected: number } {
  const byId = new Map(source.sourceItems.map(item => [item.id, item]))
  const cards: ProviderFlashcard[] = []
  let rejected = 0
  for (const raw of rawCards) {
    const value = raw as Record<string, unknown>
    const question = String(value.question || '').trim()
    const answer = String(value.answer || '').trim()
    const sourceItemIds = strings(value.sourceItemIds)
    const normalizedQuestion = normalize(question)
    if (!question || !answer || !normalizedQuestion || !sourceItemIds.length
      || sourceItemIds.some(id => !byId.has(id) || (allowedSourceIds && !allowedSourceIds.has(id)))
      || existingQuestions.has(normalizedQuestion)) {
      rejected++
      continue
    }
    const allowedPages = new Set(sourceItemIds.flatMap(id => byId.get(id)?.pages || []))
    const returnedPages = pages(value.pages)
    if (allowedPages.size > 0 && (!returnedPages.length || returnedPages.some(page => !allowedPages.has(page)))) {
      rejected++
      continue
    }
    const rawSpans = Array.isArray(value.sourceSpans) ? value.sourceSpans : []
    const spans = rawSpans.flatMap(rawSpan => {
      const span = rawSpan as Record<string, unknown>
      const sourceItemId = String(span.sourceItemId || '')
      const page = Number(span.page)
      const item = byId.get(sourceItemId)
      if (!item || !sourceItemIds.includes(sourceItemId) || !Number.isInteger(page) || !item.pages.includes(page)) return []
      const canonicalSpan = item.sourceSpans.find(candidate => candidate.page === page)
      return [{ sourceItemId, page, quote: canonicalSpan?.quote || item.content }]
    })
    const groundedIds = new Set(spans.map(span => span.sourceItemId))
    const idsRequiringSpan = sourceItemIds.filter(id => (byId.get(id)?.pages.length || 0) > 0)
    if (rawSpans.length !== spans.length || idsRequiringSpan.some(id => !groundedIds.has(id))) {
      rejected++
      continue
    }
    existingQuestions.add(normalizedQuestion)
    cards.push({ question, answer, sourceItemIds, pages: returnedPages, sourceSpans: spans })
  }
  return { cards, rejected }
}

export function validateEnjoyerCoverage(source: EnjoyerFlashcardSource, cards: Pick<ProviderFlashcard, 'sourceItemIds'>[]): EnjoyerCoverageResult {
  const relevantSourceIds = source.sourceItems.map(item => item.id)
  const relevant = new Set(relevantSourceIds)
  const coveredSourceIds = [...new Set(cards.flatMap(card => card.sourceItemIds).filter(id => relevant.has(id)))].sort()
  const covered = new Set(coveredSourceIds)
  const uncoveredSourceIds = relevantSourceIds.filter(id => !covered.has(id))
  const coveragePercent = relevantSourceIds.length === 0 ? 0 : Math.round((coveredSourceIds.length / relevantSourceIds.length) * 10000) / 100
  return {
    relevantSourceIds, coveredSourceIds, uncoveredSourceIds, coveragePercent,
    coverageStatus: relevantSourceIds.length === 0 ? 'failed' : uncoveredSourceIds.length === 0 ? 'complete' : coveredSourceIds.length ? 'partial' : 'failed',
  }
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function provenanceFor(ids: string[], source: EnjoyerFlashcardSource): Provenance[] {
  const byId = new Map(source.sourceItems.map(item => [item.id, item]))
  return ids.flatMap(id => {
    const item = byId.get(id)
    if (!item) return []
    const span = item.sourceSpans[0]
    return [{ materialId: item.materialId, page: span?.page || item.pages[0] || 0, quote: span?.quote || item.content, chunkId: item.id }]
  })
}

export function buildEnjoyerDeck(
  source: EnjoyerFlashcardSource,
  scope: BrainScope,
  providerCards: ProviderFlashcard[],
  generatedAt = new Date().toISOString(),
): EnjoyerFlashcardDeck {
  if (source.fingerprint !== scope.fingerprint) throw new Error('SOURCE_SELECTION_FINGERPRINT_MISMATCH')
  const coverage = validateEnjoyerCoverage(source, providerCards)
  const cards: ValidatedEnjoyerCard[] = providerCards.map(card => {
    const key = `${card.sourceItemIds.slice().sort().join(',')}::${normalize(card.question)}`
    return {
      id: `enjoyer_ai_${stableHash(key)}`,
      sourceUnitIds: card.sourceItemIds, sourceItemIds: card.sourceItemIds,
      sourceRelationIds: [], retrievalObjective: `enjoyer-source:${card.sourceItemIds.join(',')}`,
      cognitiveType: 'recall', rationale: `AI-generated from persisted Enjoyer source ids: ${card.sourceItemIds.join(',')}`,
      conceptClusterId: `enjoyer:${stableHash(card.sourceItemIds.slice().sort().join(','))}`,
      question: card.question, answer: card.answer, pages: card.pages, sourceSpans: card.sourceSpans,
      provenance: provenanceFor(card.sourceItemIds, source),
      generatorVersion: ENJOYER_FLASHCARD_GENERATOR_VERSION, generatedAt, validated: true, validationErrors: [],
    }
  })
  const clusters = [...new Set(cards.map(card => card.conceptClusterId))]
  const metaStatus: FlashcardDeck['meta']['status'] = coverage.coverageStatus === 'complete' ? 'ready' : coverage.coverageStatus
  return {
    scope,
    meta: {
      schemaVersion: FLASHCARD_DECK_SCHEMA_VERSION, plannerVersion: ENJOYER_FLASHCARD_PLANNER_VERSION,
      generatorVersion: ENJOYER_FLASHCARD_GENERATOR_VERSION, validatorVersion: ENJOYER_FLASHCARD_VALIDATOR_VERSION,
      status: metaStatus, enrichmentRevision: null, generatedAt, llmCallsUsed: 0, retries: 0, pedagogicalMergesApplied: 0,
    },
    cards,
    coverage: {
      targetedUnitIds: coverage.relevantSourceIds, targetedRelationIds: [], coveredUnitIds: coverage.coveredSourceIds,
      coveredRelationIds: [], targetedConceptClusterIds: coverage.relevantSourceIds,
      coveredConceptClusterIds: coverage.coveredSourceIds, status: coverage.coverageStatus,
      metrics: {
        plannedCards: cards.length, validCards: cards.length, failedCards: coverage.uncoveredSourceIds.length,
        targetedUnits: coverage.relevantSourceIds.length, coveredUnits: coverage.coveredSourceIds.length,
        targetedRelations: 0, coveredRelations: 0,
        targetedConcepts: coverage.relevantSourceIds.length, coveredConcepts: coverage.coveredSourceIds.length,
      },
      ...coverage,
    },
  }
}

export async function lookupEnjoyerFlashcardDeck(
  store: FlashcardDeckStore,
  fingerprint: string,
): Promise<{ status: FlashcardDeckLookupStatus; deck: FlashcardDeck | null }> {
  const deck = await store.get(fingerprint)
  if (!deck || deck.scope.fingerprint !== fingerprint) return { status: 'missing', deck: null }
  if (deck.meta.plannerVersion !== ENJOYER_FLASHCARD_PLANNER_VERSION) return { status: 'missing', deck: null }
  if (deck.meta.generatorVersion !== ENJOYER_FLASHCARD_GENERATOR_VERSION) return { status: 'missing', deck: null }
  if (deck.meta.validatorVersion !== ENJOYER_FLASHCARD_VALIDATOR_VERSION) return { status: 'missing', deck: null }
  return { status: deck.meta.status, deck }
}
