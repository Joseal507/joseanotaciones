import { normalizeSemanticText } from '../identity'
import type { GeneratedFlashcard } from './types'

// ============================================================
// Global pedagogical (retrieval-intent) reconciliation.
//
// Cross-unit dedup (planner.ts) and its Tier-2 batched judge
// (semanticDedup.ts) only ever compare units/cards that share the SAME
// normalized LABEL — that is deliberately cheap and safe, but it cannot
// catch two cards whose underlying KnowledgeUnits have DIFFERENT labels
// yet ask the student to retrieve the same knowledge (the reported
// case: 4 differently-labeled Le Châtelier units producing 4 near-
// identical cards). Label equality was never meant to be — and must
// never become — the boundary of "same thing worth studying".
//
// This pass runs POST-GENERATION (it needs real question/answer text,
// which does not exist at plan time) on already-VALIDATED cards, using
// a `retrievalIntent` signature per card: cognitiveType (the operation
// being tested: recall/application/comparison/procedure — cards in
// different buckets are NEVER compared) plus normalizeSemanticText of
// the ANSWER content (the canonical claim actually taught — "if you
// know the answer to one, you know the answer to the other"), without
// ever trusting question-text similarity or label equality as authority
// (per mission constraint).
//
// Pipeline: deterministic bucketing (cognitiveType) -> bounded
// candidate pairs within each bucket -> contrast-flip veto -> high-
// confidence auto-merge -> mid-confidence -> ONE batched provider call
// across ALL ambiguous pairs in the whole deck (never O(N) or O(N²)
// provider calls, never one call per pair).
// ============================================================

// P1 root-cause fix: cognitiveType is the operation-being-tested signal,
// but "recall" (¿Qué es X?) and "comprehension" (¿Qué significa X? /
// ¿Qué es X en relación con A y B?) are frequently the SAME retrieval
// task wearing different grammatical clothing — the real-deck evidence
// ("¿Qué es el equilibrio químico?" vs "¿Qué es el equilibrio químico
// en relación con las reacciones directa e inversa?") is exactly this:
// a recall-phrased and a comprehension-phrased card asking for the
// identical proposition, bucketed apart before, so NEVER even compared.
// application/comparison/procedure stay in their own groups — mission's
// own KEEP-BOTH examples (definition vs application, principle vs
// application) are precisely recall/comprehension vs application, which
// must stay genuinely distinct.
function comparableGroup(cognitiveType: GeneratedFlashcard['cognitiveType']): string {
  if (cognitiveType === 'recall' || cognitiveType === 'comprehension') return 'recall_comprehension'
  return cognitiveType
}

const AUTO_MERGE_THRESHOLD = 0.72
const MAX_BUCKET_SIZE = 300 // safety cap: local CPU comparison only, never provider calls
// Genuine paraphrases can share almost NO surface vocabulary (mission's
// own example: 4 differently-worded Le Châtelier restatements) — a
// Jaccard-ratio floor is too blunt to even surface them as candidates.
// Candidacy is instead: ANY shared content token at all (normalizeSemanticText
// already strips stopwords, so any survivor is a real content word) below
// the auto-merge confidence — cheap, CPU-only, cast deliberately wide;
// the batched provider judge is the actual precision authority for these.
const MIN_SHARED_CONTENT_TOKENS = 1
// Hard cap on how many ambiguous pairs get sent to the batched judge —
// bounds worst-case provider calls to ceil(MAX_AMBIGUOUS_PAIRS/PAIRS_PER_CALL)
// regardless of deck size; pairs beyond the cap are left unresolved
// (fail-closed, kept distinct), never silently merged and never an
// unbounded number of provider calls.
const MAX_AMBIGUOUS_PAIRS = 500
// FASE (dedup ranking): a generous CPU/memory-only collection ceiling —
// distinct from MAX_AMBIGUOUS_PAIRS (the provider-call bound, unchanged)
// — so all three passes can collect enough candidates to rank properly
// before the real cap is applied, without literal unbounded O(N²)
// collection on pathological decks. Never affects provider calls.
const AMBIGUOUS_COLLECTION_LIMIT = MAX_AMBIGUOUS_PAIRS * 3

// Reused from planner.ts's contrast-flip guard (kept local/minimal
// rather than importing across modules to avoid coupling the two dedup
// layers — same generic, subject-agnostic principle).
const CONTRAST_PAIRS: [string, string][] = [
  ['aumenta', 'disminuye'], ['aumentar', 'disminuir'], ['incrementa', 'reduce'], ['incrementar', 'reducir'],
  ['mayor', 'menor'], ['mas', 'menos'], ['positivo', 'negativo'], ['verdadero', 'falso'],
  ['presente', 'ausente'], ['con', 'sin'], ['siempre', 'nunca'], ['antes', 'despues'],
  ['directa', 'inversa'], ['endotermica', 'exotermica'], ['aumento', 'disminucion'],
  ['favorece', 'desfavorece'], ['acelera', 'desacelera'], ['si', 'no'],
]
// P1 fix: genuine contrast requires EXCLUSIVE presence on each side — a
// asserts X but not Y, b asserts Y but not X. Real-deck evidence: two
// cards both describing "las reacciones directa e inversa" (both terms
// mentioned on BOTH sides, describing the SAME symmetric relationship)
// were wrongly vetoed as "opposite claims" by the old any-overlap check
// (a.has(x) && b.has(y)), which fires even when both cards mention BOTH
// contrast terms together — that is co-mention, not a flip.
function hasContrastFlip(a: Set<string>, b: Set<string>): boolean {
  return CONTRAST_PAIRS.some(([x, y]) => {
    const aOnlyX = a.has(x) && !a.has(y)
    const aOnlyY = a.has(y) && !a.has(x)
    const bOnlyX = b.has(x) && !b.has(y)
    const bOnlyY = b.has(y) && !b.has(x)
    return (aOnlyX && bOnlyY) || (aOnlyY && bOnlyX)
  })
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union ? inter / union : 0
}

function sharedContentTokenCount(a: Set<string>, b: Set<string>): number {
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter
}

// Answer content alone is the similarity signal — "if you know the
// answer to one, you know the answer to the other" is the actual test
// of retrieval-intent equivalence. `retrievalObjective` deliberately
// stays OUT of this signature: it is often short, generator-authored,
// English-language scaffolding text (recall/application/comparison
// phrasing) that varies between cards even when their underlying claim
// is identical, which would dilute the real signal. The "operation
// being tested" distinction it carries is instead enforced by the
// cognitiveType bucket itself (recall vs application vs comparison
// never even get compared — see DEDUP-X3/X5/X10).
function intentTokens(card: GeneratedFlashcard): Set<string> {
  return new Set(normalizeSemanticText(card.answer).split(' ').filter(Boolean))
}

interface JudgeCardRef { id: string; question: string; answer: string; retrievalObjective?: string; cognitiveType?: string }

// FASE 2 (pedagogical dedup quality) — machine-readable taxonomy for WHY
// a pair was judged duplicate/not-duplicate. Additive to the verdict
// shape (see PedagogicalJudgeFn below): every existing judge mock in the
// test suite that only returns `{ pairId, duplicate }` keeps compiling
// and behaving exactly as before — `reason`/`preferSurvivor` are pure
// extra signal for callers that choose to inspect them.
export type PedagogicalDedupReason =
  | 'same_retrieval' // near-identical question, one answer is the other restated
  | 'same_answer_content' // different questions, but the answer teaches the identical fact
  | 'distinct_application' // same concept, but one card exercises a genuinely different retrieval target (e.g. an isolated mechanism vs. a compound outcome)
  | 'distinct_consequence' // one card states a real implication/consequence the other never mentions
  | 'complementary_knowledge' // both independently worth recalling — no real overlap in what's being tested
  | 'subset_superset' // one answer's content is fully contained in (or a strict elaboration of) the other's, with no distinct retrieval skill added

export type PedagogicalJudgeFn = (
  pairs: { pairId: string; a: JudgeCardRef; b: JudgeCardRef }[],
) => Promise<{ pairId: string; duplicate: boolean; reason?: PedagogicalDedupReason; preferSurvivor?: 'a' | 'b' }[]>

const PAIRS_PER_CALL = 20

// P0 mission (#4, real-deck evidence: "13 duplicate_objective" — cards
// testing DIFFERENT cognitive operations on the same concept, e.g.
// definition vs formula-application, incorrectly judged as duplicates):
// the judge previously received ONLY raw question/answer text — never
// the card's own declared retrieval objective or cognitive operation,
// even though both already exist on every PlannedCard/GeneratedFlashcard.
// Passing them explicitly gives the judge the exact "pedagogical
// substitutability" signal the mission asks for, without changing the
// deterministic candidate-generation/bucketing/threshold logic at all —
// purely richer context for the SAME final arbiter call.
function buildJudgePrompt(pairs: { pairId: string; a: JudgeCardRef; b: JudgeCardRef }[]): string {
  const describe = (c: JudgeCardRef) => [
    c.cognitiveType ? `[cognitive operation: ${c.cognitiveType}]` : null,
    c.retrievalObjective ? `[target objective: ${c.retrievalObjective}]` : null,
    `Q: ${c.question}`,
    `A: ${c.answer}`,
  ].filter(Boolean).join('\n')
  const blocks = pairs.map(p => [
    `--- PAIR "${p.pairId}" ---`,
    `A:\n${describe(p.a)}`,
    `B:\n${describe(p.b)}`,
  ].join('\n'))
  return [
    'You are a pedagogical duplicate judge for flashcards.',
    '',
    'For EACH pair, answer the real pedagogical question: does studying BOTH cards give the student',
    'materially distinct recall/application practice, or is one of them essentially redundant with the',
    'other — same knowledge recovered, nothing academically important would be lost by dropping it?',
    '',
    'Base your decision on the actual CONTENT:',
    '- What knowledge does each ANSWER actually recover?',
    '- What does each QUESTION actually require the student to retrieve or do?',
    '- Does one card add a distinction, consequence, or application the other never states?',
    '- If you removed one of the two cards, would any real knowledge be lost?',
    '',
    'cognitiveType, shared sourceUnitIds, shared conceptClusterId, and surface lexical similarity are',
    'SIGNALS ONLY — never automatic verdicts:',
    '- Two cards with DIFFERENT declared cognitiveType do NOT automatically survive. If the "different',
    'operation" card\'s answer is just a restatement/concatenation of the other card(s) with no new fact,',
    'distinction, or consequence, they ARE redundant (duplicate: true) regardless of the labels.',
    '- Two cards from DIFFERENT sourceUnitIds do NOT automatically survive either. If they end up',
    'teaching literally the same proposition (e.g. two near-duplicate source statements phrased with a',
    'different qualifier that adds no real distinction), they are redundant.',
    '- A "cause vs its consequence", "principle vs its application", or "formula vs the meaning of one of',
    'its variables" framing is usually a real reason to KEEP BOTH — but only when each side genuinely',
    'asks for a DIFFERENT, independently-recallable piece of knowledge. If the "consequence"/"application"',
    'card\'s answer is nothing more than card A\'s content plus card B\'s content concatenated (a superset',
    'with no new claim), that is NOT complementary knowledge — it is a subset/superset duplicate: keep',
    'only the superset (it already covers what the subset teaches).',
    '',
    'When you decide duplicate: true, also pick which one should survive as "preferSurvivor": "a" or "b"',
    '— prefer whichever answer has the broader/more complete coverage of the knowledge both cards test',
    '(the superset), never the narrower subset. Omit preferSurvivor if quality is genuinely equivalent.',
    '',
    'Reply with a machine-readable "reason" for every pair, one of:',
    '  same_retrieval          - near-identical question, one answer is the other restated',
    '  same_answer_content     - different questions, but the answer teaches the identical fact',
    '  distinct_application    - genuinely different retrieval target (isolated mechanism vs compound outcome, general law vs a named worked instance, etc.)',
    '  distinct_consequence    - one card states a real implication/consequence the other never mentions',
    '  complementary_knowledge - both independently worth recalling, no real overlap',
    '  subset_superset         - one answer fully contains the other\'s content with no distinct retrieval skill added',
    '',
    'duplicate: true only for same_retrieval / same_answer_content / subset_superset.',
    'duplicate: false for distinct_application / distinct_consequence / complementary_knowledge.',
    '',
    ...blocks,
    '',
    'Return valid JSON: { "pairs": [ { "pairId": string, "duplicate": boolean, "reason": string, "preferSurvivor"?: "a" | "b" } ] }',
  ].join('\n')
}

// Bounded concurrency helper (mirrors deckStore.ts's own — kept local
// to avoid coupling the two modules for one tiny utility). Real-deck
// evidence (mission: "many pedagogical_dedup_judge_batch calls",
// ~127s total latency): this loop previously ran every judge batch
// SEQUENTIALLY (`for` + `await`), unlike generation batches (already
// parallelized via mapWithConcurrency in deckStore.ts) — for a deck
// needing many batches (bounded by MAX_AMBIGUOUS_PAIRS/PAIRS_PER_CALL),
// that is wall-clock-additive network latency for no correctness
// reason: each batch judges an independent, disjoint set of pairs.
// Running them with bounded concurrency cuts wall-clock time roughly by
// the concurrency factor WITHOUT changing call count, correctness, or
// the fail-closed-on-error behavior of any individual batch.
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

const JUDGE_CONCURRENCY = 4

export const defaultPedagogicalJudge: PedagogicalJudgeFn = async pairs => {
  const { alaiJson } = await import('../../alai')
  if (!pairs.length) return []
  const batches: typeof pairs[] = []
  for (let i = 0; i < pairs.length; i += PAIRS_PER_CALL) batches.push(pairs.slice(i, i + PAIRS_PER_CALL))
  const batchResults = await mapWithConcurrency(batches, JUDGE_CONCURRENCY, async batch => {
    try {
      const response = await alaiJson<{ pairs: { pairId: string; duplicate: boolean; reason?: PedagogicalDedupReason; preferSurvivor?: 'a' | 'b' }[] }>({
        messages: [
          { role: 'system', content: buildJudgePrompt(batch) },
          { role: 'user', content: 'Return the JSON now.' },
        ],
        temperature: 0.1,
        maxTokens: Math.min(4000, 200 + batch.length * 120),
        json: true,
        taskType: 'flashcard_v2',
        stage: 'pedagogical_dedup_judge_batch',
      })
      return Array.isArray(response?.pairs) ? response.pairs : []
    } catch {
      // Fail closed: unresolved pairs stay distinct — never silently merged.
      return []
    }
  })
  return batchResults.flat()
}

// P8 — deterministic survivor-quality ranking. Both candidates already
// passed every per-card gate (self-containedness, math integrity,
// circularity, worthiness) before reaching this pass, so this scoring
// only needs to break the tie among two otherwise-valid cards using the
// signals the mission calls out: broader legitimate coverage first
// (a card spanning more source units/relations is doing more real
// work), then answer information density (more substantive content,
// capped so raw verbosity stops earning credit), with penalties for
// residual document-language, near-bare single-value "trivial lookup"
// answers, and excessive length. Exported so tests can inspect WHY a
// given survivor won, per the mission's telemetry requirement — never
// used for student-facing output.
const RESIDUAL_DOCUMENT_LANGUAGE = /seg[uú]n\s+(el|lo)\s+(texto|documento)|en\s+el\s+ejemplo\s+(dado|mencionado|anterior)|\beste\s+sistema\b|\besta\s+gr[aá]fica\b|according to the text|in the (given|above) example/i

export interface SurvivorScore {
  coverageBreadth: number
  answerInformationDensity: number
  deicticPenalty: number
  triviaPenalty: number
  verbosityPenalty: number
  total: number
}

export function scoreCandidate(c: GeneratedFlashcard): SurvivorScore {
  const coverageBreadth = c.sourceUnitIds.length + c.sourceRelationIds.length
  const answerTokens = c.answer.trim().split(/\s+/).filter(Boolean)
  const answerInformationDensity = Math.min(answerTokens.length, 40)
  const deicticPenalty = RESIDUAL_DOCUMENT_LANGUAGE.test(c.question) ? 1 : 0
  const triviaPenalty = answerTokens.length <= 2 ? 1 : 0
  const verbosityPenalty = answerTokens.length > 80 ? 1 : 0
  const total = coverageBreadth * 3 + answerInformationDensity - deicticPenalty * 5 - triviaPenalty * 3 - verbosityPenalty * 2
  return { coverageBreadth, answerInformationDensity, deicticPenalty, triviaPenalty, verbosityPenalty, total }
}

function pickSurvivor(a: GeneratedFlashcard, b: GeneratedFlashcard): [GeneratedFlashcard, GeneratedFlashcard] {
  const sa = scoreCandidate(a)
  const sb = scoreCandidate(b)
  if (sa.total !== sb.total) return sa.total > sb.total ? [a, b] : [b, a]
  // Deterministic tie-break by id so merge order never depends on
  // iteration order once the quality signals are equal.
  return a.id <= b.id ? [a, b] : [b, a]
}

/**
 * Merges pedagogically-duplicate cards (same retrieval intent, possibly
 * different source-unit labels) among already-validated cards. Never
 * touches invalid cards. The survivor inherits the UNION of
 * sourceUnitIds/sourceRelationIds from every card merged into it, so
 * `computeDeckCoverage` (run AFTER this pass) never loses coverage for
 * the academic targets the removed duplicates used to cover.
 */
// Diagnostics-only instrumentation (P0 mission: "explain the ~68s
// without changing behavior yet"). Every counter/timer here is read-only
// observation of the EXISTING algorithm — no comparison, batch, or
// concurrency behavior below is altered by adding these.
// FASE (dedup ranking) — a pair's compact, privacy-minimal risk record:
// never question/answer text, only ids/counts/booleans/scores already
// derivable from structural signals already on GeneratedFlashcard.
export interface RankedPairDiagnostic {
  pairId: string
  sharedSourceUnitCount: number
  sameConceptCluster: boolean
  lexicalScore: number
  selectedForJudge: boolean
}

export interface PedagogicalDedupDiagnostics {
  /** Total (a,b) comparisons actually reached across all three passes (bucket/cluster/fallback), post removed-skip. */
  candidatePairs: number
  /** Of those, resolved WITHOUT a provider call (contrast-flip veto or auto-merge threshold). */
  deterministicResolved: number
  /** Sent to the judge (queued into `ambiguousPairs`) — same as ambiguousPairsAfterCap. */
  ambiguousPairs: number
  /** Number of judge() invocations — one per cluster-packed callBatch. */
  judgeBatches: number
  /** Same as judgeBatches in this implementation (each callBatch maps to exactly one judge() call). */
  judgeCalls: number
  judgeBatchSizes: number[]
  judgeBatchDurationsMs: number[]
  /** Time to build the cognitiveType buckets, before any pairwise comparison starts. */
  candidateConstructionMs: number
  /**
   * The three pairwise-comparison passes (bucket/cluster/fallback)
   * combined — pair CONSTRUCTION (the i/j iteration) and deterministic
   * RESOLUTION (contrast-flip/auto-merge) are fused in the current loop
   * structure, not separable without restructuring the algorithm itself
   * (explicitly out of scope for this instrumentation-only pass).
   */
  deterministicResolutionMs: number
  /** Cluster-packing ambiguous pairs into callBatches + the SEQUENTIAL judge() calls loop (see judgeBatchDurationsMs for the per-call breakdown — this loop is NOT concurrent today). */
  judgeWallMs: number
  /** Applying judge verdicts + building the final survivors array. */
  mergeFinalizationMs: number
  // FASE (dedup ranking, real-deck evidence: ambiguousPairs landed
  // EXACTLY at MAX_AMBIGUOUS_PAIRS=500 out of 849 non-deterministic
  // candidates — up to 349 pairs were silently dropped by iteration
  // ORDER, never by relevance). All candidate pairs are now collected
  // BEFORE the cap is applied, ranked by a deterministic risk score
  // (shared sourceUnitIds > same conceptClusterId > lexical overlap),
  // then truncated — the cap itself, its value, and the judge's final
  // authority are all unchanged; only WHICH pairs win a scarce slot
  // changes.
  ambiguousPairsBeforeCap: number
  ambiguousPairsAfterCap: number
  sourceOverlapPairsBeforeCap: number
  sourceOverlapPairsAfterCap: number
  pairsDroppedByCap: number
  rankedPairs: RankedPairDiagnostic[]
}

export async function reconcilePedagogicalDuplicates(
  cards: GeneratedFlashcard[],
  judge: PedagogicalJudgeFn = defaultPedagogicalJudge,
): Promise<{ cards: GeneratedFlashcard[]; mergedCount: number; diagnostics: PedagogicalDedupDiagnostics }> {
  const emptyDiagnostics: PedagogicalDedupDiagnostics = {
    candidatePairs: 0, deterministicResolved: 0, ambiguousPairs: 0,
    judgeBatches: 0, judgeCalls: 0, judgeBatchSizes: [], judgeBatchDurationsMs: [],
    candidateConstructionMs: 0, deterministicResolutionMs: 0, judgeWallMs: 0, mergeFinalizationMs: 0,
    ambiguousPairsBeforeCap: 0, ambiguousPairsAfterCap: 0, sourceOverlapPairsBeforeCap: 0,
    sourceOverlapPairsAfterCap: 0, pairsDroppedByCap: 0, rankedPairs: [],
  }
  const candidates = cards.filter(c => c.validated)
  const others = cards.filter(c => !c.validated)
  if (candidates.length < 2) return { cards, mergedCount: 0, diagnostics: emptyDiagnostics }

  const tCandidateConstruction0 = Date.now()
  const buckets = new Map<string, GeneratedFlashcard[]>()
  for (const c of candidates) {
    const key = comparableGroup(c.cognitiveType)
    const arr = buckets.get(key) || []
    arr.push(c)
    buckets.set(key, arr)
  }
  const candidateConstructionMs = Date.now() - tCandidateConstruction0
  let pairsEvaluated = 0
  let deterministicResolvedCount = 0
  const tDeterministicResolution0 = Date.now()

  const removed = new Set<string>()
  // Union-find, NOT a single-hop map: a survivor can itself later be
  // dropped into a further survivor (a chain, e.g. c0 -> c2 -> c3 as
  // more cards keep proving equivalent). A single `.get()` lookup only
  // resolves ONE hop — once a redirect target itself gets re-redirected,
  // every earlier id still pointing at the ORIGINAL (now-stale, no
  // longer mutated) object silently diverges into its own orphaned
  // branch, losing every unit id merged through it. `resolve()` walks
  // the full chain every time so all ids always converge on the single
  // true current survivor.
  const mergedInto = new Map<string, GeneratedFlashcard>()
  function resolve(card: GeneratedFlashcard): GeneratedFlashcard {
    let current = card
    for (let hops = 0; hops < candidates.length + 1; hops++) {
      const next = mergedInto.get(current.id)
      if (!next || next.id === current.id) return current
      current = next
    }
    return current
  }
  type AmbiguousPairCandidate = {
    pairId: string; a: GeneratedFlashcard; b: GeneratedFlashcard
    sharedSourceUnitCount: number; sameConceptCluster: boolean; lexicalScore: number
  }
  const ambiguousPairs: AmbiguousPairCandidate[] = []
  // FASE (dedup ranking): "two cards share sourceUnitIds" is a PRIORITY
  // signal only, never a merge decision by itself — this count feeds the
  // ranking score below, nothing here changes what gets auto-merged.
  function sharedSourceUnitCountOf(a: GeneratedFlashcard, b: GeneratedFlashcard): number {
    const setA = new Set(a.sourceUnitIds)
    let n = 0
    for (const id of b.sourceUnitIds) if (setA.has(id)) n++
    return n
  }
  function pairRiskScore(p: { sharedSourceUnitCount: number; sameConceptCluster: boolean; lexicalScore: number }): number {
    return p.sharedSourceUnitCount * 10 + (p.sameConceptCluster ? 5 : 0) + p.lexicalScore
  }
  const tokensCache = new Map<string, Set<string>>()
  const tokensOf = (c: GeneratedFlashcard) => {
    let t = tokensCache.get(c.id)
    if (!t) { t = intentTokens(c); tokensCache.set(c.id, t) }
    return t
  }

  for (const bucket of buckets.values()) {
    if (bucket.length > MAX_BUCKET_SIZE) continue // safety cap — CPU-only cost, never a provider-call risk, but bounded regardless
    for (let i = 0; i < bucket.length; i++) {
      const a = bucket[i]
      if (removed.has(a.id)) continue
      for (let j = i + 1; j < bucket.length; j++) {
        const b = bucket[j]
        if (removed.has(b.id)) continue
        pairsEvaluated++
        // P1 root-cause fix: cards from the SAME source unit are no
        // longer exempted from comparison. The prior assumption ("that
        // overlap is already fully governed by planner-level identity/
        // dedup") only holds at PLAN time — the planner deciding to
        // generate e.g. a formula's recall card + its application card
        // is a deliberate, legitimate 2-cards-per-unit pattern, but
        // nothing verified POST-GENERATION that the two actually ended
        // up testing distinct knowledge. Real-deck evidence ("ley de
        // velocidad directa" recall card duplicated almost verbatim by
        // what was meant to be its distinct companion card) proves same-
        // unit pairs need the exact same retrieval-intent scrutiny as
        // any other pair — the contrast-flip veto and auto-merge/judge
        // pipeline below are what correctly keep legitimately
        // complementary same-unit pairs (definition vs application)
        // apart, not a blanket same-unit exemption.
        const ta = tokensOf(a)
        const tb = tokensOf(b)
        if (hasContrastFlip(ta, tb)) { deterministicResolvedCount++; continue } // never merge, never even ambiguous
        const overlap = jaccard(ta, tb)
        if (overlap >= AUTO_MERGE_THRESHOLD) {
          deterministicResolvedCount++
          const [survivor, dropped] = pickSurvivor(resolve(a), resolve(b))
          survivor.sourceUnitIds = [...new Set([...survivor.sourceUnitIds, ...dropped.sourceUnitIds])]
          survivor.sourceRelationIds = [...new Set([...survivor.sourceRelationIds, ...dropped.sourceRelationIds])]
          removed.add(dropped.id)
          mergedInto.set(dropped.id, survivor)
          mergedInto.set(survivor.id, survivor)
        } else if (sharedContentTokenCount(ta, tb) >= MIN_SHARED_CONTENT_TOKENS && ambiguousPairs.length < AMBIGUOUS_COLLECTION_LIMIT) {
          // FASE (dedup ranking): the PROVIDER-CALL cap is no longer
          // applied here — ALL candidates (up to the generous CPU-only
          // AMBIGUOUS_COLLECTION_LIMIT) are collected first, ranked, then
          // truncated to MAX_AMBIGUOUS_PAIRS once after all three passes
          // (see below), so the real cap always keeps the highest-risk
          // pairs regardless of iteration order.
          ambiguousPairs.push({
            pairId: `${a.id}::${b.id}`, a, b,
            sharedSourceUnitCount: sharedSourceUnitCountOf(a, b),
            sameConceptCluster: !!a.conceptClusterId && a.conceptClusterId === b.conceptClusterId,
            lexicalScore: overlap,
          })
        }
      }
    }
  }

  // Cross-cognitiveType comparison via Material Brain's OWN concept
  // identity (mission: "Allow comparison across cognitiveType buckets
  // when cards originate from the same semantic concept family. But DO
  // NOT blindly merge different cognitive operations."). The bucket
  // loop above deliberately never compares recall/comprehension against
  // application/comparison/procedure — that boundary correctly protects
  // "what is K" vs "what does K>>1 imply". But real-deck evidence
  // (catalyst effect restated across recall/comprehension/application-
  // labeled cards with no genuinely distinct operation) proved that
  // same boundary also SHIELDS true near-duplicates that merely got
  // different cognitiveType labels at planning time. `conceptClusterId`
  // (planner.ts, from Brain `identity.semanticKey`/`canonicalSubject`)
  // is the Brain's OWN signal that two cards are about the same
  // underlying concept — strong enough evidence to WARRANT the same
  // contrast-flip-veto + auto-merge/judge scrutiny across bucket
  // boundaries, but never to auto-merge without it: a real
  // application/comparison card sharing a cluster with a recall card
  // must still pass through the exact same jaccard/judge gate as any
  // other candidate pair before being merged.
  const byCluster = new Map<string, GeneratedFlashcard[]>()
  for (const c of candidates) {
    if (!c.conceptClusterId) continue
    const arr = byCluster.get(c.conceptClusterId) || []
    arr.push(c)
    byCluster.set(c.conceptClusterId, arr)
  }
  for (const clusterCards of byCluster.values()) {
    if (clusterCards.length < 2 || clusterCards.length > MAX_BUCKET_SIZE) continue
    for (let i = 0; i < clusterCards.length; i++) {
      const a = clusterCards[i]
      if (removed.has(a.id)) continue
      for (let j = i + 1; j < clusterCards.length; j++) {
        const b = clusterCards[j]
        if (removed.has(b.id)) continue
        if (comparableGroup(a.cognitiveType) === comparableGroup(b.cognitiveType)) continue // already compared above
        pairsEvaluated++
        const ta = tokensOf(a)
        const tb = tokensOf(b)
        if (hasContrastFlip(ta, tb)) { deterministicResolvedCount++; continue }
        const overlap = jaccard(ta, tb)
        if (overlap >= AUTO_MERGE_THRESHOLD) {
          deterministicResolvedCount++
          const [survivor, dropped] = pickSurvivor(resolve(a), resolve(b))
          survivor.sourceUnitIds = [...new Set([...survivor.sourceUnitIds, ...dropped.sourceUnitIds])]
          survivor.sourceRelationIds = [...new Set([...survivor.sourceRelationIds, ...dropped.sourceRelationIds])]
          removed.add(dropped.id)
          mergedInto.set(dropped.id, survivor)
          mergedInto.set(survivor.id, survivor)
        } else if (sharedContentTokenCount(ta, tb) >= MIN_SHARED_CONTENT_TOKENS && ambiguousPairs.length < AMBIGUOUS_COLLECTION_LIMIT) {
          ambiguousPairs.push({
            pairId: `${a.id}::${b.id}`, a, b,
            sharedSourceUnitCount: sharedSourceUnitCountOf(a, b),
            sameConceptCluster: !!a.conceptClusterId && a.conceptClusterId === b.conceptClusterId,
            lexicalScore: overlap,
          })
        }
      }
    }
  }

  // Global fallback candidate pass (real-deck evidence: Kc/Kp and
  // catalyst redundant families survived even after cross-cluster
  // comparison was added). Root cause: `conceptClusterId` depends on
  // Material Brain's `identity.semanticKey`/`canonicalSubject` being
  // populated by the REAL extraction pipeline — when it isn't (falls
  // back to normalized label), two units with genuinely redundant
  // content but DIFFERENT labels never share a cluster and are never
  // even considered together by either pass above. This pass makes
  // dedup robust to that regardless of clustering quality: ANY two
  // still-surviving candidates (any bucket, any cluster) sharing a
  // STRONGER content-token signal (>=2 shared tokens, a materially
  // higher bar than the same-bucket/same-cluster passes' threshold of
  // 1, to keep the candidate set conservative) become ambiguous
  // candidates for the SAME judge pipeline — contrast-flip veto and
  // the judge remain the actual arbiters, so legitimately complementary
  // cards (different clusters, different topics, coincidentally
  // sharing 2 words) are never auto-merged, only considered. Bounded
  // exactly like every other CPU-only pass here (MAX_BUCKET_SIZE cap on
  // total candidates; MAX_AMBIGUOUS_PAIRS cap on queued pairs) — never
  // an added provider-call cost by itself, since batching/clustering
  // for the judge happens once, after every candidate pass below.
  const FALLBACK_MIN_SHARED_CONTENT_TOKENS = 2
  if (candidates.length <= MAX_BUCKET_SIZE) {
    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i]
      if (removed.has(a.id)) continue
      for (let j = i + 1; j < candidates.length; j++) {
        const b = candidates[j]
        if (removed.has(b.id)) continue
        if (comparableGroup(a.cognitiveType) === comparableGroup(b.cognitiveType)) continue // already compared in the bucket pass
        if (a.conceptClusterId && b.conceptClusterId && a.conceptClusterId === b.conceptClusterId) continue // already compared in the cluster pass
        if (ambiguousPairs.length >= AMBIGUOUS_COLLECTION_LIMIT) break
        pairsEvaluated++
        const ta = tokensOf(a)
        const tb = tokensOf(b)
        if (hasContrastFlip(ta, tb)) { deterministicResolvedCount++; continue }
        const overlap = jaccard(ta, tb)
        if (overlap >= AUTO_MERGE_THRESHOLD) {
          deterministicResolvedCount++
          const [survivor, dropped] = pickSurvivor(resolve(a), resolve(b))
          survivor.sourceUnitIds = [...new Set([...survivor.sourceUnitIds, ...dropped.sourceUnitIds])]
          survivor.sourceRelationIds = [...new Set([...survivor.sourceRelationIds, ...dropped.sourceRelationIds])]
          removed.add(dropped.id)
          mergedInto.set(dropped.id, survivor)
          mergedInto.set(survivor.id, survivor)
        } else if (sharedContentTokenCount(ta, tb) >= FALLBACK_MIN_SHARED_CONTENT_TOKENS) {
          ambiguousPairs.push({
            pairId: `${a.id}::${b.id}`, a, b,
            sharedSourceUnitCount: sharedSourceUnitCountOf(a, b),
            sameConceptCluster: !!a.conceptClusterId && a.conceptClusterId === b.conceptClusterId,
            lexicalScore: overlap,
          })
        }
      }
    }
  }

  const deterministicResolutionMs = Date.now() - tDeterministicResolution0

  // FASE (dedup ranking): rank ALL collected candidates by risk score
  // BEFORE truncating to MAX_AMBIGUOUS_PAIRS — real-deck evidence showed
  // ambiguousPairs landing EXACTLY at the cap (500 of 849 non-
  // deterministic candidates), meaning up to 349 pairs were dropped by
  // iteration ORDER alone, never by relevance. Higher shared-sourceUnit
  // count and same-conceptClusterId are priority signals ONLY — neither
  // this ranking nor sharedSourceUnitCount itself ever merges anything;
  // the judge remains the sole authority for every pair that makes the
  // cut, exactly as before. Deterministic tie-break by pairId keeps the
  // whole ranking reproducible.
  const ambiguousPairsBeforeCap = ambiguousPairs.length
  const sourceOverlapPairsBeforeCap = ambiguousPairs.filter(p => p.sharedSourceUnitCount > 0).length
  ambiguousPairs.sort((a, b) => {
    const scoreDiff = pairRiskScore(b) - pairRiskScore(a)
    return scoreDiff !== 0 ? scoreDiff : a.pairId.localeCompare(b.pairId)
  })
  const rankedPairs: RankedPairDiagnostic[] = ambiguousPairs.map((p, i) => ({
    pairId: p.pairId,
    sharedSourceUnitCount: p.sharedSourceUnitCount,
    sameConceptCluster: p.sameConceptCluster,
    lexicalScore: p.lexicalScore,
    selectedForJudge: i < MAX_AMBIGUOUS_PAIRS,
  }))
  if (ambiguousPairs.length > MAX_AMBIGUOUS_PAIRS) ambiguousPairs.length = MAX_AMBIGUOUS_PAIRS
  const ambiguousPairsAfterCap = ambiguousPairs.length
  const sourceOverlapPairsAfterCap = ambiguousPairs.filter(p => p.sharedSourceUnitCount > 0).length
  const pairsDroppedByCap = ambiguousPairsBeforeCap - ambiguousPairsAfterCap

  const judgeBatchSizes: number[] = []
  const judgeBatchDurationsMs: number[] = []
  let judgeWallMs = 0
  let mergeFinalizationMs = 0
  const tJudgeWall0 = Date.now()
  if (ambiguousPairs.length) {
    // P9 (performance): cluster ambiguous pairs into connected components
    // (union-find over card ids) BEFORE batching for the judge. A family
    // like "catalyst affects rate A/B/C/D/E/F" produces many pairwise
    // candidates that are really ONE topic — packing each family into as
    // few provider calls as possible (instead of chunking the flat pair
    // list blindly) turns O(candidatePairs) calls into O(clusters),
    // since a single call can carry an entire family's pairs together.
    const clusterParent = new Map<string, string>()
    const findCluster = (id: string): string => {
      let root = id
      while (clusterParent.has(root) && clusterParent.get(root) !== root) root = clusterParent.get(root)!
      clusterParent.set(id, root)
      return root
    }
    const unionCluster = (x: string, y: string) => {
      const rx = findCluster(x)
      const ry = findCluster(y)
      if (rx !== ry) clusterParent.set(rx, ry)
    }
    for (const { a, b } of ambiguousPairs) {
      if (!clusterParent.has(a.id)) clusterParent.set(a.id, a.id)
      if (!clusterParent.has(b.id)) clusterParent.set(b.id, b.id)
      unionCluster(a.id, b.id)
    }
    const pairsByCluster = new Map<string, typeof ambiguousPairs>()
    for (const pair of ambiguousPairs) {
      const clusterId = findCluster(pair.a.id)
      const arr = pairsByCluster.get(clusterId) || []
      arr.push(pair)
      pairsByCluster.set(clusterId, arr)
    }
    // Bin-pack whole clusters into calls up to PAIRS_PER_CALL; a cluster
    // larger than PAIRS_PER_CALL is sent whole in its own call rather
    // than split (splitting a family defeats the point of clustering).
    const callBatches: (typeof ambiguousPairs)[] = []
    let current: typeof ambiguousPairs = []
    for (const clusterPairs of pairsByCluster.values()) {
      if (current.length && current.length + clusterPairs.length > PAIRS_PER_CALL) {
        callBatches.push(current)
        current = []
      }
      current.push(...clusterPairs)
    }
    if (current.length) callBatches.push(current)

    const verdicts: { pairId: string; duplicate: boolean; reason?: PedagogicalDedupReason; preferSurvivor?: 'a' | 'b' }[] = []
    // NOTE (diagnostics, not a fix): this loop calls `judge()` once per
    // callBatch SEQUENTIALLY (`for` + `await`) — the ONLY concurrency
    // this module has today is `defaultPedagogicalJudge`'s internal
    // PAIRS_PER_CALL/JUDGE_CONCURRENCY sub-batching, which rarely
    // triggers here since a callBatch is already <= PAIRS_PER_CALL.
    // Per-batch timing below is what actually explains multi-batch wall
    // time; per the mission this pass does NOT change this to run
    // concurrently — instrumentation only.
    for (const batch of callBatches) {
      const tBatch0 = Date.now()
      const batchVerdicts = await judge(batch.map(p => ({
        pairId: p.pairId,
        a: { id: p.a.id, question: p.a.question, answer: p.a.answer, retrievalObjective: p.a.retrievalObjective, cognitiveType: p.a.cognitiveType },
        b: { id: p.b.id, question: p.b.question, answer: p.b.answer, retrievalObjective: p.b.retrievalObjective, cognitiveType: p.b.cognitiveType },
      })))
      judgeBatchSizes.push(batch.length)
      judgeBatchDurationsMs.push(Date.now() - tBatch0)
      verdicts.push(...batchVerdicts)
    }
    judgeWallMs = Date.now() - tJudgeWall0
    const tMergeFinalization0 = Date.now()
    const verdictByPairId = new Map(verdicts.map(v => [v.pairId, v]))
    for (const { pairId, a, b } of ambiguousPairs) {
      if (removed.has(a.id) || removed.has(b.id)) continue // already resolved via a chained auto-merge above
      const verdict = verdictByPairId.get(pairId)
      if (!verdict?.duplicate) continue // fail-closed: unresolved or explicitly not-duplicate -> keep both
      const ra = resolve(a)
      const rb = resolve(b)
      // The judge's preferSurvivor is a content-quality signal (which side
      // is the broader superset) — it overrides the generic structural
      // scoreCandidate ranking only when the judge explicitly named one;
      // otherwise pickSurvivor's existing deterministic ranking decides,
      // unchanged.
      const [survivor, dropped] = verdict.preferSurvivor === 'a' ? [ra, rb]
        : verdict.preferSurvivor === 'b' ? [rb, ra]
        : pickSurvivor(ra, rb)
      survivor.sourceUnitIds = [...new Set([...survivor.sourceUnitIds, ...dropped.sourceUnitIds])]
      survivor.sourceRelationIds = [...new Set([...survivor.sourceRelationIds, ...dropped.sourceRelationIds])]
      removed.add(dropped.id)
      mergedInto.set(dropped.id, survivor)
      mergedInto.set(survivor.id, survivor)
    }
    mergeFinalizationMs = Date.now() - tMergeFinalization0
  }

  const tFinal0 = Date.now()
  const survivingCandidates = candidates
    .filter(c => !removed.has(c.id))
    .map(c => resolve(c))
  mergeFinalizationMs += Date.now() - tFinal0

  const diagnostics: PedagogicalDedupDiagnostics = {
    candidatePairs: pairsEvaluated,
    deterministicResolved: deterministicResolvedCount,
    ambiguousPairs: ambiguousPairsAfterCap,
    judgeBatches: judgeBatchSizes.length,
    judgeCalls: judgeBatchSizes.length,
    judgeBatchSizes,
    judgeBatchDurationsMs,
    candidateConstructionMs,
    deterministicResolutionMs,
    judgeWallMs,
    mergeFinalizationMs,
    ambiguousPairsBeforeCap,
    ambiguousPairsAfterCap,
    sourceOverlapPairsBeforeCap,
    sourceOverlapPairsAfterCap,
    pairsDroppedByCap,
    rankedPairs,
  }

  return { cards: [...survivingCandidates, ...others], mergedCount: removed.size, diagnostics }
}

// ============================================================
// FASE 1 — dedup scope during repair (P0 mission: "el deck principal
// puede tener UN full-deck dedup inicial; durante repair, deduplicar
// SOLO el delta"). Real-deck evidence: 3 full-pool `reconcilePedagogicalDuplicates`
// invocations (1 initial + 1 per repair round, each re-comparing the
// ENTIRE accepted deck against itself again) accounted for 67s of a
// 90s run. This function replaces the REPAIR-ROUND call only — the
// initial full-deck pass (reconcilePedagogicalDuplicates above) is
// untouched and still runs exactly once.
//
// Scope: dedupe the newly (re)generated, already-VALIDATED repair
// candidates against (a) each other and (b) a NEIGHBOR subset of the
// already-accepted deck — same conceptClusterId, or sharing a
// sourceUnitId/sourceRelationId ("same source proposition") with any
// new candidate — never the full accepted pool. An existing card that
// is not a neighbor of any new candidate is never even read, let alone
// re-scored or re-compared.
//
// Survivor priority is asymmetric from the main function: when a NEW
// candidate turns out to duplicate an EXISTING (already-accepted) card,
// the EXISTING card ALWAYS survives (absorbing the new candidate's
// sourceUnitIds/sourceRelationIds for coverage-transfer credit) — a
// repair round must never displace prior, already-accepted work; it can
// only ADD new coverage or get silently absorbed into what already
// covers the same proposition. Between two NEW candidates, the normal
// scoreCandidate-based pickSurvivor still decides (P8 tie-break).
// ============================================================

export interface RepairDedupDiagnostics {
  newCards: number
  existingNeighborCardsConsidered: number
  candidatePairs: number
  deterministicResolved: number
  ambiguousPairs: number
  judgeBatches: number
  judgeCalls: number
  judgeBatchSizes: number[]
  judgeBatchDurationsMs: number[]
  mergedCount: number
}

function emptyRepairDedupDiagnostics(newCards: number): RepairDedupDiagnostics {
  return {
    newCards, existingNeighborCardsConsidered: 0, candidatePairs: 0, deterministicResolved: 0,
    ambiguousPairs: 0, judgeBatches: 0, judgeCalls: 0, judgeBatchSizes: [], judgeBatchDurationsMs: [], mergedCount: 0,
  }
}

export async function reconcileRepairCandidates(
  newCandidates: GeneratedFlashcard[],
  existingCards: GeneratedFlashcard[],
  judge: PedagogicalJudgeFn = defaultPedagogicalJudge,
): Promise<{ cards: GeneratedFlashcard[]; mergedCount: number; diagnostics: RepairDedupDiagnostics }> {
  const validNew = newCandidates.filter(c => c.validated)
  // A GeneratedFlashcard.id IS its PlannedCard.id (deterministic hash) —
  // `existingCards` (bestValidCards) always still contains the STALE
  // prior attempt (often invalid, sitting there unvalidated) for the
  // EXACT SAME plannedCardId a repair round just regenerated. That stale
  // entry is not a "duplicate" to compare against — it is being
  // REPLACED by the new attempt. It must never enter neighbor-matching
  // (or it can spuriously "win" a merge over its own valid replacement
  // via identical-id token/quality comparisons against near-empty prior
  // content) and must never survive into the returned cards.
  const newIds = new Set(newCandidates.map(c => c.id))
  const otherExisting = existingCards.filter(e => !newIds.has(e.id))
  if (!validNew.length) {
    // Nothing valid to replace the stale entry with — leave the pool
    // exactly as it was (the stale/invalid entry is harmless: it never
    // counts toward coverage, and the caller's monotonic-coverage check
    // is the actual gate on whether this round's result is kept at all).
    return { cards: existingCards, mergedCount: 0, diagnostics: emptyRepairDedupDiagnostics(newCandidates.length) }
  }

  const isNeighborOf = (existing: GeneratedFlashcard, n: GeneratedFlashcard) =>
    existing.conceptClusterId === n.conceptClusterId ||
    existing.sourceUnitIds.some(id => n.sourceUnitIds.includes(id)) ||
    existing.sourceRelationIds.some(id => n.sourceRelationIds.includes(id))
  const neighborExisting = otherExisting.filter(e => validNew.some(n => isNeighborOf(e, n)))
  const neighborIds = new Set(neighborExisting.map(c => c.id))

  const removed = new Set<string>() // only ever NEW candidate ids — an existing card is never removed, only absorbs
  const mergedInto = new Map<string, GeneratedFlashcard>()
  function resolve(card: GeneratedFlashcard): GeneratedFlashcard {
    let current = card
    for (let hops = 0; hops < validNew.length + neighborExisting.length + 1; hops++) {
      const next = mergedInto.get(current.id)
      if (!next || next.id === current.id) return current
      current = next
    }
    return current
  }
  const tokensCache = new Map<string, Set<string>>()
  const tokensOf = (c: GeneratedFlashcard) => {
    let t = tokensCache.get(c.id)
    if (!t) { t = intentTokens(c); tokensCache.set(c.id, t) }
    return t
  }

  function mergeDuplicate(a: GeneratedFlashcard, b: GeneratedFlashcard) {
    const ra = resolve(a)
    const rb = resolve(b)
    const raIsExisting = neighborIds.has(ra.id)
    const rbIsExisting = neighborIds.has(rb.id)
    // Existing (already-accepted) work always wins — never displaced by
    // a repair candidate. Between two NEW candidates, quality decides.
    const [survivor, dropped] = raIsExisting ? [ra, rb] : rbIsExisting ? [rb, ra] : pickSurvivor(ra, rb)
    survivor.sourceUnitIds = [...new Set([...survivor.sourceUnitIds, ...dropped.sourceUnitIds])]
    survivor.sourceRelationIds = [...new Set([...survivor.sourceRelationIds, ...dropped.sourceRelationIds])]
    removed.add(dropped.id)
    mergedInto.set(dropped.id, survivor)
    mergedInto.set(survivor.id, survivor)
  }

  let pairsEvaluated = 0
  let deterministicResolvedCount = 0
  const ambiguousPairs: { pairId: string; a: GeneratedFlashcard; b: GeneratedFlashcard }[] = []
  function considerPair(a: GeneratedFlashcard, b: GeneratedFlashcard) {
    if (removed.has(a.id) || removed.has(b.id)) return
    if (comparableGroup(a.cognitiveType) !== comparableGroup(b.cognitiveType)) return
    pairsEvaluated++
    const ta = tokensOf(a)
    const tb = tokensOf(b)
    if (hasContrastFlip(ta, tb)) { deterministicResolvedCount++; return }
    const overlap = jaccard(ta, tb)
    if (overlap >= AUTO_MERGE_THRESHOLD) { deterministicResolvedCount++; mergeDuplicate(a, b); return }
    if (sharedContentTokenCount(ta, tb) >= MIN_SHARED_CONTENT_TOKENS) {
      ambiguousPairs.push({ pairId: `${a.id}::${b.id}`, a, b })
    }
  }

  // NEW vs NEW (only relevant when a repair round regenerates 2+ pending targets).
  for (let i = 0; i < validNew.length; i++) {
    for (let j = i + 1; j < validNew.length; j++) considerPair(validNew[i], validNew[j])
  }
  // NEW vs its NEIGHBOR existing cards ONLY — never the full accepted deck.
  for (const n of validNew) {
    if (removed.has(n.id)) continue
    for (const e of neighborExisting) considerPair(resolve(n), e)
  }

  const judgeBatchSizes: number[] = []
  const judgeBatchDurationsMs: number[] = []
  if (ambiguousPairs.length) {
    for (let i = 0; i < ambiguousPairs.length; i += PAIRS_PER_CALL) {
      const batch = ambiguousPairs.slice(i, i + PAIRS_PER_CALL)
      const t0 = Date.now()
      const verdicts = await judge(batch.map(p => ({
        pairId: p.pairId,
        a: { id: p.a.id, question: p.a.question, answer: p.a.answer, retrievalObjective: p.a.retrievalObjective, cognitiveType: p.a.cognitiveType },
        b: { id: p.b.id, question: p.b.question, answer: p.b.answer, retrievalObjective: p.b.retrievalObjective, cognitiveType: p.b.cognitiveType },
      })))
      judgeBatchSizes.push(batch.length)
      judgeBatchDurationsMs.push(Date.now() - t0)
      const verdictByPairId = new Map(verdicts.map(v => [v.pairId, v.duplicate]))
      for (const { pairId, a, b } of batch) {
        if (removed.has(a.id) || removed.has(b.id)) continue
        if (!verdictByPairId.get(pairId)) continue
        mergeDuplicate(a, b)
      }
    }
  }

  const survivingNew = validNew.filter(c => !removed.has(c.id)).map(c => resolve(c))
  // A new candidate that itself failed validation still REPLACES the
  // stale existing entry for its id (freshest error state for that
  // plannedCardId) — it was already excluded from `otherExisting` above,
  // it never enters dedup comparison (not in `validNew`), and it never
  // counts toward coverage (computeDeckCoverage filters by `validated`).
  const invalidNew = newCandidates.filter(c => !c.validated)
  // `otherExisting` objects are returned as-is (untouched ones) or
  // in-place-mutated (neighbors that absorbed a dropped new candidate's
  // sourceUnitIds/sourceRelationIds above) — never re-created, never
  // re-scored, never removed.
  const cards = [...otherExisting, ...survivingNew, ...invalidNew]

  const diagnostics: RepairDedupDiagnostics = {
    newCards: newCandidates.length,
    existingNeighborCardsConsidered: neighborExisting.length,
    candidatePairs: pairsEvaluated,
    deterministicResolved: deterministicResolvedCount,
    ambiguousPairs: ambiguousPairs.length,
    judgeBatches: judgeBatchSizes.length,
    judgeCalls: judgeBatchSizes.length,
    judgeBatchSizes,
    judgeBatchDurationsMs,
    mergedCount: removed.size,
  }

  return { cards, mergedCount: removed.size, diagnostics }
}
