import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';

export const maxDuration = 15;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pregunta, respuestaCorrecta, respuestaUsuario, idioma } = body;
    const lang = idioma === 'en' ? 'en' : 'es';

    if (!respuestaUsuario?.trim()) {
      return NextResponse.json({
        success: true,
        resultado: { nivel: 'muy_incorrecta', porcentaje: 0, explicacion: lang === 'en' ? 'No answer provided.' : 'No se proporcionó respuesta.', consejo: '' },
      });
    }

    const systemPrompt = lang === 'en'
      ? `Educational evaluator. Compare student answer to correct answer. Be fair and constructive.
Return ONLY this JSON (no extra text):
{"nivel":"correcta","porcentaje":85,"explicacion":"what was right/wrong","consejo":"memory tip"}

Levels: INSANE=95-100, correcta=75-94, medio_correcta=50-74, incorrecta=20-49, muy_incorrecta=0-19`
      : `Evaluador educativo. Compara la respuesta del estudiante con la correcta. Se justo y constructivo.
Devuelve SOLO este JSON (sin texto extra):
{"nivel":"correcta","porcentaje":85,"explicacion":"que estuvo bien/mal","consejo":"tip para recordar"}

Niveles: INSANE=95-100, correcta=75-94, medio_correcta=50-74, incorrecta=20-49, muy_incorrecta=0-19`;

    const userMsg = lang === 'en'
      ? `Question: ${pregunta}\nCorrect: ${respuestaCorrecta}\nStudent: ${respuestaUsuario}`
      : `Pregunta: ${pregunta}\nCorrecta: ${respuestaCorrecta}\nEstudiante: ${respuestaUsuario}`;

    const resultado = await groqRequest(async (client, model) => {
      const r = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.1,
        max_tokens: 250,
      });

      const text = r.choices[0]?.message?.content || '';

      // Parser robusto: intenta JSON directo, luego extrae
      let parsed: any = null;
      try { parsed = JSON.parse(text.trim()); } catch {}
      if (!parsed) {
        const match = text.match(/\{[^{}]*\}/);
        if (match) { try { parsed = JSON.parse(match[0]); } catch {} }
      }

      if (!parsed?.nivel) {
        // Fallback: inferir del porcentaje o texto
        const pctMatch = text.match(/(\d+)/);
        const pct = pctMatch ? parseInt(pctMatch[1]) : 50;
        return {
          nivel: pct >= 75 ? 'correcta' : pct >= 50 ? 'medio_correcta' : 'incorrecta',
          porcentaje: pct,
          explicacion: lang === 'en' ? 'Your answer was evaluated.' : 'Tu respuesta fue evaluada.',
          consejo: '',
        };
      }

      return parsed;
    });

    return NextResponse.json({ success: true, resultado });

  } catch (error: any) {
    console.error('evaluar error:', error.message);
    // Nunca romper el modo estudio — devolver resultado neutral
    return NextResponse.json({
      success: true,
      resultado: {
        nivel: 'medio_correcta',
        porcentaje: 60,
        explicacion: 'No se pudo evaluar en este momento. Revisa la respuesta correcta.',
        consejo: '',
      },
    });
  }
}
