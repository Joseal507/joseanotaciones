import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tipo = searchParams.get('tipo');

    let query = supabase
      .from('comunidad_posts')
      .select('*')
      .order('created_at', { ascending: false });

    if (tipo && tipo !== 'todo' && tipo !== 'mis_posts') {
      if (tipo === 'flashcards' || tipo === 'flashcard') {
        query = query.in('tipo', ['flashcard', 'flashcards']);
      } else {
        query = query.eq('tipo', tipo);
      }
    }

    const { data: posts, error: postError } = await query;
    if (postError) throw postError;

    const userIds = [...new Set((posts || []).map((p: any) => p.user_id).filter(Boolean))];

    let perfilesMap: any = {};

    if (userIds.length > 0) {
      // 1) Buscar en user_profiles
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, nombre, foto_url, carrera, universidad')
        .in('id', userIds);

      profiles?.forEach((p: any) => {
        perfilesMap[p.id] = {
          id: p.id,
          nombre: p.nombre || '',
          avatar_url: p.foto_url || null,
          carrera: p.carrera || null,
          universidad: p.universidad || null,
        };
      });

      // 2) Fallback: buscar en auth.users si falta nombre
      for (const uid of userIds) {
        if (!perfilesMap[uid]?.nombre) {
          try {
            const { data: authUserData, error: authErr } = await supabase.auth.admin.getUserById(uid);
            if (!authErr && authUserData?.user) {
              const u: any = authUserData.user;
              const meta = u.user_metadata || {};
              perfilesMap[uid] = {
                ...(perfilesMap[uid] || {}),
                id: uid,
                nombre:
                  perfilesMap[uid]?.nombre ||
                  meta.nombre ||
                  meta.name ||
                  meta.full_name ||
                  (u.email ? String(u.email).split('@')[0] : '') ||
                  'Estudiante',
                avatar_url:
                  perfilesMap[uid]?.avatar_url ||
                  meta.avatar_url ||
                  meta.picture ||
                  null,
                carrera: perfilesMap[uid]?.carrera || null,
                universidad: perfilesMap[uid]?.universidad || null,
              };
            }
          } catch (e) {
            // no-op
          }
        }
      }
    }

    const finalData = (posts || []).map((p: any) => ({
      ...p,
      user_profiles: perfilesMap[p.user_id] || {
        nombre: 'Estudiante',
        avatar_url: null,
        carrera: null,
        universidad: null,
      },
    }));

    return NextResponse.json({ success: true, data: finalData });
  } catch (err: any) {
    console.error('API GET ERROR:', err);
    return NextResponse.json({ success: false, data: [], error: err.message });
  }
}

// ─────────────────────────────────────────────
// Helpers para subir imágenes/base64 a Storage
// ─────────────────────────────────────────────

async function subirBase64(base64: string, path: string): Promise<string> {
  try {
    const base64Data = base64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const mime = base64.match(/data:([^;]+);/)?.[1] || 'image/png';
    const ext = mime.split('/')[1] || 'png';
    const filePath = `${path}.${ext}`;

    const { error } = await supabase.storage
      .from('comunidad')
      .upload(filePath, buffer, {
        contentType: mime,
        upsert: true,
      });

    if (error) throw error;

    return supabase.storage.from('comunidad').getPublicUrl(filePath).data.publicUrl;
  } catch (e) {
    console.error('Error subiendo imagen:', e);
    return '';
  }
}

async function procesarContenido(contenido: any, userId: string): Promise<any> {
  if (!contenido || typeof contenido !== 'object') return contenido;

  if (contenido.paginas && Array.isArray(contenido.paginas)) {
    const paginas = await Promise.all(
      contenido.paginas.map(async (pag: any, pi: number) => {
        const nuevaPag = { ...pag };

        if (pag.canvasData && typeof pag.canvasData === 'string' && pag.canvasData.startsWith('data:')) {
          const url = await subirBase64(
            pag.canvasData,
            `apuntes/${userId}/${Date.now()}_p${pi}_canvas`
          );
          nuevaPag.canvasData = url || null;
        }

        if (Array.isArray(pag.bloques)) {
          nuevaPag.bloques = await Promise.all(
            pag.bloques.map(async (b: any, bi: number) => {
              if (b.tipo === 'imagen' && b.src && typeof b.src === 'string' && b.src.startsWith('data:')) {
                const url = await subirBase64(
                  b.src,
                  `apuntes/${userId}/${Date.now()}_p${pi}_b${bi}`
                );
                return { ...b, src: url };
              }
              return b;
            })
          );
        }

        return nuevaPag;
      })
    );

    return { ...contenido, paginas };
  }

  return contenido;
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    const body = await req.json();

    const {
      data: { user },
    } = await supabase.auth.getUser(auth || '');

    if (!user) {
      return NextResponse.json({ error: 'No user' }, { status: 401 });
    }

    const contenidoProcesado = await procesarContenido(body.contenido || {}, user.id);

    const { data, error } = await supabase
      .from('comunidad_posts')
      .insert({
        user_id: user.id,
        tipo: body.tipo || 'apunte',
        titulo: body.titulo,
        descripcion: body.descripcion || '',
        materia: body.materia || 'General',
        emoji: body.emoji || '📚',
        color: body.color || '#f5c842',
        imagen_url: body.imagen_url || '',
        contenido: contenidoProcesado,
        es_publico: true,
      })
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('API POST ERROR:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
