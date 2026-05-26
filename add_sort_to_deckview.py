import pathlib
import re

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

# ─────────────────────────────────────────────────────────
# 1) Crear hook reusable arriba (después de los imports/helpers)
# ─────────────────────────────────────────────────────────
hook_code = '''
// ═══════════════════════════════════════════════════════════════
// ─── HOOK: Controles de favoritos + ordenamiento ──────────────
// ═══════════════════════════════════════════════════════════════
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

  // ── Limpiar favoritos huérfanos cuando cambian las cards ──
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
  }, [cards]);

  // ── Si no quedan favoritos y estábamos en modo favs_first/showOnlyFavs, resetear ──
  useEffect(() => {
    if (favorites.size === 0) {
      if (sortMode === 'favs_first') setSortMode('natural');
      if (showOnlyFavs) setShowOnlyFavs(false);
    }
  }, [favorites.size, sortMode, showOnlyFavs]);

  // ── Aplicar orden ──
  const sortedCards = (() => {
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
  })();

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

// ═══════════════════════════════════════════════════════════════
// ─── COMPONENTE: Barra de controles (orden + favs) ────────────
// ═══════════════════════════════════════════════════════════════
function ControlsBar({ controls, color }: {
  controls: ReturnType<typeof useFlashcardControls>;
  color: string;
}) {
  const { favorites, showOnlyFavs, setShowOnlyFavs, sortMode, setSortMode, showSortMenu, setShowSortMenu } = controls;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap', position: 'relative' }}>
      {/* Selector de orden */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowSortMenu(!showSortMenu)}
          style={{
            padding: '8px 14px', borderRadius: 999,
            background: 'rgba(255,255,255,0.04)',
            border: '1.5px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.85)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
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
                // Ocultar "favs_first" si no hay favoritos
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
                      cursor: 'pointer', fontFamily: 'Inter, sans-serif',
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

      {/* Filtro favoritos */}
      {favorites.size > 0 && (
        <button
          onClick={() => setShowOnlyFavs(!showOnlyFavs)}
          style={{
            padding: '8px 16px', borderRadius: 999,
            background: showOnlyFavs ? '#fbbf24' : 'rgba(255,255,255,0.04)',
            border: showOnlyFavs ? '1.5px solid #f59e0b' : '1.5px solid rgba(255,255,255,0.1)',
            color: showOnlyFavs ? '#000' : 'rgba(255,255,255,0.7)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          {showOnlyFavs ? '★' : '☆'} {showOnlyFavs ? 'Mostrando favoritos' : `Solo favoritos (${favorites.size})`}
        </button>
      )}
    </div>
  );
}

'''

# Insertar el hook antes de "// ─── DECK VIEW"
marker = "// ─── DECK VIEW (tab Flashcards: 1 grande con paginación) ─────"
if marker in text:
    text = text.replace(marker, hook_code + marker, 1)
    print("✅ Hook useFlashcardControls + ControlsBar añadidos")
else:
    print("❌ No encontré marker DECK VIEW")

# ─────────────────────────────────────────────────────────
# 2) Reemplazar el código viejo de ScrollList (favoritos + orden inline)
# por el uso del hook
# ─────────────────────────────────────────────────────────
old_scrolllist_state = """  const [flippedSet, setFlippedSet] = useState<Set<string>>(new Set());

  // ── Favoritos (persistencia en localStorage) ──
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('flashcard_favs');
      return new Set(stored ? JSON.parse(stored) : []);
    } catch { return new Set(); }
  });
  const [showOnlyFavs, setShowOnlyFavs] = useState(false);

  // ── Orden de visualización ──
  type SortMode = 'natural' | 'material_first' | 'material_last' | 'newest' | 'oldest' | 'page' | 'favs_first';
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
  };"""

new_scrolllist_state = """  const [flippedSet, setFlippedSet] = useState<Set<string>>(new Set());

  // ── Controles compartidos (favoritos + orden) ──
  const controls = useFlashcardControls(cards);
  const { favorites, toggleFav, visibleCards } = controls;"""

if old_scrolllist_state in text:
    text = text.replace(old_scrolllist_state, new_scrolllist_state, 1)
    print("✅ ScrollList migrado al hook")
else:
    print("⚠️ ScrollList state no exacto - intentando match parcial")
    # Si no matchea, dejar como está y solo añadir el hook por separado

# 3) Eliminar el bloque viejo de "sortedCards" inline de ScrollList
old_sorted_inline = """  // ── Aplicar orden ──
  const sortedCards = (() => {
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
  })();

  const sortLabels: Record<SortMode, string> = {
    natural: '📋 Orden original',
    material_first: '📚 Material: A → Z',
    material_last: '📚 Material: Z → A',
    newest: '🆕 Más recientes',
    oldest: '📅 Más antiguas',
    page: '📄 Por página',
    favs_first: '⭐ Favoritas primero',
  };

  return ("""

if old_sorted_inline in text:
    text = text.replace(old_sorted_inline, "  return (", 1)
    print("✅ Bloque sortedCards inline eliminado de ScrollList")
else:
    print("⚠️ Bloque sortedCards inline no encontrado (puede que ya esté limpio)")

# 4) Reemplazar el bloque viejo del ControlsBar inline en ScrollList por <ControlsBar />
old_controls_inline = """        {/* Controles: orden + favoritos */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap', position: 'relative' }}>
          {/* Selector de orden */}"""

# Buscar todo el bloque hasta el cierre
idx = text.find(old_controls_inline)
if idx >= 0:
    # Buscar el cierre del bloque (3 niveles: div + ) + })
    # Vamos a buscar el patrón "          )}\n        </div>" que cierra
    end_marker = "          )}\n        </div>\n"
    end_idx = text.find(end_marker, idx)
    if end_idx >= 0:
        end_idx += len(end_marker)
        text = text[:idx] + "        <ControlsBar controls={controls} color={color} />\n" + text[end_idx:]
        print("✅ ControlsBar inline reemplazado por componente")
    else:
        print("⚠️ No encontré cierre del bloque ControlsBar inline")
else:
    print("⚠️ ControlsBar inline no encontrado en ScrollList")

# 5) Reemplazar visibleCards en el .map de ScrollList
text = text.replace(
    "{(showOnlyFavs ? sortedCards.filter(c => favorites.has(c.id)) : sortedCards).map((card, i) => (",
    "{visibleCards.map((card, i) => (",
    1
)
text = text.replace(
    "{(showOnlyFavs ? cards.filter(c => favorites.has(c.id)) : cards).map((card, i) => (",
    "{visibleCards.map((card, i) => (",
    1
)

# ─────────────────────────────────────────────────────────
# 6) Añadir el hook + ControlsBar a DeckView
# ─────────────────────────────────────────────────────────
old_deckview_state = """}) {
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[current];

  useEffect(() => { setFlipped(false); }, [current]);"""

new_deckview_state = """}) {
  // ── Controles compartidos (favoritos + orden) ──
  const controls = useFlashcardControls(cards);
  const { favorites, toggleFav, visibleCards } = controls;

  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = visibleCards[current];

  // Resetear current si se sale del rango (por filtro de favs o sort)
  useEffect(() => {
    if (current >= visibleCards.length && visibleCards.length > 0) {
      setCurrent(0);
    }
  }, [visibleCards.length, current]);

  useEffect(() => { setFlipped(false); }, [current]);"""

if old_deckview_state in text:
    text = text.replace(old_deckview_state, new_deckview_state, 1)
    print("✅ DeckView usa hook useFlashcardControls")
else:
    print("❌ No encontré state inicial de DeckView")

# 7) Cambiar cards.length por visibleCards.length en DeckView
# Solo en el handler de teclado del DeckView (línea 488)
old_handler = """      else if (e.key === 'ArrowRight') setCurrent(c => Math.min(cards.length - 1, c + 1));"""
new_handler = """      else if (e.key === 'ArrowRight') setCurrent(c => Math.min(visibleCards.length - 1, c + 1));"""

if old_handler in text:
    text = text.replace(old_handler, new_handler, 1)
    print("✅ Navegación de DeckView usa visibleCards")

# 8) Añadir el <ControlsBar /> al inicio del return de DeckView (después del badge)
# Buscar el badge IA verde y poner el ControlsBar antes
old_badge_start = """  return (
    <div style={{
      flex: 1, overflow: 'auto', padding: '20px 28px 40px',
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      {/* Badge IA verde */}"""

new_badge_start = """  return (
    <div style={{
      flex: 1, overflow: 'auto', padding: '20px 28px 40px',
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      {/* Controles de orden y favoritos */}
      <div style={{ maxWidth: 800, margin: '0 auto', width: '100%' }}>
        <ControlsBar controls={controls} color={color} />
      </div>

      {/* Badge IA verde */}"""

if old_badge_start in text:
    text = text.replace(old_badge_start, new_badge_start, 1)
    print("✅ ControlsBar añadido al inicio de DeckView")
else:
    print("⚠️ No encontré inicio del return de DeckView")

path.write_text(text, encoding='utf-8')
print("\n🎉 Listo. Reinicia el dev server.")
