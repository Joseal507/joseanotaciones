import { NextRequest, NextResponse } from 'next/server';
import { getGroqClient } from '../../../../lib/groqClient';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audio = formData.get('audio') as File;
    const idioma = formData.get('idioma') as string || 'es';

    if (!audio) {
      return NextResponse.json({ success: false, error: 'No audio file' }, { status: 400 });
    }

    const client = getGroqClient();
    const buffer = Buffer.from(await audio.arrayBuffer());

    // Crear un File-like object compatible con Groq
    const audioFile = new File([buffer], audio.name || 'audio.webm', { type: audio.type || 'audio/webm' });

    // Transcribir con Whisper
    const transcription = await (client.audio as any).transcriptions.create({
      file: audioFile,
      model: 'whisper-large-v3',
      language: idioma === 'en' ? 'en' : 'es',
      response_format: 'json',
      temperature: 0.0,
    });

    return NextResponse.json({
      success: true,
      text: transcription.text,
      language: idioma,
    });

  } catch (error: any) {
    console.error('Transcription error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}