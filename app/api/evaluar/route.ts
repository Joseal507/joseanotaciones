import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

export async function POST(request: NextRequest) {
  try {
    const { pregunta, respuestaCorrecta, respuestaUsuario } = await request.json();

    const completion = await client.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'system',
          content: `Eres un evaluador de respuestas educativas. Evalúa la respuesta del usuario comparándola con la respuesta correcta.
          
Responde ÚNICAMENTE con un JSON con este formato exacto:
{
  "nivel": "INSANE" | "correcta" | "medio_correcta" | "incorrecta" | "muy_incorrecta",
  "porcentaje": 0-100,
  "explicacion": "explicación breve de por qué está bien o mal",
  "consejo": "consejo para recordarlo mejor"
}

Niveles:
- INSANE: 95-100% correcto, respuesta perfecta o mejor que la esperada
- correcta: 75-94% correcto, captura la idea principal
- medio_correcta: 50-74% correcto, algo correcto pero falta información
- incorrecta: 20-49% correcto, muy poco correcto
- muy_incorrecta: 0-19% correcto, completamente equivocado`,
        },
        {
          role: 'user',
          content: `Pregunta: ${pregunta}
Respuesta correcta: ${respuestaCorrecta}
Respuesta del usuario: ${respuestaUsuario}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
    });

    const text = completion.choices[0].message.content || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    return NextResponse.json({ success: true, resultado });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}