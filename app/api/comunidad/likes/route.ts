import { NextRequest, NextResponse } from 'next/server';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';

export async function POST(req: NextRequest) {
  try {
    if (!API) throw new Error('STUDYAL_API_URL no configurado');
    const res = await fetch(API + '/comunidad-likes/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(await req.json()),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

