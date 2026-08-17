import { NextRequest, NextResponse } from 'next/server';
import { workerAuthHeaders } from '../../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

export async function POST(req: NextRequest) {
  try {
    if (!API) throw new Error('STUDYAL_API_URL no configurado');
    const body = await req.json();
    const res = await fetch(API + '/comunidad-views/increment', {
      method: 'POST',
      headers: workerAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

