import { NextRequest, NextResponse } from 'next/server';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';

async function proxy(path: string, init?: RequestInit) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(API + path, { ...init, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

export async function GET(req: NextRequest) {
  return proxy('/comunidad-comentarios' + (req.nextUrl.search || ''));
}

export async function POST(req: NextRequest) {
  return proxy('/comunidad-comentarios', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(await req.json()),
  });
}

export async function PATCH(req: NextRequest) {
  return proxy('/comunidad-comentarios', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(await req.json()),
  });
}

export async function DELETE(req: NextRequest) {
  return proxy('/comunidad-comentarios' + (req.nextUrl.search || ''), { method: 'DELETE' });
}

