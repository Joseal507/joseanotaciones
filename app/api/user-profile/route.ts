import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId requerido' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('GET user-profile error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: data || null });
  } catch (err: any) {
    console.error('GET error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !userData.user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    const body = await req.json();
    const userId = userData.user.id;

    const profileData = {
      id: userId,
      nombre: body.nombre,
      email: userData.user.email,
      genero: body.genero,
      tipo_estudiante: body.tipo_estudiante,
      universidad: body.universidad || null,
      carrera: body.carrera || null,
      que_quieres_estudiar: body.que_quieres_estudiar || null,
      avatar_url: body.avatar_url || null,
      onboarding_completo: true,
      updated_at: new Date().toISOString(),
    };

    console.log('Guardando perfil:', profileData);

    const { error } = await supabaseAdmin
      .from('user_profiles')
      .upsert(profileData, { onConflict: 'id' });

    if (error) {
      console.error('Upsert error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('Perfil guardado OK para:', userId);

    // ✅ Enviar email con todos los datos
    if (body.es_nuevo) {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://studyals.vercel.app';
        const emailRes = await fetch(`${baseUrl}/api/notify-new-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nombre: body.nombre,
            email: userData.user.email,
            genero: body.genero,
            tipo_estudiante: body.tipo_estudiante,
            universidad: body.universidad || null,
            carrera: body.carrera || null,
            que_quieres_estudiar: body.que_quieres_estudiar || null,
            es_nuevo: true,
          }),
        });
        const emailData = await emailRes.json();
        console.log('Email enviado:', emailData);
      } catch (emailErr) {
        console.error('Error enviando email:', emailErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('POST error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}