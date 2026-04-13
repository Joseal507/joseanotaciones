import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

export async function POST(request: NextRequest) {
  try {
    const { content, count = 5 } = await request.json();

    const completion = await client.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'system',
          content: `Eres un creador de quizzes educativos. Crea preguntas de opción múltiple basadas ÚNICAMENTE en el texto dado. 
          
Las opciones incorrectas deben ser plausibles pero claramente incorrectas para alguien que leyó el texto.

Responde ÚNICAMENTE con JSON válido:
[
  {
    "pregunta": "pregunta aquí",
    "opciones": ["opción correcta", "opción incorrecta 1", "opción incorrecta 2", "opción incorrecta 3"],
    "correcta": 0,
    "explicacion": "por qué esta es la respuesta correcta"
  }
]

El índice "correcta" indica qué opción es correcta (0-3). Mezcla el orden de las opciones aleatoriamente.`,
        },
        {
          role: 'user',
          content: `Crea exactamente ${count} preguntas de opción múltiple basadas en este texto:\n\n${content.substring(0, 6000)}`,
        },
      ],
      temperature: 0.4,
      max_tokens: 3000,
    });

    const text = completion.choices[0].message.content || '[]';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const quiz = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    return NextResponse.json({ success: true, quiz });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}