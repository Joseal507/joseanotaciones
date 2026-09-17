import type { MaterialBrain } from './types'
import { resolveMaterialAcademicStability, isAcademicallyStable, type AcademicStability } from './academicStability'

// ============================================================
// Material Capabilities — the single place any tool consults to
// decide what it can safely do RIGHT NOW, without gating the whole
// Free Mode hub behind full rich enrichment. Derived, never stored.
// ============================================================

export interface MaterialCapabilities {
  /** Selected source is faithfully, conservatively represented — 100% coverage, exact provenance. Hub-gate contract. */
  sourceReady: boolean
  /** At least some rich (provider-derived) KnowledgeUnits exist. */
  unitsReady: boolean
  /** Real Brain relations exist — required for matching/multi_select/relation-dependent question types, Study Map edges, etc. */
  relationsReady: boolean
  /** Optional visual enrichment is either not required or complete — never blocks anything by itself. */
  visionReady: boolean
  /** 0-100. From meta.extractionQuality.richPercent — how much of required source has RICH (not fallback) representation. */
  richCoveragePercent: number
  /**
   * Whole-brain enrichment is done — every leaf either has rich units
   * or is legitimately complete_no_content. Exam requires this: it
   * must never construct a "100% blueprint" from a transient,
   * still-enriching target universe.
   */
  examReady: boolean
  /**
   * Canonical academic-stability verdict for this exact Brain — see
   * academicStability.ts. This is the SINGLE authority every artifact-
   * creating tool below gates on. 'preparing' = the academic universe
   * (KnowledgeUnits/relations) can still change automatically;
   * 'stable_rich'/'stable_degraded' = it cannot (only an explicit
   * regenerate could produce a new revision); 'failed' = no usable
   * representation exists.
   */
  academicStability: AcademicStability

  // ── Tool-level readiness — the CANONICAL decision for each tool's
  // actual academic dependency, derived here ONCE so no route
  // reimplements its own ad-hoc brainEnrichment check.
  //
  // Product decision (P0, "Material Brain debe tener un final real y
  // estable"): correctness over opening a few seconds earlier. A
  // fallback unit CAN be silently replaced by N rich units with
  // different ids once enrichment proceeds — so ANY tool that CREATES a
  // new academic artifact/evaluation must wait for the Brain to reach a
  // TERMINAL, non-drifting state (stable_rich OR stable_degraded —
  // both are equally safe, see academicStability.ts), never merely
  // unitsReady/enrichmentReady in isolation.
  //
  //   alaiChatReady   = sourceReady only (Full Source Index is primary authority; Brain is optional enrichment — explicitly exempt from the stability gate)
  //   repasarReady/flashcardsReady/analysisReady/quizReady/examReady/studyMapReady/truquitosReady
  //                   = sourceReady && isAcademicallyStable(academicStability)
  //     (every one of these tools CREATES a new academic artifact from
  //     KnowledgeUnits/relations — none of them may start from a
  //     universe that can still change underneath the generated content)
  alaiChatReady: boolean
  repasarReady: boolean
  flashcardsReady: boolean
  quizReady: boolean
  analysisReady: boolean
  studyMapReady: boolean
  truquitosReady: boolean
}

// ============================================================
// Canonical Free Mode tool -> required capability authority (P0 tool
// readiness gate). Nothing outside this map should ever decide what a
// tool needs — a route or a UI component re-deriving its own ad-hoc
// "brain enrichment done?" boolean is exactly the drift this exists to
// prevent. Every key here mirrors the *Ready field comments above —
// change the requirement in ONE place if it ever needs to change.
// ============================================================
export type FreeTool =
  | 'flashcards' | 'quiz' | 'repasar' | 'analisis' | 'alai' | 'exam' | 'studyMap' | 'truquitos'

const TOOL_CAPABILITY_KEY: Record<FreeTool, keyof MaterialCapabilities> = {
  flashcards: 'flashcardsReady',
  quiz: 'quizReady',
  repasar: 'repasarReady',
  analisis: 'analysisReady',
  alai: 'alaiChatReady',
  exam: 'examReady',
  studyMap: 'studyMapReady',
  truquitos: 'truquitosReady',
}

/**
 * The single yes/no a hub click handler or a tool route needs: "can
 * THIS tool run correctly RIGHT NOW against THIS exact Material Brain
 * state?" Never confuse this with HTTP 200, sourceReady alone, or a
 * brain.meta.status !== 'failed' check — each tool gets exactly the
 * capability it actually depends on (see the *Ready comments in
 * MaterialCapabilities), no more, no less.
 */
export function canUseFreeTool(tool: FreeTool, capabilities: MaterialCapabilities | null | undefined): boolean {
  if (!capabilities) return false
  return !!capabilities[TOOL_CAPABILITY_KEY[tool]]
}

export function resolveMaterialCapabilities(brain: MaterialBrain | null | undefined): MaterialCapabilities {
  if (!brain) {
    return {
      sourceReady: false, unitsReady: false, relationsReady: false, visionReady: false, richCoveragePercent: 0,
      examReady: false, academicStability: 'preparing', alaiChatReady: false, repasarReady: false,
      flashcardsReady: false, quizReady: false, analysisReady: false, studyMapReady: false, truquitosReady: false,
    }
  }
  const sourceReady = (brain.meta.sourceReadiness ?? (brain.meta.status === 'ready' ? 'ready' : 'preparing')) === 'ready'
  const brainEnrichment = brain.meta.brainEnrichment
  // A legacy brain (built before this field existed) is treated as
  // fully enriched — it went through the old single-pass rich pipeline.
  const enrichmentReady = brainEnrichment === undefined || brainEnrichment === 'ready'
  const richPercent = brain.meta.extractionQuality?.richPercent ?? (enrichmentReady ? 100 : 0)
  const visionReady = !brain.visualCoverage || brain.visualCoverage.status === 'complete' || brain.visualCoverage.status === 'not_required'
  const unitsReady = sourceReady && (richPercent > 0 || brain.units.length > 0)
  const relationsReady = sourceReady && enrichmentReady && brain.relations.length > 0
  const academicStability = resolveMaterialAcademicStability(brain)
  // unitsReady stays a required AND, not subsumed by stability: it
  // guards the rare in-flight-write race (sourceReady:true but the
  // units array is still literally empty) independent of the
  // stability verdict — a brain can be "stable" over zero units in a
  // pathological empty-material edge case, which must never be treated
  // as a generatable target universe.
  const stableForArtifacts = sourceReady && unitsReady && isAcademicallyStable(academicStability)
  // examReady now means exactly the same thing as every other artifact
  // tool below — stability, not merely enrichmentReady (a stable_degraded
  // Brain is a legitimate, permanent state, and Exam's "never a
  // transient 100% blueprint" concern is satisfied by stability just as
  // much as by full richness).
  const examReady = stableForArtifacts

  return {
    sourceReady, unitsReady, relationsReady, visionReady, richCoveragePercent: richPercent, examReady, academicStability,
    alaiChatReady: sourceReady,
    repasarReady: stableForArtifacts,
    flashcardsReady: stableForArtifacts,
    quizReady: stableForArtifacts,
    analysisReady: stableForArtifacts,
    studyMapReady: stableForArtifacts,
    truquitosReady: stableForArtifacts,
  }
}
