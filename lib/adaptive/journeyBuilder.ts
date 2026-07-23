import type { AdaptiveSetup } from '../studySessions';
import { buildLearningPath } from './buildLearningPath';
import { writeSessionCopyWithAI, generateFallbackCopy, type SessionCopyInput } from './sessionCopyWriter';
import { buildLearningArcs } from './buildLearningArcs';
import { buildChaptersFromArcs } from './buildChaptersFromArcs';
import { personalizeJourney } from './personalizeJourney';
import type { LearningRole } from './learningPathTypes';
import type { LearningArc, StudyChapter } from './learningArcTypes';

export interface LearningJourney {
  id: string;
  version: number;
  createdAt: number;

  programGoal: string;
  programNarrative: string;
  programObjectives: string[];

  coverageTarget: 100;

  planBadges?: string[];

  arcs: LearningArc[];
  chapters: StudyChapter[];
  totalChapters: number;

  setupSnapshot: AdaptiveSetup;
  blueprintVersion: number;
}

function cleanTitle(materialTitle: string) {
  return String(materialTitle || 'Material')
    .replace(/\.(pdf|docx?|pptx?|txt|png|jpg|jpeg|webp)$/i, '')
    .split(' ')
    .map(w => w.length ? w[0].toUpperCase() + w.slice(1) : w)
    .join(' ');
}

function buildProgramNarrative(setup: AdaptiveSetup, totalChapters: number) {
  const fromZero =
    setup.knowledgeLevel === 'never_seen' ? 'empezar desde cero' :
    setup.knowledgeLevel === 'know_little' ? 'reforzar lo que ya sabes' :
    setup.knowledgeLevel === 'want_review' ? 'repasar y consolidar' :
    'perfeccionar lo que ya dominas';

  const time =
    setup.examDateType === 'today' ? 'para un examen que tienes hoy' :
    setup.examDateType === 'tomorrow' ? 'para un examen que tienes mañana' :
    setup.examDateType === 'this_week' ? 'para un examen esta semana' :
    setup.examDateType === 'custom' && setup.examDateCustom
      ? `para tu examen del ${new Date(setup.examDateCustom).toLocaleDateString('es', { day: 'numeric', month: 'long' })}`
      : 'sin presión de tiempo';

  const density =
    setup.examDateType === 'today' || setup.examDateType === 'tomorrow'
      ? 'Las sesiones son compactas pero cubren el 100% del material.'
      : 'Cada capítulo fue ordenado para que cada idea se apoye en la anterior.';

  // Setup de evaluación reflejado
  const evalStyles = setup.professorExamStyle || [];
  const evalParts: string[] = [];
  if (evalStyles.includes('multiple_choice')) evalParts.push('opción múltiple');
  if (evalStyles.includes('true_false')) evalParts.push('verdadero/falso');
  if (evalStyles.includes('matching')) evalParts.push('relacionar');
  if (evalStyles.includes('development')) evalParts.push('desarrollo');
  if (evalStyles.includes('mixed')) evalParts.push('formato mixto');

  const evalLine = evalParts.length > 0
    ? ` Las evaluaciones se enfocan en ${evalParts.join(', ')}.`
    : '';

  return `Diseñé este recorrido para ${fromZero} ${time}. ${density}${evalLine}`;
}

function objectivesFromArcs(arcs: LearningArc[]): string[] {
  const roleObjective: Record<LearningRole, string> = {
    foundation: 'Conocer el contexto necesario para entender el material',
    problem: 'Comprender el problema que daba sentido a la búsqueda de una solución',
    mechanism: 'Dominar el modelo o mecanismo central del material',
    application: 'Aplicar el modelo a la evidencia y a los casos clave',
    integration: 'Relacionar el modelo con una comprensión más profunda de la realidad',
    context: 'Evaluar el impacto, liderazgo y legado de lo aprendido',
  };

  return arcs.map(a => roleObjective[a.role] || a.title);
}

function buildIntroChapter(rawBlueprint: any): StudyChapter {
  const topics = rawBlueprint?.topics?.length ? rawBlueprint.topics : (rawBlueprint?.topicsIndex || []);
  const topicNames = topics.map((t: any) => t.title).slice(0, 6);

  return {
    id: 'chapter_intro',
    arcId: 'intro',
    segmentIndex: 0,
    chapterNumber: 1,
    type: 'intro',
    title: 'Antes de comenzar',
    hook: 'Hoy no vas a memorizar nada.',
    objective: 'Construirás una visión general del recorrido para entender dónde encaja cada idea antes de estudiarla.',
    why: 'Un buen profesor siempre empieza mostrando el camino completo antes de recorrerlo.',
    unlockMessage: 'Cuando estés listo, comenzaremos por entender la primera idea que necesitas para seguir el resto del recorrido.',
    exitCriteria: [
      'Reconocer las etapas principales del recorrido de aprendizaje',
      'Identificar el vocabulario esencial del material',
      'Detectar los puntos de mayor dificultad',
      'Entender cómo se conectan las ideas del material',
    ],
    ownedConceptIds: [],
    previewConceptIds: [],
    reviewConceptIds: [],
    unitIds: [],
    topicIds: topics.map((t: any) => t.id),
    blockIds: [],
    pages: [],
    concepts: [],
    arcRole: 'orientation',
    arcLabel: 'Inicio',
    challengeLevel: 1,
    cognitiveLoad: 'light',
    status: 'available',
    prerequisites: [],
    unlocks: [2],
  };
}

function buildFinalChapter(
  chapterNumber: number,
  learningChapters: StudyChapter[],
  setup: AdaptiveSetup,
): StudyChapter {
  const ownedConceptIds = [...new Set(learningChapters.flatMap(c => c.ownedConceptIds))];
  const reviewConceptIds = [...ownedConceptIds];

  const exitCriteria: string[] = [];

  if ((setup.professorExamStyle || []).includes('multiple_choice')) {
    exitCriteria.push('Resolver preguntas de opción múltiple sobre todo el recorrido');
  }
  if ((setup.professorExamStyle || []).includes('true_false')) {
    exitCriteria.push('Distinguir enunciados verdaderos y falsos con precisión');
  }
  if ((setup.professorExamStyle || []).includes('matching')) {
    exitCriteria.push('Relacionar conceptos y definiciones correctamente');
  }
  if (exitCriteria.length === 0) {
    exitCriteria.push('Demostrar comprensión completa del material');
  }

  return {
    id: `chapter_final_${chapterNumber}`,
    arcId: 'final',
    segmentIndex: 0,
    chapterNumber,
    type: 'final_review',
    title: 'Conquista final',
    hook: 'Todo lo que estudiaste te trajo hasta aquí.',
    objective: 'Demuestra que dominas todo el material. Sin atajos.',
    why: 'Todo el recorrido te trajo hasta aquí. Ahora toca demostrarlo.',
    unlockMessage: 'Habrás completado el 100% del recorrido de aprendizaje.',
    exitCriteria: exitCriteria.slice(0, 3),
    ownedConceptIds: [],
    previewConceptIds: [],
    reviewConceptIds,
    unitIds: [],
    topicIds: [...new Set(learningChapters.flatMap(c => c.topicIds))],
    blockIds: [...new Set(learningChapters.flatMap(c => c.blockIds))],
    pages: [...new Set(learningChapters.flatMap(c => c.pages))].sort((a, b) => a - b),
    concepts: [...new Set(learningChapters.flatMap(c => c.concepts))].slice(0, 10),
    arcRole: 'final_review',
    arcLabel: 'Final',
    challengeLevel: 5,
    cognitiveLoad: 'heavy',
    status: 'locked',
    prerequisites: [chapterNumber - 1],
    unlocks: [],
  };
}

export async function buildLearningJourney(
  rawBlueprint: any,
  setup: AdaptiveSetup,
  materialTitle: string,
): Promise<LearningJourney> {
  const clean = cleanTitle(materialTitle);

  const path = buildLearningPath(rawBlueprint);

  const arcs = buildLearningArcs(path);
  const learningChapters = buildChaptersFromArcs(path, arcs, setup);

  const intro = buildIntroChapter(rawBlueprint);
  const final = buildFinalChapter(learningChapters.length + 2, learningChapters, setup);

  // reenumerar y conectar
  const chapters: StudyChapter[] = [intro, ...learningChapters, final].map((ch, idx, arr) => ({
    ...ch,
    chapterNumber: idx + 1,
    prerequisites: idx === 0 ? [] : [idx],
    unlocks: idx < arr.length - 1 ? [idx + 2] : [],
    status: idx === 0 ? 'available' : 'locked',
  }));

  const baseJourney: LearningJourney = {
    id: `journey_${Date.now().toString(36)}`,
    version: 3,
    createdAt: Date.now(),
    programGoal: `Dominar ${clean}`,
    programNarrative: buildProgramNarrative(setup, chapters.length),
    programObjectives: objectivesFromArcs(arcs),
    coverageTarget: 100,
    arcs,
    chapters,
    totalChapters: chapters.length,
    setupSnapshot: setup,
    blueprintVersion: rawBlueprint?.version || 1,
  };

  // IA escribe títulos e introducciones específicos del material
  // La IA solo renombra sesiones reales de aprendizaje.
  // Intro y final_review están protegidas.
  const learningChs = chapters.filter(
    ch => ch.type !== 'intro' && ch.type !== 'final_review'
  ); // la intro ya tiene nombre fijo

  if (learningChs.length > 0) {
    const copyInputs: SessionCopyInput[] = learningChs.map((ch, idx) => ({
      sessionNumber: ch.chapterNumber,
      role: String(ch.arcRole || 'mechanism'),
      topicLabel: ch.title,
      concepts: (ch.concepts || []).slice(0, 5),
      previousSessionTopic: idx > 0 ? learningChs[idx - 1].title : undefined,
      nextSessionTopic: idx < learningChs.length - 1 ? learningChs[idx + 1].title : undefined,
      blockCount: (ch.blockIds || []).length,
    }));

    try {
      const aiCopies = await writeSessionCopyWithAI(copyInputs, clean, setup);
      for (let i = 0; i < learningChs.length; i++) {
        const ch = learningChs[i];
        const copy = aiCopies[i];
        if (!copy) continue;
        const idx = chapters.findIndex(c => c.chapterNumber === ch.chapterNumber);
        if (idx !== -1) {
          chapters[idx] = {
            ...chapters[idx],
            title: copy.title || ch.title,
            hook: copy.intro || ch.hook,
            objective: copy.intro || ch.objective,
          };
        }
      }
      console.log(`[SessionCopyWriter] ${aiCopies.length} títulos escritos con IA`);
    } catch (err: any) {
      console.error('[SessionCopyWriter] Fallback:', err?.message);
    }
  }

  const finalJourney: LearningJourney = {
    ...baseJourney,
    chapters,
  };

  return personalizeJourney(finalJourney, setup);
}
