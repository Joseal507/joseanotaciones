import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

export async function POST(request: NextRequest) {
  try {
    const { perfil, racha, email } = await request.json();

    const totalAcertadas = Object.values(perfil.flashcardsAcertadas || {}).reduce((a: number, b: any) => a + b, 0);
    const totalFalladas = Object.values(perfil.flashcardsFalladas || {}).reduce((a: number, b: any) => a + b, 0);
    const total = totalAcertadas + totalFalladas;
    const precision = total > 0 ? Math.round((totalAcertadas / total) * 100) : 0;

    const materiasTop = Object.entries(perfil.materiasStats || {})
      .map(([_, s]: any) => s)
      .sort((a: any, b: any) => b.totalFlashcards - a.totalFlashcards)
      .slice(0, 3);

    const completion = await client.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'system',
          content: 'Eres un asistente de estudio. Genera un reporte semanal motivador y conciso en español basado en las estadísticas del estudiante.',
        },
        {
          role: 'user',
          content: `Genera un reporte semanal de estudio con estos datos:
- Total flashcards estudiadas: ${total}
- Acertadas: ${totalAcertadas} (${precision}%)
- Falladas: ${totalFalladas}
- Racha actual: ${racha.rachaActual} días
- Mejor racha: ${racha.mejorRacha} días
- Materias más estudiadas: ${materiasTop.map((m: any) => m.nombre).join(', ')}

El reporte debe incluir: resumen del progreso, puntos fuertes, áreas de mejora y motivación. Máximo 200 palabras.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 400,
    });

    const reporte = completion.choices[0].message.content || '';

    return NextResponse.json({
      success: true,
      reporte,
      stats: { total, totalAcertadas, totalFalladas, precision, racha: racha.rachaActual },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}