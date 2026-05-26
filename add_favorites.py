import pathlib

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

# 1) Añadir hook de favoritos al inicio del componente FlashcardsList
# Buscar después de "const toggleFlip = (id: string) => {"
old_toggle = "const toggleFlip = (id: string) => {"
new_toggle = """// ── Favoritos (persistencia en localStorage) ──
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('flashcard_favs');
      return new Set(stored ? JSON.parse(stored) : []);
    } catch { return new Set(); }
  });
  const [showOnlyFavs, setShowOnlyFavs] = useState(false);

  const toggleFav = (id: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem('flashcard_favs', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const toggleFlip = (id: string) => {"""

if old_toggle in text:
    text = text.replace(old_toggle, new_toggle, 1)
    print("✅ Hook de favoritos añadido")
else:
    print("❌ No encontré toggleFlip")

# 2) Filtrar cards según showOnlyFavs (en el .map)
old_map = "{cards.map((card, i) => ("
new_map = "{(showOnlyFavs ? cards.filter(c => favorites.has(c.id)) : cards).map((card, i) => ("

if old_map in text:
    text = text.replace(old_map, new_map, 1)
    print("✅ Filtro de favoritos aplicado")
else:
    print("❌ No encontré cards.map")

# 3) Añadir botón estrella en cada card (en el menú lateral)
# Vamos a insertarlo justo después del número de la card
old_number_block = """              }}>{i + 1}</div>

              {/* Menú */}"""
new_number_block = """              }}>{i + 1}</div>

              {/* Botón Favorito */}
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

              {/* Menú */}"""

if old_number_block in text:
    text = text.replace(old_number_block, new_number_block, 1)
    print("✅ Botón estrella añadido")
else:
    print("❌ No encontré bloque del número")

# 4) Añadir toggle "Solo favoritos" arriba de la lista
# Buscar donde inicia el div de la lista
old_list = """      {/* Lista scroll */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 18px 28px' }}>"""
new_list = """      {/* Lista scroll */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 18px 28px' }}>
        {/* Filtro favoritos */}
        {favorites.size > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <button
              onClick={() => setShowOnlyFavs(v => !v)}
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
          </div>
        )}"""

if old_list in text:
    text = text.replace(old_list, new_list, 1)
    print("✅ Toggle 'Solo favoritos' añadido")
else:
    print("❌ No encontré inicio de lista")

path.write_text(text, encoding='utf-8')
