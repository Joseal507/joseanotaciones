"use client";

import { useEffect, useCallback } from "react";
import type { SourceSelectionSnapshot } from "../../lib/adaptive/sourceSelection";
import {
  readManualToolState,
  writeManualToolState,
} from "../../lib/manualToolState";
import ALAIStudyALChat from "./ALAIStudyALChat";

interface Props {
  materiales: any[];
  seleccion?: any[] | null;
  tema?: any;
  materia?: any;
  sessionId: string | null;
  sourceSelection: SourceSelectionSnapshot;
  onBack: () => void;
  onProgressReport?: (pct: number) => void;
}

// ═══════════════════════════════════════════════════════════════════
// Wrapper: reusa ALAIStudyALChat pero traduce sus events al contrato
// del Modo Manual (manualToolState + cap 10 para 'alai').
// El componente hijo persiste su propia conversación via FreeToolState
// bajo el mismo sessionId — Manual también lo lee via manualToolState.alai
// solo para el progress tracking (no duplica la conversación).
// ═══════════════════════════════════════════════════════════════════

export default function ManualAlaiChat({
  materiales, seleccion, tema, materia,
  sessionId, sourceSelection, onBack, onProgressReport,
}: Props) {

  // Callback: cuando ALAIStudyALChat reporta un mastery event, traducimos
  // el freeDomainPct de ALAI (cap 5) al cap Manual de 10 (proporcional).
  const translateMasteryEvent = useCallback((event: any) => {
    if (!onProgressReport) return;
    if (event?.tool !== 'alai') return;
    const freePct = Number(event?.freeDomainPct) || 0;
    // ALAI free cap = 5, Manual cap = 10. Escalar linealmente.
    const manualPct = Math.min(10, Math.round((freePct / 5) * 10));
    onProgressReport(manualPct);

    // Persist en manualTools.alai para restore consistency
    if (sessionId) {
      const currentState = readManualToolState<{ lastPct: number; turns: number }>(sessionId, sourceSelection.fingerprint, 'alai');
      const prevPct = currentState?.state?.lastPct || 0;
      if (manualPct > prevPct) {
        writeManualToolState(sessionId, sourceSelection.fingerprint, 'alai', {
          lastPct: manualPct,
          turns: (currentState?.state?.turns || 0) + 1,
        });
      }
    }
  }, [onProgressReport, sessionId, sourceSelection.fingerprint]);

  return (
    <ALAIStudyALChat
      materiales={materiales}
      seleccion={seleccion}
      tema={tema}
      materia={materia}
      sessionId={sessionId}
      sourceSelection={sourceSelection}
      onMasteryEvent={translateMasteryEvent}
      onBack={onBack}
    />
  );
}
