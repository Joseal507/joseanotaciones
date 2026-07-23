import { NextRequest, NextResponse } from 'next/server';
import { alaiRequest } from '../../../../lib/alai';
import type { AdaptiveSetup } from '../../../../lib/studySessions';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Caché simple para deduplicar llamadas dobles (StrictMode en development)
const recentCache = new Map<string, { result: any; timestamp: number }>();
const CACHE_TTL = 8000; // 8 segundos

function hashPayload(sessions: any[], materialTitle: string, setup: any): string {
  const key = `${materialTitle}|${setup.examDateType}|${setup.knowledgeLevel}|${sessions.length}`;
  return key;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessions, materialTitle, setup } = body as {
      sessions: any[];
      materialTitle: string;
      setup: AdaptiveSetup;
    };

    if (!sessions?.length) {
      return NextResponse.json({ success: true, copies: [] });
    }

    const cacheKey = hashPayload(sessions, materialTitle, setup);
    const cached = recentCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[session-copy] Cache hit para "${materialTitle}"`);
      return NextResponse.json(cached.result);
    }

    const urgency = setup.examDateType === 'today' ? 'hoy mismo'
      : setup.examDateType === 'tomorrow' ? 'mañana'
      : setup.examDateType === 'this_week' ? 'esta semana'
      : 'sin urgencia';

    const level = setup.knowledgeLevel === 'never_seen' ? 'que nunca ha visto este tema'
      : setup.knowledgeLevel === 'know_little' ? 'con conocimientos básicos'
      : setup.knowledgeLevel === 'want_review' ? 'que quiere repasar'
      : 'que ya domina el tema';

    const prompt = `Eres un profesor experto. Escribe el título y la introducción de cada sesión de estudio.

MATERIAL: "${materialTitle}"
ESTUDIANTE: ${level}, examen ${urgency}

SESIONES:
${JSON.stringify(sessions.map((s: any) => ({
  n: s.sessionNumber,
  topic: s.topicLabel,
  role: s.role,
  concepts: s.concepts?.slice(0, 4),
  prev: s.previousSessionTopic || null,
  next: s.nextSessionTopic || null,
})), null, 2)}

Para cada sesión genera:
- title: Título específico del tema (máx 7 palabras, NO genérico)
- intro: 1-2 oraciones como un profesor hablando directamente al estudiante

REGLAS CRÍTICAS:
- Los títulos SIEMPRE deben ser relevantes al material "${materialTitle}"
- Usa principalmente palabras ya presentes en topic, concepts, prev o next
- NO inventes categorías o terminología que no aparezcan en el contenido
- Si el "topic" parece demasiado genérico o inadecuado, apóyate en los concepts, pero no inventes cosas ajenas al material
- Nunca menciones temas que no estén en el material real
- Escribe en español natural, varía los verbos
- Mantén títulos cortos, claros y específicos al contenido real
- Responde SOLO con JSON array: [{"n":1,"title":"...","intro":"..."},...]`;

    const result = await alaiRequest(async (client, getModel) => {
      return await client.chat.completions.create({
        model: getModel(), // <-- LLAMAMOS A LA FUNCIÓN PARA OBTENER EL STRING
        messages: [
          { role: 'system', content: 'Responde SOLO con JSON válido, sin texto adicional.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 1500,
      });
    });

    const text = result?.choices?.[0]?.message?.content || '';
    const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!match) throw new Error('No JSON in response');

    const parsed = JSON.parse(match[0]);
    console.log(`[session-copy] ${parsed.length} títulos generados para "${materialTitle}"`);
    const responsePayload = { success: true, copies: parsed };
    recentCache.set(cacheKey, { result: responsePayload, timestamp: Date.now() });
    // Limpiar entradas viejas
    for (const [k, v] of recentCache.entries()) {
      if (Date.now() - v.timestamp > CACHE_TTL) recentCache.delete(k);
    }
    return NextResponse.json(responsePayload);

  } catch (e: any) {
    console.error('[session-copy] Error:', e?.message);
    return NextResponse.json({ success: false, copies: [] });
  }
}
