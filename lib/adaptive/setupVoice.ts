import type { AdaptiveSetup } from '../studySessions';

export interface SetupVoice {
  badges: string[];
  startPrefix: string;
  pacingNote: string;
  evaluationNote: string;
  masteryNote: string;
}


export function buildSetupVoice(setup: AdaptiveSetup): SetupVoice {
  const badges: string[] = [];

  // examen
  if (setup.examDateType === 'today') badges.push('Optimizado para hoy');
  else if (setup.examDateType === 'tomorrow') badges.push('Optimizado para examen mañana');
  else if (setup.examDateType === 'this_week') badges.push('Optimizado para esta semana');
  else if (setup.examDateType === 'custom' && setup.examDateCustom) badges.push('Optimizado para tu fecha de examen');

  // Nota: targetScore ya no afecta las sesiones. El sistema siempre busca el máximo dominio.

  // Nota: evalPreference no afecta el plan de sesiones — solo afecta el interior de cada sesión.

  // Nota: professorExamStyle ya no se usa en el sistema de sesiones.

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

  const evaluationNote = '';
  const masteryNote = '';

  return {
    badges,
    startPrefix,
    pacingNote,
    evaluationNote,
    masteryNote,
  };
}
