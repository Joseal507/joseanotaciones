import pathlib

path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')
text = path.read_text(encoding='utf-8')

# FIX 1: changePage usa offsetTop directo, sin smooth, sin getBoundingClientRect
old_change = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      onSelectionMenu?.(null);
      setCurrentPage(newPage);

      // Scroll EXACTO al inicio de la página
      const pageEl = pageRefs.current[newPage];
      const scrollEl = scrollRef.current;
      if (pageEl && scrollEl) {
        // Posición real de la página relativa al scroll viewport
        const pageRect = pageEl.getBoundingClientRect();
        const scrollRect = scrollEl.getBoundingClientRect();
        const diff = pageRect.top - scrollRect.top;
        const newScrollTop = scrollEl.scrollTop + diff;
        scrollEl.scrollTo({
          top: Math.max(0, newScrollTop),
          behavior: 'smooth',
        });
      }
    },
    [pages, onSelectionMenu]
  );"""

new_change = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      onSelectionMenu?.(null);
      setCurrentPage(newPage);

      // offsetTop es relativo al scrollEl directamente
      const pageEl = pageRefs.current[newPage];
      const scrollEl = scrollRef.current;
      if (pageEl && scrollEl) {
        scrollEl.scrollTop = pageEl.offsetTop;
      }
    },
    [pages, onSelectionMenu]
  );"""

if old_change in text:
    text = text.replace(old_change, new_change, 1)
    print("✅ changePage usa offsetTop directo")
else:
    print("❌ No matcheó changePage")

# FIX 2: Eliminar useEffect de forcedPage que duplica el scroll
old_forced = """  // ── Scroll a forcedPage cuando cambia (cambio de material) ──
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

"""

if old_forced in text:
    text = text.replace(old_forced, '\n', 1)
    print("✅ useEffect duplicado de forcedPage eliminado")
else:
    print("❌ No matcheó useEffect forcedPage")

path.write_text(text, encoding='utf-8')
print("\n🎉 Scroll limpio: offsetTop directo, sin duplicados")
