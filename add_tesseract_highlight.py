import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# 1) Añadir import dinámico de Tesseract y estado para bboxes
old_imports = "import { supabase } from '../../lib/supabase';"
new_imports = """import { supabase } from '../../lib/supabase';

// Cache global de OCR para no re-procesar la misma página
const ocrCache = new Map<string, { x: number; y: number; w: number; h: number }[]>();
"""

if old_imports in text:
    text = text.replace(old_imports, new_imports)
    print("✅ Imports + cache añadidos")
else:
    print("❌ Falló import")

# 2) Añadir estado para los rectángulos del OCR
old_state = """  const [resolvedMaterial, setResolvedMaterial] = useState<any>(null);
  const [resolvedPage, setResolvedPage] = useState<number>(1);
  const [resolving, setResolving] = useState(true);
  const [isScanned, setIsScanned] = useState(false);
  const [highlightSuccess, setHighlightSuccess] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);"""

new_state = """  const [resolvedMaterial, setResolvedMaterial] = useState<any>(null);
  const [resolvedPage, setResolvedPage] = useState<number>(1);
  const [resolving, setResolving] = useState(true);
  const [isScanned, setIsScanned] = useState(false);
  const [highlightSuccess, setHighlightSuccess] = useState(false);
  const [ocrRects, setOcrRects] = useState<{ x: number; y: number; w: number; h: number }[]>([]);
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [ocrRunning, setOcrRunning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);"""

if old_state in text:
    text = text.replace(old_state, new_state)
    print("✅ Estado para OCR añadido")
else:
    print("❌ Falló estado")

# 3) Añadir función de OCR + match (justo antes del return)
# Buscar el punto donde empieza el JSX (después de "const materialName = ...")
old_marker = """  const hasSource = !!card.sourceText;
  const materialName = resolvedMaterial?.nombre || resolvedMaterial?.name || '';"""

new_marker = """  const hasSource = !!card.sourceText;
  const materialName = resolvedMaterial?.nombre || resolvedMaterial?.name || '';

  // ── OCR en cliente para PDFs escaneados ────────────────────────────────────
  const runTesseractHighlight = async () => {
    if (!isScanned || !card.sourceText || !pageRef.current) return;

    const matId = resolvedMaterial?.materialId || resolvedMaterial?.id || 'unknown';
    const cacheKey = `${matId}_p${resolvedPage}_${onlyLetters(card.sourceText).slice(0, 50)}`;

    // Buscar canvas renderizado por react-pdf
    const canvas = pageRef.current.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      console.warn('⚠️ No se encontró canvas para OCR');
      return;
    }

    // Check cache
    const cached = ocrCache.get(cacheKey);
    if (cached) {
      console.log('✅ OCR desde cache');
      setOcrRects(cached);
      return;
    }

    setOcrRunning(true);
    setOcrProgress(0);

    try {
      const Tesseract = (await import('tesseract.js')).default;
      console.log('🔍 OCR con Tesseract iniciado...');

      const result = await Tesseract.recognize(canvas, 'spa+eng', {
        logger: (m: any) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            setOcrProgress(Math.round(m.progress * 100));
          }
        },
      });

      const words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[] =
        (result.data as any).words || [];

      console.log(`📝 OCR detectó ${words.length} palabras`);

      if (!words.length) {
        setOcrRunning(false);
        return;
      }

      // Construir stream de letras + mapa a palabras
      const letterMap: { wordIdx: number }[] = [];
      let stream = '';
      words.forEach((w, idx) => {
        const t = norm(w.text || '');
        for (const ch of t) {
          if (/[a-z0-9]/.test(ch)) {
            stream += ch;
            letterMap.push({ wordIdx: idx });
          }
        }
      });

      const targetLetters = onlyLetters(card.sourceText);
      if (targetLetters.length < 4) {
        setOcrRunning(false);
        return;
      }

      // Buscar match
      let pos = stream.indexOf(targetLetters);
      if (pos < 0) {
        const partial = targetLetters.slice(0, Math.max(8, Math.floor(targetLetters.length * 0.7)));
        pos = stream.indexOf(partial);
      }
      if (pos < 0) {
        const partial = targetLetters.slice(0, Math.max(6, Math.floor(targetLetters.length * 0.5)));
        pos = stream.indexOf(partial);
      }

      if (pos < 0) {
        console.warn('⚠️ Tesseract: no encontró el fragmento');
        setOcrRunning(false);
        return;
      }

      const endPos = Math.min(pos + targetLetters.length, stream.length);
      const wordIdxSet = new Set<number>();
      for (let i = pos; i < endPos; i++) {
        wordIdxSet.add(letterMap[i].wordIdx);
      }

      // Calcular rectángulos relativos al canvas
      const cw = canvas.width;
      const ch = canvas.height;
      const rects: { x: number; y: number; w: number; h: number }[] = [];

      // Agrupar palabras por línea (mismo y aproximado)
      const matchedWords = Array.from(wordIdxSet)
        .sort((a, b) => a - b)
        .map(i => words[i])
        .filter(Boolean);

      const lineGroups: typeof matchedWords[] = [];
      let currentLine: typeof matchedWords = [];
      let lastY = -999;

      for (const w of matchedWords) {
        const y = w.bbox.y0;
        if (Math.abs(y - lastY) > 15 && currentLine.length) {
          lineGroups.push(currentLine);
          currentLine = [];
        }
        currentLine.push(w);
        lastY = y;
      }
      if (currentLine.length) lineGroups.push(currentLine);

      // Un rect por línea
      for (const line of lineGroups) {
        const x0 = Math.min(...line.map(w => w.bbox.x0));
        const y0 = Math.min(...line.map(w => w.bbox.y0));
        const x1 = Math.max(...line.map(w => w.bbox.x1));
        const y1 = Math.max(...line.map(w => w.bbox.y1));
        rects.push({
          x: (x0 / cw) * 100,
          y: (y0 / ch) * 100,
          w: ((x1 - x0) / cw) * 100,
          h: ((y1 - y0) / ch) * 100,
        });
      }

      console.log(`✅ Tesseract match: ${rects.length} líneas resaltadas`);
      ocrCache.set(cacheKey, rects);
      setOcrRects(rects);
      setHighlightSuccess(true);
    } catch (e) {
      console.error('Error en Tesseract:', e);
    } finally {
      setOcrRunning(false);
    }
  };"""

if old_marker in text:
    text = text.replace(old_marker, new_marker)
    print("✅ Función runTesseractHighlight añadida")
else:
    print("❌ Falló función")

# 4) Reset de ocrRects cuando cambia página
old_reset = """  // Reset highlight cuando cambia material o página
  useEffect(() => {
    setHighlightSuccess(false);
    setIsScanned(false);
  }, [resolvedMaterial, resolvedPage]);"""

new_reset = """  // Reset highlight cuando cambia material o página
  useEffect(() => {
    setHighlightSuccess(false);
    setIsScanned(false);
    setOcrRects([]);
    setOcrProgress(0);
  }, [resolvedMaterial, resolvedPage]);

  // Disparar Tesseract cuando detectamos PDF escaneado
  useEffect(() => {
    if (isScanned && card.sourceText && !ocrRects.length && !ocrRunning) {
      // Pequeño delay para asegurar que el canvas esté listo
      const timer = setTimeout(() => runTesseractHighlight(), 400);
      return () => clearTimeout(timer);
    }
  }, [isScanned, resolvedPage, card.sourceText]);"""

if old_reset in text:
    text = text.replace(old_reset, new_reset)
    print("✅ Reset + trigger Tesseract añadido")
else:
    print("❌ Falló reset")

# 5) Reemplazar el bloque del post-it por overlay de rectángulos amarillos
old_pdf = """                  <div style={{
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
                        fontFamily: \"'Caveat', cursive\",
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
                          \"{card.sourceText}\"
                        </div>
                      </div>
                    )}
                  </div>"""

new_pdf = """                  <div ref={pageRef} style={{
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

                    {/* OVERLAY: rectángulos amarillos del OCR Tesseract */}
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
                              left: `${r.x}%`,
                              top: `${r.y}%`,
                              width: `${r.w}%`,
                              height: `${r.h}%`,
                              background: `${color}66`,
                              border: `2px solid ${color}`,
                              borderRadius: 3,
                              boxShadow: `0 0 12px ${color}88, 0 0 0 1px rgba(255,255,255,0.4)`,
                              mixBlendMode: 'multiply',
                              animation: 'pulseHL 1.4s ease-in-out infinite',
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {/* Indicador de progreso OCR */}
                    {ocrRunning && (
                      <div style={{
                        position: 'absolute',
                        top: 12,
                        right: 12,
                        background: 'rgba(0,0,0,0.85)',
                        color: '#fff',
                        padding: '8px 14px',
                        borderRadius: 10,
                        fontSize: 12,
                        fontFamily: 'Inter, sans-serif',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        zIndex: 20,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                      }}>
                        <div style={{
                          width: 14, height: 14,
                          border: `2px solid ${color}44`,
                          borderTop: `2px solid ${color}`,
                          borderRadius: '50%',
                          animation: 'spin 0.8s linear infinite',
                        }} />
                        Resaltando texto… {ocrProgress}%
                      </div>
                    )}
                  </div>"""

if old_pdf in text:
    text = text.replace(old_pdf, new_pdf)
    print("✅ Overlay de rectángulos amarillos añadido")
else:
    print("❌ Falló overlay")

# 6) Añadir animaciones CSS (en el style global del componente)
# Buscar el <style> existente si lo hay, o añadir al final del JSX
if 'pulseHL' not in text:
    # Buscar el cierre principal antes del último </div>
    old_close = """  return (
    <div
      onClick={onClose}"""
    new_close = """  // CSS de animaciones
  const styleTag = (
    <style>{`
      @keyframes pulseHL {
        0%, 100% { opacity: 0.85; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.01); }
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  );

  return (
    <div
      onClick={onClose}"""

    if old_close in text:
        text = text.replace(old_close, new_close)
        # Insertar styleTag dentro del primer div
        text = text.replace(
            'onClick={e => e.stopPropagation()}',
            '{styleTag}\n      ',
            1,
        )
        # Esto es feo, mejor lo metemos justo antes del return final
        # Restauramos
        text = text.replace('{styleTag}\n      ', 'onClick={e => e.stopPropagation()}', 1)
        # Inyectar el style después del onClick={onClose}
        text = text.replace(
            'onClick={onClose}\n      style={{\n        position: \\'fixed\\', inset: 0, zIndex: 4000,',
            'onClick={onClose}\n      style={{\n        position: \\'fixed\\', inset: 0, zIndex: 4000,',
            1,
        )
        print("✅ Animaciones CSS añadidas")

path.write_text(text, encoding='utf-8')
print("\\n📦 Listo. Reinicia el dev server.")
