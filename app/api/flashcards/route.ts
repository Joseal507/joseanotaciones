import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';
import { getCachedContent, saveToCache } from '../../../lib/cache';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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
    const {
      content,
      count,
      idioma,
      getRecommendation,
      existingQuestions = [],
    } = body;

    if (!content) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const lang = idioma === 'en' ? 'en' : 'es';
    const existing = Array.isArray(existingQuestions)
      ? existingQuestions.filter(Boolean)
      : [];

    const isAddingMore = existing.length > 0;

    // ── SOLO usar caché si NO estamos añadiendo más ──
    if (!isAddingMore) {
      const cache = await getCachedContent(content);
      if (cache && cache.flashcards) {
        console.log('🚀 Sirviendo desde CACHÉ (Tokens ahorrados: 100%)');
        if (getRecommendation) {
          return NextResponse.json({
            success: true,
            recommended: cache.flashcards.length,
          });
        }
        return NextResponse.json({
          success: true,
          flashcards: cache.flashcards,
          fromCache: true,
        });
      }
    }

    // ── RECOMENDACIÓN AUTOMÁTICA ──
    const flashcardCount =
      count ||
      await groqRequest(async (client, model) => {
        const r = await client.chat.completions.create({
          model: model('llama-3.3-70b-versatile'),
          messages: [
            {
              role: 'system',
              content:
                lang === 'en'
                  ? 'You are an expert educator. Read the text and count EVERY distinct concept, fact, definition, formula, date, name, process or idea that deserves its own flashcard. Be generous, do not group concepts. Respond ONLY with JSON: {"count": number}'
                  : 'Eres un educador experto. Lee el texto y cuenta CADA concepto distinto, hecho, definición, fórmula, fecha, nombre, proceso o idea que merece su propia flashcard. Sé generoso, no agrupes conceptos. Responde SOLO con JSON: {"count": number}',
            },
            {
              role: 'user',
              content: content.substring(0, 8000),
            },
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
      return NextResponse.json({
        success: true,
        recommended: flashcardCount,
      });
    }

    console.log(
      `📚 Generando ${flashcardCount} flashcards del documento${isAddingMore ? ' (sin repetir)' : ''}`
    );

    // ── DIVIDIR EN CHUNKS ──
    const chunkSize = 3000;
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.substring(i, i + chunkSize));
    }

    const basePerChunk = Math.ceil(flashcardCount / chunks.length);
    const flashcardsPerChunk = isAddingMore ? basePerChunk + 2 : basePerChunk;

    const existingPreview = existing
      .slice(0, 150)
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
                content:
                  lang === 'en'
                    ? `You are an expert flashcard creator.
Create exactly ${flashcardsPerChunk} flashcards from this text fragment (${idx + 1} of ${chunks.length}).
Cover ALL important concepts in this fragment.

IMPORTANT RULES:
- DO NOT repeat or paraphrase any existing question
- If a concept is already covered by an existing question, skip it and create a different one
- Return ONLY a JSON array: [{"question":"...","answer":"..."}]
- No extra text

EXISTING QUESTIONS TO AVOID:
${existingPreview || '(none)'}`
                    : `Eres un experto creador de flashcards.
Crea exactamente ${flashcardsPerChunk} flashcards de este fragmento (${idx + 1} de ${chunks.length}).
Cubre TODOS los conceptos importantes de este fragmento.

REGLAS IMPORTANTES:
- NO repitas ni parafrasees ninguna pregunta existente
- Si un concepto ya está cubierto por una pregunta existente, sáltalo y crea otra diferente
- Devuelve SOLO un array JSON: [{"question":"...","answer":"..."}]
- Sin texto extra

PREGUNTAS EXISTENTES A EVITAR:
${existingPreview || '(ninguna)'}`,
              },
              {
                role: 'user',
                content: chunks[idx],
              },
            ],
            temperature: 0.4,
            max_tokens: 3000,
          });

          return r.choices[0]?.message?.content || '';
        });

        const m = text.match(/\[[\s\S]*\]/);
        if (m) {
          rawFlashcards.push(...JSON.parse(m[0]));
        }

        if (idx < chunks.length - 1) {
          await sleep(500);
        }
      } catch (e) {
        console.error(`Error chunk ${idx}`, e);
      }
    }

    let flashcards = dedupeFlashcards(rawFlashcards, existing).slice(0, flashcardCount);

    // ── SEGUNDA PASADA si faltan por culpa de duplicados ──
    if (isAddingMore && flashcards.length < flashcardCount) {
      const faltan = flashcardCount - flashcards.length;
      const prohibidas = [...existing, ...flashcards.map(f => f.question)]
        .slice(0, 200)
        .map((q, i) => `${i + 1}. ${q}`)
        .join('\n');

      try {
        const extraText = await groqRequest(async (client, model) => {
          const r = await client.chat.completions.create({
            model: model('llama-3.3-70b-versatile'),
            messages: [
              {
                role: 'system',
                content:
                  lang === 'en'
                    ? `Create ${faltan + 5} NEW unique flashcards from the document.
Do NOT repeat, paraphrase, or slightly reword any question from this forbidden list.
Return ONLY JSON array: [{"question":"...","answer":"..."}]

FORBIDDEN QUESTIONS:
${prohibidas}`
                    : `Crea ${faltan + 5} flashcards NUEVAS y únicas del documento.
NO repitas, parafrasees ni reformules ninguna pregunta de esta lista prohibida.
Devuelve SOLO un array JSON: [{"question":"...","answer":"..."}]

PREGUNTAS PROHIBIDAS:
${prohibidas}`,
              },
              {
                role: 'user',
                content: content.substring(0, 9000),
              },
            ],
            temperature: 0.5,
            max_tokens: 3000,
          });

          return r.choices[0]?.message?.content || '';
        });

        const m = (extraText || "").match(/\[\s\S]*\/);
        if (m) {
          const extraCards = JSON.parse(m[0]);
          flashcards = dedupeFlashcards(
            [...flashcards, ...extraCards],
            existing
          ).slice(0, flashcardCount);
        }
      } catch (e) {
        console.error('Error segunda pasada flashcards:', e);
      }
    }

    if (flashcards.length === 0) {
      throw new Error('No se generaron flashcards');
    }

    console.log(`✅ Generadas ${flashcards.length} flashcards`);

    // ── SOLO guardar en caché la generación base, no el "añadir más" ──
    if (!isAddingMore) {
      await saveToCache(content, { flashcards });
    }

    return NextResponse.json({ success: true, flashcards });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
