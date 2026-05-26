import pathlib

path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')
text = path.read_text(encoding='utf-8')

# FIX: Resetear scroll cuando cambia el material (activeMaterialIndex o url cambia)
# Esto asegura que al saltar al siguiente material veas la primera página desde arriba

old_handle_load = """  const handleLoad = ({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    onTotalPages(total);

    setCurrentPage((prev) => {
      if (typeof forcedPage === 'number' && Number.isFinite(forcedPage) && forcedPage > 0) {
        if (normalizedSelectedPages.length === 0 || normalizedSelectedPages.includes(forcedPage)) {
          return forcedPage;
        }
      }

      if (normalizedSelectedPages.length > 0) {
        return normalizedSelectedPages.includes(prev) ? prev : normalizedSelectedPages[0];
      }

      if (prev < 1) return 1;
      if (prev > total) return total;
      return prev;
    });
  };"""

new_handle_load = """  const handleLoad = ({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    onTotalPages(total);

    setCurrentPage((prev) => {
      if (typeof forcedPage === 'number' && Number.isFinite(forcedPage) && forcedPage > 0) {
        if (normalizedSelectedPages.length === 0 || normalizedSelectedPages.includes(forcedPage)) {
          return forcedPage;
        }
      }

      if (normalizedSelectedPages.length > 0) {
        return normalizedSelectedPages.includes(prev) ? prev : normalizedSelectedPages[0];
      }

      if (prev < 1) return 1;
      if (prev > total) return total;
      return prev;
    });

    // Reset scroll al top cuando el PDF nuevo termina de cargar
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  };"""

if old_handle_load in text:
    text = text.replace(old_handle_load, new_handle_load, 1)
    print("✅ Scroll resetea al top al cargar PDF nuevo")

# Además: cuando cambia activeMaterialIndex o url, resetear scroll inmediatamente
# Añadir useEffect que escucha cambios en url
old_imports = """  const handleMouseUp = useCallback(() => {"""

new_with_reset = """  // ── Resetear scroll al cambiar de material/url ──
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    // Limpiar refs de páginas viejas
    pageRefs.current = {};
  }, [url, activeMaterialIndex]);

  const handleMouseUp = useCallback(() => {"""

if old_imports in text:
    text = text.replace(old_imports, new_with_reset, 1)
    print("✅ Reset de scroll y pageRefs al cambiar de material")

# También: cuando forcedPage cambia (cambio de material desde el padre)
# hacer scroll a esa página después de un delay
old_observer_end = """  // ── Detectar qué página está visible al scrollear ──"""

new_with_forced = """  // ── Scroll a forcedPage cuando cambia (cambio de material) ──
  useEffect(() => {
    if (typeof forcedPage !== 'number' || forcedPage <= 0) return;
    if (!pages.includes(forcedPage)) return;

    // Esperar a que las páginas se rendericen
    const timer = setTimeout(() => {
      programmaticScrollRef.current = true;
      const pageEl = pageRefs.current[forcedPage];
      const scrollEl = scrollRef.current;
      if (pageEl && scrollEl) {
        const pageRect = pageEl.getBoundingClientRect();
        const scrollRect = scrollEl.getBoundingClientRect();
        const diff = pageRect.top - scrollRect.top;
        scrollEl.scrollTo({
          top: Math.max(0, scrollEl.scrollTop + diff),
          behavior: 'smooth',
        });
      }
      setTimeout(() => { programmaticScrollRef.current = false; }, 800);
    }, 300);

    return () => clearTimeout(timer);
  }, [forcedPage, pages]);

  // ── Detectar qué página está visible al scrollear ──"""

if old_observer_end in text:
    text = text.replace(old_observer_end, new_with_forced, 1)
    print("✅ Scroll auto a forcedPage cuando cambia (cambio de material)")

path.write_text(text, encoding='utf-8')
print("\n🎉 Cambio de material:")
print("   - Scroll resetea al cargar PDF nuevo")
print("   - Refs de páginas se limpian al cambiar material")
print("   - forcedPage hace scroll automático cuando llega")
