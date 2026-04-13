import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

export async function POST(request: NextRequest) {
  try {
    const { content, count = 8 } = await request.json();

    if (!content) {
      return NextResponse.json({ success: false, error: 'No hay contenido' }, { status: 400 });
    }

    const completion = await client.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'system',
          content: `Eres un asistente que crea flashcards. SOLO usa la información del texto que te dan. NO inventes nada. Responde ÚNICAMENTE con un array JSON válido con este formato exacto: [{"question": "pregunta aqui", "answer": "respuesta aqui"}]. Sin texto extra, solo el JSON.`,
        },
        {
          role: 'user',
          content: `Crea EXACTAMENTE ${count} flashcards basadas ÚNICAMENTE en este texto, no agregues información que no esté aquí:\n\n${content.substring(0, 6000)}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    });

    const responseText = completion.choices[0].message.content || '[]';
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({ success: false, error: 'No se pudieron generar flashcards' }, { status: 500 });
    }

    const flashcards = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ success: true, flashcards });

  } catch (error: any) {
    console.error('Error flashcards:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}