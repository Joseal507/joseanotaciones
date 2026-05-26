import pathlib

path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')
text = path.read_text(encoding='utf-8')

# ════════════════════════════════════════════════════
# FIX 1: Hacer las páginas más verticales (más altas)
# Aumentar el width hace que cada página ocupe más espacio
# ════════════════════════════════════════════════════
old_width = """              <Page
                pageNumber={pageNum}
                renderAnnotationLayer
                renderTextLayer
                width={Math.min(760, typeof window !== 'undefined' ? window.innerWidth * 0.42 : 760)}
              />"""

new_width = """              <Page
                pageNumber={pageNum}
                renderAnnotationLayer
                renderTextLayer
                width={Math.min(900, typeof window !== 'undefined' ? window.innerWidth * 0.48 : 900)}
              />"""

if old_width in text:
    text = text.replace(old_width, new_width, 1)
    print("✅ Páginas más grandes (width 900 max, 48% viewport)")
else:
    print("❌ No encontré el width de Page")

# ════════════════════════════════════════════════════
# FIX 2: changePage hace scroll suave con offset
# para que se vea un pequeño preview de la página anterior
# ════════════════════════════════════════════════════
old_change = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      setCurrentPage(newPage);
      onSelectionMenu?.(null);

      // Scrollear a la página específica en la lista vertical
      const pageEl = pageRefs.current[newPage];
      if (pageEl && scrollRef.current) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [pages, onSelectionMenu]
  );"""

new_change = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      setCurrentPage(newPage);
      onSelectionMenu?.(null);

      // Scroll suave a la página con pequeño offset arriba
      // para que se vea un pedacito de la página anterior (sensación de continuidad)
      const pageEl = pageRefs.current[newPage];
      const scrollEl = scrollRef.current;
      if (pageEl && scrollEl) {
        const offsetTop = pageEl.offsetTop - 24; // 24px de margen arriba
        scrollEl.scrollTo({
          top: offsetTop,
          behavior: 'smooth',
        });
      }
    },
    [pages, onSelectionMenu]
  );"""

if old_change in text:
    text = text.replace(old_change, new_change, 1)
    print("✅ changePage usa scrollTo con offset (deja ver bordecito de página anterior)")
else:
    print("❌ No encontré changePage")

# ════════════════════════════════════════════════════
# FIX 3: Separar más las páginas entre sí
# ════════════════════════════════════════════════════
old_margin = """                marginBottom: 4,"""
new_margin = """                marginBottom: 24,"""

if old_margin in text:
    text = text.replace(old_margin, new_margin, 1)
    print("✅ Separación entre páginas aumentada (24px)")

path.write_text(text, encoding='utf-8')
print("\n🎉 PDF Viewer mejorado:")
print("   - Páginas más grandes (más verticales)")
print("   - Scroll suave con offset al cambiar de página")
print("   - Más espacio entre páginas")
