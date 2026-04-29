import { NextRequest, NextResponse } from 'next/server';

// Detectar idioma del contenido
const detectLang = (text: string, fallback: string): 'en' | 'es' => {
  if (!text || text.length < 30) return fallback === 'en' ? 'en' : 'es';
  const t = text.toLowerCase().substring(0, 1000);
  const en = ['the','is','are','was','were','have','has','this','that','with','from','they','what','which','when','how','can','will','would','about','there','their','been','an','of','in','to','for','on','at'];
  const es = ['que','con','para','por','una','los','las','del','está','son','como','pero','más','muy','todo','este','esta','también','hacer','tiene','pueden','cuando','donde','porque','aunque','se','lo','le','su','el','la','de','en','un'];
  const words = t.split(/\s+/);
  let enC = 0, esC = 0;
  words.forEach(w => { if (en.includes(w)) enC++; if (es.includes(w)) esC++; });
  if (enC === 0 && esC === 0) return fallback === 'en' ? 'en' : 'es';
  return enC > esC ? 'en' : 'es';
};

import { groqRequest } from '../../../lib/groqClient';
import { getCachedContent, saveToCache } from '../../../lib/cache';
import { detectContentLanguage } from '../../../lib/detectLanguage';

const parseJSON = (text: string): any[] => {
  try {
    const m = String(text || '').match(/\[[\s\S]*\]/);
    if (!m) return [];
    return JSON.parse(m[0]);
  } catch { return []; }
};

const normalizeText = (text: string = '') =>
  text.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:()"']/g, '')
    .replace(/\s+/g, ' ').trim();

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

// Contar conceptos Y chunks EN PARALELO
const contarConceptos = async (content: string, lang: string): Promise<number> => {
  try {
    const resultado = await groqRequest(async (client, model) => {
      const r = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          {
            role: 'system',
            content: lang === 'en'
              ? 'Expert educator. Count EVERY distinct concept, term, definition, formula, rule, process or fact that deserves its own flashcard. Be generous — better to have more than fewer. Respond ONLY with JSON: {"count": number}'
              : 'Educador experto. Cuenta CADA concepto distinto, termino, definicion, formula, regla, proceso o dato que merece su propia flashcard. Se generoso — mejor mas que menos. Responde SOLO con JSON: {"count": number}',
          },
          { role: 'user', content: content.substring(0, 6000) },
        ],
        temperature: 0.1,
        max_tokens: 80,
      });
      const text = r.choices[0]?.message?.content || '';
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const res = JSON.parse(m[0]);
        return Math.max(20, Math.min(150, res.count || 30));
      }
      return 30;
    });
    return resultado;
  } catch {
    // Fallback por longitud si falla la llamada
    const wordCount = content.split(/\s+/).length;
    return Math.min(150, Math.max(20, Math.floor(wordCount / 40)));
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, count, idioma, getRecommendation, existingQuestions = [] } = body;
    if (!content) return NextResponse.json({ success: false }, { status: 400 });

    const lang = detectContentLanguage(content, idioma === 'en' ? 'en' : 'es');
    const existing = Array.isArray(existingQuestions) ? existingQuestions.filter(Boolean) : [];
    const isAddingMore = existing.length > 0;

    // ── CACHÉ ──
    if (!isAddingMore) {
      const cache = await getCachedContent(content);
      if (cache?.flashcards) {
        if (getRecommendation) return NextResponse.json({ success: true, recommended: cache.flashcards.length });
        return NextResponse.json({ success: true, flashcards: cache.flashcards, fromCache: true });
      }
    }

    // ── PREPARAR CHUNKS ──
    const chunkSize = 3500;
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.substring(i, i + chunkSize));
    }

    // ── CONTAR CONCEPTOS Y PREPARAR EN PARALELO ──
    // La llamada de conteo corre AL MISMO TIEMPO que se prepara todo lo demás
    // No esperamos a que termine para empezar
    const conteoPromise = contarConceptos(content, lang);

    // Si solo piden recomendacion, esperar el conteo
    if (getRecommendation) {
      const total = await conteoPromise;
      return NextResponse.json({ success: true, recommended: total });
    }

    // ── ESPERAR CONTEO (ya viene corriendo en paralelo) ──
    const totalConceptos = await conteoPromise;
    const flashcardCount = count || totalConceptos;

    console.log(`📚 Documento: ${chunks.length} chunks | ${totalConceptos} conceptos detectados | generando ${flashcardCount}`);

    // ── Verificar si ya cubrimos el 100% ──
    if (isAddingMore) {
      const margen = Math.floor(totalConceptos * 0.9);
      if (existing.length >= margen) {
        return NextResponse.json({
          success: false, exhausted: true,
          message: lang === 'en'
            ? `Document analyzed 100%. You already have ${existing.length} flashcards covering all content.`
            : `El documento ya fue analizado al 100%. Ya tienes ${existing.length} flashcards cubriendo todo el contenido.`,
        });
      }
    }

    const flashcardsPerChunk = Math.ceil(
      (flashcardCount + (isAddingMore ? 10 : 0)) / chunks.length
    );

    const existingPreview = existing.slice(0, 80).map((q, i) => `${i + 1}. ${q}`).join('\n');

    const systemPrompt = (idx: number) => lang === 'en'
      ? `Expert educator. Create exactly ${flashcardsPerChunk} flashcards from fragment ${idx + 1} of ${chunks.length}.
RULES:
- Cover 100% of the information in this fragment
- Varied question types: conceptual, explanatory, procedural, comparative, applied
- Clear focused question + complete but concise answer
- Do NOT repeat or paraphrase existing questions
Return ONLY JSON array, no extra text:
[{"question":"...","answer":"..."}]${existingPreview ? '\nAVOID THESE:\n' + existingPreview : ''}`
      : `Educador experto. Crea exactamente ${flashcardsPerChunk} flashcards del fragmento ${idx + 1} de ${chunks.length}.
REGLAS:
- Cubre el 100% de la informacion de este fragmento
- Tipos variados: conceptuales, explicativas, procedimentales, comparativas, aplicadas
- Pregunta clara y enfocada + respuesta completa pero concisa
- NO repitas ni parafrasees preguntas existentes
Devuelve SOLO array JSON, sin texto extra:
[{"question":"...","answer":"..."}]${existingPreview ? '\nEVITAR ESTAS:\n' + existingPreview : ''}`;

    // ── TODOS LOS CHUNKS EN PARALELO ──
    const rawFlashcards: any[] = [];
    const BATCH = 4; // máximo 4 llamadas simultáneas

    for (let b = 0; b < chunks.length; b += BATCH) {
      const batch = chunks.slice(b, b + BATCH);
      const results = await Promise.allSettled(
        batch.map((chunk, i) =>
          groqRequest(async (client, model) => {
            const r = await client.chat.completions.create({
              model: model('llama-3.3-70b-versatile'),
              messages: [
                { role: 'system', content: systemPrompt(b + i) },
                { role: 'user', content: chunk },
              ],
              temperature: 0.4,
              max_tokens: 4000,
            });
            return r.choices[0]?.message?.content || '';
          })
        )
      );
      for (const r of results) {
        if (r.status === 'fulfilled') rawFlashcards.push(...parseJSON(r.value));
      }
    }

    let flashcards = dedupeFlashcards(rawFlashcards, existing).slice(0, flashcardCount);

    if (isAddingMore && flashcards.length === 0) {
      return NextResponse.json({
        success: false, exhausted: true,
        message: lang === 'en'
          ? `Document analyzed 100%. You already have ${existing.length} flashcards.`
          : `El documento ya fue analizado al 100%. Ya tienes ${existing.length} flashcards.`,
      });
    }

    if (flashcards.length === 0) throw new Error('No se generaron flashcards');

    console.log(`✅ ${flashcards.length} flashcards unicas generadas`);

    if (!isAddingMore) await saveToCache(content, { flashcards });

    return NextResponse.json({ success: true, flashcards });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
