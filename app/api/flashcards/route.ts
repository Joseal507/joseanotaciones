import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';
import { getCachedContent, saveToCache } from '../../../lib/cache';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const parseJSON = (text: string): any[] => {
  try {
    const m = String(text || '').match(/\[[\s\S]*\]/);
    if (!m) return [];
    return JSON.parse(m[0]);
  } catch {
    return [];
  }
};

const normalizeText = (text: string = '') =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:()"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const dedupeFlashcards = (cards: any[], existingQuestions: string[] = []) => {
  const seen = new Set(existingQuestions.map(q => normalizeText(q)));
  const unique: any[] = [];
  for (const card of cards) {
    const question = String(card?.question || card?.pregunta || '').trim();
    const answer = String(card?.answer || card?.respuesta || '').trim();
    if (!question || !answer) continue;
    const key = normalizeText(question);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push({ question, answer });
  }
  return unique;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, count, idioma, getRecommendation, existingQuestions = [] } = body;

    if (!content) return NextResponse.json({ success: false }, { status: 400 });

    const lang = idioma === 'en' ? 'en' : 'es';
    const existing = Array.isArray(existingQuestions) ? existingQuestions.filter(Boolean) : [];
    const isAddingMore = existing.length > 0;

    if (!isAddingMore) {
      const cache = await getCachedContent(content);
      if (cache && cache.flashcards) {
        console.log('🚀 Sirviendo desde CACHÉ');
        if (getRecommendation) {
          return NextResponse.json({ success: true, recommended: cache.flashcards.length });
        }
        return NextResponse.json({ success: true, flashcards: cache.flashcards, fromCache: true });
      }
    }

    const flashcardCount = count || await groqRequest(async (client, model) => {
      const r = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          {
            role: 'system',
            content: lang === 'en'
              ? 'You are an expert educator. Read the text and count EVERY distinct concept, fact, definition, formula, date, name, process or idea that deserves its own flashcard. Be generous, do not group concepts. Respond ONLY with JSON: {"count": number}'
              : 'Eres un educador experto. Lee el texto y cuenta CADA concepto distinto, hecho, definicion, formula, fecha, nombre, proceso o idea que merece su propia flashcard. Se generoso, no agrupes conceptos. Responde SOLO con JSON: {"count": number}',
          },
          { role: 'user', content: content.substring(0, 8000) },
        ],
        temperature: 0.1,
        max_tokens: 100,
      });
      const text = r.choices[0]?.message?.content || '';
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const res = JSON.parse(m[0]);
        return Math.max(20, Math.min(150, res.count || 30));
      }
      return 30;
    });

    if (getRecommendation) {
      return NextResponse.json({ success: true, recommended: flashcardCount });
    }

    console.log(`📚 Generando ${flashcardCount} flashcards${isAddingMore ? ' (sin repetir)' : ''}`);

    const chunkSize = 3000;
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.substring(i, i + chunkSize));
    }

    const flashcardsPerChunk = Math.ceil(flashcardCount / chunks.length) + (isAddingMore ? 3 : 0);

    const existingPreview = existing
      .slice(0, 100)
      .map((q, i) => `${i + 1}. ${q}`)
      .join('\n');

    const rawFlashcards: any[] = [];

    for (let idx = 0; idx < chunks.length; idx++) {
      try {
        const text = await groqRequest(async (client, model) => {
          const r = await client.chat.completions.create({
            model: model('llama-3.3-70b-versatile'),
            messages: [
              {
                role: 'system',
                content: lang === 'en'
                  ? `You are an expert flashcard creator. Create exactly ${flashcardsPerChunk} flashcards from this text fragment (${idx + 1} of ${chunks.length}). Cover ALL important concepts. Do NOT repeat any existing question. Return ONLY a JSON array: [{"question":"...","answer":"..."}]. No extra text.${existingPreview ? '\n\nEXISTING QUESTIONS TO AVOID:\n' + existingPreview : ''}`
                  : `Eres un experto creador de flashcards. Crea exactamente ${flashcardsPerChunk} flashcards de este fragmento (${idx + 1} de ${chunks.length}). Cubre TODOS los conceptos importantes. NO repitas preguntas existentes. Devuelve SOLO un array JSON: [{"question":"...","answer":"..."}]. Sin texto extra.${existingPreview ? '\n\nPREGUNTAS EXISTENTES A EVITAR:\n' + existingPreview : ''}`,
              },
              { role: 'user', content: chunks[idx] },
            ],
            temperature: 0.4,
            max_tokens: 3000,
          });
          return r.choices[0]?.message?.content || '';
        });

        rawFlashcards.push(...parseJSON(text));
        if (idx < chunks.length - 1) await sleep(500);
      } catch (e) {
        console.error(`Error chunk ${idx}`, e);
      }
    }

    let flashcards = dedupeFlashcards(rawFlashcards, existing).slice(0, flashcardCount);

    if (isAddingMore && flashcards.length < flashcardCount) {
      const faltan = flashcardCount - flashcards.length;
      const prohibidas = [...existing, ...flashcards.map(f => f.question)]
        .slice(0, 150)
        .map((q, i) => `${i + 1}. ${q}`)
        .join('\n');

      try {
        const extraText = await groqRequest(async (client, model) => {
          const r = await client.chat.completions.create({
            model: model('llama-3.3-70b-versatile'),
            messages: [
              {
                role: 'system',
                content: lang === 'en'
                  ? `Create ${faltan + 5} NEW unique flashcards. Do NOT repeat any forbidden question. Return ONLY JSON array: [{"question":"...","answer":"..."}]\n\nFORBIDDEN:\n${prohibidas}`
                  : `Crea ${faltan + 5} flashcards NUEVAS y unicas. NO repitas ninguna pregunta prohibida. Devuelve SOLO un array JSON: [{"question":"...","answer":"..."}]\n\nPROHIBIDAS:\n${prohibidas}`,
              },
              { role: 'user', content: content.substring(0, 9000) },
            ],
            temperature: 0.5,
            max_tokens: 3000,
          });
          return r.choices[0]?.message?.content || '';
        });

        const extraCards = parseJSON(extraText);
        flashcards = dedupeFlashcards(
          [...flashcards, ...extraCards],
          existing
        ).slice(0, flashcardCount);

      } catch (e) {
        console.error('Error segunda pasada:', e);
      }
    }

    if (flashcards.length === 0) throw new Error('No se generaron flashcards');

    console.log(`✅ Generadas ${flashcards.length} flashcards`);

    if (!isAddingMore) {
      await saveToCache(content, { flashcards });
    }

    return NextResponse.json({ success: true, flashcards });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
