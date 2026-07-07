import type { AdaptiveProgram } from './adaptive/program';
// Blueprint eliminado — funciones stub para no romper masteryEngine
const calculateTopicMastery = (..._args: any[]): any[] => []
const buildConceptScoreMap = (..._args: any[]): Record<string, number> => ({})
const getWeakTopics = (..._args: any[]): any[] => []
const getCriticalTopics = (..._args: any[]): any[] => []
const getDominatedTopics = (..._args: any[]): any[] => []
// ═══════════════════════════════════════════════════════════════
// StudyAL Mastery Engine v2.0
// Dominio real medido por evidencia, no por clics.
// ═══════════════════════════════════════════════════════════════

export type ForgettingRisk = 'very_high' | 'high' | 'medium' | 'low' | 'very_low';
export type MasteryDimension = 'understanding' | 'memory' | 'application' | 'explanation' | 'exam';
export type StudyMode = 'emergency' | 'fast' | 'balanced' | 'mastery';
export type ExamDate = 'today' | 'tomorrow' | 'this_week' | 'custom' | 'just_studying';
export type ToolId = 'repasar' | 'analisis' | 'studymap' | 'truquitos' | 'flashcards' | 'quiz' | 'examen' | 'alai';

export type CognitiveState =
  | 'sin_exposicion'
  | 'reconoce'
  | 'recuerda'
  | 'aplica'
  | 'explica_basico'
  | 'puede_ensenar';

export type RelationType =
  | 'prerequisite'
  | 'part_of'
  | 'causes'
  | 'related'
  | 'contrasts'
  | 'prerequisite_of'
  | 'depends_on'
  | 'requires'
  | 'example_of'
  | 'compared_with'
  | 'opposite_of';

// ── Timeline entry ──────────────────────────────────────────────
export interface TimelineEntry {
  timestamp: number;
  tool: ToolId;
  overallMastery: number;
  dimensions: {
    understanding: number;
    memory: number;
    application: number;
    explanation: number;
    exam: number;
  };
  conceptsUpdated: string[];
}

// ── Concept ─────────────────────────────────────────────────────
export interface ConceptDomain {
  id: string;
  name: string;
  materialId: string;

  // 5 dimensiones (0-100)
  understanding: number;
  memory: number;
  application: number;
  explanation: number;
  exam: number;

  // Métricas adicionales
  confidence: number;
  speed: number;
  stability: number;

  // Historia
  attempts: number;
  mistakes: number;
  lastReviewed: number | null;
  previousScores: number[];

  // Estado cognitivo calculado
  cognitiveState: CognitiveState;

  // Velocidad de aprendizaje
  learningRate: number;        // 0-100: qué tan rápido aprende este concepto
  avgImprovementPerAttempt: number;

  // Riesgo y acción
  forgettingRisk: ForgettingRisk;
  recommendedAction: string;
  recommendedTool: ToolId | null;

  // ── Blueprint topic context ──────────────────────────────────
  // Se llena cuando hay MaterialBlueprint disponible
  topicId?: string          // id del MaterialTopic al que pertenece
  topicTitle?: string       // título del tema: 'Respiración celular'
  sourcePages?: number[]    // páginas del material donde aparece
  importance?: number       // 0-100 importancia para el examen
  difficulty?: number       // 0-100 dificultad del concepto
}

// ── Material Mastery ────────────────────────────────────────────
export interface MaterialMastery {
  materialId: string;
  materialName: string;
  sessionKey: string;

  concepts: ConceptDomain[];
  conceptsExtracted: boolean;
  knowledgeGraph?: KnowledgeGraph;
  lastUpdated: number;

  // Configuración
  examDate: ExamDate | null;
  examDateCustom: string | null;
  targetScore: number;
  dailyMinutes: number | null;
  studyMode: StudyMode;
  processMode?: 'guided' | 'free' | 'adaptive';
  adaptiveProgram?: AdaptiveProgram | null;

  // ── Material Blueprint ───────────────────────────────────────
  // Análisis completo del material — base del modo adaptativo
  materialBlueprint?: any | null
  topics?: any[]
  conceptToTopicMap?: Record<string, string>  // conceptId → topicId

  // Herramientas
  toolsCompleted: Record<ToolId, boolean>;
  toolsData: Record<ToolId, ToolData>;

  // Timeline (máx 50 entradas)
  timeline: TimelineEntry[];

  // Memoria semanal
  weeklyMemory: WeeklyMemory[];

  // Hashes de contenido generado (anti-repetición)
  contentHashes: string[];

  // ── Modo libre: progreso por uso de herramientas ──
  // Se acumula por herramienta única usada
  freeModeProgress?: {
    repasar: number;
    analisis: number;
    studymap: number;
    truquitos: number;
    flashcards: number;
    quiz: number;
    examen: number;
    alai: number;
  };

  // Memoria pedagógica
  pedagogicMemory: {
    examplesUsed: string[];
    analogiesUsed: string[];
    bestExplanationStyle: 'visual' | 'narrative' | 'analogy' | 'example' | 'unknown';
    avgResponseTime: number | null;
    preferredDifficulty: number; // 0-100
  };
}

// ── Tool Data ───────────────────────────────────────────────────
export interface ToolData {
  completedAt: number | null;
  sessions: number;
  lastScore: number | null;
  totalCorrect: number;
  totalWrong: number;
  avgTimeMs: number | null;
  avgConfidence: number | null;
  conceptsCovered: string[];
}

// ── Mastery Event ───────────────────────────────────────────────
export interface MasteryEvent {
  tool: ToolId;
  materialId: string;
  sessionKey: string;
  timestamp: number;

  conceptsIdentified?: string[];
  score?: number;
  correct?: boolean;
  confidence?: number;
  timeMs?: number;
  conceptName?: string;
  coveragePercent?: number;
  mistakeTypes?: string[];
  explanationQuality?: number;
evidenceType?: 'recall' | 'explanation' | 'application' | 'exam' | 'correction';
evidenceStrength?: 'weak' | 'medium' | 'strong';

// ── Contexto de blueprint/topic ───────────────────────────────
topicId?: string;
topicTitle?: string;
sourcePages?: number[];
importance?: number;
difficulty?: number;

  // ── Modo libre: uso directo de herramienta ──
  // Si freeModeUse === true, suma freeDomainPct al dominio
  // sin pasar por la lógica de dimensiones/evidencia
  freeModeUse?: boolean;
  freeDomainPct?: number;
}

// ── Mastery Snapshot ────────────────────────────────────────────
// ── Topic Mastery ────────────────────────────────────────────────
export interface TopicMasteryScore {
  topicId: string
  topicTitle: string
  score: number           // 0-100 dominio promedio del topic
  conceptCount: number    // cuántos conceptos tiene el topic
  coveredCount: number    // cuántos conceptos tienen al menos 1 attempt
  dominated: boolean      // score >= 80
  weak: boolean           // score < 40
  critical: boolean       // score < 20
  strongConcepts: string[]
  weakConcepts: string[]
}

export interface MasterySnapshot {
  overallMastery: number;
  understanding: number;
  memory: number;
  application: number;
  explanation: number;
  exam: number;

  dominatedConcepts: ConceptDomain[];
  intermediateConcepts: ConceptDomain[];
  weakConcepts: ConceptDomain[];
  criticalConcepts: ConceptDomain[];

  // ── Topic-level mastery (populated when blueprint exists) ──
  topicMastery?: TopicMasteryScore[];
  dominatedTopics?: TopicMasteryScore[];
  weakTopics?: TopicMasteryScore[];
  criticalTopics?: TopicMasteryScore[];

  examReadiness: number;
  retention7Days: number;
  retention30Days: number;

  // Predicción de examen
  examPassProbability: number;     // 0-100
  examExcellentProbability: number; // 0-100
  studyImpactForecast: StudyImpactForecastEntry[];

  nextAction: CoachRecommendation;
  studyPlan: StudyPlanDay[] | null;

  // Timeline para gráfica de progreso
  timeline: TimelineEntry[];
}

// ── Coach Recommendation ────────────────────────────────────────
export interface CoachRecommendation {
  tool: ToolId;
  reason: string;  // alias de message para compatibilidad
  urgency: 'critical' | 'high' | 'medium' | 'low';
  conceptFocus: string | null;
  estimatedMinutes: number;
  message: string;
}

// ── Study Plan ──────────────────────────────────────────────────
export interface StudyPlanDay {
  day: number;
  label: string;
  tools: ToolId[];
  focus: string;
  estimatedMinutes: number;
}

export interface SessionSummary {
  tool: ToolId;
  timestamp: number;
  dimensionGains: Partial<Record<MasteryDimension, number>>;
  conceptsImproved: string[];
  conceptsStillWeak: string[];
  nextRecommendedTool: ToolId;
  nextRecommendedConcept: string | null;
  overallGain: number;
}

export interface StudyBlock {
  id: string;
  label: string;
  phase: 'understand' | 'organize' | 'memorize' | 'apply' | 'demonstrate' | 'repair';
  tools: ToolId[];
  description: string;
  emoji: string;
  estimatedMinutes: number;
  completed: boolean;
  isNext: boolean;
}

export interface WeeklyMemory {
  weekStart: number;               // timestamp del lunes de esa semana
  conceptsFailedRepeatedly: string[]; // fallados 2+ veces esa semana
  conceptsImproved: string[];      // mejoraron en esa semana
  dominantPattern: 'comprension' | 'memoria' | 'aplicacion' | 'confusion' | 'bueno';
  avgMastery: number;
  sessionCount: number;
}

export interface StudyImpactForecastEntry {
  minutes: number;
  expectedMastery: number;
  expectedPassProbability: number;
}

// ── Knowledge Graph ─────────────────────────────────────────────
export interface ConceptRelation {
  from: string;
  to: string;
  type: RelationType;
  strength: number;
}

export interface KnowledgeGraph {
  concepts: string[];
  relations: ConceptRelation[];
}

// ── Mastery Context ─────────────────────────────────────────────
export interface MasteryContext {
  weakConcepts: string[];
  criticalConcepts: string[];
  strongConcepts: string[];
  forgettingRiskConcepts: string[];
  repeatedMistakes: string[];
  illusionConcepts: string[];

  understanding: number;
  memory: number;
  application: number;
  explanation: number;
  exam: number;
  overallMastery: number;

  studentProfile: 'beginner' | 'memorizer' | 'understander' | 'applier' | 'advanced';
  recommendedFocus: 'understand' | 'memorize' | 'apply' | 'explain' | 'review';

  // Dificultad continua 0-100
  recommendedDifficulty: number;

  examDate: string | null;
  targetScore: number;
  daysToExam: number | null;

  // Para anti-repetición
  contentHashes: string[];
  examplesUsed: string[];
}

// ═══════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════

const MASTERY_PREFIX = 'studyal_mastery_v2_';

export function getMasteryStorageKey(materialIds: string[]): string {
  return MASTERY_PREFIX + [...materialIds].sort().join('-');
}

export function loadMaterialMastery(sessionKey: string): MaterialMastery | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(sessionKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Migrar desde v1 si no tiene timeline
    if (!parsed.timeline) parsed.timeline = [];
    if (!parsed.contentHashes) parsed.contentHashes = [];
    if (!parsed.weeklyMemory) parsed.weeklyMemory = [];
    if (!parsed.pedagogicMemory) parsed.pedagogicMemory = createEmptyPedagogicMemory();

    // ── Inicializar freeModeProgress si no existe ──
    if (!parsed.freeModeProgress) {
      parsed.freeModeProgress = {
        repasar: 0, analisis: 0, studymap: 0, truquitos: 0,
        flashcards: 0, quiz: 0, examen: 0, alai: 0,
      };
    } else {
      // ── Reset: solo conservar % de herramientas REALMENTE completadas ──
      // Esto arregla masteries viejos donde freeModeProgress se contaminó
      const toolsCompleted = parsed.toolsCompleted || {};
      const cleanProgress = {
        repasar: toolsCompleted.repasar ? (parsed.freeModeProgress.repasar || 0) : 0,
        analisis: toolsCompleted.analisis ? (parsed.freeModeProgress.analisis || 0) : 0,
        studymap: toolsCompleted.studymap ? (parsed.freeModeProgress.studymap || 0) : 0,
        truquitos: toolsCompleted.truquitos ? (parsed.freeModeProgress.truquitos || 0) : 0,
        flashcards: toolsCompleted.flashcards ? (parsed.freeModeProgress.flashcards || 0) : 0,
        quiz: toolsCompleted.quiz ? (parsed.freeModeProgress.quiz || 0) : 0,
        examen: toolsCompleted.examen ? (parsed.freeModeProgress.examen || 0) : 0,
        alai: toolsCompleted.alai ? (parsed.freeModeProgress.alai || 0) : 0,
      };
      parsed.freeModeProgress = cleanProgress;
    }

    // ── Migración modo adaptativo ──
    if (parsed.processMode === 'guided') {
      parsed.processMode = 'adaptive';
    }
    if (!parsed.processMode) {
      parsed.processMode = 'free';
    }
    if (parsed.adaptiveProgram === undefined) {
      parsed.adaptiveProgram = null;
    }

    parsed.toolsCompleted = {
      repasar: false,
      analisis: false,
      studymap: false,
      truquitos: false,
      flashcards: false,
      quiz: false,
      examen: false,
      alai: false,
      ...(parsed.toolsCompleted || {}),
    };

    parsed.toolsData = {
      repasar: emptyToolData(),
      analisis: emptyToolData(),
      studymap: emptyToolData(),
      truquitos: emptyToolData(),
      flashcards: emptyToolData(),
      quiz: emptyToolData(),
      examen: emptyToolData(),
      alai: emptyToolData(),
      ...(parsed.toolsData || {}),
    };

    return parsed;
  } catch {
    return null;
  }
}

export function saveMaterialMastery(mastery: MaterialMastery): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(mastery.sessionKey, JSON.stringify(mastery));
  } catch {}

  // Sync servidor en background
  if (typeof window !== 'undefined') {
    fetch('/api/mastery/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionKey: mastery.sessionKey,
        masteryData: mastery,
      }),
    }).catch(() => {});
  }
}

function createEmptyPedagogicMemory(): MaterialMastery['pedagogicMemory'] {
  return {
    examplesUsed: [],
    analogiesUsed: [],
    bestExplanationStyle: 'unknown',
    avgResponseTime: null,
    preferredDifficulty: 50,
  };
}

export function createEmptyMastery(params: {
  materialIds: string[];
  materialNames: string[];
  sessionKey: string;
}): MaterialMastery {
  const now = Date.now();
  return {
    materialId: params.materialIds[0] || '',
    materialName: params.materialNames[0] || 'Material',
    sessionKey: params.sessionKey,
    concepts: [],
    conceptsExtracted: false,
    lastUpdated: now,
    examDate: null,
    examDateCustom: null,
    targetScore: 80,
    dailyMinutes: null,
    studyMode: 'balanced',
    processMode: 'free',
    adaptiveProgram: null,
    toolsCompleted: {
      repasar: false, analisis: false, studymap: false, truquitos: false,
      flashcards: false, quiz: false, examen: false, alai: false,
    },
    toolsData: {
      repasar: emptyToolData(), analisis: emptyToolData(), studymap: emptyToolData(),
      truquitos: emptyToolData(), flashcards: emptyToolData(), quiz: emptyToolData(),
      examen: emptyToolData(), alai: emptyToolData(),
    },
    timeline: [],
    weeklyMemory: [],
    contentHashes: [],
    pedagogicMemory: createEmptyPedagogicMemory(),
    freeModeProgress: {
      repasar: 0, analisis: 0, studymap: 0, truquitos: 0,
      flashcards: 0, quiz: 0, examen: 0, alai: 0,
    },
  };
}

function emptyToolData(): ToolData {
  return {
    completedAt: null, sessions: 0, lastScore: null,
    totalCorrect: 0, totalWrong: 0, avgTimeMs: null,
    avgConfidence: null, conceptsCovered: [],
  };
}

// ═══════════════════════════════════════════════════════════════
// FORGETTING CURVE — Aplicar olvido al cargar
// ═══════════════════════════════════════════════════════════════

export function applyForgettingCurve(mastery: MaterialMastery): MaterialMastery {
  const now = Date.now();
  const updatedConcepts = mastery.concepts.map(concept => {
    if (!concept.lastReviewed) return concept;

    const hoursSince = (now - concept.lastReviewed) / (1000 * 60 * 60);
    if (hoursSince < 1) return concept;

    const overallScore = getConceptOverallScore(concept);
    // Estabilidad dinámica: más dominio = olvida más lento
    const stability = 1 + (overallScore / 100) * 20;
    const retention = Math.exp(-hoursSince / (stability * 24));
    const decay = Math.max(0.6, retention);

    return {
      ...concept,
      memory: Math.round(concept.memory * decay),
      stability: Math.round(concept.stability * Math.max(0.8, retention)),
      forgettingRisk: calculateForgettingRisk({ ...concept, memory: Math.round(concept.memory * decay) }),
    };
  });

  return { ...mastery, concepts: updatedConcepts };
}

// ═══════════════════════════════════════════════════════════════
// COGNITIVE STATE
// ═══════════════════════════════════════════════════════════════

export function getCognitiveState(concept: ConceptDomain): CognitiveState {
  const { understanding, memory, application, explanation } = concept;
  if (understanding < 20) return 'sin_exposicion';
  if (understanding >= 20 && memory < 30) return 'reconoce';
  if (memory >= 30 && application < 40) return 'recuerda';
  if (application >= 40 && explanation < 50) return 'aplica';
  if (explanation >= 50 && explanation < 75) return 'explica_basico';
  if (explanation >= 75) return 'puede_ensenar';
  return 'reconoce';
}

export const cognitiveLabels: Record<CognitiveState, string> = {
  sin_exposicion: 'Sin exposición',
  reconoce: '✓ Reconoce',
  recuerda: '✓ Recuerda',
  aplica: '✓ Aplica',
  explica_basico: '✓ Puede explicar',
  puede_ensenar: '✓ Puede enseñar',
};

// ═══════════════════════════════════════════════════════════════
// CONCEPT MANAGEMENT
// ═══════════════════════════════════════════════════════════════

export function createConcept(
  name: string,
  materialId: string,
  topicContext?: { topicId?: string; topicTitle?: string; sourcePages?: number[]; importance?: number; difficulty?: number }
): ConceptDomain {
  return {
    id: name.toLowerCase().replace(/\s+/g, '_').slice(0, 50),
    name, materialId,
    understanding: 0, memory: 0, application: 0, explanation: 0, exam: 0,
    confidence: 0, speed: 0, stability: 0,
    attempts: 0, mistakes: 0,
    lastReviewed: null, previousScores: [],
    cognitiveState: 'sin_exposicion',
    learningRate: 50,
    avgImprovementPerAttempt: 0,
    forgettingRisk: 'very_high',
    recommendedAction: 'Empieza con Repasar para familiarizarte con este concepto.',
    recommendedTool: 'repasar',
    topicId: topicContext?.topicId,
    topicTitle: topicContext?.topicTitle,
    sourcePages: topicContext?.sourcePages,
    importance: topicContext?.importance,
    difficulty: topicContext?.difficulty,
  };
}

// ═══════════════════════════════════════════════════════════════
// EVENT PROCESSING
// ═══════════════════════════════════════════════════════════════

export function processEvent(mastery: MaterialMastery, event: MasteryEvent): MaterialMastery {
  let updated = { ...mastery, lastUpdated: event.timestamp };

  // ── MODO LIBRE — uso de herramienta = % fijo de dominio ──
  if (event.freeModeUse && event.freeDomainPct) {
    const currentProgress = updated.freeModeProgress || {
      repasar: 0, analisis: 0, studymap: 0, truquitos: 0,
      flashcards: 0, quiz: 0, examen: 0, alai: 0,
    };

    // Cada herramienta tiene un tope. Solo cuenta la primera vez.
    const currentPct = currentProgress[event.tool] || 0;
    const newPct = currentPct >= event.freeDomainPct
      ? currentPct
      : event.freeDomainPct;

    updated.freeModeProgress = {
      ...currentProgress,
      [event.tool]: newPct,
    };

    // Marcar tool como completada
    updated.toolsCompleted = {
      ...mastery.toolsCompleted,
      [event.tool]: true,
    };

    // Actualizar tool data
    updated.toolsData = {
      ...mastery.toolsData,
      [event.tool]: updateToolData(mastery.toolsData[event.tool] || emptyToolData(), event),
    };

    // Agregar al timeline
    const totalFree = Object.values(updated.freeModeProgress).reduce((a, b) => a + b, 0);
    const entry: TimelineEntry = {
      timestamp: event.timestamp,
      tool: event.tool,
      overallMastery: totalFree,
      dimensions: {
        understanding: 0, memory: 0, application: 0,
        explanation: 0, exam: 0,
      },
      conceptsUpdated: [],
    };
    updated.timeline = [...(mastery.timeline || []).slice(-49), entry];

    return updated;
  }


  updated.toolsData = {
    ...mastery.toolsData,
    [event.tool]: updateToolData(mastery.toolsData[event.tool] || emptyToolData(), event),
  };

  if (event.score !== undefined && event.score >= 0) {
    updated.toolsCompleted = {
      ...mastery.toolsCompleted,
      [event.tool]: true,
    };
  }

  // Guardar score anterior para calcular learningRate
  const prevScores = mastery.concepts.map(c => ({
    id: c.id, score: getConceptOverallScore(c),
  }));

  updated.concepts = updateConceptsFromEvent(mastery.concepts, event);

  // Calcular learningRate después del update
  updated.concepts = updated.concepts.map(c => {
    const prev = prevScores.find(p => p.id === c.id);
    if (!prev) return c;
    const improvement = getConceptOverallScore(c) - prev.score;
    const newLearningRate = c.attempts > 1
      ? Math.round(
          (c.learningRate * (c.attempts - 1) + Math.max(0, improvement * 10)) / c.attempts
        )
      : c.learningRate;
    const avgImprovement = c.attempts > 0
      ? Math.round(
          (c.avgImprovementPerAttempt * (c.attempts - 1) + improvement) / c.attempts
        )
      : 0;
    return {
      ...c,
      learningRate: Math.min(100, Math.max(0, newLearningRate)),
      avgImprovementPerAttempt: avgImprovement,
      cognitiveState: getCognitiveState(c),
    };
  });

  if (updated.knowledgeGraph?.relations?.length) {
    updated.concepts = propagateDomainThroughGraph(updated.concepts, updated.knowledgeGraph);
  }

  // Actualizar memoria semanal
  updated = updateWeeklyMemory(updated);

  // Añadir entrada al timeline
  const snap = aggregateDimensions(updated.concepts);
  const overall = calculateOverallFromDims(snap, updated);
  const entry: TimelineEntry = {
    timestamp: event.timestamp,
    tool: event.tool,
    overallMastery: overall,
    dimensions: { ...snap },
    conceptsUpdated: event.conceptsIdentified || (event.conceptName ? [event.conceptName] : []),
  };
  updated.timeline = [...(mastery.timeline || []).slice(-49), entry];

  // Actualizar memoria pedagógica
  if (event.timeMs) {
    const mem = updated.pedagogicMemory;
    updated.pedagogicMemory = {
      ...mem,
      avgResponseTime: mem.avgResponseTime
        ? Math.round((mem.avgResponseTime + event.timeMs) / 2)
        : event.timeMs,
      preferredDifficulty: calculatePreferredDifficulty(updated),
    };
  }

  return updated;
}

function calculatePreferredDifficulty(mastery: MaterialMastery): number {
  const real = mastery.concepts.filter(isRealConcept);
  if (real.length === 0) return 50;
  const avg = Math.round(
    real.reduce((sum, c) => sum + getConceptOverallScore(c), 0) / real.length
  );
  // Zona de desarrollo próximo: 15 puntos sobre el promedio real
  return Math.min(100, Math.max(10, avg + 15));
}

export function propagateDomainThroughGraph(
  concepts: ConceptDomain[],
  graph: KnowledgeGraph,
): ConceptDomain[] {
  if (!graph?.relations?.length || !concepts?.length) return concepts;

  const conceptMap = new Map<string, ConceptDomain>();
  concepts.forEach(c => conceptMap.set(c.name.toLowerCase(), c));

  const updated = concepts.map(c => ({ ...c }));

  for (const rel of graph.relations) {
    const fromConcept = conceptMap.get(rel.from.toLowerCase());
    if (!fromConcept) continue;

    const fromScore = getConceptOverallScore(fromConcept);
    const toIdx = updated.findIndex(c => c.name.toLowerCase() === rel.to.toLowerCase());
    if (toIdx === -1) continue;

    const propagationWeight = rel.strength * 0.15;

    switch (rel.type) {
      case 'prerequisite':
      case 'prerequisite_of':
        if (fromScore > 60) {
          updated[toIdx].understanding = Math.min(100,
            updated[toIdx].understanding + Math.round(fromScore * propagationWeight * 0.3)
          );
        }
        // Si falla prerequisito, bajar dependiente
        if (fromScore < 30) {
          updated[toIdx].understanding = Math.max(0,
            updated[toIdx].understanding - Math.round((30 - fromScore) * 0.1)
          );
        }
        break;
      case 'part_of':
      case 'requires':
      case 'depends_on':
        if (fromScore > 50) {
          updated[toIdx].understanding = Math.min(100,
            updated[toIdx].understanding + Math.round(fromScore * propagationWeight * 0.2)
          );
        }
        break;
      case 'causes':
        if (fromScore > 55) {
          updated[toIdx].understanding = Math.min(100,
            updated[toIdx].understanding + Math.round(fromScore * propagationWeight * 0.25)
          );
        }
        break;
      case 'example_of':
        if (fromScore > 60) {
          updated[toIdx].application = Math.min(100,
            updated[toIdx].application + Math.round(fromScore * propagationWeight * 0.2)
          );
        }
        break;
      case 'related':
      case 'compared_with':
        if (fromScore > 70) {
          updated[toIdx].understanding = Math.min(100,
            updated[toIdx].understanding + Math.round(fromScore * propagationWeight * 0.1)
          );
        }
        break;
      case 'opposite_of':
        if (fromScore > 75) {
          updated[toIdx].understanding = Math.min(100,
            updated[toIdx].understanding + Math.round(fromScore * propagationWeight * 0.08)
          );
        }
        break;
    }
  }

  return updated;
}

function updateToolData(current: ToolData, event: MasteryEvent): ToolData {
  const sessions = current.sessions + 1;

  const avgTimeMs = event.timeMs
    ? current.avgTimeMs
      ? Math.round((current.avgTimeMs * (sessions - 1) + event.timeMs) / sessions)
      : event.timeMs
    : current.avgTimeMs;

  const avgConfidence = event.confidence !== undefined
    ? current.avgConfidence
      ? Math.round((current.avgConfidence * (sessions - 1) + event.confidence) / sessions)
      : event.confidence
    : current.avgConfidence;

  const conceptsCovered = Array.from(new Set([
    ...current.conceptsCovered,
    ...(event.conceptsIdentified || []),
    ...(event.conceptName ? [event.conceptName] : []),
  ]));

  return {
    completedAt: event.timestamp,
    sessions,
    lastScore: event.score ?? current.lastScore,
    totalCorrect: current.totalCorrect + (event.correct === true ? 1 : 0),
    totalWrong: current.totalWrong + (event.correct === false ? 1 : 0),
    avgTimeMs,
    avgConfidence,
    conceptsCovered,
  };
}

function conceptMentionedInText(conceptName: string, texts: string[]): boolean {
  if (!conceptName || !texts.length) return false;
  const cn = conceptName.toLowerCase().trim();
  const cnWords = cn.split(/\s+/).filter(w => w.length > 3);

  for (const text of texts) {
    const t = text.toLowerCase();
    if (t.includes(cn)) return true;
    if (cnWords.length >= 2) {
      const matchCount = cnWords.filter(w => t.includes(w)).length;
      if (matchCount >= Math.ceil(cnWords.length * 0.6)) return true;
    }
    if (cnWords.length === 1 && t.includes(cnWords[0])) return true;
  }
  return false;
}

function updateConceptsFromEvent(concepts: ConceptDomain[], event: MasteryEvent): ConceptDomain[] {
  const now = event.timestamp;

  const eventTexts = [
    ...(event.conceptsIdentified || []),
    event.conceptName || '',
  ].filter(Boolean);

  const newConceptNames = event.conceptsIdentified || (event.conceptName ? [event.conceptName] : []);
  let updatedConcepts = [...concepts];

  for (const name of newConceptNames) {
    const isQuestion = name.includes('?') || name.length > 60;
    if (isQuestion) continue;
    if (!updatedConcepts.find(c => c.name.toLowerCase() === name.toLowerCase())) {
      updatedConcepts.push(createConcept(name, event.materialId, {
        topicId: event.topicId,
        topicTitle: event.topicTitle,
        sourcePages: event.sourcePages,
        importance: event.importance,
        difficulty: event.difficulty,
      }));
    }
  }

  updatedConcepts = updatedConcepts.map(concept => {
    const exactMatch = newConceptNames.some(n => n.toLowerCase() === concept.name.toLowerCase());
    const semanticMatch = conceptMentionedInText(concept.name, eventTexts);
    const noConceptsInEvent = newConceptNames.length === 0;

    const isCovered = exactMatch || semanticMatch || noConceptsInEvent;
    if (!isCovered) return concept;

    const impactFactor = exactMatch ? 1.0 : semanticMatch ? 0.6 : 0.3;
    const adjustedEvent = impactFactor < 1.0
      ? { ...event, score: Math.round((event.score || 0) * impactFactor) }
      : event;

    return applyToolImpact(concept, adjustedEvent, now);
  });

  return updatedConcepts.map(c => ({
    ...c,
    forgettingRisk: calculateForgettingRisk(c),
    recommendedAction: generateRecommendedAction(c),
    recommendedTool: generateRecommendedTool(c),
    cognitiveState: getCognitiveState(c),
  }));
}

function applyToolImpact(concept: ConceptDomain, event: MasteryEvent, now: number): ConceptDomain {
  const updated = { ...concept, lastReviewed: now, attempts: concept.attempts + 1 };
  const score = event.score ?? 50;
  const confidence = event.confidence ?? 50;
  const correct = event.correct;
  const timeMs = event.timeMs;

  // Factor de confianza con ilusión de conocimiento
  let confidenceFactor = 1.0;
  if (correct === true && confidence > 70) confidenceFactor = 1.2;
  if (correct === true && confidence < 30) confidenceFactor = 0.85;
  if (correct === false && confidence > 70) confidenceFactor = 0.6; // Ilusión de conocimiento
  if (correct === false && confidence < 30) confidenceFactor = 0.95;

  // Factor de velocidad
  let speedScore = 50;
  if (timeMs) {
    if (timeMs < 5000) speedScore = 95;
    else if (timeMs < 15000) speedScore = 80;
    else if (timeMs < 30000) speedScore = 60;
    else if (timeMs < 60000) speedScore = 40;
    else speedScore = 20;
  }

  const newScore = Math.round(Math.min(100, Math.max(0, score * confidenceFactor)));

  switch (event.tool) {
    case 'repasar':
    case 'analisis':
      updated.understanding = weightedUpdate(concept.understanding, newScore, 0.35);
      updated.explanation = weightedUpdate(concept.explanation, newScore * 0.7, 0.2);
      break;
    case 'studymap':
      updated.understanding = weightedUpdate(concept.understanding, newScore * 0.8, 0.25);
      break;
    case 'truquitos':
      updated.memory = weightedUpdate(concept.memory, newScore * 0.9, 0.3);
      updated.understanding = weightedUpdate(concept.understanding, newScore * 0.5, 0.1);
      break;
    case 'flashcards':
      updated.memory = weightedUpdate(concept.memory, newScore, 0.4);
      updated.speed = weightedUpdate(concept.speed, speedScore, 0.3);
      if (correct === false) updated.mistakes = concept.mistakes + 1;
      break;
    case 'quiz':
      updated.application = weightedUpdate(concept.application, newScore, 0.4);
      updated.memory = weightedUpdate(concept.memory, newScore * 0.5, 0.15);
      updated.confidence = weightedUpdate(concept.confidence, confidence, 0.3);
      if (correct === false) updated.mistakes = concept.mistakes + 1;
      break;
    case 'examen':
      updated.exam = weightedUpdate(concept.exam, newScore, 0.5);
      updated.application = weightedUpdate(concept.application, newScore * 0.8, 0.2);
      updated.confidence = weightedUpdate(concept.confidence, confidence, 0.4);
      if (correct === false) updated.mistakes = concept.mistakes + 1;
      break;
    case 'alai':
      updated.explanation = weightedUpdate(concept.explanation, event.explanationQuality ?? newScore, 0.35);
      updated.understanding = weightedUpdate(concept.understanding, newScore * 0.6, 0.15);
      break;
  }

  updated.confidence = weightedUpdate(concept.confidence, confidence, 0.25);

  const allScores = getConceptOverallScore(updated);
  const history = [...(concept.previousScores || []).slice(-4), allScores];
  updated.previousScores = history;
  updated.stability = calculateStability(history);

  return updated;
}

function weightedUpdate(current: number, newValue: number, weight: number): number {
  return Math.round(Math.min(100, Math.max(0, current * (1 - weight) + newValue * weight)));
}

export function getConceptOverallScore(concept: ConceptDomain): number {
  return Math.round(
    concept.understanding * 0.25 +
    concept.memory * 0.20 +
    concept.application * 0.20 +
    concept.explanation * 0.15 +
    concept.exam * 0.20
  );
}

function calculateStability(scores: number[]): number {
  if (scores.length < 2) return 50;
  const diffs = scores.slice(1).map((s, i) => Math.abs(s - scores[i]));
  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return Math.round(Math.max(0, 100 - avgDiff * 2));
}

// ═══════════════════════════════════════════════════════════════
// FORGETTING RISK
// ═══════════════════════════════════════════════════════════════

function calculateForgettingRisk(concept: ConceptDomain): ForgettingRisk {
  if (!concept.lastReviewed) return 'very_high';

  const hoursAgo = (Date.now() - concept.lastReviewed) / (1000 * 60 * 60);
  const overallScore = getConceptOverallScore(concept);

  let timeFactor: number;
  if (hoursAgo < 1) timeFactor = 0.1;
  else if (hoursAgo < 6) timeFactor = 0.3;
  else if (hoursAgo < 24) timeFactor = 0.5;
  else if (hoursAgo < 72) timeFactor = 0.7;
  else if (hoursAgo < 168) timeFactor = 0.85;
  else timeFactor = 1.0;

  const masteryFactor = 1 - (overallScore / 100) * 0.6;
  const errorFactor = concept.mistakes > 0
    ? Math.min(1, 1 + (concept.mistakes / Math.max(1, concept.attempts)) * 0.5)
    : 1;
  const stabilityFactor = 1 - (concept.stability / 100) * 0.3;
  const riskScore = timeFactor * masteryFactor * errorFactor * stabilityFactor;

  if (riskScore > 0.8) return 'very_high';
  if (riskScore > 0.6) return 'high';
  if (riskScore > 0.4) return 'medium';
  if (riskScore > 0.2) return 'low';
  return 'very_low';
}

function generateRecommendedAction(concept: ConceptDomain): string {
  const tool = generateRecommendedTool(concept);
  const score = getConceptOverallScore(concept);
  const toolNames: Record<ToolId, string> = {
    repasar: 'Repasar', analisis: 'Análisis', studymap: 'Study Map',
    truquitos: 'Truquitos', flashcards: 'Flashcards', quiz: 'Quiz',
    examen: 'Examen', alai: 'ALAI',
  };

  if (score === 0) return `Empieza con Repasar para familiarizarte con "${concept.name}".`;
  if (concept.forgettingRisk === 'very_high' && concept.lastReviewed)
    return `¡Urgente! "${concept.name}" está en riesgo de olvidarse. Repasa ahora.`;
  if (concept.application < 30 && concept.understanding > 50)
    return `Entiendes "${concept.name}" pero no lo has practicado. Prueba el Quiz.`;
  if (concept.memory < 40) return `Tu memoria de "${concept.name}" es baja. Trabaja con Flashcards.`;
  if (concept.explanation < 40) return `Aún no puedes explicar "${concept.name}". Practica con ALAI.`;
  if (score > 80) return `"${concept.name}" está dominado. Mantente fresco con repaso ligero.`;
  return `Trabaja "${concept.name}" con ${toolNames[tool || 'repasar']} para mejorar tu dominio.`;
}

function generateRecommendedTool(concept: ConceptDomain): ToolId {
  const score = getConceptOverallScore(concept);
  if (score < 20) return 'repasar';
  if (concept.understanding < 40) return 'repasar';
  if (concept.memory < 40) return 'flashcards';
  if (concept.application < 40) return 'quiz';
  if (concept.explanation < 50) return 'alai';
  if (concept.exam < 60) return 'examen';
  if (concept.forgettingRisk === 'high' || concept.forgettingRisk === 'very_high') return 'flashcards';
  return 'quiz';
}

// ═══════════════════════════════════════════════════════════════
// MASTERY CALCULATOR
// ═══════════════════════════════════════════════════════════════

export function calculateMasterySnapshot(mastery: MaterialMastery): MasterySnapshot {
  const concepts = mastery.concepts;

  // ── MODO LIBRE — si processMode es 'free' y hay freeModeProgress, usar eso ──
  if (mastery.processMode === 'free' && mastery.freeModeProgress) {
    return calculateFromFreeMode(mastery);
  }

  if (concepts.length === 0) {
    return calculateFromToolsOnly(mastery);
  }

  const dims = aggregateDimensions(concepts);
  const overallMastery = calculateOverallFromDims(dims, mastery);

  const realConcepts = concepts.filter(isRealConcept);
  const dominated = realConcepts.filter(c => getConceptOverallScore(c) >= 80);
  const intermediate = realConcepts.filter(c => {
    const s = getConceptOverallScore(c); return s >= 50 && s < 80;
  });
  const weak = realConcepts.filter(c => {
    const s = getConceptOverallScore(c); return s >= 20 && s < 50;
  });
  const critical = realConcepts.filter(c => getConceptOverallScore(c) < 20);

  const examReadiness = calculateExamReadiness(mastery, dims, overallMastery);
  const retention7Days = calculateRetention(overallMastery, 7);
  const retention30Days = calculateRetention(overallMastery, 30);

  // Predicción de examen mediante simulación
  const { passProb, excellentProb } = simulateExamProbability(mastery, overallMastery);
  const studyImpactForecast = predictStudyImpact(mastery, overallMastery, passProb);

  const nextAction = generateCoachRecommendation(mastery, dims, concepts);
  const studyPlan = mastery.examDate && mastery.examDate !== 'just_studying'
    ? generateStudyPlan(mastery, dims)
    : null;

  // ── Topic mastery desde blueprint ──────────────────────────
  let topicMasteryResult: TopicMasteryScore[] | undefined = undefined;
  let dominatedTopicsResult: TopicMasteryScore[] | undefined = undefined;
  let weakTopicsResult: TopicMasteryScore[] | undefined = undefined;
  let criticalTopicsResult: TopicMasteryScore[] | undefined = undefined;

  const blueprint = mastery.materialBlueprint;
  if (blueprint && blueprint.topics && blueprint.topics.length > 0 && mastery.concepts.length > 0) {
    try {
      const scoreMap = buildConceptScoreMap(mastery.concepts);
      topicMasteryResult = calculateTopicMastery(blueprint, scoreMap);
      dominatedTopicsResult = getDominatedTopics(topicMasteryResult);
      weakTopicsResult = getWeakTopics(topicMasteryResult);
      criticalTopicsResult = getCriticalTopics(topicMasteryResult);
    } catch (e) {
      console.warn('[Mastery] Error calculando topicMastery:', e);
    }
  }

  return {
    overallMastery, ...dims,
    topicMastery: topicMasteryResult,
    dominatedTopics: dominatedTopicsResult,
    weakTopics: weakTopicsResult,
    criticalTopics: criticalTopicsResult,
    dominatedConcepts: dominated,
    intermediateConcepts: intermediate,
    weakConcepts: weak,
    criticalConcepts: critical,
    examReadiness,
    retention7Days,
    retention30Days,
    examPassProbability: passProb,
    examExcellentProbability: excellentProb,
    studyImpactForecast,
    nextAction,
    studyPlan,
    timeline: mastery.timeline || [],
  };
}

function simulateExamProbability(mastery: MaterialMastery, overallMastery: number): {
  passProb: number; excellentProb: number;
} {
  const target = mastery.targetScore || 80;
  const real = mastery.concepts.filter(isRealConcept);

  // Factor 1: distancia al objetivo (base)
  const distance = overallMastery - target;

  // Factor 2: penalizar si hay muchos conceptos críticos sin dominar
  const criticalCount = real.filter(c => getConceptOverallScore(c) < 20).length;
  const criticalPenalty = Math.min(25, criticalCount * 5);

  // Factor 3: bonus si completó el examen simulado
  const examBonus = mastery.toolsData.examen.sessions > 0
    ? Math.min(15, mastery.toolsData.examen.sessions * 5)
    : 0;

  // Factor 4: estabilidad del conocimiento
  const avgStability = real.length > 0
    ? real.reduce((s, c) => s + c.stability, 0) / real.length
    : 50;
  const stabilityBonus = Math.round((avgStability - 50) * 0.2);

  // Factor 5: dimensión de examen directa
  const examDim = real.length > 0
    ? real.reduce((s, c) => s + c.exam, 0) / real.length
    : 0;
  const examDimBonus = Math.round(examDim * 0.15);

  const passProb = Math.round(Math.min(100, Math.max(0,
    50 + distance * 1.5 - criticalPenalty + examBonus + stabilityBonus + examDimBonus
  )));

  // Excelente = aprobar con margen + dominio application alto
  const avgApplication = real.length > 0
    ? real.reduce((s, c) => s + c.application, 0) / real.length
    : 0;
  const excellentProb = Math.round(Math.min(100, Math.max(0,
    passProb - 25 + (avgApplication > 60 ? 10 : 0) + (overallMastery > 85 ? 10 : 0)
  )));

  return { passProb, excellentProb };
}

function predictStudyImpact(
  mastery: MaterialMastery,
  overallMastery: number,
  currentPassProbability: number,
): StudyImpactForecastEntry[] {
  const real = mastery.concepts.filter(isRealConcept);
  const weak = real.filter(c => getConceptOverallScore(c) < 50);
  const critical = real.filter(c => getConceptOverallScore(c) < 20);
  const pool = weak.length > 0 ? weak : real;

  const avgLearningRate = pool.length > 0
    ? pool.reduce((s, c) => s + (c.learningRate || 50), 0) / pool.length
    : 50;

  const weakRatio = real.length > 0 ? weak.length / real.length : 0.5;
  const criticalRatio = real.length > 0 ? critical.length / real.length : 0.25;

  const points = [10, 20, 30, 60];

  return points.map((minutes) => {
    const learningFactor = 0.65 + (avgLearningRate / 100) * 0.75;
    const urgencyFactor =
      mastery.examDate === 'today' ? 1.15 :
      mastery.examDate === 'tomorrow' ? 1.10 :
      mastery.examDate === 'this_week' ? 1.05 : 1.0;

    const diminishingReturns = 1 - (overallMastery / 130);
    const focusBoost = 1 + weakRatio * 0.35 + criticalRatio * 0.25;

    const gain = Math.max(
      1,
      Math.round(
        Math.sqrt(minutes) * 1.15 * learningFactor * urgencyFactor * diminishingReturns * focusBoost
      )
    );

    const expectedMastery = Math.min(100, overallMastery + gain);

    const passGain = Math.round(gain * 1.35 + (minutes >= 30 ? 3 : 0) + (minutes >= 60 ? 4 : 0));
    const expectedPassProbability = Math.min(
      100,
      Math.max(currentPassProbability, currentPassProbability + passGain)
    );

    return {
      minutes,
      expectedMastery,
      expectedPassProbability,
    };
  });
}

function calculateOverallFromDims(
  dims: ReturnType<typeof aggregateDimensions>,
  mastery?: MaterialMastery,
): number {
  const dimWeights = [
    { value: dims.understanding, weight: 0.25, hasEvidence: dims.understanding > 0 },
    { value: dims.memory,        weight: 0.20, hasEvidence: dims.memory > 0 },
    { value: dims.application,   weight: 0.20, hasEvidence: dims.application > 0 },
    { value: dims.explanation,   weight: 0.15, hasEvidence: dims.explanation > 0 },
    { value: dims.exam,          weight: 0.20, hasEvidence: dims.exam > 0 },
  ];

  const dimsWithEvidence = dimWeights.filter(d => d.hasEvidence);

  if (dimsWithEvidence.length === 0) return 0;

  if (dimsWithEvidence.length === dimWeights.length) {
    const minDim = Math.min(...dimWeights.map(d => d.value));
    const avgDim = dimWeights.reduce((sum, d) => sum + d.value * d.weight, 0);
    const penaltyFactor = minDim < 30 ? 0.85 : minDim < 50 ? 0.93 : 1.0;
    return Math.round(avgDim * penaltyFactor);
  }

  const totalWeight = dimsWithEvidence.reduce((sum, d) => sum + d.weight, 0);
  const weightedSum = dimsWithEvidence.reduce((sum, d) => sum + d.value * d.weight, 0);
  const partialScore = weightedSum / totalWeight;
  const missingPenalty = 1 - (dimWeights.length - dimsWithEvidence.length) * 0.08;
  return Math.round(partialScore * missingPenalty);
}

function calculateFromFreeMode(mastery: MaterialMastery): MasterySnapshot {
  const progress = mastery.freeModeProgress!;
  const totalFreeDomain = Math.min(100,
    progress.repasar + progress.analisis + progress.studymap + progress.truquitos +
    progress.flashcards + progress.quiz + progress.examen + progress.alai
  );

  return {
    overallMastery: totalFreeDomain,
    understanding: 0,
    memory: 0,
    application: 0,
    explanation: 0,
    exam: 0,
    dominatedConcepts: [],
    intermediateConcepts: [],
    weakConcepts: [],
    criticalConcepts: [],
    examReadiness: totalFreeDomain,
    retention7Days: Math.round(totalFreeDomain * 0.85),
    retention30Days: Math.round(totalFreeDomain * 0.65),
    examPassProbability: totalFreeDomain,
    examExcellentProbability: Math.max(0, totalFreeDomain - 20),
    studyImpactForecast: [],
    nextAction: {
      tool: 'repasar',
      reason: 'Sigue usando las herramientas para subir tu dominio.',
      urgency: 'low',
      conceptFocus: null,
      estimatedMinutes: 15,
      message: 'Sigue usando las herramientas para subir tu dominio.',
    },
    studyPlan: null,
    timeline: mastery.timeline || [],
  };
}

function calculateFromToolsOnly(mastery: MaterialMastery): MasterySnapshot {
  const toolsCompleted = Object.values(mastery.toolsCompleted).filter(Boolean).length;
  const baseScore = Math.round((toolsCompleted / 8) * 60);
  const dims = {
    understanding: mastery.toolsCompleted.repasar || mastery.toolsCompleted.analisis ? baseScore : 0,
    memory: mastery.toolsCompleted.flashcards ? baseScore : 0,
    application: mastery.toolsCompleted.quiz ? baseScore : 0,
    explanation: mastery.toolsCompleted.alai ? baseScore : 0,
    exam: mastery.toolsCompleted.examen ? baseScore : 0,
  };
  return {
    overallMastery: baseScore, ...dims,
    dominatedConcepts: [], intermediateConcepts: [], weakConcepts: [], criticalConcepts: [],
    examReadiness: baseScore * 0.8,
    retention7Days: Math.round(baseScore * 0.7),
    retention30Days: Math.round(baseScore * 0.5),
    examPassProbability: Math.min(100, baseScore),
    examExcellentProbability: Math.max(0, baseScore - 30),
    studyImpactForecast: [],
    nextAction: generateCoachRecommendation(mastery, dims, []),
    studyPlan: null,
    timeline: mastery.timeline || [],
  };
}

function isRealConcept(concept: ConceptDomain): boolean {
  const name = concept.name || '';
  if (name.includes('?')) return false;
  if (name.length > 60) return false;
  const questionStarters = ['qué','que','cuál','cual','cómo','como','quién','quien',
    'dónde','donde','cuándo','cuando','por qué','what','how','who','where','when','why','which'];
  const lower = name.toLowerCase().trim();
  return !questionStarters.some(s => lower.startsWith(s));
}

function aggregateDimensions(concepts: ConceptDomain[]) {
  const realConcepts = concepts.filter(isRealConcept);
  const list = realConcepts.length > 0 ? realConcepts : concepts;
  if (list.length === 0) return { understanding: 0, memory: 0, application: 0, explanation: 0, exam: 0 };
  const total = list.length;
  return {
    understanding: Math.round(list.reduce((sum, c) => sum + c.understanding, 0) / total),
    memory: Math.round(list.reduce((sum, c) => sum + c.memory, 0) / total),
    application: Math.round(list.reduce((sum, c) => sum + c.application, 0) / total),
    explanation: Math.round(list.reduce((sum, c) => sum + c.explanation, 0) / total),
    exam: Math.round(list.reduce((sum, c) => sum + c.exam, 0) / total),
  };
}

function calculateExamReadiness(
  mastery: MaterialMastery,
  dims: ReturnType<typeof aggregateDimensions>,
  overallMastery: number,
): number {
  const target = mastery.targetScore;
  const readiness = Math.round(
    (overallMastery / target) * 100 * 0.7 + dims.application * 0.15 + dims.exam * 0.15
  );
  return Math.min(100, Math.max(0, readiness));
}

function calculateRetention(currentMastery: number, days: number): number {
  const stability = 1 + (currentMastery / 100) * 20;
  const retention = Math.round(Math.exp(-days / stability) * currentMastery);
  return Math.max(0, Math.min(100, retention));
}

// ═══════════════════════════════════════════════════════════════
// COACH RECOMMENDATION ENGINE
// ═══════════════════════════════════════════════════════════════

export function generateCoachRecommendation(
  mastery: MaterialMastery,
  dims: { understanding: number; memory: number; application: number; explanation: number; exam: number },
  concepts: ConceptDomain[],
): CoachRecommendation {
  const { examDate, toolsCompleted } = mastery;
  const today = new Date();

  let urgency: CoachRecommendation['urgency'] = 'medium';
  let daysToExam: number | null = null;

  if (examDate === 'today') { urgency = 'critical'; daysToExam = 0; }
  else if (examDate === 'tomorrow') { urgency = 'critical'; daysToExam = 1; }
  else if (examDate === 'this_week') { urgency = 'high'; daysToExam = 5; }
  else if (examDate === 'custom' && mastery.examDateCustom) {
    const examDay = new Date(mastery.examDateCustom);
    daysToExam = Math.ceil((examDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysToExam <= 1) urgency = 'critical';
    else if (daysToExam <= 3) urgency = 'high';
    else if (daysToExam <= 7) urgency = 'medium';
    else urgency = 'low';
  }

  const weakestConcept = concepts
    .filter(c => getConceptOverallScore(c) < 60)
    .sort((a, b) => getConceptOverallScore(a) - getConceptOverallScore(b))[0] || null;

  const highRiskConcept = concepts
    .filter(c => c.forgettingRisk === 'very_high' || c.forgettingRisk === 'high')
    .sort((a, b) => getConceptOverallScore(a) - getConceptOverallScore(b))[0] || null;

  if (urgency === 'critical' && daysToExam !== null && daysToExam <= 1) {
    if (!toolsCompleted.repasar)
      return makeRecommendation('repasar', urgency, null, 15,
        `⚡ Tu examen es ${daysToExam === 0 ? 'hoy' : 'mañana'}. Empieza con Repasar ahora.`);
    if (!toolsCompleted.flashcards && dims.memory < 60)
      return makeRecommendation('flashcards', urgency, weakestConcept?.name || null, 10,
        `⚡ Memoria baja (${dims.memory}%). Haz Flashcards rápido antes del examen.`);
    return makeRecommendation('examen', urgency, null, 20,
      `⚡ Es hora de simular el examen. Hazlo ahora para saber en qué estás.`);
  }

  if (!toolsCompleted.repasar)
    return makeRecommendation('repasar', 'high', null, 20,
      `Empieza aquí. Repasar es el punto de partida — necesitas ver el material primero.`);

  if (dims.understanding < 30)
    return makeRecommendation('analisis', 'high', null, 15,
      `Tu comprensión está en ${dims.understanding}%. El Análisis conecta los conceptos.`);

  if (dims.understanding >= 40 && dims.memory < 35)
    return makeRecommendation('flashcards', 'high', weakestConcept?.name || null, 15,
      `Entiendes el material pero no lo retienes. Las Flashcards anclarán esos conceptos.`);

  if (highRiskConcept) {
    const tool = generateRecommendedTool(highRiskConcept);
    return makeRecommendation(tool, 'high', highRiskConcept.name, 10,
      `"${highRiskConcept.name}" está en riesgo de olvidarse. Repásalo ahora.`);
  }

  if (dims.understanding >= 50 && dims.memory >= 40 && dims.application < 40)
    return makeRecommendation('quiz', 'medium', weakestConcept?.name || null, 20,
      `Buena base teórica (${dims.understanding}%) pero poca práctica. El Quiz te dirá dónde fallas.`);

  if (dims.understanding >= 60 && dims.explanation < 40)
    return makeRecommendation('alai', 'medium', weakestConcept?.name || null, 15,
      `Sabes el material pero no puedes explicarlo. ALAI es la prueba real del conocimiento.`);

  if (dims.understanding >= 65 && dims.memory >= 55 && dims.application >= 55 && !toolsCompleted.examen)
    return makeRecommendation('examen', 'medium', null, 30,
      `Tu preparación está sólida. Es momento de medirte con el Examen ALAI.`);

  if (weakestConcept && !toolsCompleted.truquitos)
    return makeRecommendation('truquitos', 'medium', weakestConcept.name, 10,
      `"${weakestConcept.name}" se te está resistiendo. Los Truquitos dan atajos mentales.`);

  const lowestDim = Object.entries(dims).sort(([, a], [, b]) => a - b)[0];
  const dimToTool: Record<string, ToolId> = {
    understanding: 'repasar', memory: 'flashcards', application: 'quiz',
    explanation: 'alai', exam: 'examen',
  };
  const recommendedTool = dimToTool[lowestDim[0]] || 'repasar';
  return makeRecommendation(recommendedTool, 'low', weakestConcept?.name || null, 15,
    `Tu punto más débil es ${getDimLabel(lowestDim[0])} (${lowestDim[1]}%). Trabaja eso ahora.`);
}

function makeRecommendation(
  tool: ToolId, urgency: CoachRecommendation['urgency'],
  conceptFocus: string | null, estimatedMinutes: number, message: string,
): CoachRecommendation {
  return { tool, urgency, conceptFocus, estimatedMinutes, message, reason: message };
}

function getDimLabel(dim: string): string {
  const labels: Record<string, string> = {
    understanding: 'comprensión', memory: 'memoria', application: 'aplicación',
    explanation: 'explicación', exam: 'dominio de examen',
  };
  return labels[dim] || dim;
}

// ═══════════════════════════════════════════════════════════════
// STUDY PLAN GENERATOR
// ═══════════════════════════════════════════════════════════════

function generateStudyPlan(
  mastery: MaterialMastery,
  dims: ReturnType<typeof aggregateDimensions>,
): StudyPlanDay[] {
  const { examDate, examDateCustom, studyMode } = mastery;
  let days = 3;

  if (examDate === 'today') days = 1;
  else if (examDate === 'tomorrow') days = 2;
  else if (examDate === 'this_week') days = 5;
  else if (examDate === 'custom' && examDateCustom) {
    const d = Math.ceil((new Date(examDateCustom).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    days = Math.max(1, Math.min(d, 14));
  }

  const plan: StudyPlanDay[] = [];
  const dailyMin = mastery.dailyMinutes ||
    (studyMode === 'emergency' ? 120 : studyMode === 'fast' ? 60 :
     studyMode === 'mastery' ? 180 : 90);

  if (days === 1) {
    plan.push({ day: 1, label: 'Hoy',
      tools: ['repasar', 'flashcards', 'quiz', 'examen'],
      focus: 'Cubre lo más importante y simula el examen',
      estimatedMinutes: dailyMin });
  } else if (days === 2) {
    plan.push({ day: 1, label: 'Hoy',
      tools: ['repasar', 'analisis', 'truquitos', 'flashcards'],
      focus: 'Comprensión y memoria', estimatedMinutes: Math.round(dailyMin * 0.55) });
    plan.push({ day: 2, label: 'Mañana',
      tools: ['quiz', 'examen'],
      focus: 'Práctica y simulación', estimatedMinutes: Math.round(dailyMin * 0.45) });
  } else if (days <= 5) {
    plan.push({ day: 1, label: 'Día 1', tools: ['repasar', 'analisis'], focus: 'Comprensión profunda', estimatedMinutes: Math.round(dailyMin * 0.35) });
    plan.push({ day: 2, label: 'Día 2', tools: ['studymap', 'truquitos', 'flashcards'], focus: 'Organización y memoria', estimatedMinutes: Math.round(dailyMin * 0.35) });
    plan.push({ day: 3, label: 'Día 3', tools: ['quiz', 'alai'], focus: 'Aplicación y explicación', estimatedMinutes: Math.round(dailyMin * 0.30) });
    if (days >= 4) plan.push({ day: 4, label: 'Día 4', tools: ['flashcards', 'quiz'], focus: 'Refuerzo de puntos débiles', estimatedMinutes: Math.round(dailyMin * 0.25) });
    if (days >= 5) plan.push({ day: 5, label: 'Día 5', tools: ['examen'], focus: 'Simulación final', estimatedMinutes: Math.round(dailyMin * 0.20) });
  } else {
    plan.push({ day: 1, label: 'Día 1', tools: ['repasar', 'analisis'], focus: 'Primera lectura completa', estimatedMinutes: dailyMin });
    plan.push({ day: 2, label: 'Día 2', tools: ['studymap', 'truquitos'], focus: 'Organización visual', estimatedMinutes: dailyMin });
    plan.push({ day: 3, label: 'Día 3', tools: ['flashcards'], focus: 'Construcción de memoria', estimatedMinutes: dailyMin });
    plan.push({ day: 4, label: 'Día 4', tools: ['quiz', 'alai'], focus: 'Práctica y explicación', estimatedMinutes: dailyMin });
    plan.push({ day: 5, label: 'Día 5', tools: ['flashcards', 'quiz'], focus: 'Refuerzo de lo débil', estimatedMinutes: dailyMin });
    const remaining = days - 5;
    if (remaining > 0) {
      for (let i = 0; i < Math.min(remaining - 1, 7); i++) {
        plan.push({ day: 6 + i, label: `Día ${6 + i}`, tools: ['quiz', 'flashcards'], focus: 'Repaso espaciado', estimatedMinutes: Math.round(dailyMin * 0.6) });
      }
      plan.push({ day: days, label: `Día ${days} (Examen)`, tools: ['examen'], focus: 'Simulación final', estimatedMinutes: dailyMin });
    }
  }

  return plan;
}

// ═══════════════════════════════════════════════════════════════
// FLASHCARD SORTING — Prioriza conceptos débiles
// ═══════════════════════════════════════════════════════════════

export function sortCardsByMastery<T extends { primaryConcept?: string; question?: string; front?: string }>(
  cards: T[],
  ctx: MasteryContext,
): T[] {
  const criticalSet = new Set(ctx.criticalConcepts.map(s => s.toLowerCase()));
  const weakSet = new Set(ctx.weakConcepts.map(s => s.toLowerCase()));
  const strongSet = new Set(ctx.strongConcepts.map(s => s.toLowerCase()));
  const forgettingSet = new Set(ctx.forgettingRiskConcepts.map(s => s.toLowerCase()));

  const score = (card: T): number => {
    const text = ((card.primaryConcept || card.question || card.front || '') as string).toLowerCase().slice(0, 60);
    if ([...criticalSet].some(c => text.includes(c) || c.includes(text.slice(0, 20)))) return 0;
    if ([...forgettingSet].some(c => text.includes(c) || c.includes(text.slice(0, 20)))) return 1;
    if ([...weakSet].some(c => text.includes(c) || c.includes(text.slice(0, 20)))) return 2;
    if ([...strongSet].some(c => text.includes(c) || c.includes(text.slice(0, 20)))) return 4;
    return 3;
  };

  return [...cards].sort((a, b) => score(a) - score(b));
}

// ═══════════════════════════════════════════════════════════════
// CONTINUOUS DIFFICULTY CALCULATOR
// ═══════════════════════════════════════════════════════════════

export function calculateAdaptiveDifficulty(ctx: MasteryContext): number {
  const base = ctx.overallMastery;
  const confidenceBonus = ctx.illusionConcepts.length > 0 ? -10 : 0;
  const examUrgency = ctx.daysToExam !== null && ctx.daysToExam <= 3 ? 5 : 0;

  // Dificultad óptima = dominio actual + 15 (zona de desarrollo próximo)
  const optimal = Math.min(100, Math.max(10, base + 15 + confidenceBonus + examUrgency));
  return Math.round(optimal);
}

// ═══════════════════════════════════════════════════════════════
// MASTERY CONTEXT BUILDER
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// WEEKLY MEMORY ENGINE
// ═══════════════════════════════════════════════════════════════

export function updateWeeklyMemory(mastery: MaterialMastery): MaterialMastery {
  const now = Date.now();
  const monday = getWeekStart(now);

  const real = mastery.concepts.filter(c => {
    const name = c.name || '';
    return !name.includes('?') && name.length <= 60;
  });

  // Conceptos que fallaron esta semana (mistakes recientes)
  const failedRepeatedly = real
    .filter(c => c.mistakes >= 2 && c.lastReviewed && c.lastReviewed >= monday)
    .map(c => c.name);

  // Conceptos que mejoraron esta semana (score subió)
  const improved = real
    .filter(c => {
      const scores = c.previousScores || [];
      if (scores.length < 2) return false;
      return scores[scores.length - 1] > scores[scores.length - 2] + 5;
    })
    .map(c => c.name);

  // Patrón dominante
  const avgUnderstanding = real.reduce((s, c) => s + c.understanding, 0) / Math.max(1, real.length);
  const avgMemory = real.reduce((s, c) => s + c.memory, 0) / Math.max(1, real.length);
  const avgApplication = real.reduce((s, c) => s + c.application, 0) / Math.max(1, real.length);
  const avgOverall = real.reduce((s, c) => s + getConceptOverallScore(c), 0) / Math.max(1, real.length);

  let dominantPattern: WeeklyMemory['dominantPattern'] = 'bueno';
  if (avgOverall > 70) {
    dominantPattern = 'bueno';
  } else if (avgUnderstanding < avgMemory - 20) {
    dominantPattern = 'comprension';
  } else if (avgMemory < avgUnderstanding - 20) {
    dominantPattern = 'memoria';
  } else if (avgApplication < Math.min(avgUnderstanding, avgMemory) - 15) {
    dominantPattern = 'aplicacion';
  } else if (failedRepeatedly.length >= 3) {
    dominantPattern = 'confusion';
  }

  const sessionCount = mastery.timeline.filter(
    e => e.timestamp >= monday
  ).length;

  const thisWeek: WeeklyMemory = {
    weekStart: monday,
    conceptsFailedRepeatedly: failedRepeatedly.slice(0, 5),
    conceptsImproved: improved.slice(0, 5),
    dominantPattern,
    avgMastery: Math.round(avgOverall),
    sessionCount,
  };

  const prevWeeks = (mastery.weeklyMemory || []).filter(w => w.weekStart !== monday);
  const updatedMemory = [...prevWeeks.slice(-7), thisWeek];

  return { ...mastery, weeklyMemory: updatedMemory };
}

function getWeekStart(ts: number): number {
  const d = new Date(ts);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // lunes
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}

export function generateStudyBlocks(mastery: MaterialMastery, snapshot: MasterySnapshot): StudyBlock[] {
  const { understanding, memory, application, explanation, exam } = snapshot;

  const toolsCompleted = {
    repasar: false,
    analisis: false,
    studymap: false,
    truquitos: false,
    flashcards: false,
    quiz: false,
    examen: false,
    alai: false,
    ...(mastery?.toolsCompleted || {}),
  } as Record<ToolId, boolean>;

  const blocks: StudyBlock[] = [
    {
      id: 'understand',
      label: 'Bloque 1 — Entender',
      phase: 'understand',
      tools: ['repasar', 'analisis'],
      description: 'Lee el material y conecta los conceptos principales.',
      emoji: '📖',
      estimatedMinutes: 35,
      completed: toolsCompleted.repasar && toolsCompleted.analisis,
      isNext: false,
    },
    {
      id: 'organize',
      label: 'Bloque 2 — Organizar',
      phase: 'organize',
      tools: ['studymap', 'truquitos'],
      description: 'Visualiza relaciones y crea atajos mentales.',
      emoji: '🗺️',
      estimatedMinutes: 25,
      completed: toolsCompleted.studymap && toolsCompleted.truquitos,
      isNext: false,
    },
    {
      id: 'memorize',
      label: 'Bloque 3 — Recordar',
      phase: 'memorize',
      tools: ['flashcards'],
      description: 'Ancla los conceptos en tu memoria a largo plazo.',
      emoji: '🎴',
      estimatedMinutes: 20,
      completed: toolsCompleted.flashcards,
      isNext: false,
    },
    {
      id: 'apply',
      label: 'Bloque 4 — Aplicar',
      phase: 'apply',
      tools: ['quiz'],
      description: 'Pon a prueba lo que sabes con casos reales.',
      emoji: '🎯',
      estimatedMinutes: 25,
      completed: toolsCompleted.quiz,
      isNext: false,
    },
    {
      id: 'demonstrate',
      label: 'Bloque 5 — Demostrar',
      phase: 'demonstrate',
      tools: ['examen'],
      description: 'Simula un examen real para medir tu dominio total.',
      emoji: '📝',
      estimatedMinutes: 30,
      completed: toolsCompleted.examen,
      isNext: false,
    },
    {
      id: 'repair',
      label: 'Bloque 6 — Reparar',
      phase: 'repair',
      tools: ['alai'],
      description: 'Trabaja tus puntos débiles con ALAI de forma personalizada.',
      emoji: '✨',
      estimatedMinutes: 20,
      completed: toolsCompleted.alai,
      isNext: false,
    },
  ];

  // Determinar cuál es el siguiente bloque
  const nextBlockIdx = blocks.findIndex(b => !b.completed);

  // Adaptar según dominio real
  if (understanding < 30 && !toolsCompleted.repasar) {
    blocks[0].isNext = true;
  } else if (understanding >= 30 && memory < 40 && !toolsCompleted.flashcards) {
    const memIdx = blocks.findIndex(b => b.id === 'memorize');
    if (memIdx !== -1) blocks[memIdx].isNext = true;
  } else if (memory >= 40 && application < 40 && !toolsCompleted.quiz) {
    const appIdx = blocks.findIndex(b => b.id === 'apply');
    if (appIdx !== -1) blocks[appIdx].isNext = true;
  } else if (nextBlockIdx !== -1) {
    blocks[nextBlockIdx].isNext = true;
  } else {
    // Todos completados — reparación si hay débiles
    if (snapshot.weakConcepts.length > 0 || snapshot.criticalConcepts.length > 0) {
      const repairIdx = blocks.findIndex(b => b.id === 'repair');
      if (repairIdx !== -1) blocks[repairIdx].isNext = true;
    }
  }

  return blocks;
}

export function buildSessionSummary(
  before: MaterialMastery,
  after: MaterialMastery,
  tool: ToolId,
): SessionSummary {
  const beforeDims = {
    understanding: 0, memory: 0, application: 0, explanation: 0, exam: 0,
  };
  const afterDims = { ...beforeDims };

  const real = (m: MaterialMastery) => m.concepts.filter(c => {
    const name = c.name || '';
    return !name.includes('?') && name.length <= 60;
  });

  const rb = real(before);
  const ra = real(after);

  const dims: MasteryDimension[] = ['understanding', 'memory', 'application', 'explanation', 'exam'];
  dims.forEach(d => {
    beforeDims[d] = rb.length > 0
      ? Math.round(rb.reduce((s, c) => s + c[d], 0) / rb.length)
      : 0;
    afterDims[d] = ra.length > 0
      ? Math.round(ra.reduce((s, c) => s + c[d], 0) / ra.length)
      : 0;
  });

  const dimensionGains: Partial<Record<MasteryDimension, number>> = {};
  dims.forEach(d => {
    const gain = afterDims[d] - beforeDims[d];
    if (gain !== 0) dimensionGains[d] = gain;
  });

  const conceptsImproved = ra
    .filter(ca => {
      const cb = rb.find(c => c.id === ca.id);
      if (!cb) return false;
      return getConceptOverallScore(ca) > getConceptOverallScore(cb) + 3;
    })
    .map(c => c.name)
    .slice(0, 4);

  const conceptsStillWeak = ra
    .filter(c => getConceptOverallScore(c) < 40)
    .sort((a, b) => getConceptOverallScore(a) - getConceptOverallScore(b))
    .map(c => c.name)
    .slice(0, 4);

  const overallBefore = rb.length > 0
    ? Math.round(rb.reduce((s, c) => s + getConceptOverallScore(c), 0) / rb.length)
    : 0;
  const overallAfter = ra.length > 0
    ? Math.round(ra.reduce((s, c) => s + getConceptOverallScore(c), 0) / ra.length)
    : 0;

  const nextTool = generateRecommendedTool(
    ra.sort((a, b) => getConceptOverallScore(a) - getConceptOverallScore(b))[0]
    || createConcept('x', 'x')
  );

  const nextConcept = ra
    .filter(c => getConceptOverallScore(c) < 50)
    .sort((a, b) => getConceptOverallScore(a) - getConceptOverallScore(b))[0]?.name || null;

  return {
    tool,
    timestamp: Date.now(),
    dimensionGains,
    conceptsImproved,
    conceptsStillWeak,
    nextRecommendedTool: nextTool,
    nextRecommendedConcept: nextConcept,
    overallGain: overallAfter - overallBefore,
  };
}

// ═══════════════════════════════════════════════════════════════
// BRAIN DECAY SIMULATION — Predicción de olvido futuro
// ═══════════════════════════════════════════════════════════════

export interface BrainDecayForecast {
  concept: string;
  currentScore: number;
  scoreIn5Days: number;
  scoreIn10Days: number;
  scoreIn20Days: number;
  lostPercent: number;
}

export function simulateBrainDecay(mastery: MaterialMastery, days: number = 20): BrainDecayForecast[] {
  const real = mastery.concepts.filter(c => {
    const name = c.name || '';
    return !name.includes('?') && name.length <= 60;
  });

  return real.map(concept => {
    const currentScore = getConceptOverallScore(concept);
    const stability = 1 + (currentScore / 100) * 20; // 1 a 21 días
    
    // R(t) = e^(-t/S)
    const calcRetention = (d: number) => Math.round(currentScore * Math.exp(-d / stability));

    const s5 = calcRetention(5);
    const s10 = calcRetention(10);
    const s20 = calcRetention(days);

    return {
      concept: concept.name,
      currentScore,
      scoreIn5Days: s5,
      scoreIn10Days: s10,
      scoreIn20Days: s20,
      lostPercent: currentScore - s20,
    };
  }).sort((a, b) => b.lostPercent - a.lostPercent); // Los que más se olvidan primero
}

export function buildWeeklyInsights(mastery: MaterialMastery): {
  message: string;
  tone: 'positive' | 'warning' | 'neutral' | 'challenge';
  details: string[];
} {
  const mem = mastery.weeklyMemory || [];
  const now = Date.now();
  const monday = getWeekStart(now);

  const thisWeek = mem.find(w => w.weekStart === monday);
  const lastWeek = mem.find(w => w.weekStart === getWeekStart(monday - 7 * 24 * 3600 * 1000));

  const daysSinceStudy = mastery.timeline.length > 0
    ? Math.floor((now - mastery.timeline[mastery.timeline.length - 1].timestamp) / (1000 * 60 * 60 * 24))
    : null;

  const details: string[] = [];
  let message = '';
  let tone: 'positive' | 'warning' | 'neutral' | 'challenge' = 'neutral';

  // Sin estudio reciente
  if (daysSinceStudy !== null && daysSinceStudy >= 3) {
    message = `No has estudiado desde hace ${daysSinceStudy} días. No quiero que tengas que empezar de cero.`;
    tone = 'warning';
    details.push('La curva de olvido ya está actuando sobre tus conceptos.');
    if (mastery.concepts.length > 0) {
      const mostForgotten = mastery.concepts
        .filter(c => c.forgettingRisk === 'very_high' || c.forgettingRisk === 'high')
        .slice(0, 3)
        .map(c => c.name);
      if (mostForgotten.length > 0) {
        details.push(`Empieza con: ${mostForgotten.join(', ')}`);
      }
    }
    return { message, tone, details };
  }

  // Hay memoria de errores repetidos
  if (thisWeek?.conceptsFailedRepeatedly?.length > 0) {
    const failed = thisWeek.conceptsFailedRepeatedly.slice(0, 2).join(' y ');
    message = `Esta semana te está costando ${failed}. No es mala suerte — es la señal de que necesita otro enfoque.`;
    tone = 'challenge';
    if (thisWeek.dominantPattern === 'comprension') {
      details.push('El patrón sugiere un problema de comprensión, no de memoria.');
      details.push('Prueba ALAI para que te explique desde otro ángulo.');
    } else if (thisWeek.dominantPattern === 'memoria') {
      details.push('Lo entiendes pero no lo retienes.');
      details.push('Flashcards espaciadas van a anclar eso.');
    } else if (thisWeek.dominantPattern === 'aplicacion') {
      details.push('Sabes la teoría pero no la puedes usar todavía.');
      details.push('Haz Quiz con casos prácticos.');
    }
  } else if (thisWeek?.conceptsImproved?.length > 0) {
    const improved = thisWeek.conceptsImproved.slice(0, 2).join(' y ');
    message = `Esta semana mejoraste ${improved}. Ese progreso es real.`;
    tone = 'positive';
    if (lastWeek && thisWeek.avgMastery > lastWeek.avgMastery) {
      const diff = thisWeek.avgMastery - lastWeek.avgMastery;
      details.push(`Subiste ${diff}% respecto a la semana pasada.`);
    }
  } else if (lastWeek) {
    // Comparar con semana anterior
    if (thisWeek && thisWeek.avgMastery >= lastWeek.avgMastery) {
      message = 'Estás manteniendo o mejorando tu dominio respecto a la semana pasada.';
      tone = 'positive';
    } else if (thisWeek) {
      message = 'Tu dominio bajó un poco respecto a la semana pasada. Es normal — pero hay que repasar.';
      tone = 'warning';
    } else {
      message = 'Primera sesión de esta semana. Buen momento para retomar.';
      tone = 'neutral';
    }
  } else {
    message = 'Sigue así. Cada sesión construye dominio real.';
    tone = 'neutral';
  }

  return { message, tone, details };
}

export function buildMasteryContext(mastery: MaterialMastery | null): MasteryContext | null {
  if (!mastery) return null;

  const concepts = mastery.concepts || [];

  const getScore = (c: any) =>
    c.understanding * 0.25 + c.memory * 0.20 +
    c.application * 0.20 + c.explanation * 0.15 + c.exam * 0.20;

  const isReal = (c: any) => {
    const name = c.name || '';
    if (name.includes('?') || name.length > 60) return false;
    const starters = ['qué','que','cuál','cual','cómo','como','quién','quien','what','how','who'];
    return !starters.some(s => name.toLowerCase().startsWith(s));
  };

  const realConcepts = concepts.filter(isReal);

  const weak = realConcepts.filter(c => getScore(c) < 40).map(c => c.name);
  const critical = realConcepts.filter(c => getScore(c) < 20).map(c => c.name);
  const strong = realConcepts.filter(c => getScore(c) > 75).map(c => c.name);
  const forgetting = realConcepts
    .filter(c => c.forgettingRisk === 'very_high' || c.forgettingRisk === 'high')
    .map(c => c.name);
  const repeated = realConcepts.filter(c => c.mistakes >= 2).map(c => c.name);
  const illusion = realConcepts.filter(c => c.confidence > 65 && c.mistakes >= 2).map(c => c.name);

  const avg = (key: keyof ConceptDomain) =>
    realConcepts.length
      ? Math.round(realConcepts.reduce((s, c) => s + (Number(c[key]) || 0), 0) / realConcepts.length)
      : 0;

  const understanding = avg('understanding');
  const memory = avg('memory');
  const application = avg('application');
  const explanation = avg('explanation');
  const exam = avg('exam');
  const overallMastery = Math.round(
    understanding * 0.25 + memory * 0.20 +
    application * 0.20 + explanation * 0.15 + exam * 0.20
  );

  let studentProfile: MasteryContext['studentProfile'] = 'beginner';
  let recommendedFocus: MasteryContext['recommendedFocus'] = 'understand';

  if (overallMastery < 20) { studentProfile = 'beginner'; recommendedFocus = 'understand'; }
  else if (understanding > 60 && memory < 40) { studentProfile = 'understander'; recommendedFocus = 'memorize'; }
  else if (memory > 60 && application < 40) { studentProfile = 'memorizer'; recommendedFocus = 'apply'; }
  else if (application > 60 && explanation < 40) { studentProfile = 'applier'; recommendedFocus = 'explain'; }
  else if (overallMastery > 70) { studentProfile = 'advanced'; recommendedFocus = 'review'; }

  let daysToExam: number | null = null;
  let examDateStr: string | null = null;

  if (mastery.examDate === 'today') { daysToExam = 0; examDateStr = 'hoy'; }
  else if (mastery.examDate === 'tomorrow') { daysToExam = 1; examDateStr = 'mañana'; }
  else if (mastery.examDate === 'this_week') { daysToExam = 5; examDateStr = 'esta semana'; }
  else if (mastery.examDate === 'custom' && mastery.examDateCustom) {
    const d = Math.ceil((new Date(mastery.examDateCustom).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    daysToExam = Math.max(0, d);
    examDateStr = `en ${daysToExam} días`;
  }

  const ctx: MasteryContext = {
    weakConcepts: weak.slice(0, 8),
    criticalConcepts: critical.slice(0, 5),
    strongConcepts: strong.slice(0, 8),
    forgettingRiskConcepts: forgetting.slice(0, 5),
    repeatedMistakes: repeated.slice(0, 5),
    illusionConcepts: illusion.slice(0, 3),
    understanding, memory, application, explanation, exam, overallMastery,
    studentProfile, recommendedFocus,
    recommendedDifficulty: 0,
    examDate: examDateStr,
    targetScore: mastery.targetScore || 80,
    daysToExam,
    contentHashes: mastery.contentHashes || [],
    examplesUsed: mastery.pedagogicMemory?.examplesUsed || [],
  };

  ctx.recommendedDifficulty = calculateAdaptiveDifficulty(ctx);
  return ctx;
}

// ═══════════════════════════════════════════════════════════════
// PROMPT BLOCK — Para enviar a la IA
// ═══════════════════════════════════════════════════════════════

export function masteryContextToPromptBlock(ctx: MasteryContext | null): string {
  if (!ctx) return '';

  const lines: string[] = [
    '═══════════════════════════════════════════',
    'PERFIL DEL ESTUDIANTE — ADAPTA TODO EL CONTENIDO A ESTO',
    '═══════════════════════════════════════════',
    '',
    `Dominio general: ${ctx.overallMastery}%`,
    `Perfil: ${ctx.studentProfile}`,
    `Enfoque recomendado: ${ctx.recommendedFocus}`,
    `Dificultad adaptativa: ${ctx.recommendedDifficulty}/100`,
    '',
    'DIMENSIONES:',
    `  Comprensión: ${ctx.understanding}%`,
    `  Memoria: ${ctx.memory}%`,
    `  Aplicación: ${ctx.application}%`,
    `  Explicación: ${ctx.explanation}%`,
    `  Examen: ${ctx.exam}%`,
    '',
  ];

  if (ctx.criticalConcepts.length) {
    lines.push(`CONCEPTOS CRÍTICOS (dominio < 20%) — PRIORIDAD MÁXIMA:`);
    ctx.criticalConcepts.forEach(c => lines.push(`  ⚠️ ${c}`));
    lines.push('');
  }

  if (ctx.weakConcepts.length) {
    lines.push(`CONCEPTOS DÉBILES (dominio < 40%) — ENFOCA AQUÍ:`);
    ctx.weakConcepts.forEach(c => lines.push(`  📍 ${c}`));
    lines.push('');
  }

  if (ctx.strongConcepts.length) {
    lines.push(`CONCEPTOS DOMINADOS — no repitas, usa solo como base:`);
    ctx.strongConcepts.forEach(c => lines.push(`  ✅ ${c}`));
    lines.push('');
  }

  if (ctx.forgettingRiskConcepts.length) {
    lines.push(`EN RIESGO DE OLVIDO — reforzar pronto:`);
    ctx.forgettingRiskConcepts.forEach(c => lines.push(`  ⏰ ${c}`));
    lines.push('');
  }

  if (ctx.repeatedMistakes.length) {
    lines.push(`ERRORES REPETIDOS — el estudiante falla estos consistentemente:`);
    ctx.repeatedMistakes.forEach(c => lines.push(`  ❌ ${c}`));
    lines.push('');
  }

  if (ctx.illusionConcepts.length) {
    lines.push(`ILUSIÓN DE CONOCIMIENTO — cree que sabe pero falla:`);
    ctx.illusionConcepts.forEach(c => lines.push(`  🚨 ${c}`));
    lines.push('');
  }

  if (ctx.examDate) {
    lines.push(`EXAMEN: ${ctx.examDate} | Objetivo: ${ctx.targetScore}%`);
    lines.push('');
  }

  if (ctx.examplesUsed.length > 0) {
    lines.push(`EJEMPLOS YA USADOS — NO repetir:`);
    ctx.examplesUsed.slice(-5).forEach(e => lines.push(`  - ${e}`));
    lines.push('');
  }

  lines.push('INSTRUCCIONES ADAPTATIVAS OBLIGATORIAS (MODO TUTOR AUTÓNOMO):');
  lines.push('1. PROHIBIDO generar contenido, preguntas o explicaciones sobre CONCEPTOS DOMINADOS (>75%). El estudiante ya los sabe.');
  lines.push('2. DEDICAR el 100% del esfuerzo a los CONCEPTOS CRÍTICOS y DÉBILES listados arriba.');
  lines.push('3. Si generas preguntas (Quiz/Flashcards), el 80% deben ser sobre los conceptos débiles/críticos.');
  lines.push('4. DIFICULTAD ADAPTATIVA: ' + ctx.recommendedDifficulty + '/100. Ajusta vocabulario y abstracción.');
  lines.push('5. Si detectas ILUSIÓN DE CONOCIMIENTO, genera preguntas trampa o contraejemplos para romper esa falsa seguridad.');
  lines.push('6. NO repitas ejemplos, analogías o preguntas que ya estén en el historial de "EJEMPLOS YA USADOS".');
  lines.push('7. Actúa como un tutor personalizado: ve directo al grano, no des introducciones genéricas.');

  const instructions: Record<string, string> = {
    understand: '6. Perfil BEGINNER: explica desde cero, usa analogías simples, no asumas conocimiento previo.',
    memorize: '6. Perfil UNDERSTANDER: enfoca en repetición, patrones, mnemotecnias, conexiones visuales.',
    apply: '6. Perfil MEMORIZER: usa ejemplos prácticos, casos reales, problemas concretos.',
    explain: '6. Perfil APPLIER: pide que enseñe, que use sus propias palabras, que conecte ideas.',
    review: '6. Perfil ADVANCED: revisa solo riesgo de olvido. Sube dificultad. Desafía con casos límite.',
  };

  lines.push(instructions[ctx.recommendedFocus] || '');
  lines.push('═══════════════════════════════════════════');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// CONTENT HASH — Anti-repetición
// ═══════════════════════════════════════════════════════════════

export function generateContentHash(content: string): string {
  // Hash simple pero efectivo para detectar repetición
  let hash = 0;
  const normalized = content.toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export function isContentRepeated(hash: string, existingHashes: string[]): boolean {
  return existingHashes.includes(hash);
}

export function addContentHash(mastery: MaterialMastery, hash: string): MaterialMastery {
  const hashes = [...(mastery.contentHashes || []).slice(-99), hash];
  return { ...mastery, contentHashes: hashes };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS ÚTILES
// ═══════════════════════════════════════════════════════════════

export function getConceptScore(concept: ConceptDomain): number {
  return getConceptOverallScore(concept);
}

export function getDimensionColor(value: number): string {
  if (value >= 80) return '#4ade80';
  if (value >= 60) return '#86efac';
  if (value >= 40) return '#fbbf24';
  if (value >= 20) return '#fb923c';
  return '#f87171';
}

export function getForgettingRiskColor(risk: ForgettingRisk): string {
  const colors: Record<ForgettingRisk, string> = {
    very_high: '#ef4444', high: '#f97316', medium: '#eab308',
    low: '#84cc16', very_low: '#22c55e',
  };
  return colors[risk];
}

export function getForgettingRiskLabel(risk: ForgettingRisk): string {
  const labels: Record<ForgettingRisk, string> = {
    very_high: 'Muy alto', high: 'Alto', medium: 'Medio',
    low: 'Bajo', very_low: 'Muy bajo',
  };
  return labels[risk];
}

export function getToolDisplayName(tool: ToolId): string {
  const names: Record<ToolId, string> = {
    repasar: 'Repasar', analisis: 'Análisis', studymap: 'Study Map',
    truquitos: 'Truquitos', flashcards: 'Flashcards', quiz: 'Quiz',
    examen: 'Examen ALAI', alai: 'ALAI',
  };
  return names[tool];
}

export function getCognitiveStateColor(state: CognitiveState): string {
  const colors: Record<CognitiveState, string> = {
    sin_exposicion: '#6b7280',
    reconoce: '#f87171',
    recuerda: '#fb923c',
    aplica: '#fbbf24',
    explica_basico: '#86efac',
    puede_ensenar: '#4ade80',
  };
  return colors[state];
}
