import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# Verificar si ya tiene el overlay
if 'ocrRects.map' in text:
    print("⚠️ Overlay ya existe")
else:
    # Reemplazar el bloque del PDF + post-it por el nuevo con rectángulos
    old = '''                  <div style={{
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
                    </Document>'''

    new = '''                  <div ref={pageRef} style={{
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

                    {/* OVERLAY rectángulos amarillos del OCR Tesseract */}
                    {isScanned && ocrRects.length > 0 && (
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        zIndex: 5,
                      }}>
                        {ocrRects.map((r, i) => (
                          <div
                            key={i}
                            style={{
                              position: 'absolute',
                              left: r.x + '%',
                              top: r.y + '%',
                              width: r.w + '%',
                              height: r.h + '%',
                              background: color + '55',
                              border: '2px solid ' + color,
                              borderRadius: 3,
                              boxShadow: '0 0 12px ' + color + '88',
                              mixBlendMode: 'multiply',
                              animation: 'pulseHL 1.6s ease-in-out infinite',
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {/* Indicador progreso OCR */}
                    {ocrRunning && (
                      <div style={{
                        position: 'absolute',
                        top: 12, right: 12,
                        background: 'rgba(0,0,0,0.85)',
                        color: '#fff',
                        padding: '8px 14px',
                        borderRadius: 10,
                        fontSize: 12,
                        fontFamily: 'Inter, sans-serif',
                        fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 8,
                        zIndex: 20,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                      }}>
                        <div style={{
                          width: 14, height: 14,
                          border: '2px solid ' + color + '44',
                          borderTop: '2px solid ' + color,
                          borderRadius: '50%',
                          animation: 'spinHL 0.8s linear infinite',
                        }} />
                        Resaltando texto… {ocrProgress}%
                      </div>
                    )}'''

    if old in text:
        text = text.replace(old, new)
        print("✅ Overlay rectángulos añadido")
    else:
        print("❌ No encontré bloque del PDF")

    # Quitar el post-it viejo
    old_postit = '''                    {/* OVERLAY tipo "marker fluorescente" para PDFs escaneados */}
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
                    )}'''

    if old_postit in text:
        text = text.replace(old_postit, '')
        print("✅ Post-it viejo eliminado")
    else:
        print("⚠️ Post-it no encontrado (puede que ya no exista)")

    # Añadir keyframes al final del JSX antes del </div> de cierre
    if 'pulseHL' not in text or '@keyframes pulseHL' not in text:
        # Insertar style tag justo antes del cierre principal
        # Buscar el último </div> dentro del componente
        # Más simple: insertar después de la apertura del overlay principal
        old_open = "        position: 'fixed', inset: 0, zIndex: 4000,"
        new_open = "        position: 'fixed', inset: 0, zIndex: 4000,"
        # No modificamos eso. Insertamos un <style> después del primer <div onClick={onClose}
        marker = '''      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,'''
        replacement = '''      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,'''
        # En vez de modificar el div externo, insertamos el style como hijo
        # Buscamos el primer onClick={e => e.stopPropagation()} y añadimos style antes
        stop_marker = "onClick={e => e.stopPropagation()}"
        if stop_marker in text:
            text = text.replace(
                stop_marker,
                stop_marker,  # placeholder, lo metemos abajo
                1,
            )
        # Más limpio: inyectar <style jsx global> dentro del JSX
        # Buscar el primer "<div" hijo del overlay y añadir style antes
        find_str = "      <div\n        onClick={e => e.stopPropagation()}"
        inject = """      <style>{`
        @keyframes pulseHL {
          0%, 100% { opacity: 0.85; }
          50% { opacity: 1; }
        }
        @keyframes spinHL {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}"""
        if find_str in text:
            text = text.replace(find_str, inject, 1)
            print("✅ Keyframes CSS inyectados")
        else:
            print("⚠️ No encontré punto para keyframes, los añadirás manual")

    path.write_text(text, encoding='utf-8')
    print("✅ Listo")
