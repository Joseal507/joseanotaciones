import type { Chemistry2DDataSpec, VisualGradingResult, VisualSourceSpan } from '../visualContract'
import { normalizeToken } from './shared'

export interface Chemistry2DExtraction { data: Chemistry2DDataSpec; sourceSpans: VisualSourceSpan[] }

const ELEMENT_NAME_TO_SYMBOL: Record<string, string> = {
  carbono: 'C', oxigeno: 'O', 'oxígeno': 'O', hidrogeno: 'H', 'hidrógeno': 'H',
  nitrogeno: 'N', 'nitrógeno': 'N', azufre: 'S', cloro: 'Cl', fosforo: 'P', 'fósforo': 'P',
}
const BOND_ORDER: Record<string, 1 | 2 | 3> = { simple: 1, doble: 2, triple: 3 }

// Extrae átomos y enlaces EXPLÍCITAMENTE declarados en el material (formato
// "Átomos: C1=carbono..." / "C1-C2 (enlace simple)"). El layout (x,y) es puramente
// determinista para renderizar — no representa un hecho del material, solo posición.
export function extractChemistry2DSpec(sourceText: string, factKeys: string[], sourceStepId: string): Chemistry2DExtraction | null {
  const atomsSegment = sourceText.match(/[AÁ]tomos:\s*([^.\n]+)/)?.[1]
  const bondsSegment = sourceText.match(/Enlaces?:\s*([^.\n]+)/)?.[1] || sourceText.match(/Estructura:\s*([^.\n]+)/)?.[1]
  if (!atomsSegment || !bondsSegment) return null

  const atomEntries = [...atomsSegment.matchAll(/([A-Z]\d+)\s*=\s*(\w+)/g)]
  if (!atomEntries.length) return null

  const atoms = atomEntries.map(([, id, name], index) => {
    const symbol = ELEMENT_NAME_TO_SYMBOL[normalizeToken(name)] || name.slice(0, 2)
    return { id, element: symbol, x: index * 60, y: index % 2 === 0 ? 0 : 30 }
  })
  const atomIds = new Set(atoms.map(atom => atom.id))

  const bonds = [...bondsSegment.matchAll(/([A-Z]\d+)-([A-Z]\d+)\s*\(enlace (simple|doble|triple)\)/g)]
    .filter(match => atomIds.has(match[1]) && atomIds.has(match[2]))
    .map(match => ({ from: match[1], to: match[2], order: BOND_ORDER[match[3]] }))
  if (!bonds.length) return null

  return {
    data: { atoms, bonds },
    sourceSpans: factKeys.map(factKey => ({ stepId: sourceStepId, factKey, quote: atomsSegment.trim() })),
  }
}

export function gradeChemistry2DInteraction(
  data: Chemistry2DDataSpec,
  verb: 'label_structure',
  response: unknown,
): VisualGradingResult {
  const submitted = response as Record<string, string> | null
  if (!submitted || typeof submitted !== 'object') {
    return { correct: false, score: 0, evidenceKind: 'visual_construction', feedback: 'Etiqueta cada átomo.', errorType: 'missing_response' }
  }
  const hits = data.atoms.filter(atom => normalizeToken(submitted[atom.id]) === normalizeToken(atom.element))
  const score = data.atoms.length ? Math.round((hits.length / data.atoms.length) * 100) : 0
  const correct = score === 100
  return {
    correct,
    score,
    evidenceKind: 'visual_construction',
    feedback: correct ? 'Estructura etiquetada correctamente.' : 'Alguno de los átomos está mal identificado.',
    errorType: correct ? null : 'skeletal_structure_labeling',
  }
}
