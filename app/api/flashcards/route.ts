import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';
import { getCachedContent, saveToCache } from '../../../lib/cache';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, count, idioma } = body;
    if (!content) return NextResponse.json({ success: false, error: 'No hay contenido' }, { status: 400 });

    // ── CACHÉ ──
    const cache = await getCachedContent(content);
    if (cache && cache.flashcards) {
      console.log('🚀 Flashcards desde CACHÉ');
      return NextResponse.json({ success: true, flashcards: cache.flashcards, fromCache: true });
    }

    const lang = idioma === 'en' ? 'en' : 'es';
    const wordCount = content.split(/\s+/).length;
    const flashcardCount = count || Math.min(30, Math.max(10, Math.ceil(wordCount / 50)));
    const textToUse = content.substring(0, 6000);

    // ── 1 SOLA LLAMADA (antes eran múltiples chunks con sleep) ──
    const flashcardsText = await groqRequest(async (client, model) => {
      const res = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          {
            role: 'system',
            content: lang === 'en'
              ? `You are an expert flashcard creator. Create exactly ${flashcardCount} flashcards from the text. Return ONLY a JSON array: [{"question":"...","answer":"..."}]. No extra text.`
              : `Eres un experto creador de flashcards. Crea exactamente ${flashcardCount} flashcards del texto. Devuelve SOLO un array JSON: [{"question":"...","answer":"..."}]. Sin texto extra.`,
          },
          {
            role: 'user',
            content: lang === 'en' ? `Create ${flashcardCount} flashcards from:\n\n${textToUse}` : `Crea ${flashcardCount} flashcards de:\n\n${textToUse}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      });
      return res.choices[0]?.message?.content || '[]';
    });

    const match = flashcardsText.match(/\[[\s\S]*\]/);
    const flashcards = match ? JSON.parse(match[0]) : [];

    if (flashcards.length === 0) {
      return NextResponse.json({ success: false, error: 'No se generaron flashcards' }, { status: 500 });
    }

    await saveToCache(content, { flashcards });
    return NextResponse.json({ success: true, flashcards });

  } catch (error: any) {
    console.error('Flashcards error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
