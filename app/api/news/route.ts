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

