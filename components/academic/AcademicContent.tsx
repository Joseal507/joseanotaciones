'use client'

import katex from 'katex'
import 'katex/contrib/mhchem'
import { Fragment } from 'react'
import { prepareAcademicContentForDelivery } from '../../lib/academic-content/validation'
import type { AcademicDocument, AcademicNode } from '../../lib/academic-content/types'
import { academicNodeBoundary, quantityText } from '../../lib/academic-content/composition'

interface AcademicContentProps {
  content: string | AcademicDocument
  inline?: boolean
  invalidFallback?: string
}

function MathNode({ node }: { node: Extract<AcademicNode, { type: 'math' }> }) {
  if (node.source === 'mathml') {
    return (
      <span
        role="math"
        style={{ display: node.display ? 'block' : 'inline', overflowX: 'auto' }}
        dangerouslySetInnerHTML={{ __html: node.value }}
      />
    )
  }
  const html = katex.renderToString(node.value, {
    displayMode: node.display,
    throwOnError: true,
    trust: false,
    strict: 'error',
    output: 'htmlAndMathml',
  })
  const Component = node.display ? 'div' : 'span'
  return <Component role="math" style={{ overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: html }} />
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

function renderNode(node: AcademicNode, index: number): React.ReactNode {
  switch (node.type) {
    case 'text': return <span key={index} style={{ whiteSpace: 'pre-wrap' }}>{node.value}</span>
    case 'strong': return <strong key={index}><NodeList nodes={node.children} /></strong>
    case 'emphasis': return <em key={index}><NodeList nodes={node.children} /></em>
    case 'strike': return <del key={index}><NodeList nodes={node.children} /></del>
    case 'paragraph': return <span key={index} data-academic-paragraph><NodeList nodes={node.children} /></span>
    case 'heading': {
      const Heading = `h${node.level}` as keyof JSX.IntrinsicElements
      return <Heading key={index}><NodeList nodes={node.children} /></Heading>
    }
    case 'link':
      return <a key={index} href={node.href} target={node.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"><NodeList nodes={node.children} /></a>
    case 'callout':
      return <aside key={index} data-academic-callout={node.kind}><NodeList nodes={node.children} /></aside>
    case 'symbol':
      return <span key={index} aria-label={node.label}>{node.value}</span>
    case 'unit':
      return <span key={index} className="academic-unit">{node.value}</span>
    case 'quantity':
      return <span key={index} className="academic-quantity" style={{ whiteSpace: 'nowrap' }}>{quantityText(node.value, node.unit)}</span>
    case 'math':
      return <MathNode key={index} node={node} />
    case 'chemistry':
      return <ChemistryNode key={index} node={node} />
    case 'code':
      return node.display
        ? <pre key={index} data-language={node.language}><code>{node.value}</code></pre>
        : <code key={index}>{node.value}</code>
    case 'blank':
      return <span key={index} data-academic-blank aria-label={node.label || 'Espacio para responder'}>___</span>
    case 'line_break':
      return <br key={index} />
    case 'list': {
      const List = node.ordered ? 'ol' : 'ul'
      return <List key={index}>{node.items.map((item, itemIndex) => <li key={itemIndex}><DocumentNodes document={item} /></li>)}</List>
    }
    case 'table':
      return (
        <div key={index} style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr>{node.headers.map((header, cell) => <th key={cell}><DocumentNodes document={header} /></th>)}</tr></thead>
            <tbody>{node.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><DocumentNodes document={cell} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      )
    case 'error_fallback':
      return <span key={index}>{node.fallbackText}</span>
  }
}

function NodeList({ nodes }: { nodes: AcademicNode[] }) {
  return <>{nodes.map((node, index) => (
    <Fragment key={index}>
      {academicNodeBoundary(nodes[index - 1], node)}
      {renderNode(node, index)}
    </Fragment>
  ))}</>
}

function DocumentNodes({ document }: { document: AcademicDocument }) {
  return <NodeList nodes={document.nodes} />
}

export function AcademicContent({
  content,
  inline = false,
  invalidFallback = 'Contenido académico no disponible.',
}: AcademicContentProps) {
  const prepared = prepareAcademicContentForDelivery(content)
  const Component = inline ? 'span' : 'div'
  return <Component data-academic-content data-academic-degraded={prepared.degraded || undefined}><DocumentNodes document={prepared.document} /></Component>
}
