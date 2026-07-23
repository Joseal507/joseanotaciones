// ═══════════════════════════════════════════════════════════════
// StudyAL — Session Copy Writer
// La IA escribe títulos específicos del material.
// El planner ya decidió la estructura — la IA solo redacta.
// ═══════════════════════════════════════════════════════════════

import { alaiRequest } from '../alai';
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

function fallbackTitle(input: SessionCopyInput): string {
  return input.topicLabel || 'Sesión ' + input.sessionNumber;
}

function fallbackIntro(input: SessionCopyInput): string {
  const { role, topicLabel, previousSessionTopic } = input;
  const t = topicLabel || 'este tema';
  if (role === 'foundation') return `Explorarás el contexto y las bases de ${t} para que el resto del recorrido tenga sentido.`;
  if (role === 'problem') return `Descubrirás la pregunta central de ${t} que hace necesario avanzar hacia una solución.`;
  if (role === 'mechanism') return previousSessionTopic
    ? `Verás cómo ${t} resolvió el problema de la sesión anterior.`
    : `Comprenderás ${t} y por qué es central en este material.`;
  if (role === 'application') return `Aplicarás lo aprendido sobre ${t} a la evidencia y los casos más importantes.`;
  if (role === 'integration') return `Conectarás las ideas anteriores para entender cómo convergieron en ${t}.`;
  if (role === 'context') return `Analizarás el alcance de ${t} más allá del contenido central.`;
  return `Avanzarás en el recorrido con ${t}.`;
}

export function generateFallbackCopy(input: SessionCopyInput): SessionCopy {
  return {
    title: fallbackTitle(input),
    intro: fallbackIntro(input),
  };
}

export async function writeSessionCopyWithAI(
  sessions: SessionCopyInput[],
  materialTitle: string,
  setup: AdaptiveSetup,
): Promise<SessionCopy[]> {
  if (sessions.length === 0) return [];

  const urgency = setup.examDateType === 'today' ? 'hoy mismo'
    : setup.examDateType === 'tomorrow' ? 'mañana'
    : setup.examDateType === 'this_week' ? 'esta semana'
    : 'sin urgencia';

  const level = setup.knowledgeLevel === 'never_seen' ? 'que nunca ha visto este tema'
    : setup.knowledgeLevel === 'know_little' ? 'con conocimientos básicos'
    : setup.knowledgeLevel === 'want_review' ? 'que quiere repasar'
    : 'que ya domina el tema';

  const sessionsJson = sessions.map(s => ({
    n: s.sessionNumber,
    topic: s.topicLabel,
    role: s.role,
    concepts: s.concepts.slice(0, 4),
    prev: s.previousSessionTopic || null,
    next: s.nextSessionTopic || null,
  }));

  const prompt = `Eres un profesor experto. Escribe el título y la introducción de cada sesión de estudio.

MATERIAL: "${materialTitle}"
ESTUDIANTE: ${level}, examen ${urgency}

SESIONES (en este orden exacto):
${JSON.stringify(sessionsJson, null, 2)}

Para cada sesión genera:
- title: Título específico del tema (máx 7 palabras, NO genérico como "Fundamentos" o "Construcción")
- intro: Párrafo de 1-2 oraciones como un profesor, específico al contenido

REGLAS:
- Cada título debe mencionar el tema real de la sesión
- La intro debe conectar con la sesión anterior si existe
- Escribe en español natural
- NO uses "Comprenderás...", varía los verbos
- Responde SOLO con JSON array:
[{"n":1,"title":"...","intro":"..."},...]`;

  try {
    const result = await alaiRequest(async (client, model) => {
      return await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: 'Respondes SOLO con JSON válido, sin texto adicional.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 1500,
      });
    });

    const text = result?.choices?.[0]?.message?.content || '';
    const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!match) throw new Error('No JSON array in response');

    const parsed = JSON.parse(match[0]) as { n: number; title: string; intro: string }[];
    const byN = new Map(parsed.map(p => [p.n, p]));

    return sessions.map(s => {
      const ai = byN.get(s.sessionNumber);
      if (!ai?.title || !ai?.intro) return generateFallbackCopy(s);
      return { title: ai.title, intro: ai.intro };
    });

  } catch (err: any) {
    console.error('[SessionCopyWriter] fallback:', err?.message);
    return sessions.map(generateFallbackCopy);
  }
}
