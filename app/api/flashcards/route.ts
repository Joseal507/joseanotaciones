import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

export async function POST(request: NextRequest) {
  try {
    const { content, count = 8, idioma } = await request.json();
    const lang = idioma === 'en' ? 'en' : 'es';

    if (!content) {
      return NextResponse.json({ success: false, error: 'No content' }, { status: 400 });
    }

    const systemPrompt = lang === 'en'
      ? 'You are an assistant that creates flashcards. ONLY use information from the given text. Do NOT invent anything. Respond ONLY with a valid JSON array in this exact format: [{"question": "question here", "answer": "answer here"}]. No extra text, just the JSON.'
      : 'Eres un asistente que crea flashcards. SOLO usa la información del texto que te dan. NO inventes nada. Responde ÚNICAMENTE con un array JSON válido con este formato exacto: [{"question": "pregunta aqui", "answer": "respuesta aqui"}]. Sin texto extra, solo el JSON.';

    const userPrompt = lang === 'en'
      ? `Create EXACTLY ${count} flashcards based ONLY on this text, do not add information not in it:\n\n${content.substring(0, 6000)}`
      : `Crea EXACTAMENTE ${count} flashcards basadas ÚNICAMENTE en este texto, no agregues información que no esté aquí:\n\n${content.substring(0, 6000)}`;

    const completion = await client.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    });

    const responseText = completion.choices[0].message.content || '[]';
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({ success: false, error: 'Could not generate flashcards' }, { status: 500 });
    }

    const flashcards = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ success: true, flashcards });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}