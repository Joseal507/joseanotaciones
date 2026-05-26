import pathlib

path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')
text = path.read_text(encoding='utf-8')

# Eliminar el useEffect duplicado que está peleando
old_duplicate = """  // ── Auto-scroll cuando currentPage cambia (por botón o por forced) ──
  useEffect(() => {
    if (!currentPage) return;
    const pageEl = pageRefs.current[currentPage];
    const scrollEl = scrollRef.current;
    if (pageEl && scrollEl) {
      // Pequeño delay para asegurar que la página está renderizada
      const t = setTimeout(() => {
        const offsetTop = pageEl.offsetTop - 24;
        scrollEl.scrollTo({
          top: offsetTop,
          behavior: 'smooth',
        });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [currentPage]);

"""

if old_duplicate in text:
    text = text.replace(old_duplicate, '', 1)
    print("✅ useEffect duplicado ELIMINADO (era el que descuadraba el scroll)")
else:
    print("❌ No encontré el duplicado")

# También mejorar changePage para que sea más preciso
old_change = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      onSelectionMenu?.(null);
      setCurrentPage(newPage);

      // Scroll exacto usando scrollIntoView nativo
      const pageEl = pageRefs.current[newPage];
      const scrollEl = scrollRef.current;
      if (pageEl && scrollEl) {
        // Primero medir posiciones actuales
        const pageRect = pageEl.getBoundingClientRect();
        const scrollRect = scrollEl.getBoundingClientRect();
        // Diferencia entre top de página y top del viewport del scroll
        const diff = pageRect.top - scrollRect.top;
        // Scrollear esa diferencia
        scrollEl.scrollBy({
          top: diff,
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

if old_change in text:
    text = text.replace(old_change, new_change, 1)
    print("✅ changePage usa cálculo exacto (no scrollBy que acumulaba error)")

path.write_text(text, encoding='utf-8')
print("\n🎉 Listo. El useEffect duplicado era el problema.")
