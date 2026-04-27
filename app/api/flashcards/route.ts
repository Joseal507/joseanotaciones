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

const SYSTEM_PROMPT = (count: number, chunkIdx: number, totalChunks: number, lang: string, existingPreview: string) =>
  lang === 'en'
    ? `Act as an expert in pedagogy, active learning and advanced study material design. Create exactly ${count} flashcards from text fragment ${chunkIdx + 1} of ${totalChunks}.

RULES:
- Cover 100% of the relevant information in this fragment
- Each flashcard: clear focused question + complete but concise answer
- Use different question types: conceptual, explanatory, procedural, comparative, applied
- Avoid redundancy but split complex topics into multiple cards
- Clear, precise, academic but understandable language
- Do NOT repeat or paraphrase existing questions

Return ONLY a JSON array, no extra text:
[{"question":"...","answer":"..."}]
${existingPreview ? '\nEXISTING QUESTIONS TO AVOID:\n' + existingPreview : ''}`
    : `Actua como experto en pedagogia, aprendizaje activo y diseno de material de estudio. Crea exactamente ${count} flashcards del fragmento ${chunkIdx + 1} de ${totalChunks}.

REGLAS:
- Cubre el 100% de la informacion relevante de este fragmento
- Cada flashcard: pregunta clara y enfocada + respuesta completa pero concisa
- Usa diferentes tipos de preguntas: conceptuales, explicativas, procedimentales, comparativas, aplicadas
- Evita redundancia pero divide temas complejos en multiples tarjetas
- Lenguaje claro, preciso, academico pero entendible
- NO repitas ni parafrasees preguntas existentes

Devuelve SOLO un array JSON, sin texto extra:
[{"question":"...","answer":"..."}]
${existingPreview ? '\nPREGUNTAS EXISTENTES A EVITAR:\n' + existingPreview : ''}`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, count, idioma, getRecommendation, existingQuestions = [] } = body;

    if (!content) return NextResponse.json({ success: false }, { status: 400 });

    const lang = idioma === 'en' ? 'en' : 'es';
    const existing = Array.isArray(existingQuestions) ? existingQuestions.filter(Boolean) : [];
    const isAddingMore = existing.length > 0;

    // ── CACHÉ solo si no estamos añadiendo más ──
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

    // ── CALCULAR CUÁNTAS FLASHCARDS NECESITA LA IA ──
    const totalPosible = await groqRequest(async (client, model) => {
      const r = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          {
            role: 'system',
            content: lang === 'en'
              ? 'You are an expert educator. Read the text and count EVERY distinct concept, term, definition, formula, rule, process or fact that deserves its own flashcard. Be generous. Respond ONLY with JSON: {"count": number}'
              : 'Eres un educador experto. Lee el texto y cuenta CADA concepto distinto, termino, definicion, formula, regla, proceso o dato que merece su propia flashcard. Se generoso. Responde SOLO con JSON: {"count": number}',
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
      return NextResponse.json({ success: true, recommended: totalPosible });
    }

    // ── SI ESTAMOS AÑADIENDO MÁS: verificar si ya cubrimos el 100% ──
    if (isAddingMore) {
      const margenAgotado = Math.floor(totalPosible * 0.9);
      if (existing.length >= margenAgotado) {
        console.log(`📊 Documento agotado: ${existing.length} existentes vs ${totalPosible} posibles`);
        return NextResponse.json({
          success: false,
          exhausted: true,
          message: lang === 'en'
            ? `The document has been analyzed 100%. You already have ${existing.length} flashcards covering all the content.`
            : `El documento ya fue analizado al 100%. Ya tienes ${existing.length} flashcards cubriendo todo el contenido.`,
        });
      }
    }

    const flashcardCount = count || totalPosible;
    console.log(`📚 Generando ${flashcardCount} flashcards${isAddingMore ? ' (sin repetir)' : ''}`);

    // ── DIVIDIR EN CHUNKS ──
    const chunkSize = 3000;
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.substring(i, i + chunkSize));
    }

    const flashcardsPerChunk = Math.ceil(flashcardCount / chunks.length) + (isAddingMore ? 5 : 0);

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
                content: SYSTEM_PROMPT(flashcardsPerChunk, idx, chunks.length, lang, existingPreview),
              },
              { role: 'user', content: chunks[idx] },
            ],
            temperature: 0.4,
            max_tokens: 4000,
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

    // ── Si no generó nuevas únicas → documento agotado ──
    if (isAddingMore && flashcards.length === 0) {
      return NextResponse.json({
        success: false,
        exhausted: true,
        message: lang === 'en'
          ? `The document has been analyzed 100%. You already have ${existing.length} flashcards covering all the content.`
          : `El documento ya fue analizado al 100%. Ya tienes ${existing.length} flashcards cubriendo todo el contenido.`,
      });
    }

    if (flashcards.length === 0) throw new Error('No se generaron flashcards');

    console.log(`✅ Generadas ${flashcards.length} flashcards nuevas`);

    if (!isAddingMore) {
      await saveToCache(content, { flashcards });
    }

    return NextResponse.json({ success: true, flashcards });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
