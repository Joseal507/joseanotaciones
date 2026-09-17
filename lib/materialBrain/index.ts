import type { BrainScope, MaterialBrain, ResolvedSourceMaterial } from './types'
import { buildMaterialBrain, type BuildOptions } from './build'
import { FileMaterialBrainStore, lookupMaterialBrain, type MaterialBrainStore } from './cache'

export * from './types'
export * from './identity'
export * from './chunking'
export * from './extraction'
export * from './merge'
export * from './coverage'
export * from './multimodal'
export { buildMaterialBrain, MATERIAL_BRAIN_BUILDER_VERSION, type BuildOptions } from './build'
export { FileMaterialBrainStore, InMemoryMaterialBrainStore, lookupMaterialBrain, type MaterialBrainStore } from './cache'
export { WorkerMaterialResultStore, getOrBuildProductionBrain, createBuildingPlaceholder, type ProductionBuildOptions } from './productionStore'
export { resolveSourceMaterialsForBrain, type MaterialLoaders } from './resolve'

/**
 * usuario confirma materiales/páginas -> fingerprint -> busca Brain
 * -> ready+versión correcta => RESTORE -> si no, BUILD.
 *
 * Un Brain 'partial' cacheado NUNCA se devuelve como si estuviera
 * completo — se reintenta reconstruir (con retry dirigido dentro de
 * buildMaterialBrain, no desde cero innecesariamente en la práctica
 * de producción; en esta fase el store no distingue "reconstruir
 * solo lo faltante de un partial anterior" — ver decisiones abiertas).
 */
export async function getOrBuildMaterialBrain(
  scope: BrainScope,
  materials: ResolvedSourceMaterial[],
  store: MaterialBrainStore = new FileMaterialBrainStore(),
  options: BuildOptions = {},
): Promise<MaterialBrain> {
  const lookup = await lookupMaterialBrain(store, scope.fingerprint)
  if (lookup.status === 'ready' && lookup.brain) return lookup.brain

  const brain = await buildMaterialBrain(scope, materials, options)
  await store.set(scope.fingerprint, brain)
  return brain
}
