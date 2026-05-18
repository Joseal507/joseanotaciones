import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const { data: userData } = await supabaseAdmin.auth.getUser(token);
    if (!userData?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const userId = userData.user.id;

    // Obtener TODOS los chats donde participa el usuario (sin filtrar deleted_at)
    const { data: chats } = await supabaseAdmin
      .from('partner_chats')
      .select('id, user1_id, user2_id')
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

    if (!chats || chats.length === 0) {
      return NextResponse.json({ unread: [] });
    }

    const chatIds = chats.map(c => c.id);

    // Mensajes no leídos enviados por otros
    const { data: msgs } = await supabaseAdmin
      .from('partner_messages')
      .select('id, chat_id, sender_id, content, created_at')
      .in('chat_id', chatIds)
      .neq('sender_id', userId)
      .is('read_at', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!msgs || msgs.length === 0) {
      return NextResponse.json({ unread: [] });
    }

    // Agrupar por chat
    const porChat: Record<string, any[]> = {};
    msgs.forEach((m: any) => {
      if (!porChat[m.chat_id]) porChat[m.chat_id] = [];
      porChat[m.chat_id].push(m);
    });

    // Obtener nombres de senders
    const senderIds = [...new Set(msgs.map((m: any) => m.sender_id))];
    const { data: perfiles } = await supabaseAdmin
      .from('leaderboard')
      .select('user_id, nombre, avatar_url')
      .in('user_id', senderIds);
    const nm: Record<string, any> = {};
    (perfiles || []).forEach((p: any) => { nm[p.user_id] = p; });

    // Para cada chat con mensajes no leídos, devolver info
    const result = Object.entries(porChat).map(([chatId, mensajes]) => {
      const primer = mensajes[0];
      return {
        chat_id: chatId,
        sender_id: primer.sender_id,
        sender_nombre: nm[primer.sender_id]?.nombre || 'Partner',
        sender_avatar: nm[primer.sender_id]?.avatar_url || null,
        count: mensajes.length,
        last_content: primer.content,
        last_at: primer.created_at,
      };
    });

    return NextResponse.json({ unread: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
