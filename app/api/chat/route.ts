import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mensaje, contexto, historial, perfil, todosDocumentos, idioma, imageBase64, imageMime } = body;
    const lang = idioma === 'en' ? 'en' : 'es';

    // ── SISTEMA DE CACHÉ SIMPLE ──
    const cacheKey = mensaje?.toLowerCase().trim();

    let systemPrompt = '';
    if (contexto) {
      systemPrompt = lang === 'en'
        ? `You are JeffreyBot, an intelligent study assistant and disciple of José Alberto de Obaldia. ONLY respond based on the following document. Do NOT invent information. Always respond in English.\n\nDOCUMENT:\n${contexto.substring(0, 6000)}`
        : `Eres JeffreyBot, un asistente de estudio inteligente y discípulo de José Alberto de Obaldia. SOLO responde basándote en el siguiente documento. NO inventes información. Responde siempre en español.\n\nDOCUMENTO:\n${contexto.substring(0, 6000)}`;
    } else if (todosDocumentos && todosDocumentos.length > 0) {
      const docsTexto = todosDocumentos
        .slice(0, 5)
        .map((d: any) => `[${d.materia} - ${d.nombre}]:\n${d.contenido.substring(0, 1500)}`)
        .join('\n\n---\n\n');
      systemPrompt = lang === 'en'
        ? `You are JeffreyBot, a personal study assistant and disciple of José Alberto de Obaldia. You have access to the student's documents. Always respond in English.\n\nDOCUMENTS:\n${docsTexto}`
        : `Eres JeffreyBot, un asistente de estudio personal y discípulo de José Alberto de Obaldia. Tienes acceso a los documentos del estudiante. Responde siempre en español.\n\nDOCUMENTOS:\n${docsTexto}`;
    } else {
      systemPrompt = lang === 'en'
        ? `You are JeffreyBot, a personal and intelligent study assistant, disciple of José Alberto de Obaldia. Help the student with study questions, explain concepts clearly and give memorization tips. Be concise, friendly and educational. Always respond in English.`
        : `Eres JeffreyBot, un asistente de estudio personal inteligente y amigable, discípulo de José Alberto de Obaldia. Ayuda al estudiante con preguntas de estudio, explica conceptos claramente y da consejos de memorización. Sé conciso, amigable y educativo. Responde siempre en español.`;
    }

    // ── IMAGEN: Visión directa ──
    if (imageBase64 && imageMime) {
      const respuesta = await groqRequest(async (client, model) => {
        const res = await client.chat.completions.create({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            { role: 'system', content: systemPrompt },
            ...(historial || []).slice(-6),
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
                { type: 'text', text: mensaje || (lang === 'en' ? 'Analyze this image in detail.' : 'Analiza esta imagen en detalle.') },
              ],
            },
          ],
          temperature: 0.5,
          max_tokens: 1500,
        });
        return res.choices[0].message.content || '';
      });
      return NextResponse.json({ success: true, respuesta });
    }

    // ── CHAT OPTIMIZADO: 1 SOLA LLAMADA (antes eran 3) ──
    const historialSlice = (historial || []).slice(-8).map((m: any) => ({ role: m.role, content: m.content }));

    const respuesta = await groqRequest(async (client, model) => {
      const res = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          { role: 'system', content: systemPrompt },
          ...historialSlice,
          { role: 'user', content: mensaje },
        ],
        temperature: 0.5,
        max_tokens: 1200,
      });
      return res.choices[0]?.message?.content || '';
    });

    return NextResponse.json({ success: true, respuesta });

  } catch (error: any) {
    console.error('Chat error:', error);
    if (error?.message === 'AI_EXHAUSTED') {
      return NextResponse.json({ success: false, error: 'AI_EXHAUSTED' }, { status: 503 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
