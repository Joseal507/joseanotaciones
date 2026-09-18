import { resolveMaterialLanguage, academicLanguageInstruction } from '../../materialLanguage'
import { alaiJson } from '../../alai'
import type { BrainScope } from '../types'
import {
  buildEnjoyerDeck,
  serializeEnjoyerForFlashcards,
  validateEnjoyerCoverage,
  validateProviderCards,
  type EnjoyerFlashcardDeck,
  type EnjoyerFlashcardSource,
  type EnjoyerSourceItem,
  type ProviderFlashcard,
} from './enjoyerAdapter'

const MAX_BATCH_ITEMS = 24
const MAX_BATCH_CHARS = 14_000
const DEFAULT_MAX_REPAIR_ATTEMPTS = 2

export interface EnjoyerGenerationRequest {
  mode: 'initial' | 'repair'
  fingerprint: string
  language?: string
  sourceItems: EnjoyerSourceItem[]
  contextItems: EnjoyerSourceItem[]
  existingCards: { question: string; answer: string; sourceItemIds: string[] }[]
}

export type EnjoyerFlashcardProvider = (request: EnjoyerGenerationRequest) => Promise<unknown[]>

export interface EnjoyerGenerationOptions {
  language?: string
  provider?: EnjoyerFlashcardProvider
  maxRepairAttempts?: number
}

function itemSize(item: EnjoyerSourceItem): number {
  return JSON.stringify(item).length
}

export function batchEnjoyerSourceItems(items: EnjoyerSourceItem[]): EnjoyerSourceItem[][] {
  const batches: EnjoyerSourceItem[][] = []
  let current: EnjoyerSourceItem[] = []
  let chars = 0
  let topic: string | null | undefined
  for (const item of items) {
    const size = itemSize(item)
    const topicChanged = current.length > 0 && topic !== item.topicId
    const exceeds = current.length >= MAX_BATCH_ITEMS || chars + size > MAX_BATCH_CHARS
    if (current.length > 0 && (exceeds || (topicChanged && chars > MAX_BATCH_CHARS * 0.55))) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(item)
    chars += size
    topic = item.topicId
  }
  if (current.length) batches.push(current)
  return batches
}

export function buildEnjoyerFlashcardPrompt(request: EnjoyerGenerationRequest): string {
  return [
    'You are converting an already-completed academic analysis into a high-quality active-recall flashcard deck.',
    'Do not analyze a PDF, extract new concepts, or add outside knowledge. Use only the structured source items below.',
    'Choose natural questions appropriate to the actual content. Do not use a fixed question template.',
    'Card count is determined only by quality and complete coverage; do not produce one card per item mechanically.',
    'You may cover several related source items with one card or create several useful cards from one dense item.',
    'ATOMIC RECALL CONTRACT:',
    '- Each card must test one clear primary recall target.',
    '- Prefer two short atomic cards over one compound card when the answer contains independently testable facts, propositions, mechanisms, consequences, dates, formulas, or relationships.',
    '- Avoid questions joined by "and" (or its equivalent in the output language) when each part could be answered independently.',
    '- Avoid multi-part prompts and several requested actions unless the parts form one genuinely inseparable concept.',
    '- Keep each question concise and each answer to the minimum information needed to answer that one question correctly.',
    '- Split a dense source item into multiple cards when its knowledge has multiple independent recall targets. Reusing the same sourceItemIds across those cards is explicitly valid.',
    '- Do not split a coherent explanation into meaningless fragments, and do not create redundant cards merely to make them shorter.',
    '- Preserve complete academic coverage across the full set of cards, not by packing unrelated facts into compound questions.',
    'Every source item in sourceItems must be covered by at least one returned card.',
    'Every card must list only the sourceItemIds it truly uses. Avoid duplicate questions and unsupported claims.',
    academicLanguageInstruction(request.language),
    request.mode === 'repair'
      ? 'This is a coverage repair. Generate only cards needed for sourceItems. contextItems are context only; do not regenerate the existing deck.'
      : 'This is initial generation for this bounded batch.',
    'Return JSON: {"cards":[{"question":string,"answer":string,"sourceItemIds":string[],"pages":number[],"sourceSpans":[{"sourceItemId":string,"page":number,"quote":string}]}]}',
    `fingerprint: ${request.fingerprint}`,
    `sourceItems: ${JSON.stringify(request.sourceItems)}`,
    `contextItems: ${JSON.stringify(request.contextItems)}`,
    `existingCards: ${JSON.stringify(request.existingCards)}`,
  ].join('\n')
}

export async function defaultEnjoyerFlashcardProvider(request: EnjoyerGenerationRequest): Promise<unknown[]> {
  const response = await alaiJson<{ cards?: unknown[] }>({
    messages: [
      { role: 'system', content: buildEnjoyerFlashcardPrompt(request) },
      { role: 'user', content: 'Generate the grounded flashcard JSON now.' },
    ],
    temperature: 0.25,
    maxTokens: Math.min(10_000, 800 + request.sourceItems.length * 360),
    json: true,
    taskType: 'flashcard_v2',
    stage: request.mode === 'repair' ? 'coverage_repair' : 'enjoyer_generate_batch',
  })
  return Array.isArray(response?.cards) ? response.cards : []
}

function neighborContext(uncovered: EnjoyerSourceItem[], source: EnjoyerFlashcardSource): EnjoyerSourceItem[] {
  const uncoveredIds = new Set(uncovered.map(item => item.id))
  const context = new Map<string, EnjoyerSourceItem>()
  for (const target of uncovered) {
    const index = source.sourceItems.findIndex(item => item.id === target.id)
    for (const candidate of source.sourceItems) {
      if (candidate.topicId && candidate.topicId === target.topicId && !uncoveredIds.has(candidate.id)) context.set(candidate.id, candidate)
    }
    for (const candidate of source.sourceItems.slice(Math.max(0, index - 1), index + 2)) {
      if (!uncoveredIds.has(candidate.id)) context.set(candidate.id, candidate)
    }
  }
  return [...context.values()].slice(0, 12)
}

function conciseCards(cards: ProviderFlashcard[]) {
  return cards.map(card => ({ question: card.question, answer: card.answer, sourceItemIds: card.sourceItemIds }))
}

function devLog(payload: Record<string, unknown>) {
  if (process.env.NODE_ENV !== 'production') console.info('[enjoyer-flashcards]', JSON.stringify(payload))
}

export async function generateEnjoyerFlashcardDeck(
  payload: unknown,
  scope: BrainScope,
  options: EnjoyerGenerationOptions = {},
): Promise<EnjoyerFlashcardDeck> {
  const source = serializeEnjoyerForFlashcards(payload, scope.fingerprint, scope)
  const materialLanguage = resolveMaterialLanguage(payload)
  const provider = options.provider || defaultEnjoyerFlashcardProvider
  const batches = batchEnjoyerSourceItems(source.sourceItems)
  const cards: ProviderFlashcard[] = []
  const questions = new Set<string>()
  let providerCalls = 0

  for (const batch of batches) {
    const raw = await provider({
      mode: 'initial', fingerprint: scope.fingerprint, language: materialLanguage,
      sourceItems: batch, contextItems: [], existingCards: conciseCards(cards),
    })
    providerCalls++
    const validated = validateProviderCards(raw, source, questions, new Set(batch.map(item => item.id)))
    cards.push(...validated.cards)
  }

  let coverage = validateEnjoyerCoverage(source, cards)
  let repairAttempts = 0
  const maxRepairAttempts = Math.max(0, Math.min(3, options.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS))
  while (coverage.uncoveredSourceIds.length > 0 && repairAttempts < maxRepairAttempts) {
    repairAttempts++
    const uncoveredSet = new Set(coverage.uncoveredSourceIds)
    const uncovered = source.sourceItems.filter(item => uncoveredSet.has(item.id))
    const repairBatches = batchEnjoyerSourceItems(uncovered)
    for (const repairBatch of repairBatches) {
      const raw = await provider({
        mode: 'repair', fingerprint: scope.fingerprint, language: materialLanguage,
        sourceItems: repairBatch, contextItems: neighborContext(repairBatch, source), existingCards: conciseCards(cards),
      })
      providerCalls++
      const validated = validateProviderCards(raw, source, questions, new Set(repairBatch.map(item => item.id)))
      cards.push(...validated.cards.filter(card => card.sourceItemIds.some(id => uncoveredSet.has(id))))
    }
    const next = validateEnjoyerCoverage(source, cards)
    if (next.coveredSourceIds.length === coverage.coveredSourceIds.length) {
      coverage = next
      break
    }
    coverage = next
  }

  const deck = buildEnjoyerDeck(source, scope, cards)
  deck.meta.llmCallsUsed = providerCalls
  deck.meta.retries = repairAttempts
  deck.meta.pedagogicalMergesApplied = 0
  devLog({
    fingerprint: scope.fingerprint, sourceItems: source.sourceItems.length, topics: source.topics.length,
    generationBatches: batches.length, cardsGenerated: deck.cards.length,
    coveredSourceItems: coverage.coveredSourceIds.length, uncoveredSourceItems: coverage.uncoveredSourceIds.length,
    coveragePercent: coverage.coveragePercent, repairAttempts, restoredFromCache: false,
  })
  return deck
}
