import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

export async function POST(request: NextRequest) {
  try {
    const { content, idioma } = await request.json();
    const lang = idioma === 'en' ? 'en' : 'es';

    const systemPrompt = lang === 'en'
      ? 'You are an assistant that analyzes texts. ONLY use information from the given text. Respond ONLY with a valid JSON in this exact format: {"keywords": ["word1", "word2"], "important_phrases": ["important phrase 1", "important phrase 2"], "summary": "brief summary here"}. No extra text, just the JSON.'
      : 'Eres un asistente que analiza textos. SOLO usa la información del texto dado. Responde ÚNICAMENTE con un JSON válido con este formato exacto: {"keywords": ["palabra1", "palabra2"], "important_phrases": ["frase importante 1", "frase importante 2"], "summary": "resumen breve aqui"}. Sin texto extra, solo el JSON.';

    const userPrompt = lang === 'en'
      ? `Analyze this text and give me the keywords and most important phrases. ONLY use what is in the text:\n\n${content.substring(0, 4000)}`
      : `Analiza este texto y dame las palabras clave y frases más importantes. SOLO usa lo que está en el texto:\n\n${content.substring(0, 4000)}`;

    const completion = await client.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const responseText = completion.choices[0].message.content || '{}';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    return NextResponse.json({ success: true, analysis });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}