import pathlib

path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')
text = path.read_text(encoding='utf-8')

# FIX: changePage debe llevar al inicio EXACTO de la página
# El problema: getBoundingClientRect mide desde el viewport, no desde el scroll container
# La cuenta queda mal cuando el padding del container cambia
# Solución: usar offsetTop del propio elemento dentro del scrollEl

old_change = """  const changePage = useCallback(
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

new_change = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      onSelectionMenu?.(null);
      setCurrentPage(newPage);

      // Scroll EXACTO al inicio de la página
      // offsetTop dentro del scrollEl da la posición correcta
      const pageEl = pageRefs.current[newPage];
      const scrollEl = scrollRef.current;
      if (pageEl && scrollEl) {
        // Calcular offset relativo al scrollEl recorriendo offsetParent
        let offsetTop = 0;
        let el: HTMLElement | null = pageEl;
        while (el && el !== scrollEl) {
          offsetTop += el.offsetTop;
          el = el.offsetParent as HTMLElement | null;
        }
        // Restar un poco para que se vea el badge "pág N" completo desde arriba
        scrollEl.scrollTo({
          top: Math.max(0, offsetTop - 8),
          behavior: 'smooth',
        });
      }
    },
    [pages, onSelectionMenu]
  );"""

if old_change in text:
    text = text.replace(old_change, new_change, 1)
    print("✅ FIX 1: scroll exacto al inicio con offsetTop acumulado")

path.write_text(text, encoding='utf-8')
