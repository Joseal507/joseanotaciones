import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, count = 5, idioma, difficulty = 'medium' } = body;
    const lang = idioma === 'en' ? 'en' : 'es';
    const textToUse = content.substring(0, 6000);

    // ===== PASO 1: Identificar conceptos clave =====
    let keyPoints = '';
    try {
      keyPoints = await groqRequest(async (client, model) => {
        const r = await client.chat.completions.create({
          model: model('llama-3.3-70b-versatile'),
          messages: [
            {
              role: 'system',
              content: lang === 'en'
                ? `Identify the ${count * 2} most important testable concepts from this text. Note what makes a good quiz question and common student mistakes.`
                : `Identifica los ${count * 2} conceptos más importantes evaluables de este texto. Nota qué haría una buena pregunta y errores comunes de estudiantes.`,
            },
            { role: 'user', content: textToUse },
          ],
          temperature: 0.2,
          max_tokens: 600,
        });
        return r.choices[0].message.content || '';
      });
    } catch (e) {
      console.log('Paso 1 falló, continuando sin keyPoints:', e);
    }

    // ===== PASO 2: Distractores inteligentes =====
    let distractorInfo = '';
    try {
      distractorInfo = await groqRequest(async (client, model) => {
        const r = await client.chat.completions.create({
          model: model('llama3-8b-8192'),
          messages: [
            {
              role: 'system',
              content: lang === 'en'
                ? 'Identify common misconceptions and similar-but-wrong concepts from this text for quiz wrong options.'
                : 'Identifica conceptos erróneos comunes y similares-pero-incorrectos de este texto para opciones incorrectas de quiz.',
            },
            { role: 'user', content: textToUse },
          ],
          temperature: 0.2,
          max_tokens: 400,
        });
        return r.choices[0].message.content || '';
      });
    } catch (e) {
      console.log('Paso 2 falló, continuando sin distractores:', e);
    }

    // ===== PASO 3: Generar quiz final =====
    const extraContext = [
      keyPoints
        ? (lang === 'en' ? `KEY CONCEPTS:\n${keyPoints}` : `CONCEPTOS CLAVE:\n${keyPoints}`)
        : '',
      distractorInfo
        ? (lang === 'en' ? `MISCONCEPTIONS:\n${distractorInfo}` : `ERRORES COMUNES:\n${distractorInfo}`)
        : '',
    ].filter(Boolean).join('\n\n---\n\n');

    const systemPrompt = lang === 'en'
      ? `You are an expert quiz creator. Create ${count} multiple choice questions at ${difficulty === 'easy' ? 'EASY difficulty (basic concepts, straightforward questions, clearly distinct options)' : difficulty === 'hard' ? 'HARD difficulty (deep understanding required, very similar and tricky options, edge cases, requires analysis and critical thinking)' : 'MEDIUM difficulty (moderate complexity, some similar options)'}. Wrong options must be PLAUSIBLE. Respond ONLY with valid JSON, no extra text:
[{"pregunta":"question","opciones":["opt0","opt1","opt2","opt3"],"correcta":0,"explicacion":"why correct"}]
Mix correct answer position randomly (0-3).${extraContext ? `\n\nEXPERT ANALYSIS:\n${extraContext}` : ''}`
      : `Eres un experto creador de quizzes. Crea ${count} preguntas de opción múltiple con dificultad ${difficulty === 'easy' ? 'FÁCIL (conceptos básicos, preguntas directas, opciones claramente distintas)' : difficulty === 'hard' ? 'DIFÍCIL (comprensión profunda, opciones muy similares y engañosas, casos límite, requiere análisis)' : 'MEDIA (complejidad moderada, algunas opciones similares)'}. Las opciones incorrectas deben ser PLAUSIBLES. Responde SOLO con JSON válido, sin texto extra:
[{"pregunta":"pregunta","opciones":["op0","op1","op2","op3"],"correcta":0,"explicacion":"por qué es correcta"}]
Mezcla la posición de la correcta aleatoriamente (0-3).${extraContext ? `\n\nANÁLISIS EXPERTO:\n${extraContext}` : ''}`;

    const quiz = await groqRequest(async (client, model) => {
      const r = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `${lang === 'en' ? 'Create' : 'Crea'} ${count} ${lang === 'en' ? 'questions from this text' : 'preguntas de este texto'}:\n\n${textToUse}`,
          },
        ],
        temperature: difficulty === 'hard' ? 0.6 : difficulty === 'easy' ? 0.2 : 0.4,
        max_tokens: 3000,
      });

      const text = r.choices[0].message.content || '[]';
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('No JSON found in response');

      const parsed = JSON.parse(match[0]);
      return parsed.filter((q: any) =>
        q.pregunta &&
        Array.isArray(q.opciones) &&
        q.opciones.length === 4 &&
        typeof q.correcta === 'number' &&
        q.explicacion
      );
    });

    return NextResponse.json({ success: true, quiz });

  } catch (error: any) {
    console.error('Error generando quiz:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
