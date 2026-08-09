import type { AcademicDocument, AcademicNode } from './types'
import { ACADEMIC_PARSER_VERSION, ACADEMIC_SCHEMA_VERSION } from './types'
import { validateAcademicDocument } from './validation'

export interface PersistedAcademicContent {
  schemaVersion: 2
  parserVersion: string
  originalHash?: string
  document: AcademicDocument
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function migrateDocument(value: unknown): AcademicDocument | null {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return null
  const migrateNode = (raw: unknown): AcademicNode | null => {
    if (!isRecord(raw) || typeof raw.type !== 'string') return null
    const node = { ...raw } as Record<string, unknown>
    if (Array.isArray(node.children)) {
      const children = node.children.map(migrateNode)
      if (children.some(child => !child)) return null
      node.children = children
    }
    if (node.type === 'list' && Array.isArray(node.items)) {
      const items = node.items.map(migrateDocument)
      if (items.some(item => !item)) return null
      node.items = items
    }
    if (node.type === 'table') {
      if (!Array.isArray(node.headers) || !Array.isArray(node.rows)) return null
      const headers = node.headers.map(migrateDocument)
      const rows = node.rows.map(row => Array.isArray(row) ? row.map(migrateDocument) : [null])
      if (headers.some(cell => !cell) || rows.flat().some(cell => !cell)) return null
      node.headers = headers
      node.rows = rows
    }
    return node as unknown as AcademicNode
  }
  const nodes = value.nodes.map(migrateNode)
  if (nodes.some(node => !node)) return null
  return {
    version: ACADEMIC_SCHEMA_VERSION,
    parserVersion: ACADEMIC_PARSER_VERSION,
    nodes: nodes as AcademicNode[],
    ...(typeof value.originalHash === 'string' ? { originalHash: value.originalHash } : {}),
  }
}

export function serializeAcademicDocument(document: AcademicDocument): string {
  const validation = validateAcademicDocument(document)
  if (!validation.valid) throw new Error(`Invalid academic document: ${validation.issues.map(issue => issue.code).join(',')}`)
  const envelope: PersistedAcademicContent = {
    schemaVersion: ACADEMIC_SCHEMA_VERSION,
    parserVersion: ACADEMIC_PARSER_VERSION,
    originalHash: document.originalHash,
    document,
  }
  return JSON.stringify(envelope)
}

export function restoreAcademicDocument(serialized: string): AcademicDocument | null {
  try {
    const parsed: unknown = JSON.parse(serialized)
    const source = isRecord(parsed) && isRecord(parsed.document) ? parsed.document : parsed
    const document = migrateDocument(source)
    return document && validateAcademicDocument(document).valid ? document : null
  } catch {
    return null
  }
}
