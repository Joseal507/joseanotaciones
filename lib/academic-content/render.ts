import katex from 'katex'
import 'katex/contrib/mhchem'
import type { AcademicDocument, AcademicNode } from './types'
import { validateAcademicDocument } from './validation'
import { academicNodeBoundary, quantityText } from './composition'

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function renderNode(node: AcademicNode): string {
  switch (node.type) {
    case 'text': return escapeHtml(node.value)
    case 'strong': return `<strong>${renderNodes(node.children)}</strong>`
    case 'emphasis': return `<em>${renderNodes(node.children)}</em>`
    case 'strike': return `<del>${renderNodes(node.children)}</del>`
    case 'paragraph': return `<p>${renderNodes(node.children)}</p>`
    case 'heading': return `<h${node.level}>${renderNodes(node.children)}</h${node.level}>`
    case 'link': return `<a href="${escapeHtml(node.href)}" rel="noopener noreferrer">${renderNodes(node.children)}</a>`
    case 'callout': return `<aside data-academic-callout="${node.kind}">${renderNodes(node.children)}</aside>`
    case 'symbol': return `<span class="academic-symbol">${escapeHtml(node.value)}</span>`
    case 'unit': return `<span class="academic-unit">${escapeHtml(node.value)}</span>`
    case 'quantity': return `<span class="academic-quantity">${escapeHtml(quantityText(node.value, node.unit))}</span>`
    case 'math':
      return node.source === 'mathml'
        ? node.value
        : katex.renderToString(node.value, { displayMode: node.display, throwOnError: true, trust: false, strict: 'error', output: 'htmlAndMathml' })
    case 'chemistry':
      return katex.renderToString(`\\ce{${node.value}}`, { displayMode: node.display, throwOnError: true, trust: false, strict: 'error', output: 'htmlAndMathml' })
    case 'code':
      return node.display
        ? `<pre><code${node.language ? ` data-language="${escapeHtml(node.language)}"` : ''}>${escapeHtml(node.value)}</code></pre>`
        : `<code>${escapeHtml(node.value)}</code>`
    case 'blank': return '<span class="academic-blank" aria-label="blank">___</span>'
    case 'line_break': return '<br>'
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul'
      return `<${tag}>${node.items.map(item => `<li>${renderAcademicDocumentToHtml(item)}</li>`).join('')}</${tag}>`
    }
    case 'table':
      return `<table><thead><tr>${node.headers.map(header => `<th>${renderAcademicDocumentToHtml(header)}</th>`).join('')}</tr></thead><tbody>${node.rows.map(row => `<tr>${row.map(cell => `<td>${renderAcademicDocumentToHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    case 'error_fallback': return escapeHtml(node.fallbackText)
  }
}

function renderNodes(nodes: AcademicNode[]): string {
  return nodes.map((node, index) => escapeHtml(academicNodeBoundary(nodes[index - 1], node)) + renderNode(node)).join('')
}

export function renderAcademicDocumentToHtml(document: AcademicDocument): string {
  const validation = validateAcademicDocument(document)
  if (!validation.valid) return '<span data-academic-invalid>Contenido académico no disponible.</span>'
  return renderNodes(document.nodes)
}
