import { NextRequest, NextResponse } from 'next/server';

const GROQ_KEYS = [
  process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4, process.env.GROQ_API_KEY_5, process.env.GROQ_API_KEY_6,
  process.env.GROQ_API_KEY_7,
].filter(Boolean) as string[];

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audio = formData.get('audio') as File;
    const idioma = formData.get('idioma') as string || 'es';

    if (!audio) return NextResponse.json({ success: false, error: 'No audio file' }, { status: 400 });

    const buffer = Buffer.from(await audio.arrayBuffer());
    const audioFile = new File([buffer], audio.name || 'audio.webm', { type: audio.type || 'audio/webm' });

    // Rotar keys hasta que una funcione
    let lastError: any;
    for (const key of GROQ_KEYS) {
      try {
        const { default: OpenAI } = await import('openai');
        const client = new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' });
        const transcription = await (client.audio as any).transcriptions.create({
          file: audioFile,
          model: 'whisper-large-v3',
          language: idioma === 'en' ? 'en' : 'es',
          response_format: 'json',
          temperature: 0.0,
        });
        return NextResponse.json({ success: true, text: transcription.text, language: idioma });
      } catch (err: any) {
        lastError = err;
        if (err?.status === 429) continue;
        throw err;
      }
    }

    throw lastError;
  } catch (error: any) {
    console.error('Transcription error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
