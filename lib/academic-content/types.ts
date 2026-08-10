export interface SourceSpan {
  start: number
  end: number
}

interface SpannedNode {
  sourceSpan?: SourceSpan
}

export type AcademicNode =
  | ({ type: 'text'; value: string } & SpannedNode)
  | ({ type: 'strong'; children: AcademicNode[] } & SpannedNode)
  | ({ type: 'emphasis'; children: AcademicNode[] } & SpannedNode)
  | ({ type: 'strike'; children: AcademicNode[] } & SpannedNode)
  | ({ type: 'paragraph'; children: AcademicNode[] } & SpannedNode)
  | ({ type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: AcademicNode[] } & SpannedNode)
  | ({ type: 'link'; href: string; children: AcademicNode[] } & SpannedNode)
  | ({ type: 'symbol'; value: string; label?: string } & SpannedNode)
  // blankCount: cuántos huecos ___ de word_bank quedaron sustituidos por
  // \square DENTRO de este span matemático (p.ej. "$10^{-___}$") — permite
  // renderizar el hueco EN su posición matemática real (exponente, fracción,
  // raíz...) en vez de partir el string antes de parsear. Ausente/0 cuando
  // el span no contiene ningún hueco (caso normal, sin cambios).
  | ({ type: 'math'; value: string; display: boolean; source: 'latex' | 'mathml'; blankCount?: number } & SpannedNode)
  | ({ type: 'chemistry'; value: string; display: boolean } & SpannedNode)
  | ({ type: 'unit'; value: string } & SpannedNode)
  | ({ type: 'quantity'; value: string; unit: string } & SpannedNode)
  | ({ type: 'code'; value: string; language?: string; display: boolean } & SpannedNode)
  | ({ type: 'blank'; id: string; label?: string } & SpannedNode)
  | ({ type: 'line_break' } & SpannedNode)
  | ({ type: 'list'; ordered: boolean; items: AcademicDocument[] } & SpannedNode)
  | ({ type: 'table'; headers: AcademicDocument[]; rows: AcademicDocument[][] } & SpannedNode)
  | ({ type: 'callout'; kind: 'info' | 'warning' | 'tip'; children: AcademicNode[] } & SpannedNode)
  | ({ type: 'error_fallback'; fallbackText: string; internalReason: string } & SpannedNode)

export interface AcademicDocument {
  version: 2
  parserVersion: string
  nodes: AcademicNode[]
  originalHash?: string
}

export interface NodeIssue {
  code: string
  nodeIndex: number
  recoverable: boolean
  nodePath?: string
}

export interface AcademicValidation {
  valid: boolean
  issues: NodeIssue[]
}

export type AcademicFragmentInput = string | number | boolean | null | undefined

export const ACADEMIC_SCHEMA_VERSION = 2 as const
export const ACADEMIC_PARSER_VERSION = '2.0.0'
export const emptyAcademicDocument = (): AcademicDocument => ({
  version: ACADEMIC_SCHEMA_VERSION,
  parserVersion: ACADEMIC_PARSER_VERSION,
  nodes: [],
})
