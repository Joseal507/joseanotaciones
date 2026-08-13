import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';
import { deriveIsProgramComplete } from '../../../lib/adaptive/resume';
import { sourceSelectionFingerprint } from '../../../lib/adaptive/sourceSelection';

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
    const sessionId = searchParams.get('sessionId') || '';

    if (!API) return NextResponse.json({ success: true, sessions: [] });

    const res = await fetch(
      `${API}/study-sessions/by-user?userId=${encodeURIComponent(userId)}${temaId ? `&temaId=${encodeURIComponent(temaId)}` : ''}`,
      { cache: 'no-store' }
    );

    const json = await res.json();

    const rawSessions = Array.isArray(json.sessions) ? json.sessions : [];
    const filteredSessions = sessionId
      ? rawSessions.filter((s: any) => String(s?.id || '') === sessionId)
      : rawSessions;

    return NextResponse.json({
      success: true,
      sessions: filteredSessions.map((s: any) => {
        // Normalizar processMode al salir del servidor
        const mode = s.processMode || s.studyMode || s.process_mode || s.study_mode || 'free';
        const persistedJourney = s.journey || s.adaptiveProgram || s.adaptive_program || null;
        const resumeState = persistedJourney?.resumeState || {};
        const materialIds = s.materialIds || s.material_ids || [];
        const selectedPages = s.selectedPages || s.selected_pages || {};
        return {
          ...s,
          processMode: mode,
          studyMode: mode,
          // Normalizar blueprint y journey desde nombres del backend
          blueprint: s.blueprint || s.materialBlueprint || s.material_blueprint || null,
          journey: persistedJourney,
          adaptiveSetup: s.adaptiveSetup || s.adaptive_setup || null,
          setupHash: s.setupHash || s.setup_hash || null,
          primaryMaterialId: s.primaryMaterialId || s.primary_material_id || s.materialId || s.material_id || s.materialIds?.[0] || s.material_ids?.[0] || null,
          masteryMaterialKey: s.masteryMaterialKey || s.mastery_material_key || null,
          currentSessionNumber: s.currentSessionNumber || s.current_session_number || resumeState.currentSessionNumber || null,
          currentStep: s.currentStep ?? s.current_step ?? resumeState.currentStep ?? 0,
          completedSessionNumbers: s.completedSessionNumbers || s.completed_session_numbers || resumeState.completedSessionNumbers || [],
          status: s.status || resumeState.status || null,
          adaptiveState: s.adaptiveState || s.adaptive_state || resumeState.adaptiveState || null,
          replaySessionNumber: s.replaySessionNumber || s.replay_session_number || resumeState.replaySessionNumber || null,
          replayAttempt: s.replayAttempt || s.replay_attempt || resumeState.replayAttempt || 0,
          sessionContent: s.sessionContent || s.session_content || resumeState.sessionContent || null,
          sessionPreparation: s.sessionPreparation || s.session_preparation || resumeState.sessionPreparation || null,
          recoveryQueues: s.recoveryQueues || s.recovery_queues || resumeState.recoveryQueues || {},
          isProgramComplete: s.isProgramComplete === true || s.is_program_complete === true || resumeState.isProgramComplete === true,
          unresolvedMicroIds: s.unresolvedMicroIds || s.unresolved_micro_ids || resumeState.unresolvedMicroIds || [],
          activeStudyMs: s.activeStudyMs || s.active_study_ms || resumeState.activeStudyMs || 0,
          breakHoursAcknowledged: s.breakHoursAcknowledged || s.break_hours_acknowledged || resumeState.breakHoursAcknowledged || 0,
          materialNames: s.materialNames || s.material_names || [],
          selectedPages,
          sourceSelectionFingerprint: sourceSelectionFingerprint(materialIds, selectedPages),
          updatedAt: s.updatedAt || s.updated_at || null,
        };
      }),
    });
  } catch (err: any) {
    // AUDITORÍA DE CICLO DE VIDA (verificación focalizada, punto 4): este catch
    // devolvía el error al cliente pero nunca dejaba rastro server-side — un
    // fallo real de persistencia (Worker externo caído, red) era indistinguible
    // en logs de cualquier otro 500 genérico.
    console.error('[study-sessions] GET_failed', JSON.stringify({
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 6).join('\n') : undefined,
    }));
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

    // Construir payload SOLO con campos que llegan con valor válido
    // Esto evita sobreescribir campos existentes en el backend con null
    // cuando el frontend hace updates parciales
    const payload: any = {
      user_id: userId,
      id: body.id,
      tema_id: body.temaId,
      enfoque: body.enfoque,
      process_mode: mode,
      study_mode: mode,
      material_ids: body.materialIds || [],
      created_at: body.createdAt || Date.now(),
      updated_at: body.updatedAt || Date.now(),
      last_opened_at: body.lastOpenedAt || Date.now(),
    };

    // Campos opcionales: solo incluir si llegan con valor truthy
    // Esto previene que un sync sin adaptiveSetup borre el setup existente
    if (body.primaryMaterialId || body.materialIds?.[0]) payload.primary_material_id = body.primaryMaterialId || body.materialIds[0];
    if (body.masteryMaterialKey) payload.mastery_material_key = body.masteryMaterialKey;
    if (body.selectedPages && typeof body.selectedPages === 'object') payload.selected_pages = body.selectedPages;
    if (body.flashcards) payload.flashcards = body.flashcards;
    if (body.notes) payload.notes = body.notes;
    if (body.materialText) payload.material_text = body.materialText;
    if (body.currentPhase) payload.current_phase = body.currentPhase;
    if (body.adaptiveProgram) payload.adaptive_program = body.adaptiveProgram;
    if (body.processStyle) payload.process_style = body.processStyle;
    if (body.targetScore != null) payload.target_score = body.targetScore;
    if (body.examDate) payload.exam_date = body.examDate;
    if (body.examDateCustom) payload.exam_date_custom = body.examDateCustom;
    if (body.materialBlueprint) payload.material_blueprint = body.materialBlueprint;
    if (body.masterySnapshot) payload.mastery_snapshot = body.masterySnapshot;
    // CRITICAL: guardar blueprint y journey en el servidor para persistencia cross-browser
    if (body.materialBlueprint || body.blueprint) {
      payload.material_blueprint = body.materialBlueprint || body.blueprint;
    }
    if (body.adaptiveProgram || body.journey) {
      payload.adaptive_program = body.adaptiveProgram || body.journey;
    }
    if (body.adaptiveSetup) payload.adaptive_setup = body.adaptiveSetup;
    if (body.setupHash) payload.setup_hash = body.setupHash;
    if (body.currentSessionNumber != null) payload.current_session_number = body.currentSessionNumber;
    if (body.currentStep != null) payload.current_step = body.currentStep;
    if (body.completedSessionNumbers && body.completedSessionNumbers.length > 0) payload.completed_session_numbers = body.completedSessionNumbers;
    if (body.status) payload.status = body.status;
    if (body.adaptiveState) payload.adaptive_state = body.adaptiveState;
    if (body.replaySessionNumber) payload.replay_session_number = body.replaySessionNumber;
    if (body.replayAttempt) payload.replay_attempt = body.replayAttempt;
    if (body.sessionContent) payload.session_content = body.sessionContent;
    // AUDITORÍA DE CICLO DE VIDA: sessionPreparation (estado incremental de
    // preparación, usado para reanudar tras un fallo parcial) nunca se enviaba al
    // backend externo — solo sessionContent (el artefacto FINAL) lo hacía. Esto
    // rompía "el servidor sigue siendo la fuente canónica" para cualquier retry
    // cross-device/cross-cold-start: la reanudación solo sobrevivía en el
    // localStorage del mismo navegador que generó el fallo.
    if (body.sessionPreparation) payload.session_preparation = body.sessionPreparation;
    // EL CLIENTE NO PUEDE DECLARAR PROGRAM COMPLETION — el servidor deriva
    // isProgramComplete de forma independiente a partir de datos verificables (todas las
    // sesiones del journey realmente en completedSessionNumbers + unresolvedMicroIds
    // vacío), nunca del booleano que manda el cliente.
    const serverDerivedProgramComplete = deriveIsProgramComplete({
      journey: body.journey || body.adaptiveProgram,
      completedSessionNumbers: Array.isArray(body.completedSessionNumbers) ? body.completedSessionNumbers : [],
      unresolvedMicroIds: Array.isArray(body.unresolvedMicroIds) ? body.unresolvedMicroIds : [],
    });
    if (body.isProgramComplete === true && !serverDerivedProgramComplete) {
      console.warn('[study-sessions]', JSON.stringify({
        event: 'client_program_completion_rejected',
        sessionId: body.id,
        userId,
        reason: 'client_claimed_true_but_server_derivation_false',
      }));
    }
    if (serverDerivedProgramComplete) payload.is_program_complete = true;
    if (body.unresolvedMicroIds && body.unresolvedMicroIds.length > 0) payload.unresolved_micro_ids = body.unresolvedMicroIds;
    if (body.activeStudyMs) payload.active_study_ms = body.activeStudyMs;
    if (body.breakHoursAcknowledged) payload.break_hours_acknowledged = body.breakHoursAcknowledged;
    if (body.materialNames?.length) payload.material_names = body.materialNames;
    if (body.recoveryQueues) payload.recovery_queues = body.recoveryQueues;

    const res = await fetch(`${API}/study-sessions/upsert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
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
    // AUDITORÍA DE CICLO DE VIDA (verificación focalizada, punto 4): mismo gap
    // que el catch de GET arriba — un fallo real de persistencia server-side
    // (Worker externo caído, red, payload rechazado) no dejaba ningún rastro
    // diagnosticable en logs del servidor.
    console.error('[study-sessions] POST_failed', JSON.stringify({
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 6).join('\n') : undefined,
    }));
    return NextResponse.json(
      { success: false, error: err?.message || 'Error interno' },
      { status: 500 }
    );
  }
}
