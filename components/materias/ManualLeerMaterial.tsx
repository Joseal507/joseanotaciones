"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { SourceSelectionSnapshot } from "../../lib/adaptive/sourceSelection";
import {
  readManualToolState,
  writeManualToolState,
} from "../../lib/manualToolState";

const PDFViewer = dynamic(() => import("./FlashcardsPDFViewer"), { ssr: false });

const BODY = "var(--font-body)";

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

interface LeerState {
  pagesVisited: number[];
  lastPage: number;
}

const initial: LeerState = { pagesVisited: [], lastPage: 1 };

export default function ManualLeerMaterial({
  materiales, seleccion, sessionId, sourceSelection,
  onBack, onProgressReport,
}: Props) {
  const [activeMaterialIndex, setActiveMaterialIndex] = useState(0);
  const [state, setState] = useState<LeerState>(initial);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const activeMat = materiales[activeMaterialIndex] || materiales[0];

  const persist = useCallback((next: LeerState) => {
    if (sessionId) writeManualToolState(sessionId, sourceSelection.fingerprint, 'leer', next);
    setState(next);
  }, [sessionId, sourceSelection.fingerprint]);

  useEffect(() => {
    if (!sessionId) return;
    const restored = readManualToolState<LeerState>(sessionId, sourceSelection.fingerprint, 'leer');
    if (restored?.state) {
      setState(restored.state);
      if (restored.state.lastPage) setCurrentPage(restored.state.lastPage);
    }
  }, [sessionId, sourceSelection.fingerprint]);

  useEffect(() => {
    if (!currentPage) return;
    if (state.pagesVisited.includes(currentPage)) return;
    persist({ ...state, pagesVisited: [...state.pagesVisited, currentPage], lastPage: currentPage });
  }, [currentPage]);

  useEffect(() => {
    if (!onProgressReport) return;
    const generated = 3;
    const totalPages = numPages || 1;
    const visitedFraction = Math.min(1, state.pagesVisited.length / totalPages);
    onProgressReport(Math.min(15, Math.round(generated + 12 * visitedFraction)));
  }, [state.pagesVisited.length, numPages, onProgressReport]);

  useEffect(() => {
    let cancelled = false;
    async function loadUrl() {
      if (!activeMat) { setPdfUrl(null); return; }
      if (activeMat.url && String(activeMat.url).startsWith('http')) {
        if (!cancelled) setPdfUrl(activeMat.url);
        return;
      }
      const matId = activeMat.materialId || activeMat.id;
      if (matId) {
        try {
          const res = await fetch(`/api/materials/${matId}/download-url`, { credentials: 'same-origin' });
          const data = await res.json();
          if (!cancelled && data?.url) setPdfUrl(data.url);
        } catch {}
      }
    }
    loadUrl();
    return () => { cancelled = true; };
  }, [activeMat]);

  const selectedPages = seleccion?.[activeMaterialIndex]?.pages || [];

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg-primary)',
      display: 'flex', flexDirection: 'column', fontFamily: BODY, zIndex: 9999,
      color: 'var(--text-primary)',
    }}>
      <div style={{
        padding: '14px 24px', borderBottom: '1px solid var(--border-color2)',
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <button onClick={onBack} style={{
          padding: '8px 14px', borderRadius: 10,
          border: '2px solid #38bdf8', background: 'transparent',
          color: '#38bdf8', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}>← volver al mapa</button>
        <div style={{ fontSize: 18, fontWeight: 800 }}>📖 Leer el material</div>
        {materiales.length > 1 && (
          <select
            value={activeMaterialIndex}
            onChange={e => setActiveMaterialIndex(Number(e.target.value))}
            style={{
              padding: '6px 12px', borderRadius: 8,
              border: '1px solid var(--border-color2)', background: 'var(--bg-card)',
              color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer',
            }}
          >
            {materiales.map((m, i) => (
              <option key={m.id || i} value={i}>{m.nombre || m.name || `Material ${i + 1}`}</option>
            ))}
          </select>
        )}
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {state.pagesVisited.length} / {numPages || '?'} páginas leídas
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {pdfUrl ? (
          <PDFViewer
            url={pdfUrl}
            selectedPages={selectedPages}
            themeColor="#38bdf8"
            onTotalPages={setNumPages}
            currentQuestionPage={currentPage}
            onPageChange={setCurrentPage}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
            Cargando material...
          </div>
        )}
      </div>
    </div>
  );
}
