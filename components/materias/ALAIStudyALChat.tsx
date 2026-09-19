'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { VisualSpec } from '../../lib/adaptive/visual/visualContract';
import { normalizeChatText, parseContentNodes } from '../../lib/alai-chat/content';
import { boundedHistory } from '../../lib/alai-chat/conversation';
import { chatProvenanceLabel } from '../../lib/alai-chat/contracts';
export { parseContentNodes } from '../../lib/alai-chat/content';
import { buildSourceSelectionFromMaterials, type SourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';
import { PRACTICE_START_MESSAGE } from '../../lib/alai-chat/practice';
import {
  alaiInteractionMode,
  beginAlaiTurn,
  completeAlaiTurn,
  failAlaiTurn,
  initialAlaiState,
  recoverInterruptedAlaiState,
  retryAlaiTurn,
  setAlaiInteractionMode,
  type AlaiInteractionMode,
  type DurableAlaiMessage,
  type DurableAlaiState,
} from '../../lib/freeAlaiState';
import { readFreeToolState, writeFreeToolState } from '../../lib/freeToolState';
import { freeNavDebug } from '../../lib/debug/freeNavDebug';

import { AcademicContent } from '../academic/AcademicContent';

import { VisualRenderer } from '../visual/VisualRenderer';
import { extractGraphSpec } from '../../lib/adaptive/visual/engines/graphEngine';
import { chatUserMessage, safeChatDisplayText, isInternalChatText } from '../../lib/alai-chat/errors';
const PDFViewer = dynamic(() => import('./FlashcardsPDFViewer'), { ssr: false });

type ChatMessage = DurableAlaiMessage;

function deriveClientVisualSpec(msg: ChatMessage): VisualSpec | undefined {
  if (msg.visualSpec) return msg.visualSpec;
  if (msg.role !== 'assistant' || !msg.content) return undefined;
  // Fallback is only intended for graph turns where visualSpec was missing
  const isGraphTurn = msg.requestedResponseShape === 'graph' || msg.fulfillment === 'text_only';
  if (!isGraphTurn) return undefined;
  try {
    const extracted = extractGraphSpec(msg.content, [], `alai:${msg.id}`);
    if (!extracted) return undefined;
    return {
      id: `visualspec:client:${msg.id}`,
      requirementId: `visualreq:client:${msg.id}`,
      microId: `client:${msg.id}`,
      representation: 'cartesian_graph',
      engine: 'graph_2d',
      data: extracted.data,
      sourceGrounding: { sourceSpans: extracted.sourceSpans, factKeys: [] },
      conceptual: false,
      provenance: { kind: 'DERIVED', operation: 'plot_explicit_function', inputs: [extracted.data.expression], reproducible: true },
    };
  } catch {
    return undefined;
  }
}

interface Props {
  materiales: any[];
  seleccion?: any[] | null;
  tema: any;
  materia: any;
  onBack: () => void;
  onMasteryEvent?: (event: any) => void;
  masteryContext?: any;
  sessionId?: string | null;
  sourceSelection?: SourceSelectionSnapshot;
}

const uid = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2) + Date.now().toString(36);

function formatPages(pages?: number[]) {
  const clean = Array.from(new Set((pages || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
  if (!clean.length) return '';
  if (clean.length === 1) return `Página ${clean[0]}`;
  return `Páginas ${clean.join(', ')}`;
}

// Chip-sized citation label — display-only abbreviation, distinct from
// formatPages() (which stays exact/unabbreviated for the material panel
// header and internal summaries).
export function formatCitationPages(pages?: number[]) {
  const clean = Array.from(new Set((pages || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
  if (!clean.length) return '';
  if (clean.length === 1) return `Página ${clean[0]}`;
  const shown = clean.slice(0, 3);
  return `Págs. ${shown.join(', ')}${clean.length > shown.length ? '…' : ''}`;
}

// Presentation-only cleanup: strips known internal-disclosure phrasing
// that occasionally leaks into generated text even when authorized
// material context DID ground the answer (making the phrase simply
// false). This never touches retrieval/grounding — it only affects how
// already-generated text is displayed.
export function sanitizeDisplayText(text: string): string {
  text = safeChatDisplayText(text);
  // Legacy fallback messages exposed internal learner-state inference. Keep an
  // honest limitation rather than silently turning that inference into evidence.
  return normalizeChatText(text).replace(
    /No tengo acceso directo al contenido específico, pero puedo inferir basándome en tus conceptos débiles\./gi,
    'No puedo respaldar esta respuesta con tu material.',
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i} className="aal-strong">{renderInline(part.slice(2, -2))}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={i} className="aal-inline-code">{part.slice(1, -1)}</code>;
    }
    if (
      (part.startsWith('\\(') && part.endsWith('\\)')) ||
      (part.startsWith('\\[') && part.endsWith('\\]')) ||
      (part.startsWith('$$') && part.endsWith('$$')) ||
      (part.startsWith('$') && part.endsWith('$'))
    ) {
      return <AcademicContent key={i} content={part} inline />;
    }
    return <span key={i}>{part}</span>;
  });
}

const BULLET_DOT_COLORS = ['var(--red)', 'var(--blue)', 'var(--pink)', '#22c55e', 'var(--gold)'];

export function renderMessageContent(text: string) {
  const normalized = sanitizeDisplayText(String(text || ''));
  const nodes = parseContentNodes(normalized);
  return (
    <div className="aal-blocks">
      {nodes.map((node, idx) => {
        switch (node.kind) {
          case 'h': {
            if (node.level === 1) return <h1 key={idx} className="aal-h1">{renderInline(node.text)}</h1>;
            if (node.level === 2) return <h2 key={idx} className="aal-h2">{renderInline(node.text)}</h2>;
            return <h3 key={idx} className="aal-h3">{renderInline(node.text)}</h3>;
          }
          case 'ul':
            return (
              <ul key={idx} className="aal-bullet-list">
                {node.items.map((item, i) => (
                  <li key={i}>
                    <span className="aal-bullet-dot" style={{ background: BULLET_DOT_COLORS[i % BULLET_DOT_COLORS.length] }} />
                    <span>{renderInline(item)}</span>
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={idx} className="aal-num-list" start={node.start || 1}>
                {node.items.map((item, i) => (
                  <li key={i}>
                    <span className="aal-num-dot">{i + (node.start || 1)}</span>
                    <span>{renderInline(item)}</span>
                  </li>
                ))}
              </ol>
            );
          case 'table':
            return (
              <div key={idx} className="aal-table-wrap">
                <table className="aal-table">
                  <thead>
                    <tr>
                      {node.headers.map((header, i) => (
                        <th key={i}>{renderInline(header)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {node.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci}>{renderInline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'code':
            return <pre key={idx} style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}><code>{node.text}</code></pre>;
          case 'p':
            return <div key={idx} className="aal-line" style={{ whiteSpace: 'pre-wrap' }}>{renderInline(node.text)}</div>;
        }
      })}
    </div>
  );
}

// Highlight de texto cuando ALAI menciona algo importante
function highlightKeywords(text: string): React.ReactNode {
  // Marca palabras entre _underscore_ con highlight dorado tipo marcador
  const parts = String(text || '').split(/(_[^_]+_)/g);
  return parts.map((part, i) => {
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
      return <mark key={i} className="aal-mark">{part.slice(1, -1)}</mark>;
    }
    return <span key={i}>{part}</span>;
  });
}

export default function ALAIStudyALChat({ materiales, seleccion, tema, materia, onBack, masteryContext, sessionId, sourceSelection }: Props) {
  const [conversation, setConversation] = useState<DurableAlaiState>(() => initialAlaiState());
  const [continuityReady, setContinuityReady] = useState(false);
  const [error, setError] = useState('');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [activeMaterialIndex, setActiveMaterialIndex] = useState(0);
  const [forcedPage, setForcedPage] = useState<number | undefined>(undefined);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const [, setNumPages] = useState(0);
  const [ready, setReady] = useState(false);
  const [pdfCollapsed, setPdfCollapsed] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);
  const conversationRef = useRef(conversation);
  const activeAttemptRef = useRef('');
  const requestControllerRef = useRef<AbortController | null>(null);
  const sendLockedRef = useRef(false);
  const effectiveSourceSelection = useMemo(
    () => sourceSelection || buildSourceSelectionFromMaterials(materiales, seleccion),
    [sourceSelection, materiales, seleccion],
  );
  const messages = conversation.messages;
  const input = conversation.draft;
  const loadingAnswer = conversation.currentTurn?.status === 'sending';
  const interactionMode = alaiInteractionMode(conversation);

  const activeMaterial = materiales[activeMaterialIndex] || materiales[0] || null;
  const activeMaterialId = activeMaterial?.materialId || activeMaterial?.material_id || activeMaterial?.id || '';

  const selectionSequence = useMemo(() => {
    const seq: { materialIndex: number; page: number }[] = [];
    materiales.forEach((mat: any, i: number) => {
      const materialId = String(mat?.materialId || mat?.material_id || mat?.id || '');
      const pages = effectiveSourceSelection.selectedPages[materialId] || [];
      pages.forEach((page) => seq.push({ materialIndex: i, page }));
    });
    return seq;
  }, [materiales, effectiveSourceSelection.fingerprint]);

  const activeSelectedPages = useMemo(() => {
    return effectiveSourceSelection.selectedPages[String(activeMaterialId)] || [];
  }, [effectiveSourceSelection.fingerprint, activeMaterialId]);

  const viewerPages = useMemo(() => {
    const src = forcedPage && Number.isFinite(forcedPage) && (activeSelectedPages.length === 0 || activeSelectedPages.includes(forcedPage)) ? [forcedPage] : [];
    return Array.from(new Set([...activeSelectedPages, ...src])).sort((a, b) => a - b);
  }, [activeSelectedPages, forcedPage]);

  const totalSelectedPages = useMemo(
    () => selectionSequence.length || activeSelectedPages.length,
    [selectionSequence.length, activeSelectedPages.length]
  );

  const persistConversation = useCallback((next: DurableAlaiState) => {
    conversationRef.current = next;
    setConversation(next);
    if (continuityReady && sessionId) {
      const written = writeFreeToolState(sessionId, effectiveSourceSelection.fingerprint, 'alai', next);
      freeNavDebug('ALAI_PERSIST', { sessionId, fingerprint: effectiveSourceSelection.fingerprint, written: !!written });
    } else {
      freeNavDebug('ALAI_PERSIST_SKIPPED', { sessionId, continuityReady });
    }
  }, [continuityReady, sessionId, effectiveSourceSelection.fingerprint]);

  useEffect(() => {
    const restored = readFreeToolState<DurableAlaiState>(
      sessionId,
      effectiveSourceSelection.fingerprint,
      'alai',
    );
    const next = recoverInterruptedAlaiState(restored?.state || initialAlaiState());
    conversationRef.current = next;
    setConversation(next);
    if (restored && next !== restored.state && sessionId) {
      writeFreeToolState(sessionId, effectiveSourceSelection.fingerprint, 'alai', next);
    }
    const restoredMaterialId = next.activeMaterialId;
    if (restoredMaterialId) {
      const index = materiales.findIndex((material: any) => String(material?.materialId || material?.material_id || material?.id || '') === restoredMaterialId);
      if (index >= 0) setActiveMaterialIndex(index);
    }
    if (Number.isInteger(next.forcedPage)) setForcedPage(next.forcedPage);
    setContinuityReady(true);
  }, [sessionId, effectiveSourceSelection.fingerprint]);

  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  useEffect(() => {
    if (!continuityReady || !sessionId) return;
    const timer = window.setTimeout(() => {
      writeFreeToolState(sessionId, effectiveSourceSelection.fingerprint, 'alai', conversationRef.current);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [continuityReady, sessionId, effectiveSourceSelection.fingerprint, conversation]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeAttemptRef.current = '';
      requestControllerRef.current?.abort();
      const current = conversationRef.current;
      if (current.currentTurn?.status === 'sending' && sessionId) {
        const recoverable = recoverInterruptedAlaiState(current);
        writeFreeToolState(sessionId, effectiveSourceSelection.fingerprint, 'alai', recoverable);
      }
    };
  }, [sessionId, effectiveSourceSelection.fingerprint]);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loadingAnswer]);

  const isAuthorizedCitation = useCallback((materialId: string, page: number) => {
    const resolvedId = materialId || String(activeMaterialId || '');
    const selection = effectiveSourceSelection.materials.find(item => item.materialId === resolvedId);
    return Boolean(selection && Number.isInteger(page) && page > 0 && (
      selection.selectedPages.length === 0 || selection.selectedPages.includes(page)
    ));
  }, [effectiveSourceSelection, activeMaterialId]);

  useEffect(() => {
    let cancelled = false;
    async function loadPdf() {
      setPdfUrl(null);
      if (!activeMaterialId) return;
      setPdfLoading(true);
      try {
        const res = await fetch(`/api/materials/${activeMaterialId}/download-url`, {
          credentials: 'same-origin',
        });
        const data = await res.json();
        if (!cancelled) setPdfUrl(data?.url || null);
      } catch {
        if (!cancelled) setPdfUrl(null);
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    }
    loadPdf();
    return () => { cancelled = true; };
  }, [activeMaterialId]);

  const jumpToSource = useCallback((msg: ChatMessage) => {
    const pages = msg.sourcePages || [];
    if (pages.length !== 1) return;
    const page = Number(pages[0]);
    const matId = String(msg.sourceMaterial || '');
    if (!isAuthorizedCitation(matId, page)) return;
    if (matId) {
      const idx = materiales.findIndex((m: any) => String(m?.materialId || m?.material_id || m?.id || '') === matId);
      if (idx >= 0) setActiveMaterialIndex(idx);
    }
    setForcedPage(page);
    setScrollTrigger((x) => x + 1);
    setPdfCollapsed(false);
  }, [materiales, isAuthorizedCitation]);

  const runTurn = useCallback(async (turnId: string, attempt: number) => {
    const stateAtStart = conversationRef.current;
    const turn = stateAtStart.currentTurn;
    const userMessage = stateAtStart.messages.find(message => message.id === turn?.userMessageId);
    if (!turn || turn.id !== turnId || turn.attempt !== attempt || !userMessage) return;
    const attemptIdentity = `${turnId}:${attempt}`;
    activeAttemptRef.current = attemptIdentity;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    sendLockedRef.current = true;
    setError('');
    try {
      // The immediate conversational predecessor may be general; never search backwards for old evidence.
      const lastAssistant = [...stateAtStart.messages].reverse().find(message => message.role === 'assistant');
      console.log('[alai-chat-trace:client:outbound]', {
        sessionId,
        turnId,
        attempt,
        userMessage: userMessage.content.slice(0, 100),
        messagesTotal: stateAtStart.messages.length,
        lastAssistantId: lastAssistant?.id,
        hasLastAssistantContext: Boolean(lastAssistant?.conversationContext),
        lastAssistantContext: lastAssistant?.conversationContext ? {
          subject: lastAssistant.conversationContext.subject,
          activeProblem: lastAssistant.conversationContext.activeProblem,
          workingMemory: lastAssistant.conversationContext.workingMemory,
        } : null,
        historySentCount: stateAtStart.messages.filter(m => m.id !== userMessage.id).length,
        historySentSnippets: stateAtStart.messages.filter(m => m.id !== userMessage.id).slice(-4).map(m => `${m.role}:${m.content.slice(0, 60)}`),
      });
      const res = await fetch('/api/alai-studyal-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: userMessage.content,
          turnId,
          attempt,
          conversationContext: lastAssistant?.conversationContext,
          // Frozen on the turn, so a retry replays the exact same mode.
          ...(turn.interactionMode === 'answer' ? { interactionMode: 'answer', ...(turn.practiceStart ? { practiceStart: true } : {}) } : {}),
          // Bounded — deterministic retrieval/grounding is the academic
          // authority, not accumulated assistant prose (Phase 10).
          history: boundedHistory(stateAtStart.messages
            .filter(message => message.id !== userMessage.id && !message.hidden)
            .slice(-6)
            .map(message => ({ role: message.role, content: message.content }))),
          materia: materia?.nombre || '',
          tema: tema?.nombre || '',
          masteryContext,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(chatUserMessage(data));
      if (!mountedRef.current || controller.signal.aborted || activeAttemptRef.current !== attemptIdentity) return;
      const assistantMsg: ChatMessage = {
        id: `${turnId}:assistant`,
        turnId,
        role: 'assistant',
        content: data.answer || '',
        schemaVersion: data.schema === 'alai-chat' ? data.version : undefined,
        provenance: data.provenance,
        evidence: Array.isArray(data.evidence) ? data.evidence : undefined,
        conversationContext: data.conversationContext,
        requestedResponseShape: data.requestedResponseShape,
        fulfillment: data.fulfillment,
        visualSpec: data.visualSpec as VisualSpec | undefined,
        inMaterial: Boolean(data.inMaterial),
        outsideMaterialNote: data.outsideMaterialNote || '',
        confidence: data.confidence || 'media',
        sourceMaterial: data.sourceMaterial || '',
        sourceMaterialName: data.sourceMaterialName || '',
        sourcePages: Array.isArray(data.sourcePages)
          ? data.sourcePages.map(Number).filter((page: number) => isAuthorizedCitation(String(data.sourceMaterial || ''), page))
          : [],
        suggestedFollowups: Array.isArray(data.suggestedFollowups) ? data.suggestedFollowups : [],
        timestamp: Date.now(),
        mode: data.mode || undefined,
        usedTargetIds: Array.isArray(data.usedTargetIds) ? data.usedTargetIds : undefined,
        usedRelationIds: Array.isArray(data.usedRelationIds) ? data.usedRelationIds : undefined,
        materialIds: Array.isArray(data.materialIds) ? data.materialIds : undefined,
      };
      const completed = completeAlaiTurn(conversationRef.current, turnId, attempt, assistantMsg);
      if (completed === conversationRef.current) return;
      persistConversation(completed);

      const pages = assistantMsg.sourcePages || [];
      if (pages.length === 1) {
        const page = Number(pages[0]);
        const matId = String(assistantMsg.sourceMaterial || '');
        if (matId) {
          const idx = materiales.findIndex((m: any) => String(m?.materialId || m?.material_id || m?.id || '') === matId);
          if (idx >= 0) setActiveMaterialIndex(idx);
        }
        setForcedPage(page);
        setScrollTrigger((x) => x + 1);
        persistConversation({ ...completed, activeMaterialId: matId || completed.activeMaterialId, forcedPage: page });
      }
    } catch (caught: unknown) {
      if (controller.signal.aborted || activeAttemptRef.current !== attemptIdentity) return;
      const message = chatUserMessage(caught);
      const failed = failAlaiTurn(conversationRef.current, turnId, attempt, message);
      persistConversation(failed);
    } finally {
      if (activeAttemptRef.current === attemptIdentity) {
        activeAttemptRef.current = '';
        requestControllerRef.current = null;
        sendLockedRef.current = false;
      }
    }
  }, [effectiveSourceSelection.fingerprint, materia, tema, masteryContext, materiales, isAuthorizedCitation, persistConversation]);

  const sendMessage = useCallback((override?: string) => {
    const text = String(override ?? conversationRef.current.draft).trim();
    if (!text || sendLockedRef.current || loadingAnswer || !continuityReady) return;
    if (!sessionId) {
      setError('No se pudo identificar la sesión Free para guardar esta conversación.');
      return;
    }
    sendLockedRef.current = true;
    const turnId = uid();
    const next = beginAlaiTurn(conversationRef.current, {
      turnId,
      userMessageId: `${turnId}:user`,
      content: text,
      timestamp: Date.now(),
      interactionMode: alaiInteractionMode(conversationRef.current),
    });
    persistConversation(next);
    void runTurn(turnId, 1);
  }, [loadingAnswer, continuityReady, sessionId, persistConversation, runTurn]);

  /** PREGUNTAR ⇄ RESPONDER. Entering Responder makes ALAI open the practice; leaving it restores normal chat. */
  const changeInteractionMode = useCallback((mode: AlaiInteractionMode) => {
    if (sendLockedRef.current || loadingAnswer || !continuityReady || alaiInteractionMode(conversationRef.current) === mode) return;
    const switched = setAlaiInteractionMode(conversationRef.current, mode);
    if (mode === 'ask' || !sessionId) { persistConversation(switched); return; }
    sendLockedRef.current = true;
    const turnId = uid();
    const started = beginAlaiTurn(switched, {
      turnId,
      userMessageId: `${turnId}:user`,
      content: PRACTICE_START_MESSAGE,
      timestamp: Date.now(),
      interactionMode: 'answer',
      practiceStart: true,
      hidden: true,
    });
    persistConversation(started);
    void runTurn(turnId, 1);
  }, [loadingAnswer, continuityReady, sessionId, persistConversation, runTurn]);

  const retryCurrentTurn = useCallback(() => {
    const current = conversationRef.current.currentTurn;
    if (!current || current.status !== 'recoverable' || sendLockedRef.current) return;
    const next = retryAlaiTurn(conversationRef.current, current.id);
    persistConversation(next);
    void runTurn(current.id, next.currentTurn?.attempt || current.attempt + 1);
  }, [persistConversation, runTurn]);

  return (
    <div className="aal-screen">
      <div className="aal-bg-radial" />
      <div className="aal-bg-grid" />

      {/* ═══════════ TOPBAR ═══════════ */}
      <div className="aal-topbar">
        <button className="aal-back" onClick={onBack}>← volver al proceso</button>

        <div className="aal-hero">
          <h1>
            ALAI
            <span className="aal-sparkles">✨</span>
          </h1>
          <svg width="180" height="10" viewBox="0 0 180 10" className="aal-underline">
            <path d="M4 6 Q 50 1 90 5 T 176 4" stroke="var(--gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          </svg>
          <p>Tu compañero de estudio inteligente</p>
          <small>ALAI ya analizó tu material. Pregunta lo que quieras.</small>
        </div>

<div className="aal-topbar-right" />
      </div>

      {/* ═══════════ MAIN GRID ═══════════ */}
      <main className={`aal-main ${ready ? 'ready' : ''} ${pdfCollapsed ? 'pdf-collapsed' : ''}`}>

        {/* ──── COLUMNA IZQUIERDA: PDF VIEWER ──── */}
        <aside className="aal-pdf-panel">
          <div className="aal-pdf-card">
            <div className="aal-pdf-head">
              <div className="aal-pdf-head-icon">📄</div>
              <div className="aal-pdf-head-info">
                <strong>{activeMaterial?.nombre || activeMaterial?.name || 'Material'}</strong>
                <span>{activeSelectedPages.length ? formatPages(activeSelectedPages) : 'documento completo'}</span>
              </div>
              <button
                className="aal-collapse-btn"
                onClick={() => setPdfCollapsed(!pdfCollapsed)}
                title={pdfCollapsed ? 'Expandir' : 'Colapsar'}
              >
                {pdfCollapsed ? '→' : '←'}
              </button>
            </div>

            {materiales.length > 1 && (
              <div className="aal-mat-tabs">
                {materiales.map((m: any, i: number) => (
                  <button
                    key={m?.id || i}
                    onClick={() => setActiveMaterialIndex(i)}
                    className={`aal-mat-tab ${i === activeMaterialIndex ? 'active' : ''}`}
                  >
                    {i + 1}. {(m?.nombre || m?.name || 'Material').slice(0, 18)}
                  </button>
                ))}
              </div>
            )}

            <div className="aal-pdf-viewer">
              {pdfLoading ? (
                <div className="aal-pdf-loading">
                  <div className="aal-spinner" />
                  <div>Cargando PDF...</div>
                </div>
              ) : pdfUrl ? (
                <PDFViewer
                  key={`${activeMaterialIndex}-${activeMaterialId}-${pdfUrl}`}
                  url={pdfUrl}
                  selectedPages={viewerPages}
                  themeColor="var(--gold)"
                  onTotalPages={setNumPages}
                  totalSelectedPages={totalSelectedPages}
                  activeMaterialIndex={activeMaterialIndex}
                  materialesCount={materiales.length}
                  forcedPage={forcedPage}
                  currentQuestionPage={forcedPage}
                  scrollTrigger={scrollTrigger}
                />
              ) : (
                <div className="aal-pdf-loading">
                  <div style={{ fontSize: 40 }}>📄</div>
                  <div>No se pudo cargar el documento</div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* ──── CENTRO: CHAT TIPO CUADERNO ──── */}
        <section className="aal-chat-center">
          <div className="aal-mode" data-testid="alai-mode-switch">
            <div className="aal-mode-seg" role="radiogroup" aria-label="Modo de ALAI">
              {([['ask', 'Preguntar'], ['answer', 'Responder']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={interactionMode === value}
                  data-testid={`alai-mode-${value}`}
                  className={interactionMode === value ? 'active' : ''}
                  disabled={loadingAnswer}
                  onClick={() => changeInteractionMode(value)}
                >{label}</button>
              ))}
            </div>
            <span className="aal-mode-hint" aria-live="polite">{interactionMode === 'answer' ? 'ALAI te pregunta a ti' : 'Pregúntale a ALAI'}</span>
          </div>
          <div className="aal-notebook">
            <div className="aal-notebook-holes">
              {Array.from({ length: 9 }).map((_, i) => <span key={i} />)}
            </div>

            {/* Mensajes */}
            <div ref={listRef} className="aal-messages">
              <div className="aal-day-divider">
                <span>Hoy</span>
              </div>

              {error && <div className="aal-error">⚠️ {chatUserMessage(error)}</div>}
              {conversation.currentTurn?.status === 'recoverable' && (
                <div className="aal-error" data-testid="alai-recoverable-turn">
                  ⚠️ {chatUserMessage(conversation.currentTurn.error)}
                  <button type="button" onClick={retryCurrentTurn} disabled={loadingAnswer}>Reintentar respuesta</button>
                </div>
              )}

              {messages.map((msg, idx) => {
                if (msg.hidden) return null;
                const isUser = msg.role === 'user';
                const pages = msg.sourcePages || [];
                const onePage = pages.length === 1;
                const prevMsg = messages[idx - 1];
                const showAvatar = !prevMsg || prevMsg.role !== msg.role;

                const effectiveVisual = deriveClientVisualSpec(msg);

                return (
                  <div key={msg.id} className={`aal-msg ${isUser ? 'user' : 'alai'}`}>
                    {!isUser && showAvatar ? (
                      <div className="aal-avatar alai">
                        <span>🤖</span>
                      </div>
                    ) : !isUser ? (
                      <div className="aal-avatar-space" />
                    ) : null}

                    <div className={`aal-bubble ${isUser ? 'user' : 'alai'}`}>
                      <div className="aal-bubble-body">
                        {isUser ? highlightKeywords(msg.content) : renderMessageContent(msg.content)}
                        {!isUser && effectiveVisual && <VisualRenderer spec={effectiveVisual} mode="teach" />}
                        {!isUser && msg.fulfillment === 'text_only' && !effectiveVisual && <p role="note" className="aal-line">Representación textual: esta función no tiene una gráfica disponible en este formato.</p>}
                      </div>

                      {!isUser && msg.provenance && (
                        <div className="aal-source-row">
                          <span className="aal-source-tag">{chatProvenanceLabel(msg.provenance)}</span>
                          {Array.from(new Set((msg.evidence || []).map(item => item.materialId))).map(materialId => {
                            const material = materiales.find(item => String(item?.materialId || item?.material_id || item?.id || '') === materialId);
                            const citationPages = [...new Set((msg.evidence || []).filter(item => item.materialId === materialId).flatMap(item => item.pages))]
                              .filter(page => isAuthorizedCitation(materialId, page)).sort((a, b) => a - b);
                            return <button key={materialId} className={'aal-source-chip ' + (citationPages.length === 1 ? 'clickable' : '')}
                              disabled={citationPages.length !== 1}
                              onClick={() => jumpToSource({ ...msg, sourceMaterial: materialId, sourcePages: citationPages })}>
                              📄 {String(material?.nombre || material?.name || material?.title || materialId)} · {formatCitationPages(citationPages)}
                            </button>;
                          })}
                        </div>
                      )}
                      {!isUser && !msg.provenance && pages.length > 0 && (
                        <div className="aal-source-row">
                          <button
                            onClick={() => jumpToSource(msg)}
                            disabled={!onePage}
                            className={`aal-source-chip ${onePage ? 'clickable' : ''}`}
                          >
                            📄 {formatCitationPages(pages)}
                          </button>
                          <span className="aal-source-tag">Basado en tu material</span>
                          {msg.mode === 'MIXED' && (
                            <span className="aal-mode-chip mixed">✨ con contexto adicional</span>
                          )}
                        </div>
                      )}

                      {!isUser && !msg.provenance && pages.length === 0 && (msg.mode === 'GENERAL_ONLY' || (msg.mode === undefined && msg.inMaterial === false)) && (
                        <div className="aal-source-row">
                          <span className="aal-mode-chip general">💭 Conocimiento general</span>
                        </div>
                      )}

                      {!isUser && !msg.provenance && pages.length === 0 && msg.mode === 'MIXED' && (
                        <div className="aal-source-row">
                          <span className="aal-mode-chip mixed">✨ Con apoyo de conocimiento general</span>
                        </div>
                      )}

                      {!isUser && (
                        <div className="aal-msg-actions">
                          <button title="Útil">👍</button>
                          <button title="No fue útil">👎</button>
                        </div>
                      )}
                    </div>

                    {isUser && showAvatar ? (
                      <div className="aal-avatar user">
                        <span>👤</span>
                      </div>
                    ) : isUser ? (
                      <div className="aal-avatar-space" />
                    ) : null}
                  </div>
                );
              })}

              {/* Followups del último mensaje de ALAI */}
              {(() => {
                const last = messages[messages.length - 1];
                if (last?.role !== 'assistant' || !last.suggestedFollowups?.length || loadingAnswer) return null;
                return (
                  <div className="aal-followups-inline">
                    {last.suggestedFollowups.filter(f => typeof f === 'string' && !isInternalChatText(f)).map((f) => (
                      <button key={f} onClick={() => sendMessage(f)} className="aal-followup-pill">
                        {f}
                      </button>
                    ))}
                  </div>
                );
              })()}

              {loadingAnswer && (
                <div className="aal-msg alai">
                  <div className="aal-avatar alai"><span>🤖</span></div>
                  <div className="aal-typing">
                    <i /><i /><i />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Input */}
          <form
            className="aal-input-row"
            onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
          >
            <button type="button" className="aal-attach-btn" title="Adjuntar (próximamente)">📎</button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                const next = { ...conversationRef.current, draft: e.target.value };
                conversationRef.current = next;
                setConversation(next);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={interactionMode === 'answer' ? 'Escribe tu respuesta aquí...' : 'Escribe tu pregunta aquí...'}
              disabled={loadingAnswer}
              className="aal-input"
              rows={1}
            />
            <button
              type="submit"
              disabled={loadingAnswer || !input.trim()}
              className="aal-send-btn"
              title="Enviar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M22 2 L11 13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M22 2 L15 22 L11 13 L2 9 Z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </form>

          {/* Quick action stickers */}
          <div className="aal-quick-row">
            {[
              ['Explícamelo simple', '✨'],
              ['Dame un ejemplo', '🧪'],
              ['Conecta conceptos', '🔗'],
              ['Hazme pensar', '🧠'],
              ['Prepárame para examen', '🎯'],
            ].map(([q, icon]) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                disabled={loadingAnswer}
                className="aal-quick-pill"
              >
                <span>{icon}</span>
                {q}
              </button>
            ))}
          </div>

          <div className="aal-disclaimer">
            ALAI puede cometer errores. Verifica la información importante.
          </div>
        </section>

            </main>

      <style>{`
        .aal-screen {
          position: fixed;
          inset: 0;
          background: var(--bg-primary);
          color: var(--text-primary);
          z-index: 9999;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .aal-bg-radial {
          position: absolute; inset: 0; pointer-events: none;
          background:
            radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--gold) 7%, transparent), transparent 55%),
            radial-gradient(circle at 85% 80%, color-mix(in srgb, var(--blue) 4%, transparent), transparent 50%),
            radial-gradient(circle at 15% 75%, color-mix(in srgb, var(--red) 3%, transparent), transparent 50%);
        }
        .aal-bg-grid {
          position: absolute; inset: 0; pointer-events: none;
          opacity: .05;
          background-image:
            linear-gradient(to right, color-mix(in srgb, var(--text-primary) 18%, transparent) 1px, transparent 1px),
            linear-gradient(to bottom, color-mix(in srgb, var(--text-primary) 18%, transparent) 1px, transparent 1px);
          background-size: 40px 40px;
        }

        /* ═════════ TOPBAR ═════════ */
        .aal-topbar {
          position: relative;
          z-index: 10;
          display: grid;
          grid-template-columns: 200px 1fr 1px;
          gap: 18px;
          align-items: start;
          padding: 14px 24px 12px;
          flex-shrink: 0;
        }
        .aal-back {
          border: 2px solid var(--text-primary);
          background: var(--bg-card);
          color: var(--text-primary);
          border-radius: 14px;
          padding: 9px 14px;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 3px 4px 0 var(--text-primary);
          transition: transform .2s ease, box-shadow .2s ease;
          width: fit-content;
          justify-self: start;
          align-self: center;
        }
        .aal-back:hover {
          transform: translate(-2px, -2px);
          box-shadow: 5px 6px 0 var(--text-primary);
        }
        .aal-hero {
          text-align: center;
        }
        .aal-hero h1 {
          margin: 0;
          font-size: 30px;
          font-weight: 900;
          line-height: 1;
          letter-spacing: -0.8px;
          color: var(--red);
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .aal-sparkles {
          font-size: 22px;
          color: var(--gold);
          filter: drop-shadow(0 0 8px color-mix(in srgb, var(--gold) 60%, transparent));
          animation: aalSparkle 2s ease infinite;
        }
        @keyframes aalSparkle {
          0%, 100% { transform: scale(1) rotate(0); }
          50% { transform: scale(1.15) rotate(15deg); }
        }
        .aal-underline {
          display: block;
          margin: 2px auto 6px;
        }
        .aal-hero p {
          margin: 0;
          font-size: 14px;
          font-weight: 800;
          color: var(--text-primary);
        }
        .aal-mode { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; padding: 4px 8px 10px; }
        .aal-mode-seg { display: inline-flex; padding: 3px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--gold) 35%, transparent); background: color-mix(in srgb, var(--gold) 6%, transparent); }
        .aal-mode-seg button { border: 0; background: transparent; color: var(--text-faint); font: inherit; font-weight: 600; font-size: 13px; padding: 6px 16px; border-radius: 999px; cursor: pointer; transition: background .15s, color .15s; }
        .aal-mode-seg button:hover:not(:disabled):not(.active) { color: var(--text); }
        .aal-mode-seg button.active { background: var(--gold); color: #1a1408; }
        .aal-mode-seg button:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
        .aal-mode-seg button:disabled { cursor: not-allowed; opacity: .6; }
        .aal-mode-hint { font-size: 11.5px; color: var(--text-faint); }
        .aal-hero small {
          display: block;
          margin-top: 4px;
          font-size: 11.5px;
          color: var(--text-faint);
        }
        .aal-topbar-right {
          justify-self: end;
        }
        .aal-mini-tip {
          background: var(--bg-card);
          border: 1.5px solid var(--border-color2);
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 11px;
          line-height: 1.4;
          max-width: 220px;
        }
        .aal-mini-tip strong {
          display: block;
          color: var(--gold);
          font-size: 11.5px;
          font-weight: 900;
          margin-bottom: 2px;
        }
        .aal-mini-tip span {
          color: var(--text-muted);
        }

        /* ═════════ MAIN GRID ═════════ */
        .aal-main {
          flex: 1;
          min-height: 0;
          position: relative;
          z-index: 5;
          display: grid;
          grid-template-columns: minmax(380px, 42%) 1fr;
          gap: 16px;
          padding: 0 24px 16px;
          opacity: 0;
          transform: translateY(8px);
          transition: opacity .5s ease, transform .5s ease;
        }
        .aal-main.ready { opacity: 1; transform: none; }
        .aal-main.pdf-collapsed {
          grid-template-columns: 48px 1fr;
        }
        .aal-main.pdf-collapsed .aal-pdf-card > *:not(.aal-pdf-head) { display: none; }
        .aal-main.pdf-collapsed .aal-pdf-head-info { display: none; }
        .aal-main.pdf-collapsed .aal-pdf-head-icon { margin: 0 auto; }

        /* ═════════ PDF PANEL ═════════ */
        .aal-pdf-panel {
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .aal-pdf-card {
          flex: 1;
          min-height: 0;
          background: var(--bg-card);
          border: 1.5px solid var(--border-color2);
          border-radius: 14px;
          box-shadow: 0 8px 24px rgba(0,0,0,.25);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .aal-pdf-head {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          border-bottom: 1px solid var(--border-color2);
          flex-shrink: 0;
        }
        .aal-pdf-head-icon {
          font-size: 18px;
          width: 36px; height: 36px;
          display: grid; place-items: center;
          background: var(--bg-secondary);
          border: 1.5px solid var(--border-color);
          border-radius: 9px;
          flex-shrink: 0;
        }
        .aal-pdf-head-info {
          flex: 1; min-width: 0;
        }
        .aal-pdf-head-info strong {
          display: block;
          font-size: 13px;
          font-weight: 900;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .aal-pdf-head-info span {
          display: block;
          font-size: 10.5px;
          color: var(--text-faint);
          font-weight: 700;
        }
        .aal-collapse-btn {
          background: var(--bg-secondary);
          border: 1.5px solid var(--border-color2);
          border-radius: 8px;
          width: 28px; height: 28px;
          color: var(--text-muted);
          cursor: pointer;
          font-weight: 900;
          font-size: 14px;
          transition: all .2s ease;
        }
        .aal-collapse-btn:hover {
          color: var(--gold);
          border-color: var(--gold);
        }
        .aal-mat-tabs {
          display: flex;
          gap: 4px;
          padding: 8px 8px 0;
          overflow-x: auto;
          flex-shrink: 0;
        }
        .aal-mat-tab {
          border: 1.5px solid var(--border-color2);
          background: var(--bg-card);
          color: var(--text-faint);
          border-radius: 8px;
          padding: 5px 10px;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
          white-space: nowrap;
          transition: all .2s ease;
        }
        .aal-mat-tab:hover { color: var(--text-secondary); border-color: var(--text-faint); }
        .aal-mat-tab.active {
          color: var(--gold);
          border-color: var(--gold);
          background: color-mix(in srgb, var(--gold) 14%, transparent);
        }
        .aal-pdf-viewer {
          flex: 1;
          min-height: 0;
          overflow: hidden;
        }
        .aal-pdf-loading {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: var(--text-faint);
          font-size: 13px;
          padding: 20px;
          text-align: center;
        }
        .aal-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid var(--gold-dim);
          border-top: 3px solid var(--gold);
          border-radius: 50%;
          animation: aalSpin .8s linear infinite;
        }
        @keyframes aalSpin { to { transform: rotate(360deg); } }

        /* ═════════ CHAT CENTER (NOTEBOOK) ═════════ */
        .aal-chat-center {
          display: flex;
          flex-direction: column;
          min-height: 0;
          gap: 12px;
        }
        .aal-notebook {
          flex: 1;
          min-height: 0;
          position: relative;
          background:
            repeating-linear-gradient(to bottom, transparent 0 35px, color-mix(in srgb, var(--text-primary) 7%, transparent) 35px 36px),
            var(--bg-card);
          border: 1.5px solid var(--border-color2);
          border-radius: 14px;
          box-shadow: 0 8px 28px rgba(0,0,0,.3);
          padding: 18px 24px 18px 48px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .aal-notebook-holes {
          position: absolute;
          left: 18px;
          top: 18px;
          bottom: 18px;
          width: 12px;
          display: flex;
          flex-direction: column;
          justify-content: space-around;
          pointer-events: none;
        }
        .aal-notebook-holes span {
          width: 10px; height: 10px;
          border-radius: 50%;
          background: var(--bg-primary);
          box-shadow: inset 0 1px 2px rgba(0,0,0,.6), 0 0 0 1.5px var(--border-color2);
        }

        .aal-messages {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding-right: 6px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-color2) transparent;
        }
        .aal-messages::-webkit-scrollbar { width: 6px; }
        .aal-messages::-webkit-scrollbar-thumb { background: var(--border-color2); border-radius: 3px; }

        .aal-day-divider {
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 4px 0 8px;
        }
        .aal-day-divider span {
          font-size: 11px;
          font-weight: 800;
          color: var(--text-faint);
          background: var(--bg-card);
          padding: 3px 12px;
          border: 1px solid var(--border-color2);
          border-radius: 999px;
          letter-spacing: 0.3px;
        }

        .aal-error {
          padding: 10px 14px;
          border-radius: 10px;
          background: rgba(248,113,113,0.1);
          border: 1px solid rgba(248,113,113,0.4);
          color: #fca5a5;
          font-size: 13px;
          font-weight: 700;
        }

        .aal-msg {
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }
        .aal-msg.user { flex-direction: row-reverse; }

        .aal-avatar {
          width: 34px; height: 34px;
          flex-shrink: 0;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: 17px;
          border: 1.5px solid;
        }
        .aal-avatar.alai {
          background: color-mix(in srgb, var(--gold) 18%, var(--bg-card));
          border-color: var(--gold);
          box-shadow: 0 0 12px color-mix(in srgb, var(--gold) 30%, transparent);
        }
        .aal-avatar.user {
          background: color-mix(in srgb, var(--red) 18%, var(--bg-card));
          border-color: var(--red);
        }
        .aal-avatar-space {
          width: 34px;
          flex-shrink: 0;
        }

        .aal-bubble {
          padding: 12px 14px;
          border-radius: 14px;
          border: 1.5px solid;
          position: relative;
          max-width: min(82%, 580px);
        }
        .aal-bubble.alai {
          background: color-mix(in srgb, #f5ecd6 100%, transparent);
          border-color: rgba(0,0,0,0.15);
          color: #1a1a1a;
          border-radius: 4px 14px 14px 14px;
          box-shadow: 0 4px 14px rgba(0,0,0,.18);
        }
        .aal-bubble.user {
          background: color-mix(in srgb, var(--pink) 14%, var(--bg-card2));
          border-color: color-mix(in srgb, var(--pink) 40%, transparent);
          color: var(--text-primary);
          border-radius: 14px 4px 14px 14px;
        }

        .aal-bubble-body {
          font-size: 13.5px;
          line-height: 1.55;
          overflow-wrap: anywhere;
        }
        .aal-bubble.alai .aal-bubble-body { color: #1a1a1a; }
        .aal-bubble.user .aal-bubble-body { color: var(--text-primary); }

        .aal-line { color: inherit; margin: 0; }
        .aal-multiline { display: flex; flex-direction: column; gap: 6px; }
        .aal-blocks { display: flex; flex-direction: column; gap: 10px; }

        .aal-num-list {
          margin: 0; padding: 0;
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .aal-num-list li {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          line-height: 1.55;
        }
        .aal-num-dot {
          min-width: 22px; width: 22px; height: 22px;
          background: color-mix(in srgb, var(--gold) 25%, transparent);
          border: 1.5px solid var(--gold);
          border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          color: #6b4818;
          font-weight: 900; font-size: 11px;
          flex-shrink: 0;
          margin-top: 1px;
        }

        .aal-bullet-list {
          margin: 0; padding: 0;
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .aal-bullet-list li {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          line-height: 1.55;
        }
        .aal-bullet-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
          margin-top: 7px;
        }

        .aal-mark {
          background: linear-gradient(120deg, transparent 0%, color-mix(in srgb, var(--gold) 45%, transparent) 0%, color-mix(in srgb, var(--gold) 45%, transparent) 100%, transparent 100%);
          padding: 1px 3px;
          border-radius: 2px;
          color: inherit;
          font-weight: 700;
        }
        .aal-strong {
          font-weight: 800;
          color: inherit;
        }
        .aal-inline-code {
          font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
          background: color-mix(in srgb, currentColor 10%, transparent);
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 0.92em;
          color: inherit;
        }

        .aal-table-wrap {
          width: 100%;
          max-width: 100%;
          overflow-x: auto;
          overflow-y: visible;
          margin-top: 6px;
          -webkit-overflow-scrolling: touch;
        }

        .aal-table {
          width: 100%;
          min-width: 480px;
          border-collapse: collapse;
          table-layout: auto;
          font-size: 12.5px;
        }

        .aal-table th,
        .aal-table td {
          box-sizing: border-box;
          text-align: left;
          vertical-align: top;
          overflow-wrap: break-word;
          word-break: normal;
          white-space: normal;
        }

        .aal-table th {
          padding: 8px 10px;
          border-bottom: 2px solid rgba(0,0,0,0.25);
          color: #5a4015;
          font-weight: 900;
        }

        .aal-table td {
          padding: 8px 10px;
          border-bottom: 1px solid rgba(0,0,0,0.1);
          line-height: 1.45;
        }

        /* Keep short label columns readable instead of crushing words
           such as "Componente" into multiple fragments. */
        .aal-table th:first-child,
        .aal-table td:first-child {
          width: 30%;
          min-width: 130px;
        }

        .aal-table th:not(:first-child),
        .aal-table td:not(:first-child) {
          min-width: 220px;
        }

        .aal-table tr:nth-child(even) {
          background: rgba(0,0,0,0.025);
        }

        @media (max-width: 720px) {
          .aal-table {
            min-width: 560px;
          }

          .aal-table th:first-child,
          .aal-table td:first-child {
            min-width: 125px;
          }
        }

        .aal-h1, .aal-h2, .aal-h3 {
          margin: 6px 0 4px;
          color: var(--red);
          font-weight: 900;
          letter-spacing: 0.2px;
        }
        .aal-h1 { font-size: 17px; }
        .aal-h2 { font-size: 15px; border-bottom: 1px solid rgba(0,0,0,0.1); padding-bottom: 3px; }
        .aal-h3 { font-size: 14px; }

        .aal-source-row {
          margin-top: 9px;
          padding-top: 7px;
          border-top: 1px dashed rgba(0,0,0,0.18);
          display: flex;
          gap: 7px;
          align-items: center;
          flex-wrap: wrap;
        }
        .aal-source-chip {
          border: 1.5px solid color-mix(in srgb, var(--gold) 50%, transparent);
          background: color-mix(in srgb, var(--gold) 18%, transparent);
          color: #5a4015;
          border-radius: 999px;
          padding: 3px 9px;
          font-size: 11px;
          font-weight: 900;
          cursor: default;
        }
        .aal-source-chip.clickable {
          cursor: pointer;
          background: var(--gold);
          color: #2a1a05;
        }
        .aal-source-chip.clickable:hover {
          transform: translateY(-1px);
          box-shadow: 0 3px 8px rgba(214,178,111,0.5);
        }
        .aal-source-tag {
          font-size: 11px;
          color: var(--red);
          font-weight: 800;
        }
        /* Discrete provenance chips — never an alarming/error-styled box.
           GENERAL_ONLY / MIXED are ordinary, expected answer shapes, not
           failures, and never expose internal retrieval/mode names. */
        .aal-mode-chip {
          font-size: 11px;
          font-weight: 800;
          padding: 3px 9px;
          border-radius: 999px;
          border: 1.5px solid transparent;
        }
        .aal-mode-chip.general {
          color: #5a4015;
          background: rgba(0,0,0,0.06);
          border-color: rgba(0,0,0,0.12);
        }
        .aal-mode-chip.mixed {
          color: #5a4015;
          background: color-mix(in srgb, var(--gold) 12%, transparent);
          border-color: color-mix(in srgb, var(--gold) 35%, transparent);
        }

        .aal-msg-actions {
          position: absolute;
          bottom: -10px;
          right: 8px;
          display: flex;
          gap: 4px;
          opacity: 0;
          transition: opacity .2s ease;
        }
        .aal-bubble:hover .aal-msg-actions { opacity: 1; }
        .aal-msg-actions button {
          background: var(--bg-card);
          border: 1px solid var(--border-color2);
          border-radius: 6px;
          width: 22px; height: 22px;
          font-size: 11px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }
        .aal-msg-actions button:hover {
          border-color: var(--gold);
          transform: scale(1.1);
        }

        .aal-followups-inline {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding-left: 44px;
          margin-top: -4px;
        }
        .aal-followup-pill {
          background: var(--bg-card2);
          border: 1px dashed var(--gold-border);
          color: var(--gold);
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 11.5px;
          font-weight: 800;
          cursor: pointer;
          transition: all .2s ease;
        }
        .aal-followup-pill:hover {
          background: color-mix(in srgb, var(--gold) 15%, transparent);
          transform: translateY(-2px);
        }

        .aal-typing {
          background: color-mix(in srgb, #f5ecd6 100%, transparent);
          border: 1.5px solid rgba(0,0,0,0.15);
          border-radius: 4px 14px 14px 14px;
          padding: 14px 18px;
          display: flex;
          gap: 5px;
          align-items: center;
        }
        .aal-typing i {
          width: 7px; height: 7px;
          background: var(--gold);
          border-radius: 50%;
          animation: aalTypingDot 1.2s ease infinite;
        }
        .aal-typing i:nth-child(2) { animation-delay: 0.15s; }
        .aal-typing i:nth-child(3) { animation-delay: 0.3s; }
        @keyframes aalTypingDot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.7); }
          40% { opacity: 1; transform: scale(1.1); }
        }

        /* ═════════ INPUT ═════════ */
        .aal-input-row {
          display: flex;
          gap: 8px;
          padding: 10px;
          background: var(--bg-card);
          border: 1.5px solid var(--border-color2);
          border-radius: 14px;
          align-items: center;
          flex-shrink: 0;
          box-shadow: 0 4px 14px rgba(0,0,0,.2);
        }
        .aal-attach-btn {
          background: transparent;
          border: none;
          color: var(--text-faint);
          font-size: 18px;
          cursor: pointer;
          padding: 6px;
          border-radius: 8px;
          transition: all .2s ease;
        }
        .aal-attach-btn:hover {
          color: var(--gold);
          background: color-mix(in srgb, var(--gold) 10%, transparent);
        }
        .aal-input {
          flex: 1;
          min-height: 24px;
          max-height: 120px;
          resize: none;
          background: transparent;
          border: none;
          color: var(--text-primary);
          padding: 6px 8px;
          outline: none;
          font-size: 14px;
          line-height: 1.5;
          font-family: inherit;
        }
        .aal-input::placeholder {
          color: var(--text-faint);
        }
        .aal-send-btn {
          width: 40px; height: 40px;
          border-radius: 50%;
          border: none;
          background: var(--gold);
          color: #1a1a1a;
          cursor: pointer;
          display: grid;
          place-items: center;
          transition: transform .2s ease, box-shadow .2s ease;
          box-shadow: 0 4px 12px color-mix(in srgb, var(--gold) 45%, transparent);
        }
        .aal-send-btn:hover:not(:disabled) {
          transform: translateY(-2px) rotate(-8deg);
          box-shadow: 0 6px 16px color-mix(in srgb, var(--gold) 60%, transparent);
        }
        .aal-send-btn:disabled {
          background: var(--bg-card2);
          color: var(--text-faint);
          cursor: not-allowed;
          box-shadow: none;
        }

        /* ═════════ QUICK ROW ═════════ */
        .aal-quick-row {
          display: flex;
          gap: 8px;
          justify-content: center;
          flex-wrap: wrap;
          padding: 4px 0;
          flex-shrink: 0;
        }
        .aal-quick-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1.5px solid var(--border-color2);
          background: var(--bg-card);
          color: var(--text-secondary);
          border-radius: 999px;
          padding: 7px 14px;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          transition: all .2s ease;
        }
        .aal-quick-pill:hover:not(:disabled) {
          border-color: var(--gold);
          color: var(--gold);
          background: color-mix(in srgb, var(--gold) 8%, var(--bg-card));
          transform: translateY(-2px);
        }
        .aal-quick-pill span { font-size: 13px; }
        .aal-quick-pill:disabled { opacity: 0.4; cursor: not-allowed; }

        .aal-disclaimer {
          text-align: center;
          font-size: 10.5px;
          color: var(--text-faint);
          margin-top: 2px;
        }

        /* ═════════ RIGHT PANEL ═════════ */
        .aal-right-panel {
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-height: 0;
          overflow-y: auto;
          padding-bottom: 8px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-color2) transparent;
        }
        .aal-right-panel::-webkit-scrollbar { width: 4px; }
        .aal-right-panel::-webkit-scrollbar-thumb { background: var(--border-color2); border-radius: 2px; }

        /* MASCOT */
        .aal-mascot-card {
          background: var(--bg-card);
          border: 1.5px solid var(--border-color2);
          border-radius: 14px;
          padding: 16px;
          display: grid;
          place-items: center;
          box-shadow: 0 8px 24px rgba(0,0,0,.25);
        }
        .aal-mascot {
          position: relative;
          width: 110px;
          display: flex;
          flex-direction: column;
          align-items: center;
          animation: aalFloat 4s ease-in-out infinite;
        }
        @keyframes aalFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        .aal-mascot-head {
          position: relative;
          width: 80px; height: 75px;
          background: linear-gradient(180deg, #e8e8ee 0%, #c8c8d2 100%);
          border-radius: 38px 38px 22px 22px;
          border: 2px solid #4a4a55;
          display: grid;
          place-items: center;
          box-shadow: inset -4px -4px 8px rgba(0,0,0,0.15), 0 4px 10px rgba(0,0,0,0.4);
        }
        .aal-mascot-antenna {
          position: absolute;
          top: -22px;
          left: 50%;
          transform: translateX(-50%);
          width: 4px;
          height: 18px;
          background: #4a4a55;
          border-radius: 2px;
        }
        .aal-mascot-antenna::after {
          content: '';
          position: absolute;
          top: -7px;
          left: 50%;
          transform: translateX(-50%);
          width: 10px; height: 10px;
          border-radius: 50%;
          background: var(--red);
          box-shadow: 0 0 12px var(--red);
          animation: aalAntenna 1.5s ease infinite;
        }
        @keyframes aalAntenna {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .aal-spark {
          position: absolute;
          color: var(--gold);
          font-size: 12px;
          animation: aalSpark 2s ease infinite;
        }
        .aal-spark.s1 { top: -28px; left: -18px; animation-delay: 0s; }
        .aal-spark.s2 { top: -18px; right: -22px; animation-delay: 0.5s; font-size: 14px; }
        .aal-spark.s3 { top: 0; right: -25px; animation-delay: 1s; }
        @keyframes aalSpark {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        .aal-mascot-face {
          display: flex;
          gap: 12px;
          margin-top: 8px;
          position: relative;
        }
        .aal-mascot-eye {
          width: 14px; height: 14px;
          background: #1a1a1a;
          border-radius: 50%;
          position: relative;
        }
        .aal-mascot-eye::after {
          content: '';
          position: absolute;
          top: 2px; left: 2px;
          width: 5px; height: 5px;
          background: var(--gold);
          border-radius: 50%;
          box-shadow: 0 0 4px var(--gold);
          animation: aalEyeShine 3s ease infinite;
        }
        @keyframes aalEyeShine {
          0%, 100% { opacity: 1; }
          90%, 95% { opacity: 0.2; transform: scaleY(0.1); }
        }
        .aal-mascot-mouth {
          position: absolute;
          bottom: -18px;
          left: 50%;
          transform: translateX(-50%);
          width: 18px; height: 9px;
          border: 2px solid #1a1a1a;
          border-top: none;
          border-radius: 0 0 18px 18px;
        }
        .aal-mascot-cheeks {
          position: absolute;
          top: 38px;
          width: 100%;
          display: flex;
          justify-content: space-between;
          padding: 0 6px;
          pointer-events: none;
        }
        .aal-mascot-cheeks div {
          width: 10px; height: 7px;
          background: rgba(244, 114, 182, 0.5);
          border-radius: 50%;
          filter: blur(1px);
        }
        .aal-mascot-body {
          width: 90px; height: 60px;
          background: linear-gradient(180deg, #d4d4dc 0%, #a8a8b8 100%);
          border-radius: 14px 14px 12px 12px;
          border: 2px solid #4a4a55;
          border-top: none;
          margin-top: -4px;
          display: grid;
          place-items: center;
          box-shadow: inset -4px -4px 8px rgba(0,0,0,0.15), 0 6px 12px rgba(0,0,0,0.3);
        }
        .aal-mascot-heart {
          width: 38px; height: 38px;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 30%, var(--red), #5a0a05);
          color: #fff;
          font-weight: 900;
          font-size: 13px;
          display: grid;
          place-items: center;
          letter-spacing: 0.5px;
          box-shadow: 0 0 12px color-mix(in srgb, var(--red) 60%, transparent), inset 0 -2px 4px rgba(0,0,0,0.3);
        }

        /* HELP CARD */
        .aal-card {
          background: var(--bg-card);
          border: 1.5px solid var(--border-color2);
          border-radius: 14px;
          padding: 14px;
          box-shadow: 0 8px 24px rgba(0,0,0,.25);
        }
        .aal-help-card h4 {
          margin: 0 0 10px;
          font-size: 13px;
          font-weight: 900;
          color: var(--gold);
          letter-spacing: 0.2px;
        }
        .aal-help-list {
          list-style: none;
          padding: 0; margin: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .aal-help-list li {
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }
        .aal-help-icon {
          font-size: 16px;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .aal-help-list strong {
          display: block;
          font-size: 12px;
          font-weight: 900;
          color: var(--text-primary);
          line-height: 1.2;
        }
        .aal-help-list small {
          display: block;
          font-size: 10.5px;
          color: var(--text-faint);
          margin-top: 2px;
        }

        /* TIP STICKER */
        .aal-tip-sticker {
          position: relative;
          background: color-mix(in srgb, var(--gold) 18%, #f5ecd6);
          color: #2a1a05;
          padding: 16px 14px 14px;
          border-radius: 4px;
          box-shadow: 0 6px 16px rgba(0,0,0,.4);
          transform: rotate(-1.5deg);
          margin-top: 6px;
        }
        .aal-tip-tape {
          position: absolute;
          top: -8px;
          left: 50%;
          width: 60px;
          height: 14px;
          transform: translateX(-50%) rotate(-3deg);
          background: color-mix(in srgb, var(--red) 60%, #c8a05a);
          opacity: .8;
          box-shadow: 0 2px 6px rgba(0,0,0,.3);
        }
        .aal-tip-sticker h5 {
          margin: 0 0 6px;
          font-size: 14px;
          font-weight: 900;
          color: #2a1a05;
        }
        .aal-tip-sticker p {
          margin: 0;
          font-size: 11.5px;
          line-height: 1.4;
          color: #3a2a10;
        }
        .aal-tip-sticker p em {
          font-style: normal;
          font-weight: 900;
          color: var(--red);
          background: linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.5) 100%, transparent 100%);
          padding: 0 3px;
        }
        .aal-tip-heart {
          position: absolute;
          bottom: 6px;
          right: 10px;
          color: var(--red);
          font-size: 16px;
        }

        /* ═════════ RESPONSIVE ═════════ */
        @media (max-width: 1280px) {
          .aal-main { grid-template-columns: minmax(340px, 40%) 1fr; }
        }
        @media (max-width: 1100px) {
          .aal-topbar { grid-template-columns: auto 1fr; }
          .aal-topbar-right { display: none; }
          .aal-main { grid-template-columns: minmax(320px, 38%) 1fr; }
          .aal-right-panel { display: none; }
        }
        @media (max-width: 800px) {
          .aal-screen { width: 100%; max-width: 100vw; overflow-x: hidden; }
          .aal-main { grid-template-columns: minmax(0, 1fr); overflow-y: auto; overflow-x: hidden; padding: 0 12px 16px; width: 100%; min-width: 0; }
          .aal-pdf-panel { min-height: 360px; }
          .aal-chat-center { min-height: 520px; min-width: 0; width: 100%; }
          .aal-input-row { min-width: 0; }
          .aal-input { min-width: 0; }
          .aal-bubble { max-width: calc(100% - 42px); }
          .aal-quick-pill { font-size: 11px; padding: 6px 10px; }
        }
      `}</style>
    </div>
  );
}
