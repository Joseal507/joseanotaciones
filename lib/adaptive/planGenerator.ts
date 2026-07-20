// ═══════════════════════════════════════════════════════════════
// StudyAL — Generador de Plan de Aprendizaje
//
// INPUT:  blueprint (del API) + setup (del wizard) + userProfile
// OUTPUT: StudyPlan — el mapa de aprendizaje completo
//
// 100% determinístico. Sin IA. Instantáneo.
// La IA ya hizo su trabajo en el blueprint.
// ═══════════════════════════════════════════════════════════════

import type {
  StudyPlan,
  PlanSession,
  CognitiveUnit,
  CognitiveLoad,
  SessionType,
  BloomVerb,
} from './types';
import type { AdaptiveSetup } from '../studySessions';

// ─── Tipos internos del blueprint ─────────────────────────────

interface BlueprintBlock {
  id: string;
  kind: string;
  label: string;
  summary: string;
  topicId: string | null;
  topicLabel: string;
  pages: number[];
  firstPage: number;
  globalOrder: number;
  importance: number;
  difficulty: 'basic' | 'intermediate' | 'advanced';
  dependsOn: string[];
  bloomLevel?: string;
  examProbability?: number;
  estimatedMinutes?: number;
  misconceptions?: string[];
}

interface BlueprintTopic {
  id: string;
  title: string;
  summary: string;
  pages: number[];
  conceptIds?: string[];
}

interface Blueprint {
  topics?: BlueprintTopic[];
  topicsIndex?: BlueprintTopic[];
  blocks?: BlueprintBlock[];
  globalOrderedAnalysis?: BlueprintBlock[];
  concepts?: any[];
  uniqueConceptsIndex?: any[];
  coverageSummary?: {
    totalTopics: number;
    totalBlocks: number;
    totalUniqueConcepts: number;
    estimatedMinutes: number;
  };
  coverage?: {
    totalTopics: number;
    totalBlocks: number;
  };
}

interface UserProfile {
  nombre?: string | null;
  name?: string | null;
  carrera?: string | null;
  objetivo?: string | null;
}

// ─── Constantes ───────────────────────────────────────────────

const BLOOM_VERBS: Record<string, string> = {
  remember:   'Identificar',
  understand: 'Explicar',
  apply:      'Aplicar',
  analyze:    'Analizar',
  evaluate:   'Evaluar',
  create:     'Diseñar',
};

const BLOOM_VERBS_INFINITIVE: Record<string, string> = {
  remember:   'identificar',
  understand: 'explicar con tus propias palabras',
  apply:      'resolver problemas usando',
  analyze:    'comparar y contrastar',
  evaluate:   'juzgar y argumentar sobre',
  create:     'diseñar o construir',
};

// ─── PASO 1: Normalizar blueprint ─────────────────────────────

function normalizeBlueprint(raw: any): Blueprint {
  return {
    blocks: raw?.blocks || raw?.globalOrderedAnalysis || [],
    concepts: raw?.concepts || raw?.uniqueConceptsIndex || [],
    coverageSummary: raw?.coverageSummary || raw?.coverage || {
      totalTopics: 0,
      totalBlocks: 0,
      totalUniqueConcepts: 0,
      estimatedMinutes: 0,
    },
  };
}

// ─── PASO 2: Construir Cognitive Units ────────────────────────
// Un topic + todos sus blocks = 1 unit indivisible.
// NUNCA se divide un cognitive unit entre sesiones.

function buildCognitiveUnits(blueprint: Blueprint): CognitiveUnit[] {
  const blocks = blueprint.blocks || [];
  const topics = blueprint.topics || [];

  // Construir mapa: blockId → topicId (para resolver dependencias)
  const blockToTopic = new Map<string, string>();
  for (const block of blocks) {
    if (block.id && block.topicId) {
      blockToTopic.set(block.id, block.topicId);
    }
  }

  // Agrupar blocks por topicId
  const byTopic = new Map<string, BlueprintBlock[]>();
  const noTopic: BlueprintBlock[] = [];

  for (const block of blocks) {
    const key = block.topicId || '__no_topic__';
    if (key === '__no_topic__') {
      noTopic.push(block);
    } else {
      if (!byTopic.has(key)) byTopic.set(key, []);
      byTopic.get(key)!.push(block);
    }
  }

  const units: CognitiveUnit[] = [];

  // Topics en orden del material
  const topicOrder = topics.map(t => t.id);

  // Agregar topics en el orden del material (topicsIndex)
  for (const topicId of topicOrder) {
    const topicBlocks = byTopic.get(topicId);
    if (!topicBlocks || topicBlocks.length === 0) continue;
    const topic = topics.find(t => t.id === topicId);
    units.push(buildUnit(
      `unit_${units.length}`,
      topicId,
      topic?.title || topicId,
      topicBlocks,
      blockToTopic,
    ));
  }

  // Topics que no estaban en topicsIndex pero sí tienen blocks
  // Ordenarlos por su primer globalOrder para respetar el material
  const extraTopics: { topicId: string; blocks: BlueprintBlock[] }[] = [];
  for (const [topicId, topicBlocks] of byTopic.entries()) {
    if (topicOrder.includes(topicId)) continue;
    extraTopics.push({ topicId, blocks: topicBlocks });
  }
  // Separar topics genéricos (Contexto general, introducción, etc.)
  // de topics específicos del material
  const GENERIC_TOPIC_PATTERNS = /^(contexto|context|general|introduction|introduccion|introducción|overview|misc|other|otro|general context)/i;

  const specificExtras = extraTopics.filter(e => {
    const label = e.blocks[0]?.topicLabel || e.topicId || '';
    return !GENERIC_TOPIC_PATTERNS.test(label);
  });
  const genericExtras = extraTopics.filter(e => {
    const label = e.blocks[0]?.topicLabel || e.topicId || '';
    return GENERIC_TOPIC_PATTERNS.test(label);
  });

  // Primero los específicos ordenados por globalOrder
  specificExtras.sort((a, b) => {
    const aFirst = Math.min(...a.blocks.map(bl => bl.globalOrder));
    const bFirst = Math.min(...b.blocks.map(bl => bl.globalOrder));
    return aFirst - bFirst;
  });
  for (const { topicId, blocks: topicBlocks } of specificExtras) {
    const topicLabelFromBlock = topicBlocks[0]?.topicLabel || topicId;
    units.push(buildUnit(`unit_${units.length}`, topicId, topicLabelFromBlock, topicBlocks, blockToTopic));
  }

  // Luego los genéricos — siempre al final antes de los sin-topic
  genericExtras.sort((a, b) => {
    const aFirst = Math.min(...a.blocks.map(bl => bl.globalOrder));
    const bFirst = Math.min(...b.blocks.map(bl => bl.globalOrder));
    return aFirst - bFirst;
  });
  for (const { topicId, blocks: topicBlocks } of genericExtras) {
    const topicLabelFromBlock = topicBlocks[0]?.topicLabel || topicId;
    units.push(buildUnit(`unit_${units.length}`, topicId, topicLabelFromBlock, topicBlocks, blockToTopic));
  }

  // Blocks sin topic — al final, agrupados por tamaño
  if (noTopic.length > 0) {
    const MAX_NO_TOPIC_UNIT = 8;
    for (let i = 0; i < noTopic.length; i += MAX_NO_TOPIC_UNIT) {
      const chunk = noTopic.slice(i, i + MAX_NO_TOPIC_UNIT);
      units.push(buildUnit(
        `unit_${units.length}`,
        null,
        'Conceptos complementarios',
        chunk,
        blockToTopic,
      ));
    }
  }

  return units;
}

function buildUnit(
  id: string,
  topicId: string | null,
  topicLabel: string,
  blocks: BlueprintBlock[],
  blockToTopic?: Map<string, string>,
): CognitiveUnit {
  const sortedBlocks = [...blocks].sort((a, b) => a.globalOrder - b.globalOrder);

  const pages = Array.from(new Set(sortedBlocks.flatMap(b => b.pages || []))).sort((a, b) => a - b);

  const concepts = sortedBlocks
    .filter(b => ['concept', 'definition', 'formula', 'entity'].includes(b.kind))
    .map(b => b.label);

  const difficultyBreakdown = {
    basic: sortedBlocks.filter(b => b.difficulty === 'basic').length,
    intermediate: sortedBlocks.filter(b => b.difficulty === 'intermediate').length,
    advanced: sortedBlocks.filter(b => b.difficulty === 'advanced').length,
  };

  const highImportanceCount = sortedBlocks.filter(b => b.importance >= 70).length;
  const formulaCount = sortedBlocks.filter(b => b.kind === 'formula').length;

  // Score de carga cognitiva (numérico interno)
  const cognitiveLoad =
    sortedBlocks.length
    + difficultyBreakdown.advanced * 2
    + formulaCount * 1.5
    + highImportanceCount * 0.5;

  const bloomLevels = Array.from(new Set(
    sortedBlocks
      .map(b => b.bloomLevel as BloomVerb)
      .filter(Boolean),
  ));

  // Dependencias a nivel de topic
  // Los block.dependsOn son blockIds/conceptIds → resolver a topicIds
  const rawDeps = Array.from(new Set(
    sortedBlocks.flatMap(b => b.dependsOn || []),
  ));

  const dependsOnTopicIds = Array.from(new Set(
    rawDeps.map(dep => {
      // Intentar resolver el dep como blockId → topicId
      if (blockToTopic && blockToTopic.has(dep)) {
        return blockToTopic.get(dep)!;
      }
      // Si ya es un topicId (empieza con "topic_"), usarlo directo
      if (dep.startsWith('topic_')) return dep;
      // Si no se puede resolver, ignorar
      return null;
    }).filter((t): t is string => t !== null && t !== topicId),
  ));

  return {
    id,
    topicId,
    topicLabel,
    blockIds: sortedBlocks.map(b => b.id),
    pages,
    concepts,
    globalOrderStart: sortedBlocks[0]?.globalOrder ?? 0,
    cognitiveLoad,
    difficultyBreakdown,
    highImportanceCount,
    formulaCount,
    bloomLevels,
    dependsOnTopicIds,
  };
}

// ─── PASO 3: Calcular número de sesiones y densidad ───────────

interface DensityConfig {
  deepSessions: number;
  maxUnitsPerSession: number;
  pressureLabel: string;
}

function calculateDensity(
  totalUnits: number,
  setup: AdaptiveSetup,
): DensityConfig {
  if (totalUnits === 0) return { deepSessions: 1, maxUnitsPerSession: 1, pressureLabel: 'normal' };

  // Factor de presión por fecha de examen
  let pressureFactor: number;
  let pressureLabel: string;

  switch (setup.examDateType) {
    case 'today':
      pressureFactor = 0.90; pressureLabel = 'máxima'; break;
    case 'tomorrow':
      pressureFactor = 0.70; pressureLabel = 'alta'; break;
    case 'this_week':
      pressureFactor = 0.50; pressureLabel = 'media'; break;
    case 'custom':
      // Calcular días restantes
      if (setup.examDateCustom) {
        const days = Math.ceil(
          (new Date(setup.examDateCustom).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        if (days <= 1) { pressureFactor = 0.85; pressureLabel = 'muy alta'; }
        else if (days <= 3) { pressureFactor = 0.65; pressureLabel = 'alta'; }
        else if (days <= 7) { pressureFactor = 0.50; pressureLabel = 'media'; }
        else if (days <= 14) { pressureFactor = 0.40; pressureLabel = 'baja'; }
        else { pressureFactor = 0.30; pressureLabel = 'muy baja'; }
      } else {
        pressureFactor = 0.40; pressureLabel = 'baja';
      }
      break;
    case 'just_studying':
    default:
      pressureFactor = 0.35; pressureLabel = 'relajada'; break;
  }

  // Modificador por nivel de conocimiento
  const knowledgeMod: Record<string, number> = {
    never_seen:   -0.05,  // ligeramente más gradual
    know_little:   0.00,
    want_review:  +0.15,  // menos sesiones, más práctica
    already_know: +0.25,
  };
  const mod = knowledgeMod[setup.knowledgeLevel] ?? 0;
  const density = Math.min(0.95, Math.max(0.20, pressureFactor + mod));

  // Calcular sesiones deep objetivo primero
  // Material pequeño (≤6 units): máx 3-4 sesiones deep
  // Material grande (>6 units): escala con densidad
  // Tabla de sesiones deep según presión y tamaño del material
  // pressureFactor alto = pocos días = menos sesiones = más denso
  // pressureFactor bajo = muchos días = más sesiones = más gradual

  // Máximo de sesiones deep según presión (independiente del material)
  const maxDeepByPressure = Math.round(2 + (1 - density) * 4);
  // maxDeep: density=0.90 → 2, density=0.70 → 3, density=0.50 → 4, density=0.35 → 4, density=0.25 → 5

  // Mínimo de sesiones deep: 1 por cada 3 units (no más granular que eso)
  const minDeepSessions = Math.max(1, Math.ceil(totalUnits / 3));

  // Objetivo: entre min y max, ajustado para que ninguna sesión quede vacía
  const targetDeepSessions = Math.min(
    maxDeepByPressure,
    Math.max(minDeepSessions, Math.ceil(totalUnits / 2)),
  );

  // Units por sesión: distribuir equitativamente
  const maxUnitsPerSession = Math.max(1, Math.ceil(totalUnits / targetDeepSessions));

  // Sesiones deep reales
  const deepSessions = Math.max(1, Math.ceil(totalUnits / maxUnitsPerSession));



  return { deepSessions, maxUnitsPerSession, pressureLabel };
}

// ─── PASO 4: Generar título según knowledgeLevel ──────────────

function generateSessionTitle(
  topicLabel: string,
  sessionIndex: number,
  knowledgeLevel: string,
  unitsCount: number,
  topBloom?: string,
): string {
  // El título refleja el nivel cognitivo real de la sesión
  // basado en el bloom level más alto de los blocks

  const bloomTitles: Record<string, Record<string, string>> = {
    remember: {
      never_seen:   'Conociendo',
      know_little:  'Recordando',
      want_review:  'Repasando',
      already_know: 'Consolidando',
    },
    understand: {
      never_seen:   'Descubriendo',
      know_little:  'Comprendiendo',
      want_review:  'Dominando',
      already_know: 'Perfeccionando',
    },
    apply: {
      never_seen:   'Aprendiendo a aplicar',
      know_little:  'Aplicando',
      want_review:  'Practicando',
      already_know: 'Dominando la aplicación de',
    },
    analyze: {
      never_seen:   'Explorando',
      know_little:  'Analizando',
      want_review:  'Profundizando en',
      already_know: 'Dominando el análisis de',
    },
    evaluate: {
      never_seen:   'Explorando',
      know_little:  'Evaluando',
      want_review:  'Dominando',
      already_know: 'Perfeccionando',
    },
    create: {
      never_seen:   'Descubriendo',
      know_little:  'Aprendiendo a crear con',
      want_review:  'Creando con',
      already_know: 'Dominando',
    },
  };

  const bloom = topBloom || 'understand';
  const levelMap = bloomTitles[bloom] || bloomTitles.understand;
  const prefix = levelMap[knowledgeLevel] || levelMap.understand || 'Estudiando';

  if (unitsCount === 1) {
    return `${prefix} ${topicLabel}`;
  }
  // Con 2+ units: usar el topic dominante directamente
  return `${prefix} ${topicLabel}`;
}

// ─── PASO 5: Generar objetivo (objetivo cognitivo real) ────────

function generateObjective(
  units: CognitiveUnit[],
  sessionIndex: number,
  dominantUnit?: CognitiveUnit,
): string {
  if (units.length === 0) return 'Estudiar el material';

  // Siempre resolver el dominant internamente para evitar problemas de scope
  const dominant = dominantUnit
    ?? units.reduce((a, b) => a.cognitiveLoad >= b.cognitiveLoad ? a : b);

  if (units.length === 1) {
    const topBloom = dominant.bloomLevels[dominant.bloomLevels.length - 1] || 'understand';

    const objectivePhrases: Record<string, (topic: string, concept: string) => string> = {
      remember:   (t, _c) => `Identificar y recordar los elementos fundamentales de ${t}`,
      understand: (t, c)  => {
        if (!c || c.toLowerCase() === t.toLowerCase()) return `Comprender cómo funciona ${t}`;
        return `Comprender ${t} a través de conceptos como ${c}`;
      },
      apply:      (t, _c) => `Aplicar los principios de ${t} para resolver situaciones concretas`,
      analyze:    (t, c)  => `Analizar ${t}${c ? ` y sus conexiones con ${c}` : ' y sus relaciones internas'}`,
      evaluate:   (t, _c) => `Evaluar críticamente ${t} y sus implicaciones en la práctica`,
      create:     (t, _c) => `Integrar el conocimiento de ${t} para construir comprensión profunda`,
    };

    // Preferir conceptos reales (no nombres propios cortos)
    const realConcepts = dominant.concepts.filter(c => {
      const words = c.split(' ');
      const allCap = words.every(w => w.length === 0 || w[0] === w[0].toUpperCase());
      return !(allCap && words.length <= 3 && c.length < 25);
    });
    const firstConcept = realConcepts[0] || dominant.concepts[0] || '';
    const phraseGen = objectivePhrases[topBloom] || objectivePhrases.understand;
    return phraseGen(dominant.topicLabel, firstConcept);
  }

  if (units.length === 2) {
    const secondary = units.find(u => u.id !== dominant.id) || units[1];
    const topBloom = dominant.bloomLevels[dominant.bloomLevels.length - 1] || 'understand';

    const secondDependsOnFirst = secondary.dependsOnTopicIds.includes(dominant.topicId || '');
    const firstDependsOnSecond = dominant.dependsOnTopicIds.includes(secondary.topicId || '');

    if (secondDependsOnFirst || firstDependsOnSecond) {
      // El que es prerequisito va primero, el que depende va segundo
      const prereq = firstDependsOnSecond ? secondary : dominant;
      const dependent = firstDependsOnSecond ? dominant : secondary;
      return `Comprender ${prereq.topicLabel} como base para entender ${dependent.topicLabel}`;
    }

    const objectivePhrasesByBloom: Record<string, string> = {
      remember:   `Identificar los elementos clave de ${dominant.topicLabel} y ${secondary.topicLabel}`,
      understand: `Comprender ${dominant.topicLabel} y cómo se relaciona con ${secondary.topicLabel}`,
      apply:      `Aplicar los principios de ${dominant.topicLabel} junto con ${secondary.topicLabel}`,
      analyze:    `Analizar ${dominant.topicLabel} y ${secondary.topicLabel} en conjunto`,
      evaluate:   `Evaluar ${dominant.topicLabel} y sus conexiones con ${secondary.topicLabel}`,
      create:     `Integrar el conocimiento de ${dominant.topicLabel} y ${secondary.topicLabel}`,
    };
    return objectivePhrasesByBloom[topBloom] || objectivePhrasesByBloom.understand;
  }

  // 3+ units — usar los 2 más importantes (por carga cognitiva)
  const sortedByLoad = [...units].sort((a, b) => b.cognitiveLoad - a.cognitiveLoad);
  const first = sortedByLoad[0];
  const second = sortedByLoad[1];
  const topBloomMulti = dominant.bloomLevels[dominant.bloomLevels.length - 1] || 'understand';
  const verbMulti = BLOOM_VERBS[topBloomMulti] || 'Comprender';
  return `${verbMulti} ${first.topicLabel}, ${second.topicLabel} y conceptos relacionados`;
}

function generateWhy(
  units: CognitiveUnit[],
  allUnits: CognitiveUnit[],
  nextSessionUnits: CognitiveUnit[],
): string {
  if (nextSessionUnits.length > 0) {
    const nextTopic = nextSessionUnits[0].topicLabel;
    return `Necesario para comprender ${nextTopic}`;
  }

  const hasHighImportance = units.some(u => u.highImportanceCount > 0);
  if (hasHighImportance) {
    return 'Pieza clave del dominio completo del material';
  }

  return 'Completa la comprensión integral del tema';
}

// ─── PASO 7: Generar qué podrás hacer al terminar ─────────────

function generateWhatYouWillBeAbleToDo(units: CognitiveUnit[]): string[] {
  const results: string[] = [];

  for (const unit of units.slice(0, 2)) {
    const concepts = unit.concepts.slice(0, 3);
    const topBloom = unit.bloomLevels[unit.bloomLevels.length - 1] || 'understand';
    const verb = BLOOM_VERBS_INFINITIVE[topBloom] || 'explicar';

    if (concepts.length > 0) {
      results.push(`Podrás ${verb} ${concepts[0]}`);
      if (concepts.length > 1) {
        results.push(`Conectar ${concepts[0]} con ${concepts[1]}`);
      }
    } else {
      results.push(`Podrás ${verb} los conceptos de ${unit.topicLabel}`);
    }

    // Si hay fórmulas, agregar criterio específico
    if (unit.formulaCount > 0) {
      results.push(`Usar las fórmulas de ${unit.topicLabel} en problemas reales`);
    }
  }

  if (results.length === 0) {
    results.push('Avanzar con base sólida al siguiente bloque');
  }

  // Máximo 3
  return results.slice(0, 3);
}

// ─── PASO 8: Generar criterios de salida ──────────────────────

function generateExitCriteria(
  units: CognitiveUnit[],
  setup: AdaptiveSetup,
): string[] {
  const criteria: string[] = [];

  for (const unit of units) {
    const importantConcepts = unit.concepts.slice(0, 2);
    const topBloom = unit.bloomLevels[unit.bloomLevels.length - 1] || 'understand';
    const verb = BLOOM_VERBS[topBloom] || 'Explicar';

    for (const concept of importantConcepts) {
      criteria.push(`${verb} ${concept}`);
    }

    if (unit.formulaCount > 0) {
      criteria.push(`Aplicar las fórmulas de ${unit.topicLabel}`);
    }
  }

  // Criterio según preferencia de evaluación
  if (setup.evalPreference === 'quick_test' && criteria.length > 0) {
    criteria.push('Responder correctamente las preguntas rápidas');
  } else if (setup.evalPreference === 'write_explain') {
    criteria.push('Explicar el tema con tus propias palabras');
  }

  return criteria.slice(0, 4); // máx 4 criterios por sesión
}

// ─── PASO 9: Calcular carga cognitiva categórica ──────────────

function categorizeCognitiveLoad(units: CognitiveUnit[]): CognitiveLoad {
  const totalLoad = units.reduce((sum, u) => sum + u.cognitiveLoad, 0);
  const avgLoad = totalLoad / (units.length || 1);

  if (avgLoad >= 10) return 'heavy';
  if (avgLoad >= 5)  return 'medium';
  return 'light';
}

// ─── PASO 10: Construir sesión INTRO ──────────────────────────

function buildIntroSession(
  blueprint: Blueprint,
  setup: AdaptiveSetup,
  units: CognitiveUnit[],
): PlanSession {
  // Normalizar topics en buildIntroSession también
  const topics: BlueprintTopic[] = blueprint.topics?.length
    ? blueprint.topics
    : [];
  const blocks = blueprint.blocks || [];

  // Palabras clave importantes (importance >= 70)
  const keyVocabulary = (blueprint.concepts || [])
    .filter((c: any) => (c.importance || 0) >= 70)
    .slice(0, 8)
    .map((c: any) => c.name || c.label || '');

  // Qué será difícil
  const hardBlocks = blocks
    .filter(b => b.difficulty === 'advanced')
    .slice(0, 3)
    .map(b => b.label);

  const allTopicNames = topics.map(t => t.title).slice(0, 6);

  const whatYouWillBeAbleToDo = [
    'Identificar los temas principales del material',
    'Reconocer el vocabulario clave',
    keyVocabulary.length > 0
      ? `Familiarizarte con términos como: ${keyVocabulary.slice(0, 3).join(', ')}`
      : 'Entender la estructura del material',
    hardBlocks.length > 0
      ? `Anticipar los conceptos más desafiantes`
      : 'Preparar tu mente para el aprendizaje',
  ].filter(Boolean);

  const exitCriteria = [
    topics.length > 0
      ? `Nombrar los ${Math.min(topics.length, 5)} temas principales`
      : 'Identificar la estructura general del material',
    'Reconocer el vocabulario clave del material',
    'Identificar qué temas serán más desafiantes',
    setup.mainConcern && setup.mainConcern !== '(omitido)'
      ? `Entender cómo abordar: ${setup.mainConcern.slice(0, 60)}`
      : 'Tener una visión clara del camino de aprendizaje',
  ].filter(Boolean);

  return {
    sessionNumber: 1,
    type: 'intro',
    title: 'Antes de comenzar',
    objective: 'Preparar tu mente para este material',
    why: 'Un mapa mental claro acelera el aprendizaje de todo lo que sigue',
    whatYouWillBeAbleToDo,
    unitIds: [],
    blockIds: [],
    topicIds: topics.map(t => t.id),
    pages: Array.from(new Set(blocks.flatMap(b => b.pages || []))).sort((a, b) => a - b).slice(0, 5),
    concepts: keyVocabulary,
    prerequisites: [],
    unlocks: [2],
    exitCriteria,
    cognitiveLoad: 'light',
    conceptCount: keyVocabulary.length,
    highImportanceCount: 0,
    difficultyBreakdown: { basic: 0, intermediate: 0, advanced: 0 },
    status: 'available',
  };
}

// ─── PASO 11: Distribuir units en sesiones DEEP ───────────────
// Equilibra carga cognitiva. Nunca divide un cognitive unit.

function distributeUnitsIntoDeepSessions(
  units: CognitiveUnit[],
  maxUnitsPerSession: number,
  setup: AdaptiveSetup,
  startSessionNumber: number,
): PlanSession[] {
  const sessions: PlanSession[] = [];

  // Calcular número exacto de sesiones y distribuir equitativamente
  const totalUnits = units.length;
  const numSessions = Math.max(1, Math.ceil(totalUnits / maxUnitsPerSession));

  // Distribuir units en exactamente numSessions grupos
  // usando round-robin para equilibrar carga
  const groups: CognitiveUnit[][] = Array.from({ length: numSessions }, () => []);

  // Ordenar por carga descendente para distribuir mejor
  const sortedByLoad = [...units].sort((a, b) => b.cognitiveLoad - a.cognitiveLoad);

  // Asignar cada unit al grupo con menor carga acumulada
  for (const unit of sortedByLoad) {
    const loads = groups.map(g => g.reduce((s, u) => s + u.cognitiveLoad, 0));
    const minIdx = loads.indexOf(Math.min(...loads));
    groups[minIdx].push(unit);
  }

  // Re-ordenar cada grupo por globalOrderStart para respetar el orden del material
  for (const group of groups) {
    group.sort((a, b) => a.globalOrderStart - b.globalOrderStart);
  }

  // Re-ordenar los grupos por el globalOrderStart del primer elemento
  // EXCEPCIÓN: grupos que contienen units genéricas van al final
  const GENERIC_PATTERN_DIST = /^(contexto|context|general|introduction|introduccion|complementar)/i;

  groups.sort((a, b) => {
    const aHasGeneric = a.some(u => GENERIC_PATTERN_DIST.test(u.topicLabel));
    const bHasGeneric = b.some(u => GENERIC_PATTERN_DIST.test(u.topicLabel));

    // Grupos con topics genéricos siempre al final
    if (aHasGeneric && !bHasGeneric) return 1;
    if (!aHasGeneric && bHasGeneric) return -1;

    // Si ambos son genéricos o ambos no lo son, ordenar por globalOrder
    const aFirst = a[0]?.globalOrderStart ?? 0;
    const bFirst = b[0]?.globalOrderStart ?? 0;
    return aFirst - bFirst;
  });

  for (const sessionUnits of groups) {
    if (sessionUnits.length === 0) continue;

    const sessionNumber = startSessionNumber + sessions.length;
    const isIntegration = sessionUnits.length >= 2;

    const type: 'deep' | 'integration' = 'deep'; // integration deshabilitado — deps son blockIds no topicIds

    // Para el título: usar el unit con mayor importancia acumulada (highImportanceCount)
    // Si hay empate, usar el que viene primero en el material (menor globalOrderStart)
    const titleUnit = sessionUnits.reduce((best, u) => {
      if (u.highImportanceCount > best.highImportanceCount) return u;
      if (u.highImportanceCount === best.highImportanceCount &&
          u.globalOrderStart < best.globalOrderStart) return u;
      return best;
    });
    // Para el objective: usar el unit con mayor carga cognitiva
    const dominantUnit = sessionUnits.reduce((a, b) => a.cognitiveLoad >= b.cognitiveLoad ? a : b);
    const titleBloom = titleUnit.bloomLevels[titleUnit.bloomLevels.length - 1];
    const title = generateSessionTitle(
      titleUnit.topicLabel,
      sessions.length + 1,
      setup.knowledgeLevel,
      sessionUnits.length,
      titleBloom,
    );

    const objective = generateObjective(sessionUnits, sessions.length + 1, dominantUnit);

    // Calcular qué units vienen en la siguiente sesión (para el "why")
    const currentGroupIdx = groups.indexOf(sessionUnits);
    const nextGroup = currentGroupIdx >= 0 && currentGroupIdx < groups.length - 1
      ? groups[currentGroupIdx + 1]
      : [];
    const why = generateWhy(sessionUnits, units, nextGroup);

    const whatYouWillBeAbleToDo = generateWhatYouWillBeAbleToDo(sessionUnits);
    const exitCriteria = generateExitCriteria(sessionUnits, setup);
    const cognitiveLoad = categorizeCognitiveLoad(sessionUnits);

    const allBlockIds = sessionUnits.flatMap(u => u.blockIds);
    const allTopicIds = sessionUnits.map(u => u.topicId).filter(Boolean) as string[];
    const allPages = Array.from(new Set(sessionUnits.flatMap(u => u.pages))).sort((a, b) => a - b);
    const allConcepts = sessionUnits.flatMap(u => u.concepts);

    const difficultyBreakdown = {
      basic:        sessionUnits.reduce((s, u) => s + u.difficultyBreakdown.basic, 0),
      intermediate: sessionUnits.reduce((s, u) => s + u.difficultyBreakdown.intermediate, 0),
      advanced:     sessionUnits.reduce((s, u) => s + u.difficultyBreakdown.advanced, 0),
    };

    sessions.push({
      sessionNumber,
      type,
      title,
      objective,
      why,
      whatYouWillBeAbleToDo,
      unitIds: sessionUnits.map(u => u.id),
      blockIds: allBlockIds,
      topicIds: allTopicIds,
      pages: allPages,
      concepts: allConcepts,
      prerequisites: [sessionNumber - 1],
      unlocks: [sessionNumber + 1],
      exitCriteria,
      cognitiveLoad,
      conceptCount: allConcepts.length,
      highImportanceCount: sessionUnits.reduce((s, u) => s + u.highImportanceCount, 0),
      difficultyBreakdown,
      status: 'locked',
    });
  }

  return sessions;
}

// ─── PASO 12: Construir sesión FINAL ──────────────────────────

function buildFinalSession(
  blueprint: Blueprint,
  setup: AdaptiveSetup,
  sessionNumber: number,
  allUnits: CognitiveUnit[],
): PlanSession {
  const blocks = blueprint.blocks || [];

  // High-importance blocks para el repaso
  const highImportance = blocks.filter(b => b.importance >= 70);

  // Simulacro según estilo del profe
  const examStyles = setup.professorExamStyle || [];
  const exitCriteria: string[] = [];

  if (examStyles.includes('multiple_choice')) {
    exitCriteria.push('Resolver preguntas de opción múltiple sin errores');
  }
  if (examStyles.includes('development')) {
    exitCriteria.push('Explicar el tema principal de forma completa');
  }
  if (examStyles.includes('true_false')) {
    exitCriteria.push('Distinguir enunciados verdaderos y falsos');
  }
  if (examStyles.includes('matching')) {
    exitCriteria.push('Relacionar conceptos con sus definiciones');
  }
  if (exitCriteria.length === 0) {
    exitCriteria.push('Demostrar comprensión completa del material');
    exitCriteria.push('Conectar todos los temas vistos');
  }

  // Conceptos más importantes para repasar
  const topConcepts = (blueprint.concepts || [])
    .filter((c: any) => (c.importance || 0) >= 70)
    .slice(0, 10)
    .map((c: any) => c.name || c.label || '');

  const mainConcernNote = setup.mainConcern && setup.mainConcern !== '(omitido)'
    ? `Reforzar: ${setup.mainConcern.slice(0, 60)}`
    : null;

  if (mainConcernNote) exitCriteria.push(mainConcernNote);

  const topics = blueprint.topics || [];

  return {
    sessionNumber,
    type: 'final_review',
    title: 'Conquista final',
    objective: 'Demostrar dominio completo del material',
    why: 'Consolida todo lo aprendido y te prepara para el desafío real',
    whatYouWillBeAbleToDo: [
      'Recordar y conectar todos los temas estudiados',
      'Resolver el tipo de preguntas de tu examen',
      exitCriteria[0] || 'Demostrar comprensión completa',
    ],
    unitIds: allUnits.map(u => u.id),
    blockIds: highImportance.map(b => b.id),
    topicIds: topics.map(t => t.id),
    pages: Array.from(new Set(blocks.flatMap(b => b.pages || []))).sort((a, b) => a - b),
    concepts: topConcepts,
    prerequisites: [sessionNumber - 1],
    unlocks: [],
    exitCriteria: exitCriteria.slice(0, 4),
    cognitiveLoad: 'heavy',
    conceptCount: topConcepts.length,
    highImportanceCount: highImportance.length,
    difficultyBreakdown: {
      basic:        allUnits.reduce((s, u) => s + u.difficultyBreakdown.basic, 0),
      intermediate: allUnits.reduce((s, u) => s + u.difficultyBreakdown.intermediate, 0),
      advanced:     allUnits.reduce((s, u) => s + u.difficultyBreakdown.advanced, 0),
    },
    status: 'locked',
  };
}

// ─── PASO 13: Construir dependency map ────────────────────────

function buildDependencyMap(
  topics: BlueprintTopic[],
  units: CognitiveUnit[],
) {
  return topics.map(topic => {
    const unit = units.find(u => u.topicId === topic.id);
    return {
      topicId: topic.id,
      topicLabel: topic.title,
      dependsOn: unit?.dependsOnTopicIds || [],
    };
  });
}

// ─── PASO 14: Construir objetivos del programa ────────────────

function buildProgramObjectives(
  topics: BlueprintTopic[],
  setup: AdaptiveSetup,
): string[] {
  const verbMap: Record<string, string> = {
    never_seen:   'Comprender',
    know_little:  'Aplicar',
    want_review:  'Dominar',
    already_know: 'Perfeccionar',
  };
  const verb = verbMap[setup.knowledgeLevel] || 'Comprender';

  const objectives = topics
    .map(t => `${verb} ${t.title}`);

  if (objectives.length === 0) {
    objectives.push('Dominar el material completo');
  }

  return objectives;
}

// ─── FUNCIÓN PRINCIPAL ────────────────────────────────────────

export function generateStudyPlan(
  rawBlueprint: any,
  setup: AdaptiveSetup,
  userProfile: UserProfile | null,
  materialTitle: string,
): StudyPlan {
  const blueprint = normalizeBlueprint(rawBlueprint);
  // Normalizar topics — puede venir como topics o topicsIndex según la fuente
  const topics: BlueprintTopic[] = (
    blueprint.topics?.length ? blueprint.topics :
    (rawBlueprint?.topicsIndex || rawBlueprint?.topics || [])
  );
  const blocks = blueprint.blocks || [];

  // PASO 1: Cognitive units
  const cognitiveUnits = buildCognitiveUnits(blueprint);

  if (cognitiveUnits.length === 0) {
    // Edge case: blueprint vacío
    const emptyPlan: StudyPlan = {
      id: `plan_${Date.now().toString(36)}`,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      materialTitle,
      programGoal: `Dominar ${materialTitle}`,
      programObjectives: ['Completar el material'],
      coverageTarget: 100,
      totalCognitiveUnits: 0,
      dependencyMap: [],
      sessions: [],
      totalSessions: 0,
      blueprintVersion: rawBlueprint?.version || 1,
      setupSnapshot: setup,
      cognitiveUnits: [],
    };
    return emptyPlan;
  }

  // PASO 2: Densidad y número de sesiones
  const { deepSessions, maxUnitsPerSession, pressureLabel } =
    calculateDensity(cognitiveUnits.length, setup);

  // PASO 3: Sesión intro
  const introSession = buildIntroSession(blueprint, setup, cognitiveUnits);

  // PASO 4: Sesiones deep (2..N-1)
  // Reordenar cognitive units: topics genéricos al final
  const GENERIC_PATTERN = /^(contexto|context|general|introduction|introduccion|introducción|overview|misc|complementar)/i;
  const orderedUnits = [
    ...cognitiveUnits.filter(u => !GENERIC_PATTERN.test(u.topicLabel)),
    ...cognitiveUnits.filter(u => GENERIC_PATTERN.test(u.topicLabel)),
  ];



  const deepSessionList = distributeUnitsIntoDeepSessions(
    orderedUnits,
    maxUnitsPerSession,
    setup,
    2, // empiezan en sessionNumber 2
  );

  // PASO 5: Sesión final
  const finalSessionNumber = 2 + deepSessionList.length;
  const finalSession = buildFinalSession(
    blueprint,
    setup,
    finalSessionNumber,
    cognitiveUnits,
  );

  // PASO 6: Unir todas las sesiones
  const allSessions = [introSession, ...deepSessionList, finalSession];

  // PASO 7: Fijar unlocks de la última deep → final
  if (deepSessionList.length > 0) {
    const lastDeep = allSessions[allSessions.length - 2];
    lastDeep.unlocks = [finalSessionNumber];
  } else {
    // Solo intro + final
    introSession.unlocks = [finalSessionNumber];
  }
  // Final no desbloquea nada
  finalSession.unlocks = [];

  // PASO 8: Dependency map
  const dependencyMap = buildDependencyMap(topics, cognitiveUnits);

  // PASO 9: Objetivos del programa
  const programObjectives = buildProgramObjectives(topics, setup);

  const cleanTitle = materialTitle
    .replace(/\.(pdf|docx?|pptx?|txt|png|jpg|jpeg|webp)$/i, '')
    .trim();
  // Capitalizar primera letra de cada palabra si el título está en minúsculas
  const capitalizedTitle = cleanTitle
    .split(' ')
    .map((word: string) => word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word)
    .join(' ');
  const programGoal = `Dominar ${capitalizedTitle}`;

  return {
    id: `plan_${Date.now().toString(36)}`,
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    materialTitle: capitalizedTitle,
    programGoal,
    programObjectives,
    coverageTarget: 100,
    totalCognitiveUnits: cognitiveUnits.length,
    dependencyMap,
    sessions: allSessions,
    totalSessions: allSessions.length,
    blueprintVersion: rawBlueprint?.version || 1,
    setupSnapshot: setup,
    cognitiveUnits,
  };
}
