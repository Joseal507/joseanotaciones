import pathlib

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

# 1) Añadir estado de ordenamiento justo después de showOnlyFavs
old_state = """  const [showOnlyFavs, setShowOnlyFavs] = useState(false);"""
new_state = """  const [showOnlyFavs, setShowOnlyFavs] = useState(false);

  // ── Orden de visualización ──
  type SortMode = 'natural' | 'material_first' | 'material_last' | 'newest' | 'oldest' | 'page' | 'favs_first';
  const [sortMode, setSortMode] = useState<SortMode>('natural');
  const [showSortMenu, setShowSortMenu] = useState(false);"""

if old_state in text:
    text = text.replace(old_state, new_state, 1)
    print("✅ Estado de orden añadido")
else:
    print("❌ No encontré showOnlyFavs")

# 2) Añadir función de ordenamiento antes del return
old_return = """  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header sticky con badge IA + estudiar */}"""
new_return = """  // ── Aplicar orden ──
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header sticky con badge IA + estudiar */}"""

if old_return in text:
    text = text.replace(old_return, new_return, 1)
    print("✅ Función de ordenamiento añadida")
else:
    print("❌ No encontré return")

# 3) Reemplazar el .map(cards) por .map(sortedCards)
# Buscar el filtro de favoritos que ya pusimos
old_filter = "{(showOnlyFavs ? cards.filter(c => favorites.has(c.id)) : cards).map((card, i) => ("
new_filter = "{(showOnlyFavs ? sortedCards.filter(c => favorites.has(c.id)) : sortedCards).map((card, i) => ("

if old_filter in text:
    text = text.replace(old_filter, new_filter, 1)
    print("✅ .map usa sortedCards")
else:
    print("⚠️ No encontré filtro de favoritos (puede que no esté aplicado aún)")
    # Intentar reemplazo simple
    text = text.replace("{cards.map((card, i) => (", "{sortedCards.map((card, i) => (", 1)
    print("   → Reemplazado cards.map por sortedCards.map directamente")

# 4) Añadir botón de ordenamiento junto al de favoritos
old_fav_button = """        {/* Filtro favoritos */}
        {favorites.size > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <button
              onClick={() => setShowOnlyFavs(v => !v)}"""

new_fav_button = """        {/* Controles: orden + favoritos */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap', position: 'relative' }}>
          {/* Selector de orden */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowSortMenu(v => !v)}
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
              {sortLabels[sortMode]} ▾
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
                  {(Object.keys(sortLabels) as SortMode[]).map(mode => (
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
                      {sortLabels[mode]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Filtro favoritos */}
          {favorites.size > 0 && (
            <button
              onClick={() => setShowOnlyFavs(v => !v)}"""

if old_fav_button in text:
    text = text.replace(old_fav_button, new_fav_button, 1)
    print("✅ Botón de orden añadido junto a favoritos")
else:
    print("❌ No encontré bloque de favoritos para añadir orden al lado")

# Cerrar el div extra que abrimos arriba
# El botón de favoritos termina con </button>\n          </div>\n        )}
# Necesitamos cambiarlo a </button>\n          )}\n        </div>
old_close = """              {showOnlyFavs ? '★' : '☆'} {showOnlyFavs ? 'Mostrando favoritos' : `Solo favoritos (${favorites.size})`}
            </button>
          </div>
        )}"""

new_close = """              {showOnlyFavs ? '★' : '☆'} {showOnlyFavs ? 'Mostrando favoritos' : `Solo favoritos (${favorites.size})`}
            </button>
          )}
        </div>"""

if old_close in text:
    text = text.replace(old_close, new_close, 1)
    print("✅ Cierre de div ajustado")
else:
    print("⚠️ Revisa manualmente el cierre del div")

path.write_text(text, encoding='utf-8')
