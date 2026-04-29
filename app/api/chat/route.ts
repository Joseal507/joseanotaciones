import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mensaje, contexto, historial, todosDocumentos, idioma, imageBase64, imageMime, nombreUsuario, enLlamada } = body;
    const lang = idioma === 'en' ? 'en' : 'es';

    // Extras según contexto
    const nombrePart = nombreUsuario
      ? (lang === 'en'
          ? ` You are talking to ${nombreUsuario}. Use their name naturally and warmly in your responses.`
          : ` Estás hablando con ${nombreUsuario}. Usa su nombre de forma natural y amigable en tus respuestas.`)
      : '';

    const llamadaPart = enLlamada
      ? (lang === 'en'
          ? ' VOICE CALL MODE: Respond as if on a real phone call. Be natural, fluid, friendly. NO lists, NO markdown, NO asterisks. Just plain conversational speech. Keep it short and clear.'
          : ' MODO LLAMADA DE VOZ: Responde como si estuvieras en una llamada real. Sé natural, fluido, amigable. NADA de listas, NADA de markdown, NADA de asteriscos. Solo habla normal como un pana. Sé breve y claro.')
      : '';

    const basePart = lang === 'en'
      ? 'You are El Chap, the AI of StudyAL. NEVER use asterisks, markdown or special formatting. Speak in plain natural text. Be concise, direct and friendly.'
      : 'Eres El Chap, la inteligencia artificial de StudyAL. NUNCA uses asteriscos, markdown ni formato especial. Habla en texto plano y natural. Sé conciso, directo y cercano.';

    let systemPrompt = '';
    if (contexto) {
      const docPart = lang === 'en'
        ? ` ONLY respond based on this document. Do NOT invent information.

DOCUMENT:
${contexto.substring(0, 6000)}`
        : ` SOLO responde basándote en este documento. NO inventes información.

DOCUMENTO:
${contexto.substring(0, 6000)}`;
      systemPrompt = basePart + nombrePart + llamadaPart + docPart;
    } else if (todosDocumentos?.length > 0) {
      const docsTexto = todosDocumentos
        .slice(0, 5)
        .map((d: any) => `[${d.materia} - ${d.nombre}]:\n${d.contenido.substring(0, 1500)}`)
        .join('\n\n---\n\n');
      const docsPart = lang === 'en'
        ? ` You have access to the student's documents. Help them study effectively.

DOCUMENTS:
${docsTexto}`
        : ` Tienes acceso a los documentos del estudiante. Ayúdalo a estudiar de manera efectiva.

DOCUMENTOS:
${docsTexto}`;
      systemPrompt = basePart + nombrePart + llamadaPart + docsPart;
    } else {
      const generalPart = lang === 'en'
        ? ' Help with study questions, explain concepts clearly, give memorization tips and motivate the student.'
        : ' Ayuda con preguntas de estudio, explica conceptos con claridad, da consejos de memorización y motiva al estudiante.';
      systemPrompt = basePart + nombrePart + llamadaPart + generalPart;
    }

    const historialSlice = (historial || []).slice(-8).map((m: any) => ({ role: m.role, content: m.content }));

    // ── IMAGEN ──
    if (imageBase64 && imageMime) {
      const respuesta = await groqRequest(async (client, model) => {
        const res = await client.chat.completions.create({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            { role: 'system', content: systemPrompt },
            ...historialSlice,
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
                { type: 'text', text: mensaje || (lang === 'en' ? 'Analyze this image.' : 'Analiza esta imagen.') },
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

    // ── CHAT NORMAL ──
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
