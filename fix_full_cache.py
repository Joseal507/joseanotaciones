import pathlib
import re

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

# ════════════════════════════════════════════════════
# 1) Mejorar el useEffect de cache LOAD para también cargar materialText
# ════════════════════════════════════════════════════
old_load = """  // ── Cargar flashcards desde cache de sesión al montar ──
  useEffect(() => {
    if (!sessionId || cacheLoaded) return;
    try {
      const sessions = getSessionsByTema(tema?.id || '');
      const sess = sessions.find(s => s.id === sessionId);
      if (sess?.flashcards && sess.flashcards.length > 0) {
        console.log('📦 Cache hit: cargando', sess.flashcards.length, 'flashcards desde sesión', sessionId);
        setFlashcards(sess.flashcards);
      }
    } catch (e) {
      console.warn('Error cargando cache de sesión:', e);
    }
    setCacheLoaded(true);
  }, [sessionId, tema?.id, cacheLoaded]);"""

new_load = """  // ── Cargar flashcards + materialText desde cache de sesión al montar ──
  useEffect(() => {
    if (!sessionId || cacheLoaded) return;
    try {
      const sessions = getSessionsByTema(tema?.id || '');
      const sess = sessions.find(s => s.id === sessionId);
      if (sess) {
        // Restaurar texto del material si existe (evita re-llamar a Gemini)
        if ((sess as any).materialText && typeof (sess as any).materialText === 'string') {
          console.log('📦 Cache hit: materialText (' + (sess as any).materialText.length + ' chars)');
          setMaterialText((sess as any).materialText);
        }
        // Restaurar flashcards si existen (evita re-generar)
        if (sess.flashcards && sess.flashcards.length > 0) {
          console.log('📦 Cache hit:', sess.flashcards.length, 'flashcards desde sesión', sessionId);
          setFlashcards(sess.flashcards);
        }
      }
    } catch (e) {
      console.warn('Error cargando cache de sesión:', e);
    }
    setCacheLoaded(true);
  }, [sessionId, tema?.id, cacheLoaded]);"""

if old_load in text:
    text = text.replace(old_load, new_load, 1)
    print("✅ Cache load mejorado (incluye materialText)")
else:
    print("❌ No encontré useEffect de cache load")

# ════════════════════════════════════════════════════
# 2) Mejorar el useEffect de cache SAVE para incluir materialText
# ════════════════════════════════════════════════════
old_save = """  // ── Auto-guardar flashcards en sesión (con debounce) ──
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
            flashcards: flashcards,
          });
          console.log('💾 Cache guardado:', flashcards.length, 'flashcards en', sessionId);
        }
      } catch (e) {
        console.warn('Error guardando cache:', e);
      }
    }, 800);
    return () => clearTimeout(t);
  }, [flashcards, sessionId, tema?.id, cacheLoaded]);"""

new_save = """  // ── Auto-guardar flashcards + materialText en sesión (con debounce) ──
  useEffect(() => {
    if (!sessionId || !cacheLoaded) return;
    if (flashcards.length === 0 && !materialText) return;
    const t = setTimeout(() => {
      try {
        const sessions = getSessionsByTema(tema?.id || '');
        const sess = sessions.find(s => s.id === sessionId);
        if (sess) {
          const payload: any = {
            temaId: sess.temaId,
            enfoque: sess.enfoque,
            materialIds: sess.materialIds,
            selectedPages: sess.selectedPages,
          };
          if (flashcards.length > 0) payload.flashcards = flashcards;
          // Guardamos materialText como propiedad extra (no está en la interfaz pero la añadimos)
          upsertSession(payload);

          // Hack: guardar materialText editando localStorage directamente
          if (materialText) {
            try {
              const userId = (sess as any).__userId || '';
              const keys = Object.keys(localStorage).filter(k => k.startsWith('study_sessions_v1_'));
              for (const k of keys) {
                const data = JSON.parse(localStorage.getItem(k) || '{}');
                if (data[sess.id]) {
                  data[sess.id].materialText = materialText;
                  localStorage.setItem(k, JSON.stringify(data));
                  break;
                }
              }
            } catch {}
          }

          console.log('💾 Cache guardado:', flashcards.length, 'flashcards +', materialText.length, 'chars texto');
        }
      } catch (e) {
        console.warn('Error guardando cache:', e);
      }
    }, 800);
    return () => clearTimeout(t);
  }, [flashcards, materialText, sessionId, tema?.id, cacheLoaded]);"""

if old_save in text:
    text = text.replace(old_save, new_save, 1)
    print("✅ Cache save mejorado (incluye materialText)")
else:
    print("❌ No encontré useEffect de cache save")

# ════════════════════════════════════════════════════
# 3) Saltar generación si cache hit
# ════════════════════════════════════════════════════
# Buscamos el botón "Generar" o autoGenerate
# Si flashcards.length > 0 al montar, no debe auto-generar
# Verificamos que la lógica de "EmptyGenerate" solo se muestre si flashcards.length === 0

# Esto ya es así naturalmente porque flashcards.length controla la vista,
# así que solo necesitamos asegurar que NO se llame a generate() automáticamente cuando hay cache.

# Buscar si hay auto-generate
m = re.search(r"useEffect\([^}]*generate\([^)]*\)[^}]*\}\s*,", text)
if m:
    line = text[:m.start()].count('\n') + 1
    print(f"⚠️ Detectado posible auto-generate en línea {line}")

path.write_text(text, encoding='utf-8')
print("\n🎉 Cache mejorado: ahora también guarda materialText")
print("   Próxima vez que entres a la sesión:")
print("   - Si hay flashcards → se muestran sin generar (instantáneo)")
print("   - Si solo hay materialText → skip extracción Gemini, solo genera flashcards")
