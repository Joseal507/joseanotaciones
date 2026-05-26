import pathlib
import re

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

lines = text.splitlines(keepends=True)
print(f"Total líneas: {len(lines)}")

# ════════════════════════════════════════════════════
# FIX 1: MOVER los 2 useEffects de cache DESPUÉS del
# useState de materialText (línea 2432)
# ════════════════════════════════════════════════════

# Bloque completo de los 2 useEffects que están ANTES del useState
cache_block = """  // ── Cargar flashcards + materialText desde cache de sesión al montar ──
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
  }, [sessionId, tema?.id, cacheLoaded]);

  // ── Auto-guardar flashcards en sesión (con debounce) ──
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

# Verificar que existe
if cache_block not in text:
    print("❌ No encontré el bloque exacto de cache useEffects")
    # Mostrar contexto cerca de línea 2319
    for i, l in enumerate(lines[2315:2375], start=2316):
        print(f"{i}: {l}", end='')
else:
    print("✅ Bloque de cache useEffects encontrado")
    
    # 1) Remover el bloque de donde está ahora
    text_sin_cache = text.replace(cache_block, '', 1)
    
    # 2) Insertar DESPUÉS del useState de materialText
    # El anchor es la línea con useState<string>('')
    anchor = "  const [materialText, setMaterialText] = useState<string>('');"
    
    if anchor not in text_sin_cache:
        print("❌ No encontré anchor useState de materialText")
    else:
        # Insertar el bloque después del anchor
        insert_after = anchor + "\n\n" + cache_block
        text_final = text_sin_cache.replace(anchor, insert_after, 1)
        
        path.write_text(text_final, encoding='utf-8')
        lines_final = text_final.splitlines()
        
        # Verificar nueva posición
        mat_line = next((i+1 for i, l in enumerate(lines_final) if "useState<string>('')" in l and 'materialText' in l), None)
        cache_line = next((i+1 for i, l in enumerate(lines_final) if 'Cache hit: materialText' in l), None)
        save_line = next((i+1 for i, l in enumerate(lines_final) if 'Cache guardado:' in l), None)
        
        print(f"✅ Orden correcto:")
        print(f"   useState materialText: línea {mat_line}")
        print(f"   Cache load useEffect:  línea {cache_line}")
        print(f"   Cache save useEffect:  línea {save_line}")
        
        if mat_line and cache_line and mat_line < cache_line:
            print("✅ useState ANTES que useEffects ← correcto")
        else:
            print("❌ Orden incorrecto, revisar manualmente")

# ════════════════════════════════════════════════════
# FIX 2: La función generate() debe saltarse extractText
# si ya hay materialText en cache
# ════════════════════════════════════════════════════
# Leer el archivo actualizado
text2 = path.read_text(encoding='utf-8')

# Buscar dónde se llama extractText dentro de generate/handleGenerate
# Línea ~2616: const texto = await extractText();
old_extract_call = """      const texto = await extractText();
      if (!texto || texto.trim().length < 50) {
        setError('No se pudo extraer texto del material. Verifica que el PDF tenga contenido.');
        setGenerating(false);
        return;
      }
      setMaterialText(texto);"""

new_extract_call = """      // ── Usar texto cacheado si existe (evita re-llamar a Gemini/OCR) ──
      let texto = materialText;
      if (!texto || texto.trim().length < 50) {
        console.log('🔍 No hay texto en cache, extrayendo...');
        texto = await extractText();
        if (!texto || texto.trim().length < 50) {
          setError('No se pudo extraer texto del material. Verifica que el PDF tenga contenido.');
          setGenerating(false);
          return;
        }
        setMaterialText(texto);
        // Guardar materialText en localStorage junto a la sesión
        if (sessionId) {
          try {
            const keys = Object.keys(localStorage).filter(k => k.startsWith('study_sessions_v1_'));
            for (const k of keys) {
              const data = JSON.parse(localStorage.getItem(k) || '{}');
              if (data[sessionId]) {
                data[sessionId].materialText = texto;
                localStorage.setItem(k, JSON.stringify(data));
                console.log('💾 materialText guardado en cache (' + texto.length + ' chars)');
                break;
              }
            }
          } catch (e) {
            console.warn('Error guardando materialText en cache:', e);
          }
        }
      } else {
        console.log('⚡ Usando texto cacheado (' + texto.length + ' chars) - saltando OCR');
      }"""

if old_extract_call in text2:
    text2 = text2.replace(old_extract_call, new_extract_call, 1)
    path.write_text(text2, encoding='utf-8')
    print("✅ FIX 2: generate() usa texto cacheado si existe")
else:
    print("❌ FIX 2: No encontré el call exacto de extractText")
    # Mostrar contexto
    lines2 = text2.splitlines()
    for i, l in enumerate(lines2):
        if 'extractText()' in l and 'await' in l:
            print(f"  Línea {i+1}: {l.strip()}")

print("\n🎉 Fixes aplicados:")
print("   1. useState de materialText declarado ANTES de los useEffects")  
print("   2. generate() reutiliza texto cacheado → no re-llama OCR/Gemini")
