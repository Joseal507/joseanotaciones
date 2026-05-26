with open('components/materias/QuizPage.tsx', 'r', encoding='utf-8') as f:
    src = f.read()

# El problema: QuizPage pasa globalSelectedIndex y totalSelectedPages
# mezclados, y no tiene selectionSequence como flashcards.
# Fix: NO pasar globalSelectedIndex/Total al PDFViewer del quiz,
# solo pasar selectedPages, forcedPage, onRequestPrev/Next simples.
# El PDFViewer mostrará el contador correcto basado en selectedPages.

OLD_PDF_VIEWER = '''                  <PDFViewer
                    key={`${activeMaterialIndex}-${matActual?.materialId || matActual?.id || 'material'}-${pdfUrl}`}
                    url={pdfUrl}
                    themeColor={themeColor}
                    selectedPages={activeMaterialSelectedPages}
                    onTotalPages={setNumPages}
                    activeMaterialIndex={activeMaterialIndex}
                    materialesCount={materiales.length}
                    totalSelectedPages={seleccion?.reduce((acc: number, s: any) => {
                      const pages = Array.isArray(s?.paginasSeleccionadas) ? s.paginasSeleccionadas :
                                    Array.isArray(s?.pages) ? s.pages : [];
                      return acc + pages.length;
                    }, 0) ?? 0}
                    forcedPage={currentQ?.sourcePage}
                    onRequestPrev={activeMaterialIndex > 0 ? () => setActiveMaterialIndex(i => i - 1) : undefined}
                    onRequestNext={activeMaterialIndex < materiales.length - 1 ? () => setActiveMaterialIndex(i => i + 1) : undefined}
                  />'''

NEW_PDF_VIEWER = '''                  <PDFViewer
                    key={`${activeMaterialIndex}-${matActual?.materialId || matActual?.id || 'material'}-${pdfUrl}`}
                    url={pdfUrl}
                    themeColor={themeColor}
                    selectedPages={activeMaterialSelectedPages}
                    onTotalPages={setNumPages}
                    activeMaterialIndex={activeMaterialIndex}
                    materialesCount={materiales.length}
                    forcedPage={currentQ?.sourcePage}
                    onRequestPrev={activeMaterialIndex > 0 ? () => setActiveMaterialIndex(i => i - 1) : undefined}
                    onRequestNext={activeMaterialIndex < materiales.length - 1 ? () => setActiveMaterialIndex(i => i + 1) : undefined}
                  />'''

if OLD_PDF_VIEWER in src:
    src = src.replace(OLD_PDF_VIEWER, NEW_PDF_VIEWER)
    print("✅ 2. PDFViewer props limpiadas (sin totalSelectedPages/globalSelected)")
else:
    print("❌ 2. No encontré el PDFViewer — verificando...")
    if 'totalSelectedPages' in src:
        print("   totalSelectedPages sigue en el archivo")
    if 'forcedPage={currentQ?.sourcePage}' in src:
        print("   forcedPage encontrado — el viewer está ahí")

with open('components/materias/QuizPage.tsx', 'w', encoding='utf-8') as f:
    f.write(src)

print("✅ QuizPage.tsx actualizado")
