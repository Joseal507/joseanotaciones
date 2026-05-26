import pathlib
import re

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# Reemplazar el bloque del <Page> + overlay OCR por <Page> + post-it
old = """                    <Document file={pdfUrl}>
                      <Page
                        pageNumber={resolvedPage}
                        width={containerWidth}
                        onRenderTextLayerSuccess={() => {
                        }}
                        renderAnnotationLayer={true}
                        renderTextLayer={true}
                      />
                    </Document>

                    {/* OVERLAY rectángulos amarillos del OCR Tesseract */}
                    {isScanned && ocrRects.length > 0 && ("""

new = """                    <Document file={pdfUrl}>
                      <Page
                        pageNumber={resolvedPage}
                        width={containerWidth}
                        onRenderTextLayerSuccess={() => {}}
                        renderAnnotationLayer={false}
                        renderTextLayer={false}
                      />
                    </Document>

                    {/* POST-IT flotante con el fragmento de la flashcard */}
                    {card.sourceText && (
                      <div style={{
                        position: 'absolute',
                        top: 16,
                        right: 16,
                        maxWidth: 260,
                        background: 'linear-gradient(135deg, #fff7a8 0%, #ffe066 100%)',
                        color: '#1a1a1a',
                        padding: '14px 16px',
                        borderRadius: 6,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.15)',
                        transform: 'rotate(2deg)',
                        zIndex: 10,
                        fontFamily: '"Caveat", "Marker Felt", cursive',
                        fontSize: 15,
                        lineHeight: 1.4,
                        border: '1px solid rgba(0,0,0,0.08)',
                      }}>
                        <div style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: 1,
                          color: '#8a6d00',
                          marginBottom: 6,
                          fontFamily: 'inherit',
                        }}>
                          📌 Fragmento
                        </div>
                        <div style={{
                          fontSize: 14,
                          color: '#2a2a2a',
                          fontStyle: 'italic',
                        }}>
                          "{card.sourceText}"
                        </div>
                      </div>
                    )}

                    {/* OVERLAY OCR desactivado */}
                    {false && isScanned && ocrRects.length > 0 && ("""

if old in text:
    text = text.replace(old, new)
    print("✅ Post-it añadido y overlay OCR desactivado")
else:
    print("❌ No encontré bloque exacto")

path.write_text(text, encoding='utf-8')
