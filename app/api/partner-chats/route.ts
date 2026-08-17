import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';
import { workerAuthHeaders } from '../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

async function apiGet(path: string) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(`${API}${path}`, { cache: 'no-store', headers: workerAuthHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost(path: string, body: any) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: workerAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function GET() {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    await apiPost('/partner-messages/expire', {});

    const chatsRes = await apiGet(`/partner-chats/by-user?userId=${encodeURIComponent(user.id)}`);
    const chats = chatsRes.chats || [];
    const result: any[] = [];

    for (const chat of chats) {
      const isUser1 = chat.user1_id === user.id;
      if (isUser1 && chat.user1_deleted_at) continue;
      if (!isUser1 && chat.user2_deleted_at) continue;

      const partnerId = isUser1 ? chat.user2_id : chat.user1_id;

      const lbRes = await apiGet(`/leaderboard/by-user?userId=${encodeURIComponent(partnerId)}`);
      const unreadRes = await apiGet(`/partner-messages/unread-count?chatId=${encodeURIComponent(chat.id)}&userId=${encodeURIComponent(user.id)}`);
      const savedRes = await apiGet(`/partner-saved-messages/count?chatId=${encodeURIComponent(chat.id)}&userId=${encodeURIComponent(user.id)}`);

      result.push({
        ...chat,
        partner: lbRes.entry || { user_id: partnerId, nombre: 'Usuario' },
        unread: unreadRes.count || 0,
        savedCount: savedRes.count || 0,
      });
    }

    return NextResponse.json({ success: true, chats: result });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error interno' }, { status: 500 });
  }
}
