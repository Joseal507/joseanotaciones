'use client';

import { useState, useEffect, useRef, useCallback, useMemo} from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '../../lib/supabase';
import { detectContentLanguage } from '../../lib/detectLanguage';
import MathText from '../MathText';
import { upsertSession, getSessionsByTema } from '../../lib/studySessions';
const PDFViewer = dynamic(() => import('./FlashcardsPDFViewer'), { ssr: false });
const SourceViewer = dynamic(() => import('./FlashcardSourceViewer'), { ssr: false });

interface Flashcard {
  id: string;
  question: string;
  answer: string;
  createdAt: number;
  sourceText?: string;
  sourcePage?: number;
  materialId?: string;
  sourceMaterialId?: string;
}

interface SeleccionItem {
  materialId: string;
  pages: number[];
  text?: string;
}

interface Props {
  materiales: any[];
  seleccion?: React.ComponentState | any[] | null;
  tema: any;
  materia: any;
  sessionId?: string | null;
  onBack: () => void;
}

type StudyMode = 'repite' | 'rapido';
type StudyOrder = 'bucle' | 'lineal';

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const dedupe = (cards: any[]) => {
  const seen = new Set<string>();
  return cards.filter(c => {
    const k = c.question.toLowerCase().trim().slice(0, 60);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
};

const HAND = "'Patrick Hand', cursive";
const BODY = "'Inter', system-ui, sans-serif";

function cleanFlashcardText(text: string): string {
  if (!text) return '';
  let t = String(text);
  t = t.replace(/\$(\s*[\d,\.]+\s*)\$/g, '$1');
  t = t.replace(/\$([^$]+?)\$/g, (match, content) => {
    if (/\\(frac|sqrt|sum|int|prod|lim|alpha|beta|gamma|theta|pi|infty|partial|nabla)|\^|_\{/.test(content)) {
      return match;
    }
    return content;
  });
  t = t.replace(/\$\$([^$]+?)\$\$/g, (match, content) => {
    if (/\\(frac|sqrt|sum|int|prod|lim)|\^\{|_\{/.test(content)) {
      return match;
    }
    return content;
  });
  t = t.replace(/([\d,\.])\n([a-zA-Z])/g, '$1 $2');
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}

function NotebookCard({
  card, color, flipped, onFlip, large = false,
}: {
  card: Flashcard;
  color: string;
  flipped: boolean;
  onFlip: () => void;
  large?: boolean;
}) {
  const isAnswer = flipped;
  return (
    <div
      onClick={onFlip}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: large ? 680 : '100%',
        cursor: 'pointer',
        transition: 'transform 0.2s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      <div style={{
        minHeight: large ? 340 : 220,
        backgroundColor: '#0f1117',
        borderRadius: 14,
        border: `1px solid ${isAnswer ? color + '44' : 'rgba(255,255,255,0.06)'}`,
        boxShadow: isAnswer
          ? `0 12px 32px rgba(0,0,0,0.5), 0 0 20px ${color}22, inset 0 0 0 1px ${color}11`
          : '0 8px 24px rgba(0,0,0,0.4)',
        padding: large ? '30px 38px 24px 78px' : '24px 24px 20px 62px',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        transition: 'all 0.3s ease',
        backgroundImage: `linear-gradient(
          to bottom,
          transparent 0,
          transparent ${large ? 38 : 30}px,
          rgba(255,255,255,0.04) ${large ? 38 : 30}px,
          rgba(255,255,255,0.04) ${large ? 39 : 31}px,
          transparent ${large ? 39 : 31}px
        )`,
        backgroundSize: `100% ${large ? 39 : 31}px`,
        backgroundPosition: `0 ${large ? 50 : 40}px`,
        backgroundRepeat: 'repeat',
      }}>
        <div style={{
          position: 'absolute',
          left: large ? 56 : 46, top: 0, bottom: 0,
          width: 1.5,
          background: 'linear-gradient(to bottom, transparent 0%, rgba(239, 68, 68, 0.5) 8%, rgba(239, 68, 68, 0.5) 92%, transparent 100%)',
          boxShadow: '0 0 6px rgba(239, 68, 68, 0.25)',
        }} />
        <div style={{
          position: 'absolute',
          left: large ? 18 : 14, top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex', flexDirection: 'column',
          gap: large ? 38 : 28,
        }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: large ? 14 : 10, height: large ? 14 : 10,
              borderRadius: '50%',
              background: '#0a0a0c',
              boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.04)',
            }} />
          ))}
        </div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          alignSelf: 'flex-start',
          padding: large ? '6px 16px' : '5px 13px',
          background: isAnswer
            ? `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`
            : 'linear-gradient(135deg, #ffffff 0%, #f0f0f0 100%)',
          border: `2px solid ${isAnswer ? color : '#2a2a2a'}`,
          borderRadius: 8,
          fontFamily: BODY,
          fontSize: large ? 15 : 13,
          fontWeight: 800,
          color: isAnswer ? '#000' : '#1a1a1a',
          transform: isAnswer ? 'rotate(1deg)' : 'rotate(-1deg)',
          boxShadow: isAnswer
            ? `2px 3px 0 rgba(0,0,0,0.4), 0 0 16px ${color}66`
            : '2px 3px 0 rgba(0,0,0,0.35)',
          marginBottom: large ? 24 : 18,
          marginLeft: large ? -4 : -2,
          letterSpacing: '0.5px',
          whiteSpace: 'nowrap',
        }}>
          {isAnswer ? '✓ RESPUESTA' : '✏️ PREGUNTA'}
        </div>
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 4,
          paddingRight: 8,
          overflow: 'auto',
          minHeight: large ? 180 : 100,
        }}>
          <div style={{
            fontFamily: BODY,
            fontSize: large ? 26 : 18,
            lineHeight: 1.5,
            color: isAnswer ? '#ffffff' : '#e8e8ed',
            fontWeight: 500,
            width: '100%',
            textShadow: isAnswer ? `0 1px 2px rgba(0,0,0,0.3)` : 'none',
          }}>
            <MathText text={cleanFlashcardText(isAnswer ? card.answer : card.question)} />
          </div>
        </div>
        {large && (
          <div style={{
            textAlign: 'center', fontFamily: BODY, fontSize: 13,
            color: 'rgba(255,255,255,0.25)', marginTop: 10,
            letterSpacing: '0.5px',
          }}>
            ~ ← → flechas · espacio voltear ~
          </div>
        )}
      </div>
    </div>
  );
}

function DashedButton({
  children, onClick, color, active = false, disabled = false, fontSize = 14,
}: {
  children: React.ReactNode;
  color: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  fontSize?: number;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '9px 18px',
        borderRadius: 12,
        border: `1.5px dashed ${color}`,
        background: active ? `${color}33` : 'transparent',
        color: color,
        fontFamily: BODY,
        fontSize: fontSize,
        fontWeight: 700,
        cursor: disabled ? 'default' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        transition: 'all 0.2s ease',
        opacity: disabled ? 0.4 : 1,
        boxShadow: active ? `0 4px 16px ${color}33` : 'none',
        letterSpacing: '0.3px',
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active) {
          (e.currentTarget as HTMLElement).style.background = `${color}15`;
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

function CardMenu({
  color, onStudySingle, onEdit, onShowSource, onDelete,
}: {
  color: string;
  onStudySingle: () => void;
  onEdit: () => void;
  onShowSource: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          width: 32, height: 32, borderRadius: 8, border: 'none',
          background: open ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)',
          color: '#fff', cursor: 'pointer', fontSize: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(8px)',
        }}
      >⋮</button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 38,
          background: '#1a1a22', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12, padding: 6, minWidth: 180,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)', zIndex: 50,
          display: 'flex', flexDirection: 'column',
        }}>
          {[
            { icon: '📖', label: 'Leer esta', action: onStudySingle },
            { icon: '🔍', label: 'Ver fuente', action: onShowSource },
            { icon: '✏️', label: 'Editar esta', action: onEdit },
            { icon: '🌐', label: 'Comunidad', action: () => {}, disabled: true },
            { icon: '🗑️', label: 'Eliminar', action: onDelete, danger: true },
          ].map(item => (
            <button
              key={item.label}
              onClick={(e) => {
                e.stopPropagation();
                if (!item.disabled) { item.action(); setOpen(false); }
              }}
              disabled={item.disabled}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '9px 11px', borderRadius: 8, border: 'none',
                background: 'transparent',
                color: item.danger ? '#ef4444' : item.disabled ? '#444' : '#ddd',
                fontSize: 13, cursor: item.disabled ? 'default' : 'pointer',
                textAlign: 'left', fontFamily: BODY,
              }}
              onMouseEnter={(e) => {
                if (!item.disabled) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              {item.label}
              {item.disabled && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#555' }}>pronto</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NumberedPagination({
  total, current, onChange, color,
}: {
  total: number;
  current: number;
  onChange: (i: number) => void;
  color: string;
}) {
  const renderNumbers = () => {
    if (total <= 25) {
      return Array.from({ length: total }, (_, i) => i);
    }
    const window: (number | 'dots')[] = [];
    const showRange = (start: number, end: number) => {
      for (let i = start; i <= end; i++) window.push(i);
    };
    if (current < 6) {
      showRange(0, Math.min(8, total - 1));
      if (total > 9) { window.push('dots'); showRange(total - 2, total - 1); }
    } else if (current > total - 7) {
      showRange(0, 1); window.push('dots');
      showRange(Math.max(0, total - 9), total - 1);
    } else {
      showRange(0, 1); window.push('dots');
      showRange(current - 3, current + 3);
      window.push('dots'); showRange(total - 2, total - 1);
    }
    return window;
  };
  const items = renderNumbers();

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 5,
      justifyContent: 'center', maxWidth: 720, margin: '0 auto',
      padding: '4px 0',
    }}>
      {items.map((item, idx) => {
        if (item === 'dots') {
          return (
            <span key={`dots-${idx}`} style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '0 6px', color: '#555', fontFamily: BODY, fontSize: 14,
            }}>···</span>
          );
        }
        const i = item;
        return (
          <button
            key={i}
            onClick={() => onChange(i)}
            style={{
              minWidth: 30, height: 30, padding: '0 7px',
              borderRadius: 6,
              border: i === current ? `1.5px solid ${color}` : '1px solid rgba(255,255,255,0.12)',
              background: i === current ? `${color}33` : 'rgba(255,255,255,0.02)',
              color: i === current ? color : '#888',
              fontFamily: BODY,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s',
              boxShadow: i === current ? `0 4px 12px ${color}44` : 'none',
            }}
            onMouseEnter={(e) => {
              if (i !== current) (e.currentTarget as HTMLElement).style.background = `${color}15`;
            }}
            onMouseLeave={(e) => {
              if (i !== current) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)';
            }}
          >{i + 1}</button>
        );
      })}
    </div>
  );
}

type SortMode = 'natural' | 'material_first' | 'material_last' | 'newest' | 'oldest' | 'page' | 'favs_first';
const SORT_LABELS: Record<SortMode, string> = {
  natural: '📋 Orden original',
  material_first: '📚 Material: A → Z',
  material_last: '📚 Material: Z → A',
  newest: '🆕 Más recientes',
  oldest: '📅 Más antiguas',
  page: '📄 Por página',
  favs_first: '⭐ Favoritas primero',
};

function useFlashcardControls(cards: Flashcard[]) {
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('flashcard_favs');
      return new Set(stored ? JSON.parse(stored) : []);
    } catch { return new Set(); }
  });
  const [showOnlyFavs, setShowOnlyFavs] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('natural');
  const [showSortMenu, setShowSortMenu] = useState(false);

  const toggleFav = (id: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem('flashcard_favs', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  useEffect(() => {
    if (favorites.size === 0) return;
    const validIds = new Set(cards.map(c => c.id));
    const cleaned = new Set<string>();
    let removed = 0;
    favorites.forEach(id => {
      if (validIds.has(id)) cleaned.add(id);
      else removed++;
    });
    if (removed > 0) {
      setFavorites(cleaned);
      try { localStorage.setItem('flashcard_favs', JSON.stringify([...cleaned])); } catch {}
    }
  }, [cards, favorites]);

  useEffect(() => {
    if (favorites.size === 0) {
      if (sortMode === 'favs_first') setSortMode('natural');
      if (showOnlyFavs) setShowOnlyFavs(false);
    }
  }, [favorites.size, sortMode, showOnlyFavs]);

  const sortedCards = useMemo(() => {
    const arr = [...cards];
    switch (sortMode) {
      case 'material_first':
        return arr.sort((a, b) => {
          const ma = a.sourceMaterialId || a.materialId || '';
          const mb = b.sourceMaterialId || b.materialId || '';
          return ma.localeCompare(mb);
        });
      case 'material_last':
        return arr.sort((a, b) => {
          const ma = a.sourceMaterialId || a.materialId || '';
          const mb = b.sourceMaterialId || b.materialId || '';
          return mb.localeCompare(ma);
        });
      case 'newest':
        return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      case 'oldest':
        return arr.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      case 'page':
        return arr.sort((a, b) => (a.sourcePage || 0) - (b.sourcePage || 0));
      case 'favs_first':
        return arr.sort((a, b) => {
          const fa = favorites.has(a.id) ? 0 : 1;
          const fb = favorites.has(b.id) ? 0 : 1;
          return fa - fb;
        });
      case 'natural':
      default:
        return arr;
    }
  }, [cards, sortMode, favorites]);

  const visibleCards = showOnlyFavs
    ? sortedCards.filter(c => favorites.has(c.id))
    : sortedCards;

  return {
    favorites, toggleFav,
    showOnlyFavs, setShowOnlyFavs,
    sortMode, setSortMode,
    showSortMenu, setShowSortMenu,
    sortedCards, visibleCards,
  };
}

function ControlsBar({ controls, color }: {
  controls: ReturnType<typeof useFlashcardControls>;
  color: string;
}) {
  const { favorites, showOnlyFavs, setShowOnlyFavs, sortMode, setSortMode, showSortMenu, setShowSortMenu } = controls;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap', position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowSortMenu(!showSortMenu)}
          style={{
            padding: '8px 14px', borderRadius: 999,
            background: 'rgba(255,255,255,0.04)',
            border: '1.5px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.85)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: BODY,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          {SORT_LABELS[sortMode]} ▾
        </button>
        {showSortMenu && (
          <>
            <div
              onClick={() => setShowSortMenu(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 99 }}
            />
            <div style={{
              position: 'absolute', top: '110%', left: 0, zIndex: 100,
              background: '#1a1a22', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12, padding: 6, minWidth: 200,
              boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', gap: 2,
            }}>
              {(Object.keys(SORT_LABELS) as SortMode[]).map(mode => {
                if (mode === 'favs_first' && favorites.size === 0) return null;
                return (
                  <button
                    key={mode}
                    onClick={() => { setSortMode(mode); setShowSortMenu(false); }}
                    style={{
                      padding: '8px 12px', borderRadius: 8,
                      background: sortMode === mode ? color + '22' : 'transparent',
                      color: sortMode === mode ? color : 'rgba(255,255,255,0.8)',
                      border: 'none', textAlign: 'left',
                      fontSize: 13, fontWeight: sortMode === mode ? 700 : 500,
                      cursor: 'pointer', fontFamily: BODY,
                    }}
                  >
                    {SORT_LABELS[mode]}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
      {favorites.size > 0 && (
        <button
          onClick={() => setShowOnlyFavs(!showOnlyFavs)}
          style={{
            padding: '8px 16px', borderRadius: 999,
            background: showOnlyFavs ? '#fbbf24' : 'rgba(255,255,255,0.04)',
            border: showOnlyFavs ? '1.5px solid #f59e0b' : '1.5px solid rgba(255,255,255,0.1)',
            color: showOnlyFavs ? '#000' : 'rgba(255,255,255,0.7)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: BODY, display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          {showOnlyFavs ? '★' : '☆'} {showOnlyFavs ? 'Mostrando favoritos' : `Solo favoritos (${favorites.size})`}
        </button>
      )}
    </div>
  );
}

function DeckView({
  cards, color, onEdit, onDelete, onShowSource, onStudyAll,
  onStudySingle, onRegenerate, generating, onCreateManual,
}: {
  cards: Flashcard[];
  color: string;
  onEdit: (card: Flashcard) => void;
  onDelete: (id: string) => void;
  onShowSource: (card: Flashcard) => void;
  onStudyAll: () => void;
  onStudySingle: (card: Flashcard) => void;
  onRegenerate: () => void;
  generating: boolean;
  onCreateManual: () => void;
}) {
  const controls = useFlashcardControls(cards);
  const { favorites, toggleFav, visibleCards } = controls;
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = visibleCards[current];

  useEffect(() => {
    if (current >= visibleCards.length && visibleCards.length > 0) {
      setCurrent(0);
    }
  }, [visibleCards.length, current]);

  useEffect(() => { setFlipped(false); }, [current]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') setCurrent(c => Math.max(0, c - 1));
      else if (e.key === 'ArrowRight') setCurrent(c => Math.min(visibleCards.length - 1, c + 1));
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlipped(f => !f); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visibleCards.length]);

  return (
    <div style={{
      flex: 1, overflow: 'auto', padding: '20px 28px 40px',
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      <div style={{ maxWidth: 800, margin: '0 auto', width: '100%' }}>
        <ControlsBar controls={controls} color={color} />
      </div>
      <div style={{
        padding: '12px 18px', borderRadius: 12,
        background: 'rgba(74, 222, 128, 0.06)',
        border: '1.5px dashed rgba(74, 222, 128, 0.5)',
        color: '#86efac',
        fontSize: 14, fontFamily: BODY, fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 10,
        maxWidth: 800, margin: '0 auto', width: '100%',
        boxSizing: 'border-box',
      }}>
        <span style={{ fontSize: 20 }}>🤖</span>
        <span>
          La AI generó <strong style={{ color: '#4ade80' }}>{cards.length} flashcards</strong> cubriendo el <strong style={{ color: '#4ade80' }}>100%</strong> del contenido
        </span>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', maxWidth: 800, margin: '0 auto', width: '100%',
      }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <DashedButton onClick={onStudyAll} color={color} active>
            🎯 Estudiar todas
          </DashedButton>
          <DashedButton onClick={() => onStudySingle(card)} color="#a78bfa">
            📖 Leer esta
          </DashedButton>
        </div>
        <div style={{ fontSize: 14, fontFamily: BODY, color: '#999', fontStyle: 'italic' }}>
          ~ {cards.length} {cards.length === 1 ? 'tarjeta' : 'tarjetas'} ~
        </div>
      </div>
      <NumberedPagination
        total={cards.length} current={current}
        onChange={setCurrent} color={color}
      />
      <div style={{ textAlign: 'center', maxWidth: 800, margin: '0 auto', width: '100%' }}>
        <span style={{
          display: 'inline-block', padding: '6px 18px',
          background: `${color}33`,
          border: `1.5px solid ${color}`,
          fontFamily: BODY, fontSize: 14, fontWeight: 700,
          color: color, borderRadius: 10,
        }}>
          {current + 1} / {cards.length}
        </span>
      </div>
      <div style={{
        display: 'flex', justifyContent: 'center', position: 'relative',
        marginTop: 4, maxWidth: 800, margin: '0 auto', width: '100%',
      }}>
        <div style={{ position: 'absolute', top: 8, right: 'calc(50% - 320px)', zIndex: 5 }}>
          <CardMenu
            color={color}
            onStudySingle={() => onStudySingle(card)}
            onEdit={() => onEdit(card)}
            onShowSource={() => onShowSource(card)}
            onDelete={() => {
              if (confirm('¿Eliminar esta tarjeta?')) {
                onDelete(card.id);
                setCurrent(c => Math.min(c, cards.length - 2));
              }
            }}
          />
        </div>
        <NotebookCard
          card={card} color={color}
          flipped={flipped} onFlip={() => setFlipped(f => !f)}
          large
        />
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
        marginTop: 6, maxWidth: 800, margin: '0 auto', width: '100%',
      }}>
        <button
          onClick={() => setCurrent(c => Math.max(0, c - 1))}
          disabled={current === 0}
          style={{
            padding: '10px 20px', borderRadius: 10,
            border: '1.5px dashed rgba(255,255,255,0.2)',
            background: 'transparent',
            color: current === 0 ? '#444' : '#ccc',
            fontFamily: BODY, fontSize: 14, fontWeight: 700,
            cursor: current === 0 ? 'default' : 'pointer',
          }}
        >← Anterior</button>
        <div style={{ fontFamily: BODY, fontSize: 13, color: '#666' }}>
          {current + 1} de {cards.length}
        </div>
        <button
          onClick={() => setCurrent(c => Math.min(cards.length - 1, c + 1))}
          disabled={current === cards.length - 1}
          style={{
            padding: '10px 20px', borderRadius: 10,
            border: '1.5px dashed rgba(255,255,255,0.2)',
            background: 'transparent',
            color: current === cards.length - 1 ? '#444' : '#ccc',
            fontFamily: BODY, fontSize: 14, fontWeight: 700,
            cursor: current === cards.length - 1 ? 'default' : 'pointer',
          }}
        >Siguiente →</button>
      </div>
      <div style={{
        marginTop: 20, paddingTop: 22,
        borderTop: '1px dashed rgba(255,255,255,0.08)',
        display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center',
        maxWidth: 800, margin: '0 auto', width: '100%',
      }}>
        <DashedButton onClick={onCreateManual} color={color}>
          ➕ Crear manualmente
        </DashedButton>
        <DashedButton onClick={onRegenerate} color={color} disabled={generating}>
          ✨ {generating ? 'Generando...' : 'Regenerar todas'}
        </DashedButton>
      </div>
    </div>
  );
}

function ScrollList({
  cards, color, onEdit, onDelete, onShowSource, onStudySingle,
  onStudyAll, onRegenerate, generating, onCreateManual,
}: {
  cards: Flashcard[];
  color: string;
  onEdit: (card: Flashcard) => void;
  onDelete: (id: string) => void;
  onShowSource: (card: Flashcard) => void;
  onStudyAll: () => void;
  onStudySingle: (card: Flashcard) => void;
  onRegenerate: () => void;
  generating: boolean;
  onCreateManual: () => void;
}) {
  const [flippedSet, setFlippedSet] = useState<Set<string>>(new Set());
  const toggleFlip = (id: string) => {
    setFlippedSet(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const controls = useFlashcardControls(cards);
  const { favorites, toggleFav, visibleCards } = controls;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        background: '#0a0a0c',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{
          padding: '10px 14px', borderRadius: 10,
          background: 'rgba(74, 222, 128, 0.06)',
          border: '1.5px dashed rgba(74, 222, 128, 0.5)',
          color: '#86efac',
          fontSize: 13, fontFamily: BODY, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 0,
        }}>
          <span style={{ fontSize: 16 }}>🤖</span>
          <span>AI generó <strong style={{ color: '#4ade80' }}>{cards.length}</strong> flashcards al <strong style={{ color: '#4ade80' }}>100%</strong></span>
        </div>
        <DashedButton onClick={onStudyAll} color={color} active fontSize={13}>
          🎯 Estudiar todas
        </DashedButton>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 18px 28px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {visibleCards.map((card, i) => (
            <div key={card.id} style={{ position: 'relative' }}>
              <div style={{
                position: 'absolute', top: -8, left: 18, zIndex: 5,
                width: 28, height: 28, borderRadius: '50%',
                background: color, color: '#000',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 900, fontFamily: BODY,
                boxShadow: `0 4px 12px ${color}66`,
                border: '2px solid #0a0a0c',
              }}>{i + 1}</div>
              <button
                onClick={(e) => { e.stopPropagation(); toggleFav(card.id); }}
                title={favorites.has(card.id) ? 'Quitar de favoritos' : 'Marcar como favorito'}
                style={{
                  position: 'absolute', top: -8, left: 54, zIndex: 5,
                  width: 28, height: 28, borderRadius: '50%',
                  background: favorites.has(card.id) ? '#fbbf24' : 'rgba(255,255,255,0.06)',
                  border: favorites.has(card.id) ? '2px solid #f59e0b' : '2px solid rgba(255,255,255,0.12)',
                  color: favorites.has(card.id) ? '#000' : 'rgba(255,255,255,0.45)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: favorites.has(card.id) ? '0 4px 12px rgba(251,191,36,0.4)' : 'none',
                }}
              >
                {favorites.has(card.id) ? '★' : '☆'}
              </button>
              <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 5 }}>
                <CardMenu
                  color={color}
                  onStudySingle={() => onStudySingle(card)}
                  onEdit={() => onEdit(card)}
                  onShowSource={() => onShowSource(card)}
                  onDelete={() => onDelete(card.id)}
                />
              </div>
              <NotebookCard
                card={card} color={color}
                flipped={flippedSet.has(card.id)}
                onFlip={() => toggleFlip(card.id)}
              />
            </div>
          ))}
        </div>
      </div>
      <div style={{
        marginTop: 16, paddingTop: 22,
        borderTop: '1px dashed rgba(255,255,255,0.08)',
        display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center',
      }}>
        <DashedButton onClick={onCreateManual} color={color}>
          ➕ Crear manualmente
        </DashedButton>
        <DashedButton onClick={onRegenerate} color={color} disabled={generating}>
          ✨ {generating ? 'Generando...' : 'Regenerar todas'}
        </DashedButton>
      </div>
    </div>
  );
}

function EditModal({ card, color, onSave, onClose }: {
  card: Flashcard; color: string;
  onSave: (q: string, a: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(card.question);
  const [a, setA] = useState(card.answer);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, padding: 24,
    }}>
      <div style={{
        background: '#13131a', border: `1px solid ${color}33`, borderRadius: 20,
        padding: 28, width: '100%', maxWidth: 520, boxShadow: `0 0 80px ${color}22`,
      }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', fontFamily: HAND, marginBottom: 20 }}>
          ✏️ Editar flashcard
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: color, fontFamily: BODY, marginBottom: 6, fontWeight: 700 }}>
            Pregunta
          </label>
          <textarea
            value={q} onChange={e => setQ(e.target.value)} rows={3}
            style={{
              width: '100%', background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${color}33`, borderRadius: 10,
              padding: '10px 12px', color: '#fff', fontSize: 14,
              fontFamily: BODY, resize: 'vertical', outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 12, color: color, fontFamily: BODY, marginBottom: 6, fontWeight: 700 }}>
            Respuesta
          </label>
          <textarea
            value={a} onChange={e => setA(e.target.value)} rows={4}
            style={{
              width: '100%', background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${color}33`, borderRadius: 10,
              padding: '10px 12px', color: '#fff', fontSize: 14,
              fontFamily: BODY, resize: 'vertical', outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <DashedButton onClick={onClose} color="#888" fontSize={13}>
            Cancelar
          </DashedButton>
          <DashedButton
            onClick={() => { onSave(q.trim(), a.trim()); onClose(); }}
            color={color} active fontSize={13}
            disabled={!q.trim() || !a.trim()}
          >
            💾 Guardar
          </DashedButton>
        </div>
      </div>
    </div>
  );
}

interface CardProgress {
  card: Flashcard;
  correctStreak: number;
  wrongCount: number;
  mediumCount: number;
  correctCount: number;
  mastered: boolean;
  nextReviewIndex: number;
}

function StudyRepite({ cards, color, onClose, readOnly = false, contexto = '', order = 'bucle' }: {
  cards: Flashcard[];
  color: string;
  onClose: () => void;
  readOnly?: boolean;
  contexto?: string;
  order?: StudyOrder;
}) {
  const [shuffledCards] = useState<Flashcard[]>(() => {
    if (order === 'bucle') {
      const arr = [...cards];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    return [...cards];
  });

  const [progress, setProgress] = useState<Map<string, CardProgress>>(() => {
    const m = new Map<string, CardProgress>();
    shuffledCards.forEach((card, i) => {
      m.set(card.id, {
        card, correctStreak: 0, wrongCount: 0,
        mediumCount: 0, correctCount: 0,
        mastered: false, nextReviewIndex: i,
      });
    });
    return m;
  });
  const [currentId, setCurrentId] = useState<string>(shuffledCards[0]?.id);
  const [userAnswer, setUserAnswer] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<any>(null);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [position, setPosition] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const current = progress.get(currentId);

  useEffect(() => {
    if (!readOnly) textareaRef.current?.focus();
  }, [currentId, readOnly]);

  const getNextCard = useCallback((currentProgress: Map<string, CardProgress>) => {
    const pending = Array.from(currentProgress.values())
      .filter(p => !p.mastered)
      .sort((a, b) => a.nextReviewIndex - b.nextReviewIndex);
    if (pending.length === 0) return null;
    return pending[0];
  }, []);

  const evaluate = async () => {
    if (!current || !userAnswer.trim()) return;
    setEvaluating(true);
    try {
      const res = await fetch('/api/evaluar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pregunta: current.card.question,
          respuestaCorrecta: current.card.answer,
          respuestaUsuario: userAnswer,
          idioma: 'es',
          contexto,
        }),
      });
      const data = await res.json();
      setEvaluation(data.resultado);
      setRevealed(true);
    } catch (e) {
      console.error("Error al evaluar con IA:", e);
      setEvaluation({
        nivel: 'medio_correcta', porcentaje: 50,
        explicacion: 'No se pudo evaluar. Compara tu respuesta con la correcta.',
        consejo: '',
      });
    } finally {
      setEvaluating(false);
    }
  };

  const continueNext = (resultLevel?: string) => {
    if (!current) return;
    const nivel = resultLevel || evaluation?.nivel || 'medio_correcta';
    const isCorrect = nivel === 'correcta' || nivel === 'INSANE';
    const isMedium = nivel === 'medio_correcta';
    const dontKnow = nivel === 'dont_know';

    const newProgress = new Map(progress);
    const p = { ...current };

    if (order === 'lineal') {
      p.mastered = true;
      if (isCorrect) { p.correctCount++; p.correctStreak++; }
      else if (isMedium) { p.mediumCount++; }
      else if (dontKnow) { p.wrongCount++; }
      else { p.wrongCount++; }
    } else {
      if (isCorrect) {
        p.correctCount++;
        p.correctStreak++;
        if (p.correctStreak >= 2) {
          p.mastered = true;
        } else {
          p.nextReviewIndex = position + 6 + Math.floor(Math.random() * 3);
        }
      } else if (isMedium) {
        p.mediumCount++;
        p.correctStreak = 0;
        p.nextReviewIndex = position + 4 + Math.floor(Math.random() * 2);
      } else if (dontKnow) {
        p.wrongCount++;
        p.correctStreak = 0;
        p.nextReviewIndex = position + 1 + Math.floor(Math.random() * 2);
      } else {
        p.wrongCount++;
        p.correctStreak = 0;
        p.nextReviewIndex = position + 2 + Math.floor(Math.random() * 2);
      }
    }
    newProgress.set(currentId, p);
    setProgress(newProgress);

    const next = getNextCard(newProgress);
    if (!next) {
      setDone(true);
      return;
    }

    setPosition(position + 1);
    setCurrentId(next.card.id);
    setUserAnswer('');
    setEvaluation(null);
    setRevealed(false);
  };

  const handleDontKnow = async () => {
    if (!current) return;
    setEvaluation({
      nivel: 'dont_know', porcentaje: 0,
      analisis: 'No te preocupes, vamos a aprenderlo.',
      respuestaCorrecta: current.card.answer,
      explicacion: current.card.answer,
    });
    setRevealed(true);
  };

  if (done) {
    const stats = Array.from(progress.values()).reduce(
      (acc, p) => ({
        correct: acc.correct + p.correctCount,
        medium: acc.medium + p.mediumCount,
        wrong: acc.wrong + p.wrongCount,
      }),
      { correct: 0, medium: 0, wrong: 0 }
    );
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#0a0a0c',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 28, zIndex: 3000, padding: 24,
      }}>
        <div style={{ fontSize: 64 }}>🎉</div>
        <div style={{ fontSize: 36, fontWeight: 800, color: '#fff', fontFamily: HAND }}>
          ¡Dominaste el mazo!
        </div>
        <div style={{ fontSize: 15, color: '#888', fontFamily: BODY }}>
          Aprendiste {cards.length} {cards.length === 1 ? 'flashcard' : 'flashcards'}
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            { val: stats.correct, label: 'correctas', col: '#4ade80', icon: '✓' },
            { val: stats.medium, label: 'medias', col: '#fbbf24', icon: '〜' },
            { val: stats.wrong, label: 'incorrectas', col: '#f87171', icon: '✗' },
          ].map(s => (
            <div key={s.label} style={{
              textAlign: 'center', padding: '20px 28px',
              background: `${s.col}11`,
              border: `1.5px dashed ${s.col}66`,
              borderRadius: 14, minWidth: 120,
            }}>
              <div style={{ fontSize: 20, color: s.col }}>{s.icon}</div>
              <div style={{ fontSize: 36, fontWeight: 900, color: s.col, fontFamily: BODY, lineHeight: 1 }}>
                {s.val}
              </div>
              <div style={{ fontSize: 13, color: '#aaa', fontFamily: BODY, marginTop: 4 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          style={{
            marginTop: 16, padding: '14px 32px', borderRadius: 14,
            border: `2px dashed ${color}`,
            background: `${color}22`, color: color,
            fontFamily: BODY, fontSize: 18, fontWeight: 700,
            cursor: 'pointer',
          }}
        >Terminar</button>
      </div>
    );
  }

  if (!current) return null;

  const totalMastered = Array.from(progress.values()).filter(p => p.mastered).length;
  const totalCards = cards.length;
  const progressPct = totalMastered / totalCards;

  if (readOnly) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0a0a0c', display: 'flex', flexDirection: 'column', zIndex: 3000 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#888',
            fontSize: 15, cursor: 'pointer', fontFamily: BODY, fontWeight: 700,
          }}>← Salir</button>
          <div style={{ fontSize: 18, color: '#aaa', fontFamily: HAND }}>📖 Leer</div>
          <div style={{ width: 60 }} />
        </div>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: 24, gap: 22,
        }}>
          <NotebookCard
            card={current.card} color={color}
            flipped={revealed} onFlip={() => setRevealed(r => !r)} large
          />
          <div style={{ fontSize: 14, color: '#666', fontFamily: BODY, fontStyle: 'italic' }}>
            Toca la tarjeta para voltear
          </div>
        </div>
      </div>
    );
  }

  const nivelColors: any = {
    INSANE: '#10b981',
    correcta: '#4ade80',
    medio_correcta: '#fbbf24',
    incorrecta: '#fb923c',
    muy_incorrecta: '#f87171',
    dont_know: '#f87171',
  };
  const nivelLabels: any = {
    INSANE: '🏆 ¡PERFECTO!',
    correcta: '✓ Correcta',
    medio_correcta: '〜 Casi',
    incorrecta: '✗ Incorrecta',
    muy_incorrecta: '✗ Muy incorrecta',
    dont_know: '🤷 No sé',
  };

  const liveStats = Array.from(progress.values()).reduce(
    (acc, p) => ({
      correct: acc.correct + p.correctCount,
      medium: acc.medium + p.mediumCount,
      wrong: acc.wrong + p.wrongCount,
    }),
    { correct: 0, medium: 0, wrong: 0 }
  );

  const [history, setHistory] = useState<string[]>([]);
  const canGoBack = history.length > 0;
  const goBack = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setCurrentId(prev);
    setPosition(p => Math.max(0, p - 1));
    setRevealed(false);
    setEvaluation(null);
    setUserAnswer('');
  };

  const continueNextWithHistory = (resultLevel?: string) => {
    if (currentId) setHistory(h => [...h, currentId]);
    continueNext(resultLevel);
  };

  const handleDontKnowWithHistory = () => {
    if (currentId) setHistory(h => [...h, currentId]);
    handleDontKnow();
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!revealed) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        continueNextWithHistory();
      } else if (e.key === 'ArrowLeft') {
        if (canGoBack) goBack();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [revealed, currentId, canGoBack]);

  const showAnswerOnly = () => {
    setEvaluation({
      nivel: 'shown', porcentaje: 0,
      explicacion: 'Respuesta revelada manualmente. Lee la respuesta correcta abajo en la tarjeta.',
      consejo: '', _showOnly: true,
    });
    setRevealed(true);
  };

  const submitAnswer = () => {
    if (!userAnswer.trim() || evaluating) return;
    evaluate();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a0c', display: 'flex', flexDirection: 'column', zIndex: 3000 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: '#888',
          fontSize: 15, cursor: 'pointer', fontFamily: BODY, fontWeight: 700,
        }}>← Salir</button>
        <div style={{ fontSize: 18, color: '#aaa', fontFamily: HAND }}>🧠 Repite y Aprende</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: color, fontFamily: BODY }}>
          {totalMastered}/{totalCards}
        </div>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.05)' }}>
        <div style={{
          height: '100%', width: `${progressPct * 100}%`,
          background: color, transition: 'width 0.4s ease',
          boxShadow: `0 0 8px ${color}`,
        }} />
      </div>
      <div style={{
        display: 'flex', justifyContent: 'center', gap: 12,
        padding: '14px 20px 8px', flexWrap: 'wrap',
      }}>
        {[
          { val: liveStats.correct, label: 'Correctas', col: '#4ade80', icon: '✓' },
          { val: liveStats.medium, label: 'Medias', col: '#fbbf24', icon: '〜' },
          { val: liveStats.wrong, label: 'Incorrectas', col: '#f87171', icon: '✗' },
        ].map(s => (
          <div key={s.label} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', borderRadius: 10,
            background: `${s.col}11`,
            border: `1.5px dashed ${s.col}55`,
          }}>
            <span style={{ fontSize: 16, color: s.col }}>{s.icon}</span>
            <span style={{
              fontFamily: BODY, fontSize: 16, fontWeight: 800,
              color: s.col, lineHeight: 1,
            }}>{s.val}</span>
            <span style={{ fontSize: 12, color: '#aaa', fontFamily: BODY }}>{s.label}</span>
          </div>
        ))}
        {current.correctStreak > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 14px', borderRadius: 10,
            background: `${color}22`,
            border: `1.5px dashed ${color}`,
          }}>
            <span style={{ fontSize: 16 }}>🔥</span>
            <span style={{ fontFamily: BODY, fontSize: 13, color: color, fontWeight: 700 }}>
              racha {current.correctStreak}/2
            </span>
          </div>
        )}
      </div>
      <div style={{
        flex: 1, overflow: 'auto', display: 'flex',
        flexDirection: 'column', alignItems: 'center',
        padding: '14px 20px 20px', gap: 16,
      }}>
        <div style={{ width: '100%', maxWidth: 680 }}>
          <NotebookCard
            card={current.card} color={color}
            flipped={revealed} onFlip={() => {}} large
          />
        </div>
        {!revealed ? (
          <div style={{ width: '100%', maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <textarea
              ref={textareaRef}
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !evaluating && userAnswer.trim()) {
                  e.preventDefault();
                  submitAnswer();
                }
              }}
              placeholder="Escribe tu respuesta aquí... (Enter para enviar · Shift+Enter para nueva línea)"
              rows={4}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 12,
                border: `1.5px solid ${color}44`,
                background: 'rgba(255,255,255,0.04)',
                color: '#fff', fontFamily: BODY, fontSize: 15,
                outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                lineHeight: 1.5,
              }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <DashedButton onClick={handleDontKnowWithHistory} color="#a78bfa" fontSize={14}>
                🤷 No sé
              </DashedButton>
              <DashedButton onClick={showAnswerOnly} color="#fbbf24" fontSize={14}>
                👁 Mostrar respuesta
              </DashedButton>
              <DashedButton
                onClick={submitAnswer}
                color={color} active fontSize={14}
                disabled={evaluating || !userAnswer.trim()}
              >
                {evaluating ? '🤖 Evaluando...' : '✓ Enviar (Enter)'}
              </DashedButton>
            </div>
            {canGoBack && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
                <DashedButton onClick={goBack} color="#a78bfa" fontSize={13}>
                  ← Anterior
                </DashedButton>
              </div>
            )}
          </div>
        ) : (
          <div style={{ width: '100%', maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {evaluation && !evaluation._showOnly && (
              <div style={{
                padding: 22, borderRadius: 14,
                background: `${nivelColors[evaluation.nivel] || color}0a`,
                border: `1.5px dashed ${nivelColors[evaluation.nivel] || color}66`,
                display: 'flex', flexDirection: 'column', gap: 16,
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  paddingBottom: 12,
                  borderBottom: `1px dashed ${nivelColors[evaluation.nivel] || color}33`,
                }}>
                  <div style={{
                    fontFamily: HAND, fontSize: 24, fontWeight: 700,
                    color: nivelColors[evaluation.nivel] || color,
                  }}>
                    {nivelLabels[evaluation.nivel] || '✓ Evaluada'}
                  </div>
                  {evaluation.nivel !== 'dont_know' && (
                    <div style={{
                      fontFamily: BODY, fontSize: 26, fontWeight: 900,
                      color: nivelColors[evaluation.nivel] || color,
                      lineHeight: 1,
                    }}>
                      {evaluation.porcentaje}%
                    </div>
                  )}
                </div>
                {userAnswer.trim() && (
                  <div>
                    <div style={{
                      fontSize: 11, color: '#888', fontFamily: BODY,
                      marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1.5,
                      fontWeight: 700,
                    }}>
                      ✍️ Tu respuesta
                    </div>
                    <div style={{
                      fontSize: 14, color: '#ddd', fontFamily: BODY,
                      padding: '10px 14px', background: 'rgba(0,0,0,0.3)',
                      borderRadius: 8, fontStyle: 'italic',
                      border: '1px solid rgba(255,255,255,0.05)',
                    }}>"{userAnswer}"</div>
                  </div>
                )}
                {evaluation.analisis && (
                  <div>
                    <div style={{
                      fontSize: 11, color: '#888', fontFamily: BODY,
                      marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1.5,
                      fontWeight: 700,
                    }}>
                      🔍 Análisis
                    </div>
                    <div style={{
                      fontSize: 14, color: '#e8e8ed', fontFamily: BODY,
                      lineHeight: 1.6,
                    }}>
                      {evaluation.analisis}
                    </div>
                  </div>
                )}
                {evaluation.respuestaCorrecta && (
                  <div style={{
                    padding: '12px 14px',
                    background: `${nivelColors[evaluation.nivel] || color}15`,
                    border: `1.5px solid ${nivelColors[evaluation.nivel] || color}55`,
                    borderRadius: 10,
                  }}>
                    <div style={{
                      fontSize: 11, color: nivelColors[evaluation.nivel] || color,
                      fontFamily: BODY, marginBottom: 6,
                      textTransform: 'uppercase', letterSpacing: 1.5,
                      fontWeight: 700,
                    }}>
                      ✅ Respuesta correcta
                    </div>
                    <div style={{
                      fontSize: 15, color: '#fff', fontFamily: BODY,
                      lineHeight: 1.6, fontWeight: 500,
                    }}>
                      <MathText text={cleanFlashcardText(evaluation.respuestaCorrecta)} />
                    </div>
                  </div>
                )}
                {evaluation.explicacion && (
                  <div>
                    <div style={{
                      fontSize: 11, color: '#888', fontFamily: BODY,
                      marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1.5,
                      fontWeight: 700,
                    }}>
                      💡 ¿Por qué?
                    </div>
                    <div style={{
                      fontSize: 14, color: '#e8e8ed', fontFamily: BODY,
                      lineHeight: 1.6,
                    }}>
                      {evaluation.explicacion}
                    </div>
                  </div>
                )}
                {evaluation.consejo && (
                  <div style={{
                    padding: '10px 14px',
                    background: 'rgba(251,191,36,0.08)',
                    border: '1px dashed rgba(251,191,36,0.3)',
                    borderRadius: 8,
                    fontSize: 13, color: '#fbbf24', fontFamily: BODY,
                    lineHeight: 1.5,
                  }}>
                    <strong style={{ fontFamily: BODY, fontSize: 14 }}>📌 Tip:</strong> {evaluation.consejo}
                  </div>
                )}
              </div>
            )}
            {evaluation?._showOnly && (
              <div style={{
                padding: 14, borderRadius: 12,
                background: 'rgba(251,191,36,0.08)',
                border: '1.5px dashed rgba(251,191,36,0.4)',
                color: '#fbbf24', fontSize: 13, fontFamily: BODY,
                textAlign: 'center',
              }}>
                👁 Respuesta revelada · Continúa cuando estés listo
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
              {canGoBack && (
                <DashedButton onClick={goBack} color="#a78bfa" fontSize={14}>
                  ← Anterior
                </DashedButton>
              )}
              <button
                onClick={() => continueNextWithHistory(evaluation?._showOnly ? 'incorrecta' : undefined)}
                style={{
                  padding: '12px 28px', borderRadius: 12,
                  border: `2px dashed ${color}`,
                  background: `${color}22`, color: color,
                  fontFamily: BODY, fontSize: 15, fontWeight: 700,
                  cursor: 'pointer',
                }}
              >Siguiente →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StudyRapido({ cards, color, onClose, contexto = '', order = 'bucle' }: {
  cards: Flashcard[]; color: string; onClose: () => void; contexto?: string; order?: StudyOrder;
}) {
  const [shuffledCards] = useState<Flashcard[]>(() => {
    if (order === 'bucle') {
      const arr = [...cards];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    return [...cards];
  });
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<{ card: Flashcard; nivel: string }[]>([]);
  const [userAnswer, setUserAnswer] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<any>(null);
  const [revealed, setRevealed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const card = shuffledCards[index];

  useEffect(() => { textareaRef.current?.focus(); }, [index]);

  const nivelColors: any = {
    INSANE: '#10b981', correcta: '#4ade80',
    medio_correcta: '#fbbf24', incorrecta: '#fb923c',
    muy_incorrecta: '#f87171', dont_know: '#f87171',
  };
  const nivelLabels: any = {
    INSANE: '🏆 ¡PERFECTO!', correcta: '✓ Correcta',
    medio_correcta: '〜 Casi', correcta_parcial: '〜 Casi',
    incorrecta: '✗ Incorrecta', muy_incorrecta: '✗ Muy incorrecta',
    dont_know: '✗ No sabías',
  };

  const evaluate = async () => {
    if (!card || !userAnswer.trim() || evaluating) return;
    setEvaluating(true);
    try {
      const res = await fetch('/api/evaluar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pregunta: card.question,
          respuestaCorrecta: card.answer,
          respuestaUsuario: userAnswer,
          idioma: 'es',
          contexto,
        }),
      });
      const data = await res.json();
      setEvaluation(data.resultado);
      setRevealed(true);
    } catch (e) {
      console.error("Error al evaluar con IA:", e);
      setEvaluation({
        nivel: 'medio_correcta', porcentaje: 50,
        explicacion: 'No se pudo evaluar. Compara tu respuesta.',
        consejo: '',
      });
    } finally {
      setEvaluating(false);
    }
  };

  const showAnswer = async () => {
    if (!card) return;
    setEvaluation({
      nivel: 'dont_know', porcentaje: 0,
      analisis: 'Respuesta revelada manualmente.',
      respuestaCorrecta: card.answer,
      explicacion: '',
      consejo: '',
      _showOnly: true,
    });
    setRevealed(true);
  };

  const next = () => {
    const nivel = evaluation?.nivel || 'dont_know';
    setResults(r => [...r, { card, nivel }]);
    if (index + 1 >= shuffledCards.length) {
      setIndex(i => i + 1);
    } else {
      setIndex(i => i + 1);
      setUserAnswer('');
      setEvaluation(null);
      setRevealed(false);
    }
  };

  if (index >= shuffledCards.length) {
    const counts = results.reduce(
      (acc, r) => {
        if (r.nivel === 'correcta' || r.nivel === 'INSANE') acc.correct++;
        else if (r.nivel === 'medio_correcta') acc.medium++;
        else acc.wrong++;
        return acc;
      },
      { correct: 0, medium: 0, wrong: 0 }
    );

    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#0a0a0c',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 28, zIndex: 3000, padding: 24,
      }}>
        <div style={{ fontSize: 64 }}>⚡</div>
        <div style={{ fontSize: 36, fontWeight: 800, color: '#fff', fontFamily: HAND }}>¡Repaso completado!</div>
        <div style={{ fontSize: 15, color: '#888', fontFamily: BODY }}>Repasaste {shuffledCards.length} flashcards una vez</div>
        <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            { val: counts.correct, label: 'correctas', col: '#4ade80', icon: '✓' },
            { val: counts.medium, label: 'medias', col: '#fbbf24', icon: '〜' },
            { val: counts.wrong, label: 'incorrectas', col: '#f87171', icon: '✗' },
          ].map(s => (
            <div key={s.label} style={{
              textAlign: 'center', padding: '20px 28px',
              background: s.col + '11', border: '1.5px dashed ' + s.col + '66',
              borderRadius: 14, minWidth: 120,
            }}>
              <div style={{ fontSize: 20, color: s.col }}>{s.icon}</div>
              <div style={{ fontSize: 36, fontWeight: 900, color: s.col, fontFamily: BODY, lineHeight: 1 }}>{s.val}</div>
              <div style={{ fontSize: 13, color: '#aaa', fontFamily: BODY, marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          style={{
            marginTop: 16, padding: '14px 32px', borderRadius: 14,
            border: '2px dashed ' + color, background: color + '22', color,
            fontFamily: BODY, fontSize: 18, fontWeight: 700, cursor: 'pointer',
          }}
        >Terminar</button>
      </div>
    );
  }

  if (!card) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a0c', display: 'flex', flexDirection: 'column', zIndex: 3000 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: 15, cursor: 'pointer', fontFamily: BODY, fontWeight: 700 }}>← Salir</button>
        <div style={{ fontSize: 18, color: '#aaa', fontFamily: HAND }}>⚡ Repaso Rápido</div>
        <div style={{ fontSize: 15, fontWeight: 700, color, fontFamily: BODY }}>{index + 1}/{shuffledCards.length}</div>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.05)' }}>
        <div style={{ height: '100%', width: ((index + 1) / shuffledCards.length * 100) + '%', background: color, transition: 'width 0.4s ease', boxShadow: '0 0 8px ' + color }} />
      </div>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 20px 20px', gap: 16 }}>
        <NotebookCard card={card} color={color} flipped={revealed} onFlip={() => {}} large />
        {!revealed ? (
          <div style={{ width: '100%', maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <textarea
              ref={textareaRef}
              value={userAnswer}
              onChange={e => setUserAnswer(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !evaluating && userAnswer.trim()) { e.preventDefault(); evaluate(); } }}
              placeholder="Escribe tu respuesta... (Enter para enviar)"
              rows={4}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 12,
                border: '1.5px solid ' + color + '44', background: 'rgba(255,255,255,0.04)',
                color: '#fff', fontFamily: BODY, fontSize: 15,
                outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5,
              }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <DashedButton onClick={showAnswer} color="#fbbf24" fontSize={14}>👁 Mostrar respuesta</DashedButton>
              <DashedButton onClick={evaluate} color={color} active fontSize={14} disabled={evaluating || !userAnswer.trim()}>
                {evaluating ? '🤖 Evaluando...' : '✓ Enviar (Enter)'}
              </DashedButton>
            </div>
          </div>
        ) : (
          <div style={{ width: '100%', maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {evaluation && !evaluation._showOnly && (
              <div style={{
                padding: 22, borderRadius: 14,
                background: (nivelColors[evaluation.nivel] || color) + '0a',
                border: '1.5px dashed ' + (nivelColors[evaluation.nivel] || color) + '66',
                display: 'flex', flexDirection: 'column', gap: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px dashed ' + (nivelColors[evaluation.nivel] || color) + '33' }}>
                  <div style={{ fontFamily: HAND, fontSize: 24, fontWeight: 700, color: nivelColors[evaluation.nivel] || color }}>
                    {nivelLabels[evaluation.nivel] || '✓ Evaluada'}
                  </div>
                  {evaluation.nivel !== 'dont_know' && (
                    <div style={{ fontFamily: BODY, fontSize: 26, fontWeight: 900, color: nivelColors[evaluation.nivel] || color, lineHeight: 1 }}>
                      {evaluation.porcentaje}%
                    </div>
                  )}
                </div>
                {userAnswer.trim() && (
                  <div>
                    <div style={{ fontSize: 11, color: '#888', fontFamily: BODY, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700 }}>✍️ Tu respuesta</div>
                    <div style={{ fontSize: 14, color: '#ddd', fontFamily: BODY, padding: '10px 14px', background: 'rgba(0,0,0,0.3)', borderRadius: 8, fontStyle: 'italic', border: '1px solid rgba(255,255,255,0.05)' }}>"{userAnswer}"</div>
                  </div>
                )}
                {evaluation.analisis && (
                  <div>
                    <div style={{ fontSize: 11, color: '#888', fontFamily: BODY, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700 }}>🔍 Análisis</div>
                    <div style={{ fontSize: 14, color: '#e8e8ed', fontFamily: BODY, lineHeight: 1.6 }}>{evaluation.analisis}</div>
                  </div>
                )}
                {evaluation.respuestaCorrecta && (
                  <div style={{ padding: '12px 14px', background: (nivelColors[evaluation.nivel] || color) + '15', border: '1.5px solid ' + (nivelColors[evaluation.nivel] || color) + '55', borderRadius: 10 }}>
                    <div style={{ fontSize: 11, color: nivelColors[evaluation.nivel] || color, fontFamily: BODY, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700 }}>✅ Respuesta correcta</div>
                    <div style={{ fontSize: 15, color: '#fff', fontFamily: BODY, lineHeight: 1.6, fontWeight: 500 }}>
                      <MathText text={cleanFlashcardText(evaluation.respuestaCorrecta)} />
                    </div>
                  </div>
                )}
                {evaluation.explicacion && (
                  <div>
                    <div style={{ fontSize: 11, color: '#888', fontFamily: BODY, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700 }}>💡 ¿Por qué?</div>
                    <div style={{ fontSize: 14, color: '#e8e8ed', fontFamily: BODY, lineHeight: 1.65 }}>{evaluation.explicacion}</div>
                  </div>
                )}
                {evaluation.consejo && (
                  <div style={{ padding: '10px 14px', background: 'rgba(251,191,36,0.08)', border: '1px dashed rgba(251,191,36,0.3)', borderRadius: 8, fontSize: 13, color: '#fbbf24', fontFamily: BODY, lineHeight: 1.5 }}>
                    <strong style={{ fontFamily: BODY, fontSize: 14 }}>📌 Tip:</strong> {evaluation.consejo}
                  </div>
                )}
              </div>
            )}
            {evaluation?._showOnly && (
              <div style={{ padding: 14, borderRadius: 12, background: 'rgba(251,191,36,0.08)', border: '1.5px dashed rgba(251,191,36,0.4)', color: '#fbbf24', fontSize: 13, fontFamily: BODY, textAlign: 'center' }}>
                👁 Respuesta revelada · Continúa cuando estés listo
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button onClick={next} style={{
                padding: '12px 28px', borderRadius: 12, border: '2px dashed ' + color,
                background: color + '22', color, fontFamily: BODY, fontSize: 16, fontWeight: 700, cursor: 'pointer',
              }}>
                {index + 1 >= shuffledCards.length ? '✓ Terminar' : 'Siguiente →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StudySelector({ color, onSelect, onClose }: {
  color: string; onSelect: (mode: StudyMode, order: StudyOrder) => void; onClose: () => void;
}) {
  const [order, setOrder] = useState<StudyOrder>('bucle');

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2500,
    }}>
      <div style={{
        background: '#13131a', border: `1px solid ${color}33`, borderRadius: 24,
        padding: 32, maxWidth: 420, width: '90%', boxShadow: `0 0 80px ${color}22`,
      }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', fontFamily: HAND, marginBottom: 8 }}>
          ¿Cómo quieres estudiar?
        </div>
        <div style={{ fontSize: 15, color: '#888', fontFamily: HAND, marginBottom: 22 }}>Elige tu modo</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, justifyContent: 'center' }}>
          {([
            { key: 'bucle', icon: '🔀', label: 'Aleatorio' },
            { key: 'lineal', icon: '📋', label: 'En orden' },
          ] as { key: StudyOrder; icon: string; label: string }[]).map(opt => (
            <button
              key={opt.key}
              onClick={() => setOrder(opt.key)}
              style={{
                padding: '8px 18px', borderRadius: 10, cursor: 'pointer',
                fontFamily: BODY, fontSize: 14, fontWeight: 700,
                border: order === opt.key ? '2px solid ' + color : '2px dashed rgba(255,255,255,0.15)',
                background: order === opt.key ? color + '22' : 'transparent',
                color: order === opt.key ? color : '#666',
                transition: 'all 0.18s',
              }}
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { mode: 'repite' as StudyMode, icon: '🧠', title: 'Repite y Aprende', desc: order === 'bucle' ? 'Orden aleatorio, las incorrectas vuelven' : 'En orden, las incorrectas vuelven', col: '#a78bfa' },
            { mode: 'rapido' as StudyMode, icon: '⚡', title: 'Repaso Rápido', desc: order === 'bucle' ? 'Aleatorio, cada card una sola vez' : 'En orden, cada card una sola vez', col: '#fbbf24' },
          ].map(opt => (
            <button
              key={opt.mode}
              onClick={() => onSelect(opt.mode, order)}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px',
                borderRadius: 14, border: `1.5px dashed ${opt.col}66`,
                background: `${opt.col}08`, cursor: 'pointer', textAlign: 'left', width: '100%',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = `${opt.col}22`;
                (e.currentTarget as HTMLElement).style.borderColor = opt.col;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = `${opt.col}08`;
                (e.currentTarget as HTMLElement).style.borderColor = `${opt.col}66`;
              }}
            >
              <div style={{ fontSize: 32 }}>{opt.icon}</div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: opt.col, fontFamily: BODY }}>{opt.title}</div>
                <div style={{ fontSize: 13, color: '#aaa', fontFamily: BODY, marginTop: 2 }}>{opt.desc}</div>
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          style={{
            marginTop: 16, width: '100%', padding: '10px', borderRadius: 10, border: 'none',
            background: 'transparent', color: '#666', cursor: 'pointer', fontFamily: BODY, fontSize: 14,
          }}
        >Cancelar</button>
      </div>
    </div>
  );
}

function EmptyGenerate({ color, onGenerate, generating, numPages, selectedPages, materialesCount, activeMaterialIndex, totalSelectedPages }: {
  color: string; onGenerate: () => void; generating: boolean;
  numPages: number; selectedPages: number[];
  materialesCount: number; activeMaterialIndex: number; totalSelectedPages: number;
}) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 22, padding: 40, textAlign: 'center',
    }}>
      <div style={{
        width: 100, height: 100, borderRadius: '50%',
        background: `${color}11`, border: `2px dashed ${color}66`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 48,
      }}>🎴</div>
      <div>
        <div style={{
          fontSize: 28, fontWeight: 800, color: '#fff',
          fontFamily: HAND, marginBottom: 6,
        }}>
          Todavía no hay flashcards
        </div>
        <div style={{
          fontSize: 15, color: '#888', fontFamily: BODY,
          maxWidth: 360, lineHeight: 1.4,
        }}>
          La IA va a analizar el <strong style={{ color: color }}>100%</strong> del material seleccionado y generar flashcards de toda esa selección
        </div>
      </div>
      <div style={{
        padding: '10px 16px', borderRadius: 10,
        background: 'rgba(255,255,255,0.03)',
        border: '1.5px dashed rgba(255,255,255,0.15)',
        fontSize: 14, color: '#aaa', fontFamily: BODY, fontStyle: 'italic',
      }}>
        {selectedPages.length > 0
          ? (materialesCount > 1
              ? `📑 Material ${activeMaterialIndex + 1}/${materialesCount}: ${selectedPages.length} pág. en este material · ${totalSelectedPages} total seleccionadas`
              : (numPages > 0
                  ? `📑 ${selectedPages.length} de ${numPages} páginas seleccionadas`
                  : `📑 ${selectedPages.length} páginas seleccionadas`))
          : numPages > 0 ? `📑 Todas las páginas (${numPages})` : '📑 Cargando material...'}
      </div>
      <button
        onClick={onGenerate}
        disabled={generating}
        style={{
          padding: '14px 32px', borderRadius: 14,
          border: `2px dashed ${color}`,
          background: generating ? 'rgba(255,255,255,0.05)' : `${color}22`,
          color: generating ? '#555' : color,
          fontFamily: BODY, fontSize: 18, fontWeight: 700,
          cursor: generating ? 'default' : 'pointer',
          boxShadow: generating ? 'none' : `0 12px 32px ${color}44`,
          display: 'flex', alignItems: 'center', gap: 10,
          transition: 'all 0.2s',
        }}
      >
        ✨ {generating ? 'Generando...' : 'Generar flashcards'}
      </button>
    </div>
  );
}

export default function FlashcardsPage({ materiales, seleccion, tema, materia, sessionId, onBack }: Props) {
  const color = tema?.color || '#22d3ee';
  const [activeMaterialIndex, setActiveMaterialIndex] = useState(0);
  const matActual = materiales[activeMaterialIndex];

  const getSelectionPages = useCallback((item: any): number[] => {
    if (!item) return [];
    const candidates = [
      item?.pages,
      item?.paginasSeleccionadas,
      item?.selectedPages,
      item?.paginas,
      item?.pageNumbers,
      item?.range,
      item?.selection,
    ];
    for (const value of candidates) {
      if (Array.isArray(value)) {
        const arr = Array.from(
          new Set(
            value
              .map((n: any) => Number(n))
              .filter((n: number) => Number.isFinite(n) && n > 0)
          )
        ).sort((a, b) => a - b);
        if (arr.length > 0) return arr;
      }
      if (value && typeof value === 'object') {
        const start = Number(value.start ?? value.from ?? value.startPage ?? value.paginaInicial);
        const end = Number(value.end ?? value.to ?? value.endPage ?? value.paginaFinal);
        if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
          return Array.from({ length: end - start + 1 }, (_, i) => start + i);
        }
      }
    }
    return [];
  }, []);

  const getSelectionIds = useCallback((item: any): string[] => {
    const nested =
      item?.material ||
      item?.documento ||
      item?.doc ||
      item?.source ||
      item?.file ||
      null;
    return [
      item?.materialId,
      item?.material_id,
      item?.documentId,
      item?.document_id,
      item?.docId,
      item?.doc_id,
      item?.id,
      nested?.materialId,
      nested?.material_id,
      nested?.id,
    ]
      .filter(Boolean)
      .map((v: any) => String(v));
  }, []);

  const findSelectionForMaterial = useCallback((mat: any, fallbackIndex?: number): SeleccionItem | null => {
    if (!seleccion?.length || !mat) return null;
    const matIds = getSelectionIds(mat);
    if (typeof fallbackIndex === 'number') {
      const byMaterialIndex =
        (seleccion.find((item: any) => Number((item as any)?.materialIndex) === fallbackIndex) as SeleccionItem | undefined) ??
        undefined;
      if (byMaterialIndex) return byMaterialIndex;
      const byIndex = (seleccion[fallbackIndex] as SeleccionItem | undefined) ?? undefined;
      if (byIndex) {
        const byIndexIds = getSelectionIds(byIndex);
        const byIndexPages = getSelectionPages(byIndex);
        if (byIndexIds.some((id: string) => matIds.includes(id)) || byIndexPages.length > 0 || !!(byIndex as any)?.text) {
          return byIndex;
        }
      }
    }
    const byId =
      (seleccion.find((item: any) => {
        const itemIds = getSelectionIds(item);
        return itemIds.some((id: string) => matIds.includes(id));
      }) as SeleccionItem | undefined) ?? undefined;
    if (byId) return byId;
    if (materiales.length === 1 && seleccion.length === 1) {
      return (seleccion[0] as SeleccionItem | undefined) ?? null;
    }
    return null;
  }, [seleccion, materiales, getSelectionIds, getSelectionPages]);

  const selectedSel = findSelectionForMaterial(matActual, activeMaterialIndex);
  const selectedPages = getSelectionPages(selectedSel);
  const totalSelectedPages = (seleccion || []).reduce((acc, s) => acc + getSelectionPages(s).length, 0);
  const hasAnySelection = totalSelectedPages > 0;

  const selectionSequence = useMemo(() => {
    const seq: { materialIndex: number; page: number }[] = [];
    for (let i = 0; i < materiales.length; i++) {
      const sel = findSelectionForMaterial(materiales[i], i);
      const pages = getSelectionPages(sel);
      for (const page of pages) {
        seq.push({ materialIndex: i, page });
      }
    }
    return seq;
  }, [materiales, findSelectionForMaterial, getSelectionPages]);

  const [globalSelectedCursor, setGlobalSelectedCursor] = useState(0);
  const globalSelectedCursorRef = useRef(0);

  useEffect(() => {
    globalSelectedCursorRef.current = globalSelectedCursor;
  }, [globalSelectedCursor]);

  useEffect(() => {
    if (!selectionSequence.length && globalSelectedCursor !== 0) {
      setGlobalSelectedCursor(0);
    } else if (selectionSequence.length > 0) {
      setGlobalSelectedCursor(prev => {
        if (prev < 0 || prev >= selectionSequence.length) return 0;
        return prev;
      });
    }
  }, [selectionSequence.length]);

  useEffect(() => {
    if (!selectionSequence.length) return;
    const entry = selectionSequence[globalSelectedCursor];
    if (entry && entry.materialIndex !== activeMaterialIndex) {
      setActiveMaterialIndex(entry.materialIndex);
    }
  }, [selectionSequence, globalSelectedCursor, activeMaterialIndex]);

  const currentGlobalEntry = selectionSequence[globalSelectedCursor] || null;

  const syncGlobalCursorFromPage = useCallback((page: number) => {
    const idx = selectionSequence.findIndex(
      item => item.materialIndex === activeMaterialIndex && item.page === page
    );
    if (idx < 0) return;
    globalSelectedCursorRef.current = idx;
    setGlobalSelectedCursor(prev => (prev === idx ? prev : idx));
  }, [selectionSequence, activeMaterialIndex]);

  const goToGlobalSelection = useCallback((nextIndex: number) => {
    const safeIndex = Math.max(0, Math.min(selectionSequence.length - 1, nextIndex));
    setGlobalSelectedCursor(safeIndex);
    globalSelectedCursorRef.current = safeIndex;
  }, [selectionSequence]);

  const goToNext = useCallback(() => {
    goToGlobalSelection(globalSelectedCursorRef.current + 1);
  }, [goToGlobalSelection]);

  const goToPrev = useCallback(() => {
    goToGlobalSelection(globalSelectedCursorRef.current - 1);
  }, [goToGlobalSelection]);

  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [generating, setGenerating] = useState(false);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [generatingStep, setGeneratingStep] = useState('');
  const [generatingProgress, setGeneratingProgress] = useState(0);
  const [error, setError] = useState('');
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [studyMode, setStudyMode] = useState<StudyMode | null>(null);
  const [showStudySelector, setShowStudySelector] = useState(false);
  const [studyOrder, setStudyOrder] = useState<StudyOrder>('bucle');
  const [studySingleCard, setStudySingleCard] = useState<Flashcard | null>(null);
  const [sourceCard, setSourceCard] = useState<Flashcard | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [rightTab, setRightTab] = useState<'material' | 'flashcards'>('material');

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setPdfLoading(true);
    setPdfUrl(null);

    const loadUrl = async () => {
      if (!matActual) { setPdfLoading(false); return; }
      if (matActual.url && typeof matActual.url === 'string' && matActual.url.startsWith('http')) {
        if (!cancelled) { setPdfUrl(matActual.url); setPdfLoading(false); }
        return;
      }
      if (matActual.archivo instanceof File) {
        objectUrl = URL.createObjectURL(matActual.archivo);
        if (!cancelled) { setPdfUrl(objectUrl); setPdfLoading(false); }
        return;
      }

      const matId = matActual.materialId || matActual.id;
      if (matId) {
        try {
          const session = (await supabase.auth.getSession()).data.session;
          const res = await fetch(`/api/materials/${matId}/download-url`, {
            headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
          });
          const data = await res.json();
          if (!cancelled && data?.url) setPdfUrl(data.url);
        } catch (e) {
          console.error('Error cargando PDF:', e);
        } finally {
          if (!cancelled) setPdfLoading(false);
        }
      } else if (!cancelled) setPdfLoading(false);
    };

    loadUrl();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [matActual]);

  const [materialText, setMaterialText] = useState<string>('');

  useEffect(() => {
    if (!sessionId || cacheLoaded) return;
    try {
      const sessions = getSessionsByTema(tema?.id || '');
      const sess = sessions.find(s => s.id === sessionId);
      if (sess) {
        if ((sess as any).materialText && typeof (sess as any).materialText === 'string') {
          console.log('📦 Cache hit: materialText (' + (sess as any).materialText.length + ' chars)');
          setMaterialText((sess as any).materialText);
        }
        if (sess.flashcards && sess.flashcards.length > 0) {
          console.log('📦 Cache hit:', sess.flashcards.length, 'flashcards desde sesión', sessionId);
          setFlashcards(sess.flashcards);
        }
      }
    } catch (e) {
      console.warn('Error cargando cache de sesión:', e);
    }
    setCacheLoaded(true);
  }, [sessionId, tema?.id, cacheLoaded]);

  useEffect(() => {
    if (!sessionId || !cacheLoaded) return;
    if (flashcards.length === 0) return;

    const t = setTimeout(() => {
      try {
        const sessions = getSessionsByTema(tema?.id || '');
        const sess = sessions.find(s => s.id === sessionId);
        if (sess) {
          upsertSession({
            temaId: sess.temaId,
            enfoque: sess.enfoque,
            materialIds: sess.materialIds,
            selectedPages: sess.selectedPages,
            flashcards: flashcards,          });
          console.log('💾 Cache guardado:', flashcards.length, 'flashcards en', sessionId);
        }
      } catch (e) {
        console.warn('Error guardando cache:', e);
      }
    }, 800);
    return () => clearTimeout(t);
  }, [flashcards, sessionId, tema?.id, cacheLoaded, materialText]);

  const filterTextByPages = (fullText: string, pages: number[]): string => {
    if (!pages || pages.length === 0) return fullText;
    let pageTexts: string[] = [];
    if ((fullText.includes('[Página ') || fullText.includes('[Pagina ')) && fullText.includes('\f')) {
      pageTexts = fullText
        .split('\f')
        .map(t => t.trim())
        .filter(t => t.length > 0);
      console.log(`📖 Split por \f: ${pageTexts.length} páginas detectadas`);
    }
    if (pageTexts.length <= 1 && (fullText.includes('[Página ') || fullText.includes('[Pagina '))) {
      const parts = fullText
        .split(/(?=\[P[áa]gina \d+\])/g);
      if (parts.length > 1) {
        pageTexts = parts;
        console.log(`📖 Split por [Página N]: ${pageTexts.length} páginas`);
      }
    }
    if (pageTexts.length <= 1 && fullText.includes('[Page ')) {
      const parts = fullText
        .split(/(?=\[Page \d+\])/gi);
      if (parts.length > 1) {
        pageTexts = parts;
        console.log(`📖 Split por [Page N]: ${pageTexts.length} páginas`);
      }
    }
    if (pageTexts.length <= 1) {
      const parts = fullText
        .split(/(?=---\s*(?:p[áa]gina|page)\s*\d+\s*---)/gi);
      if (parts.length > 1) {
        pageTexts = parts;
        console.log(`📖 Split por ---: ${pageTexts.length} páginas`);
      }
    }
    if (pageTexts.length <= 1) {
      console.error('❌ No se pudo aislar texto por páginas. El PDF necesita re-procesarse.');
      return '';
    }

    const selectedTexts = pages
      .map(p => pageTexts[p - 1])
      .filter(Boolean);

    if (selectedTexts.length === 0) {
      console.error('❌ Ninguna página encontrada', { pages, totalDetectadas: pageTexts.length });
    }
    console.log(`📑 Filtrando EXACTAMENTE páginas ${pages.join(', ')} de ${pageTexts.length} totales → ${selectedTexts.length} encontradas`);
    return selectedTexts.join('\n\n');
  };

  const extractText = useCallback(async (): Promise<string> => {
    const texts: string[] = [];
    for (let i = 0; i < materiales.length; i++) {
      const mat = materiales[i];
      const matId = mat?.materialId || mat?.id;
      const sel = findSelectionForMaterial(mat, i);
      const pages = getSelectionPages(sel);

      console.log('🧩 Flashcards material', {
        index: i,
        nombre: mat?.nombre,
        matId,
        pages,
        hasText: !!(sel as any)?.text,
        materialIndex: (sel as any)?.materialIndex,
      });

      if ((sel as any)?.text) {
        const txt = String((sel as any).text || '').trim();
        if (txt) {
          console.log(`✅ Material ${i + 1}: usando texto pre-extraído (${txt.length} chars)`);
          texts.push(`[Material ${i + 1}: ID=${matId} | ${mat?.nombre || matId}${pages.length ? ` | páginas ${pages.join(', ')}` : ''}]
${txt}`);
          continue;
        }
      }

      if (!matId) {
        console.warn(`⚠️ Material ${i + 1}: sin ID de material, saltando`);
        continue;
      }
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        console.warn(`⚠️ Material ${i + 1}: sin sesión de usuario, saltando`);
        continue;
      }

      const res = await fetch('/api/enfoques/teorico/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ materialIds: [matId] }),
      });
      const data = await res.json();
      const fullText: string = data.materials?.[matId]?.text || '';

      if (!fullText) {
        console.warn(`⚠️ Material ${i + 1}: sin texto extraído`);
        continue;
      }

      if (pages.length > 0) {
        console.log(`📑 Material ${i + 1}: páginas seleccionadas ${pages.join(', ')}`);
        const filtered = filterTextByPages(fullText, pages);
        if (!filtered.trim()) {
          throw new Error('No se pudo aislar exactamente el texto de las páginas seleccionadas. Vuelve a intentar para que el PDF se reprocese con separadores por página.');
        }
        texts.push(`[Material ${i + 1}: ID=${matId} | ${mat?.nombre || matId} | páginas ${pages.join(', ')}]
${filtered}`);
      } else {
        console.log(`📄 Material ${i + 1}: texto completo (${fullText.length} chars)`);
        texts.push(`[Material ${i + 1}: ID=${matId} | ${mat?.nombre || matId} | documento completo]
${fullText}`);
      }
    }
    console.log('📚 Bloques finales para flashcards:', texts.map((t, idx) => ({
      index: idx + 1,
      chars: t.length,
      preview: t.slice(0, 120).split('\n').join(' '),
    })));
    return texts.filter(Boolean).join('\n\n---\n\n');
  }, [materiales, seleccion, findSelectionForMaterial, getSelectionPages]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError('');
    setGeneratingStep(
      hasAnySelection
        ? `Analizando el 100% de ${totalSelectedPages} página${totalSelectedPages === 1 ? '' : 's'} seleccionada${totalSelectedPages === 1 ? '' : 's'}...`
        : 'Analizando el 100% de tu material...'
    );
    setGeneratingProgress(0);

    const progressInterval = setInterval(() => {
      setGeneratingProgress(prev => prev >= 85 ? prev : prev + Math.random() * 6);
    }, 700);

    const steps = [
      'Leyendo el contenido...',
      'Identificando conceptos clave...',
      'Generando preguntas inteligentes...',
      'Creando respuestas precisas...',
      'Filtrando duplicados...',
    ];
    let stepIdx = 0;
    const stepInterval = setInterval(() => {
      if (stepIdx < steps.length) { setGeneratingStep(steps[stepIdx]); stepIdx++; }
    }, 2200);

    try {
      let texto = materialText;
      if (!texto || texto.trim().length < 50) {
        console.log('🔍 Sin cache de texto, extrayendo con OCR/Gemini...');
        texto = await extractText();
        if (!texto.trim()) { setError('No se pudo extraer texto del material.'); return; }
        setMaterialText(texto);
        if (sessionId) {
          try {
            const sessionsMap = JSON.parse(localStorage.getItem(`study_sessions_v1_${tema?.id || 'default'}`) || '{}');
            if (sessionsMap[sessionId]) {
              sessionsMap[sessionId].materialText = texto;
              localStorage.setItem(`study_sessions_v1_${tema?.id || 'default'}`, JSON.stringify(sessionsMap));
              console.log('💾 materialText cacheado (' + texto.length + ' chars)');
            } else {
              console.warn('Sesión no encontrada en localStorage para cachear materialText.');
            }
          } catch (e) {
            console.warn('Error cacheando materialText:', e);
          }
        }
      } else {
        console.log('⚡ Texto ya cacheado (' + texto.length + ' chars) - saltando OCR');
      }

      console.log('📚 Texto usado para flashcards:', texto.length, 'chars');
      console.log('📑 Selección activa:', seleccion || []);
      const lang = detectContentLanguage(texto, 'es');

      const materialBlocks: { text: string; materialId: string }[] = [];
      const blockRegex = /\[Material \d+: ID=([^|\]]+)[^\]]*\]\n([\s\S]*?)(?=\n\[Material \d+:|$)/g;
      let blockMatch;
      while ((blockMatch = blockRegex.exec(texto)) !== null) {
        const matId = blockMatch[1].trim();
        const matText = blockMatch[2].trim();
        if (matText.length > 50) {
          materialBlocks.push({ text: matText, materialId: matId });
        }
      }
      if (materialBlocks.length === 0) {
        materialBlocks.push({
          text: texto,
          materialId: matActual?.materialId || matActual?.id || '',
        });
      }
      console.log(`🔀 Procesando ${materialBlocks.length} material(es) por separado`);

      const session = (await supabase.auth.getSession()).data.session;
      const allResponses = await Promise.all(
        materialBlocks.map(async (block, blockIdx) => {
          setGeneratingStep(`Generando flashcards del material ${blockIdx + 1}/${materialBlocks.length}...`);
          const res = await fetch('/api/flashcards', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
            },
            body: JSON.stringify({
              content: block.text,
              idioma: lang,
              materialId: block.materialId,
              seleccion,
              selectedPages,
              totalSelectedPages,
            }),
          });
          const data = await res.json();
          if (!data.success || !data.flashcards?.length) {
            console.warn(`⚠️ Material ${blockIdx + 1} sin flashcards:`, data.error);
            return [];
          }
          console.log(`✅ Material ${blockIdx + 1}: ${data.flashcards.length} flashcards`);
          return data.flashcards;
        })
      );
      const allCards = allResponses.flat();
      if (allCards.length === 0) {
        setError('No se pudieron generar flashcards.'); return;
      }
      const raw = dedupe(allCards);
      const cards: Flashcard[] = raw.map((c: any) => ({
        id: uid(),
        question: c.question,
        answer: c.answer,
        createdAt: Date.now(),
        sourceText: c.sourceText,
        sourcePage: c.sourcePage,
        sourceMaterialId: c.sourceMaterialId,
      }));
      setGeneratingProgress(100);
      setGeneratingStep(`¡Listo! ${cards.length} flashcards generadas`);
      await new Promise(r => setTimeout(r, 700));
      setFlashcards(cards);
    } catch (e: any) {
      setError(e.message || 'Error al generar flashcards');
    } finally {
      clearInterval(progressInterval);
      clearInterval(stepInterval);
      setGenerating(false);
    }
  }, [extractText, matActual, hasAnySelection, totalSelectedPages, materialText, seleccion, sessionId, tema?.id]);

  const editCard = (id: string, q: string, a: string) => {
    setFlashcards(prev => prev.map(c => c.id === id ? { ...c, question: q, answer: a } : c));
  };
  const deleteCard = (id: string) => {
    setFlashcards(prev => prev.filter(c => c.id !== id));
  };
  const crearManualmente = () => {
    const nueva: Flashcard = {
      id: uid(),
      question: 'Nueva pregunta',
      answer: 'Nueva respuesta',
      createdAt: Date.now(),
    };
    setFlashcards(prev => [nueva, ...prev]);
    setEditingCard(nueva);
  };

  if (studySingleCard) return <StudyRepite cards={[studySingleCard]} color={color} onClose={() => setStudySingleCard(null)} readOnly contexto={materialText} />;
  if (studyMode === 'repite') return <StudyRepite cards={flashcards} color={color} onClose={() => setStudyMode(null)} contexto={materialText} order={studyOrder} />;
  if (studyMode === 'rapido') return <StudyRapido cards={flashcards} color={color} onClose={() => setStudyMode(null)} contexto={materialText} order={studyOrder} />;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0a0a0c',
      display: 'flex', flexDirection: 'column', fontFamily: BODY,
    }}>
      {/* HEADER */}
      <div style={{
        flexShrink: 0, background: 'rgba(255,255,255,0.02)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px',
      }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
            borderRadius: 10, border: '1.5px dashed rgba(255,255,255,0.15)',
            background: 'transparent', color: '#aaa',
            fontFamily: BODY, fontSize: 14, fontWeight: 700, cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.color = '#fff';
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.3)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.color = '#aaa';
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.15)';
          }}
        >← Volver al enfoque</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: `0 0 12px ${color}` }} />
          <span style={{ fontSize: 26, fontWeight: 700, color: '#fff', fontFamily: HAND, letterSpacing: 0.5 }}>
            StudyAL cards
          </span>
          <span style={{ fontSize: 14, color: '#555', fontFamily: BODY }}>·</span>
          <span style={{ fontSize: 16, color: '#888', fontFamily: HAND }}>{tema?.nombre}</span>
        </div>
        <div style={{ width: 160 }} />
      </div>
      {/* BODY */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {/* TABS */}
        <div style={{
          display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0, padding: '0 24px',
          background: 'rgba(255,255,255,0.01)',
        }}>
          {[
            { key: 'material' as const, label: '📘 Material', count: 0 },
            { key: 'flashcards' as const, label: '🎴 Flashcards', count: flashcards.length },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setRightTab(tab.key)}
              style={{
                padding: '14px 22px', background: 'none', border: 'none',
                borderBottom: `2.5px solid ${rightTab === tab.key ? color : 'transparent'}`,
                color: rightTab === tab.key ? '#fff' : '#666',
                fontFamily: BODY, fontSize: 15,
                fontWeight: rightTab === tab.key ? 700 : 500,
                cursor: 'pointer',
                marginBottom: -1, display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span style={{
                  background: `${color}33`, color: color, borderRadius: 10,
                  padding: '2px 9px', fontSize: 13, fontWeight: 800,
                }}>{tab.count}</span>
              )}
            </button>
          ))}
          {materiales.length > 1 && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingRight: 8 }}>
              <span style={{ fontSize: 13, color: '#666', fontFamily: BODY, fontStyle: 'italic' }}>Material:</span>
              <select
                value={activeMaterialIndex}
                onChange={e => {
                  const nextIndex = Number(e.target.value);
                  const firstGlobalIndex = selectionSequence.findIndex(item => item.materialIndex === nextIndex);
                  if (firstGlobalIndex >= 0) {
                    goToGlobalSelection(firstGlobalIndex);
                  } else {
                    setActiveMaterialIndex(nextIndex);
                  }
                }}
                style={{
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, color: '#ccc', fontSize: 13, padding: '6px 10px',
                  cursor: 'pointer', outline: 'none', maxWidth: 240, fontFamily: BODY,
                }}
              >
                {materiales.map((m, i) => (
                  <option key={m.id || i} value={i}>{m.nombre || m.name || `Material ${i + 1}`}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        {/* TAB MATERIAL */}
        {rightTab === 'material' && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{
              flex: '0 0 50%',
              borderRight: '1px solid rgba(255,255,255,0.06)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              {pdfLoading ? (
                <div style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 12, color: '#555',
                }}>
                  <div style={{
                    width: 32, height: 32, border: `3px solid ${color}33`,
                    borderTop: `3px solid ${color}`, borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  <div style={{ fontSize: 14, fontFamily: BODY, fontStyle: 'italic' }}>Cargando PDF...</div>
                </div>
              ) : pdfUrl ? (
                <PDFViewer
                  key={`${activeMaterialIndex}-${matActual?.materialId || matActual?.id || 'material'}-${pdfUrl || ''}`}
                  url={pdfUrl}
                  selectedPages={selectedPages}
                  themeColor={color}
                  onTotalPages={setNumPages}
                  totalSelectedPages={totalSelectedPages}
                  activeMaterialIndex={activeMaterialIndex}
                  materialesCount={materiales.length}
                  forcedPage={currentGlobalEntry?.materialIndex === activeMaterialIndex ? currentGlobalEntry.page : undefined}
                  globalSelectedIndex={selectionSequence.length > 0 ? globalSelectedCursor : undefined}
                  globalSelectedTotal={selectionSequence.length > 0 ? totalSelectedPages : undefined}
                  onRequestPrev={selectionSequence.length > 0 ? goToPrev : undefined}
                  onRequestNext={selectionSequence.length > 0 ? goToNext : undefined}
                  onPageChange={selectionSequence.length > 0 ? syncGlobalCursorFromPage : undefined}
                />
              ) : (
                <div style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 12, color: '#555',
                }}>
                  <div style={{ fontSize: 36 }}>📄</div>
                  <div style={{ fontSize: 14, fontFamily: BODY, fontStyle: 'italic' }}>No se pudo cargar el material</div>
                </div>
              )}
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {flashcards.length === 0 ? (
                <EmptyGenerate
                  color={color} onGenerate={generate} generating={generating}
                  numPages={numPages} selectedPages={selectedPages}
                  materialesCount={materiales.length} activeMaterialIndex={activeMaterialIndex} totalSelectedPages={totalSelectedPages}
                />
              ) : (
                <ScrollList
                  cards={flashcards} color={color}
                  onEdit={(c) => setEditingCard(c)}
                  onDelete={deleteCard}
                  onShowSource={setSourceCard}
                  onStudySingle={(c) => setStudySingleCard(c)}
                  onStudyAll={() => setShowStudySelector(true)}
                  onRegenerate={generate}
                  generating={generating}
                  onCreateManual={crearManualmente}
                />
              )}
            </div>
          </div>
        )}
        {/* TAB FLASHCARDS */}
        {rightTab === 'flashcards' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {flashcards.length === 0 ? (
              <EmptyGenerate
                color={color} onGenerate={generate} generating={generating}
                numPages={numPages} selectedPages={selectedPages}
                materialesCount={materiales.length} activeMaterialIndex={activeMaterialIndex} totalSelectedPages={totalSelectedPages}
              />
            ) : (
              <DeckView
                cards={flashcards} color={color}
                onEdit={(c) => setEditingCard(c)}
                onDelete={deleteCard}
                onShowSource={setSourceCard}
                onStudyAll={() => setShowStudySelector(true)}
                onStudySingle={(c) => setStudySingleCard(c)}
                onRegenerate={generate}
                generating={generating}
                onCreateManual={crearManualmente}
              />
            )}
          </div>
        )}
        {error && (
          <div style={{
            position: 'absolute', bottom: 20, left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 18px', borderRadius: 10,
            background: 'rgba(239,68,68,0.15)', border: '1.5px dashed rgba(239,68,68,0.5)',
            color: '#f87171', fontSize: 14, fontFamily: BODY, zIndex: 200,
          }}>{error}</div>
        )}
        {generating && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(10,10,12,0.94)',
            backdropFilter: 'blur(12px)', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 24, zIndex: 100,
          }}>
            <div style={{
              width: 90, height: 90, borderRadius: '50%',
              background: `${color}15`, border: `2px dashed ${color}66`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 42, animation: 'float 2s ease-in-out infinite',
            }}>🤖</div>
            <div style={{ textAlign: 'center', maxWidth: 360 }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', fontFamily: HAND, marginBottom: 8 }}>
                Analizando tu material
              </div>
              <div style={{ fontSize: 16, color: '#aaa', fontFamily: BODY, minHeight: 22, fontStyle: 'italic' }}>
                {generatingStep}
              </div>
            </div>
            <div style={{
              width: 320, height: 5, borderRadius: 3,
              background: 'rgba(255,255,255,0.08)', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', width: `${generatingProgress}%`,
                background: color, borderRadius: 3,
                transition: 'width 0.5s ease', boxShadow: `0 0 12px ${color}`,
              }} />
            </div>
            <div style={{ fontSize: 14, color: '#666', fontFamily: BODY, fontStyle: 'italic' }}>
              {Math.round(generatingProgress)}% completado
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} style={{
                  width: 40, height: 52, borderRadius: 6,
                  background: `${color}${i * 2 < generatingProgress / 10 ? '44' : '0a'}`,
                  border: `1.5px dashed ${color}${i * 2 < generatingProgress / 10 ? '66' : '22'}`,
                  transition: 'all 0.5s', transform: `rotate(${(i - 2) * 4}deg)`,
                }} />
              ))}
            </div>
          </div>
        )}
      </div>
      {editingCard && (
        <EditModal
          card={editingCard} color={color}
          onSave={(q, a) => editCard(editingCard.id, q, a)}
          onClose={() => setEditingCard(null)}
        />
      )}
      {sourceCard && (
        <SourceViewer
          card={sourceCard}
          materiales={materiales}
          color={color}
          onClose={() => setSourceCard(null)}
        />
      )}
      {showStudySelector && (
        <StudySelector
          color={color}
          onSelect={(mode, ord) => { setStudyMode(mode); setStudyOrder(ord); setShowStudySelector(false); }}
          onClose={() => setShowStudySelector(false)}
        />
      )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Patrick+Hand&family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-10px); } }
      `}</style>
    </div>
  );
}
