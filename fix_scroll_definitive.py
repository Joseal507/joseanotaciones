import pathlib

path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')
text = path.read_text(encoding='utf-8')

# Usar scrollIntoView directo del navegador con block: 'start'
# Es lo más confiable y siempre lleva el elemento al top exacto del scroll container
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

      // scrollIntoView nativo es lo más confiable
      // block: 'start' lo lleva al top del scroll container
      const pageEl = pageRefs.current[newPage];
      if (pageEl) {
        pageEl.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest',
        });
      }
    },
    [pages, onSelectionMenu]
  );"""

if old_change in text:
    text = text.replace(old_change, new_change, 1)
    print("✅ changePage usa scrollIntoView nativo (block: start)")

# El observer puede estar peleando con scrollIntoView
# Cuando hacemos scrollIntoView programático y la página pasa de currentPage a newPage,
# el observer detecta varias páginas en transición y puede setear cualquiera.
# Solución: bloquear observer durante el scroll programático

old_observer = """      (entries) => {
        // Siempre actualizar la página visible por scroll
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible) {
          const pageNum = parseInt((visible.target as HTMLElement).dataset.pageNum || '0', 10);
          if (pageNum > 0) {
            setCurrentPage(prev => prev === pageNum ? prev : pageNum);
          }
        }
      },"""

new_observer = """      (entries) => {
        // No actualizar si estamos en scroll programático
        if (programmaticScrollRef.current) return;
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible) {
          const pageNum = parseInt((visible.target as HTMLElement).dataset.pageNum || '0', 10);
          if (pageNum > 0) {
            setCurrentPage(prev => prev === pageNum ? prev : pageNum);
          }
        }
      },"""

text2 = path.read_text(encoding='utf-8')
if old_observer in text2:
    text2 = text2.replace(old_observer, new_observer, 1)
    print("✅ Observer respeta scroll programático otra vez")

# Añadir el ref programmaticScrollRef
old_refs = """  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement>>({});"""

new_refs = """  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement>>({});
  const programmaticScrollRef = useRef(false);"""

if old_refs in text2:
    text2 = text2.replace(old_refs, new_refs, 1)
    print("✅ programmaticScrollRef añadido")

# Modificar changePage para usar el flag
final_change = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      onSelectionMenu?.(null);
      setCurrentPage(newPage);

      // scrollIntoView nativo es lo más confiable
      // block: 'start' lo lleva al top del scroll container
      const pageEl = pageRefs.current[newPage];
      if (pageEl) {
        pageEl.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest',
        });
      }
    },
    [pages, onSelectionMenu]
  );"""

new_final = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      onSelectionMenu?.(null);
      setCurrentPage(newPage);

      // Bloquear observer mientras hacemos scroll programático
      programmaticScrollRef.current = true;
      const pageEl = pageRefs.current[newPage];
      if (pageEl) {
        pageEl.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest',
        });
      }
      // Liberar el flag después de que el scroll termine
      setTimeout(() => {
        programmaticScrollRef.current = false;
      }, 1000);
    },
    [pages, onSelectionMenu]
  );"""

if final_change in text2:
    text2 = text2.replace(final_change, new_final, 1)
    print("✅ changePage bloquea observer durante scroll")

path.write_text(text2, encoding='utf-8')
