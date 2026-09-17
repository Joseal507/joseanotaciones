import type { MaterialBrain } from './types'

// ============================================================
// Canonical Material Brain readiness — the SINGLE place that decides
// ready/building/partial/failed. build.ts calls this at the end of a
// build; nothing else (productionStore, route, frontend) should ever
// reimplement this decision — they consume brain.meta.status /
// sourceCoverage.status, which are set FROM this function's result.
//
// Rule (Phase 7): required source is "represented" if every selected,
// meaningful block has EITHER a rich provider-derived unit, OR a
// deterministic exact-source fallback unit, OR a deterministic
// complete_no_content classification. Enrichment QUALITY never gates
// readiness — see meta.extractionQuality for that signal separately.
// ============================================================

export interface MaterialBrainReadiness {
  status: MaterialBrain['meta']['status']
  reasons: string[]
}

export function resolveMaterialBrainReadiness(params: {
  sourceCoverageStatus: 'complete' | 'partial' | 'failed'
}): MaterialBrainReadiness {
  if (params.sourceCoverageStatus === 'failed') {
    return { status: 'failed', reasons: ['required_source_not_represented'] }
  }
  if (params.sourceCoverageStatus === 'partial') {
    return { status: 'partial', reasons: ['required_source_partially_represented'] }
  }
  return { status: 'ready', reasons: ['required_source_fully_represented'] }
}
