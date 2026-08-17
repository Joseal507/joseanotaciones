'use client'

import katex from 'katex'
import 'katex/contrib/mhchem'
import { Fragment } from 'react'
import { prepareAcademicContentForDelivery } from '../../lib/academic-content/validation'
import type { AcademicDocument, AcademicNode } from '../../lib/academic-content/types'
import { academicNodeBoundary, quantityText } from '../../lib/academic-content/composition'

type BlankRenderer = (node: Extract<AcademicNode, { type: 'blank' }>, index: number) => React.ReactNode
// Resuelve, EN ORDEN, cada hueco ___ que quedó DENTRO de un span matemático
// (parser.ts:buildMathValue lo dejó como \square en node.value) — a
// diferencia de renderBlank (que devuelve un ReactNode independiente), esto
// devuelve el texto LaTeX-seguro a insertar EN la posición matemática real
// (exponente, fracción, raíz...), más un onClick opcional para limpiar el
// hueco (aplicado al span matemático completo — no hay forma segura de
// aislar el click a un glyph individual dentro del HTML que genera KaTeX).
type MathBlankRenderer = () => { latex: string; onClick?: () => void }

interface AcademicContentProps {
  content: string | AcademicDocument
  inline?: boolean
  invalidFallback?: string
  // Permite al llamador (word_bank) renderizar cada hueco como un elemento
  // interactivo real, en vez del "___" estático por defecto — sin esto,
  // word_bank tenía que partir el texto en fragmentos con .split("___") ANTES
  // de parsear, lo que corta a la mitad cualquier span matemático que
  // contuviera el hueco y lo parsea de forma aislada en cada mitad, perdiendo
  // el agrupamiento LaTeX. Con renderBlank, el documento se parsea UNA sola
  // vez, coherente, y el nodo 'blank' ya viene identificado por el tokenizer
  // (que además ya protege los delimitadores de math de tragarse un "___").
  renderBlank?: BlankRenderer
  renderMathBlank?: MathBlankRenderer
}

function MathNode({ node, renderMathBlank }: { node: Extract<AcademicNode, { type: 'math' }>; renderMathBlank?: MathBlankRenderer }) {
  if (node.source === 'mathml') {
    return (
      <span
        role="math"
        style={{ display: node.display ? 'block' : 'inline', overflowX: 'auto' }}
        dangerouslySetInnerHTML={{ __html: node.value }}
      />
    )
  }
  let latexSource = node.value
  let onClick: (() => void) | undefined
  if (node.blankCount && renderMathBlank) {
    for (let i = 0; i < node.blankCount; i++) {
      const resolved = renderMathBlank()
      // String.replace con un string literal (no regex /g) reemplaza SOLO
      // la primera ocurrencia — exactamente lo que hace falta al resolver
      // huecos en orden, uno por vuelta de este for.
      latexSource = latexSource.replace('\\square', resolved.latex)
      if (resolved.onClick) onClick = resolved.onClick
    }
  }
  let html: string
  try {
    html = katex.renderToString(latexSource, {
      displayMode: node.display,
      throwOnError: true,
      trust: false,
      strict: 'error',
      output: 'htmlAndMathml',
    })
  } catch {
    // Fail-closed: un hueco sustituido en una posición que rompe la sintaxis
    // LaTeX (caso patológico no cubierto por generación/validación, o
    // contenido legacy/restaurado) NUNCA debe mostrar delimitadores $/{/}
    // literales ni crashear la página — se degrada a un aviso explícito.
    return <span role="math" aria-label="Fórmula no disponible" style={{ opacity: 0.7 }}>⚠️ Fórmula no disponible</span>
  }
  const Component = node.display ? 'div' : 'span'
  return <Component role="math" onClick={onClick} style={{ overflowX: 'auto', cursor: onClick ? 'pointer' : undefined }} dangerouslySetInnerHTML={{ __html: html }} />
}

function ChemistryNode({ node }: { node: Extract<AcademicNode, { type: 'chemistry' }> }) {
  const html = katex.renderToString(`\\ce{${node.value}}`, {
    displayMode: node.display,
    throwOnError: true,
    trust: false,
    strict: 'error',
    output: 'htmlAndMathml',
  })
  const Component = node.display ? 'div' : 'span'
  return <Component role="math" aria-label={node.value} style={{ overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: html }} />
}

function renderNode(node: AcademicNode, index: number, renderBlank?: BlankRenderer, renderMathBlank?: MathBlankRenderer): React.ReactNode {
  switch (node.type) {
    case 'text': return <span key={index} style={{ whiteSpace: 'pre-wrap' }}>{node.value}</span>
    case 'strong': return <strong key={index}><NodeList nodes={node.children} renderBlank={renderBlank} renderMathBlank={renderMathBlank} /></strong>
    case 'emphasis': return <em key={index}><NodeList nodes={node.children} renderBlank={renderBlank} renderMathBlank={renderMathBlank} /></em>
    case 'strike': return <del key={index}><NodeList nodes={node.children} renderBlank={renderBlank} renderMathBlank={renderMathBlank} /></del>
    case 'paragraph': return <span key={index} data-academic-paragraph><NodeList nodes={node.children} renderBlank={renderBlank} renderMathBlank={renderMathBlank} /></span>
    case 'heading': {
      const Heading = `h${node.level}` as keyof JSX.IntrinsicElements
      return <Heading key={index}><NodeList nodes={node.children} renderBlank={renderBlank} renderMathBlank={renderMathBlank} /></Heading>
    }
    case 'link':
      return <a key={index} href={node.href} target={node.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"><NodeList nodes={node.children} renderBlank={renderBlank} renderMathBlank={renderMathBlank} /></a>
    case 'callout':
      return <aside key={index} data-academic-callout={node.kind}><NodeList nodes={node.children} renderBlank={renderBlank} renderMathBlank={renderMathBlank} /></aside>
    case 'symbol':
      return <span key={index} aria-label={node.label}>{node.value}</span>
    case 'unit':
      return <span key={index} className="academic-unit">{node.value}</span>
    case 'quantity':
      return <span key={index} className="academic-quantity" style={{ whiteSpace: 'nowrap' }}>{quantityText(node.value, node.unit)}</span>
    case 'math':
      return <MathNode key={index} node={node} renderMathBlank={renderMathBlank} />
    case 'chemistry':
      return <ChemistryNode key={index} node={node} />
    case 'code':
      return node.display
        ? <pre key={index} data-language={node.language}><code>{node.value}</code></pre>
        : <code key={index}>{node.value}</code>
    case 'blank':
      return renderBlank
        ? <Fragment key={index}>{renderBlank(node, index)}</Fragment>
        : <span key={index} data-academic-blank aria-label={node.label || 'Espacio para responder'}>___</span>
    case 'line_break':
      return <br key={index} />
    case 'list': {
      const List = node.ordered ? 'ol' : 'ul'
      return <List key={index}>{node.items.map((item, itemIndex) => <li key={itemIndex}><DocumentNodes document={item} renderBlank={renderBlank} renderMathBlank={renderMathBlank} /></li>)}</List>
    }
    case 'table':
      return (
        <div key={index} style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr>{node.headers.map((header, cell) => <th key={cell}><DocumentNodes document={header} renderBlank={renderBlank} renderMathBlank={renderMathBlank} /></th>)}</tr></thead>
            <tbody>{node.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><DocumentNodes document={cell} renderBlank={renderBlank} renderMathBlank={renderMathBlank} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      )
    case 'error_fallback':
      return <span key={index}>{node.fallbackText}</span>
  }
}

function NodeList({ nodes, renderBlank, renderMathBlank }: { nodes: AcademicNode[]; renderBlank?: BlankRenderer; renderMathBlank?: MathBlankRenderer }) {
  return <>{nodes.map((node, index) => (
    <Fragment key={index}>
      {academicNodeBoundary(nodes[index - 1], node)}
      {renderNode(node, index, renderBlank, renderMathBlank)}
    </Fragment>
  ))}</>
}

function DocumentNodes({ document, renderBlank, renderMathBlank }: { document: AcademicDocument; renderBlank?: BlankRenderer; renderMathBlank?: MathBlankRenderer }) {
  if (!document) return null
  return <NodeList nodes={document.nodes} renderBlank={renderBlank} renderMathBlank={renderMathBlank} />
}

export function AcademicContent({
  content,
  inline = false,
  invalidFallback = 'Contenido académico no disponible.',
  renderBlank,
  renderMathBlank,
}: AcademicContentProps) {
  const prepared = prepareAcademicContentForDelivery(content)
  const Component = inline ? 'span' : 'div'
  return <Component data-academic-content data-academic-degraded={prepared.degraded || undefined}><DocumentNodes document={prepared.document} renderBlank={renderBlank} renderMathBlank={renderMathBlank} /></Component>
}
