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
    const { content, count = 5, idioma, nivel = 'intermedio' } = body;
    const lang = idioma === 'en' ? 'en' : 'es';
    const textToUse = content.substring(0, 8000);
    const nivelCfg = NIVEL_CONFIG[nivel as keyof typeof NIVEL_CONFIG] || NIVEL_CONFIG.intermedio;
    const cfg = nivelCfg[lang as 'es' | 'en'];

    let keyPoints = '';
    try {
      keyPoints = await groqRequest(async (client, model) => {
        const r = await client.chat.completions.create({
          model: model('llama-3.3-70b-versatile'),
          messages: [
            {
              role: 'system',
              content: lang === 'en'
                ? `Identify the ${count * 2} most important testable concepts from this text for a ${nivel.toUpperCase()} level quiz. ${cfg.descripcion}`
                : `Identifica los ${count * 2} conceptos mas importantes evaluables de este texto para un quiz de nivel ${nivel.toUpperCase()}. ${cfg.descripcion}`,
            },
            { role: 'user', content: textToUse },
          ],
          temperature: 0.2,
          max_tokens: 800,
        });
        return r.choices[0].message.content || '';
      });
    } catch (e) { console.log('Paso 1 fallo:', e); }

    let distractorInfo = '';
    try {
      distractorInfo = await groqRequest(async (client, model) => {
        const r = await client.chat.completions.create({
          model: model('llama3-8b-8192'),
          messages: [
            {
              role: 'system',
              content: lang === 'en'
                ? `For a ${nivel.toUpperCase()} quiz: ${cfg.descripcion} List specific wrong-but-plausible options.`
                : `Para un quiz de nivel ${nivel.toUpperCase()}: ${cfg.descripcion} Lista opciones incorrectas-pero-plausibles especificas.`,
            },
            { role: 'user', content: textToUse },
          ],
          temperature: cfg.temperatura,
          max_tokens: 500,
        });
        return r.choices[0].message.content || '';
      });
    } catch (e) { console.log('Paso 2 fallo:', e); }

    const extraContext = [
      keyPoints ? (lang === 'en' ? `KEY CONCEPTS:\n${keyPoints}` : `CONCEPTOS CLAVE:\n${keyPoints}`) : '',
      distractorInfo ? (lang === 'en' ? `DISTRACTORS:\n${distractorInfo}` : `DISTRACTORES:\n${distractorInfo}`) : '',
    ].filter(Boolean).join('\n\n---\n\n');

    const nivelLabel = { facil: lang === 'en' ? 'EASY' : 'FACIL', intermedio: lang === 'en' ? 'INTERMEDIATE' : 'INTERMEDIO', dificil: lang === 'en' ? 'HARD' : 'DIFICIL' }[nivel as string] || 'INTERMEDIO';

    const systemPrompt = lang === 'en'
      ? `You are an expert quiz creator. LEVEL: ${nivelLabel}. ${cfg.descripcion}
Create exactly ${count} multiple choice questions. Respond ONLY with valid JSON array, no extra text:
[{"pregunta":"question text","opciones":["opt0","opt1","opt2","opt3"],"correcta":0,"explicacion":"detailed explanation"}]
Mix correct answer position randomly (0-3). Each question must have exactly 4 options.${extraContext ? `\n\nEXPERT ANALYSIS:\n${extraContext}` : ''}`
      : `Eres un experto creador de quizzes academicos. NIVEL: ${nivelLabel}. ${cfg.descripcion}
Crea exactamente ${count} preguntas de opcion multiple. Responde SOLO con JSON valido, sin texto extra:
[{"pregunta":"texto de la pregunta","opciones":["op0","op1","op2","op3"],"correcta":0,"explicacion":"explicacion detallada"}]
Mezcla la posicion de la correcta aleatoriamente (0-3). Cada pregunta debe tener exactamente 4 opciones.${extraContext ? `\n\nANALISIS EXPERTO:\n${extraContext}` : ''}`;

    const quiz = await groqRequest(async (client, model) => {
      const r = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `${lang === 'en' ? 'Create' : 'Crea'} ${count} preguntas de nivel ${nivelLabel} ${lang === 'en' ? 'from this text' : 'de este texto'}:\n\n${textToUse}` },
        ],
        temperature: cfg.temperatura,
        max_tokens: 4000,
      });

      const text = r.choices[0].message.content || '[]';
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('No JSON found in response');
      const parsed = JSON.parse(match[0]);
      return parsed.filter((q: any) =>
        q.pregunta && Array.isArray(q.opciones) && q.opciones.length === 4 &&
        typeof q.correcta === 'number' && q.explicacion
      );
    });

    return NextResponse.json({ success: true, quiz, nivel });

  } catch (error: any) {
    console.error('Error generando quiz:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
