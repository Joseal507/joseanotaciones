import { NextRequest, NextResponse } from 'next/server';
import { getGroqClient } from '../../../lib/groqClient';

export async function POST(request: NextRequest) {
  try {
    const { content, count = 5, idioma } = await request.json();
    const lang = idioma === 'en' ? 'en' : 'es';
    const client = getGroqClient();

    const systemPrompt = lang === 'en'
      ? `You are an educational quiz creator. Create multiple choice questions based ONLY on the given text. Wrong options should be plausible but clearly incorrect. Respond ONLY with valid JSON:
[
  {
    "pregunta": "question here",
    "opciones": ["correct option", "wrong option 1", "wrong option 2", "wrong option 3"],
    "correcta": 0,
    "explicacion": "why this is the correct answer"
  }
]
The "correcta" index indicates which option is correct (0-3). Mix the order randomly.`
      : `Eres un creador de quizzes educativos. Crea preguntas de opción múltiple basadas ÚNICAMENTE en el texto dado. Las opciones incorrectas deben ser plausibles pero claramente incorrectas. Responde ÚNICAMENTE con JSON válido:
[
  {
    "pregunta": "pregunta aquí",
    "opciones": ["opción correcta", "opción incorrecta 1", "opción incorrecta 2", "opción incorrecta 3"],
    "correcta": 0,
    "explicacion": "por qué esta es la respuesta correcta"
  }
]`;

    const userPrompt = lang === 'en'
      ? `Create exactly ${count} multiple choice questions based on this text:\n\n${content.substring(0, 6000)}`
      : `Crea exactamente ${count} preguntas de opción múltiple basadas en este texto:\n\n${content.substring(0, 6000)}`;

    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
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