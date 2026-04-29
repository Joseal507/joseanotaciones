import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';

export const maxDuration = 60;

const NIVEL_CONFIG = {
  facil:      { es: 'FACIL: Preguntas directas de definicion y reconocimiento. Opciones incorrectas claramente distintas.', en: 'EASY: Direct definition questions. Wrong options clearly different.', temp: 0.3 },
  intermedio: { es: 'INTERMEDIO: Comprension y aplicacion. Opciones plausibles pero distinguibles.', en: 'INTERMEDIATE: Comprehension and application. Plausible but distinguishable options.', temp: 0.4 },
  dificil:    { es: 'DIFICIL: Analisis y sintesis. Opciones MUY plausibles, casi correctas. Casos especiales.', en: 'HARD: Analysis and synthesis. VERY plausible options, almost correct. Edge cases.', temp: 0.6 },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, count = 10, idioma, nivel = 'intermedio' } = body;
    const lang = idioma === 'en' ? 'en' : 'es';
    const cfg = NIVEL_CONFIG[nivel as keyof typeof NIVEL_CONFIG] || NIVEL_CONFIG.intermedio;
    const desc = lang === 'en' ? cfg.en : cfg.es;
    const nivelLabel = { facil: lang === 'en' ? 'EASY' : 'FACIL', intermedio: lang === 'en' ? 'INTERMEDIATE' : 'INTERMEDIO', dificil: lang === 'en' ? 'HARD' : 'DIFICIL' }[nivel as string] || 'INTERMEDIO';

    // ── CHUNKS ──
    const chunkSize = 4000;
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += chunkSize) chunks.push(content.substring(i, i + chunkSize));
    const questionsPerChunk = Math.ceil(count / chunks.length);

    const systemPrompt = (idx: number) => lang === 'en'
      ? `Expert quiz creator. Level: ${nivelLabel}. ${desc}
Create exactly ${questionsPerChunk} multiple choice questions from fragment ${idx + 1}/${chunks.length}.
- Exactly 4 options per question
- Mix correct answer position randomly (0,1,2,3)
- Include detailed explanation
ONLY return valid JSON array, no extra text:
[{"pregunta":"...","opciones":["a","b","c","d"],"correcta":0,"explicacion":"..."}]`
      : `Experto en quizzes. Nivel: ${nivelLabel}. ${desc}
Crea exactamente ${questionsPerChunk} preguntas de opcion multiple del fragmento ${idx + 1}/${chunks.length}.
- Exactamente 4 opciones por pregunta
- Mezcla la posicion de la correcta aleatoriamente (0,1,2,3)
- Incluye explicacion detallada
Devuelve SOLO array JSON valido, sin texto extra:
[{"pregunta":"...","opciones":["a","b","c","d"],"correcta":0,"explicacion":"..."}]`;

    // ── CHUNKS EN PARALELO (lotes de 3) ──
    const todasPreguntas: any[] = [];
    const batchSize = 3;

    for (let b = 0; b < chunks.length; b += batchSize) {
      const batch = chunks.slice(b, b + batchSize);
      const results = await Promise.allSettled(
        batch.map((chunk, i) =>
          groqRequest(async (client, model) => {
            const r = await client.chat.completions.create({
              model: model('llama-3.3-70b-versatile'),
              messages: [
                { role: 'system', content: systemPrompt(b + i) },
                { role: 'user', content: lang === 'en' ? `Fragment:\n\n${chunk}` : `Fragmento:\n\n${chunk}` },
              ],
              temperature: cfg.temp,
              max_tokens: 3000,
            });
            const text = r.choices[0].message.content || '[]';
            const match = text.match(/\[[\s\S]*\]/);
            if (!match) return [];
            const parsed = JSON.parse(match[0]);
            return parsed.filter((q: any) =>
              q.pregunta && Array.isArray(q.opciones) && q.opciones.length === 4 &&
              typeof q.correcta === 'number' && q.explicacion
            );
          })
        )
      );
      for (const r of results) {
        if (r.status === 'fulfilled') todasPreguntas.push(...r.value);
      }
    }

    const quiz = todasPreguntas.slice(0, count);
    if (quiz.length === 0) return NextResponse.json({ success: false, error: 'No se generaron preguntas' }, { status: 500 });

    return NextResponse.json({ success: true, quiz, nivel });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
