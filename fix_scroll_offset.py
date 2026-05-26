import pathlib

path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')
text = path.read_text(encoding='utf-8')

# FIX 1: El scrollTo usa offsetTop pero el padding del contenedor desplaza todo
# Hay que considerar el padding-top del scroll container (16px)
# Y usar getBoundingClientRect para calcular la posición relativa real

old_change = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      onSelectionMenu?.(null);
      setCurrentPage(newPage);

      // Scroll exacto al inicio de la página (sin offset)
      const pageEl = pageRefs.current[newPage];
      const scrollEl = scrollRef.current;
      if (pageEl && scrollEl) {
        scrollEl.scrollTo({
          top: pageEl.offsetTop,
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

      // Scroll al inicio exacto de la página
      // Usar getBoundingClientRect para calcular posición real relativa al scroll
      const pageEl = pageRefs.current[newPage];
      const scrollEl = scrollRef.current;
      if (pageEl && scrollEl) {
        // offsetTop puede no funcionar bien si hay padding o transformaciones
        // Calculamos la posición real
        const pageTop = pageEl.getBoundingClientRect().top;
        const scrollTop = scrollEl.getBoundingClientRect().top;
        const currentScroll = scrollEl.scrollTop;
        // Posición destino: scroll actual + diferencia visual - padding del container (16px)
        const targetScroll = currentScroll + (pageTop - scrollTop) - 16;
        scrollEl.scrollTo({
          top: Math.max(0, targetScroll),
          behavior: 'smooth',
        });
      }
    },
    [pages, onSelectionMenu]
  );"""

if old_change in text:
    text = text.replace(old_change, new_change, 1)
    print("✅ FIX 1: changePage usa getBoundingClientRect (scroll exacto)")
else:
    print("❌ No encontré changePage")

path.write_text(text, encoding='utf-8')
