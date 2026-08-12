// ═══════════════════════════════════════════════════════════════
// StudyAL — Session Copy Writer
// Llama a /api/adaptive/session-copy para generar títulos con IA.
// La IA escribe los títulos — el planner decide la estructura.
// ═══════════════════════════════════════════════════════════════

import type { AdaptiveSetup } from '../studySessions';

export interface SessionCopyInput {
  sessionNumber: number;
  role: string;
  topicLabel: string;
  concepts: string[];
  previousSessionTopic?: string;
  nextSessionTopic?: string;
  blockCount: number;
}

export interface SessionCopy {
  title: string;
  intro: string;
}

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9áéíóúüñ\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  return norm(s).split(' ').filter(Boolean);
}

function titleLooksGrounded(title: string, input: SessionCopyInput): boolean {
  const titleTokens = new Set(tokenize(title));
  const sourceText = [
    input.topicLabel || '',
    ...(input.concepts || []),
    input.previousSessionTopic || '',
    input.nextSessionTopic || '',
  ].join(' ');

  const sourceTokens = new Set(tokenize(sourceText));

  // overlap mínimo con el contenido real
  let overlap = 0;
  for (const t of titleTokens) {
    if (sourceTokens.has(t)) overlap++;
  }

  // si el título tiene 1 palabra, exigir que esa palabra venga del contenido
  if (titleTokens.size <= 2) return overlap >= 1;

  // si tiene más palabras, exigir al menos 2
  return overlap >= 2;
}

function sanitizeAICopy(copy: SessionCopy, input: SessionCopyInput): SessionCopy {
  const fallback = generateFallbackCopy(input);

  const badTitle =
    !copy?.title ||
    copy.title.trim().length < 3 ||
    !titleLooksGrounded(copy.title, input);

  const badIntro =
    !copy?.intro ||
    copy.intro.trim().length < 15;

  return {
    title: badTitle ? fallback.title : copy.title.trim(),
    intro: badIntro ? fallback.intro : copy.intro.trim(),
  };
}

export function generateFallbackCopy(input: SessionCopyInput): SessionCopy {
  const { role, topicLabel, previousSessionTopic, concepts } = input;
  const t = topicLabel || 'este tema';

  // Los títulos SIEMPRE vienen del topic real del material
  // Solo intro y final_review tienen labels especiales
  let title: string;
  if (role === 'orientation') {
    title = 'Antes de comenzar';
  } else if (role === 'final_review') {
    title = 'Repaso final';
  } else {
    title = t;
  }

  // Intro con al menos un concepto real si está disponible
  const firstConcept = concepts?.[0] ? ` empezando por ${concepts[0]}` : '';

  let intro: string;
  if (role === 'orientation') {
    intro = 'Construirás una visión general del material antes de comenzar el estudio detallado.';
  } else if (role === 'final_review') {
    intro = 'Repasarás los conceptos clave del material para consolidar todo lo aprendido.';
  } else if (previousSessionTopic) {
    intro = `Estudiarás ${t}${firstConcept}, avanzando desde ${previousSessionTopic}.`;
  } else {
    intro = `Estudiarás ${t}${firstConcept}.`;
  }

  return { title, intro };
}

export interface UserProfileForCopy {
  name?: string;
  career?: string;
  goal?: string;
}

export async function writeSessionCopyWithAI(
  sessions: SessionCopyInput[],
  materialTitle: string,
  setup: AdaptiveSetup,
  baseUrl?: string,
  userProfile?: UserProfileForCopy,
  signal?: AbortSignal,
): Promise<SessionCopy[]> {
  if (sessions.length === 0) return [];

  // AUDITORÍA (StudyAL_Visual_System_Stress_Test, Bug 2): si el proceso que
  // pidió este journey ya fue cancelado (usuario navegó fuera antes de llegar
  // aquí), no tiene sentido pagar la llamada LLM de session-copy — nadie va a
  // consumir el resultado. Se degrada al mismo fallback determinista que ya
  // existía para cualquier otro fallo (nunca rompe la generación del journey),
  // solo evita el gasto evitable.
  if (signal?.aborted) {
    return sessions.map(generateFallbackCopy);
  }

  try {
    const sessionCopyUrl = baseUrl
      ? `${baseUrl}/api/adaptive/session-copy`
      : '/api/adaptive/session-copy';
    const res = await fetch(sessionCopyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessions, materialTitle, setup, userProfile }),
      signal,
    });

    const data = await res.json();

    if (!data.success || !Array.isArray(data.copies) || !data.copies.length) {
      throw new Error('API returned no copies');
    }

    const byN = new Map(
      (data.copies as { n: number; title: string; intro: string }[])
        .map(p => [p.n, p])
    );

    return sessions.map(s => {
      const ai = byN.get(s.sessionNumber);
      if (!ai?.title || !ai?.intro) return generateFallbackCopy(s);
      return sanitizeAICopy({ title: ai.title, intro: ai.intro }, s);
    });

  } catch (err: any) {
    console.error('[SessionCopyWriter] fallback:', err?.message);
    return sessions.map(generateFallbackCopy);
  }
}
