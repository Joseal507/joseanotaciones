import type { AcademicNode } from './types'

const WORD_END = /[\p{L}\p{N}]$/u
const WORD_START = /^[\p{L}\p{N}]/u
const NO_SPACE_BEFORE = /^[,.;:?!%\)\]\}]/u
const NO_SPACE_AFTER = /[\(\[\{]$/u

const firstLeaf = (node: AcademicNode): AcademicNode => {
  if ('children' in node && node.children.length) return firstLeaf(node.children[0])
  return node
}

const lastLeaf = (node: AcademicNode): AcademicNode => {
  if ('children' in node && node.children.length) return lastLeaf(node.children[node.children.length - 1])
  return node
}

const nodeEndsWordLike = (node: AcademicNode): boolean => {
  node = lastLeaf(node)
  if (node.type === 'text' || node.type === 'unit' || node.type === 'symbol' || node.type === 'code') {
    return WORD_END.test(node.value.trimEnd())
  }
  return node.type === 'quantity' || node.type === 'math' || node.type === 'chemistry'
}

const nodeStartsWordLike = (node: AcademicNode): boolean => {
  node = firstLeaf(node)
  if (node.type === 'text' || node.type === 'unit' || node.type === 'symbol' || node.type === 'code') {
    return WORD_START.test(node.value.trimStart())
  }
  return node.type === 'quantity' || node.type === 'math' || node.type === 'chemistry'
}

export function academicNodeBoundary(previous: AcademicNode | undefined, current: AcademicNode): string {
  if (!previous || previous.type === 'line_break' || current.type === 'line_break') return ''
  const previousLeaf = lastLeaf(previous)
  const currentLeaf = firstLeaf(current)
  if (currentLeaf.type === 'text' && /^\s/u.test(currentLeaf.value)) return ''
  if ((previousLeaf.type === 'text' || previousLeaf.type === 'unit') && /\s$/u.test(previousLeaf.value)) return ''
  if (currentLeaf.type === 'text' && NO_SPACE_BEFORE.test(currentLeaf.value.trimStart())) return ''
  if (previousLeaf.type === 'text' && NO_SPACE_AFTER.test(previousLeaf.value.trimEnd())) return ''
  if (nodeEndsWordLike(previous) && nodeStartsWordLike(current)) return ' '
  return ''
}

export function quantityText(value: string, unit: string): string {
  return unit ? unit === '%' ? `${value}%` : `${value}\u00a0${unit}` : value
}
