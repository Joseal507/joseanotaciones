import pathlib

page_path = pathlib.Path('components/materias/FlashcardsPage.tsx')
viewer_path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')

page_text = page_path.read_text(encoding='utf-8')
viewer_text = viewer_path.read_text(encoding='utf-8')

# =========================
# 1) VIEWER: agregar prop onPageChange
# =========================

old_interface = """  onRequestPrev?: () => void;
  onRequestNext?: () => void;
}"""

new_interface = """  onRequestPrev?: () => void;
  onRequestNext?: () => void;
  onPageChange?: (page: number) => void;
}"""

if old_interface in viewer_text and "onPageChange?: (page: number) => void;" not in viewer_text:
    viewer_text = viewer_text.replace(old_interface, new_interface, 1)
    print("✅ Viewer props: añadido onPageChange")

old_destructure = """  globalSelectedIndex,
  globalSelectedTotal,
  onRequestPrev,
  onRequestNext,
}: Props) {"""

new_destructure = """  globalSelectedIndex,
  globalSelectedTotal,
  onRequestPrev,
  onRequestNext,
  onPageChange,
}: Props) {"""

if old_destructure in viewer_text and "onPageChange," not in viewer_text:
    viewer_text = viewer_text.replace(old_destructure, new_destructure, 1)
    print("✅ Viewer destructuring: añadido onPageChange")

insert_after_effect = """  }, [forcedPage, normalizedSelectedPages, numPages]);

  const handleLoad = ({ numPages: total }: { numPages: number }) => {"""

new_after_effect = """  }, [forcedPage, normalizedSelectedPages, numPages]);

  useEffect(() => {
    if (currentPage > 0) {
      onPageChange?.(currentPage);
    }
  }, [currentPage, onPageChange]);

  const handleLoad = ({ numPages: total }: { numPages: number }) => {"""

if insert_after_effect in viewer_text and "onPageChange?.(currentPage);" not in viewer_text:
    viewer_text = viewer_text.replace(insert_after_effect, new_after_effect, 1)
    print("✅ Viewer: notifica currentPage al padre")

viewer_path.write_text(viewer_text, encoding='utf-8')


# =========================
# 2) PAGE: sync del cursor global con página visible
# =========================

anchor = """  const currentGlobalEntry = selectionSequence[globalSelectedCursor] || null;

  const goToGlobalSelection = useCallback((nextIndex: number) => {"""

insert_sync = """  const currentGlobalEntry = selectionSequence[globalSelectedCursor] || null;

  const syncGlobalCursorFromPage = useCallback((page: number) => {
    if (!selectionSequence.length) return;

    const idx = selectionSequence.findIndex(
      item => item.materialIndex === activeMaterialIndex && item.page === page
    );

    if (idx < 0) return;

    globalSelectedCursorRef.current = idx;
    setGlobalSelectedCursor(prev => (prev === idx ? prev : idx));
  }, [selectionSequence, activeMaterialIndex]);

  const goToGlobalSelection = useCallback((nextIndex: number) => {"""

if anchor in page_text and "const syncGlobalCursorFromPage = useCallback((page: number) => {" not in page_text:
    page_text = page_text.replace(anchor, insert_sync, 1)
    print("✅ Page: añadida syncGlobalCursorFromPage")

old_viewer_props = """                  globalSelectedIndex={selectionSequence.length > 0 ? globalSelectedCursor : undefined}
                  globalSelectedTotal={selectionSequence.length > 0 ? totalSelectedPages : undefined}
                  onRequestPrev={selectionSequence.length > 0 ? goToPrev : undefined}
                  onRequestNext={selectionSequence.length > 0 ? goToNext : undefined}"""

new_viewer_props = """                  globalSelectedIndex={selectionSequence.length > 0 ? globalSelectedCursor : undefined}
                  globalSelectedTotal={selectionSequence.length > 0 ? totalSelectedPages : undefined}
                  onRequestPrev={selectionSequence.length > 0 ? goToPrev : undefined}
                  onRequestNext={selectionSequence.length > 0 ? goToNext : undefined}
                  onPageChange={selectionSequence.length > 0 ? syncGlobalCursorFromPage : undefined}"""

if old_viewer_props in page_text and "onPageChange={selectionSequence.length > 0 ? syncGlobalCursorFromPage : undefined}" not in page_text:
    page_text = page_text.replace(old_viewer_props, new_viewer_props, 1)
    print("✅ Page: pasa onPageChange al viewer")

page_path.write_text(page_text, encoding='utf-8')

print("\\n🎉 Fix aplicado")
print("Ahora el padre sincroniza globalSelectedCursor con la página visible actual.")
print("Así, al estar en la última página del material 1 y dar Siguiente, saltará al primer page del material 2.")
