import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

export async function POST(request: NextRequest) {
  try {
    const { mensaje, contexto, historial, perfil, todosDocumentos } = await request.json();

    let systemPrompt = '';

    if (contexto) {
      systemPrompt = `Eres AlciBot, un asistente de estudio inteligente.
SOLO responde basándote en el siguiente documento. NO inventes información que no esté en el documento.

DOCUMENTO:
${contexto.substring(0, 6000)}`;

    } else if (todosDocumentos && todosDocumentos.length > 0) {
      const docsTexto = todosDocumentos
        .slice(0, 5)
        .map((d: any) => `[${d.materia} - ${d.nombre}]:\n${d.contenido.substring(0, 1500)}`)
        .join('\n\n---\n\n');

      const materiaDificil = Object.entries(perfil?.materiasStats || {})
        .sort((a: any, b: any) =>
          (b[1].falladas / (b[1].totalFlashcards || 1)) -
          (a[1].falladas / (a[1].totalFlashcards || 1))
        )
        .slice(0, 3)
        .map((e: any) => e[1].nombre)
        .join(', ') || 'Sin datos';

      const temasQueFaila = Object.entries(perfil?.flashcardsFalladas || {})
        .sort((a: any, b: any) => (b[1] as number) - (a[1] as number))
        .slice(0, 3)
        .map((e: any) => e[0].substring(0, 60))
        .join('; ') || 'Sin datos';

      systemPrompt = `Eres AlciBot, un asistente de estudio personal e inteligente.
Tienes acceso a los apuntes y documentos del estudiante.
Responde basándote en ellos cuando sea relevante. Si no hay info suficiente, usa tu conocimiento general.
Responde siempre en español.

DOCUMENTOS DEL ESTUDIANTE:
${docsTexto}

PERFIL DEL ESTUDIANTE:
- Materias con más dificultad: ${materiaDificil}
- Temas que más falla: ${temasQueFaila}
- Total flashcards estudiadas: ${Object.values(perfil?.materiasStats || {}).reduce((acc: number, m: any) => acc + m.totalFlashcards, 0)}

Usa este perfil para personalizar tus respuestas y dar consejos específicos cuando sea relevante.`;

    } else {
      const tieneStats = Object.keys(perfil?.materiasStats || {}).length > 0;

      const perfilTexto = tieneStats ? `
PERFIL DEL ESTUDIANTE:
- Materias que estudia: ${Object.values(perfil.materiasStats).map((m: any) => m.nombre).join(', ')}
- Materia con más dificultad: ${Object.entries(perfil.materiasStats)
  .sort((a: any, b: any) => b[1].falladas - a[1].falladas)
  .slice(0, 1)
  .map((e: any) => e[1].nombre)
  .join('') || 'Sin datos'}
- Precisión global: ${(() => {
  const acertadas = Object.values(perfil.flashcardsAcertadas || {}).reduce((a: number, b: any) => a + b, 0);
  const falladas = Object.values(perfil.flashcardsFalladas || {}).reduce((a: number, b: any) => a + b, 0);
  const total = acertadas + falladas;
  return total > 0 ? Math.round((acertadas / total) * 100) + '%' : 'Sin datos';
})()}
- Total flashcards estudiadas: ${Object.values(perfil?.materiasStats || {}).reduce((acc: number, m: any) => acc + m.totalFlashcards, 0)}

Usa este perfil para personalizar tus respuestas cuando sea relevante.` : '';

      systemPrompt = `Eres AlciBot, un asistente de estudio personal inteligente y amigable.
Ayuda al estudiante con preguntas de estudio, explica conceptos, da consejos de memorización y técnicas de estudio.
Responde siempre en español. Sé conciso pero completo.
${perfilTexto}`;
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