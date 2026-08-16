"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import type { SourceSelectionSnapshot } from "../../lib/adaptive/sourceSelection";
import {
  readManualToolState,
  writeManualToolState,
} from "../../lib/manualToolState";

const PDFViewer = dynamic(() => import("./FlashcardsPDFViewer"), { ssr: false });

const BODY = "'Plus Jakarta Sans', system-ui, sans-serif";

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

interface ResumenState {
  content: string;
  lastEditedAt: number | null;
}

const initial: ResumenState = { content: '', lastEditedAt: null };

export default function ManualResumen({
  materiales, seleccion, sessionId, sourceSelection,
  onBack, onProgressReport,
}: Props) {
  const [state, setState] = useState<ResumenState>(initial);
  const [activeMaterialIndex, setActiveMaterialIndex] = useState(0);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const saveTimerRef = useRef<number | null>(null);
  const activeMat = materiales[activeMaterialIndex] || materiales[0];

  useEffect(() => {
    if (!sessionId) return;
    const restored = readManualToolState<ResumenState>(sessionId, sourceSelection.fingerprint, 'resumen');
    if (restored?.state) setState(restored.state);
  }, [sessionId, sourceSelection.fingerprint]);

  const persist = useCallback((next: ResumenState) => {
    if (sessionId) writeManualToolState(sessionId, sourceSelection.fingerprint, 'resumen', next);
    setState(next);
  }, [sessionId, sourceSelection.fingerprint]);

  const wordCount = state.content.trim().split(/\s+/).filter(Boolean).length;

  useEffect(() => {
    if (!onProgressReport) return;
    const generated = state.content.length > 0 ? 3 : 0;
    let interaction = 0;
    if (wordCount >= 50) interaction += 6;
    if (wordCount >= 200) interaction += 6;
    if (wordCount >= 500) interaction += 5;
    onProgressReport(Math.min(20, generated + interaction));
  }, [wordCount, state.content.length, onProgressReport]);

  const handleChange = (value: string) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    const next: ResumenState = { content: value, lastEditedAt: Date.now() };
    setState(next);
    saveTimerRef.current = window.setTimeout(() => persist(next), 600);
  };

  useEffect(() => {
    let cancelled = false;
    async function loadUrl() {
      if (!activeMat) return;
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
          border: '2px solid #a78bfa', background: 'transparent',
          color: '#a78bfa', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}>← volver al mapa</button>
        <div style={{ fontSize: 18, fontWeight: 800 }}>🟣 Mi resumen</div>
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
          {wordCount} palabra{wordCount !== 1 ? 's' : ''}
        </div>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden' }}>
        <div style={{ borderRight: '1px solid var(--border-color2)', overflow: 'hidden' }}>
          {pdfUrl ? (
            <PDFViewer
              url={pdfUrl}
              selectedPages={selectedPages}
              themeColor="#a78bfa"
              onTotalPages={setNumPages}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
              Cargando material...
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-card)' }}>
          <div style={{
            padding: '10px 16px', borderBottom: '1px solid var(--border-color2)',
            fontSize: 12, color: '#a78bfa', fontWeight: 700, letterSpacing: 0.5,
          }}>
            📝 TU RESUMEN
          </div>
          <textarea
            value={state.content}
            onChange={e => handleChange(e.target.value)}
            placeholder="Escribe aquí tu resumen del material..."
            style={{
              flex: 1, border: 'none', outline: 'none',
              padding: '20px 24px', fontSize: 14, lineHeight: 1.6,
              background: 'transparent', resize: 'none',
              color: 'var(--text-primary)', fontFamily: BODY,
            }}
          />
          <div style={{
            padding: '8px 16px', borderTop: '1px solid var(--border-color2)',
            fontSize: 11, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between',
          }}>
            <span>Guardado automático</span>
            <span>
              {wordCount >= 500 ? '✅ Completo' :
               wordCount >= 200 ? '📝 Buen progreso' :
               wordCount >= 50 ? '✏️ Vas bien' : '⏳ Empieza a escribir'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
