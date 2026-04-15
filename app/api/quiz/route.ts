import { NextRequest, NextResponse } from 'next/server';
import { getGroqClient } from '../../../lib/groqClient';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, count = 5, idioma } = body;
    const lang = idioma === 'en' ? 'en' : 'es';
    const textToUse = content.substring(0, 6000);

    // ===== PASO 1: GPT-OSS-120B identifica conceptos clave para preguntar =====
    let keyPoints = '';
    try {
      const c1 = getGroqClient();
      const r1 = await c1.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: lang === 'en'
            ? `Identify the ${count * 2} most important testable concepts from this text. For each, note what would make a good quiz question and common mistakes students make.`
            : `Identifica los ${count * 2} conceptos más importantes evaluables de este texto. Para cada uno, nota qué haría una buena pregunta de quiz y errores comunes de estudiantes.`
          },
          { role: 'user', content: textToUse },
        ],
        temperature: 0.2,
        max_tokens: 800,
      });
      keyPoints = r1.choices[0].message.content || '';
    } catch (e) { console.log('gpt-oss-120b quiz falló:', e); }

    // ===== PASO 2: Kimi-K2 sugiere distractores inteligentes =====
    let distractorInfo = '';
    try {
      const c2 = getGroqClient();
      const r2 = await c2.chat.completions.create({
        model: 'moonshotai/kimi-k2-instruct',
        messages: [
          { role: 'system', content: lang === 'en'
            ? 'Identify common misconceptions, similar-but-wrong concepts, and tricky details from this text that would make excellent wrong options in a quiz.'
            : 'Identifica conceptos erróneos comunes, conceptos similares-pero-incorrectos, y detalles engañosos de este texto que serían excelentes opciones incorrectas en un quiz.'
          },
          { role: 'user', content: textToUse },
        ],
        temperature: 0.2,
        max_tokens: 600,
      });
      distractorInfo = r2.choices[0].message.content || '';
    } catch (e) { console.log('kimi quiz falló:', e); }

    // ===== PASO 3: Llama 3.3 crea el quiz final =====
    const extraContext = [
      keyPoints ? (lang === 'en' ? `KEY TESTABLE CONCEPTS:\n${keyPoints}` : `CONCEPTOS EVALUABLES CLAVE:\n${keyPoints}`) : '',
      distractorInfo ? (lang === 'en' ? `COMMON MISCONCEPTIONS FOR WRONG OPTIONS:\n${distractorInfo}` : `CONCEPTOS ERRÓNEOS PARA OPCIONES INCORRECTAS:\n${distractorInfo}`) : '',
    ].filter(Boolean).join('\n\n---\n\n');

    const systemPrompt = lang === 'en'
      ? `You are an expert quiz creator. You have analysis from 2 specialized AIs about key concepts and common misconceptions. Use it to create ${count} challenging but fair multiple choice questions. Wrong options must be PLAUSIBLE (use the misconceptions). Respond ONLY with JSON:
[{"pregunta":"question","opciones":["correct","wrong1","wrong2","wrong3"],"correcta":0,"explicacion":"why correct"}]
Mix the position of the correct answer randomly (0-3).

EXPERT ANALYSIS:
${extraContext}`
      : `Eres un experto creador de quizzes. Tienes análisis de 2 AIs especializadas sobre conceptos clave y errores comunes. Úsalo para crear ${count} preguntas desafiantes pero justas de opción múltiple. Las opciones incorrectas deben ser PLAUSIBLES (usa los conceptos erróneos). Responde SOLO con JSON:
[{"pregunta":"pregunta","opciones":["correcta","incorrecta1","incorrecta2","incorrecta3"],"correcta":0,"explicacion":"por qué es correcta"}]
Mezcla la posición de la respuesta correcta aleatoriamente (0-3).

ANÁLISIS EXPERTO:
${extraContext}`;

    const c3 = getGroqClient();
    const r3 = await c3.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${lang === 'en' ? 'Create' : 'Crea'} ${count} ${lang === 'en' ? 'questions from' : 'preguntas de'}:\n\n${textToUse}` },
      ],
      temperature: 0.4,
      max_tokens: 3000,
    });

    const t3 = r3.choices[0].message.content || '[]';
    const m3 = t3.match(/\[[\s\S]*\]/);
    const quiz = m3 ? JSON.parse(m3[0]) : [];

    return NextResponse.json({ success: true, quiz });

  } catch (error: any) {
    // Fallback simple
    try {
      const { content, count, idioma } = await request.clone().json();
      const c = getGroqClient();
      const r = await c.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: idioma === 'en'
            ? `Create ${count || 5} quiz questions. JSON: [{"pregunta":"","opciones":["","","",""],"correcta":0,"explicacion":""}]`
            : `Crea ${count || 5} preguntas quiz. JSON: [{"pregunta":"","opciones":["","","",""],"correcta":0,"explicacion":""}]`
          },
          { role: 'user', content: content?.substring(0, 5000) || '' },
        ],
        temperature: 0.4,
        max_tokens: 3000,
      });
      const t = r.choices[0].message.content || '[]';
      const m = t.match(/\[[\s\S]*\]/);
      return NextResponse.json({ success: true, quiz: m ? JSON.parse(m[0]) : [] });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
  }
}