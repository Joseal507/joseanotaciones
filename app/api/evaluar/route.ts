import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pregunta, respuestaCorrecta, respuestaUsuario, idioma } = body;
    const lang = idioma === 'en' ? 'en' : 'es';

    const evalText = lang === 'en'
      ? `Question: ${pregunta}\nCorrect answer: ${respuestaCorrecta}\nStudent's answer: ${respuestaUsuario}`
      : `Pregunta: ${pregunta}\nRespuesta correcta: ${respuestaCorrecta}\nRespuesta del estudiante: ${respuestaUsuario}`;

    const systemPrompt = lang === 'en'
      ? `You are an educational evaluator. Compare the student's answer to the correct answer carefully.
Respond ONLY with valid JSON, no extra text:
{"nivel":"INSANE","porcentaje":98,"explicacion":"clear explanation of what was right/wrong","consejo":"memory tip"}

Levels:
- INSANE = 95-100% (essentially perfect)
- correcta = 75-94% (correct with minor gaps)
- medio_correcta = 50-74% (partially correct)
- incorrecta = 20-49% (mostly wrong)
- muy_incorrecta = 0-19% (completely wrong)`
      : `Eres un evaluador educativo. Compara la respuesta del estudiante con la correcta cuidadosamente.
Responde SOLO con JSON válido, sin texto extra:
{"nivel":"INSANE","porcentaje":98,"explicacion":"explicación clara de qué estuvo bien/mal","consejo":"tip para recordar"}

Niveles:
- INSANE = 95-100% (esencialmente perfecta)
- correcta = 75-94% (correcta con pequeñas omisiones)
- medio_correcta = 50-74% (parcialmente correcta)
- incorrecta = 20-49% (mayormente incorrecta)
- muy_incorrecta = 0-19% (completamente incorrecta)`;

    const resultado = await groqRequest(async (client, model) => {
      const r = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: evalText },
        ],
        temperature: 0.1,
        max_tokens: 300,
      });

      const text = r.choices[0].message.content || '{}';
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) throw new Error('No JSON in response');

      const parsed = JSON.parse(match[0]);

      // Validar que tenga los campos necesarios
      if (!parsed.nivel || parsed.porcentaje === undefined) {
        throw new Error('JSON incompleto');
      }

      return parsed;
    });

    return NextResponse.json({ success: true, resultado });

  } catch (error: any) {
    console.error('evaluar error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
