import type { StructuredGridDataSpec, VisualGradingResult, VisualSourceSpan } from '../visualContract'
import { normalizeToken } from './shared'

export interface StructuredGridExtraction { data: StructuredGridDataSpec; sourceSpans: VisualSourceSpan[] }

// Anclas puramente estructurales del propio concepto ICE (Inicial/Cambio/
// Equilibrio) — NUNCA una frase ni una asignatura concreta. Antes se exigía un
// encabezado literal completo ("Concentraciones iniciales:") pegado
// exactamente delante del primer corchete — una paráfrasis pedagógicamente
// equivalente ("las concentraciones iniciales son [H2]=1.00...") con los
// MISMOS datos grounded no coincidía. Generalización: cada asignación
// "[especie] = valor" se asigna a la fase cuya palabra-ancla (inicial/cambio/
// equilibrio) aparece más cerca y ANTES de ella en el texto — la fase se
// localiza por posición relativa, no por un encabezado fijo.
const PHASES = ['initial', 'change', 'equilibrium'] as const
type Phase = (typeof PHASES)[number]
const ANCHOR_PATTERNS: Record<Phase, RegExp> = {
  initial: /inicial(?:es|mente)?/gi,
  change: /\bcambio\b/gi,
  equilibrium: /equilibrio/gi,
}

// Extrae reacción/especies/concentraciones EXPLÍCITAMENTE escritas en el material
// (formato ICE). Si falta cualquier fase requerida, devuelve null en vez de
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

  const anchorPositions: Array<{ phase: Phase; index: number }> = []
  for (const phase of PHASES) {
    for (const match of sourceText.matchAll(ANCHOR_PATTERNS[phase])) {
      anchorPositions.push({ phase, index: match.index ?? 0 })
    }
  }
  anchorPositions.sort((a, b) => a.index - b.index)

  // El valor de una celda ICE es siempre una expresión numérico-algebraica
  // (dígitos, signo, punto decimal, la variable x) — nunca contiene palabras.
  // Restringir la clase de caracteres del valor (en vez de "todo hasta la
  // siguiente coma") evita depender de que el material separe los corchetes
  // con comas — una paráfrasis en prosa puede unirlos con "y"/"con" sin
  // ninguna coma de por medio, y aun así el valor se extrae correctamente
  // porque nunca contiene esas letras.
  const byPhase: Record<Phase, Record<string, string>> = { initial: {}, change: {}, equilibrium: {} }
  for (const match of sourceText.matchAll(/\[(\w+)\]\s*=\s*([0-9xX.+\-\s]+)/g)) {
    const assignIndex = match.index ?? 0
    let phase: Phase | null = null
    for (const anchor of anchorPositions) {
      if (anchor.index <= assignIndex) phase = anchor.phase
      else break
    }
    if (!phase) continue
    // Un punto al final del valor capturado es SIEMPRE el punto final de la
    // oración, nunca un decimal — un decimal legítimo ("1.00") siempre trae
    // dígitos después del punto, y esos dígitos ya habrían quedado dentro de
    // la captura (misma clase de caracteres).
    byPhase[phase][match[1]] = match[2].trim().replace(/\.$/, '')
  }

  const initial = byPhase.initial
  const change = byPhase.change
  const equilibrium = byPhase.equilibrium
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
