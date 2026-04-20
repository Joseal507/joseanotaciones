import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';
import { getCachedContent, saveToCache } from '../../../lib/cache';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function calcularFlashcardsNecesarias(content: string, lang: string): Promise<number> {
  try {
    const wordCount = content.split(/\s+/).length;
    const estimadoBase = Math.ceil(wordCount / 60);

    const r = await groqRequest((client, model) => client.chat.completions.create({
      model: model('llama-3.3-70b-versatile'),
      messages: [
        {
          role: 'system',
          content: lang === 'en'
            ? `Analyze educational content. Count ALL distinct concepts. Respond ONLY with JSON: {"count": number, "reason": "brief explanation"}`
            : `Analiza contenido educativo. Cuenta TODOS los conceptos distintos. Responde SOLO con JSON: {"count": number, "reason": "breve explicación"}`,
        },
        {
          role: 'user',
          content: `Texto (${wordCount} palabras):\n\n${content.substring(0, 3000)}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 200,
    }));

    const t = r.choices[0]?.message?.content || '';
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      const res = JSON.parse(m[0]);
      return Math.max(10, Math.min(200, res.count || estimadoBase));
    }
    return Math.max(10, Math.min(150, estimadoBase));
  } catch {
    return 15;
  }
}

async function generarFlashcardsCompletas(content: string, totalCount: number, lang: string): Promise<any[]> {
  const todasFlashcards: any[] = [];
  const words = content.split(/\s+/);
  const wordsPerChunk = Math.min(Math.ceil(words.length / Math.ceil(totalCount / 10)), 400);
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '));
  }

  const flashcardsPerChunk = Math.ceil(totalCount / chunks.length);

  for (let idx = 0; idx < chunks.length; idx++) {
    try {
      const r = await groqRequest((client, model) => client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          {
            role: 'system',
            content: `Crea ${flashcardsPerChunk} flashcards de este texto. Solo array JSON: [{"question":"...","answer":"..."}]`,
          },
          { role: 'user', content: chunks[idx] },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }));

      const m = (r.choices[0]?.message?.content || '').match(/\[[\s\S]*\]/);
      if (m) todasFlashcards.push(...JSON.parse(m[0]));
      if (idx < chunks.length - 1) await sleep(1000);
    } catch (e) { console.error(`Error chunk ${idx}`, e); }
  }
  return todasFlashcards;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, count, idioma, getRecommendation } = body;
    if (!content) return NextResponse.json({ success: false }, { status: 400 });

    // 🎯 REVISAR CACHÉ PRIMERO
    const cache = await getCachedContent(content);
    if (cache && cache.flashcards) {
      console.log('🚀 Sirviendo desde CACHÉ (Tokens ahorrados: 100%)');
      return NextResponse.json({ success: true, flashcards: cache.flashcards, fromCache: true });
    }

    if (getRecommendation) {
      const realCount = await calcularFlashcardsNecesarias(content, idioma);
      return NextResponse.json({ success: true, recommended: realCount });
    }

    const flashcardCount = count || await calcularFlashcardsNecesarias(content, idioma);
    const flashcards = await generarFlashcardsCompletas(content, flashcardCount, idioma);

    if (flashcards.length > 0) {
      // 🎯 GUARDAR EN CACHÉ PARA EL PRÓXIMO USUARIO
      await saveToCache(content, { flashcards });
      return NextResponse.json({ success: true, flashcards });
    }

    throw new Error('No se generaron');
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
