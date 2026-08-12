import { NextRequest, NextResponse } from 'next/server';
import { alaiRequest } from '../../../../lib/alai';
import type { AdaptiveSetup } from '../../../../lib/studySessions';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const recentCache = new Map<string, { result: any; timestamp: number }>();
const CACHE_TTL = 60000;

function hashPayload(sessions: any[], materialTitle: string, setup: any): string {
  const topicSignature = sessions
    .map((s: any) => `${s.sessionNumber}:${s.topicLabel}:${s.blockCount}`)
    .join('|');
  const totalBlocks = sessions.reduce((s: number, c: any) => s + (c.blockCount || 0), 0);
  return `${materialTitle}|${setup.examDateType}|${setup.knowledgeLevel}|${totalBlocks}|${topicSignature}`;
}

function detectLanguage(sessions: any[], materialTitle: string): 'es' | 'en' {
  const text = [
    materialTitle,
    ...sessions.map((s: any) => `${s.topicLabel} ${(s.concepts || []).join(' ')}`)
  ].join(' ');

  if (/[áéíóúüñÁÉÍÓÚÜÑ]/.test(text)) return 'es';

  const lower = text.toLowerCase();
  const esCount = (lower.match(/\b(el|la|los|las|de|del|en|un|una|que|es|con|para|por|como|más|también|este|esta|su|sus|se|al|lo|fue|era|muy|hay|pero|porque|cuando|donde|sobre|entre|así|después|antes)\b/g) || []).length;
  const enCount = (lower.match(/\b(the|of|and|in|is|it|for|as|on|with|this|that|are|was|were|be|been|have|has|had|but|not|from|they|their|into|more|than|about|which|would|could|should|after|before|during|between|through)\b/g) || []).length;

  return esCount >= enCount ? 'es' : 'en';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessions, materialTitle, setup, userProfile } = body as {
      sessions: any[];
      materialTitle: string;
      setup: AdaptiveSetup;
      userProfile?: {
        name?: string;
        career?: string;
        goal?: string;
      };
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

    const lang = detectLanguage(sessions, materialTitle);
    const isSpanish = lang === 'es';

    // Contexto del examen para personalizar el tono
    const urgencyContext = isSpanish
      ? (setup.examDateType === 'today' ? 'con examen hoy'
        : setup.examDateType === 'tomorrow' ? 'con examen mañana'
        : setup.examDateType === 'this_week' ? 'con examen esta semana'
        : setup.examDateType === 'custom' ? 'con fecha de examen específica'
        : 'sin urgencia de examen')
      : (setup.examDateType === 'today' ? 'with exam today'
        : setup.examDateType === 'tomorrow' ? 'with exam tomorrow'
        : setup.examDateType === 'this_week' ? 'with exam this week'
        : setup.examDateType === 'custom' ? 'with specific exam date'
        : 'no exam urgency');

    const levelContext = isSpanish
      ? (setup.knowledgeLevel === 'never_seen' ? 'que nunca vio este material'
        : setup.knowledgeLevel === 'know_little' ? 'con conocimientos básicos previos'
        : setup.knowledgeLevel === 'want_review' ? 'que quiere repasar'
        : 'que ya domina el tema y busca perfeccionar')
      : (setup.knowledgeLevel === 'never_seen' ? 'who has never seen this material'
        : setup.knowledgeLevel === 'know_little' ? 'with basic prior knowledge'
        : setup.knowledgeLevel === 'want_review' ? 'reviewing the topic'
        : 'mastering the topic');

    const mainConcernContext = setup.mainConcern
      ? (isSpanish
        ? `\nEl estudiante mencionó esta preocupación específica: "${setup.mainConcern}". Si alguna sesión trata este tema, refléjalo en su intro.`
        : `\nStudent mentioned this specific concern: "${setup.mainConcern}". If any session covers this, reflect it in its intro.`)
      : '';

    const userContext = userProfile?.name
      ? (isSpanish
        ? `\nEl estudiante se llama ${userProfile.name.split(' ')[0]}${userProfile.career ? `, estudia ${userProfile.career}` : ''}. Usa su nombre ocasionalmente en las intros para hacerlas personales.`
        : `\nStudent's name is ${userProfile.name.split(' ')[0]}${userProfile.career ? `, studying ${userProfile.career}` : ''}. Occasionally use their name in intros to make them personal.`)
      : '';

    const prompt = isSpanish
      ? `Eres el diseñador del plan de estudio para este material específico. Escribes títulos e introducciones únicas basadas en el contenido real, no genéricas.

MATERIAL: "${materialTitle}"
ESTUDIANTE: ${levelContext}, ${urgencyContext}${mainConcernContext}${userContext}

SESIONES DEL PLAN:
${JSON.stringify(sessions.map((s: any) => ({
  n: s.sessionNumber,
  topic: s.topicLabel,
  role: s.role,
  concepts: s.concepts?.slice(0, 6),
  prev: s.previousSessionTopic || null,
  next: s.nextSessionTopic || null,
  blocks: s.blockCount,
})), null, 2)}

Para cada sesión genera:
- title: Un título único que refleje el contenido REAL de esa sesión de este material específico. NUNCA uses títulos genéricos como "Construyendo las bases", "Impacto y contexto", "Explicación central". El título debe salir del topic y los concepts que estudia esa sesión.
- intro: 1-2 oraciones que le hablen al estudiante directamente (usa "vas a", "aprenderás") describiendo qué va a lograr en esta sesión específica, basado en su topic y concepts. Personaliza según su nivel y urgencia si es relevante.

REGLAS CRÍTICAS:
- Los títulos deben ser DIFERENTES entre sesiones y ÚNICOS para este material
- NO uses plantillas genéricas ni frases hechas
- Si el topic es "Definición de Equilibrio Químico", el título puede ser "Qué es el equilibrio químico" o "El concepto de equilibrio" — algo específico al contenido
- La intro debe mencionar lo que específicamente aprenderá, no frases vacías como "avanzarás en el recorrido"
- Escribe en el mismo idioma que el material

Responde SOLO con JSON array válido:
[{"n":1,"title":"título único","intro":"introducción específica"}]`
      : `You are the study plan designer for this specific material. You write unique titles and introductions based on real content, not generic ones.

MATERIAL: "${materialTitle}"
STUDENT: ${levelContext}, ${urgencyContext}${mainConcernContext}${userContext}

PLAN SESSIONS:
${JSON.stringify(sessions.map((s: any) => ({
  n: s.sessionNumber,
  topic: s.topicLabel,
  role: s.role,
  concepts: s.concepts?.slice(0, 6),
  prev: s.previousSessionTopic || null,
  next: s.nextSessionTopic || null,
  blocks: s.blockCount,
})), null, 2)}

For each session generate:
- title: A unique title reflecting the REAL content of that session for this specific material. NEVER use generic titles like "Building foundations", "Impact and context", "Core explanation". The title must come from the topic and concepts studied in that session.
- intro: 1-2 sentences speaking directly to the student (use "you will") describing what they'll achieve in this specific session, based on its topic and concepts. Personalize by level and urgency if relevant.

CRITICAL RULES:
- Titles must be DIFFERENT between sessions and UNIQUE to this material
- NO generic templates or filler phrases
- If topic is "Chemical Equilibrium Definition", title can be "What is chemical equilibrium" or "The equilibrium concept" — specific to content
- Intro must mention what will specifically be learned, no empty phrases like "you'll advance in the journey"
- Write in the same language as the material

Respond ONLY with valid JSON array:
[{"n":1,"title":"unique title","intro":"specific introduction"}]`;

    // AUDITORÍA (StudyAL_Visual_System_Stress_Test, Bug 2): última oportunidad
    // barata antes del único gasto LLM real de esta ruta — si el proceso que
    // originó esta cadena (generate-plan -> journeyBuilder -> aquí) ya fue
    // cancelado, evita despachar la llamada. No cancela una llamada YA
    // enviada; solo evita enviarla si todavía no salió.
    if (req.signal?.aborted) {
      return NextResponse.json({ success: false, error: 'cancelled', cancelled: true }, { status: 499 });
    }

    const result = await alaiRequest(async (client, getModel) => {
      return await client.chat.completions.create({
        model: getModel(),
        messages: [
          {
            role: 'system',
            content: isSpanish
              ? 'Responde SOLO con JSON válido. Los títulos deben ser únicos por sesión y específicos al material real, nunca genéricos.'
              : 'Respond ONLY with valid JSON. Titles must be unique per session and specific to the actual material, never generic.'
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 2000,
      });
    });

    const text = result?.choices?.[0]?.message?.content || '';
    const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!match) throw new Error('No JSON in response');

    const parsed = JSON.parse(match[0]);
    console.log(`[session-copy] ${parsed.length} títulos únicos generados para "${materialTitle}"`);

    // Validar que cada copy tenga title e intro no vacíos
    const validCopies = parsed.filter((c: any) =>
      c.n && c.title && String(c.title).trim().length >= 3 &&
      c.intro && String(c.intro).trim().length >= 10
    );

    const responsePayload = { success: true, copies: validCopies };
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
