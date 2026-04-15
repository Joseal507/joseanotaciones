import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

export async function POST(request: NextRequest) {
  try {
    const { content, count, idioma, getRecommendation, existingQuestions } = await request.json();
    const lang = idioma === 'en' ? 'en' : 'es';

    if (!content) {
      return NextResponse.json({ success: false, error: 'No content' }, { status: 400 });
    }

    // ===== MODO RECOMENDACIÓN =====
    if (getRecommendation) {
      const wordCount = content.split(' ').length;
      const estimated = Math.max(5, Math.min(150, Math.round(wordCount / 50)));

      const systemPrompt = lang === 'en'
        ? `You are a study expert. Analyze the text and determine EXACTLY how many flashcards are needed to cover 100% of the important information. Consider: concepts, definitions, dates, processes, examples, relationships. Respond ONLY with valid JSON: {"recommended": number, "reason": "brief explanation in English"}`
        : `Eres un experto en estudio. Analiza el texto y determina EXACTAMENTE cuántas flashcards se necesitan para cubrir el 100% de la información importante. Considera: conceptos, definiciones, fechas, procesos, ejemplos, relaciones. Responde SOLO con JSON válido: {"recommended": number, "reason": "explicación breve en español"}`;

      const completion = await client.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: lang === 'en'
              ? `How many flashcards to cover 100% of this text? Estimate: ${estimated}.\n\nTEXT (${wordCount} words):\n${content.substring(0, 4000)}`
              : `¿Cuántas flashcards para cubrir el 100% de este texto? Estimado: ${estimated}.\n\nTEXTO (${wordCount} palabras):\n${content.substring(0, 4000)}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 300,
      });

      const text = completion.choices[0].message.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return NextResponse.json({
          success: true,
          recommended: Math.max(5, Math.min(150, result.recommended || estimated)),
          reason: result.reason || '',
        });
      }

      return NextResponse.json({
        success: true,
        recommended: estimated,
        reason: lang === 'en'
          ? `Estimated based on ${wordCount} words`
          : `Estimado basado en ${wordCount} palabras`,
      });
    }

    // ===== MODO GENERACIÓN =====
    const flashcardCount = count || 10;

    // Si hay preguntas existentes, incluirlas para evitar repetición
    const hasExisting = existingQuestions && existingQuestions.length > 0;
    const existingList = hasExisting
      ? existingQuestions.slice(0, 50).join('\n- ')
      : null;

    const avoidInstruction = hasExisting
      ? (lang === 'en'
          ? `\n\nIMPORTANT: These questions already exist. Do NOT repeat or create similar ones:\n- ${existingList}\n\nCreate questions about DIFFERENT aspects, details, examples or concepts not yet covered.`
          : `\n\nIMPORTANTE: Estas preguntas ya existen. NO las repitas ni crees preguntas similares:\n- ${existingList}\n\nCrea preguntas sobre DIFERENTES aspectos, detalles, ejemplos o conceptos aún no cubiertos.`)
      : '';

    const systemPrompt = lang === 'en'
      ? `You are an assistant that creates flashcards. ONLY use information from the given text. Do NOT invent anything. Create EXACTLY ${flashcardCount} flashcards covering important concepts. Each flashcard must have a clear question and a concise answer. Make sure all questions are unique and cover different aspects. Respond ONLY with a valid JSON array: [{"question": "question here", "answer": "answer here"}]. No extra text.`
      : `Eres un asistente que crea flashcards. SOLO usa información del texto dado. NO inventes nada. Crea EXACTAMENTE ${flashcardCount} flashcards cubriendo conceptos importantes. Cada flashcard debe tener una pregunta clara y una respuesta concisa. Asegúrate de que todas las preguntas sean únicas y cubran diferentes aspectos. Responde ÚNICAMENTE con un array JSON válido: [{"question": "pregunta aqui", "answer": "respuesta aqui"}]. Sin texto extra.`;

    const userPrompt = lang === 'en'
      ? `Create EXACTLY ${flashcardCount} NEW and UNIQUE flashcards from this text. Each must cover a different concept.${avoidInstruction}\n\nTEXT:\n${content.substring(0, 8000)}`
      : `Crea EXACTAMENTE ${flashcardCount} flashcards NUEVAS y ÚNICAS de este texto. Cada una debe cubrir un concepto diferente.${avoidInstruction}\n\nTEXTO:\n${content.substring(0, 8000)}`;

    const completion = await client.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 8000,
    });

    const responseText = completion.choices[0].message.content || '[]';
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      return NextResponse.json({ success: false, error: 'Could not generate flashcards' }, { status: 500 });
    }

    const flashcards = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ success: true, flashcards });

  } catch (error: any) {
    console.error('Error flashcards:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}