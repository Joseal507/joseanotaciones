import fs from "fs";

function w(path, content) {
  fs.writeFileSync(path, content.trimStart() + "\n");
  console.log("updated", path);
}

w("app/api/comunidad/posts/route.ts", `
import { NextRequest, NextResponse } from 'next/server';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';

async function proxy(path: string, init?: RequestInit) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(API + path, { ...init, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search || '';
  return proxy('/comunidad-posts' + qs);
}

export async function POST(req: NextRequest) {
  return proxy('/comunidad-posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(await req.json()),
  });
}

export async function DELETE(req: NextRequest) {
  const qs = req.nextUrl.search || '';
  return proxy('/comunidad-posts' + qs, { method: 'DELETE' });
}

export async function PATCH(req: NextRequest) {
  return proxy('/comunidad-posts', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(await req.json()),
  });
}
`);

w("app/api/comunidad/comentarios/route.ts", `
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
`);

w("app/api/comunidad/likes/route.ts", `
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
`);

w("app/api/news/route.ts", `
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';
const ADMIN_EMAIL = 'jose.alberto.deobaldia@gmail.com';

async function isAdmin() {
  const session = await getServerSession(authOptions);
  return String(session?.user?.email || '').toLowerCase() === ADMIN_EMAIL;
}

export async function GET() {
  try {
    if (!API) return NextResponse.json({ success: true, news: [] });
    const res = await fetch(API + '/news', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message, news: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });
    }
    if (!API) throw new Error('STUDYAL_API_URL no configurado');

    const body = await req.json();
    const res = await fetch(API + '/news', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...body,
        autor: 'Joseal',
        autor_email: ADMIN_EMAIL,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });
    }
    if (!API) throw new Error('STUDYAL_API_URL no configurado');

    const id = req.nextUrl.searchParams.get('id');
    const res = await fetch(API + '/news?id=' + encodeURIComponent(id || ''), { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message });
  }
}
`);
