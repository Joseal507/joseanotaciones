import fs from "fs";

function w(path, content) {
  fs.writeFileSync(path, content.trimStart() + "\n");
  console.log("updated", path);
}

w("app/api/comunidad/guardados/route.ts", `
import { NextRequest, NextResponse } from 'next/server';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';

export async function POST(req: NextRequest) {
  try {
    if (!API) throw new Error('STUDYAL_API_URL no configurado');
    const body = await req.json();
    const res = await fetch(API + '/comunidad-guardados/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
`);

w("app/api/comunidad/ratings/route.ts", `
import { NextRequest, NextResponse } from 'next/server';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';

export async function POST(req: NextRequest) {
  try {
    if (!API) throw new Error('STUDYAL_API_URL no configurado');
    const body = await req.json();
    const res = await fetch(API + '/comunidad-ratings/upsert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
`);

w("app/api/comunidad/views/route.ts", `
import { NextRequest, NextResponse } from 'next/server';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';

export async function POST(req: NextRequest) {
  try {
    if (!API) throw new Error('STUDYAL_API_URL no configurado');
    const body = await req.json();
    const res = await fetch(API + '/comunidad-views/increment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
`);
