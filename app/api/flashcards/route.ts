import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';

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
            ? `Analyze educational content. Count ALL distinct concepts, facts, definitions, formulas, processes, dates, names and important details. Each needs its own flashcard. Respond ONLY with JSON: {"count": number, "reason": "brief explanation"}`
            : `Analiza contenido educativo. Cuenta TODOS los conceptos distintos, hechos, definiciones, fórmulas, procesos, fechas, nombres y detalles importantes. Cada uno necesita su propia flashcard. Responde SOLO con JSON: {"count": number, "reason": "breve explicación"}`,
        },
        {
          role: 'user',
          content: `${lang === 'en' ? 'Text' : 'Texto'} (${wordCount} ${lang === 'en' ? 'words' : 'palabras'}):\n\n${content.substring(0, 3000)}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 200,
    }));

    const t = r.choices[0]?.message?.content || '';
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      const res = JSON.parse(m[0]);
      const count = Math.max(10, Math.min(200, res.count || estimadoBase));
      console.log(`📊 IA recomienda ${count} flashcards: ${res.reason}`);
      return count;
    }
    return Math.max(10, Math.min(150, estimadoBase));
  } catch {
    const wordCount = content.split(/\s+/).length;
    return Math.max(10, Math.min(150, Math.ceil(wordCount / 60)));
  }
}

async function generarFlashcardsCompletas(
  content: string,
  totalCount: number,
  lang: string,
  existingQuestions: string[] = []
): Promise<any[]> {
  const todasFlashcards: any[] = [];

  const words = content.split(/\s+/);
  const wordsPerChunk = Math.min(
    Math.ceil(words.length / Math.ceil(totalCount / 10)),
    400
  );
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '));
  }

  console.log(`📚 Procesando ${chunks.length} secciones para ${totalCount} flashcards`);

  const flashcardsPerChunk = Math.ceil(totalCount / chunks.length);

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const existentes = [
      ...existingQuestions,
      ...todasFlashcards.map(f => f.question),
    ];
    const existentesList = existentes.length > 0
      ? (lang === 'en'
        ? `\n\nDo NOT repeat: ${existentes.slice(-10).join(' | ')}`
        : `\n\nNO repetir: ${existentes.slice(-10).join(' | ')}`)
      : '';

    try {
      const r = await groqRequest((client, model) => client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          {
            role: 'system',
            content: lang === 'en'
              ? `Expert flashcard creator. Create ${flashcardsPerChunk} flashcards from this text. Cover all concepts, definitions, facts and details. JSON array only: [{"question":"...","answer":"..."}]${existentesList}`
              : `Experto en flashcards. Crea ${flashcardsPerChunk} flashcards de este texto. Cubre todos los conceptos, definiciones, hechos y detalles. Solo array JSON: [{"question":"...","answer":"..."}]${existentesList}`,
          },
          {
            role: 'user',
            content: `${lang === 'en' ? 'Section' : 'Sección'} ${idx + 1}/${chunks.length}:\n\n${chunk}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }));

      const t = r.choices[0]?.message?.content || '[]';
      const m = t.match(/\[[\s\S]*\]/);
      if (m) {
        const nuevas = JSON.parse(m[0]);
        todasFlashcards.push(...nuevas);
        console.log(`✅ Sección ${idx + 1}: ${nuevas.length} flashcards (total: ${todasFlashcards.length})`);
      }

      if (idx < chunks.length - 1) await sleep(1000);

    } catch (e) {
      console.log(`❌ Error en sección ${idx + 1}:`, e);
    }
  }

  return todasFlashcards;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, count, idioma, getRecommendation, existingQuestions, imageBase64, imageMime } = body;
    const lang = idioma === 'en' ? 'en' : 'es';

    if (!content) {
      return NextResponse.json({ success: false, error: 'No content' }, { status: 400 });
    }

    if (getRecommendation) {
      const realCount = await calcularFlashcardsNecesarias(content, lang);
      return NextResponse.json({
        success: true,
        recommended: realCount,
        reason: lang === 'en'
          ? `${realCount} flashcards needed to cover 100% of the content`
          : `Se necesitan ${realCount} flashcards para cubrir el 100% del contenido`,
      });
    }

    if (imageBase64 && imageMime) {
      const flashcardCount = count || 10;
      const vr = await groqRequest((client, model) => client.chat.completions.create({
        model: model('meta-llama/llama-4-scout-17b-16e-instruct'),
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
            {
              type: 'text',
              text: lang === 'en'
                ? `Create ${flashcardCount} flashcards covering ALL information in this image. JSON: [{"question":"","answer":""}]`
                : `Crea ${flashcardCount} flashcards cubriendo TODA la información de esta imagen. JSON: [{"question":"","answer":""}]`,
            },
          ] as any,
        }],
        temperature: 0.3,
        max_tokens: 4000,
      }));
      const vt = vr.choices[0]?.message?.content || '[]';
      const vm = vt.match(/\[[\s\S]*\]/);
      if (vm) return NextResponse.json({ success: true, flashcards: JSON.parse(vm[0]) });
      return NextResponse.json({ success: false, error: 'Could not parse' }, { status: 500 });
    }

    const flashcardCount = count || await calcularFlashcardsNecesarias(content, lang);
    console.log(`🎯 Generando ${flashcardCount} flashcards para ${content.split(/\s+/).length} palabras`);

    const wordCount = content.split(/\s+/).length;

    if (wordCount <= 1500 && flashcardCount <= 20) {
      const existentesList = existingQuestions?.length > 0
        ? (lang === 'en'
          ? `\n\nDo NOT repeat: ${existingQuestions.slice(0, 10).join(' | ')}`
          : `\n\nNO repetir: ${existingQuestions.slice(0, 10).join(' | ')}`)
        : '';

      const r = await groqRequest((client, model) => client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          {
            role: 'system',
            content: lang === 'en'
              ? `Expert flashcard creator. Create EXACTLY ${flashcardCount} flashcards covering 100% of the information. JSON array only: [{"question":"","answer":""}]${existentesList}`
              : `Experto en flashcards. Crea EXACTAMENTE ${flashcardCount} flashcards cubriendo el 100% de la información. Solo array JSON: [{"question":"","answer":""}]${existentesList}`,
          },
          {
            role: 'user',
            content: `${lang === 'en' ? 'Create' : 'Crea'} ${flashcardCount} flashcards:\n\n${content.substring(0, 4000)}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }));

      const t = r.choices[0]?.message?.content || '[]';
      const m = t.match(/\[[\s\S]*\]/);
      if (m) {
        const flashcards = JSON.parse(m[0]);
        console.log(`✅ Generadas ${flashcards.length} flashcards`);
        return NextResponse.json({ success: true, flashcards });
      }
    } else {
      const flashcards = await generarFlashcardsCompletas(
        content,
        flashcardCount,
        lang,
        existingQuestions || []
      );

      if (flashcards.length > 0) {
        console.log(`✅ Total generadas: ${flashcards.length} flashcards`);
        return NextResponse.json({ success: true, flashcards });
      }
    }

    throw new Error('No se pudieron generar flashcards');

  } catch (error: any) {
    console.error('❌ Error flashcards:', error);
    try {
      const { content, count, idioma } = await request.clone().json();
      const r = await groqRequest((client, model) => client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          {
            role: 'system',
            content: `${idioma === 'en' ? `Create ${count || 10} flashcards` : `Crea ${count || 10} flashcards`}. JSON: [{"question":"","answer":""}]`,
          },
          { role: 'user', content: content?.substring(0, 3000) || '' },
        ],
        temperature: 0.3,
        max_tokens: 3000,
      }));
      const t = r.choices[0]?.message?.content || '[]';
      const m = t.match(/\[[\s\S]*\]/);
      return NextResponse.json({ success: true, flashcards: m ? JSON.parse(m[0]) : [] });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
  }
}
