import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/studyai';

export const maxDuration = 20;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pregunta, respuestaCorrecta, respuestaUsuario, idioma } = body;

    const lang = idioma === 'en' ? 'en' : 'es';

    const systemPrompt =
      lang === 'en'
        ? `You are a friendly and flexible educational evaluator.

PHILOSOPHY:
- Focus on conceptual understanding, not wording.
- Synonyms are valid.
- Paraphrasing is valid.
- Minor grammar mistakes are irrelevant.
- Be generous but honest.

Return ONLY this JSON:
{
  "nivel": "correcta",
  "porcentaje": 85,
  "analisis": "Explain what the student got right or wrong. Speak directly to them.",
  "respuestaCorrecta": "Full correct answer clearly stated.",
  "explicacion": "Explain WHY this is correct. Teach the concept clearly.",
  "consejo": "Short memory tip."
}

Levels:
INSANE=95-100
correcta=75-94
medio_correcta=50-74
incorrecta=20-49
muy_incorrecta=0-19`
        : `Eres un evaluador educativo amigable y flexible.

FILOSOFÍA:
- Evalúa comprensión conceptual, no palabras exactas.
- Sinónimos son válidos.
- Paráfrasis son válidas.
- Errores gramaticales menores no importan.
- Sé generoso pero honesto.

Devuelve SOLO este JSON:
{
  "nivel": "correcta",
  "porcentaje": 85,
  "analisis": "Explica qué hizo bien o mal el estudiante. Háblale directamente.",
  "respuestaCorrecta": "Respuesta correcta completa y clara.",
  "explicacion": "Explica POR QUÉ es correcta. Enseña el concepto.",
  "consejo": "Tip corto para recordar."
}

Niveles:
INSANE=95-100
correcta=75-94
medio_correcta=50-74
incorrecta=20-49
muy_incorrecta=0-19`;

    const userMsg =
      lang === 'en'
        ? `Question: ${pregunta}
Correct answer: ${respuestaCorrecta}
Student answer: ${respuestaUsuario}`
        : `Pregunta: ${pregunta}
Respuesta correcta: ${respuestaCorrecta}
Respuesta del estudiante: ${respuestaUsuario}`;

    const resultado = await groqRequest(async (client, model) => {
      const r = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.3,
        max_tokens: 700,
      });

      const text = r.choices[0]?.message?.content || '';

      let parsed: any = null;
      try { parsed = JSON.parse(text.trim()); } catch {}
      if (!parsed) {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          try { parsed = JSON.parse(match[0]); } catch {}
        }
      }

      if (!parsed?.nivel) {
        return {
          nivel: 'medio_correcta',
          porcentaje: 60,
          analisis: '',
          respuestaCorrecta,
          explicacion: respuestaCorrecta,
          consejo: ''
        };
      }

      return parsed;
    });

    return NextResponse.json({ success: true, resultado });

  } catch (error: any) {
    console.error('evaluar error:', error.message);
    return NextResponse.json({
      success: true,
      resultado: {
        nivel: 'medio_correcta',
        porcentaje: 60,
        analisis: '',
        respuestaCorrecta: '',
        explicacion: '',
        consejo: ''
      }
    });
  }
}
