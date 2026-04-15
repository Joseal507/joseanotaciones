import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { text, idioma } = await req.json();
    if (!text) {
      return NextResponse.json({ error: 'No text' }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ useBrowserTTS: true }, { status: 200 });
    }

    const response = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'playai-tts',
        input: text.substring(0, 2000),
        voice: 'Basil-PlayAI',
        response_format: 'wav',
      }),
    });

    if (response.ok) {
      const audioBuffer = await response.arrayBuffer();
      return new NextResponse(audioBuffer, {
        headers: { 'Content-Type': 'audio/wav' },
      });
    }

    return NextResponse.json({ useBrowserTTS: true }, { status: 200 });
  } catch (error) {
    console.error('Speech error:', error);
    return NextResponse.json({ useBrowserTTS: true }, { status: 200 });
  }
}