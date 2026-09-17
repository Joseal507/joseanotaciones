export * from './types'
export { planFlashcards, plannedCardIdentity } from './planner'
export { generateFlashcard, generateFlashcardBatch, repairStrategyFor, buildRepairFeedbackBlock, type GenerateFlashcardFn, type GenerationContext } from './generator'
export { validateDeck, computeDeckCoverage, isTerminalRejection, TERMINAL_REJECTION_REASONS } from './validate'
// FASE 2 mission ("UNA SOLA autoridad de dedup"): reconcilePedagogicalDuplicates
// is the ONLY LLM dedup authority left in this pipeline — semanticDedup.ts
// (plan-time Tier-2 provider judge) was removed; planner-level dedup is
// now 100% deterministic (see planFlashcards).
export { reconcilePedagogicalDuplicates, reconcileRepairCandidates, defaultPedagogicalJudge, type PedagogicalJudgeFn } from './pedagogicalDedup'
export {
  WorkerFlashcardDeckStore,
  createDeckBuildingPlaceholder,
  getOrBuildFlashcardDeck,
  lookupFlashcardDeck,
  DECK_BUILDING_STALE_MS,
  type DeckBuildOptions,
  type WorkerDeckStoreDeps,
} from './deckStore'
