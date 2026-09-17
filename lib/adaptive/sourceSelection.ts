export interface SourceSelectionSnapshot {
  materialIds: string[]
  selectedPages: Record<string, number[]>
  materials: Array<{ materialId: string; selectedPages: number[] }>
  fingerprint: string
}

export type SourceSelectionInput = Pick<SourceSelectionSnapshot, 'materials' | 'fingerprint'>

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
  return {
    materialIds: ids,
    selectedPages: pagesByMaterial,
    materials: ids.map(materialId => ({ materialId, selectedPages: pagesByMaterial[materialId] || [] })),
    fingerprint: hash(payload),
  }
}

export function hasExplicitPageSelection(snapshot: SourceSelectionSnapshot): boolean {
  return snapshot.materials.length > 0 && snapshot.materials.every(material => material.selectedPages.length > 0)
}

export function mapPageSelectionsToMaterials(
  materials: Array<{ id?: unknown; materialId?: unknown }>,
  selections: unknown,
): Record<string, number[]> {
  const items = Array.isArray(selections) ? selections : []
  const result: Record<string, number[]> = {}
  for (const [index, item] of items.entries()) {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const emittedId = String(record.materialId || record.material_id || record.documentId || record.document_id || '').trim()
    const material = materials.find(candidate =>
      String(candidate.id || '') === emittedId || String(candidate.materialId || candidate.id || '') === emittedId
    ) || materials[index]
    const materialId = String(material?.materialId || material?.id || '').trim()
    if (!materialId) continue
    result[materialId] = canonicalizeSelectedPages(record.pages || record.selectedPages || record.paginasSeleccionadas || record.paginas || record.pageNumbers)
  }
  return result
}

export function stripNonInstructionalBoilerplate(text: string): string {
  return String(text || '')
    .replace(/©\s*\d{4}[^.\n]{0,120}\.?/gi, ' ')
    .replace(/\b(?:copyright|all rights reserved|todos los derechos reservados)\b[^.\n]{0,120}\.?/gi, ' ')
    .replace(/\bprentice[\s-]*hall\b/gi, ' ')
    .replace(/^(?:page|página|slide|diapositiva)\s+\d+\s*$/gim, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
  const formFeedPages = source.split('\f')
  if (formFeedPages.length > 1) {
    return selected
      .map(page => formFeedPages[page - 1]?.trim() ? `[Pagina ${page}]\n${formFeedPages[page - 1].trim()}` : '')
      .filter(Boolean)
      .join('\n\n')
  }
  const marker = /\[(?:P[aá]gina|Pagina|Page)\s+(\d+)\]/gi
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

export interface AuthorizedPageUnit { page: number; text: string }

/**
 * Sibling of filterTextToSelectedPages with per-page granularity (page
 * number + clean text, marker stripped) instead of a single joined
 * string — needed by lib/materials/sourceIndex.ts to build addressable
 * AuthorizedSourceBlocks. Deliberately a SEPARATE implementation (not a
 * refactor of filterTextToSelectedPages) so the already-proven,
 * widely-depended-on legacy function's exact output never changes.
 * Same fail-closed contract: an explicit selection against text with no
 * recognizable page markers yields zero units, never a guess.
 */
export function deriveAuthorizedPageUnits(text: string, selectedPages: unknown): AuthorizedPageUnit[] {
  const selected = canonicalizeSelectedPages(selectedPages)
  const source = String(text || '')
  const formFeedPages = source.split('\f')
  if (formFeedPages.length > 1) {
    const pages = selected.length ? selected : formFeedPages.map((_, i) => i + 1)
    return pages
      .map(page => ({ page, text: formFeedPages[page - 1]?.trim() || '' }))
      .filter(unit => unit.text)
  }
  const marker = /\[(?:P[aá]gina|Pagina|Page)\s+(\d+)\]/gi
  const matches = [...source.matchAll(marker)]
  if (!matches.length) return []
  const allowed = selected.length ? new Set(selected) : null
  const units: AuthorizedPageUnit[] = []
  for (let index = 0; index < matches.length; index++) {
    const page = Number(matches[index][1])
    if (allowed && !allowed.has(page)) continue
    const start = matches[index].index!
    const end = index + 1 < matches.length ? matches[index + 1].index! : source.length
    const chunk = source.slice(start, end).replace(marker, '').trim()
    if (chunk) units.push({ page, text: chunk })
  }
  return units
}

// ═══════════════════════════════════════════════════════════════
// UNIDADES SELECCIONABLES UNIVERSALES
//
// Autoridad única: el wire/persisted shape sigue siendo exactamente
// `selectedPages: Record<string, number[]>` — mismo shape, mismo
// fingerprint, misma columna D1, cero cambio para PDFs/sesiones
// existentes. `SelectedUnit` es una vista TIPADA sobre esos mismos
// enteros: el `type` no es estado propio de la selección, se deriva
// del `kind` del material (un material siempre tiene un solo tipo de
// unidad). Por eso no hay selectedSlides/selectedSections paralelos
// que sincronizar — solo un adapter en cada sentido.
// ═══════════════════════════════════════════════════════════════

// 'slide' (pptx) y 'section' para docx fueron retirados: con el pipeline de
// normalización a PDF, DOCX/PPTX/etc. se convierten a normalized.pdf y
// pasan a ser 'page' como cualquier PDF real — el mismo pipeline maduro
// (raster de páginas, filterTextToSelectedPages) los sirve, sin marcadores
// sintéticos que mantener. 'section' sigue vivo solo para Web (que no se
// convierte a PDF — pipeline aparte).
export type UniversalUnitType = 'page' | 'section' | 'block'

export interface SelectedUnit {
  type: UniversalUnitType
  index: number
}

// Documento completo = selección vacía o ausente, EXACTAMENTE la misma
// semántica que `selectedPages: []` tiene hoy (filterTextToSelectedPages
// ya trata [] como "sin filtrar, texto completo"). No hay un sentinel
// nuevo — mantenerlo así es lo que preserva compatibilidad total.
export function unitTypeForKind(kind: unknown): UniversalUnitType {
  switch (String(kind || '')) {
    case 'web': return 'section'
    case 'txt': return 'block'
    default: return 'page' // pdf (incluido docx/pptx normalizados) y cualquier kind no reconocido
  }
}

// legacy selectedPages (+ kind del material) → canonical selectedUnits
export function toSelectedUnits(kind: unknown, pages: unknown): SelectedUnit[] {
  const type = unitTypeForKind(kind)
  return canonicalizeSelectedPages(pages).map(index => ({ type, index }))
}

// canonical selectedUnits → legacy selectedPages (lo que realmente se
// persiste y se hashea — nunca selectedUnits directamente)
export function fromSelectedUnits(units: unknown): number[] {
  if (!Array.isArray(units)) return []
  return canonicalizeSelectedPages(units.map((u: any) => u?.index))
}

export interface TextUnit { index: number; text: string; label?: string }

function splitByBracketMarker(source: string, markerRegex: RegExp): TextUnit[] {
  const matches = [...source.matchAll(markerRegex)]
  if (!matches.length) return []
  const units: TextUnit[] = []
  for (let i = 0; i < matches.length; i++) {
    const index = Number(matches[i][1])
    const title = matches[i][2] ? matches[i][2].trim() : undefined
    const start = matches[i].index!
    const end = i + 1 < matches.length ? matches[i + 1].index! : source.length
    units.push({ index, text: source.slice(start, end).trim(), label: title || undefined })
  }
  return units
}

const SECTION_MARKER = /\[Secci[oó]n\s+(\d+)(?::\s*([^\]]*))?\]/gi

// Autoridad única de segmentación: usada tanto por filterTextToSelectedUnits
// (autoriza corpus) como por deriveSelectableUnits (labels para la UI) — un
// solo lugar decide qué es "la unidad 2" de un material, para que servidor
// y UI nunca puedan divergir. Solo 'section' (Web) y 'block' (txt) llegan
// acá — 'page' se resuelve aparte vía filterTextToSelectedPages.
function deriveTextUnits(source: string, type: UniversalUnitType): TextUnit[] {
  if (type === 'section') {
    const withHeadings = splitByBracketMarker(source, SECTION_MARKER)
    return withHeadings.length ? withHeadings : splitIntoBlocks(source)
  }
  return splitIntoBlocks(source) // block (txt)
}

// Mismo algoritmo (párrafos acumulados hasta ~1800 chars) que ya usa
// components/materias/SeleccionPaginas.tsx (dividirTextoEnPaginas) para
// mostrarle al usuario "bloque 1, bloque 2..." de DOCX/TXT en el picker.
// Debe coincidir byte a byte con esa lógica: si el picker muestra
// "bloque 2" y el servidor entiende otro corte para "bloque 2", la
// selección autoriza contenido distinto del que el usuario vio y eligió.
function splitIntoBlocks(text: string): TextUnit[] {
  const source = String(text || '').trim()
  if (!source) return []
  const CHARS_PER_BLOCK = 1800
  const paragraphs = source.split(/\n{2,}/).filter(p => p.trim().length > 0)
  const blocks: TextUnit[] = []
  let current = ''
  let index = 1
  for (const paragraph of paragraphs) {
    if ((current + paragraph).length > CHARS_PER_BLOCK && current.length > 0) {
      blocks.push({ index, text: current.trim() })
      current = paragraph + '\n\n'
      index++
    } else {
      current += paragraph + '\n\n'
    }
  }
  if (current.trim().length > 0) blocks.push({ index, text: current.trim() })
  return blocks.length > 0 ? blocks : [{ index: 1, text: source.slice(0, 2000) }]
}

/**
 * Generalización de filterTextToSelectedPages: mismo contrato (selección
 * vacía = documento completo, selección explícita sin marcadores
 * reconocibles = falla cerrado con texto vacío), pero despachando el
 * algoritmo de corte según el tipo de unidad del material. Para
 * kind==='pdf' (o cualquier kind no reconocido) delega 1:1 en
 * filterTextToSelectedPages sin ninguna diferencia de comportamiento —
 * ningún PDF ni sesión existente cambia.
 */
export function filterTextToSelectedUnits(text: string, kind: unknown, selectedPages: unknown): string {
  const type = unitTypeForKind(kind)
  const source = String(text || '')
  if (type === 'page') return filterTextToSelectedPages(source, selectedPages)

  const selected = canonicalizeSelectedPages(selectedPages)
  if (!selected.length) return source

  const units = deriveTextUnits(source, type)
  if (!units.length) return ''
  const allowed = new Set(selected)
  return units.filter(u => allowed.has(u.index)).map(u => u.text).join('\n\n')
}

/**
 * Sibling of filterTextToSelectedUnits for non-'page' kinds (web
 * sections, txt blocks) that returns the individual authorized units
 * instead of a single joined string — used by lib/materials/sourceIndex.ts
 * to build addressable AuthorizedSourceBlocks for kinds other than PDF.
 * Same segmentation authority (deriveTextUnits) as the joined variant,
 * so the source index and filterTextToSelectedUnits can never disagree
 * about what unit N contains.
 */
export function deriveTextUnitsForKind(text: string, kind: unknown, selectedPages: unknown): TextUnit[] {
  const type = unitTypeForKind(kind)
  const source = String(text || '')
  if (type === 'page') return []
  const selected = canonicalizeSelectedPages(selectedPages)
  const units = deriveTextUnits(source, type)
  if (!selected.length) return units
  const allowed = new Set(selected)
  return units.filter(u => allowed.has(u.index))
}

export interface SelectableUnit {
  type: UniversalUnitType
  index: number
  label: string
  preview: string
}

/**
 * Lista de unidades seleccionables con label para la UI de "Elegir qué
 * estudiar" — misma autoridad de segmentación (deriveTextUnits) que usa el
 * filtro que autoriza el corpus, así que lo que el usuario ve y lo que
 * termina filtrado siempre coinciden.
 */
export function deriveSelectableUnits(text: string, kind: unknown): SelectableUnit[] {
  const type = unitTypeForKind(kind)
  const source = String(text || '')
  if (type === 'page') return [] // PDF ya tiene su propio picker (raster de página), no pasa por acá

  const units = deriveTextUnits(source, type)
  const fallbackWord = type === 'section' ? 'Sección' : 'Bloque'
  return units.map(u => ({
    type,
    index: u.index,
    label: u.label || `${fallbackWord} ${u.index}`,
    preview: u.text.slice(0, 240),
  }))
}

export function buildSourceSelectionFromMaterials(
  materials: Array<{ id?: unknown; materialId?: unknown }>,
  selections: unknown,
): SourceSelectionSnapshot {
  const materialIds = materials
    .map(material => String(material.materialId || material.id || '').trim())
    .filter(Boolean)
  return buildSourceSelectionSnapshot(
    materialIds,
    mapPageSelectionsToMaterials(materials, selections),
  )
}

export function validateSourceSelectionInput(input: unknown): SourceSelectionSnapshot | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  if (!Array.isArray(record.materials) || record.materials.length < 1 || record.materials.length > 5) return null
  const materials = record.materials.map(item => {
    const value = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    return {
      materialId: String(value.materialId || '').trim(),
      selectedPages: canonicalizeSelectedPages(value.selectedPages),
    }
  })
  if (materials.some(material => !material.materialId)) return null
  const snapshot = buildSourceSelectionSnapshot(
    materials.map(material => material.materialId),
    Object.fromEntries(materials.map(material => [material.materialId, material.selectedPages])),
  )
  return String(record.fingerprint || '') === snapshot.fingerprint ? snapshot : null
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
