import { NextRequest, NextResponse } from 'next/server';
import { getGroqClient } from '../../../lib/groqClient';

export async function POST(request: NextRequest) {
  try {
    const { pregunta, respuestaCorrecta, respuestaUsuario, idioma } = await request.json();
    const lang = idioma === 'en' ? 'en' : 'es';
    const client = getGroqClient();

    const systemPrompt = lang === 'en'
      ? `You are an educational response evaluator. Evaluate the user's response comparing it to the correct answer. Respond ONLY with a JSON in this exact format:
{
  "nivel": "INSANE" | "correcta" | "medio_correcta" | "incorrecta" | "muy_incorrecta",
  "porcentaje": 0-100,
  "explicacion": "brief explanation of why it is right or wrong",
  "consejo": "tip to remember it better"
}
Levels:
- INSANE: 95-100% correct, perfect answer
- correcta: 75-94% correct, captures the main idea
- medio_correcta: 50-74% correct, something correct but missing info
- incorrecta: 20-49% correct, very little correct
- muy_incorrecta: 0-19% correct, completely wrong`
      : `Eres un evaluador de respuestas educativas. Evalúa la respuesta del usuario comparándola con la respuesta correcta. Responde ÚNICAMENTE con un JSON con este formato exacto:
{
  "nivel": "INSANE" | "correcta" | "medio_correcta" | "incorrecta" | "muy_incorrecta",
  "porcentaje": 0-100,
  "explicacion": "explicación breve de por qué está bien o mal",
  "consejo": "consejo para recordarlo mejor"
}`;

    const userPrompt = lang === 'en'
      ? `Question: ${pregunta}\nCorrect answer: ${respuestaCorrecta}\nUser's answer: ${respuestaUsuario}`
      : `Pregunta: ${pregunta}\nRespuesta correcta: ${respuestaCorrecta}\nRespuesta del usuario: ${respuestaUsuario}`;

    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
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