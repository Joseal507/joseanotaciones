import type { AdaptiveSetup } from '../studySessions';
import type { LearningPath, LearningPathUnit } from './learningPathTypes';
import type { LearningArc, StudyChapter } from './learningArcTypes';

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function challengeLevel(load: number): 1 | 2 | 3 | 4 | 5 {
  if (load >= 24) return 5;
  if (load >= 18) return 4;
  if (load >= 12) return 3;
  if (load >= 7) return 2;
  return 1;
}

function chapterLoadLabel(load: number): 'light' | 'medium' | 'heavy' {
  if (load >= 18) return 'heavy';
  if (load >= 9) return 'medium';
  return 'light';
}

// ═══════════════════════════════════════════════════════════════
// Cálculo del número de sesiones basado en CONTENIDO REAL
// ═══════════════════════════════════════════════════════════════

/**
 * Base natural: cuántas sesiones "quieren" existir según el contenido.
 * Se calcula según la densidad total y la distribución de arcs.
 */
function calculateNaturalChapterCount(
  arcs: LearningArc[],
  totalBlocks: number,
): number {
  // Un arc puede ser 1 sesión, o 2 arcs pequeños pueden fusionarse en 1
  // Referencia: ~6-8 bloques por sesión es "cómodo"
  const idealSessions = Math.ceil(totalBlocks / 7);

  // No menos que la mitad de arcs (si hay 10 arcs, mínimo 5 sesiones)
  const minSessions = Math.max(2, Math.ceil(arcs.length / 2));

  // No más que el número de arcs (nunca dividir un arc en múltiples sesiones aquí)
  const maxSessions = arcs.length;

  return Math.max(minSessions, Math.min(idealSessions, maxSessions));
}

/**
 * Factor de compresión según urgencia del examen.
 * Retorna un multiplicador aplicado a la base natural.
 * NUNCA reduce contenido — solo agrupa más por sesión.
 */
function urgencyFactor(setup: AdaptiveSetup): number {
  switch (setup.examDateType) {
    case 'today': return 0.45;      // muy compacto
    case 'tomorrow': return 0.60;   // compacto
    case 'this_week': return 0.85;  // ligeramente compacto
    case 'custom': {
      // Días restantes hasta el examen
      const daysLeft = calculateDaysUntilExam(setup.examDateCustom);
      if (daysLeft <= 1) return 0.55;
      if (daysLeft <= 3) return 0.70;
      if (daysLeft <= 7) return 0.90;
      return 1.0;
    }
    case 'just_studying':
    default:
      return 1.10; // más digestible cuando no hay presión
  }
}

function calculateDaysUntilExam(examDate: string | null | undefined): number {
  if (!examDate) return 7;
  try {
    const target = new Date(examDate).getTime();
    const now = Date.now();
    return Math.max(0, Math.ceil((target - now) / (1000 * 60 * 60 * 24)));
  } catch {
    return 7;
  }
}

/**
 * Modificador según conocimiento previo.
 * never_seen: +1 sesión (más pasos pequeños)
 * know_little: mantener
 * want_review: -1 sesión (comprimir)
 * already_know: -2 sesiones (más comprimido)
 */
function knowledgeAdjustment(setup: AdaptiveSetup): number {
  switch (setup.knowledgeLevel) {
    case 'never_seen': return +1;
    case 'want_review': return -1;
    case 'already_know': return -2;
    default: return 0;
  }
}

/**
 * Decide cuántas sesiones de aprendizaje habrá (sin contar intro ni resumen).
 */
function targetLearningChapterCount(
  setup: AdaptiveSetup,
  arcs: LearningArc[],
  totalBlocks: number,
): number {
  const natural = calculateNaturalChapterCount(arcs, totalBlocks);
  const urgency = urgencyFactor(setup);
  const knowledge = knowledgeAdjustment(setup);

  const target = Math.round(natural * urgency) + knowledge;

  // Nunca menos de 2 sesiones de contenido, nunca más de los arcs disponibles
  return Math.max(2, Math.min(target, arcs.length));
}

/**
 * Cap de carga por sesión — cuando hay urgencia, se permite más carga por sesión.
 */
function maxChapterLoad(setup: AdaptiveSetup): number {
  switch (setup.examDateType) {
    case 'today': return 32;
    case 'tomorrow': return 26;
    case 'this_week': return 20;
    case 'just_studying': return 16;
    default: return 20;
  }
}

// ═══════════════════════════════════════════════════════════════
// Lógica de fusión de arcs
// ═══════════════════════════════════════════════════════════════

function mergePriority(a: LearningArc, b: LearningArc): number {
  if (a.role === 'foundation' && b.role === 'problem') return 100;
  if (a.role === 'mechanism' && b.role === 'application') return 95;
  if (a.role === 'integration' && b.role === 'context') return 90;
  if (a.role === b.role) return 70;
  if (a.role === 'foundation' && b.role === 'mechanism') return 30;
  if (a.role === 'problem' && b.role === 'mechanism') return 40;
  if (a.role === 'application' && b.role === 'integration') return 50;
  return 0;
}

function groupLoad(group: LearningArc[]): number {
  return group.reduce((s, a) => s + a.totalLoad, 0);
}

function chapterTitleFromArcs(arcs: LearningArc[]): string {
  if (arcs.length === 1) return arcs[0].title;
  const a = arcs[0];
  const b = arcs[1];
  if (a.role === 'foundation' && b.role === 'problem') return b.title;
  if (a.role === 'mechanism' && b.role === 'application') return a.title;
  if (a.role === 'integration' && b.role === 'context') return a.title;
  return a.title;
}

function chapterObjectiveFromArcs(arcs: LearningArc[]): string {
  if (arcs.length === 1) return arcs[0].purpose;
  const a = arcs[0];
  const b = arcs[1];
  if (a.role === 'foundation' && b.role === 'problem') {
    return `${a.purpose} A partir de eso, ${b.purpose.charAt(0).toLowerCase()}${b.purpose.slice(1)}`;
  }
  if (a.role === 'mechanism' && b.role === 'application') {
    return `${a.purpose} Además, ${b.purpose.charAt(0).toLowerCase()}${b.purpose.slice(1)}`;
  }
  if (a.role === 'integration' && b.role === 'context') {
    return `${a.purpose} Luego, ${b.purpose.charAt(0).toLowerCase()}${b.purpose.slice(1)}`;
  }
  return `${a.purpose} ${b.purpose}`;
}

function chapterWhyFromArcs(arcs: LearningArc[]): string {
  if (arcs.length === 1) return arcs[0].purpose;
  const a = arcs[0];
  const b = arcs[1];
  return `Esta sesión une dos pasos que se entienden mejor juntos: ${a.title} y ${b.title}.`;
}

function chapterUnlockMessage(currentArcs: LearningArc[], nextArc: LearningArc | null): string {
  if (!nextArc) {
    return 'Después de esto tendrás todo lo necesario para el repaso final.';
  }
  if (nextArc.role === 'problem') {
    return 'Cuando termines esta sesión, estarás listo para entender el problema central del material.';
  }
  if (nextArc.role === 'mechanism') {
    return 'Cuando termines esta sesión, podrás comprender la explicación principal del material.';
  }
  if (nextArc.role === 'application') {
    return 'Cuando termines esta sesión, verás cómo la teoría se pone a prueba frente a la evidencia.';
  }
  if (nextArc.role === 'integration') {
    return 'Cuando termines esta sesión, estarás listo para conectar las ideas más profundas del material.';
  }
  if (nextArc.role === 'context') {
    return 'Cuando termines esta sesión, podrás evaluar el impacto y el legado del tema.';
  }
  return `Cuando termines esta sesión, podrás avanzar a ${nextArc.title}.`;
}

function makeLearningChapter(
  chapterNumber: number,
  arcs: LearningArc[],
  nextArc: LearningArc | null,
  unitMap: Map<string, LearningPathUnit>,
): StudyChapter {
  const units = arcs.flatMap(a => a.unitIds.map(id => unitMap.get(id)!)).filter(Boolean);
  const title = chapterTitleFromArcs(arcs);
  const objective = chapterObjectiveFromArcs(arcs);
  const why = chapterWhyFromArcs(arcs);
  const unlockMessage = chapterUnlockMessage(arcs, nextArc);

  const ownedConceptIds = unique(units.flatMap(u => u.conceptIds || []));
  const topicIds = unique(units.flatMap(u => u.topicIds || []));
  const blockIds = unique(units.flatMap(u => u.blockIds || []));
  const pages = unique(units.flatMap(u => u.pages || [])).sort((a, b) => a - b);
  const concepts = unique(units.flatMap(u => u.concepts || []));

  const totalLoad = units.reduce((s, u) => s + (u.cognitiveLoad || 0), 0);
  const dominantArc = arcs.reduce((a, b) => a.totalLoad >= b.totalLoad ? a : b);
  const arcRole = dominantArc.role;
  const arcLabel = arcs.length === 1 ? arcs[0].title : `${arcs[0].title} + ${arcs[1].title}`;

  return {
    id: `chapter_${chapterNumber}`,
    arcId: arcs.map(a => a.id).join('__'),
    segmentIndex: 0,
    chapterNumber,
    kind: 'learning',
    title,
    hook: why,
    objective,
    why,
    unlockMessage,
    exitCriteria: [
      `Explicar con tus palabras la idea central de ${title}`,
      `Relacionar ${title} con la sesión anterior`,
      `Reconocer las ideas clave de esta sesión en preguntas rápidas`,
    ],
    ownedConceptIds,
    previewConceptIds: [],
    reviewConceptIds: [],
    unitIds: units.map(u => u.id),
    topicIds,
    blockIds,
    pages,
    concepts,
    arcRole,
    arcLabel,
    challengeLevel: challengeLevel(totalLoad),
    cognitiveLoad: chapterLoadLabel(totalLoad),
    status: 'locked',
    prerequisites: [chapterNumber - 1],
    unlocks: [chapterNumber + 1],
  };
}

function fallbackDistinctTitle(role: string, previousTitle: string): string {
  // Solo se usa cuando dos sesiones consecutivas tienen el mismo título del topic
  // Añadir un sufijo distintivo en vez de plantillas hardcoded
  return `${previousTitle} (continuación)`;
}

// ═══════════════════════════════════════════════════════════════
// Entry point
// ═══════════════════════════════════════════════════════════════

export function buildChaptersFromArcs(
  path: LearningPath,
  arcs: LearningArc[],
  setup: AdaptiveSetup,
): StudyChapter[] {
  const chapters: StudyChapter[] = [];
  const unitMap = new Map(path.units.map(u => [u.id, u]));

  // Contar bloques totales del path para calcular densidad
  const totalBlocks = path.units.reduce((sum, u) => sum + (u.blockIds?.length || 0), 0);

  const target = targetLearningChapterCount(setup, arcs, totalBlocks);
  const loadCap = maxChapterLoad(setup);

  console.log(`[buildChapters] target=${target} sesiones | arcs=${arcs.length} | totalBlocks=${totalBlocks} | urgency=${setup.examDateType} | knowledge=${setup.knowledgeLevel}`);

  // Empezar con 1 arco = 1 grupo
  const groups: LearningArc[][] = arcs.map(a => [a]);

  // Mientras haya más grupos que target, fusionar los pares adyacentes más compatibles
  while (groups.length > target) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    let bestLoad = Infinity;

    for (let i = 0; i < groups.length - 1; i++) {
      const left = groups[i];
      const right = groups[i + 1];
      const leftLast = left[left.length - 1];
      const rightFirst = right[0];

      const score = mergePriority(leftLast, rightFirst);
      const combinedLoad = groupLoad(left) + groupLoad(right);

      // Penalizar grupos que quedan demasiado pesados
      const adjustedScore = score - (combinedLoad > loadCap ? 20 : 0);

      if (
        adjustedScore > bestScore ||
        (adjustedScore === bestScore && combinedLoad < bestLoad)
      ) {
        bestScore = adjustedScore;
        bestLoad = combinedLoad;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;

    groups[bestIdx] = [...groups[bestIdx], ...groups[bestIdx + 1]];
    groups.splice(bestIdx + 1, 1);
  }

  // Convertir grupos → capítulos (empezando en chapter 2 porque el 1 es intro)
  for (let i = 0; i < groups.length; i++) {
    const currentArcs = groups[i];
    const nextGroup = i < groups.length - 1 ? groups[i + 1] : null;
    const nextArc = nextGroup ? nextGroup[0] : null;

    chapters.push(
      makeLearningChapter(i + 2, currentArcs, nextArc, unitMap)
    );
  }

  // Corregir duplicados visibles sin romper el plan
  for (let j = 1; j < chapters.length; j++) {
    const prev = chapters[j - 1];
    const curr = chapters[j];

    if (prev.title === curr.title) {
      chapters[j] = {
        ...curr,
        title: fallbackDistinctTitle(curr.arcRole, prev.title),
      };
    }

    if (prev.objective === curr.objective) {
      chapters[j] = {
        ...chapters[j],
        objective: `${curr.objective} En esta sesión avanzarás a una nueva etapa del recorrido.`,
      };
    }
  }

  return chapters;
}
