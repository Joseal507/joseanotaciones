import { NextRequest, NextResponse } from 'next/server';
import { calcularNivel } from '@/lib/nivelUtils';
import { requireAuthenticatedStudyALUser } from '@/lib/auth/studyalUser';
import {
  resolveServerXPAmount,
  xpEventId,
  xpSourceForAction,
  type XPAction,
  type XPEventRequest,
} from '@/lib/xpEvents';
import { workerAuthHeaders } from '@/lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

function parseBreakdown(value: unknown): Record<string, number> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, number>;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

async function worker(path: string, init?: RequestInit) {
  if (!API) throw new Error('STUDYAL_API_URL_not_configured');
  const response = await fetch(`${API}${path}`, { cache: 'no-store', ...init, headers: workerAuthHeaders(init?.headers) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || 'xp_worker_failed');
  return data;
}

async function getEntry(userId: string) {
  return (await worker(`/leaderboard/by-user?userId=${encodeURIComponent(userId)}`)).entry || null;
}

function dailyPrizes(streak: number): number[] {
  if (streak >= 30) return [500, -100, 1000, 250, 750, -200, 400, 300];
  if (streak >= 14) return [150, -50, 300, 100, 500, -75, 200, 125];
  if (streak >= 5) return [50, -20, 100, 40, 200, -30, 75, 60];
  return [15, -10, 30, 20, 50, -15, 25, 10];
}

export async function GET() {
  try {
    const user = await requireAuthenticatedStudyALUser();
    const entry = await getEntry(user.id);
    const xpTotal = Number(entry?.xp_total ?? 0);
    return NextResponse.json({
      ok: true,
      xp_total: xpTotal,
      nivel: calcularNivel(xpTotal),
      xp_breakdown: parseBreakdown(entry?.xp_breakdown),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'xp_read_failed';
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHENTICATED' ? 401 : 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthenticatedStudyALUser();
    const body = await req.json().catch(() => ({})) as Partial<XPEventRequest>;
    const action = body.action as XPAction;
    const serverDate = new Date().toISOString().slice(0, 10);
    const entityId = action === 'daily_streak' || action === 'daily_reward_claimed'
      ? serverDate
      : String(body.entityId || '').trim();
    const eventId = xpEventId(action, entityId);
    const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
    const current = await getEntry(user.id);
    const streak = Number(current?.racha_actual ?? 0);
    const amount = resolveServerXPAmount(action, metadata, {
      streak,
      allowedDailyPrizes: dailyPrizes(streak),
    });
    const previousTotal = Number(current?.xp_total ?? 0);
    const result = await worker('/xp/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_id: user.id,
        event_id: eventId,
        source: xpSourceForAction(action),
        action,
        entity_type: body.entityType || null,
        entity_id: entityId,
        amount,
        metadata,
        email: user.email,
        nombre: user.name,
        avatar_url: user.image,
      }),
    });
    const totalXP = Number(result.total_xp ?? previousTotal);
    const previousLevel = calcularNivel(previousTotal);
    const level = calcularNivel(totalXP);
    return NextResponse.json({
      success: true,
      applied: Boolean(result.applied),
      eventId,
      awardedXP: result.applied ? amount : 0,
      totalXP,
      nivel: level,
      subioNivel: level > previousLevel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'xp_award_failed';
    const status = message === 'UNAUTHENTICATED' ? 401 : message.startsWith('xp_invalid_') || message === 'xp_action_not_supported' || message === 'xp_entity_id_required' ? 400 : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
