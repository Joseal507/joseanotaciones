export interface SourceSelectionSnapshot {
  materialIds: string[]
  selectedPages: Record<string, number[]>
  fingerprint: string
}

function hash(text: string): string {
  let first = 2166136261
  let second = 0x9e3779b9
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    first = Math.imul(first ^ code, 16777619)
    second = Math.imul(second ^ code, 16777619)
  }
  return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0')
}

export function canonicalizeSelectedPages(pages: unknown): number[] {
  if (!Array.isArray(pages)) return []
  return [...new Set(pages.map(Number).filter(page => Number.isInteger(page) && page > 0))].sort((a, b) => a - b)
}

export function buildSourceSelectionSnapshot(
  materialIds: unknown,
  selectedPages: unknown,
): SourceSelectionSnapshot {
  const ids = [...new Set((Array.isArray(materialIds) ? materialIds : [])
    .map(id => String(id || '').trim()).filter(Boolean))].slice(0, 5)
  const rawPages = selectedPages && typeof selectedPages === 'object'
    ? selectedPages as Record<string, unknown>
    : {}
  const pagesByMaterial = Object.fromEntries(
    [...ids].sort().map(id => [id, canonicalizeSelectedPages(rawPages[id])]),
  )
  const payload = JSON.stringify({ materialIds: [...ids].sort(), selectedPages: pagesByMaterial })
  return { materialIds: ids, selectedPages: pagesByMaterial, fingerprint: hash(payload) }
}

export function sourceSelectionFingerprint(materialIds: unknown, selectedPages: unknown): string {
  return buildSourceSelectionSnapshot(materialIds, selectedPages).fingerprint
}

/**
 * Recorta texto paginado a la selección autorizada. Una selección vacía conserva
 * el comportamiento legacy de "material completo". Si existe una selección
 * explícita pero el texto no conserva marcadores de página, falla cerrado para
 * impedir enviar al pipeline contenido cuya procedencia no puede demostrarse.
 */
export function filterTextToSelectedPages(text: string, selectedPages: unknown): string {
  const selected = canonicalizeSelectedPages(selectedPages)
  if (!selected.length) return String(text || '')
  const source = String(text || '')
  const marker = /\[(?:P[aá]gina|Pagina)\s+(\d+)\]/gi
  const matches = [...source.matchAll(marker)]
  if (!matches.length) return ''
  const allowed = new Set(selected)
  const chunks: string[] = []
  for (let index = 0; index < matches.length; index++) {
    const page = Number(matches[index][1])
    if (!allowed.has(page)) continue
    const start = matches[index].index!
    const end = index + 1 < matches.length ? matches[index + 1].index! : source.length
    chunks.push(source.slice(start, end).trim())
  }
  return chunks.join('\n\n')
}

export function prepareCanonicalSourceMaterials<T extends { materialId: string; text: string; selectedPages?: number[] }>(
  materials: T[],
): { snapshot: SourceSelectionSnapshot; materials: T[] } {
  const snapshot = buildSourceSelectionSnapshot(
    materials.map(material => material.materialId),
    Object.fromEntries(materials.map(material => [material.materialId, material.selectedPages || []])),
  )
  const byId = new Map(materials.map(material => [String(material.materialId || '').trim(), material]))
  return {
    snapshot,
    materials: snapshot.materialIds.map(materialId => ({
      ...byId.get(materialId)!,
      materialId,
      selectedPages: snapshot.selectedPages[materialId],
      text: filterTextToSelectedPages(byId.get(materialId)!.text, snapshot.selectedPages[materialId]),
    })),
  }
}
