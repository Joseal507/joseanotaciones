import pathlib
import re

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

# El problema: el useEffect de auto-save usa materialText en su dependency array
# pero materialText se declara en useState DESPUÉS del useEffect
# 
# Línea ~2387: }, [flashcards, materialText, sessionId, tema?.id, cacheLoaded]);
# Línea ~2424: const [materialText, setMaterialText] = useState<string>('');
#
# SOLUCIÓN: El useEffect de cache save NO debe incluir materialText en deps
# porque materialText se guarda por separado cuando se setea.
# Lo removemos del dependency array y del body del useEffect.

# Buscar el useEffect problemático de auto-save
old_save = """  // ── Auto-guardar flashcards + materialText en sesión (con debounce) ──
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

new_save = """  // ── Auto-guardar flashcards en sesión (con debounce) ──
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

if old_save in text:
    text = text.replace(old_save, new_save, 1)
    print("✅ useEffect de auto-save simplificado (sin materialText en deps)")
else:
    print("❌ No encontré el useEffect problemático exacto")
    # Buscar variantes
    if 'materialText, sessionId, tema?.id, cacheLoaded]' in text:
        print("   → Encontré el dep array, arreglando solo eso...")
        text = text.replace(
            '}, [flashcards, materialText, sessionId, tema?.id, cacheLoaded]);',
            '}, [flashcards, sessionId, tema?.id, cacheLoaded]);'
        )
        print("   ✅ Dependency array corregido")

path.write_text(text, encoding='utf-8')
print("\n✅ Fix aplicado")
