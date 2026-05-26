import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const ADMIN_EMAIL = 'jose.alberto.deobaldia@gmail.com';

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getCurrentUserEmail(req: NextRequest): Promise<string | null> {
  try {
    const authHeader = req.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '');

    if (!token) {
      const cookieStore = await cookies();
      const allCookies = cookieStore.getAll();
      const authCookie = allCookies.find(c => c.name.includes('auth-token'));
      if (authCookie) {
        try {
          const parsed = JSON.parse(authCookie.value);
          token = parsed?.access_token;
        } catch {}
      }
    }

    if (!token) return null;
    const { data, error } = await adminClient.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.email || null;
  } catch { return null; }
}

export async function GET() {
  try {
    const { data, error } = await adminClient
      .from('news')
      .select('*')
      .order('destacada', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ success: true, news: data || [] });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message, news: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const email = await getCurrentUserEmail(req);
    if (!email || email.toLowerCase() !== ADMIN_EMAIL) {
      return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });
    }

    const body = await req.json();
    const { titulo, descripcion, contenido, tipo, media_url, categoria, destacada } = body;

    if (!titulo || !descripcion || !media_url) {
      return NextResponse.json({ success: false, error: 'Faltan campos requeridos' }, { status: 400 });
    }

    const { data, error } = await adminClient
      .from('news')
      .insert({
        titulo, descripcion, contenido: contenido || '',
        tipo: tipo || 'foto', media_url,
        categoria: categoria || 'general',
        destacada: !!destacada,
        autor: 'Joseal',
        autor_email: email,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, news: data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const email = await getCurrentUserEmail(req);
    if (!email || email.toLowerCase() !== ADMIN_EMAIL) {
      return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });
    }

    const id = req.nextUrl.searchParams.get('id');
    if (!id) throw new Error('id requerido');

    // Buscar la noticia para borrar el archivo
    const { data: news } = await adminClient.from('news').select('media_url').eq('id', id).single();
    if (news?.media_url) {
      const url = news.media_url;
      const match = url.match(/news_media\/(.+)$/);
      if (match) {
        try { await adminClient.storage.from('news_media').remove([match[1]]); } catch {}
      }
    }

    const { error } = await adminClient.from('news').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message });
  }
}
