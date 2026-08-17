import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedStudyALUser } from '../../../../lib/auth/studyalUser';
import { workerAuthHeaders } from '../../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

async function proxy(path: string, init?: RequestInit) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(API + path, { ...init, cache: 'no-store', headers: workerAuthHeaders(init?.headers) });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

export async function GET(req: NextRequest) {
  return proxy('/comunidad-comentarios' + (req.nextUrl.search || ''));
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedStudyALUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  return proxy('/comunidad-comentarios', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...body,
      user_id: user.id,
      user_nombre: body.user_nombre || user.name || user.email?.split('@')[0] || 'Usuario',
      user_avatar: body.user_avatar || user.image,
    }),
  });
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthenticatedStudyALUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  return proxy('/comunidad-comentarios', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, user_id: user.id }),
  });
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthenticatedStudyALUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const params = new URLSearchParams(req.nextUrl.searchParams);
  params.delete('userId');
  params.set('userId', user.id);
  return proxy(`/comunidad-comentarios?${params.toString()}`, { method: 'DELETE' });
}
