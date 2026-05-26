import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const getUser = async (req: NextRequest) => {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
};

const getPartnerInfo = async (userId: string) => {
  const { data } = await supabaseAdmin
    .from('leaderboard')
    .select('user_id,nombre,avatar_url,carrera,universidad,tipo_estudiante,xp_total,racha_actual,flashcards_estudiadas,precision_global,descripcion')
    .eq('user_id', userId)
    .maybeSingle();
  return data || { user_id: userId, nombre: 'Usuario' };
};

export async function GET(req: NextRequest) {
  try {
    const user = await getUser(req);
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { data: rows } = await supabaseAdmin
      .from('partners')
      .select('*')
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order('created_at', { ascending: false });

    const all = rows || [];
    const partners: any[] = [];
    const solicitudes: any[] = [];
    const enviadas: any[] = [];

    for (const row of all) {
      const otherId = row.sender_id === user.id ? row.receiver_id : row.sender_id;
      const info = await getPartnerInfo(otherId);
      const enriched = { ...row, partner: info };
      if (row.status === 'accepted') partners.push(enriched);
      else if (row.status === 'pending' && row.receiver_id === user.id) solicitudes.push(enriched);
      else if (row.status === 'pending' && row.sender_id === user.id) enviadas.push(enriched);
    }

    return NextResponse.json({ success: true, partners, solicitudes, enviadas });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUser(req);
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = await req.json();

    // ── BLOQUEAR ──
    if (body.action === 'block') {
      const { blocked_id } = body;
      if (!blocked_id) return NextResponse.json({ error: 'blocked_id requerido' }, { status: 400 });

      // Eliminar partnership si existe
      await supabaseAdmin.from('partners').delete()
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${blocked_id}),and(sender_id.eq.${blocked_id},receiver_id.eq.${user.id})`);

      // Insertar bloqueo
      await supabaseAdmin.from('partner_blocks').upsert({
        blocker_id: user.id,
        blocked_id,
      }, { onConflict: 'blocker_id,blocked_id' });

      return NextResponse.json({ success: true, message: 'Usuario bloqueado' });
    }

    // ── REPORTAR ──
    if (body.action === 'report') {
      const { reported_id, motivo, detalles } = body;
      if (!reported_id || !motivo) return NextResponse.json({ error: 'Faltan campos' }, { status: 400 });

      await supabaseAdmin.from('partner_reports').insert({
        reporter_id: user.id,
        reported_id,
        motivo,
        detalles: detalles || null,
      });

      return NextResponse.json({ success: true, message: 'Reporte enviado' });
    }

    // ── ENVIAR SOLICITUD ──
    const { receiver_id } = body;
    if (!receiver_id) return NextResponse.json({ error: 'receiver_id requerido' }, { status: 400 });
    if (receiver_id === user.id) return NextResponse.json({ error: 'No puedes agregarte' }, { status: 400 });

    // Verificar si está bloqueado
    const { data: block } = await supabaseAdmin.from('partner_blocks').select('id')
      .eq('blocker_id', receiver_id).eq('blocked_id', user.id).maybeSingle();
    if (block) return NextResponse.json({ error: 'No puedes enviar solicitud a este usuario' }, { status: 403 });

    // Buscar relación existente (cualquier status)
    const { data: existing } = await supabaseAdmin
      .from('partners')
      .select('*')
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${receiver_id}),and(sender_id.eq.${receiver_id},receiver_id.eq.${user.id})`)
      .maybeSingle();

    if (existing) {
      if (existing.status === 'accepted') return NextResponse.json({ error: 'Ya son partners' }, { status: 400 });
      if (existing.status === 'pending') return NextResponse.json({ error: 'Solicitud ya enviada' }, { status: 400 });
      // Si fue rechazado o eliminado, actualizar a pending para re-agregar
      await supabaseAdmin.from('partners').update({
        status: 'pending',
        sender_id: user.id,
        receiver_id,
        updated_at: new Date().toISOString()
      }).eq('id', existing.id);
      return NextResponse.json({ success: true, message: 'Solicitud reenviada' });
    }

    const { error } = await supabaseAdmin.from('partners').insert({
      sender_id: user.id, receiver_id, status: 'pending'
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, message: 'Solicitud enviada' });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getUser(req);
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { partner_id, action } = await req.json();
    if (!partner_id || !action) return NextResponse.json({ error: 'Faltan campos' }, { status: 400 });

    if (action === 'accept') {
      const { error } = await supabaseAdmin.from('partners')
        .update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('id', partner_id).eq('receiver_id', user.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const { data: row } = await supabaseAdmin.from('partners').select('sender_id,receiver_id').eq('id', partner_id).single();
      if (row) {
        const [u1, u2] = [row.sender_id, row.receiver_id].sort();
        await supabaseAdmin.from('partner_chats').upsert({ user1_id: u1, user2_id: u2 }, { onConflict: 'user1_id,user2_id' });
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'reject') {
      await supabaseAdmin.from('partners')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', partner_id).eq('receiver_id', user.id);
      return NextResponse.json({ success: true });
    }

    if (action === 'remove') {
      // Marcar como rejected en vez de eliminar para permitir re-agregar
      await supabaseAdmin.from('partners')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', partner_id)
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Acción inválida' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
