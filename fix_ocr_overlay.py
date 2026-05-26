import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# Añadir estado para detectar si el text layer está vacío
old_state = '''  const [resolvedMaterial, setResolvedMaterial] = useState<any>(null);
  const [resolvedPage, setResolvedPage] = useState<number>(1);
  const [resolving, setResolving] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);'''

new_state = '''  const [resolvedMaterial, setResolvedMaterial] = useState<any>(null);
  const [resolvedPage, setResolvedPage] = useState<number>(1);
  const [resolving, setResolving] = useState(true);
  const [isScanned, setIsScanned] = useState(false);
  const [highlightSuccess, setHighlightSuccess] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);'''

if old_state in text:
    text = text.replace(old_state, new_state)
    print("✅ Estado añadido")
else:
    print("❌ No encontré estado")

# Modificar highlight() para detectar PDF escaneado
old_hl = '''      if (!matchedAny) {
        console.warn('⚠️ Highlight: no se encontró el fragmento en el PDF visible');
      }
    });
  };'''

new_hl = '''      if (!matchedAny) {
        console.warn('⚠️ Highlight: no se encontró el fragmento en el PDF visible');
      } else {
        setHighlightSuccess(true);
      }
    });

    // Detectar si el PDF es escaneado (sin text layer)
    const totalSpans = Array.from(document.querySelectorAll('.react-pdf__Page__textContent span'))
      .filter(s => (s.textContent || '').trim().length > 0).length;
    if (totalSpans === 0) {
      console.log('📷 PDF escaneado detectado (sin text layer)');
      setIsScanned(true);
    }
  };'''

if old_hl in text:
    text = text.replace(old_hl, new_hl)
    print("✅ Detección de PDF escaneado")
else:
    print("❌ No encontré bloque highlight final")

# Reset al cambiar de página/material
old_effect = '''  // ── Cargar URL del PDF ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!resolvedMaterial) return;'''

new_effect = '''  // Reset highlight cuando cambia material o página
  useEffect(() => {
    setHighlightSuccess(false);
    setIsScanned(false);
  }, [resolvedMaterial, resolvedPage]);

  // ── Cargar URL del PDF ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!resolvedMaterial) return;'''

if old_effect in text:
    text = text.replace(old_effect, new_effect)
    print("✅ Reset state al cambiar página")
else:
    print("❌ No encontré effect")

# Añadir banner visual cuando es escaneado o no se encontró match
old_pdf = '''      {!resolving && pdfUrl && !error && (
                <div style={{ borderRadius: 14, overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.5)', background: '#fff' }}>
                  <Document file={pdfUrl}>
                    <Page
                      pageNumber={resolvedPage}
                      width={containerWidth}
                      onRenderTextLayerSuccess={() => {
                        // Reintentos progresivos para que el DOM del text layer esté listo
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
              )}'''

new_pdf = '''      {!resolving && pdfUrl && !error && (
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

if old_pdf in text:
    text = text.replace(old_pdf, new_pdf)
    print("✅ Banner para PDF escaneado")
else:
    print("❌ No encontré bloque PDF render")

path.write_text(text, encoding='utf-8')
