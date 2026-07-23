import type { AdaptiveSetup } from '../studySessions';
import type { LearningPath, LearningPathUnit } from './learningPathTypes';
import type { LearningArc, StudyChapter } from './learningArcTypes';
import { writeShortObjective } from './narrativeWriter';

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function challengeLevel(load: number): 1 | 2 | 3 | 4 | 5 {
  if (load >= 20) return 5;
  if (load >= 14) return 4;
  if (load >= 9) return 3;
  if (load >= 5) return 2;
  return 1;
}

function maxChapterLoad(setup: AdaptiveSetup): number {
  switch (setup.examDateType) {
    case 'today': return 28;
    case 'tomorrow': return 22;
    case 'this_week': return 18;
    default: return 14;
  }
}

// Presupuesto máximo de sesiones de aprendizaje (sin intro ni final)
// Para evitar explosión combinatoria con materiales pequeños
function maxLearningSessions(setup: AdaptiveSetup): number {
  switch (setup.examDateType) {
    case 'today':        return 4;
    case 'tomorrow':     return 5;
    case 'this_week':    return 7;
    case 'custom':       return 8;
    case 'just_studying': return 8;
    default:             return 8;
  }
}

function canCompressToday(setup: AdaptiveSetup) {
  return setup.examDateType === 'today' || setup.examDateType === 'tomorrow';
}

function areCompatibleArcs(a: LearningArc, b: LearningArc): boolean {
  // pares pedagógicos naturales
  if (a.role === 'foundation' && b.role === 'problem') return true;
  if (a.role === 'mechanism' && b.role === 'application') return true;
  if (a.role === 'integration' && b.role === 'context') return true;
  return false;
}

function fallbackDistinctTitle(role: string, previousTitle: string): string {
  if (role === 'application') return previousTitle === 'Aplicación y evidencia' ? 'La evidencia principal' : 'Aplicación y evidencia';
  if (role === 'mechanism') return previousTitle === 'Explicación central' ? 'La solución principal' : 'Explicación central';
  if (role === 'problem') return previousTitle === 'El problema central' ? 'La pregunta principal' : 'El problema central';
  if (role === 'integration') return previousTitle === 'Conectando las ideas' ? 'Integración del tema' : 'Conectando las ideas';
  if (role === 'context') return previousTitle === 'Impacto y legado' ? 'Consecuencias y legado' : 'Impacto y legado';
  if (role === 'foundation') return previousTitle === 'Construyendo las bases' ? 'Contexto inicial' : 'Construyendo las bases';
  return 'Siguiente etapa';
}

function chapterTitleFromArcs(arcs: LearningArc[]): string {
  // Siempre usar el título que viene del arc (generado desde topics reales)
  // Si hay 2 arcos, preferir el más cargado cognitivamente (ya el dominant)
  if (arcs.length === 1) return arcs[0].title;

  // Para pares pedagógicos, el título más informativo es el del arco con más peso
  // foundation+problem → el problem es más memorable
  if (arcs[0].role === 'foundation' && arcs[1].role === 'problem') return arcs[1].title;
  // mechanism+application → el mechanism es el tema principal
  if (arcs[0].role === 'mechanism' && arcs[1].role === 'application') return arcs[0].title;
  // integration+context → integration es más específico del contenido
  if (arcs[0].role === 'integration' && arcs[1].role === 'context') return arcs[0].title;

  return arcs[0].title;
}

function chapterObjectiveFromArcs(arcs: LearningArc[]): string {
  const dominant = arcs.reduce((a, b) => a.totalLoad >= b.totalLoad ? a : b);
  const role = dominant.role;

  // El arco ya tiene su purpose generado por NarrativeWriter
  // Para capítulos con 2 arcos, combinar los purposes
  if (arcs.length === 1) {
    return dominant.purpose;
  }

  const a = arcs[0];
  const b = arcs[1];

  // Pares pedagógicos: introducción fluida que conecta ambos
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
  return `Este capítulo une dos pasos que se entienden mejor juntos: ${a.title} y ${b.title}.`;
}

function chapterUnlockMessage(currentArcs: LearningArc[], nextArc: LearningArc | null): string {
  if (!nextArc) {
    return 'Después de esto tendrás todo lo necesario para la validación final.';
  }

  if (nextArc.role === 'problem') {
    return 'Cuando termines este capítulo, estarás listo para entender el problema central del material.';
  }
  if (nextArc.role === 'mechanism') {
    return 'Cuando termines este capítulo, podrás comprender la solución que propone Bohr.';
  }
  if (nextArc.role === 'application') {
    return 'Cuando termines este capítulo, podrás seguir cómo el modelo explica la evidencia.';
  }
  if (nextArc.role === 'integration') {
    return 'Cuando termines este capítulo, entenderás por qué nace la mecánica cuántica.';
  }
  if (nextArc.role === 'context') {
    return 'Cuando termines este capítulo, podrás evaluar el impacto y el legado de Bohr.';
  }

  return `Cuando termines este capítulo, podrás avanzar a ${nextArc.title}.`;
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

  const ownedConceptIds = unique(units.flatMap(u => u.conceptIds));
  const topicIds = unique(units.flatMap(u => u.topicIds));
  const blockIds = unique(units.flatMap(u => u.blockIds));
  const pages = unique(units.flatMap(u => u.pages)).sort((a, b) => a - b);
  const concepts = unique(units.flatMap(u => u.concepts));

  const totalLoad = units.reduce((s, u) => s + u.cognitiveLoad, 0);

  // arcRole: usar el arco con mayor carga total (el dominante del capítulo)
  // esto garantiza que la etiqueta sea consistente
  const dominantArc = arcs.reduce((a, b) => a.totalLoad >= b.totalLoad ? a : b);
  const arcRole = dominantArc.role;
  const arcLabel =
    arcs.length === 1
      ? arcs[0].title
      : `${arcs[0].title} + ${arcs[1].title}`;

  return {
    id: `chapter_${chapterNumber}`,
    arcId: arcs.map(a => a.id).join('__'),
    segmentIndex: 0,
    chapterNumber,
    type: 'learning',
    title,
    hook: why,
    objective,
    why,
    unlockMessage,
    exitCriteria: [
      `Explicar con tus palabras la idea central de ${title}`,
      `Relacionar ${title} con el capítulo anterior`,
      `Reconocer las ideas clave de este capítulo en preguntas rápidas`,
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
    cognitiveLoad: totalLoad >= 18 ? 'heavy' : totalLoad >= 9 ? 'medium' : 'light',
    status: 'locked',
    prerequisites: [chapterNumber - 1],
    unlocks: [chapterNumber + 1],
  };
}

export function buildChaptersFromArcs(
  path: LearningPath,
  arcs: LearningArc[],
  setup: AdaptiveSetup,
): StudyChapter[] {
  const chapters: StudyChapter[] = [];
  const unitMap = new Map(path.units.map(u => [u.id, u]));
  const compact = canCompressToday(setup);
  const loadCap = maxChapterLoad(setup);

  const budget = maxLearningSessions(setup);
  let i = 0;

  while (i < arcs.length) {
    const current = arcs[i];
    const next = arcs[i + 1] || null;
    const remainingArcs = arcs.length - i;
    const remainingBudget = budget - chapters.length;

    // Si nos quedan más arcos que presupuesto, forzar fusión
    const mustMerge = remainingArcs > remainingBudget && next !== null;

    let grouped = [current];

    if (
      next &&
      (mustMerge || (compact && areCompatibleArcs(current, next))) &&
      (current.totalLoad + next.totalLoad) <= loadCap
    ) {
      grouped = [current, next];
      i += 2;
    } else {
      i += 1;
    }

    const nextArc = arcs[i] || null;
    chapters.push(
      makeLearningChapter(chapters.length + 2, grouped, nextArc, unitMap)
    );
  }

  // corregir duplicados consecutivos visibles sin romper el plan
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

  // no visible "Contexto general"
  for (let j = 0; j < chapters.length; j++) {
    const ch = chapters[j];
    if (String(ch.title || '').trim().toLowerCase() === 'contexto general') {
      chapters[j] = {
        ...ch,
        title: ch.arcRole === 'foundation' ? 'Construyendo las bases' : 'Impacto y contexto',
      };
    }
  }

  return chapters;
}
