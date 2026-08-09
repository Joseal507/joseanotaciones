import { NextResponse } from 'next/server';

async function getSpeech(text: string): Promise<NextResponse> {
  void text;
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
