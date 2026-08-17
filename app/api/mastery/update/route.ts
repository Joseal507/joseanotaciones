import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth/options';
import { workerAuthHeaders } from '../../../../lib/worker/auth';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { sessionKey, masteryData } = body;

    if (!sessionKey || !masteryData) {
      return NextResponse.json({ success: false, error: 'Missing data' }, { status: 400 });
    }

    const userId = (session.user as any).id;
    const studyApiUrl = process.env.STUDYAL_API_URL;
    const studyApiKey = process.env.STUDYAL_API_KEY;

    if (studyApiUrl && studyApiKey) {
      try {
        const overallMastery = masteryData.concepts?.length > 0
          ? Math.round(
              masteryData.concepts.reduce((sum: number, c: any) =>
                sum + (
                  (c.understanding || 0) * 0.25 +
                  (c.memory || 0) * 0.20 +
                  (c.application || 0) * 0.20 +
                  (c.explanation || 0) * 0.15 +
                  (c.exam || 0) * 0.20
                ), 0
              ) / masteryData.concepts.length
            )
          : 0;

        await fetch(`${studyApiUrl}/study-sessions`, {
          method: 'POST',
          headers: workerAuthHeaders({
            'Content-Type': 'application/json',
            'X-API-Key': studyApiKey,
          }),
          body: JSON.stringify({
            user_id: userId,
            session_key: sessionKey,
            mastery_data: JSON.stringify(masteryData),
            overall_mastery: overallMastery,
            concepts_count: masteryData.concepts?.length || 0,
            tools_completed: Object.values(masteryData.toolsCompleted || {}).filter(Boolean).length,
            updated_at: new Date().toISOString(),
          }),
        });
      } catch (dbErr) {
        // Non-critical — localStorage es la fuente principal
        console.warn('Mastery DB sync failed (non-critical):', dbErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Mastery update error:', err);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const sessionKey = searchParams.get('sessionKey');

    if (!sessionKey) {
      return NextResponse.json({ success: false, error: 'Missing sessionKey' }, { status: 400 });
    }

    const userId = (session.user as any).id;
    const studyApiUrl = process.env.STUDYAL_API_URL;
    const studyApiKey = process.env.STUDYAL_API_KEY;

    if (studyApiUrl && studyApiKey) {
      try {
        const res = await fetch(
          `${studyApiUrl}/study-sessions?user_id=${encodeURIComponent(userId)}&session_key=${encodeURIComponent(sessionKey)}`,
          {
            headers: workerAuthHeaders({ 'X-API-Key': studyApiKey }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (data?.mastery_data) {
            return NextResponse.json({
              success: true,
              masteryData: JSON.parse(data.mastery_data),
            });
          }
        }
      } catch {}
    }

    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  } catch (err) {
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
