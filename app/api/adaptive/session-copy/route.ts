import { NextRequest, NextResponse } from 'next/server';
import { alaiRequest } from '../../../../lib/alai';
import type { AdaptiveSetup } from '../../../../lib/studySessions';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const recentCache = new Map<string, { result: any; timestamp: number }>();
const CACHE_TTL = 60000;

function hashPayload(sessions: any[], materialTitle: string, setup: any): string {
  const topicSignature = sessions
    .map((s: any) => `${s.sessionNumber}:${s.topicLabel}`)
    .join('|');
  return `${materialTitle}|${setup.examDateType}|${setup.knowledgeLevel}|${topicSignature}`;
}

// Traducir labels del blueprint que vienen en inglés
// al español para que la IA reciba el input ya en el idioma correcto
const EN_TO_ES: Record<string, string> = {
  'fan loyalty': 'lealtad de los aficionados',
  'team identity': 'identidad del equipo',
  'team spirit': 'espíritu de equipo',
  'offensive strategy': 'estrategia ofensiva',
  'cultural impact': 'impacto cultural',
  'resilience': 'resiliencia',
  'perseverance': 'perseverancia',
  'legacy': 'legado',
  'leadership': 'liderazgo',
  'foundation': 'fundación',
  'history': 'historia',
  'identity': 'identidad',
  'community': 'comunidad',
  'impact': 'impacto',
  'players': 'jugadores',
  'key players': 'jugadores clave',
  'performance': 'rendimiento',
  'success': 'éxito',
  'era': 'era',
  'culture': 'cultura',
  'origins': 'orígenes',
  'transformation': 'transformación',
};

function translateLabel(label: string): string {
  const lower = label.toLowerCase().trim();
  if (EN_TO_ES[lower]) return EN_TO_ES[lower];
  // Capitalizar primera letra
  const translated = lower.replace(/\b(\w)/g, (c: string) => c.toUpperCase());
  return translated;
}

function translateSessionsToLanguage(sessions: any[], lang: string): any[] {
  if (lang !== 'ESPAÑOL') return sessions;
  
  return sessions.map((s: any) => ({
    ...s,
    topicLabel: translateLabel(s.topicLabel),
    concepts: (s.concepts || []).map((c: string) => translateLabel(c)),
    previousSessionTopic: s.previousSessionTopic ? translateLabel(s.previousSessionTopic) : null,
    nextSessionTopic: s.nextSessionTopic ? translateLabel(s.nextSessionTopic) : null,
  }));
}

function detectLanguage(sessions: any[], materialTitle: string): string {
  const text = [
    materialTitle,
    ...sessions.map((s: any) => `${s.topicLabel} ${(s.concepts || []).join(' ')}`)
  ].join(' ').toLowerCase();

  const esCount = (text.match(/\b(el|la|los|las|de|del|en|un|una|que|es|con|para|por|como|más|también|este|esta|su|sus|se|al|lo|fue|era|muy|hay|pero|porque|cuando|donde|bien|todo|toda|sobre|entre|así|después|antes)\b/g) || []).length;
  const enCount = (text.match(/\b(the|of|and|in|is|it|for|as|on|with|this|that|are|was|were|be|been|have|has|had|but|not|from|they|their|into|more|than|about|which|would|could|should|after|before|during|between|through)\b/g) || []).length;

  const hasAccents = /[áéíóúüñÁÉÍÓÚÜÑ]/.test(materialTitle);

  if (hasAccents || esCount > enCount) return 'ESPAÑOL';
  if (enCount > esCount * 2) return 'English';
  return 'ESPAÑOL';
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

    const lang = detectLanguage(sessions, materialTitle);

    const prompt = `Eres un profesor experto. Escribe el título y la introducción de cada sesión de estudio.

MATERIAL: "${materialTitle}"
ESTUDIANTE: ${level}, examen ${urgency}

SESIONES:
${JSON.stringify(translateSessionsToLanguage(sessions, lang).map((s: any) => ({
  n: s.sessionNumber,
  topic: s.topicLabel,
  role: s.role,
  concepts: s.concepts?.slice(0, 4),
  prev: s.previousSessionTopic || null,
  next: s.nextSessionTopic || null,
})), null, 2)}

Para cada sesión genera:
- title: Título específico del tema (máx 6 palabras, NO genérico)
- intro: 1-2 oraciones como un profesor hablando directamente al estudiante

REGLAS:
- Los títulos deben mencionar el tema real de la sesión
- La intro debe conectar con la sesión anterior si existe
- Varía los verbos, no empieces todas las sesiones igual
- Mantén títulos cortos y específicos al contenido
- Responde SOLO con JSON array: [{"n":1,"title":"...","intro":"..."},...]`;

    const result = await alaiRequest(async (client, getModel) => {
      return await client.chat.completions.create({
        model: getModel(),
        messages: [
          { role: 'system', content: 'Responde SOLO con JSON válido, sin texto adicional. Usa el mismo idioma que el material.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 1500,
      });
    });

    const text = result?.choices?.[0]?.message?.content || '';
    const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!match) throw new Error('No JSON in response');

    const parsed = JSON.parse(match[0]);
    console.log(`[session-copy] ${parsed.length} títulos generados para "${materialTitle}" en ${lang}`);

    const responsePayload = { success: true, copies: parsed };
    recentCache.set(cacheKey, { result: responsePayload, timestamp: Date.now() });

    for (const [k, v] of recentCache.entries()) {
      if (Date.now() - v.timestamp > CACHE_TTL) recentCache.delete(k);
    }

    return NextResponse.json(responsePayload);

  } catch (e: any) {
    console.error('[session-copy] Error:', e?.message);
    return NextResponse.json({ success: false, copies: [] });
  }
}
