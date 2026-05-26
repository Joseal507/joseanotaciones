import { NextResponse } from 'next/server';

const GROQ_KEYS = [
  process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
].filter(Boolean) as string[];

async function getSpeech(text: string): Promise<NextResponse> {
  if (!text) return NextResponse.json({ useBrowserTTS: true });

  for (const key of GROQ_KEYS) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'playai-tts',
          input: text.substring(0, 2000),
          voice: 'Basil-PlayAI',
          response_format: 'wav',
        }),
      });

      if (response.status === 429) continue;

      if (response.ok) {
        const audioBuffer = await response.arrayBuffer();
        return new NextResponse(audioBuffer, {
          headers: {
            'Content-Type': 'audio/wav',
            'Cache-Control': 'no-store',
            'Accept-Ranges': 'bytes',
          },
        });
      }
    } catch { continue; }
  }

  return NextResponse.json({ useBrowserTTS: true });
}

// GET — para iOS Safari (src directo en <audio>)
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const text = url.searchParams.get('text') ?? '';
    return await getSpeech(text);
  } catch (error) {
    console.error('Speech GET error:', error);
    return NextResponse.json({ useBrowserTTS: true });
  }
}

// POST — para desktop
export async function POST(req: Request) {
  try {
    const { text } = await req.json();
    return await getSpeech(text ?? '');
  } catch (error) {
    console.error('Speech POST error:', error);
    return NextResponse.json({ useBrowserTTS: true });
  }
}
