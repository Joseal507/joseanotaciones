import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# Reemplazar el bloque del PDF para añadir overlay tipo "marker" en PDFs escaneados
old = '''      {!resolving && pdfUrl && !error && (
                <>
                  {/* Banner cuando es PDF escaneado o no se encontró match */}
                  {(isScanned || !highlightSuccess) && (
                    <div style={{
                      width: '100%', maxWidth: containerWidth,
                      background: 'rgba(251,191,36,0.08)',
                      border: '1.5px dashed rgba(251,191,36,0.4)',
                      borderRadius: 12,
                      padding: '10px 14px',
                      marginBottom: -4,
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <span style={{ fontSize: 18 }}>{isScanned ? '📷' : '🔍'}</span>
                      <div style={{
                        flex: 1,
                        color: '#fbbf24',
                        fontSize: 13,
                        fontFamily: 'Inter, sans-serif',
                        lineHeight: 1.4,
                      }}>
                        {isScanned
                          ? <>Este PDF es escaneado o no tiene capa de texto seleccionable. El fragmento citado se muestra arriba en el recuadro. Ubícalo manualmente en la página {resolvedPage}.</>
                          : <>No se pudo resaltar automáticamente el fragmento en el PDF. Búscalo en la página {resolvedPage}.</>}
                      </div>
                    </div>
                  )}
                  <div style={{ borderRadius: 14, overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.5)', background: '#fff' }}>
                    <Document file={pdfUrl}>
                      <Page
                        pageNumber={resolvedPage}
                        width={containerWidth}
                        onRenderTextLayerSuccess={() => {
                          setTimeout(highlight, 200);
                          setTimeout(highlight, 600);
                          setTimeout(highlight, 1200);
                          setTimeout(highlight, 2500);
                        }}
                        renderAnnotationLayer={true}
                        renderTextLayer={true}
                      />
                    </Document>
                  </div>
                </>
              )}'''

new = '''      {!resolving && pdfUrl && !error && (
                <>
                  {/* Banner SOLO si no se encontró match en text-layer */}
                  {!highlightSuccess && !isScanned && (
                    <div style={{
                      width: '100%', maxWidth: containerWidth,
                      background: 'rgba(251,191,36,0.08)',
                      border: '1.5px dashed rgba(251,191,36,0.4)',
                      borderRadius: 12,
                      padding: '10px 14px',
                      marginBottom: -4,
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <span style={{ fontSize: 18 }}>🔍</span>
                      <div style={{
                        flex: 1,
                        color: '#fbbf24',
                        fontSize: 13,
                        fontFamily: 'Inter, sans-serif',
                        lineHeight: 1.4,
                      }}>
                        No se pudo resaltar automáticamente. Búscalo en la página {resolvedPage}.
                      </div>
                    </div>
                  )}

                  <div style={{
                    position: 'relative',
                    borderRadius: 14,
                    overflow: 'hidden',
                    boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                    background: '#fff',
                  }}>
                    <Document file={pdfUrl}>
                      <Page
                        pageNumber={resolvedPage}
                        width={containerWidth}
                        onRenderTextLayerSuccess={() => {
                          setTimeout(highlight, 200);
                          setTimeout(highlight, 600);
                          setTimeout(highlight, 1200);
                          setTimeout(highlight, 2500);
                        }}
                        renderAnnotationLayer={true}
                        renderTextLayer={true}
                      />
                    </Document>

                    {/* OVERLAY tipo "marker fluorescente" para PDFs escaneados */}
                    {isScanned && card.sourceText && (
                      <div style={{
                        position: 'absolute',
                        bottom: 16,
                        left: 16,
                        right: 16,
                        background: `linear-gradient(135deg, ${color}f5, ${color}e0)`,
                        color: '#000',
                        padding: '14px 18px',
                        borderRadius: 10,
                        boxShadow: `0 8px 32px ${color}88, 0 0 0 3px ${color}66, 0 0 0 6px rgba(255,255,255,0.4)`,
                        fontFamily: "'Caveat', cursive",
                        fontSize: 18,
                        fontWeight: 700,
                        lineHeight: 1.4,
                        transform: 'rotate(-0.5deg)',
                        maxHeight: '40%',
                        overflow: 'auto',
                        zIndex: 10,
                      }}>
                        <div style={{
                          fontSize: 11,
                          fontFamily: 'Inter, sans-serif',
                          fontWeight: 800,
                          letterSpacing: 1.2,
                          textTransform: 'uppercase',
                          opacity: 0.7,
                          marginBottom: 6,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}>
                          🖍️ Fragmento citado · PDF escaneado · pág. {resolvedPage}
                        </div>
                        <div style={{ fontStyle: 'italic' }}>
                          "{card.sourceText}"
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}'''

if old in text:
    text = text.replace(old, new)
    print("✅ Overlay marker fluorescente para PDFs escaneados")
else:
    print("❌ No encontré el bloque PDF")

path.write_text(text, encoding='utf-8')
