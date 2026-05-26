import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/studyai';

export const maxDuration = 20;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pregunta, respuestaCorrecta, respuestaUsuario } = body;

    const answer = String(respuestaUsuario || '').trim().toLowerCase();

    if (!answer || ['nose', 'no se', 'no sé', 'idk', 'xd', 'aw', 'nose aw'].includes(answer)) {
      return NextResponse.json({
        success: true,
        resultado: {
          nivel: 'incorrecta',
          porcentaje: 5,
          analisis: 'Tu respuesta no muestra comprensión del tema.',
          respuestaCorrecta,
          explicacion: respuestaCorrecta,
          consejo: 'Intenta explicar la idea principal con tus palabras.'
        }
      });
    }

    const systemPrompt = `
Eres un profesor estricto pero justo.

NO regales 60%.
Si la respuesta no tiene contenido conceptual real, debe ser incorrecta.

Escala:
95-100 excelente
75-94 correcta
50-74 medio_correcta SOLO si hay comprensión parcial real
20-49 incorrecta pero relacionada
0-19 basura o sin sentido

Devuelve SOLO JSON:
{
"nivel":"correcta|medio_correcta|incorrecta|muy_incorrecta|INSANE",
"porcentaje":0,
"analisis":"",
"respuestaCorrecta":"",
"explicacion":"",
"consejo":""
}
`;

    const resultado = await groqRequest(async (client, model) => {
      const r = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Pregunta: ${pregunta}
Respuesta correcta: ${respuestaCorrecta}
Respuesta del estudiante: ${respuestaUsuario}`
          },
        ],
        temperature: 0.15,
        max_tokens: 650,
      });

      const text = r.choices[0]?.message?.content || '{}';
      const match = text.match(/\{[\s\S]*\}/);
      return JSON.parse(match ? match[0] : text);
    });

    return NextResponse.json({ success: true, resultado });
  } catch {
    return NextResponse.json({
      success: true,
      resultado: {
        nivel: 'incorrecta',
        porcentaje: 10,
        analisis: 'No se pudo evaluar bien la respuesta.',
        respuestaCorrecta: '',
        explicacion: '',
        consejo: ''
      }
    });
  }
}
