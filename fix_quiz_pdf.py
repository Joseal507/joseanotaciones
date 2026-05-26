with open('components/materias/QuizPage.tsx', 'r', encoding='utf-8') as f:
    src = f.read()

# ══════════════════════════════════════════════════════════════
# 1. Agregar pdfLoading state junto a pdfUrl
# ══════════════════════════════════════════════════════════════
OLD_PDF_STATE = '''  const [pdfUrl, setPdfUrl]                   = useState<string | null>(null);
  const [numPages, setNumPages]               = useState(0);
  const [activeMaterialIndex, setActiveMaterialIndex] = useState(0);'''

NEW_PDF_STATE = '''  const [pdfUrl, setPdfUrl]                   = useState<string | null>(null);
  const [pdfLoading, setPdfLoading]           = useState(true);
  const [numPages, setNumPages]               = useState(0);
  const [activeMaterialIndex, setActiveMaterialIndex] = useState(0);'''

if OLD_PDF_STATE in src:
    src = src.replace(OLD_PDF_STATE, NEW_PDF_STATE)
    print("✅ 1. pdfLoading state agregado")
else:
    print("❌ 1. No encontré el state de pdfUrl")

# ══════════════════════════════════════════════════════════════
# 2. Reemplazar el useEffect de carga de PDF para incluir pdfLoading
#    (igual que FlashcardsPage)
# ══════════════════════════════════════════════════════════════
OLD_LOAD_EFFECT = '''  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setPdfUrl(null);

    const loadUrl = async () => {
      if (!matActual) return;
      // URL directa
      if (matActual.url && typeof matActual.url === 'string' && matActual.url.startsWith('http')) {
        if (!cancelled) setPdfUrl(matActual.url);
        return;
      }
      // Blob local
      if (matActual.archivo instanceof File) {
        objectUrl = URL.createObjectURL(matActual.archivo);
        if (!cancelled) setPdfUrl(objectUrl);
        return;
      }
      // Descargar desde R2
      const matId = matActual.materialId || matActual.id;
      if (matId) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch(`/api/materials/${matId}/download-url`, {
            headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
          });
          const data = await res.json();
          if (!cancelled && data?.url) setPdfUrl(data.url);
        } catch (e) { console.error('Error cargando PDF:', e); }
      }
    };
    loadUrl();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [matActual]);'''

NEW_LOAD_EFFECT = '''  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setPdfLoading(true);
    setPdfUrl(null);

    const loadUrl = async () => {
      if (!matActual) { setPdfLoading(false); return; }
      // URL directa
      if (matActual.url && typeof matActual.url === 'string' && matActual.url.startsWith('http')) {
        if (!cancelled) { setPdfUrl(matActual.url); setPdfLoading(false); }
        return;
      }
      // Blob local
      if (matActual.archivo instanceof File) {
        objectUrl = URL.createObjectURL(matActual.archivo);
        if (!cancelled) { setPdfUrl(objectUrl); setPdfLoading(false); }
        return;
      }
      // Descargar desde R2
      const matId = matActual.materialId || matActual.id;
      if (matId) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch(`/api/materials/${matId}/download-url`, {
            headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
          });
          const data = await res.json();
          if (!cancelled && data?.url) setPdfUrl(data.url);
        } catch (e) { console.error('Error cargando PDF:', e); }
        finally { if (!cancelled) setPdfLoading(false); }
      } else if (!cancelled) setPdfLoading(false);
    };
    loadUrl();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [matActual]);'''

if OLD_LOAD_EFFECT in src:
    src = src.replace(OLD_LOAD_EFFECT, NEW_LOAD_EFFECT)
    print("✅ 2. useEffect de PDF actualizado con pdfLoading")
else:
    print("❌ 2. No encontré el useEffect de carga de PDF")

# ══════════════════════════════════════════════════════════════
# 3. Reemplazar la condición del panel PDF y el PDFViewer
#    para mostrar spinner mientras carga (igual que FlashcardsPage)
# ══════════════════════════════════════════════════════════════
OLD_PDF_PANEL = '''        {/* PDF lado izquierdo — multi-material igual que FlashcardsPage */}
        <AnimatePresence>
          {quizState === 'playing' && pdfUrl && (
            <motion.div
              key="pdf"
              initial={{ x: -280, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -280, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 160, damping: 22 }}
              style={{
                flex: '0 0 42%',
                maxWidth: 620,
                borderRight: '1px solid rgba(255,255,255,0.06)',
                background: '#000',
                overflow: 'hidden',
                position: 'relative',
                zIndex: 2,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* Selector de material si hay más de uno */}
              {materiales.length > 1 && (
                <div style={{
                  display: 'flex',
                  gap: 6,
                  padding: '8px 12px',
                  background: 'rgba(0,0,0,0.6)',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                  flexWrap: 'wrap',
                }}>
                  {materiales.map((mat: any, idx: number) => (
                    <button
                      key={mat.materialId || mat.id || idx}
                      onClick={() => setActiveMaterialIndex(idx)}
                      style={{
                        padding: '4px 12px',
                        borderRadius: 8,
                        border: `1.5px solid ${activeMaterialIndex === idx ? themeColor : 'rgba(255,255,255,0.15)'}`,
                        background: activeMaterialIndex === idx ? `${themeColor}22` : 'transparent',
                        color: activeMaterialIndex === idx ? themeColor : '#888',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: "'Inter', sans-serif",
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 160,
                      }}
                    >
                      {idx + 1}. {mat.nombre || mat.name || `Material ${idx + 1}`}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <PDFViewer
                  key={`${activeMaterialIndex}-${pdfUrl}`}
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
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>'''

NEW_PDF_PANEL = '''        {/* PDF lado izquierdo — multi-material igual que FlashcardsPage */}
        <AnimatePresence>
          {quizState === 'playing' && (
            <motion.div
              key="pdf"
              initial={{ x: -280, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -280, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 160, damping: 22 }}
              style={{
                flex: '0 0 42%',
                maxWidth: 620,
                borderRight: '1px solid rgba(255,255,255,0.06)',
                background: '#000',
                overflow: 'hidden',
                position: 'relative',
                zIndex: 2,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* Selector de material si hay más de uno */}
              {materiales.length > 1 && (
                <div style={{
                  display: 'flex',
                  gap: 6,
                  padding: '8px 12px',
                  background: 'rgba(0,0,0,0.6)',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                  flexWrap: 'wrap',
                }}>
                  {materiales.map((mat: any, idx: number) => (
                    <button
                      key={mat.materialId || mat.id || idx}
                      onClick={() => setActiveMaterialIndex(idx)}
                      style={{
                        padding: '4px 12px',
                        borderRadius: 8,
                        border: `1.5px solid ${activeMaterialIndex === idx ? themeColor : 'rgba(255,255,255,0.15)'}`,
                        background: activeMaterialIndex === idx ? `${themeColor}22` : 'transparent',
                        color: activeMaterialIndex === idx ? themeColor : '#888',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: "'Inter', sans-serif",
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 160,
                      }}
                    >
                      {idx + 1}. {mat.nombre || mat.name || `Material ${idx + 1}`}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {pdfLoading ? (
                  <div style={{
                    flex: 1, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 12, color: '#555',
                  }}>
                    <div style={{
                      width: 32, height: 32,
                      border: `3px solid ${themeColor}33`,
                      borderTop: `3px solid ${themeColor}`,
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }} />
                    <div style={{ fontSize: 14, fontFamily: BODY, fontStyle: 'italic' }}>Cargando PDF...</div>
                  </div>
                ) : pdfUrl ? (
                  <PDFViewer
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
                  />
                ) : (
                  <div style={{
                    flex: 1, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 12, color: '#555',
                  }}>
                    <div style={{ fontSize: 36 }}>📄</div>
                    <div style={{ fontSize: 14, fontFamily: BODY, fontStyle: 'italic' }}>No se pudo cargar el material</div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>'''

if OLD_PDF_PANEL in src:
    src = src.replace(OLD_PDF_PANEL, NEW_PDF_PANEL)
    print("✅ 3. Panel PDF actualizado con spinner y lógica igual a FlashcardsPage")
else:
    print("❌ 3. No encontré el panel PDF — buscando fragmento clave...")
    if 'quizState === \'playing\' && pdfUrl &&' in src:
        print("   Encontré la condición vieja: quizState === 'playing' && pdfUrl &&")
    if 'quizState === \'playing\' && (' in src:
        print("   Ya tiene la condición nueva")

with open('components/materias/QuizPage.tsx', 'w', encoding='utf-8') as f:
    f.write(src)

print("\n📋 Verificación:")
