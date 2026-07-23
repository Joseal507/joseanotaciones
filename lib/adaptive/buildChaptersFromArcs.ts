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

function maxChapterLoad(setup: AdaptiveSetup): number {
  switch (setup.examDateType) {
    case 'today': return 24;
    case 'tomorrow': return 22;
    case 'this_week': return 18;
    case 'just_studying': return 16;
    default: return 18;
  }
}

function targetLearningChapterCount(setup: AdaptiveSetup, arcCount: number): number {
  let base: number;

  switch (setup.examDateType) {
    case 'today':
      base = 3;
      break;
    case 'tomorrow':
      base = 4;
      break;
    case 'this_week':
      base = 5;
      break;
    case 'just_studying':
    default:
      base = 5;
      break;
  }

  // Ajuste por nivel previo
  // Los estudiantes que ya conocen el tema pueden comprimir más
  if (setup.knowledgeLevel === 'want_review') base -= 1;
  if (setup.knowledgeLevel === 'already_know') base -= 1;

  // Los que nunca lo han visto no deben comprimirse más de la cuenta
  if (setup.knowledgeLevel === 'never_seen' && setup.examDateType !== 'today') {
    base += 0; // explícito: mantener
  }

  // límites
  base = Math.max(2, base);
  base = Math.min(base, arcCount);

  return base;
}

function mergePriority(a: LearningArc, b: LearningArc): number {
  // cuanto más alto, más natural es fusionarlos
  if (a.role === 'foundation' && b.role === 'problem') return 100;
  if (a.role === 'mechanism' && b.role === 'application') return 95;
  if (a.role === 'integration' && b.role === 'context') return 90;

  if (a.role === b.role) return 70;

  // compatibilidades menores
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
    return 'Después de esto tendrás todo lo necesario para la validación final.';
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
    type: 'learning',
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
  if (role === 'application') return previousTitle === 'Aplicación y evidencia' ? 'La evidencia principal' : 'Aplicación y evidencia';
  if (role === 'mechanism') return previousTitle === 'Explicación central' ? 'La solución principal' : 'Explicación central';
  if (role === 'problem') return previousTitle === 'El problema central' ? 'La pregunta principal' : 'El problema central';
  if (role === 'integration') return previousTitle === 'Conectando las ideas' ? 'Integración del tema' : 'Conectando las ideas';
  if (role === 'context') return previousTitle === 'Impacto y legado' ? 'Consecuencias y legado' : 'Impacto y legado';
  if (role === 'foundation') return previousTitle === 'Construyendo las bases' ? 'Contexto inicial' : 'Construyendo las bases';
  return 'Siguiente etapa';
}

export function buildChaptersFromArcs(
  path: LearningPath,
  arcs: LearningArc[],
  setup: AdaptiveSetup,
): StudyChapter[] {
  const chapters: StudyChapter[] = [];
  const unitMap = new Map(path.units.map(u => [u.id, u]));

  const target = targetLearningChapterCount(setup, arcs.length);
  const loadCap = maxChapterLoad(setup);

  // Empezar con 1 arco = 1 grupo
  const groups: LearningArc[][] = arcs.map(a => [a]);

  // Mientras haya más grupos que presupuesto, fusionar los pares adyacentes más compatibles
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

      // penalizar ligeramente grupos que quedan demasiado pesados
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

  // Convertir grupos → capítulos
  for (let i = 0; i < groups.length; i++) {
    const currentArcs = groups[i];
    const nextGroup = i < groups.length - 1 ? groups[i + 1] : null;
    const nextArc = nextGroup ? nextGroup[0] : null;

    chapters.push(
      makeLearningChapter(i + 2, currentArcs, nextArc, unitMap)
    );
  }

  // corregir duplicados visibles sin romper el plan
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

  // nunca mostrar "Contexto general" literalmente
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
