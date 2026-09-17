import type { Material, MaterialKind, MaterialText } from '../materials/types'
import { getMaterial, getMaterialText, resolveStudyKind } from '../materials/repository'
import { buildSourceSelectionSnapshot, filterTextToSelectedUnits } from '../adaptive/sourceSelection'
import type { BrainScope, ResolvedSourceMaterial } from './types'

// ============================================================
// Resolución de ResolvedSourceMaterial[] a partir de una selección
// canónica de materiales + páginas.
//
// Reutiliza exactamente el mismo patrón que
// app/api/enfoques/teorico/start/route.ts:
//   getMaterial (ownership) → getMaterialText → resolveStudyKind →
//   filterTextToSelectedUnits.
//
// Los loaders son inyectables para tests; la ruta API usa los reales
// de repository.ts.
// ============================================================

export interface MaterialLoaders {
  getMaterial: (id: string, userId: string) => Promise<Material | null>
  getMaterialText: (id: string) => Promise<MaterialText | null>
  resolveStudyKind: (material: Pick<Material, 'kind' | 'normalized_kind'>) => MaterialKind
}

const defaultLoaders: MaterialLoaders = {
  getMaterial,
  getMaterialText,
  resolveStudyKind,
}

export async function resolveSourceMaterialsForBrain(
  userId: string,
  materialIds: string[],
  selectedPages: Record<string, number[]>,
  loaders: MaterialLoaders = defaultLoaders,
): Promise<{ scope: BrainScope; materials: ResolvedSourceMaterial[] }> {
  const scope = buildSourceSelectionSnapshot(materialIds, selectedPages)

  if (scope.materialIds.length === 0) {
    throw new Error('NO_MATERIALS')
  }
  if (scope.materialIds.length > 5) {
    throw new Error('TOO_MANY_MATERIALS')
  }

  const materials: ResolvedSourceMaterial[] = []

  await Promise.all(
    scope.materialIds.map(async (materialId) => {
      const material = await loaders.getMaterial(materialId, userId)
      if (!material) {
        throw new Error(`MATERIAL_NOT_FOUND:${materialId}`)
      }

      // Canonical source of truth: material.text_status tells us whether
      // extraction/OCR is still running. Distinguish pending/processing from
      // a real failure so callers can poll instead of treating it as fatal.
      if (material.text_status === 'pending' || material.text_status === 'processing') {
        throw new Error(`MATERIAL_TEXT_PENDING:${materialId}:${material.text_status}`)
      }

      const studyKind = loaders.resolveStudyKind(material)
      const storageKey = material.normalized_storage_key || material.storage_key
      const canResolveVisually = studyKind === 'pdf' && Boolean(storageKey)
      const textRecord = await loaders.getMaterialText(materialId)
      if (!textRecord?.raw_text?.trim() && !canResolveVisually) {
        throw new Error(`MATERIAL_TEXT_UNAVAILABLE:${materialId}`)
      }

      const pagesForMaterial = scope.selectedPages[materialId] || []
      const authorizedText = textRecord?.raw_text
        ? filterTextToSelectedUnits(textRecord.raw_text, studyKind, pagesForMaterial)
        : ''

      if (pagesForMaterial.length > 0 && !authorizedText.trim() && !(studyKind === 'pdf' && storageKey)) {
        throw new Error(`AUTHORIZED_PAGES_UNAVAILABLE:${materialId}`)
      }

      materials.push({
        materialId,
        nombre: material.nombre,
        kind: studyKind,
        text: authorizedText,
        knownPages: pagesForMaterial.length > 0 ? pagesForMaterial : undefined,
        storageKey: studyKind === 'pdf' ? storageKey : undefined,
      })
    }),
  )

  materials.sort((a, b) => a.materialId.localeCompare(b.materialId))
  return { scope, materials }
}
