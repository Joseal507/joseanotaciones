import { NextRequest, NextResponse } from 'next/server';
import { getGroqClient } from '../../../lib/groqClient';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pregunta, respuestaCorrecta, respuestaUsuario, idioma } = body;
    const lang = idioma === 'en' ? 'en' : 'es';

    const evalText = lang === 'en'
      ? `Question: ${pregunta}\nCorrect answer: ${respuestaCorrecta}\nStudent's answer: ${respuestaUsuario}`
      : `Pregunta: ${pregunta}\nRespuesta correcta: ${respuestaCorrecta}\nRespuesta del estudiante: ${respuestaUsuario}`;

    // ===== PASO 1: GPT-OSS-120B analiza la respuesta profundamente =====
    let deepEval = '';
    try {
      const c1 = getGroqClient();
      const r1 = await c1.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: lang === 'en'
            ? 'Compare the student answer to the correct answer. Identify: what is correct, what is wrong, what is missing, what is extra. Be precise.'
            : 'Compara la respuesta del estudiante con la correcta. Identifica: qué es correcto, qué está mal, qué falta, qué sobra. Sé preciso.'
          },
          { role: 'user', content: evalText },
        ],
        temperature: 0.1,
        max_tokens: 500,
      });
      deepEval = r1.choices[0].message.content || '';
    } catch (e) { console.log('gpt-oss-120b eval falló:', e); }

    // ===== PASO 2: Llama 3.3 da la evaluación final =====
    const systemPrompt = lang === 'en'
      ? `You are an educational evaluator. You have expert analysis comparing the answers. Use it for the most accurate evaluation. Respond ONLY with JSON:
{"nivel":"INSANE"|"correcta"|"medio_correcta"|"incorrecta"|"muy_incorrecta","porcentaje":0-100,"explicacion":"clear explanation","consejo":"memory tip"}
Levels: INSANE=95-100%, correcta=75-94%, medio_correcta=50-74%, incorrecta=20-49%, muy_incorrecta=0-19%

EXPERT ANALYSIS:
${deepEval}`
      : `Eres un evaluador educativo. Tienes análisis experto comparando las respuestas. Úsalo para la evaluación más precisa. Responde SOLO con JSON:
{"nivel":"INSANE"|"correcta"|"medio_correcta"|"incorrecta"|"muy_incorrecta","porcentaje":0-100,"explicacion":"explicación clara","consejo":"tip para recordar"}
Niveles: INSANE=95-100%, correcta=75-94%, medio_correcta=50-74%, incorrecta=20-49%, muy_incorrecta=0-19%

ANÁLISIS EXPERTO:
${deepEval}`;

    const c2 = getGroqClient();
    const r2 = await c2.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: evalText },
      ],
      temperature: 0.2,
      max_tokens: 500,
    });

    const t2 = r2.choices[0].message.content || '{}';
    const m2 = t2.match(/\{[\s\S]*\}/);
    const resultado = m2 ? JSON.parse(m2[0]) : {};

    return NextResponse.json({ success: true, resultado });

  } catch (error: any) {
    // Fallback simple
    try {
      const { pregunta, respuestaCorrecta, respuestaUsuario, idioma } = await request.clone().json();
      const c = getGroqClient();
      const r = await c.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: idioma === 'en'
            ? 'Evaluate. JSON: {"nivel":"correcta","porcentaje":50,"explicacion":"","consejo":""}'
            : 'Evalúa. JSON: {"nivel":"correcta","porcentaje":50,"explicacion":"","consejo":""}'
          },
          { role: 'user', content: `Q: ${pregunta}\nCorrect: ${respuestaCorrecta}\nStudent: ${respuestaUsuario}` },
        ],
        temperature: 0.2,
        max_tokens: 500,
      });
      const t = r.choices[0].message.content || '{}';
      const m = t.match(/\{[\s\S]*\}/);
      return NextResponse.json({ success: true, resultado: m ? JSON.parse(m[0]) : {} });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
  }
}