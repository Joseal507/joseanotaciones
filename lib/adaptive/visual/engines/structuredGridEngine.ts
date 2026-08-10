import type { StructuredGridDataSpec, VisualGradingResult, VisualSourceSpan } from '../visualContract'
import { normalizeToken } from './shared'

export interface StructuredGridExtraction { data: StructuredGridDataSpec; sourceSpans: VisualSourceSpan[] }

function extractBracketAssignments(segment: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of segment.matchAll(/\[(\w+)\]\s*=\s*([^,\n]+)/g)) {
    result[match[1]] = match[2].trim()
  }
  return result
}

// Extrae reacción/especies/concentraciones EXPLÍCITAMENTE escritas en el material
// (formato ICE). Si falta cualquier segmento requerido, devuelve null en vez de
// fabricar una tabla ICE con números inventados (FASE 6).
// Frontera de segmento: hasta un punto seguido de espacio/fin de texto — NO hasta
// cualquier punto, porque los valores decimales ("1.00") contienen puntos que no
// terminan la frase.
const SEGMENT_END = String.raw`[\s\S]+?(?=\.\s|\.$|\n)`

export function extractStructuredGridSpec(sourceText: string, factKeys: string[], sourceStepId: string): StructuredGridExtraction | null {
  const reactionMatch = sourceText.match(new RegExp(String.raw`Reacci[oó]n:\s*(${SEGMENT_END}[⇌↔]${SEGMENT_END})`, 'i'))
    || sourceText.match(/([A-Za-z0-9\s+]+[⇌↔][A-Za-z0-9\s+]+)/)
  if (!reactionMatch) return null
  const reaction = reactionMatch[1].trim()
  const species = [...new Set(
    reaction.split(/[⇌↔]/).flatMap(side => side.split('+'))
      .map(token => (token.match(/[A-Z][a-zA-Z0-9]*/) || [''])[0])
      .filter(Boolean),
  )]
  if (!species.length) return null

  const initialSegment = sourceText.match(new RegExp(String.raw`[Cc]oncentraciones? inicial(?:es)?:\s*(${SEGMENT_END})`))?.[1]
  const changeSegment = sourceText.match(new RegExp(String.raw`[Cc]ambio:\s*(${SEGMENT_END})`))?.[1]
  const equilibriumSegment = sourceText.match(new RegExp(String.raw`[Ee]n el equilibrio:\s*(${SEGMENT_END})`))?.[1]
  if (!initialSegment || !changeSegment || !equilibriumSegment) return null

  const initial = extractBracketAssignments(initialSegment)
  const change = extractBracketAssignments(changeSegment)
  const equilibrium = extractBracketAssignments(equilibriumSegment)
  if (!species.every(id => id in initial && id in change && id in equilibrium)) return null

  return {
    data: {
      reaction,
      species,
      initial: Object.fromEntries(species.map(id => [id, Number(initial[id]) || initial[id]])),
      change,
      equilibrium: Object.fromEntries(species.map(id => [id, equilibrium[id]])),
    },
    sourceSpans: factKeys.map(factKey => ({ stepId: sourceStepId, factKey, quote: reactionMatch[0] })),
  }
}

export function gradeStructuredGridInteraction(
  data: StructuredGridDataSpec,
  verb: 'fill_cell',
  response: unknown,
): VisualGradingResult {
  const submitted = response as Record<string, string> | null
  if (!submitted || typeof submitted !== 'object') {
    return { correct: false, score: 0, evidenceKind: 'visual_construction', feedback: 'Completa la fila de equilibrio.', errorType: 'missing_response' }
  }
  const species = data.species
  const hits = species.filter(id => normalizeToken(submitted[id]) === normalizeToken(String(data.equilibrium[id] ?? '')))
  const score = species.length ? Math.round((hits.length / species.length) * 100) : 0
  const correct = score === 100
  return {
    correct,
    score,
    evidenceKind: 'visual_construction',
    feedback: correct ? 'Tabla ICE completada correctamente.' : `Revisa la fila de equilibrio de: ${species.filter(id => !hits.includes(id)).join(', ')}.`,
    errorType: correct ? null : 'ice_equilibrium_row',
  }
}
