export type RepasoReaderPurpose = 'active_reading' | 'recovery_reading'
export type RepasoReaderReturnDestination = 'explanation' | 'recovery_question'
export type BoundedPageItem = number | 'ellipsis-start' | 'ellipsis-end'

export function buildBoundedPageItems(pages: readonly number[], currentPage: number, edgeCount = 2, radius = 2): BoundedPageItem[] {
  const ordered = [...new Set(pages)].sort((a, b) => a - b)
  if (ordered.length <= edgeCount * 2 + radius * 2 + 3) return ordered
  const currentIndex = Math.max(0, ordered.indexOf(currentPage))
  const visible = new Set<number>()
  ordered.slice(0, edgeCount).forEach(page => visible.add(page))
  ordered.slice(-edgeCount).forEach(page => visible.add(page))
  ordered.slice(Math.max(0, currentIndex - radius), currentIndex + radius + 1).forEach(page => visible.add(page))
  const result: BoundedPageItem[] = []
  ordered.forEach((page, index) => {
    if (!visible.has(page)) return
    const previous = result[result.length - 1]
    if (typeof previous === 'number' && ordered.indexOf(previous) < index - 1) {
      result.push(index < currentIndex ? 'ellipsis-start' : 'ellipsis-end')
    }
    result.push(page)
  })
  return result
}

export interface RepasoReaderNavigation {
  materialId: string | null
  selectedPages: number[]
  recommendedPages: number[]
  currentPage: number | null
  purpose: RepasoReaderPurpose
  returnDestination: RepasoReaderReturnDestination
  recoveryGroupId: string | null
  zoom: number
}

export function canonicalReaderPages(pages: readonly number[]) {
  return [...new Set(pages.map(Number).filter(page => Number.isInteger(page) && page > 0))].sort((a, b) => a - b)
}

export function createActiveReaderNavigation(args: {
  materialId: string | null
  selectedPages: readonly number[]
  restoredPage?: number | null
}): RepasoReaderNavigation {
  const selectedPages = canonicalReaderPages(args.selectedPages)
  const restored = Number(args.restoredPage)
  const currentPage = selectedPages.includes(restored) ? restored : (selectedPages[0] || null)
  return {
    materialId: args.materialId,
    selectedPages,
    recommendedPages: [],
    currentPage,
    purpose: 'active_reading',
    returnDestination: 'explanation',
    recoveryGroupId: null,
    zoom: 1.18,
  }
}

export function openRecoveryReader(
  previous: RepasoReaderNavigation,
  args: { materialId: string | null; selectedPages: readonly number[]; recommendedPages: readonly number[]; recoveryGroupId: string },
): RepasoReaderNavigation {
  const selectedPages = canonicalReaderPages(args.selectedPages)
  const recommendedPages = canonicalReaderPages(args.recommendedPages).filter(page => !selectedPages.length || selectedPages.includes(page))
  const sameFrozenReader = previous.purpose === 'recovery_reading'
    && previous.recoveryGroupId === args.recoveryGroupId
    && previous.materialId === args.materialId
  const currentPage = sameFrozenReader && previous.currentPage != null && (!selectedPages.length || selectedPages.includes(previous.currentPage))
    ? previous.currentPage
    : (recommendedPages[0] || selectedPages[0] || null)
  return {
    materialId: args.materialId,
    selectedPages,
    recommendedPages,
    currentPage,
    purpose: 'recovery_reading',
    returnDestination: 'recovery_question',
    recoveryGroupId: args.recoveryGroupId,
    zoom: previous.zoom,
  }
}

export function setRepasoReaderZoom(navigation: RepasoReaderNavigation, zoom: number): RepasoReaderNavigation {
  const normalized = Math.max(.75, Math.min(1.6, Number(zoom) || 1.18))
  return { ...navigation, zoom: normalized }
}

export function moveRepasoReader(
  navigation: RepasoReaderNavigation,
  absolutePage: number,
): RepasoReaderNavigation {
  if (navigation.selectedPages.length && !navigation.selectedPages.includes(absolutePage)) return navigation
  return { ...navigation, currentPage: absolutePage }
}

export function changeRepasoReaderMaterial(
  navigation: RepasoReaderNavigation,
  materialId: string,
  selectedPages: readonly number[],
): RepasoReaderNavigation {
  const pages = canonicalReaderPages(selectedPages)
  if (navigation.materialId === materialId) {
    const currentPage = navigation.currentPage != null && pages.includes(navigation.currentPage)
      ? navigation.currentPage
      : (pages[0] || null)
    return { ...navigation, selectedPages: pages, currentPage }
  }
  return { ...navigation, materialId, selectedPages: pages, recommendedPages: [], currentPage: pages[0] || null }
}
