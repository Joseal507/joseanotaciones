import {
  getMaterialResult,
  saveMaterialResult,
} from '../materials/repository'
import {
  isRepasoArtifact,
  type RepasoArtifact,
} from './repasoArtifact'

const REPASO_ARTIFACT_ENFOQUE = 'mixto' as const
const REPASO_ARTIFACT_RESULT_TYPE = 'repaso_artifact' as const

function repasoArtifactMaterialId(artifactId: string): string {
  return `repaso_artifact:${artifactId}`
}

export interface RepasoArtifactStore {
  get(artifactId: string): Promise<RepasoArtifact | null>
  set(artifact: RepasoArtifact): Promise<void>
}

export interface WorkerRepasoArtifactStoreDeps {
  getMaterialResult?: typeof getMaterialResult
  saveMaterialResult?: typeof saveMaterialResult
}

export class WorkerRepasoArtifactStore implements RepasoArtifactStore {
  private getResult: typeof getMaterialResult
  private saveResult: typeof saveMaterialResult

  constructor(deps: WorkerRepasoArtifactStoreDeps = {}) {
    this.getResult = deps.getMaterialResult || getMaterialResult
    this.saveResult = deps.saveMaterialResult || saveMaterialResult
  }

  async get(artifactId: string): Promise<RepasoArtifact | null> {
    const result = await this.getResult(
      repasoArtifactMaterialId(artifactId),
      REPASO_ARTIFACT_ENFOQUE,
      REPASO_ARTIFACT_RESULT_TYPE,
    )

    const payload = result?.payload

    if (!payload) return null
    if (!isRepasoArtifact(payload)) return null
    if ((payload as RepasoArtifact).artifactId !== artifactId) return null

    return payload as RepasoArtifact
  }

  async set(artifact: RepasoArtifact): Promise<void> {
    const storageId = repasoArtifactMaterialId(artifact.artifactId)

    await this.saveResult({
      id: storageId,
      material_id: storageId,
      enfoque: REPASO_ARTIFACT_ENFOQUE,
      result_type: REPASO_ARTIFACT_RESULT_TYPE,
      payload: artifact,
      content_hash:
        `${artifact.schemaVersion}::${artifact.initial.fingerprint}::${artifact.artifactId}`,
    })
  }
}

export {
  REPASO_ARTIFACT_ENFOQUE,
  REPASO_ARTIFACT_RESULT_TYPE,
  repasoArtifactMaterialId,
}
