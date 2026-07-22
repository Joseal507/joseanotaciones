import type { AdaptiveSetup } from '../studySessions';

export interface SetupVoice {
  badges: string[];
  startPrefix: string;
  pacingNote: string;
  evaluationNote: string;
  masteryNote: string;
}

function shortProfessorStyle(ids: string[]): string[] {
  const map: Record<string, string> = {
    multiple_choice: 'Opción múltiple',
    true_false: 'Verdadero/Falso',
    matching: 'Relacionar',
    development: 'Desarrollo',
    reading: 'Comprensión lectora',
    mixed: 'Mixto',
    no_idea: 'Estilo no definido',
  };
  return ids.map(x => map[x] || x);
}

export function buildSetupVoice(setup: AdaptiveSetup): SetupVoice {
  const badges: string[] = [];

  // examen
  if (setup.examDateType === 'today') badges.push('Optimizado para hoy');
  else if (setup.examDateType === 'tomorrow') badges.push('Optimizado para examen mañana');
  else if (setup.examDateType === 'this_week') badges.push('Optimizado para esta semana');
  else if (setup.examDateType === 'custom' && setup.examDateCustom) badges.push('Optimizado para tu fecha de examen');

  // meta
  if ((setup.targetScore || 0) >= 95) badges.push('Meta de dominio alto');
  else if ((setup.targetScore || 0) >= 85) badges.push(`Meta: ${setup.targetScore}%`);

  // preferencia de evaluación
  if (setup.evalPreference === 'quick_test') badges.push('Evaluaciones rápidas');
  else if (setup.evalPreference === 'write_explain') badges.push('Explicaciones escritas');
  else if (setup.evalPreference === 'mixed') badges.push('Evaluación mixta');

  // estilo del profesor
  const styles = shortProfessorStyle(setup.professorExamStyle || []);
  if (styles.length > 0) {
    badges.push(`Profesor: ${styles.slice(0, 2).join(' · ')}`);
  }

  const startPrefix =
    setup.knowledgeLevel === 'never_seen'
      ? 'Como empiezas desde cero,'
      : setup.knowledgeLevel === 'know_little'
        ? 'Como ya tienes una base inicial,'
        : setup.knowledgeLevel === 'want_review'
          ? 'Como tu meta es repasar y consolidar,'
          : 'Como ya conoces buena parte del tema,'

  const pacingNote =
    setup.examDateType === 'today' || setup.examDateType === 'tomorrow'
      ? 'este recorrido será más compacto de lo habitual.'
      : 'este recorrido podrá avanzar con un ritmo más gradual.';

  const evaluationNote =
    styles.length > 0
      ? `La validación final se parecerá al estilo de evaluación de tu profesor: ${styles.join(', ')}.`
      : 'La validación final se ajustará al tipo de comprensión que necesitas demostrar.';

  const masteryNote =
    (setup.targetScore || 0) >= 95
      ? 'La exigencia del recorrido apunta a dominio completo de las ideas centrales.'
      : 'El recorrido prioriza comprensión sólida y progresiva de las ideas principales.';

  return {
    badges,
    startPrefix,
    pacingNote,
    evaluationNote,
    masteryNote,
  };
}
