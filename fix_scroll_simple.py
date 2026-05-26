import pathlib

path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')
text = path.read_text(encoding='utf-8')

# FIX: Usar scrollIntoView que es nativo y siempre funciona bien
# + manualmente compensar el padding del scroll container

old_change = """  const changePage = useCallback(
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

new_change = """  const changePage = useCallback(
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

if old_change in text:
    text = text.replace(old_change, new_change, 1)
    path.write_text(text, encoding='utf-8')
    print("✅ changePage usa scrollBy con diferencia exacta")
else:
    print("❌ No encontré changePage")

# También quitar el padding-top del scroll container que está causando el offset visual
# El padding: 16 del scroll container hace que cuando scrolleas a offsetTop=0
# todavía haya 16px de padding visible. Necesitamos quitarlo del top
old_padding = """      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
        }}
      >"""

new_padding = """      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '0 16px',
          paddingTop: 8,
          paddingBottom: 16,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
        }}
      >"""

text2 = path.read_text(encoding='utf-8')
if old_padding in text2:
    text2 = text2.replace(old_padding, new_padding, 1)
    path.write_text(text2, encoding='utf-8')
    print("✅ Padding del scroll container reducido en top (8px)")

print("\n🎉 Scroll preciso:")
print("   - scrollBy con diferencia exacta entre página y viewport")
print("   - Padding-top reducido a 8px")
