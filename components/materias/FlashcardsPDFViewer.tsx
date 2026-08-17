'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

if (typeof window !== 'undefined' && pdfjs?.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
}

export interface SelectionMenu {
  x: number;
  y: number;
  text: string;
}

interface Props {
  url: string;
  selectedPages: number[];
  themeColor: string;
  onTotalPages: (n: number) => void;
  onSelectionMenu?: (menu: SelectionMenu | null) => void;
  totalSelectedPages?: number;
  activeMaterialIndex?: number;
  materialesCount?: number;
  forcedPage?: number;
  globalSelectedIndex?: number;
  globalSelectedTotal?: number;
  onRequestPrev?: () => void;
  onRequestNext?: () => void;
  onPageChange?: (page: number) => void;
  // Solo para ALAIStudyALQuizzes: muestra la página de la pregunta actual en el header
  currentQuestionPage?: number;
  scrollTrigger?: number;
}

const BODY = "var(--font-body)";

export default function FlashcardsPDFViewer({
  url,
  selectedPages,
  themeColor,
  onTotalPages,
  onSelectionMenu,
  totalSelectedPages = 0,
  activeMaterialIndex = 0,
  materialesCount = 1,
  forcedPage,
  globalSelectedIndex,
  globalSelectedTotal,
  onRequestPrev,
  onRequestNext,
  onPageChange,
  currentQuestionPage,
  scrollTrigger,
}: Props) {
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pdfReady, setPdfReady] = useState(false);
  const [firstPageRendered, setFirstPageRendered] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement>>({});
  const programmaticScrollRef = useRef(false);
  const ignoreForcedPageRef = useRef(false);
  // Para detectar scroll hasta el borde y saltar de material
  const scrollEdgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const atTopRef = useRef(false);
  const atBottomRef = useRef(false);

  const normalizedSelectedPages = useMemo(
    () =>
      Array.from(
        new Set(
          (selectedPages || [])
            .map((n) => Number(n))
            .filter((n) => Number.isFinite(n) && n > 0)
        )
      ).sort((a, b) => a - b),
    [selectedPages]
  );

  const pages = useMemo(
    () =>
      normalizedSelectedPages.length > 0
        ? normalizedSelectedPages
        : Array.from({ length: numPages }, (_, i) => i + 1),
    [normalizedSelectedPages, numPages]
  );

  const currentIndex = pages.indexOf(currentPage);
  const idxLocal = pages.indexOf(currentPage);
  const canPrev = idxLocal > 0 || !!onRequestPrev;
  const canNext = (idxLocal >= 0 && idxLocal < pages.length - 1) || !!onRequestNext;

  const globalIndex =
    typeof globalSelectedIndex === 'number' && globalSelectedIndex >= 0
      ? globalSelectedIndex
      : currentIndex;

  const hasGlobalSelection =
    normalizedSelectedPages.length > 0 &&
    typeof globalSelectedTotal === 'number' &&
    globalSelectedTotal > 0;

  // Indicador de página para el header
  // Si hay globalSelection usamos globalIndex/globalSelectedTotal
  // Si no, usamos currentPage/numPages
  const pageLabel = hasGlobalSelection
    ? `${globalIndex + 1} / ${globalSelectedTotal}`
    : numPages > 0
    ? `${currentPage} / ${numPages}`
    : `${currentPage}`;

  // ── Al cambiar de material/url → reset ──
  useEffect(() => {
    pageRefs.current = {};
    setPdfReady(false);
    setFirstPageRendered(false);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [url, activeMaterialIndex]);

  // ── Notificar página actual ──
  useEffect(() => {
    if (currentPage > 0) {
      onPageChange?.(currentPage);
    }
  }, [currentPage, onPageChange]);

  const handleLoad = ({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    onTotalPages(total);
    const firstPage =
      normalizedSelectedPages.length > 0 ? normalizedSelectedPages[0] : 1;
    setCurrentPage(firstPage);
    setPdfReady(true);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  };

  const handleMouseUp = useCallback(() => {
    if (!onSelectionMenu) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.length < 3) {
      onSelectionMenu(null);
      return;
    }
    try {
      const range = sel!.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      onSelectionMenu({
        x: rect.left - containerRect.left + rect.width / 2,
        y: rect.top - containerRect.top - 8,
        text,
      });
    } catch {
      onSelectionMenu(null);
    }
  }, [onSelectionMenu]);

  const scrollToPage = useCallback(
    (targetPage: number, behavior: ScrollBehavior = 'smooth') => {
      const pageEl = pageRefs.current[targetPage];
      const scrollEl = scrollRef.current;
      if (!pageEl || !scrollEl) return false;

      programmaticScrollRef.current = true;
      const pageRect = pageEl.getBoundingClientRect();
      const scrollRect = scrollEl.getBoundingClientRect();
      const diff = pageRect.top - scrollRect.top;
      scrollEl.scrollTo({ top: Math.max(0, scrollEl.scrollTop + diff), behavior });

      window.setTimeout(() => {
        programmaticScrollRef.current = false;
      }, 500);
      return true;
    },
    []
  );

  const changePage = useCallback(
    (newPage: number, behavior: ScrollBehavior = 'smooth') => {
      if (!pages.includes(newPage)) return;
      onSelectionMenu?.(null);
      setCurrentPage(newPage);
      scrollToPage(newPage, behavior);
    },
    [pages, onSelectionMenu, scrollToPage]
  );

  // ── forcedPage: un solo intento sin loops ──
  useEffect(() => {
    if (typeof forcedPage !== 'number' || !Number.isFinite(forcedPage) || forcedPage <= 0) return;
    if (!pages.includes(forcedPage)) return;
    if (ignoreForcedPageRef.current) return;

    setCurrentPage(forcedPage);
    const timer = setTimeout(() => {
      scrollToPage(forcedPage, 'smooth');
    }, 80);
    return () => clearTimeout(timer);
  }, [forcedPage]); // Solo forcedPage como dep para evitar loops

  // ── currentQuestionPage: scroll automático cuando cambia la pregunta ──
  useEffect(() => {
    if (typeof currentQuestionPage !== 'number' || currentQuestionPage <= 0) return;
    if (!pdfReady) return;
    // Scroll a la página de la pregunta sin bloqueos
    const timer = setTimeout(() => {
      const targetPage = currentQuestionPage;
      if (pageRefs.current[targetPage]) {
        setCurrentPage(targetPage);
        scrollToPage(targetPage, 'smooth');
      } else if (pages.length > 0) {
        // Si la página exacta no está en selectedPages, ir a la más cercana
        const closest = pages.reduce((prev, curr) =>
          Math.abs(curr - targetPage) < Math.abs(prev - targetPage) ? curr : prev
        );
        setCurrentPage(closest);
        scrollToPage(closest, 'smooth');
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [currentQuestionPage, scrollTrigger, pdfReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Detectar página visible + navegación entre materiales por scroll ──
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || pages.length === 0) return;

    let rafId: number;

    const onScroll = () => {
      if (programmaticScrollRef.current) return;

      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const scrollRect = scrollEl.getBoundingClientRect();
        const scrollCenter = scrollRect.top + scrollRect.height / 2;

        // Detectar página visible
        let bestPage = currentPage;
        let bestDist = Infinity;
        for (const [pageNumStr, el] of Object.entries(pageRefs.current)) {
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          const dist = Math.abs(rect.top + rect.height / 2 - scrollCenter);
          if (dist < bestDist) {
            bestDist = dist;
            bestPage = parseInt(pageNumStr, 10);
          }
        }
        if (bestPage > 0) {
          setCurrentPage((prev) => (prev === bestPage ? prev : bestPage));
        }

        // Detectar si estamos al tope o al fondo para saltar material
        const atTop = scrollEl.scrollTop <= 4;
        const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 4;

        if (atBottom && !atBottomRef.current && onRequestNext) {
          atBottomRef.current = true;
          // Si ya estamos en la última página local, saltar al siguiente material
          const idx = pages.indexOf(bestPage);
          if (idx === pages.length - 1) {
            if (scrollEdgeTimerRef.current) clearTimeout(scrollEdgeTimerRef.current);
            scrollEdgeTimerRef.current = setTimeout(() => {
              ignoreForcedPageRef.current = false;
              onRequestNext();
            }, 300);
          }
        } else if (!atBottom) {
          atBottomRef.current = false;
        }

        if (atTop && !atTopRef.current && onRequestPrev) {
          atTopRef.current = true;
          const idx = pages.indexOf(bestPage);
          if (idx === 0) {
            if (scrollEdgeTimerRef.current) clearTimeout(scrollEdgeTimerRef.current);
            scrollEdgeTimerRef.current = setTimeout(() => {
              ignoreForcedPageRef.current = false;
              onRequestPrev();
            }, 300);
          }
        } else if (!atTop) {
          atTopRef.current = false;
        }
      });
    };

    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId);
      if (scrollEdgeTimerRef.current) clearTimeout(scrollEdgeTimerRef.current);
    };
  }, [pages, numPages, onRequestNext, onRequestPrev]);

  const goPrev = useCallback(() => {
    ignoreForcedPageRef.current = true;
    const idx = pages.indexOf(currentPage);
    if (idx > 0) {
      changePage(pages[idx - 1]);
    } else if (onRequestPrev) {
      onRequestPrev();
    }
    setTimeout(() => { ignoreForcedPageRef.current = false; }, 800);
  }, [pages, currentPage, onRequestPrev, changePage]);

  const goNext = useCallback(() => {
    ignoreForcedPageRef.current = true;
    const idx = pages.indexOf(currentPage);
    if (idx >= 0 && idx < pages.length - 1) {
      changePage(pages[idx + 1]);
    } else if (onRequestNext) {
      onRequestNext();
    }
    setTimeout(() => { ignoreForcedPageRef.current = false; }, 800);
  }, [pages, currentPage, onRequestNext, changePage]);

  // ── Keyboard ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goPrev(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev]);

  return (
    <div
      ref={containerRef}
      onMouseUp={handleMouseUp}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}
    >
      {/* ── Header / navegación ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 10px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: '#0a0a0e',
        flexShrink: 0,
        gap: 8,
        minHeight: 44,
      }}>
        {/* Prev */}
        <button
          onClick={goPrev}
          disabled={!canPrev}
          style={{
            width: 32, height: 32, borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.12)',
            background: canPrev ? 'rgba(255,255,255,0.07)' : 'transparent',
            color: canPrev ? '#fff' : 'rgba(255,255,255,0.2)',
            cursor: canPrev ? 'pointer' : 'default',
            fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >‹</button>

        {/* Indicador central */}
        <div style={{
          flex: 1, textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 1,
        }}>
          {/* Página de la pregunta actual (solo ALAIStudyALQuizzes) */}
          {currentQuestionPage && currentQuestionPage > 0 && (
            <div style={{
              fontSize: 10, color: themeColor,
              fontFamily: BODY, fontWeight: 700,
              letterSpacing: '0.5px',
              background: `${themeColor}18`,
              padding: '1px 8px', borderRadius: 4,
              lineHeight: 1.4,
            }}>
              📍 Pregunta en pág. {currentQuestionPage}
            </div>
          )}
          {/* Indicador de scroll actual */}
          <div style={{
            fontSize: 12, color: 'rgba(255,255,255,0.5)',
            fontFamily: BODY, fontWeight: 700, lineHeight: 1.2,
          }}>
            <span style={{ color: themeColor }}>{pageLabel.split('/')[0]?.trim()}</span>
            {pageLabel.includes('/') && (
              <span style={{ color: 'rgba(255,255,255,0.35)' }}> / {pageLabel.split('/')[1]?.trim()}</span>
            )}
          </div>
          {materialesCount > 1 && (
            <div style={{
              fontSize: 10, color: 'rgba(255,255,255,0.3)',
              fontFamily: BODY, lineHeight: 1,
            }}>
              mat {activeMaterialIndex + 1}/{materialesCount}
            </div>
          )}
        </div>

        {/* Next */}
        <button
          onClick={goNext}
          disabled={!canNext}
          style={{
            width: 32, height: 32, borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.12)',
            background: canNext ? 'rgba(255,255,255,0.07)' : 'transparent',
            color: canNext ? '#fff' : 'rgba(255,255,255,0.2)',
            cursor: canNext ? 'pointer' : 'default',
            fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >›</button>
      </div>

      {/* ── Scroll area con el PDF ── */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '12px 8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
        }}
      >
        {/* Indicador cargando PDF — espera a que la primera página renderice */}
        {!firstPageRendered && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 5,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 12, background: '#000',
          }}>
            <div style={{
              width: 32, height: 32,
              border: `3px solid ${themeColor}33`,
              borderTop: `3px solid ${themeColor}`,
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <div style={{
              fontSize: 13, fontFamily: BODY,
              color: 'rgba(255,255,255,0.4)',
            }}>Cargando PDF...</div>
          </div>
        )}

        <Document
          file={url}
          onLoadSuccess={handleLoad}
          loading={null}
          error={
            <div style={{
              color: '#ef4444', fontFamily: BODY, fontSize: 13,
              padding: 40, textAlign: 'center',
            }}>
              Error al cargar el PDF
            </div>
          }
        >
          {pages.map((pageNum) => {
            const isActive = currentPage === pageNum;
            return (
              <div
                key={pageNum}
                ref={(el) => {
                  if (el) pageRefs.current[pageNum] = el;
                  else delete pageRefs.current[pageNum];
                }}
                style={{
                  position: 'relative',
                  border: isActive
                    ? `2px solid ${themeColor}`
                    : '2px solid rgba(255,255,255,0.06)',
                  borderRadius: 8,
                  overflow: 'hidden',
                  transition: 'all 0.25s ease',
                  boxShadow: isActive
                    ? `0 0 20px ${themeColor}33, 0 4px 16px rgba(0,0,0,0.4)`
                    : '0 2px 8px rgba(0,0,0,0.3)',
                  flexShrink: 0,
                }}
              >
                {/* Badge número de página arriba izquierda */}
                <div style={{
                  position: 'absolute',
                  top: 8, left: 8, zIndex: 10,
                  padding: '3px 10px', borderRadius: 6,
                  background: isActive ? themeColor : 'rgba(0,0,0,0.65)',
                  backdropFilter: 'blur(8px)',
                  border: isActive
                    ? `1px solid ${themeColor}`
                    : '1px solid rgba(255,255,255,0.15)',
                  color: isActive ? '#000' : 'rgba(255,255,255,0.75)',
                  fontFamily: BODY, fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.3px', lineHeight: 1,
                  boxShadow: isActive ? `0 2px 8px ${themeColor}55` : '0 1px 4px rgba(0,0,0,0.4)',
                  transition: 'all 0.25s ease',
                  pointerEvents: 'none',
                }}>
                  p.{pageNum}
                </div>

                <Page
                  pageNumber={pageNum}
                  width={Math.min(
                    (containerRef.current?.clientWidth ?? 600) - 40,
                    700
                  )}
                  renderTextLayer
                  renderAnnotationLayer
                  onRenderSuccess={() => {
                    // La primera página visible terminó de renderizar
                    if (pageNum === pages[0]) {
                      setFirstPageRendered(true);
                    }
                  }}
                  loading={
                    <div style={{
                      width: Math.min((containerRef.current?.clientWidth ?? 600) - 40, 700),
                      height: 900,
                      background: '#0f1117',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 12,
                    }}>
                      <div style={{
                        width: 28, height: 28,
                        border: `3px solid ${themeColor}33`,
                        borderTop: `3px solid ${themeColor}`,
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                      }} />
                      <div style={{
                        fontSize: 12, fontFamily: BODY,
                        color: 'rgba(255,255,255,0.35)',
                      }}>Renderizando página {pageNum}...</div>
                    </div>
                  }
                />
              </div>
            );
          })}
        </Document>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
