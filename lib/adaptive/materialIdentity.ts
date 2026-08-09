export type MaterialIdentity = {
  materialId?: unknown
  id?: unknown
}

export type MaterialBoundMastery = {
  materialId?: unknown
}

export type MaterialBoundProgram = {
  materialId?: unknown
  graphMicroIds?: unknown
  sessions?: unknown
}

function normalizedId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveCanonicalMaterialIdentity<T extends MaterialBoundMastery>(
  materials: MaterialIdentity[],
  baseMastery: T | null,
): { currentMaterialId: string; compatibleMastery: T | null } {
  const current = materials[0]
  const currentMaterialId = normalizedId(current?.materialId) || normalizedId(current?.id)
  const masteryMaterialId = normalizedId(baseMastery?.materialId)

  return {
    currentMaterialId,
    compatibleMastery: currentMaterialId && masteryMaterialId === currentMaterialId ? baseMastery : null,
  }
}

export function validateAdaptiveProgramIdentity(
  program: MaterialBoundProgram | null,
  currentMaterialId: string,
  currentGraphMicroIds: string[],
): boolean {
  if (!program || normalizedId(program.materialId) !== normalizedId(currentMaterialId)) return false

  const graphIds = new Set(currentGraphMicroIds.map(normalizedId).filter(Boolean))
  if (graphIds.size === 0 || !Array.isArray(program.graphMicroIds)) return false

  const programGraphIds = program.graphMicroIds.map(normalizedId).filter(Boolean)
  if (programGraphIds.length !== graphIds.size || programGraphIds.some(id => !graphIds.has(id))) return false
  if (!Array.isArray(program.sessions)) return false

  return program.sessions.every(session => {
    if (!session || typeof session !== 'object') return false
    const assigned = Reflect.get(session, 'assignedMicroIds')
    const required = Reflect.get(session, 'requiredMicroIds')
    const retention = Reflect.get(session, 'retentionMicroIds')
    const ids = [assigned, required, retention]
      .filter(Array.isArray)
      .flatMap(values => values.map(normalizedId).filter(Boolean))
    return ids.every(id => graphIds.has(id))
  })
}
