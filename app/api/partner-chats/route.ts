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

export async function GET(req: NextRequest) {
  try {
    const user = await getUser(req);
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    // Limpiar mensajes expirados globalmente
    await supabaseAdmin.from('partner_messages')
      .update({ deleted_at: new Date().toISOString(), content: 'Mensaje expirado' })
      .lt('expires_at', new Date().toISOString())
      .is('deleted_at', null);

    const { data: chats } = await supabaseAdmin
      .from('partner_chats')
      .select('*')
      .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
      .order('last_message_at', { ascending: false });

    const result = [];
    for (const chat of chats || []) {
      const isUser1 = chat.user1_id === user.id;
      if (isUser1 && chat.user1_deleted_at) continue;
      if (!isUser1 && chat.user2_deleted_at) continue;

      const partnerId = isUser1 ? chat.user2_id : chat.user1_id;
      const { data: lb } = await supabaseAdmin.from('leaderboard')
        .select('user_id,nombre,avatar_url,carrera,universidad,tipo_estudiante,xp_total,racha_actual,flashcards_estudiadas,precision_global,descripcion')
        .eq('user_id', partnerId).maybeSingle();

      const { count: unread } = await supabaseAdmin.from('partner_messages')
        .select('*', { count: 'exact', head: true })
        .eq('chat_id', chat.id).neq('sender_id', user.id)
        .is('read_at', null).is('deleted_at', null);

      const { count: savedCount } = await supabaseAdmin.from('partner_saved_messages')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id).eq('chat_id', chat.id);

      result.push({
        ...chat,
        partner: lb || { user_id: partnerId, nombre: 'Usuario' },
        unread: unread || 0,
        savedCount: savedCount || 0,
      });
    }

    return NextResponse.json({ success: true, chats: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
