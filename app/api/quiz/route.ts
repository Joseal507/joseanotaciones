import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';

export const maxDuration = 60;

const NIVEL_CONFIG = {
  facil: {
    es: { descripcion: 'FACIL: Preguntas directas de definicion y reconocimiento. Las opciones incorrectas deben ser claramente distintas. Conceptos basicos y memorizacion.', temperatura: 0.3 },
    en: { descripcion: 'EASY: Direct definition and recognition questions. Wrong options should be clearly different. Basic concepts and memorization.', temperatura: 0.3 },
  },
  intermedio: {
    es: { descripcion: 'INTERMEDIO: Mezcla de comprension y aplicacion. Las opciones incorrectas deben ser plausibles pero distinguibles con estudio.', temperatura: 0.4 },
    en: { descripcion: 'INTERMEDIATE: Mix of comprehension and application. Wrong options should be plausible but distinguishable with study.', temperatura: 0.4 },
  },
  dificil: {
    es: { descripcion: 'DIFICIL: Preguntas de analisis, sintesis y evaluacion. Las opciones incorrectas deben ser MUY plausibles, casi correctas. Casos especiales, excepciones, detalles tecnicos.', temperatura: 0.6 },
    en: { descripcion: 'HARD: Analysis, synthesis and evaluation questions. Wrong options must be VERY plausible, almost correct. Edge cases, exceptions, technical details.', temperatura: 0.6 },
  },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, count = 10, idioma, nivel = 'intermedio' } = body;
    const lang = idioma === 'en' ? 'en' : 'es';
    const nivelCfg = NIVEL_CONFIG[nivel as keyof typeof NIVEL_CONFIG] || NIVEL_CONFIG.intermedio;
    const cfg = nivelCfg[lang as 'es' | 'en'];

    const nivelLabel = {
      facil: lang === 'en' ? 'EASY' : 'FACIL',
      intermedio: lang === 'en' ? 'INTERMEDIATE' : 'INTERMEDIO',
      dificil: lang === 'en' ? 'HARD' : 'DIFICIL',
    }[nivel as string] || 'INTERMEDIO';

    // ── DIVIDIR EN CHUNKS PARA CUBRIR TODO EL DOCUMENTO ──
    const chunkSize = 4000;
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.substring(i, i + chunkSize));
    }

    // ── DISTRIBUIR PREGUNTAS ENTRE CHUNKS ──
    const questionsPerChunk = Math.ceil(count / chunks.length);

    console.log(`📝 Quiz: ${chunks.length} chunks | ${count} preguntas | ${questionsPerChunk} por chunk | nivel: ${nivelLabel}`);

    // ── GENERAR PREGUNTAS DE CADA CHUNK ──
    const todasPreguntas: any[] = [];

    for (let idx = 0; idx < chunks.length; idx++) {
      try {
        const systemPrompt = lang === 'en'
          ? `You are an expert academic quiz creator. LEVEL: ${nivelLabel}. ${cfg.descripcion}
Create exactly ${questionsPerChunk} multiple choice questions from text fragment ${idx + 1} of ${chunks.length}.
RULES:
- Each question MUST come from the content of THIS fragment, do NOT invent
- Each question must have exactly 4 options
- Mix correct answer position randomly (0, 1, 2 or 3)
- Wrong options must be plausible for ${nivelLabel} level
- Include detailed explanation for each answer
Respond ONLY with valid JSON array, no extra text:
[{"pregunta":"question","opciones":["opt0","opt1","opt2","opt3"],"correcta":0,"explicacion":"explanation"}]`
          : `Eres un experto creador de quizzes academicos. NIVEL: ${nivelLabel}. ${cfg.descripcion}
Crea exactamente ${questionsPerChunk} preguntas de opcion multiple del fragmento ${idx + 1} de ${chunks.length}.
REGLAS:
- Cada pregunta DEBE venir del contenido de ESTE fragmento, NO inventes
- Cada pregunta debe tener exactamente 4 opciones
- Mezcla la posicion de la correcta aleatoriamente (0, 1, 2 o 3)
- Las opciones incorrectas deben ser plausibles para nivel ${nivelLabel}
- Incluye explicacion detallada para cada respuesta
Responde SOLO con JSON valido, sin texto extra:
[{"pregunta":"pregunta","opciones":["op0","op1","op2","op3"],"correcta":0,"explicacion":"explicacion"}]`;

        const result = await groqRequest(async (client, model) => {
          const r = await client.chat.completions.create({
            model: model('llama-3.3-70b-versatile'),
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: lang === 'en'
                  ? `Create ${questionsPerChunk} ${nivelLabel} questions from this fragment:\n\n${chunks[idx]}`
                  : `Crea ${questionsPerChunk} preguntas ${nivelLabel} de este fragmento:\n\n${chunks[idx]}`,
              },
            ],
            temperature: cfg.temperatura,
            max_tokens: 3000,
          });

          const text = r.choices[0].message.content || '[]';
          const match = text.match(/\[[\s\S]*\]/);
          if (!match) return [];
          const parsed = JSON.parse(match[0]);
          return parsed.filter((q: any) =>
            q.pregunta &&
            Array.isArray(q.opciones) &&
            q.opciones.length === 4 &&
            typeof q.correcta === 'number' &&
            q.explicacion
          );
        });

        todasPreguntas.push(...result);

        // Pequeña pausa entre chunks para no quemar rate limit
        if (idx < chunks.length - 1) {
          await new Promise(r => setTimeout(r, 300));
        }

      } catch (e) {
        console.error(`Error chunk ${idx}:`, e);
      }
    }

    // ── LIMITAR AL NÚMERO PEDIDO EXACTO ──
    const quiz = todasPreguntas.slice(0, count);

    if (quiz.length === 0) {
      return NextResponse.json({ success: false, error: 'No se generaron preguntas' }, { status: 500 });
    }

    console.log(`✅ Quiz generado: ${quiz.length} preguntas cubriendo todo el documento`);
    return NextResponse.json({ success: true, quiz, nivel });

  } catch (error: any) {
    console.error('Error generando quiz:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
