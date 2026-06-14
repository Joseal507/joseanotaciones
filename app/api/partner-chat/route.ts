import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';

const API = process.env.STUDYAL_API_URL || '';

async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

async function apiGet(path: string) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(`${API}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost(path: string, body: any) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const plus24h = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

function canAccessChat(chat: any, userId: string) {
  return chat && (chat.user1_id === userId || chat.user2_id === userId);
}

async function resolveChat(userId: string, chatId?: string | null, partnerId?: string | null) {
  if (chatId) {
    const res = await apiGet(`/partner-chats/by-id?chatId=${encodeURIComponent(chatId)}`);
    return res.chat || null;
  }

  if (partnerId) {
    const existing = await apiGet(`/partner-chats/by-users?user1=${encodeURIComponent(userId)}&user2=${encodeURIComponent(partnerId)}`);
    if (existing.chat) return existing.chat;

    const created = await apiPost('/partner-chats/create-between', {
      user1_id: userId,
      user2_id: partnerId,
    });
    return created.chat || null;
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get('chatId');
    const partnerId = searchParams.get('partnerId');
    const getSaved = searchParams.get('saved') === 'true';

    await apiPost('/partner-messages/expire', {});

    const chat = await resolveChat(user.id, chatId, partnerId);
    if (!chat) {
      return NextResponse.json({ success: true, messages: [], chatId: null, saved: [], chat: null });
    }

    if (!canAccessChat(chat, user.id)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
    }

    const messagesRes = await apiGet(`/partner-messages/by-chat?chatId=${encodeURIComponent(chat.id)}`);

    await apiPost('/partner-messages/mark-read', {
      chat_id: chat.id,
      user_id: user.id,
    });

    let saved: string[] = [];
    if (getSaved) {
      const savedRes = await apiGet(`/partner-saved-messages/by-chat?chatId=${encodeURIComponent(chat.id)}&userId=${encodeURIComponent(user.id)}`);
      saved = savedRes.saved || [];
    }

    return NextResponse.json({
      success: true,
      messages: messagesRes.messages || [],
      chatId: chat.id,
      saved,
      chat,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error interno' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const {
      chatId,
      partnerId,
      content,
      type = 'text',
      metadata,
      file_url,
      file_name,
      file_size,
      duration,
    } = await req.json();

    if (!content?.trim() && !file_url) {
      return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 });
    }

    const chat = await resolveChat(user.id, chatId, partnerId);
    if (!chat) return NextResponse.json({ error: 'Chat no encontrado' }, { status: 404 });

    if (!canAccessChat(chat, user.id)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
    }

    const isUser1 = chat.user1_id === user.id;
    if (isUser1 && chat.user1_deleted_at) {
      await apiPost('/partner-chats/update', {
        id: chat.id,
        set_user1_deleted_at: true,
        user1_deleted_at: null,
      });
    }

    if (!isUser1 && chat.user2_deleted_at) {
      await apiPost('/partner-chats/update', {
        id: chat.id,
        set_user2_deleted_at: true,
        user2_deleted_at: null,
      });
    }

    const msgContent = content?.trim() || file_name || 'Archivo';

    const msgRes = await apiPost('/partner-messages/upsert', {
      chat_id: chat.id,
      sender_id: user.id,
      content: msgContent,
      type,
      metadata: metadata || null,
      file_url: file_url || null,
      file_name: file_name || null,
      file_size: file_size || null,
      duration: duration || null,
      expires_at: plus24h(),
    });

    await apiPost('/partner-chats/update', {
      id: chat.id,
      last_message: msgContent.slice(0, 100),
      last_message_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, message: msgRes.message || msgRes });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error interno' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = await req.json();

    if (body.action === 'save') {
      const { message_id, chat_id } = body;
      if (!message_id || !chat_id) {
        return NextResponse.json({ error: 'Faltan campos' }, { status: 400 });
      }

      const chatRes = await apiGet(`/partner-chats/by-id?chatId=${encodeURIComponent(chat_id)}`);
      if (!canAccessChat(chatRes.chat, user.id)) {
        return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
      }

      const toggle = await apiPost('/partner-saved-messages/toggle', {
        user_id: user.id,
        message_id,
        chat_id,
      });

      await apiPost('/partner-messages/update', {
        id: message_id,
        set_expires_at: true,
        expires_at: toggle.saved ? null : plus24h(),
      });

      return NextResponse.json({ success: true, saved: !!toggle.saved });
    }

    if (body.action === 'set_wallpaper') {
      const { chat_id, wallpaper_url } = body;
      if (!chat_id) return NextResponse.json({ error: 'chat_id requerido' }, { status: 400 });

      const chatRes = await apiGet(`/partner-chats/by-id?chatId=${encodeURIComponent(chat_id)}`);
      if (!canAccessChat(chatRes.chat, user.id)) {
        return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
      }

      const clearWallpaper = !wallpaper_url || wallpaper_url === '';
      await apiPost('/partner-chats/update', {
        id: chat_id,
        set_wallpaper_url: true,
        wallpaper_url: clearWallpaper ? null : wallpaper_url,
        set_wallpaper_set_by: true,
        wallpaper_set_by: clearWallpaper ? null : user.id,
      });

      return NextResponse.json({ success: true });
    }

    if (body.action === 'edit') {
      const { message_id, content } = body;
      if (!message_id || !content?.trim()) {
        return NextResponse.json({ error: 'Faltan campos' }, { status: 400 });
      }

      const msgRes = await apiGet(`/partner-messages/by-id?id=${encodeURIComponent(message_id)}`);
      const msg = msgRes.message;
      if (!msg || msg.sender_id !== user.id) {
        return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
      }

      const diff = Date.now() - new Date(msg.created_at).getTime();
      if (diff > 15 * 60 * 1000) {
        return NextResponse.json({ error: 'Solo puedes editar mensajes recientes (15 min)' }, { status: 400 });
      }

      await apiPost('/partner-messages/update', {
        id: message_id,
        content: content.trim(),
        set_edited_at: true,
      });

      return NextResponse.json({ success: true });
    }

    if (body.action === 'delete') {
      const { message_id } = body;
      if (!message_id) return NextResponse.json({ error: 'Falta message_id' }, { status: 400 });

      const msgRes = await apiGet(`/partner-messages/by-id?id=${encodeURIComponent(message_id)}`);
      const msg = msgRes.message;
      if (!msg || msg.sender_id !== user.id) {
        return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
      }

      await apiPost('/partner-messages/update', {
        id: message_id,
        content: 'Mensaje eliminado',
        set_deleted_at: true,
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Acción inválida' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error interno' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get('chatId');
    if (!chatId) return NextResponse.json({ error: 'chatId requerido' }, { status: 400 });

    const chatRes = await apiGet(`/partner-chats/by-id?chatId=${encodeURIComponent(chatId)}`);
    const chat = chatRes.chat;
    if (!canAccessChat(chat, user.id)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
    }

    const isUser1 = chat.user1_id === user.id;
    await apiPost('/partner-chats/update', {
      id: chatId,
      set_user1_deleted_at: isUser1,
      user1_deleted_at: isUser1 ? new Date().toISOString() : undefined,
      set_user2_deleted_at: !isUser1,
      user2_deleted_at: !isUser1 ? new Date().toISOString() : undefined,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error interno' }, { status: 500 });
  }
}
