import { getMaterialResult, saveMaterialResult } from '../materials/repository'

// ============================================================
// StudyalMaterialEnjoyer — Phase 1
//
// Adaptive's existing "blueprint" generation (app/api/adaptive/
// blueprint/route.ts) already produces a purely material-derived
// academic analysis (topics, ordered content blocks with
// concepts/definitions/formulas/facts/examples, a deduplicated
// concept index, coverage summary) — confirmed by inspection: the
// route accepts `userProfile`/`adaptiveSetup` in its request body but
// NEVER reads either field anywhere in the generation path. The full
// existing blueprint payload is therefore already 100% material-
// derived; nothing user/session-specific needs to be stripped out for
// this to become a shared authority.
//
// This module does NOT reimplement that generation. It is a thin,
// generic, restore-first persistence wrapper — the SAME architectural
// pattern lib/materialBrain/productionStore.ts already uses for
// Material Brain (material_id = "<prefix>:<fingerprint>", keyed by
// the exact same buildSourceSelectionSnapshot fingerprint everything
// else in the app uses) — applied to whatever payload the CALLER's
// existing generation logic produces. The blueprint route calls
// getOrCreateStudyalMaterialEnjoyer with its own generation closure;
// Free Mode's read path calls the store directly for a lookup-only
// restore. Neither duplicates the analysis logic itself.
//
// Explicitly NOT touched or duplicated here: Material Brain (frozen,
// per instruction), the blueprint route's extraction/vision/topic-
// building logic (reused via closure injection, not reimplemented).
// ============================================================

export const MATERIAL_ENJOYER_RESULT_TYPE = 'material_enjoyer' as const
export const MATERIAL_ENJOYER_ENFOQUE = 'mixto' as const

/**
 * ENJOYER_LANGUAGE_MATH_FIDELITY migration: bumped when a producer
 * change (blueprint route) can make an ALREADY-PERSISTED Enjoyer
 * academically wrong in a way that reusing the same fingerprint would
 * otherwise silently keep serving forever (e.g. the topic-extraction
 * language bug fixed here — a correct fingerprint match says nothing
 * about whether the CONTENT was produced correctly). Any persisted
 * payload missing this exact version is treated as not-matching by
 * isMatchingFingerprint() below, so the next write-path call (Adaptive)
 * regenerates it ONCE; every subsequent read (any tool) restores that
 * corrected artifact with 0 provider calls, exactly like a normal
 * fingerprint match. Bump this again only for a future producer change
 * with the same "existing artifacts are now wrong" property.
 */
export const MATERIAL_ENJOYER_ACADEMIC_VERSION = 2

function enjoyerMaterialId(fingerprint: string): string {
  return `enjoyer:${fingerprint}`
}

export interface MaterialEnjoyerStore {
  get(fingerprint: string): Promise<unknown | null>
  set(fingerprint: string, payload: unknown): Promise<void>
}

/** Production store — same Worker material_results table Material Brain uses, different result_type/key prefix so the two never collide. */
export class WorkerMaterialEnjoyerStore implements MaterialEnjoyerStore {
  async get(fingerprint: string): Promise<unknown | null> {
    const result = await getMaterialResult(enjoyerMaterialId(fingerprint), MATERIAL_ENJOYER_ENFOQUE, MATERIAL_ENJOYER_RESULT_TYPE)
    return result?.payload ?? null
  }

  async set(fingerprint: string, payload: unknown): Promise<void> {
    await saveMaterialResult({
      id: enjoyerMaterialId(fingerprint),
      material_id: enjoyerMaterialId(fingerprint),
      enfoque: MATERIAL_ENJOYER_ENFOQUE,
      result_type: MATERIAL_ENJOYER_RESULT_TYPE,
      payload,
      content_hash: fingerprint,
    })
  }
}

export interface StudyalMaterialEnjoyerLookup {
  status: 'restored' | 'generated'
  payload: unknown
}

/**
 * IDENTITY / SAFETY: a payload is only ever restored when its OWN
 * persisted `sourceSelectionFingerprint` matches the requested
 * fingerprint exactly — never a stale/legacy record served under a
 * reused key, never a fallback to "the closest previous analysis".
 * Changing selectedPages changes the fingerprint, which changes the
 * store key, which guarantees a completely separate authority — the
 * same guarantee lookupMaterialBrain (cache.ts) already provides for
 * Material Brain.
 *
 * COST: if a persisted record already exists for this exact
 * fingerprint, `generate` is NEVER invoked — zero new provider calls,
 * regardless of whether the caller is Adaptive or Free Mode.
 */
export async function getOrCreateStudyalMaterialEnjoyer(
  fingerprint: string,
  store: MaterialEnjoyerStore,
  generate: () => Promise<unknown>,
): Promise<StudyalMaterialEnjoyerLookup> {
  const existing = await store.get(fingerprint)
  if (existing && isMatchingFingerprint(existing, fingerprint)) {
    return { status: 'restored', payload: existing }
  }
  const payload = await generate()
  await store.set(fingerprint, payload)
  return { status: 'generated', payload }
}

export async function lookupStudyalMaterialEnjoyer(
  fingerprint: string,
  store: MaterialEnjoyerStore,
): Promise<unknown | null> {
  try {
    const existing = await store.get(fingerprint)
    return existing && isMatchingFingerprint(existing, fingerprint) ? existing : null
  } catch {
    return null
  }
}

function isMatchingFingerprint(payload: unknown, fingerprint: string): boolean {
  const candidate = payload as {
    sourceSelectionFingerprint?: unknown
    enjoyerAcademicVersion?: unknown
    blueprint?: { sourceSelectionFingerprint?: unknown; enjoyerAcademicVersion?: unknown }
  } | null
  const stored = candidate?.sourceSelectionFingerprint ?? candidate?.blueprint?.sourceSelectionFingerprint
  if (stored !== fingerprint) return false
  // A payload persisted before MATERIAL_ENJOYER_ACADEMIC_VERSION existed
  // (or before it was bumped) has the exact right fingerprint but may
  // carry academically wrong content from an old producer bug — treat
  // it as not-matching so it gets regenerated exactly once.
  const version = candidate?.enjoyerAcademicVersion ?? candidate?.blueprint?.enjoyerAcademicVersion
  return version === MATERIAL_ENJOYER_ACADEMIC_VERSION
}
