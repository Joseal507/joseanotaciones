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
  const { role, topicLabel, previousSessionTopic } = input;
  const t = topicLabel || 'este tema';

  const titles: Record<string, string> = {
    orientation: 'Antes de comenzar',
    final_review: 'Conquista final',
    foundation: t,
    problem: t,
    mechanism: t,
    application: t,
    integration: t,
    context: t,
  };

  const intros: Record<string, string> = {
    foundation: `Explorarás el contexto y las bases de ${t}.`,
    problem: `Descubrirás la pregunta central de ${t} que hace necesario avanzar.`,
    mechanism: previousSessionTopic
      ? `Verás cómo ${t} resolvió el problema de la sesión anterior.`
      : `Comprenderás ${t} y por qué es central en este material.`,
    application: `Aplicarás lo aprendido sobre ${t} a la evidencia y los casos más importantes.`,
    integration: `Conectarás las ideas anteriores para entender cómo convergieron en ${t}.`,
    context: `Analizarás el alcance de ${t} más allá del contenido central.`,
    orientation: 'Construirás una visión general del recorrido antes de comenzar.',
    final_review: 'Demostrarás que dominas el material completo.',
  };

  return {
    title: titles[role] || t,
    intro: intros[role] || `Avanzarás en el recorrido con ${t}.`,
  };
}

export async function writeSessionCopyWithAI(
  sessions: SessionCopyInput[],
  materialTitle: string,
  setup: AdaptiveSetup,
  baseUrl?: string,
): Promise<SessionCopy[]> {
  if (sessions.length === 0) return [];

  try {
    const sessionCopyUrl = baseUrl
      ? `${baseUrl}/api/adaptive/session-copy`
      : '/api/adaptive/session-copy';
    const res = await fetch(sessionCopyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessions, materialTitle, setup }),
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
