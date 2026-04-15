import { NextRequest, NextResponse } from 'next/server';
import { getGroqClient } from '../../../lib/groqClient';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, count, idioma, getRecommendation, existingQuestions, imageBase64, imageMime } = body;
    const lang = idioma === 'en' ? 'en' : 'es';

    if (!content) {
      return NextResponse.json({ success: false, error: 'No content' }, { status: 400 });
    }

    // ===== RECOMENDACIÓN =====
    if (getRecommendation) {
      const wordCount = content.split(' ').length;
      const estimated = Math.max(5, Math.min(150, Math.round(wordCount / 50)));

      const c = getGroqClient();
      const r = await c.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: lang === 'en'
            ? 'Determine how many flashcards cover 100% of important info. Respond ONLY with JSON: {"recommended": number, "reason": "brief"}'
            : 'Determina cuántas flashcards cubren el 100% de la info importante. Responde SOLO con JSON: {"recommended": number, "reason": "breve"}'
          },
          { role: 'user', content: `${lang === 'en' ? 'Text' : 'Texto'} (${wordCount} ${lang === 'en' ? 'words' : 'palabras'}):\n${content.substring(0, 4000)}` },
        ],
        temperature: 0.2,
        max_tokens: 300,
      });
      const t = r.choices[0].message.content || '';
      const m = t.match(/\{[\s\S]*\}/);
      if (m) {
        const res = JSON.parse(m[0]);
        return NextResponse.json({ success: true, recommended: Math.max(5, Math.min(150, res.recommended || estimated)), reason: res.reason || '' });
      }
      return NextResponse.json({ success: true, recommended: estimated, reason: '' });
    }

    // ===== IMAGEN =====
    if (imageBase64 && imageMime) {
      const vc = getGroqClient();
      const flashcardCount = count || 10;
      const vr = await vc.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
          { type: 'text', text: `${lang === 'en' ? `Create ${flashcardCount} flashcards from this image` : `Crea ${flashcardCount} flashcards de esta imagen`}. JSON: [{"question":"","answer":""}]` },
        ] }],
        temperature: 0.4,
        max_tokens: 8000,
      });
      const vt = vr.choices[0].message.content || '[]';
      const vm = vt.match(/\[[\s\S]*\]/);
      if (vm) return NextResponse.json({ success: true, flashcards: JSON.parse(vm[0]) });
      return NextResponse.json({ success: false, error: 'Could not parse' }, { status: 500 });
    }

    const flashcardCount = count || 10;
    const textToUse = content.substring(0, 8000);

    const hasExisting = existingQuestions && existingQuestions.length > 0;
    const existingList = hasExisting ? existingQuestions.slice(0, 50).join('\n- ') : '';
    const avoidText = hasExisting
      ? (lang === 'en' ? `\n\nDo NOT repeat these:\n- ${existingList}\nCover DIFFERENT aspects.` : `\n\nNO repitas estas:\n- ${existingList}\nCubre aspectos DIFERENTES.`)
      : '';

    // ===== PASO 1: GPT-OSS-120B extrae TODO el contenido importante =====
    let deepContent = '';
    try {
      const c1 = getGroqClient();
      const r1 = await c1.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: lang === 'en'
            ? 'Extract EVERY important fact, concept, definition, formula, date, name, process and detail from this text. List them ALL, miss NOTHING. Be thorough and complete.'
            : 'Extrae CADA hecho importante, concepto, definición, fórmula, fecha, nombre, proceso y detalle de este texto. Lista TODOS, no te pierdas NADA. Sé completo y exhaustivo.'
          },
          { role: 'user', content: textToUse },
        ],
        temperature: 0.1,
        max_tokens: 1500,
      });
      deepContent = r1.choices[0].message.content || '';
    } catch (e) { console.log('gpt-oss-120b flashcards falló:', e); }

    // ===== PASO 2: Kimi-K2 identifica lo técnico/científico =====
    let kimiContent = '';
    try {
      const c2 = getGroqClient();
      const r2 = await c2.chat.completions.create({
        model: 'moonshotai/kimi-k2-instruct',
        messages: [
          { role: 'system', content: lang === 'en'
            ? 'Identify ALL technical terms, formulas, classifications, processes and scientific concepts. List each with a brief explanation.'
            : 'Identifica TODOS los términos técnicos, fórmulas, clasificaciones, procesos y conceptos científicos. Lista cada uno con una breve explicación.'
          },
          { role: 'user', content: textToUse },
        ],
        temperature: 0.1,
        max_tokens: 800,
      });
      kimiContent = r2.choices[0].message.content || '';
    } catch (e) { console.log('kimi flashcards falló:', e); }

    // ===== PASO 3: Llama 3.3 genera flashcards con TODO el conocimiento =====
    const extraInfo = [
      deepContent ? (lang === 'en' ? `COMPLETE CONTENT EXTRACTION:\n${deepContent}` : `EXTRACCIÓN COMPLETA DEL CONTENIDO:\n${deepContent}`) : '',
      kimiContent ? (lang === 'en' ? `TECHNICAL ANALYSIS:\n${kimiContent}` : `ANÁLISIS TÉCNICO:\n${kimiContent}`) : '',
    ].filter(Boolean).join('\n\n---\n\n');

    const systemPrompt = lang === 'en'
      ? `You are an expert flashcard creator. You have deep analysis from 2 specialized AIs that extracted ALL important content. Use it to create ${flashcardCount} flashcards that cover 100% of the information. Vary types: definitions, applications, comparisons, cause-effect, formulas, processes. Respond ONLY with JSON array: [{"question":"","answer":""}]${avoidText}

EXPERT ANALYSIS:
${extraInfo}`
      : `Eres un experto creador de flashcards. Tienes análisis profundo de 2 AIs especializadas que extrajeron TODO el contenido importante. Úsalo para crear ${flashcardCount} flashcards que cubran el 100% de la información. Varía tipos: definiciones, aplicaciones, comparaciones, causa-efecto, fórmulas, procesos. Responde SOLO con array JSON: [{"question":"","answer":""}]${avoidText}

ANÁLISIS EXPERTO:
${extraInfo}`;

    const c3 = getGroqClient();
    const r3 = await c3.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${lang === 'en' ? 'Create' : 'Crea'} ${flashcardCount} flashcards:\n\n${textToUse}` },
      ],
      temperature: 0.4,
      max_tokens: 8000,
    });

    const t3 = r3.choices[0].message.content || '[]';
    const m3 = t3.match(/\[[\s\S]*\]/);
    if (!m3) return NextResponse.json({ success: false, error: 'Could not generate' }, { status: 500 });

    return NextResponse.json({ success: true, flashcards: JSON.parse(m3[0]) });

  } catch (error: any) {
    // Fallback simple
    try {
      const { content, count, idioma } = await request.clone().json();
      const c = getGroqClient();
      const r = await c.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: idioma === 'en' ? `Create ${count || 10} flashcards. JSON: [{"question":"","answer":""}]` : `Crea ${count || 10} flashcards. JSON: [{"question":"","answer":""}]` },
          { role: 'user', content: content?.substring(0, 6000) || '' },
        ],
        temperature: 0.4,
        max_tokens: 8000,
      });
      const t = r.choices[0].message.content || '[]';
      const m = t.match(/\[[\s\S]*\]/);
      return NextResponse.json({ success: true, flashcards: m ? JSON.parse(m[0]) : [] });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
  }
}