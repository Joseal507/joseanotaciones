import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';

async function getUserId() {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;
  return user?.id || null;
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId();
    if (!userId) return NextResponse.json({ success: false, error: 'No auth' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const temaId = searchParams.get('temaId') || '';

    if (!API) return NextResponse.json({ success: true, sessions: [] });

    const res = await fetch(
      `${API}/study-sessions/by-user?userId=${encodeURIComponent(userId)}${temaId ? `&temaId=${encodeURIComponent(temaId)}` : ''}`,
      { cache: 'no-store' }
    );

    const json = await res.json();

    return NextResponse.json({
      success: true,
      sessions: (json.sessions || []).map((s: any) => {
        // Normalizar processMode al salir del servidor
        const mode = s.processMode || s.studyMode || s.process_mode || s.study_mode || 'free';
        return { ...s, processMode: mode, studyMode: mode };
      }),
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Error interno' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId();
    if (!userId) return NextResponse.json({ success: false, error: 'No auth' }, { status: 401 });

    const body = await req.json();

    // Normalizar modo — NUNCA dejar null
    const mode = body.processMode || body.studyMode || 'free';

    if (!API) return NextResponse.json({ success: true, session: body });

    const res = await fetch(`${API}/study-sessions/upsert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        id: body.id,
        tema_id: body.temaId,
        enfoque: body.enfoque,
        process_mode: mode,
        study_mode: mode,
        material_ids: body.materialIds || [],
        selected_pages: body.selectedPages || null,
        flashcards: body.flashcards || null,
        notes: body.notes || null,
        material_text: body.materialText || null,
        current_phase: body.currentPhase || null,
        // ── Estado adaptive completo ──
        adaptive_program: body.adaptiveProgram || null,
        process_style: body.processStyle || null,
        target_score: body.targetScore ?? null,
        exam_date: body.examDate || null,
        exam_date_custom: body.examDateCustom || null,
        material_blueprint: body.materialBlueprint || null,
        mastery_snapshot: body.masterySnapshot || null,
        created_at: body.createdAt || Date.now(),
        last_opened_at: body.lastOpenedAt || Date.now(),
      }),
    });

    const json = await res.json();

    // ── Debug: contexto del setup (terminal del servidor) ──
    if (body.processMode === 'adaptive' || body.studyMode === 'adaptive') {
      console.log('\n══════════════════════════════════════════════');
      console.log('📝 SESIÓN ADAPTATIVA GUARDADA');
      console.log('══════════════════════════════════════════════');
      console.log('  Usuario:', userId);
      console.log('  Material:', body.materialNames?.[0] || body.materialIds?.[0] || '—');
      console.log('  Modo:', body.processMode);
      if (body.adaptiveSetup) {
        const s = body.adaptiveSetup;
        console.log('  Setup:');
        console.log('    Nivel previo:', s.knowledgeLevel || '—');
        console.log('    Examen:', s.examDateType || '—', s.examDateCustom || '');
        console.log('    Nota objetivo:', (s.targetScore || '—') + '%');
        console.log('    Estilo profesor:', (s.professorExamStyle || []).join(', ') || '—');
        console.log('    Preferencia eval:', s.evalPreference || '—');
      }
      console.log('══════════════════════════════════════════════\n');
    }

    return NextResponse.json({
      success: true,
      session: json.session || body,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Error interno' },
      { status: 500 }
    );
  }
}
