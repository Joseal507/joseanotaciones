import type { Chemistry2DDataSpec, VisualGradingResult, VisualSourceSpan } from '../visualContract'
import { normalizeToken } from './shared'

export interface Chemistry2DExtraction { data: Chemistry2DDataSpec; sourceSpans: VisualSourceSpan[] }

const ELEMENT_NAME_TO_SYMBOL: Record<string, string> = {
  carbono: 'C', oxigeno: 'O', 'oxígeno': 'O', hidrogeno: 'H', 'hidrógeno': 'H',
  nitrogeno: 'N', 'nitrógeno': 'N', azufre: 'S', cloro: 'Cl', fosforo: 'P', 'fósforo': 'P',
}
const BOND_ORDER: Record<string, 1 | 2 | 3> = { simple: 1, doble: 2, triple: 3 }

type Atom = Chemistry2DDataSpec['atoms'][number]
type Bond = Chemistry2DDataSpec['bonds'][number]

// Localiza una FÓRMULA CONDENSADA (notación química estándar, no específica de
// StudyAL — p.ej. "CH3-CH(CH3)-CH2-CH3") dentro de texto libre. Grupos C/CH/
// CH2/CH3 unidos por -/=/# con ramificaciones entre paréntesis opcionales.
// Deliberadamente NO reconoce nombres IUPAC ("2-metilbutano" como palabra) ni
// prosa vaga ("tiene cinco carbonos") — esos casos no tienen conectividad
// determinística sin un parser químico que StudyAL no posee, y deben fallar
// cerrado en vez de inventar enlaces.
const CONDENSED_FORMULA_PATTERN = /C(?:H\d?)?(?:\([^()]*\))?(?:\s*[-=#]\s*C(?:H\d?)?(?:\([^()]*\))?)+/g

// Parser recursivo-descendente determinista de fórmula condensada — NO es un
// parser de nombres IUPAC ni infiere conectividad no escrita. Rechaza (null)
// cualquier fórmula mal balanceada o que no consuma la cadena completa.
function parseCondensedFormula(formula: string): { atoms: Atom[]; bonds: Bond[] } | null {
  let pos = 0
  let counter = 0
  const atoms: Atom[] = []
  const bonds: Bond[] = []

  function bondOrder(char: string): 1 | 2 | 3 {
    return char === '=' ? 2 : char === '#' ? 3 : 1
  }

  function parseGroupWithBranches(): string | null {
    const m = /^C(H\d?)?/.exec(formula.slice(pos))
    if (!m) return null
    pos += m[0].length
    counter += 1
    const id = `C${counter}`
    atoms.push({ id, element: 'C', x: 0, y: 0 })
    while (formula[pos] === '(') {
      pos += 1
      const branchFirst = parseChain()
      if (branchFirst === null) return null
      if (formula[pos] !== ')') return null
      pos += 1
      bonds.push({ from: id, to: branchFirst, order: 1 })
    }
    return id
  }

  function parseChain(): string | null {
    const first = parseGroupWithBranches()
    if (first === null) return null
    let prev = first
    while (formula[pos] === '-' || formula[pos] === '=' || formula[pos] === '#') {
      const bondChar = formula[pos]
      pos += 1
      const next = parseGroupWithBranches()
      if (next === null) return null
      bonds.push({ from: prev, to: next, order: bondOrder(bondChar) })
      prev = next
    }
    return first
  }

  const startedAt = parseChain()
  if (startedAt === null || pos !== formula.length || atoms.length < 2) return null

  // Layout puramente determinista para renderizar (nunca un hecho del
  // material) — cadena principal en fila; cualquier átomo cuyo ÚNICO bond
  // entrante proviene de un átomo con más de un bond saliente se trata como
  // rama y se desplaza verticalmente.
  // Layout topológico: usa como esqueleto la ruta simple más larga; las ramas
  // quedan arriba/abajo del carbono de unión. Es una decisión gráfica
  // reproducible, no estereoquímica ni geometría molecular inferida.
  const neighbors = new Map(atoms.map(atom => [atom.id, [] as string[]]))
  for (const bond of bonds) { neighbors.get(bond.from)?.push(bond.to); neighbors.get(bond.to)?.push(bond.from) }
  let backbone:string[]=[]
  const walk=(id:string,seen:string[]):void=>{const path=[...seen,id];if(path.length>backbone.length)backbone=path;for(const next of neighbors.get(id)||[])if(!path.includes(next))walk(next,path)}
  for(const atom of atoms)walk(atom.id,[])
  const onBackbone=new Set(backbone)
  backbone.forEach((id,index)=>{const atom=atoms.find(candidate=>candidate.id===id)!;atom.x=index*64;atom.y=45})
  backbone.forEach((parentId,parentIndex)=>{
    const branches=(neighbors.get(parentId)||[]).filter(id=>!onBackbone.has(id))
    branches.forEach((id,index)=>{const atom=atoms.find(candidate=>candidate.id===id)!;atom.x=parentIndex*64;atom.y=index%2===0?0:90})
  })

  return { atoms, bonds }
}

// Extrae átomos y enlaces. Dos caminos, en orden:
//  1) Fórmula condensada estándar (CH3-CH(CH3)-CH2-CH3) — grounded en la
//     notación química misma, sin depender de que el material la redacte en
//     un formato específico de StudyAL.
//  2) Formato EXPLÍCITO previo (compat): "Átomos: C1=carbono..." / "Enlaces:
//     C1-C2 (enlace simple)".
// El layout (x,y) es puramente determinista para renderizar — no representa
// un hecho del material, solo posición.
export function extractChemistry2DSpec(sourceText: string, factKeys: string[], sourceStepId: string): Chemistry2DExtraction | null {
  const formulaMatches = [...sourceText.matchAll(CONDENSED_FORMULA_PATTERN)].sort((a, b) => b[0].length - a[0].length)
  for (const match of formulaMatches) {
    const parsed = parseCondensedFormula(match[0])
    if (parsed) {
      return {
        data: parsed,
        sourceSpans: factKeys.map(factKey => ({ stepId: sourceStepId, factKey, quote: match[0] })),
      }
    }
  }

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
