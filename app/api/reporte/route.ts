import { NextRequest, NextResponse } from 'next/server';
import { alaiRequest } from '../../../lib/alai';

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
      ? 'You are a study assistant. Generate a motivating and concise weekly report in English.'
      : 'Eres un asistente de estudio. Genera un reporte semanal motivador y conciso en español.';

    const userPrompt = lang === 'en'
      ? `Weekly study report:
- Total flashcards: ${total} | Correct: ${totalAcertadas} (${precision}%) | Wrong: ${totalFalladas}
- Streak: ${racha.rachaActual} days | Best: ${racha.mejorRacha} days
- Top subjects: ${materiasTop.map((m: any) => m.nombre).join(', ') || 'None yet'}
Include: progress summary, strengths, areas to improve, motivation. Max 200 words.`
      : `Reporte semanal:
- Total flashcards: ${total} | Acertadas: ${totalAcertadas} (${precision}%) | Falladas: ${totalFalladas}
- Racha: ${racha.rachaActual} días | Mejor: ${racha.mejorRacha} días
- Materias top: ${materiasTop.map((m: any) => m.nombre).join(', ') || 'Ninguna aún'}
Incluir: resumen progreso, puntos fuertes, áreas de mejora, motivación. Máximo 200 palabras.`;

    const reporte = await alaiRequest(async (client, model) => {
      const r = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 400,
      });
      return r.choices[0].message.content || '';
    });

    return NextResponse.json({
      success: true, reporte,
      stats: { total, totalAcertadas, totalFalladas, precision, racha: racha.rachaActual },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
