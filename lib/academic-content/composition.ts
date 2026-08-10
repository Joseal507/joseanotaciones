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
  // 'blank' representa un hueco de word_bank — visualmente ocupa el lugar de
  // una palabra/valor, así que debe recibir el mismo tratamiento de espaciado
  // que quantity/math/chemistry (sin esto, "de ___" nunca recibía el espacio
  // antes del hueco, porque 'blank' no entraba en ninguna de las dos ramas).
  return node.type === 'quantity' || node.type === 'math' || node.type === 'chemistry' || node.type === 'blank'
}

const nodeStartsWordLike = (node: AcademicNode): boolean => {
  node = firstLeaf(node)
  if (node.type === 'text' || node.type === 'unit' || node.type === 'symbol' || node.type === 'code') {
    return WORD_START.test(node.value.trimStart())
  }
  return node.type === 'quantity' || node.type === 'math' || node.type === 'chemistry' || node.type === 'blank'
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

// Convierte el texto de una opci\u00f3n de word_bank en una sustituci\u00f3n SEGURA
// para insertar dentro de un fuente LaTeX (reemplazando \square en un span
// matem\u00e1tico que contiene un hueco \u2014 ver parser.ts:buildMathValue). Nunca
// deja pasar texto arbitrario del banco de palabras directo a KaTeX: un
// valor puramente num\u00e9rico se inserta crudo (para que renderice como n\u00famero
// real dentro de la posici\u00f3n matem\u00e1tica, p.ej. un exponente), cualquier otra
// cosa se escapa y se envuelve en \text{} \u2014 evita tanto errores de parseo
// como que un option.text controlado por el generador termine inyectando
// comandos LaTeX no previstos.
const LATEX_SAFE_NUMBER = /^-?\d+(?:[.,]\d+)?$/
export function toLatexSafeText(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '\\square'
  if (LATEX_SAFE_NUMBER.test(trimmed)) return trimmed.replace(',', '.')
  const escaped = trimmed
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}%&#$_^~])/g, '\\$1')
  return `\\text{${escaped}}`
}
