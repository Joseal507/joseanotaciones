import { NextRequest, NextResponse } from 'next/server';
import { getGroqClient } from '../../../lib/groqClient';

// ── Calcular cuántas flashcards necesita el contenido ──
async function calcularFlashcardsNecesarias(content: string, lang: string): Promise<number> {
  try {
    const wordCount = content.split(/\s+/).length;
    
    // Heurística base: 1 flashcard por cada 50-80 palabras de contenido real
    const estimadoBase = Math.ceil(wordCount / 60);
    
    // Preguntar a la IA cuántas realmente necesita
    const c = getGroqClient();
    const r = await c.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: lang === 'en'
            ? `You are an expert at analyzing educational content. Count ALL distinct concepts, facts, definitions, formulas, processes, dates, names, and important details in the text. Each one needs its own flashcard. Be thorough - missing information means the student won't learn it. Respond ONLY with JSON: {"count": number, "reason": "brief explanation", "topics_found": ["topic1", "topic2"]}`
            : `Eres experto en analizar contenido educativo. Cuenta TODOS los conceptos distintos, hechos, definiciones, fórmulas, procesos, fechas, nombres y detalles importantes en el texto. Cada uno necesita su propia flashcard. Sé exhaustivo - si falta información el estudiante no la aprenderá. Responde SOLO con JSON: {"count": number, "reason": "breve explicación", "topics_found": ["tema1", "tema2"]}`,
        },
        {
          role: 'user',
          content: `${lang === 'en' ? 'Text' : 'Texto'} (${wordCount} ${lang === 'en' ? 'words' : 'palabras'}):\n\n${content.substring(0, 6000)}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 400,
    });

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

// ── Generar flashcards en chunks para cubrir TODO el contenido ──
async function generarFlashcardsCompletas(
  content: string,
  totalCount: number,
  lang: string,
  existingQuestions: string[] = []
): Promise<any[]> {
  const todasFlashcards: any[] = [];
  
  // Dividir el contenido en secciones para no perder nada
  const words = content.split(/\s+/);
  const wordsPerChunk = Math.ceil(words.length / Math.ceil(totalCount / 15));
  const chunks: string[] = [];
  
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '));
  }

  console.log(`📚 Procesando ${chunks.length} secciones para ${totalCount} flashcards`);

  // Flashcards por chunk
  const flashcardsPerChunk = Math.ceil(totalCount / chunks.length);

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const existentes = [
      ...existingQuestions,
      ...todasFlashcards.map(f => f.question),
    ];
    const existentesList = existentes.length > 0
      ? (lang === 'en'
        ? `\n\nDo NOT repeat these questions:\n- ${existentes.slice(-30).join('\n- ')}`
        : `\n\nNO repitas estas preguntas:\n- ${existentes.slice(-30).join('\n- ')}`)
      : '';

    try {
      const c = getGroqClient();
      const r = await c.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: lang === 'en'
              ? `You are an expert flashcard creator. Extract EVERY piece of important information from this text section and create ${flashcardsPerChunk} flashcards. Cover ALL concepts, definitions, facts, formulas, processes, examples and details - miss NOTHING. Vary question types: definitions, applications, comparisons, cause-effect, formulas, examples. Respond ONLY with JSON array: [{"question":"...","answer":"..."}]${existentesList}`
              : `Eres un experto creador de flashcards. Extrae CADA pieza de información importante de esta sección y crea ${flashcardsPerChunk} flashcards. Cubre TODOS los conceptos, definiciones, hechos, fórmulas, procesos, ejemplos y detalles - no te pierdas NADA. Varía tipos: definiciones, aplicaciones, comparaciones, causa-efecto, fórmulas, ejemplos. Responde SOLO con array JSON: [{"question":"...","answer":"..."}]${existentesList}`,
          },
          {
            role: 'user',
            content: `${lang === 'en' ? 'Section' : 'Sección'} ${idx + 1}/${chunks.length}:\n\n${chunk}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      });

      const t = r.choices[0]?.message?.content || '[]';
      const m = t.match(/\[[\s\S]*\]/);
      if (m) {
        const nuevas = JSON.parse(m[0]);
        todasFlashcards.push(...nuevas);
        console.log(`✅ Sección ${idx + 1}: ${nuevas.length} flashcards (total: ${todasFlashcards.length})`);
      }
    } catch (e) {
      console.log(`Error en sección ${idx + 1}:`, e);
    }
  }

  return todasFlashcards;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      content,
      count,
      idioma,
      getRecommendation,
      existingQuestions,
      imageBase64,
      imageMime,
    } = body;
    const lang = idioma === 'en' ? 'en' : 'es';

    if (!content) {
      return NextResponse.json({ success: false, error: 'No content' }, { status: 400 });
    }

    // ===== RECOMENDACIÓN =====
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

    // ===== IMAGEN =====
    if (imageBase64 && imageMime) {
      const vc = getGroqClient();
      const flashcardCount = count || 10;
      const vr = await vc.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
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
        max_tokens: 8000,
      });
      const vt = vr.choices[0]?.message?.content || '[]';
      const vm = vt.match(/\[[\s\S]*\]/);
      if (vm) return NextResponse.json({ success: true, flashcards: JSON.parse(vm[0]) });
      return NextResponse.json({ success: false, error: 'Could not parse' }, { status: 500 });
    }

    // ===== GENERACIÓN PRINCIPAL =====

    // 1. Calcular cuántas flashcards necesita
    const flashcardCount = count || await calcularFlashcardsNecesarias(content, lang);
    console.log(`🎯 Generando ${flashcardCount} flashcards para ${content.split(/\s+/).length} palabras`);

    // 2. Si el contenido es pequeño, generar de una sola vez
    const wordCount = content.split(/\s+/).length;
    
    if (wordCount <= 1500 || flashcardCount <= 20) {
      // Contenido pequeño → generar todo de una vez
      const existentesList = existingQuestions?.length > 0
        ? (lang === 'en'
          ? `\n\nDo NOT repeat: ${existingQuestions.slice(0, 30).join(' | ')}`
          : `\n\nNO repetir: ${existingQuestions.slice(0, 30).join(' | ')}`)
        : '';

      const c = getGroqClient();
      const r = await c.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: lang === 'en'
              ? `You are an expert flashcard creator. Create EXACTLY ${flashcardCount} flashcards that cover 100% of the information. Extract every concept, definition, fact, formula, process and detail. Vary types: definitions, applications, comparisons, cause-effect, formulas. Respond ONLY with JSON array: [{"question":"","answer":""}]${existentesList}`
              : `Eres un experto creador de flashcards. Crea EXACTAMENTE ${flashcardCount} flashcards que cubran el 100% de la información. Extrae cada concepto, definición, hecho, fórmula, proceso y detalle. Varía tipos: definiciones, aplicaciones, comparaciones, causa-efecto, fórmulas. Responde SOLO con array JSON: [{"question":"","answer":""}]${existentesList}`,
          },
          {
            role: 'user',
            content: `${lang === 'en' ? 'Create' : 'Crea'} ${flashcardCount} flashcards:\n\n${content.substring(0, 10000)}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 8000,
      });

      const t = r.choices[0]?.message?.content || '[]';
      const m = t.match(/\[[\s\S]*\]/);
      if (m) {
        const flashcards = JSON.parse(m[0]);
        console.log(`✅ Generadas ${flashcards.length} flashcards`);
        return NextResponse.json({ success: true, flashcards });
      }
    } else {
      // Contenido grande → procesar en chunks
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

    // Fallback
    throw new Error('No se pudieron generar flashcards');

  } catch (error: any) {
    console.error('Error flashcards:', error);
    // Fallback simple
    try {
      const { content, count, idioma } = await request.clone().json();
      const c = getGroqClient();
      const r = await c.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `${idioma === 'en' ? `Create ${count || 10} flashcards` : `Crea ${count || 10} flashcards`}. JSON: [{"question":"","answer":""}]`,
          },
          { role: 'user', content: content?.substring(0, 6000) || '' },
        ],
        temperature: 0.3,
        max_tokens: 8000,
      });
      const t = r.choices[0]?.message?.content || '[]';
      const m = t.match(/\[[\s\S]*\]/);
      return NextResponse.json({ success: true, flashcards: m ? JSON.parse(m[0]) : [] });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
  }
}