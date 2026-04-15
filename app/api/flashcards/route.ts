import { NextRequest, NextResponse } from 'next/server';
import { getGroqClient } from '../../../lib/groqClient';

export async function POST(request: NextRequest) {
  try {
    const { content, count, idioma, getRecommendation, existingQuestions, imageBase64, imageMime } = await request.json();
    const lang = idioma === 'en' ? 'en' : 'es';
    const client = getGroqClient();

    if (!content) {
      return NextResponse.json({ success: false, error: 'No content' }, { status: 400 });
    }

    // ===== RECOMENDACIÓN =====
    if (getRecommendation) {
      const wordCount = content.split(' ').length;
      const estimated = Math.max(5, Math.min(150, Math.round(wordCount / 50)));

      const systemPrompt = lang === 'en'
        ? `You are a study expert. Determine EXACTLY how many flashcards are needed to cover 100% of the important information. Respond ONLY with valid JSON: {"recommended": number, "reason": "brief explanation"}`
        : `Eres un experto en estudio. Determina EXACTAMENTE cuántas flashcards se necesitan para cubrir el 100% de la información importante. Responde SOLO con JSON válido: {"recommended": number, "reason": "explicación breve"}`;

      const completion = await client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: lang === 'en'
              ? `How many flashcards for this text? Estimate: ${estimated}.\n\nTEXT (${wordCount} words):\n${content.substring(0, 4000)}`
              : `¿Cuántas flashcards para este texto? Estimado: ${estimated}.\n\nTEXTO (${wordCount} palabras):\n${content.substring(0, 4000)}`,
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
        reason: lang === 'en' ? `Estimated based on ${wordCount} words` : `Estimado basado en ${wordCount} palabras`,
      });
    }

    // ===== GENERACIÓN =====
    const flashcardCount = count || 10;
    const hasExisting = existingQuestions && existingQuestions.length > 0;
    const existingList = hasExisting ? existingQuestions.slice(0, 50).join('\n- ') : null;

    const avoidInstruction = hasExisting
      ? (lang === 'en'
        ? `\n\nIMPORTANT: Do NOT repeat or create similar questions to these:\n- ${existingList}\n\nCreate questions about DIFFERENT aspects not yet covered.`
        : `\n\nIMPORTANTE: NO repitas ni crees preguntas similares a estas:\n- ${existingList}\n\nCrea preguntas sobre DIFERENTES aspectos aún no cubiertos.`)
      : '';

    const systemPrompt = lang === 'en'
      ? `You are an expert flashcard creator with deep reasoning. ONLY use information from the given text. Do NOT invent anything. Create EXACTLY ${flashcardCount} high-quality flashcards. Make questions varied: definitions, applications, comparisons, cause-effect. Respond ONLY with valid JSON array: [{"question": "question here", "answer": "answer here"}]. No extra text.`
      : `Eres un experto creador de flashcards con razonamiento profundo. SOLO usa información del texto dado. NO inventes nada. Crea EXACTAMENTE ${flashcardCount} flashcards de alta calidad. Varía las preguntas: definiciones, aplicaciones, comparaciones, causa-efecto. Responde ÚNICAMENTE con array JSON válido: [{"question": "pregunta aqui", "answer": "respuesta aqui"}]. Sin texto extra.`;

    const userPrompt = lang === 'en'
      ? `Create EXACTLY ${flashcardCount} NEW and UNIQUE flashcards from this text.${avoidInstruction}\n\nTEXT:\n${content.substring(0, 8000)}`
      : `Crea EXACTAMENTE ${flashcardCount} flashcards NUEVAS y ÚNICAS de este texto.${avoidInstruction}\n\nTEXTO:\n${content.substring(0, 8000)}`;

    // Si hay imagen usar modelo vision
    let messages: any[];
    let model: string;

    if (imageBase64 && imageMime) {
      const visionClient = getGroqClient();
      messages = [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
            { type: 'text', text: systemPrompt + '\n\n' + userPrompt },
          ],
        },
      ];
      model = 'meta-llama/llama-4-scout-17b-16e-instruct';
      const completion = await visionClient.chat.completions.create({ model, messages, temperature: 0.4, max_tokens: 8000 });
      const responseText = completion.choices[0].message.content || '[]';
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return NextResponse.json({ success: false, error: 'Could not generate flashcards' }, { status: 500 });
      const flashcards = JSON.parse(jsonMatch[0]);
      return NextResponse.json({ success: true, flashcards });
    }

    messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    model = 'llama-3.3-70b-versatile';

    const completion = await client.chat.completions.create({ model, messages, temperature: 0.4, max_tokens: 8000 });
    const responseText = completion.choices[0].message.content || '[]';
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return NextResponse.json({ success: false, error: 'Could not generate flashcards' }, { status: 500 });
    const flashcards = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ success: true, flashcards });

  } catch (error: any) {
    console.error('Error flashcards:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}