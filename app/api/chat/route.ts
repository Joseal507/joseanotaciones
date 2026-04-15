import { NextRequest, NextResponse } from 'next/server';
import { getGroqClient } from '../../../lib/groqClient';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mensaje, contexto, historial, perfil, todosDocumentos, idioma, imageBase64, imageMime } = body;
    const lang = idioma === 'en' ? 'en' : 'es';

    let systemPrompt = '';
    if (contexto) {
      systemPrompt = lang === 'en'
        ? `You are JeffreyBot, an intelligent study assistant and disciple of José Alberto de Obaldia. ONLY respond based on the following document. Do NOT invent information. Always respond in English.\n\nDOCUMENT:\n${contexto.substring(0, 6000)}`
        : `Eres JeffreyBot, un asistente de estudio inteligente y discípulo de José Alberto de Obaldia. SOLO responde basándote en el siguiente documento. NO inventes información. Responde siempre en español.\n\nDOCUMENTO:\n${contexto.substring(0, 6000)}`;
    } else if (todosDocumentos && todosDocumentos.length > 0) {
      const docsTexto = todosDocumentos
        .slice(0, 5)
        .map((d: any) => `[${d.materia} - ${d.nombre}]:\n${d.contenido.substring(0, 1500)}`)
        .join('\n\n---\n\n');
      systemPrompt = lang === 'en'
        ? `You are JeffreyBot, a personal study assistant and disciple of José Alberto de Obaldia. You have access to the student's documents. Always respond in English.\n\nDOCUMENTS:\n${docsTexto}`
        : `Eres JeffreyBot, un asistente de estudio personal y discípulo de José Alberto de Obaldia. Tienes acceso a los documentos del estudiante. Responde siempre en español.\n\nDOCUMENTOS:\n${docsTexto}`;
    } else {
      systemPrompt = lang === 'en'
        ? `You are JeffreyBot, a personal and intelligent study assistant, disciple of José Alberto de Obaldia. Help the student with study questions, explain concepts, give memorization tips. Always respond in English.`
        : `Eres JeffreyBot, un asistente de estudio personal inteligente y amigable, discípulo de José Alberto de Obaldia. Ayuda al estudiante con preguntas de estudio, explica conceptos, da consejos. Responde siempre en español.`;
    }

    // ✅ IMAGEN: solo vision, sin dual
    if (imageBase64 && imageMime) {
      const client = getGroqClient();
      const visionMessages: any[] = [
        { role: 'system', content: systemPrompt },
        ...(historial || []).slice(-6),
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
            { type: 'text', text: mensaje || (lang === 'en' ? 'Analyze this image in detail.' : 'Analiza esta imagen en detalle.') },
          ],
        },
      ];
      const visionRes = await client.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: visionMessages,
        temperature: 0.5,
        max_tokens: 1500,
      });
      return NextResponse.json({ success: true, respuesta: visionRes.choices[0].message.content || '' });
    }

    const historialSlice = (historial || []).slice(-4).map((m: any) => ({ role: m.role, content: m.content }));

    // ===== PASO 1: GPT-OSS-120B razona profundo =====
    let analisis120b = '';
    try {
      const client1 = getGroqClient();
      const res1 = await client1.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: [
          {
            role: 'system',
            content: lang === 'en'
              ? 'You are a deep reasoning engine. Analyze the question thoroughly. Give key insights, concepts and structured analysis. Be precise. Do NOT write the final answer, only your reasoning.'
              : 'Eres un motor de razonamiento profundo. Analiza la pregunta a fondo. Da puntos clave, conceptos importantes y análisis estructurado. Sé preciso. NO escribas la respuesta final, solo tu razonamiento.',
          },
          ...historialSlice,
          { role: 'user', content: mensaje },
        ],
        temperature: 0.2,
        max_tokens: 800,
      });
      analisis120b = res1.choices[0].message.content || '';
    } catch (e) {
      console.log('gpt-oss-120b falló, continuando...');
    }

    // ===== PASO 2: Kimi-K2 analiza desde perspectiva científica =====
    let analisisKimi = '';
    try {
      const client2 = getGroqClient();
      const res2 = await client2.chat.completions.create({
        model: 'moonshotai/kimi-k2-instruct',
        messages: [
          {
            role: 'system',
            content: lang === 'en'
              ? 'You are a scientific and mathematical analysis expert. Identify the core concepts, formulas, relationships and practical applications of this question. Be concise and structured.'
              : 'Eres un experto en análisis científico y matemático. Identifica los conceptos clave, fórmulas, relaciones y aplicaciones prácticas de esta pregunta. Sé conciso y estructurado.',
          },
          ...historialSlice,
          { role: 'user', content: mensaje },
        ],
        temperature: 0.2,
        max_tokens: 600,
      });
      analisisKimi = res2.choices[0].message.content || '';
    } catch (e) {
      console.log('kimi-k2 falló, continuando...');
    }

    // ===== PASO 3: Llama 3.3 70B da la respuesta final =====
    const contextoCombinado = [
      analisis120b ? (lang === 'en' ? `DEEP REASONING:\n${analisis120b}` : `RAZONAMIENTO PROFUNDO:\n${analisis120b}`) : '',
      analisisKimi ? (lang === 'en' ? `SCIENTIFIC ANALYSIS:\n${analisisKimi}` : `ANÁLISIS CIENTÍFICO:\n${analisisKimi}`) : '',
    ].filter(Boolean).join('\n\n---\n\n');

    const finalSystem = contextoCombinado
      ? `${systemPrompt}\n\n${lang === 'en'
          ? `You have expert analysis from 2 specialized AIs. Use it to give the BEST, clearest and most educational answer possible. Structure it well.\n\n${contextoCombinado}`
          : `Tienes el análisis experto de 2 AIs especializadas. Úsalo para dar la MEJOR respuesta posible, clara y educativa. Estrúcturala bien.\n\n${contextoCombinado}`}`
      : systemPrompt;

    const client3 = getGroqClient();
    const finalRes = await client3.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: finalSystem },
        ...(historial || []).slice(-8).map((m: any) => ({ role: m.role, content: m.content })),
        { role: 'user', content: mensaje },
      ],
      temperature: 0.5,
      max_tokens: 1200,
    });

    const respuesta = finalRes.choices[0].message.content || '';
    return NextResponse.json({ success: true, respuesta });

  } catch (error: any) {
    console.error('Chat error:', error);
    try {
      const client = getGroqClient();
      const { mensaje, historial, idioma } = await request.clone().json();
      const lang = idioma === 'en' ? 'en' : 'es';
      const res = await client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: lang === 'en' ? 'You are JeffreyBot, disciple of José Alberto de Obaldia, a helpful study assistant. Respond in English.' : 'Eres JeffreyBot, discípulo de José Alberto de Obaldia, un asistente de estudio. Responde en español.' },
          ...(historial || []).slice(-8),
          { role: 'user', content: mensaje },
        ],
        temperature: 0.5,
        max_tokens: 1200,
      });
      return NextResponse.json({ success: true, respuesta: res.choices[0].message.content || '' });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
  }
}