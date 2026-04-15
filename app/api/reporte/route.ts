import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

export async function POST(request: NextRequest) {
  try {
    const { perfil, racha, idioma } = await request.json();
    const lang = idioma === 'en' ? 'en' : 'es';

    const totalAcertadas = Object.values(perfil.flashcardsAcertadas || {}).reduce((a: number, b: any) => a + b, 0);
    const totalFalladas = Object.values(perfil.flashcardsFalladas || {}).reduce((a: number, b: any) => a + b, 0);
    const total = totalAcertadas + totalFalladas;
    const precision = total > 0 ? Math.round((totalAcertadas / total) * 100) : 0;

    const materiasTop = Object.entries(perfil.materiasStats || {})
      .map(([_, s]: any) => s)
      .sort((a: any, b: any) => b.totalFlashcards - a.totalFlashcards)
      .slice(0, 3);

    const systemPrompt = lang === 'en'
      ? 'You are a study assistant. Generate a motivating and concise weekly report in English based on the student\'s statistics.'
      : 'Eres un asistente de estudio. Genera un reporte semanal motivador y conciso en español basado en las estadísticas del estudiante.';

    const userPrompt = lang === 'en'
      ? `Generate a weekly study report with this data:\n- Total flashcards studied: ${total}\n- Correct: ${totalAcertadas} (${precision}%)\n- Wrong: ${totalFalladas}\n- Current streak: ${racha.rachaActual} days\n- Best streak: ${racha.mejorRacha} days\n- Most studied subjects: ${materiasTop.map((m: any) => m.nombre).join(', ')}\n\nThe report should include: progress summary, strengths, areas for improvement and motivation. Max 200 words.`
      : `Genera un reporte semanal de estudio con estos datos:\n- Total flashcards estudiadas: ${total}\n- Acertadas: ${totalAcertadas} (${precision}%)\n- Falladas: ${totalFalladas}\n- Racha actual: ${racha.rachaActual} días\n- Mejor racha: ${racha.mejorRacha} días\n- Materias más estudiadas: ${materiasTop.map((m: any) => m.nombre).join(', ')}\n\nEl reporte debe incluir: resumen del progreso, puntos fuertes, áreas de mejora y motivación. Máximo 200 palabras.`;

    const completion = await client.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 400,
    });

    const reporte = completion.choices[0].message.content || '';
    return NextResponse.json({ success: true, reporte, stats: { total, totalAcertadas, totalFalladas, precision, racha: racha.rachaActual } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}