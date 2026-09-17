import { createHash } from 'node:crypto'
import { getMaterialResult, saveMaterialResult } from '../materials/repository'

// ============================================================
// Durable Análisis artifact — server-side durability for the
// StudyalMaterialEnjoyer-native grounded Análisis result (see
// app/api/analizar-teorico/route.ts's handleGroundedAnalysisRequest).
//
// Reuses the SAME material_results table / getMaterialResult /
// saveMaterialResult primitives every other artifact store in this
// codebase already uses (repasoArtifactStore.ts, examGenerationStore.ts,
// materialEnjoyer.ts) — a new result_type ('analysis_enjoyer_artifact')
// keeps this fully isolated from:
//   - the legacy documentos-based chunk pipeline's OWN 'analysis'
//     result_type (app/api/analizar-teorico/route.ts, keyed by raw
//     materialId + enfoque 'teorico' — untouched, different key shape)
//   - Material Brain ('material_brain')
//   - StudyalMaterialEnjoyer itself ('material_enjoyer')
//
// IDENTITY: unlike the Enjoyer (material-derived, shared across users),
// an Análisis artifact is personalized (mastery-aware prompt, nivel),
// so identity is a hash of SERVER-RESOLVED (never client-supplied)
// userId + sourceSelectionFingerprint + nivel — mirroring
// examGenerationStore.ts's examGenerationIdentity() convention exactly.
// A forged client fingerprint/materialIds can never select another
// user's or another selection's artifact: the hash only ever matches
// when userId came from the authenticated session and fingerprint came
// from the authoritative resolved SourceSelectionSnapshot.
// ============================================================

export const ANALYSIS_ARTIFACT_SCHEMA_VERSION = 1
export const ANALYSIS_ARTIFACT_RESULT_TYPE = 'analysis_enjoyer_artifact' as const
const ANALYSIS_ARTIFACT_ENFOQUE = 'teorico' as const

export interface AnalysisArtifact {
  schemaVersion: number
  /** ANALYSIS_ENJOYER_ADAPTER_VERSION at persist time — a bump invalidates old artifacts (treated as MISS, never served). */
  generatorVersion: string
  userId: string
  sourceSelectionFingerprint: string
  nivel: string
  /** The exact `analisis` payload previously returned to the client — restoring it must render identically. */
  analisis: unknown
  createdAt: string
  updatedAt: string
}

export function analysisArtifactIdentity(userId: string, fingerprint: string, nivel: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ userId, fingerprint, nivel, v: ANALYSIS_ARTIFACT_SCHEMA_VERSION }))
    .digest('hex')
}

function analysisArtifactMaterialId(identity: string): string {
  return `analysis_artifact:${identity}`
}

export interface AnalysisArtifactStore {
  get(identity: string): Promise<AnalysisArtifact | null>
  set(identity: string, artifact: AnalysisArtifact): Promise<void>
}

export interface WorkerAnalysisArtifactStoreDeps {
  getMaterialResult?: typeof getMaterialResult
  saveMaterialResult?: typeof saveMaterialResult
}

export class WorkerAnalysisArtifactStore implements AnalysisArtifactStore {
  private getResult: typeof getMaterialResult
  private saveResult: typeof saveMaterialResult

  constructor(deps: WorkerAnalysisArtifactStoreDeps = {}) {
    this.getResult = deps.getMaterialResult || getMaterialResult
    this.saveResult = deps.saveMaterialResult || saveMaterialResult
  }

  async get(identity: string): Promise<AnalysisArtifact | null> {
    const result = await this.getResult(analysisArtifactMaterialId(identity), ANALYSIS_ARTIFACT_ENFOQUE, ANALYSIS_ARTIFACT_RESULT_TYPE)
    const payload = result?.payload
    if (!payload || typeof payload !== 'object') return null
    return payload as AnalysisArtifact
  }

  async set(identity: string, artifact: AnalysisArtifact): Promise<void> {
    const storageId = analysisArtifactMaterialId(identity)
    await this.saveResult({
      id: storageId,
      material_id: storageId,
      enfoque: ANALYSIS_ARTIFACT_ENFOQUE,
      result_type: ANALYSIS_ARTIFACT_RESULT_TYPE,
      payload: artifact,
      content_hash: identity,
    })
  }
}

/**
 * Defense-in-depth on top of the identity hash: a restored artifact
 * must ALSO carry the exact same userId/fingerprint/nivel and a
 * schema/generator version this route still knows how to render.
 * Never trusts the hash alone.
 */
export function isValidRestorableArtifact(
  artifact: AnalysisArtifact | null,
  expected: { userId: string; fingerprint: string; nivel: string; generatorVersion: string },
): artifact is AnalysisArtifact {
  if (!artifact) return false
  return (
    artifact.schemaVersion === ANALYSIS_ARTIFACT_SCHEMA_VERSION &&
    artifact.generatorVersion === expected.generatorVersion &&
    artifact.userId === expected.userId &&
    artifact.sourceSelectionFingerprint === expected.fingerprint &&
    artifact.nivel === expected.nivel
  )
}
