import type { AdaptiveSetup } from '../studySessions';
import type { StudyChapter } from './learningArcTypes';
import type { LearningJourney } from './learningArcTypes';
import { buildSetupVoice } from './setupVoice';
import { displayPhrase } from './narrativeFormatter';

function fixA(s: string): string {
  return s
    .replace(/\bde el\b/g, 'del')
    .replace(/\bDe el\b/g, 'Del')
    .trim();
}

function withArticle(s: string): string {
  if (!s) return s;
  const lower = s.toLowerCase();
  if (/^(el |la |los |las |del |de la )/.test(lower)) return s;
  if (/^(modelo|sistema|problema|proceso|principio|mecanismo|impacto|papel|rol|legado|contexto|nivel|campo)/.test(lower)) return `el ${s}`;
  if (/^(interpretación|solución|teoría|mecánica|ecuación|física|ciencia|energía|comprensión|colaboración|contribución|revolución)/.test(lower)) return `la ${s}`;
  return `el ${s}`;
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function visibleConcepts(concepts: string[]) {
  return uniq(
    (concepts || [])
      .map(displayPhrase)
      .filter(Boolean)
      .slice(0, 3)
  );
}

function sentenceFromRole(
  role: string,
  title: string,
  concepts: string[],
  setup: AdaptiveSetup
): string {
  const rawTitle = title.charAt(0).toLowerCase() + title.slice(1);
  const t = withArticle(rawTitle);
  const fromZero = setup.knowledgeLevel === 'never_seen';
  const reviewing = setup.knowledgeLevel === 'want_review' || setup.knowledgeLevel === 'already_know';

  if (role === 'foundation') {
    if (fromZero) return fixA(`Como empiezas desde cero, explorarás el origen y el contexto de ${t} para construir la base que necesitarás a lo largo del recorrido.`);
    if (reviewing) return fixA(`Reforzarás tu comprensión del contexto de ${t} y consolidarás la base necesaria para lo que viene.`);
    return fixA(`Explorarás el contexto de ${t} y construirás la base necesaria para entender lo que sigue.`);
  }

  if (role === 'problem') {
    if (fromZero) return fixA(`Como empiezas desde cero, antes de ver la solución, descubrirás cuál era el gran problema sin resolver en ${t} y por qué fue tan importante resolverlo.`);
    if (reviewing) return fixA(`Revisarás la pregunta central de ${t} y profundizarás en por qué su resolución fue decisiva.`);
    return fixA(`Descubrirás la limitación central de ${t} y por qué hizo necesario avanzar hacia una nueva explicación.`);
  }

  if (role === 'mechanism') {
    if (fromZero) return fixA(`Como empiezas desde cero, verás cómo ${t} resolvió el problema de la sesión anterior y por qué esa explicación cambió la forma de entender el tema.`);
    if (reviewing) return fixA(`Profundizarás en cómo funciona ${t} y consolidarás su conexión con los problemas que intentaba resolver.`);
    return fixA(`Verás cómo ${t} resolvió el problema anterior y por qué esa explicación da sentido a lo que viene.`);
  }

  if (role === 'application') {
    return fixA(`Pondrás a prueba lo aprendido sobre ${t} contra la evidencia más importante del material y comprobarás cómo la teoría funciona en la práctica.`);
  }

  if (role === 'integration') {
    return fixA(`Conectarás las ideas anteriores para entender cómo convergieron en ${t} y cómo ese cambio amplió la comprensión del tema de manera decisiva.`);
  }

  if (role === 'context') {
    return `Analizarás cómo el liderazgo y las ideas construidas durante el recorrido trascendieron el contenido central del tema, dejando un legado que sigue siendo relevante en la ciencia y en el mundo actual.`;
  }

  return 'Avanzarás en el recorrido de aprendizaje.';
}

function personalizeFinalChapter(ch: StudyChapter, setup: AdaptiveSetup): StudyChapter {
  const voice = buildSetupVoice(setup);
  const styles = setup.professorExamStyle || [];

  const hasExamSoon = setup.examDateType === 'today' || setup.examDateType === 'tomorrow';
  const highScore = (setup.targetScore || 0) >= 90;
  const readOnly = setup.evalPreference === 'read_only';

  let objective = 'Integrar todo lo aprendido para resolver preguntas con el nivel de exigencia esperado en tu evaluación.';
  if (highScore) {
    objective = 'Demostrar que puedes reconocer, relacionar y aplicar con seguridad las ideas esenciales del tema en un contexto similar al de un examen.';
  }
  if (readOnly) {
    objective = 'Cerrar el recorrido integrando las ideas esenciales del material en una comprensión completa y coherente.';
  }

  let why = 'Todo lo que estudiaste te trajo hasta aquí. Es el momento de demostrar que el recorrido valió la pena.';
  if (hasExamSoon) {
    why = 'Con el examen cerca, esta sesión replica las condiciones reales para que llegues con confianza.';
  }
  if (readOnly) {
    why = 'Esta sesión funciona como un cierre del recorrido: te ayuda a reunir las ideas principales y ver el material como un todo.';
  }

  let unlockMessage = 'Habrás completado el 100% del recorrido de aprendizaje.';

  if (styles.length > 0 && !readOnly) {
    why = `${why} La validación está orientada al estilo de tu profesor: ${styles.slice(0, 2).join(' y ')}.`;
  }

  const extraCriteria: string[] = [];
  if (styles.includes('true_false')) extraCriteria.push('Distinguir enunciados verdaderos y falsos con seguridad');
  if (styles.includes('matching')) extraCriteria.push('Relacionar conceptos, definiciones y consecuencias correctamente');
  if (styles.includes('multiple_choice')) extraCriteria.push('Reconocer la opción correcta entre alternativas cercanas');

  return {
    ...ch,
    objective,
    why,
    unlockMessage,
    exitCriteria: readOnly
      ? ['Integrar las ideas principales del material', 'Reconocer cómo se conectan los temas estudiados']
      : uniq([...(ch.exitCriteria || []), ...extraCriteria]).slice(0, 4),
  };
}

function fixIntroChapter(ch: StudyChapter): StudyChapter {
  return {
    ...ch,
    unlockMessage: 'Cuando estés listo, comenzaremos por la primera idea que necesitas dominar para que el resto del recorrido tenga sentido.',
  };
}

export function personalizeJourney(journey: LearningJourney, setup: AdaptiveSetup): LearningJourney {
  const voice = buildSetupVoice(setup);

  const chapters = (journey.chapters || []).map((ch: StudyChapter, idx: number) => {
    if (ch.type === 'intro') return fixIntroChapter(ch);
    if (ch.type === 'final_review') return personalizeFinalChapter(ch, setup);

    // learning chapter
    const objective = sentenceFromRole(ch.arcRole, ch.title, ch.concepts || [], setup);

    // asegurar coherencia título/objetivo: el título manda
    const why =
      ch.arcRole === 'problem'
        ? 'Esta sesión existe porque antes de entender la solución necesitas ver qué limitación hacía falta resolver.'
        : ch.arcRole === 'mechanism'
          ? 'Esta sesión existe porque aquí aparece la explicación central del material.'
          : ch.arcRole === 'application'
            ? 'Esta sesión existe porque una teoría solo se consolida cuando logra explicar la evidencia.'
            : ch.arcRole === 'integration'
              ? 'Esta sesión existe para conectar las ideas previas y mostrar cómo cambiaron la comprensión del tema.'
              : ch.arcRole === 'context'
                ? 'Esta sesión existe para ampliar el recorrido hacia su impacto, consecuencias y legado.'
                : ch.why;

    const unlockMessage =
      idx < (journey.chapters.length - 2)
        ? `Cuando termines esta sesión, estarás listo para avanzar a la siguiente etapa del recorrido.`
        : ch.unlockMessage;

    return {
      ...ch,
      objective,
      why,
      unlockMessage,
    };
  });

  return {
    ...journey,
    programNarrative: `${voice.startPrefix} ${journey.programNarrative} ${voice.evaluationNote} ${voice.masteryNote}`.replace(/\s+/g, ' ').trim(),
    planBadges: voice.badges,
    chapters,
  };
}
