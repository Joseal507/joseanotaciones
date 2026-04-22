import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&\n?#]+)/,
    /(?:youtu\.be\/)([^&\n?#]+)/,
    /(?:youtube\.com\/embed\/)([^&\n?#]+)/,
    /(?:youtube\.com\/shorts\/)([^&\n?#]+)/,
    /(?:youtube\.com\/v\/)([^&\n?#]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function getVideoMetadata(videoId: string) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    const data = await res.json();
    return {
      title: data.title || 'Video de YouTube',
      channel: data.author_name || 'Canal desconocido',
      thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    };
  } catch {
    return {
      title: 'Video de YouTube',
      channel: 'Canal desconocido',
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    };
  }
}

async function getTranscript(videoId: string, idioma: string): Promise<{ text: string; wordCount: number }> {
  // Intentar en orden de preferencia de idioma
  const langConfigs = idioma === 'en'
    ? [{ lang: 'en' }, { lang: 'es' }, {}]
    : [{ lang: 'es' }, { lang: 'es-419' }, { lang: 'en' }, {}];

  let lastError: any;

  for (const config of langConfigs) {
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId, config);
      if (transcript && transcript.length > 0) {
        const text = transcript
          .map(item => item.text.trim())
          .filter(t => t.length > 0)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (text.length > 50) {
          const wordCount = text.split(/\s+/).length;
          return { text, wordCount };
        }
      }
    } catch (e) {
      lastError = e;
      continue;
    }
  }

  throw new Error('NO_TRANSCRIPT');
}

function calcularFlashcardsOptimas(wordCount: number): number {
  // Mismo cálculo que en los documentos: ~1 flashcard cada 150 palabras
  if (wordCount < 500) return 5;
  if (wordCount < 1000) return 8;
  if (wordCount < 2000) return 12;
  if (wordCount < 4000) return 16;
  if (wordCount < 6000) return 20;
  if (wordCount < 10000) return 25;
  return 30;
}

export async function POST(req: NextRequest) {
  try {
    const { url, idioma = 'es', flashcardCount } = await req.json();

    if (!url) {
      return NextResponse.json({ error: 'URL requerida' }, { status: 400 });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json({
        error: idioma === 'en' ? 'Invalid YouTube URL' : 'URL de YouTube inválida'
      }, { status: 400 });
    }

    // Obtener metadata y transcripción en paralelo
    const [metadata, transcriptData] = await Promise.all([
      getVideoMetadata(videoId),
      getTranscript(videoId, idioma),
    ]);

    const { text: transcript, wordCount } = transcriptData;

    // Calcular número óptimo de flashcards
    const optimalCount = calcularFlashcardsOptimas(wordCount);
    const finalFlashcardCount = flashcardCount || optimalCount;

    const lang = idioma === 'en' ? 'en' : 'es';
    const transcriptTruncated = transcript.substring(0, 14000);

    // Usar Gemini con rotación de keys
    const geminiKeys = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
      process.env.GEMINI_API_KEY_4,
    ].filter(Boolean);

    const geminiKey = geminiKeys[Math.floor(Math.random() * geminiKeys.length)];

    const prompt = lang === 'en'
      ? `You are an expert academic content analyzer. Analyze this YouTube video transcript completely.

VIDEO: "${metadata.title}" by ${metadata.channel}
WORD COUNT: ${wordCount} words

TRANSCRIPT:
${transcriptTruncated}

Return ONLY valid JSON (no markdown, no extra text):
{
  "summary": "Write 5-8 complete sentences summarizing the entire video",
  "key_points": ["point 1", "point 2", "point 3", "point 4", "point 5"],
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5", "keyword6", "keyword7", "keyword8"],
  "flashcards": [
    {"pregunta": "Question?", "respuesta": "Complete answer here"}
  ],
  "quiz": [
    {
      "pregunta": "Question?",
      "opciones": ["Option A", "Option B", "Option C", "Option D"],
      "correcta": 0,
      "explicacion": "Why A is correct"
    }
  ],
  "apuntes": "# ${metadata.title}\\n\\n## Summary\\nDetailed notes here...\\n\\n## Key Concepts\\n- concept 1\\n- concept 2\\n\\n## Important Details\\nMore notes...",
  "difficulty": "basic/intermediate/advanced",
  "topics": ["topic1", "topic2", "topic3"]
}

CRITICAL: Generate EXACTLY ${finalFlashcardCount} flashcards and EXACTLY 5 quiz questions. Cover ALL the content.`
      : `Eres un analizador experto de contenido académico. Analiza COMPLETAMENTE esta transcripción de YouTube.

VIDEO: "${metadata.title}" por ${metadata.channel}
PALABRAS: ${wordCount} palabras

TRANSCRIPCIÓN:
${transcriptTruncated}

Devuelve SOLO JSON válido (sin markdown, sin texto extra):
{
  "summary": "Escribe 5-8 oraciones completas resumiendo TODO el video",
  "key_points": ["punto 1", "punto 2", "punto 3", "punto 4", "punto 5"],
  "keywords": ["palabra1", "palabra2", "palabra3", "palabra4", "palabra5", "palabra6", "palabra7", "palabra8"],
  "flashcards": [
    {"pregunta": "¿Pregunta?", "respuesta": "Respuesta completa aquí"}
  ],
  "quiz": [
    {
      "pregunta": "¿Pregunta?",
      "opciones": ["Opción A", "Opción B", "Opción C", "Opción D"],
      "correcta": 0,
      "explicacion": "Por qué A es correcta"
    }
  ],
  "apuntes": "# ${metadata.title}\\n\\n## Resumen\\nApuntes detallados aquí...\\n\\n## Conceptos Clave\\n- concepto 1\\n- concepto 2\\n\\n## Detalles Importantes\\nMás apuntes...",
  "difficulty": "básico/intermedio/avanzado",
  "topics": ["tema1", "tema2", "tema3"]
}

CRÍTICO: Genera EXACTAMENTE ${finalFlashcardCount} flashcards y EXACTAMENTE 5 preguntas de quiz. Cubre TODO el contenido del video.`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
          },
        }),
      }
    );

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    // Limpiar y parsear JSON
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Gemini response');

    const analysis = JSON.parse(jsonMatch[0]);

    // Validar que flashcards y quiz existen
    if (!Array.isArray(analysis.flashcards)) analysis.flashcards = [];
    if (!Array.isArray(analysis.quiz)) analysis.quiz = [];

    return NextResponse.json({
      success: true,
      videoId,
      metadata,
      transcript: transcript.substring(0, 3000) + (transcript.length > 3000 ? '...' : ''),
      transcriptFull: transcript,
      wordCount,
      optimalCount,
      flashcardCount: finalFlashcardCount,
      analysis,
    });

  } catch (error: any) {
    console.error('YouTube API error:', error);

    if (error.message === 'NO_TRANSCRIPT') {
      return NextResponse.json({
        error: 'Este video no tiene subtítulos disponibles. Prueba con otro video que tenga CC activado.',
        errorCode: 'NO_TRANSCRIPT',
      }, { status: 422 });
    }

    return NextResponse.json({
      error: error.message || 'Error procesando el video'
    }, { status: 500 });
  }
}
