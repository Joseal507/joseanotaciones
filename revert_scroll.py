import pathlib

path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')
text = path.read_text(encoding='utf-8')

# Revertir changePage a versión con getBoundingClientRect + smooth
old_change = """  const changePage = useCallback(
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

new_change = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      onSelectionMenu?.(null);
      setCurrentPage(newPage);

      const pageEl = pageRefs.current[newPage];
      const scrollEl = scrollRef.current;
      if (pageEl && scrollEl) {
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

if old_change in text:
    text = text.replace(old_change, new_change, 1)
    print("✅ changePage revertido")
else:
    print("❌ No matcheó changePage")

# Restaurar useEffect de forcedPage
old_spot = """  // ── Detectar qué página está visible al scrollear ──"""

new_with_forced = """  // ── Scroll a forcedPage cuando cambia (cambio de material) ──
  useEffect(() => {
    if (typeof forcedPage !== 'number' || forcedPage <= 0) return;
    if (!pages.includes(forcedPage)) return;

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

if old_spot in text:
    text = text.replace(old_spot, new_with_forced, 1)
    print("✅ useEffect forcedPage restaurado")
else:
    print("❌ No matcheó spot para forcedPage")

path.write_text(text, encoding='utf-8')
print("\n🎉 Revertido al estado anterior")
