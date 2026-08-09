import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audio = formData.get('audio') as File;
    const idioma = formData.get('idioma') as string || 'es';

    if (!audio) return NextResponse.json({ success: false, error: 'No audio file' }, { status: 400 });

    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('OpenRouter no configurado');
    const buffer = Buffer.from(await audio.arrayBuffer());
    const format = audio.type.includes('wav') ? 'wav' : audio.type.includes('mp3') ? 'mp3' : 'webm';
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: [
          { type: 'text', text: `Transcribe este audio literalmente en ${idioma === 'en' ? 'inglés' : 'español'}. Devuelve solo la transcripción.` },
          { type: 'input_audio', input_audio: { data: buffer.toString('base64'), format } },
        ] }],
        temperature: 0,
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter transcription ${response.status}`);
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return NextResponse.json({ success: true, text, language: idioma });
  } catch (error: any) {
    console.error('Transcription error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
