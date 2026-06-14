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

async function getPartnerInfo(userId: string) {
  const res = await apiGet(`/leaderboard/by-user?userId=${encodeURIComponent(userId)}`);
  return res.entry || { user_id: userId, nombre: 'Usuario' };
}

export async function GET() {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const res = await apiGet(`/partners/by-user?userId=${encodeURIComponent(user.id)}`);
    const all = res.partners || [];

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
    return NextResponse.json({ error: err?.message || 'Error interno' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = await req.json();

    if (body.action === 'block') {
      const { blocked_id } = body;
      if (!blocked_id) return NextResponse.json({ error: 'blocked_id requerido' }, { status: 400 });

      await apiPost('/partners/delete-between', {
        user_id: user.id,
        other_id: blocked_id,
      });

      await apiPost('/partner-blocks/upsert', {
        blocker_id: user.id,
        blocked_id,
      });

      return NextResponse.json({ success: true, message: 'Usuario bloqueado' });
    }

    if (body.action === 'report') {
      const { reported_id, motivo, detalles } = body;
      if (!reported_id || !motivo) return NextResponse.json({ error: 'Faltan campos' }, { status: 400 });

      await apiPost('/partner-reports/upsert', {
        reporter_id: user.id,
        reported_id,
        motivo,
        detalles: detalles || null,
      });

      return NextResponse.json({ success: true, message: 'Reporte enviado' });
    }

    const { receiver_id } = body;
    if (!receiver_id) return NextResponse.json({ error: 'receiver_id requerido' }, { status: 400 });
    if (receiver_id === user.id) return NextResponse.json({ error: 'No puedes agregarte' }, { status: 400 });

    const block = await apiGet(`/partner-blocks/check?blockerId=${encodeURIComponent(receiver_id)}&blockedId=${encodeURIComponent(user.id)}`);
    if (block.blocked) {
      return NextResponse.json({ error: 'No puedes enviar solicitud a este usuario' }, { status: 403 });
    }

    const existingRes = await apiGet(`/partners/by-user?userId=${encodeURIComponent(user.id)}`);
    const existing = (existingRes.partners || []).find((p: any) =>
      (p.sender_id === user.id && p.receiver_id === receiver_id) ||
      (p.sender_id === receiver_id && p.receiver_id === user.id)
    );

    if (existing) {
      if (existing.status === 'accepted') return NextResponse.json({ error: 'Ya son partners' }, { status: 400 });
      if (existing.status === 'pending') return NextResponse.json({ error: 'Solicitud ya enviada' }, { status: 400 });

      await apiPost('/partners/upsert', {
        id: existing.id,
        sender_id: user.id,
        receiver_id,
        status: 'pending',
      });

      return NextResponse.json({ success: true, message: 'Solicitud reenviada' });
    }

    await apiPost('/partners/upsert', {
      sender_id: user.id,
      receiver_id,
      status: 'pending',
    });

    return NextResponse.json({ success: true, message: 'Solicitud enviada' });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error interno' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { partner_id, action } = await req.json();
    if (!partner_id || !action) return NextResponse.json({ error: 'Faltan campos' }, { status: 400 });

    const allRes = await apiGet(`/partners/by-user?userId=${encodeURIComponent(user.id)}`);
    const partner = (allRes.partners || []).find((p: any) => p.id === partner_id);

    if (!partner) return NextResponse.json({ error: 'Partner no encontrado' }, { status: 404 });

    if (action === 'accept') {
      if (partner.receiver_id !== user.id) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });

      await apiPost('/partners/update', {
        id: partner_id,
        status: 'accepted',
      });

      await apiPost('/partner-chats/create-between', {
        user1_id: partner.sender_id,
        user2_id: partner.receiver_id,
      });

      return NextResponse.json({ success: true });
    }

    if (action === 'reject') {
      if (partner.receiver_id !== user.id) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });

      await apiPost('/partners/update', {
        id: partner_id,
        status: 'rejected',
      });

      return NextResponse.json({ success: true });
    }

    if (action === 'remove') {
      if (partner.sender_id !== user.id && partner.receiver_id !== user.id) {
        return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
      }

      await apiPost('/partners/update', {
        id: partner_id,
        status: 'rejected',
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Acción inválida' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error interno' }, { status: 500 });
  }
}
