import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

export async function POST(request: NextRequest) {
  try {
    const { mensaje, contexto, historial, perfil, todosDocumentos, idioma } = await request.json();
    const lang = idioma === 'en' ? 'en' : 'es';
    const langInstruction = lang === 'en'
      ? 'Always respond in English.'
      : 'Responde siempre en español.';

    let systemPrompt = '';

    if (contexto) {
      systemPrompt = lang === 'en'
        ? `You are AlciBot, an intelligent study assistant. ONLY respond based on the following document. Do NOT invent information not in the document. ${langInstruction}\n\nDOCUMENT:\n${contexto.substring(0, 6000)}`
        : `Eres AlciBot, un asistente de estudio inteligente. SOLO responde basándote en el siguiente documento. NO inventes información que no esté en el documento. ${langInstruction}\n\nDOCUMENTO:\n${contexto.substring(0, 6000)}`;
    } else if (todosDocumentos && todosDocumentos.length > 0) {
      const docsTexto = todosDocumentos
        .slice(0, 5)
        .map((d: any) => `[${d.materia} - ${d.nombre}]:\n${d.contenido.substring(0, 1500)}`)
        .join('\n\n---\n\n');

      const materiaDificil = Object.entries(perfil?.materiasStats || {})
        .sort((a: any, b: any) => (b[1].falladas / (b[1].totalFlashcards || 1)) - (a[1].falladas / (a[1].totalFlashcards || 1)))
        .slice(0, 3).map((e: any) => e[1].nombre).join(', ') || (lang === 'en' ? 'No data' : 'Sin datos');

      systemPrompt = lang === 'en'
        ? `You are AlciBot, a personal and intelligent study assistant. You have access to the student's notes and documents. Respond based on them when relevant. ${langInstruction}\n\nSTUDENT DOCUMENTS:\n${docsTexto}\n\nHARDEST SUBJECTS: ${materiaDificil}`
        : `Eres AlciBot, un asistente de estudio personal e inteligente. Tienes acceso a los apuntes y documentos del estudiante. ${langInstruction}\n\nDOCUMENTOS:\n${docsTexto}\n\nMATERIAS DIFÍCILES: ${materiaDificil}`;
    } else {
      systemPrompt = lang === 'en'
        ? `You are AlciBot, a personal and intelligent study assistant. Help the student with study questions, explain concepts, give memorization tips and study techniques. ${langInstruction}`
        : `Eres AlciBot, un asistente de estudio personal inteligente y amigable. Ayuda al estudiante con preguntas de estudio, explica conceptos, da consejos de memorización y técnicas de estudio. ${langInstruction}`;
    }

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...(historial || []).slice(-10),
      { role: 'user', content: mensaje },
    ];

    const completion = await client.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages,
      temperature: 0.5,
      max_tokens: 1200,
    });

    const respuesta = completion.choices[0].message.content || '';
    return NextResponse.json({ success: true, respuesta });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}