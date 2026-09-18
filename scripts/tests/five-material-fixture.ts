import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { withMaterialLanguage } from '../../lib/materialLanguage'

export const MATERIALS = {
  A: { id: 'mat-A', pages: [1, 2, 3], fact: 'Photosynthesis uses chlorophyll to absorb light in chloroplasts and produce glucose and oxygen.', topic: 'Biology' },
  B: { id: 'mat-B', pages: [1, 2, 3, 4], fact: 'Carbon sp3 hybridization mixes one s and three p orbitals producing four tetrahedral bonds at 109.5 degrees.', topic: 'Chemistry' },
  C: { id: 'mat-C', pages: [1, 2], fact: 'The Industrial Revolution relied on steam power from coal to drive factories and railways in Britain.', topic: 'History' },
  D: { id: 'mat-D', pages: [1, 2, 3], fact: 'A quadratic function has a parabola graph whose vertex is at x equals minus b over two a.', topic: 'Mathematics' },
  E: { id: 'mat-E', pages: [1, 2, 3], fact: 'Newton second law states that net force equals mass times acceleration, F = ma, for a body.', topic: 'Physics' },
} as const
export const F = { id: 'mat-F', fact: 'The Zorblax protocol governs interstellar customs inspections on the Kepler ninety outpost.' }
export type Key = keyof typeof MATERIALS
export const KEYS = Object.keys(MATERIALS) as Key[]

export function selectionOf(keys: Key[], pagesOverride: Partial<Record<Key, number[]>> = {}) {
  return buildSourceSelectionSnapshot(keys.map(k => MATERIALS[k].id), Object.fromEntries(keys.map(k => [MATERIALS[k].id, pagesOverride[k] || [...MATERIALS[k].pages]])))
}

/** One item per (material, page): every material has page 1..n so page numbers collide on purpose. */
export function buildPayload(keys: Key[], opts: { spanish?: Key[]; extra?: any[] } = {}) {
  const selection = selectionOf(keys)
  const blocks: any[] = []
  const topics = keys.map((k, i) => ({ id: `topic_${k}`, title: MATERIALS[k].topic, order: i }))
  let order = 0
  for (const k of keys) {
    const m = MATERIALS[k]
    for (const page of m.pages) {
      const es = opts.spanish?.includes(k)
      const text = es
        ? `En esta lección, la idea principal es que la luz solar es la energía que las plantas transforman durante la fotosíntesis y que se almacena en los azúcares de la planta. Marker ${k}${page}.`
        : `In this lesson, the key idea is that ${m.fact} This is one of the main points of the chapter and it is used to explain the topic. Marker ${k}${page}.`
      blocks.push({ id: `${k}-p${page}`, kind: 'concept', label: `${m.topic} concept ${k}${page}`, summary: text, importance: 80 - order,
        materialId: m.id, pages: [page], topicId: `topic_${k}`, globalOrder: order++, sourceSpans: [{ page, quote: text }] })
    }
  }
  const payload = withMaterialLanguage({ blueprint: {
    sourceSelectionFingerprint: selection.fingerprint, materialIds: selection.materialIds, selectedPages: selection.selectedPages,
    topicsIndex: topics, globalOrderedAnalysis: [...blocks, ...(opts.extra || [])], uniqueConceptsIndex: [],
  } })
  return { payload, selection, blocks }
}
