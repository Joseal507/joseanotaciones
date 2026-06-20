import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { alaiRequest } from '../../../lib/alai';

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&\n?#]+)/,
    /(?:youtu\.be\/)([^&\n?#]+)/,
    /(?:youtube\.com\/embed\/)([^&\n?#]+)/,
    /(?:youtube\.com\/shorts\/)([^&\n?#]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function getVideoMetadata(videoId: string) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    const data = await res.json();
    return {
      title: data.title || 'Video de YouTube',
      channel: data.author_name || 'Canal desconocido',
      thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    };
  } catch {
    return { title: 'Video de YouTube', channel: 'Canal desconocido', thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` };
  }
}

async function getTranscript(videoId: string, idioma: string) {
  const configs = idioma === 'en'
    ? [{ lang: 'en' }, { lang: 'es' }, {}]
    : [{ lang: 'es' }, { lang: 'es-419' }, { lang: 'en' }, {}];

  for (const config of configs) {
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId, config);
      if (transcript?.length > 0) {
        const text = transcript.map(i => i.text.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        if (text.length > 50) return { text, wordCount: text.split(/\s+/).length };
      }
    } catch { continue; }
  }
  throw new Error('NO_TRANSCRIPT');
}

function calcularFlashcardsOptimas(wordCount: number): number {
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
    const { url, idioma = 'es', flashcardCount, soloMetadata = false } = await req.json();
    if (!url) return NextResponse.json({ error: 'URL requerida' }, { status: 400 });

    const videoId = extractVideoId(url);
    if (!videoId) return NextResponse.json({
      error: idioma === 'en' ? 'Invalid YouTube URL' : 'URL de YouTube inválida',
    }, { status: 400 });

    const [metadata, transcriptData] = await Promise.all([
      getVideoMetadata(videoId),
      getTranscript(videoId, idioma),
    ]);

    const { text: transcript, wordCount } = transcriptData;
    const optimalCount = calcularFlashcardsOptimas(wordCount);
    const finalFlashcardCount = flashcardCount || optimalCount;
    const lang = idioma === 'en' ? 'en' : 'es';

    // Si solo se pide metadata (al subir el video), devolver sin analizar
    if (soloMetadata) {
      return NextResponse.json({
        success: true,
        videoId,
        metadata,
        transcript: transcript.substring(0, 3000) + (transcript.length > 3000 ? '...' : ''),
        transcriptFull: transcript,
        wordCount,
        optimalCount,
        flashcardCount: finalFlashcardCount,
        analysis: { flashcards: [], quiz: [], keywords: [], key_points: [], summary: '', topics: [], difficulty: '' },
      });
    }

    const transcriptTruncated = transcript.substring(0, 12000);

    const prompt = lang === 'en'
      ? `Expert academic content analyzer. Analyze this YouTube transcript completely.
VIDEO: "${metadata.title}" by ${metadata.channel} | WORDS: ${wordCount}
TRANSCRIPT: ${transcriptTruncated}
Return ONLY valid JSON, no extra text:
{"summary":"5-8 sentences","key_points":["p1","p2","p3","p4","p5"],"keywords":["k1","k2","k3","k4","k5","k6","k7","k8"],"flashcards":[{"pregunta":"Q?","respuesta":"A"}],"quiz":[{"pregunta":"Q?","opciones":["A","B","C","D"],"correcta":0,"explicacion":"why"}],"apuntes":"# Title\\n\\n## Summary\\nnotes...","difficulty":"basic/intermediate/advanced","topics":["t1","t2","t3"]}
Generate EXACTLY ${finalFlashcardCount} flashcards and EXACTLY 5 quiz questions covering ALL content.`
      : `Analizador experto de contenido académico. Analiza COMPLETAMENTE esta transcripción.
VIDEO: "${metadata.title}" por ${metadata.channel} | PALABRAS: ${wordCount}
TRANSCRIPCIÓN: ${transcriptTruncated}
Devuelve SOLO JSON válido, sin texto extra:
{"summary":"5-8 oraciones","key_points":["p1","p2","p3","p4","p5"],"keywords":["k1","k2","k3","k4","k5","k6","k7","k8"],"flashcards":[{"pregunta":"¿P?","respuesta":"R"}],"quiz":[{"pregunta":"¿P?","opciones":["A","B","C","D"],"correcta":0,"explicacion":"por qué"}],"apuntes":"# Título\\n\\n## Resumen\\napuntes...","difficulty":"básico/intermedio/avanzado","topics":["t1","t2","t3"]}
Genera EXACTAMENTE ${finalFlashcardCount} flashcards y EXACTAMENTE 5 preguntas de quiz cubriendo TODO el contenido.`;

    // Usar alaiRequest con todos los proveedores (ALAI, Cerebras, HF, SambaNova, Gemini, Mistral, Cloudflare)
    const rawText = await alaiRequest(async (client, model) => {
      const r = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          { role: 'system', content: lang === 'en' ? 'You are an expert content analyzer. Return ONLY valid JSON.' : 'Eres un analizador experto. Devuelve SOLO JSON válido.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 6000,
      });
      return r.choices[0]?.message?.content || '{}';
    });

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const analysis = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(analysis.flashcards)) analysis.flashcards = [];
    if (!Array.isArray(analysis.quiz)) analysis.quiz = [];

    return NextResponse.json({
      success: true, videoId, metadata,
      transcript: transcript.substring(0, 3000) + (transcript.length > 3000 ? '...' : ''),
      transcriptFull: transcript,
      wordCount, optimalCount,
      flashcardCount: finalFlashcardCount,
      analysis,
    });

  } catch (error: any) {
    console.error('YouTube API error:', error);
    if (error.message === 'NO_TRANSCRIPT') {
      return NextResponse.json({
        error: 'Este video no tiene subtítulos disponibles.',
        errorCode: 'NO_TRANSCRIPT',
      }, { status: 422 });
    }
    if (error.message === 'AI_EXHAUSTED') {
      return NextResponse.json({
        error: 'Todos los proveedores de IA están ocupados. Intenta en unos segundos.',
        errorCode: 'AI_EXHAUSTED',
      }, { status: 503 });
    }
    return NextResponse.json({ error: error.message || 'Error procesando el video' }, { status: 500 });
  }
}
