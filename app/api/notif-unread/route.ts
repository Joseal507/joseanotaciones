import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';

async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

export async function GET() {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!API) return NextResponse.json({ unread: [] });

    const chatsRes = await fetch(`${API}/partner-chats/by-user?userId=${encodeURIComponent(user.id)}`, { cache: 'no-store' });
    const chatsData = await chatsRes.json().catch(() => ({}));
    const chats = chatsData?.chats || [];

    if (!chats.length) return NextResponse.json({ unread: [] });

    const groups: Record<string, any[]> = {};

    await Promise.all(chats.map(async (chat: any) => {
      const msgRes = await fetch(`${API}/partner-messages/by-chat?chatId=${encodeURIComponent(chat.id)}`, { cache: 'no-store' });
      const msgData = await msgRes.json().catch(() => ({}));
      const unread = (msgData?.messages || [])
        .filter((m: any) => m.sender_id !== user.id && !m.read_at && !m.deleted_at)
        .sort((a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(0, 50);

      if (unread.length) groups[chat.id] = unread;
    }));

    const senderIds = Array.from(new Set(Object.values(groups).flat().map((m: any) => m.sender_id)));
    const profileMap: Record<string, any> = {};

    await Promise.all(senderIds.map(async (id) => {
      const res = await fetch(`${API}/leaderboard/by-user?userId=${encodeURIComponent(String(id))}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (data?.entry) profileMap[String(id)] = data.entry;
    }));

    const unread = Object.entries(groups).map(([chatId, mensajes]) => {
      const primer = mensajes[0];
      const p = profileMap[primer.sender_id] || {};
      return {
        chat_id: chatId,
        sender_id: primer.sender_id,
        sender_nombre: p.nombre || 'Partner',
        sender_avatar: p.avatar_url || null,
        count: mensajes.length,
        last_content: primer.content,
        last_at: primer.created_at,
      };
    });

    return NextResponse.json({ unread });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

