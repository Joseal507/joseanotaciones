import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

export async function POST(request: NextRequest) {
  try {
    const { pregunta, respuestaCorrecta, respuestaUsuario, idioma } = await request.json();
    const lang = idioma === 'en' ? 'en' : 'es';

    const systemPrompt = lang === 'en'
      ? `You are an educational response evaluator. Evaluate the user's response comparing it to the correct answer. Respond ONLY with a JSON in this exact format:\n{\n  "nivel": "INSANE" | "correcta" | "medio_correcta" | "incorrecta" | "muy_incorrecta",\n  "porcentaje": 0-100,\n  "explicacion": "brief explanation of why it is right or wrong",\n  "consejo": "tip to remember it better"\n}\nLevels:\n- INSANE: 95-100% correct, perfect or better than expected answer\n- correcta: 75-94% correct, captures the main idea\n- medio_correcta: 50-74% correct, something correct but missing info\n- incorrecta: 20-49% correct, very little correct\n- muy_incorrecta: 0-19% correct, completely wrong`
      : `Eres un evaluador de respuestas educativas. Evalúa la respuesta del usuario comparándola con la respuesta correcta. Responde ÚNICAMENTE con un JSON con este formato exacto:\n{\n  "nivel": "INSANE" | "correcta" | "medio_correcta" | "incorrecta" | "muy_incorrecta",\n  "porcentaje": 0-100,\n  "explicacion": "explicación breve de por qué está bien o mal",\n  "consejo": "consejo para recordarlo mejor"\n}`;

    const userPrompt = lang === 'en'
      ? `Question: ${pregunta}\nCorrect answer: ${respuestaCorrecta}\nUser's answer: ${respuestaUsuario}`
      : `Pregunta: ${pregunta}\nRespuesta correcta: ${respuestaCorrecta}\nRespuesta del usuario: ${respuestaUsuario}`;

    const completion = await client.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
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