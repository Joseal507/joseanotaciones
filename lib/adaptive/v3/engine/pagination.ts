// ═══════════════════════════════════════════════════════════════
// PAGINATION ENGINE
// 
// Divide bloques de contenido en "sub-páginas" cuando el
// contenido total excede la altura fija de la hoja.
// 
// Estilo Kindle/Apple Books: nunca hay scroll.
// ═══════════════════════════════════════════════════════════════

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'heading'; text: string; level: 1 | 2 | 3 }
  | { type: 'formula'; plain: string; latex?: string; explanation?: string }
  | { type: 'example'; description: string; solution?: string; keyInsight?: string }
  | { type: 'steps'; steps: Array<{ label: string; content: string; explanation?: string }> }
  | { type: 'callout'; variant: 'info' | 'warning' | 'success' | 'insight'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string; source?: string }
  | { type: 'comparison'; items: Array<{ label: string; description: string }> }

export interface SubPage {
  index: number
  total: number
  tutorMessage?: string
  blocks: ContentBlock[]
  keyIdea?: string
  isLastPage: boolean
  showInteraction: boolean   // La interacción solo va en la última página
}

export interface PageContent {
  tutorMessage?: string
  blocks: ContentBlock[]
  keyIdea?: string
}

// ═══════════════════════════════════════════════════════════════
// ESTIMACIÓN DE ALTURA (en unidades relativas)
// ═══════════════════════════════════════════════════════════════
// Basado en el espacio disponible en la hoja fija.
// Altura total disponible ~ 100 unidades

const HEIGHT_BUDGET = 100

function estimateBlockHeight(block: ContentBlock): number {
  switch (block.type) {
    case 'text': {
      const chars = block.text.length
      // ~120 chars por línea, 4 unidades por línea
      const lines = Math.ceil(chars / 120)
      return lines * 4 + 3
    }
    case 'heading':
      return block.level === 1 ? 10 : block.level === 2 ? 8 : 6
    case 'formula':
      return block.explanation ? 12 : 8
    case 'example': {
      const descLines = Math.ceil((block.description?.length || 0) / 100)
      const solLines = block.solution ? Math.ceil(block.solution.length / 100) : 0
      return 8 + descLines * 3 + solLines * 3
    }
    case 'steps':
      return block.steps.length * 8 + 4
    case 'callout': {
      const lines = Math.ceil((block.text?.length || 0) / 100)
      return lines * 4 + 5
    }
    case 'list':
      return block.items.length * 4 + 4
    case 'quote': {
      const lines = Math.ceil((block.text?.length || 0) / 100)
      return lines * 4 + 6
    }
    case 'comparison':
      return 12
    default:
      return 5
  }
}

// Altura reservada para elementos fijos
const HEADER_HEIGHT = 12       // Título + status
const TUTOR_MSG_HEIGHT = 10    // Mensaje del tutor
const KEY_IDEA_HEIGHT = 10     // Idea clave
const INTERACTION_HEIGHT = 30  // Espacio para la pregunta

// ═══════════════════════════════════════════════════════════════
// PAGINACIÓN INTELIGENTE
// ═══════════════════════════════════════════════════════════════
export function paginateContent(
  content: PageContent,
  hasInteraction: boolean,
): SubPage[] {
  const { tutorMessage, blocks, keyIdea } = content

  // Calcular budget disponible por página
  const baseOverhead = HEADER_HEIGHT
  const firstPageOverhead = baseOverhead + (tutorMessage ? TUTOR_MSG_HEIGHT : 0)
  const lastPageOverhead = baseOverhead
    + (keyIdea ? KEY_IDEA_HEIGHT : 0)
    + (hasInteraction ? INTERACTION_HEIGHT : 8)  // 8 para botón continuar

  // Si todo cabe en una sola página, retornar directamente
  const totalBlocksHeight = blocks.reduce((sum, b) => sum + estimateBlockHeight(b), 0)
  const totalNeeded = firstPageOverhead + totalBlocksHeight + (keyIdea ? KEY_IDEA_HEIGHT : 0) + (hasInteraction ? INTERACTION_HEIGHT : 8)

  if (totalNeeded <= HEIGHT_BUDGET) {
    return [{
      index: 0,
      total: 1,
      tutorMessage,
      blocks,
      keyIdea,
      isLastPage: true,
      showInteraction: hasInteraction,
    }]
  }

  // Necesita paginación: distribuir bloques en sub-páginas
  const pages: SubPage[] = []
  let currentBlocks: ContentBlock[] = []
  let currentHeight = firstPageOverhead

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const blockHeight = estimateBlockHeight(block)

    // ¿Cabe este bloque en la página actual?
    const isLastBlock = i === blocks.length - 1
    const overhead = isLastBlock ? lastPageOverhead : baseOverhead + 8 // 8 para "continuar"
    const availableForBlocks = HEIGHT_BUDGET - (pages.length === 0 ? firstPageOverhead : baseOverhead) - 8

    if (currentHeight + blockHeight > HEIGHT_BUDGET - 8 && currentBlocks.length > 0) {
      // Cerrar página actual
      pages.push({
        index: pages.length,
        total: 0,  // Se rellenará después
        tutorMessage: pages.length === 0 ? tutorMessage : undefined,
        blocks: currentBlocks,
        keyIdea: undefined,
        isLastPage: false,
        showInteraction: false,
      })
      currentBlocks = [block]
      currentHeight = baseOverhead + blockHeight
    } else {
      currentBlocks.push(block)
      currentHeight += blockHeight
    }
  }

  // Última página con los bloques restantes + keyIdea + interaction
  pages.push({
    index: pages.length,
    total: 0,
    tutorMessage: pages.length === 0 ? tutorMessage : undefined,
    blocks: currentBlocks,
    keyIdea,
    isLastPage: true,
    showInteraction: hasInteraction,
  })

  // Actualizar el total en todas las páginas
  const total = pages.length
  pages.forEach(p => { p.total = total })

  return pages
}

// ═══════════════════════════════════════════════════════════════
// HELPERS PÚBLICOS
// ═══════════════════════════════════════════════════════════════
export function shouldShowKeyIdea(subPage: SubPage): boolean {
  return subPage.isLastPage && !!subPage.keyIdea
}

export function shouldShowTutorMessage(subPage: SubPage): boolean {
  return subPage.index === 0 && !!subPage.tutorMessage
}
