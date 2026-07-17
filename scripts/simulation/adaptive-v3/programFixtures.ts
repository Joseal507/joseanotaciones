// ═══════════════════════════════════════════════════════════════
// PROGRAM FIXTURES — Programas sintéticos válidos
// ═══════════════════════════════════════════════════════════════

import type { KnowledgeGraph, MicroConcept } from '../../../lib/adaptive/v3/types'

function micro(overrides: Partial<MicroConcept> & { id: string; name: string; cognitiveType: MicroConcept['cognitiveType'] }): MicroConcept {
  return {
    shortDescription: overrides.name,
    fullDefinition: `Definición completa de ${overrides.name} para simulación pedagógica.`,
    difficulty: 50,
    estimatedMinutes: 5,
    sourceQuotes: [`"${overrides.name} es un concepto clave del material."`],
    sourceChunkIds: [],
    sourcePages: [1],
    examples: [{ id: 'ex1', scenario: `Ejemplo de ${overrides.name}`, solution: 'Solución ejemplo', keyInsight: 'Insight clave' }],
    formulas: [],
    procedures: [],
    commonErrors: [{ id: 'err1', description: `Error común en ${overrides.name}`, whyItHappens: 'Confusión básica', correction: 'Corrección directa' }],
    prerequisites: [],
    enables: [],
    related: [],
    importance: 'medium',
    topicGroup: 'General',
    extractedAt: Date.now(),
    ...overrides,
  }
}

function graph(id: string, title: string, micros: MicroConcept[], deps: Array<{ from: string; to: string }> = []): KnowledgeGraph {
  return {
    materialId: id,
    materialTitle: title,
    subjectArea: 'simulation',
    microConcepts: micros,
    dependencies: deps.map(d => ({ ...d, strength: 'soft' as const, reason: 'prerequisito simulado' })),
    topicGroups: [{ id: 'g1', name: 'General', description: '', microIds: micros.map(m => m.id), order: 0 }],
    totalMicros: micros.length,
    totalDependencies: deps.length,
    averageDifficulty: 50,
    estimatedTotalMinutes: micros.length * 5,
    criticalPath: micros.map(m => m.id),
    extractedAt: Date.now(),
    chunkerVersion: 'sim-1',
    extractorVersion: 'sim-1',
    resolverVersion: 'sim-1',
  }
}

// ─── Programa 1: 1 solo micro definitional ───────────────────────
export const PROGRAM_SINGLE_DEFINITIONAL = graph(
  'prog_single_def',
  'Programa: 1 micro definitional',
  [micro({ id: 'm1', name: 'Concepto Base', cognitiveType: 'definitional', difficulty: 30, importance: 'high' })],
)

// ─── Programa 2: 3 micros, sin prerequisitos ────────────────────
export const PROGRAM_SMALL_MIXED = graph(
  'prog_small_mixed',
  'Programa: 3 micros mixtos',
  [
    micro({ id: 'm1', name: 'Definición A', cognitiveType: 'definitional', difficulty: 25, importance: 'high' }),
    micro({ id: 'm2', name: 'Concepto Causal B', cognitiveType: 'causal', difficulty: 50, importance: 'medium' }),
    micro({ id: 'm3', name: 'Aplicación C', cognitiveType: 'applicative', difficulty: 65, importance: 'high' }),
  ],
)

// ─── Programa 3: 6 micros con prerequisitos encadenados ─────────
export const PROGRAM_CHAINED = graph(
  'prog_chained',
  'Programa: 6 micros encadenados',
  [
    micro({ id: 'm1', name: 'Base Conceptual', cognitiveType: 'definitional', difficulty: 20, importance: 'critical', prerequisites: [] }),
    micro({ id: 'm2', name: 'Principio Causal', cognitiveType: 'causal', difficulty: 40, importance: 'high', prerequisites: ['m1'] }),
    micro({ id: 'm3', name: 'Procedimiento A', cognitiveType: 'procedural', difficulty: 55, importance: 'high', prerequisites: ['m1'] }),
    micro({ id: 'm4', name: 'Aplicación Matemática', cognitiveType: 'mathematical', difficulty: 70, importance: 'critical', prerequisites: ['m2', 'm3'] }),
    micro({ id: 'm5', name: 'Análisis Comparativo', cognitiveType: 'comparative', difficulty: 60, importance: 'medium', prerequisites: ['m2'] }),
    micro({ id: 'm6', name: 'Transferencia Final', cognitiveType: 'applicative', difficulty: 80, importance: 'high', prerequisites: ['m4', 'm5'] }),
  ],
  [
    { from: 'm1', to: 'm2' }, { from: 'm1', to: 'm3' },
    { from: 'm2', to: 'm4' }, { from: 'm3', to: 'm4' },
    { from: 'm2', to: 'm5' }, { from: 'm4', to: 'm6' }, { from: 'm5', to: 'm6' },
  ],
)

// ─── Programa 4: solo definitional (para memorizer) ─────────────
export const PROGRAM_DEFINITIONAL_ONLY = graph(
  'prog_def_only',
  'Programa: solo definiciones',
  [
    micro({ id: 'm1', name: 'Hecho Histórico 1', cognitiveType: 'definitional', difficulty: 20 }),
    micro({ id: 'm2', name: 'Hecho Histórico 2', cognitiveType: 'definitional', difficulty: 25 }),
    micro({ id: 'm3', name: 'Cronología A', cognitiveType: 'chronological', difficulty: 30 }),
    micro({ id: 'm4', name: 'Clasificación B', cognitiveType: 'classificatory', difficulty: 35 }),
  ],
)

// ─── Programa 5: transfer-required ──────────────────────────────
export const PROGRAM_TRANSFER_REQUIRED = graph(
  'prog_transfer',
  'Programa: requiere transferencia',
  [
    micro({ id: 'm1', name: 'Principio Analítico', cognitiveType: 'analytical', difficulty: 60, importance: 'critical' }),
    micro({ id: 'm2', name: 'Caso Aplicativo', cognitiveType: 'applicative', difficulty: 70, importance: 'critical', prerequisites: ['m1'] }),
  ],
  [{ from: 'm1', to: 'm2' }],
)

// ─── Programa 6: matemático puro ────────────────────────────────
export const PROGRAM_MATHEMATICAL = graph(
  'prog_math',
  'Programa: matemático',
  [
    micro({
      id: 'm1', name: 'Fórmula Base', cognitiveType: 'mathematical', difficulty: 55, importance: 'critical',
      formulas: [{ id: 'f1', expression: 'y = mx + b', latex: 'y = mx + b', variables: [{ symbol: 'm', meaning: 'pendiente' }, { symbol: 'b', meaning: 'intercepto' }], whenToUse: 'Ecuación lineal' }],
    }),
    micro({
      id: 'm2', name: 'Aplicación de Fórmula', cognitiveType: 'mathematical', difficulty: 70, importance: 'high', prerequisites: ['m1'],
      formulas: [{ id: 'f2', expression: 'slope = (y2-y1)/(x2-x1)', latex: 'slope = \\frac{y_2-y_1}{x_2-x_1}', variables: [], whenToUse: 'Calcular pendiente' }],
    }),
  ],
  [{ from: 'm1', to: 'm2' }],
)

// ─── Programa 7: 20 micros (stress test) ────────────────────────
export const PROGRAM_LARGE = graph(
  'prog_large',
  'Programa: 20 micros',
  Array.from({ length: 20 }, (_, i) => {
    const types: MicroConcept['cognitiveType'][] = ['definitional', 'conceptual', 'causal', 'procedural', 'analytical', 'applicative', 'mathematical', 'comparative']
    return micro({
      id: `m${i + 1}`,
      name: `Micro ${i + 1}`,
      cognitiveType: types[i % types.length],
      difficulty: 20 + (i * 4),
      importance: i < 5 ? 'critical' : i < 10 ? 'high' : 'medium',
      prerequisites: i > 0 && i % 3 === 0 ? [`m${i}`] : [],
    })
  }),
)

// ─── Programa 8: procedural con pasos ───────────────────────────
export const PROGRAM_PROCEDURAL = graph(
  'prog_procedural',
  'Programa: procedural',
  [
    micro({
      id: 'm1', name: 'Procedimiento Diagnóstico', cognitiveType: 'procedural', difficulty: 65, importance: 'critical',
      procedures: [{
        id: 'p1', name: 'Protocolo diagnóstico', applicableWhen: 'Siempre',
        steps: [
          { order: 1, description: 'Evaluar signos vitales', reasoning: 'Base del diagnóstico' },
          { order: 2, description: 'Obtener historia clínica', reasoning: 'Contexto esencial' },
          { order: 3, description: 'Examen físico dirigido', reasoning: 'Confirmar hipótesis' },
          { order: 4, description: 'Solicitar estudios', reasoning: 'Confirmar diagnóstico' },
        ],
      }],
    }),
  ],
)

// ─── Todos los programas ─────────────────────────────────────────
export const ALL_PROGRAMS: Record<string, KnowledgeGraph> = {
  single_definitional: PROGRAM_SINGLE_DEFINITIONAL,
  small_mixed: PROGRAM_SMALL_MIXED,
  chained: PROGRAM_CHAINED,
  definitional_only: PROGRAM_DEFINITIONAL_ONLY,
  transfer_required: PROGRAM_TRANSFER_REQUIRED,
  mathematical: PROGRAM_MATHEMATICAL,
  large: PROGRAM_LARGE,
  procedural: PROGRAM_PROCEDURAL,
}

export const ALL_PROGRAM_IDS = Object.keys(ALL_PROGRAMS)
