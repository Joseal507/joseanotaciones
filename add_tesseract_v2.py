import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# Verificar si ya está aplicado
if 'ocrCache' in text:
    print("⚠️ Ya tiene partes aplicadas, abortando para no duplicar")
    print("Si quieres reaplicar, restaura el archivo desde git primero")
else:
    # 1) Cache global después del último import
    old_imports = "import { supabase } from '../../lib/supabase';"
    new_imports = """import { supabase } from '../../lib/supabase';

// Cache global de OCR
const ocrCache = new Map<string, { x: number; y: number; w: number; h: number }[]>();"""

    if old_imports in text:
        text = text.replace(old_imports, new_imports)
        print("✅ Cache añadido")

    # 2) Estado nuevo
    old_state = """  const [highlightSuccess, setHighlightSuccess] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);"""
    new_state = """  const [highlightSuccess, setHighlightSuccess] = useState(false);
  const [ocrRects, setOcrRects] = useState<{ x: number; y: number; w: number; h: number }[]>([]);
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [ocrRunning, setOcrRunning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);"""

    if old_state in text:
        text = text.replace(old_state, new_state)
        print("✅ Estado añadido")

    # 3) Reset al cambiar página
    old_reset = """  useEffect(() => {
    setHighlightSuccess(false);
    setIsScanned(false);
  }, [resolvedMaterial, resolvedPage]);"""

    new_reset = """  useEffect(() => {
    setHighlightSuccess(false);
    setIsScanned(false);
    setOcrRects([]);
    setOcrProgress(0);
  }, [resolvedMaterial, resolvedPage]);

  useEffect(() => {
    if (isScanned && card.sourceText && !ocrRects.length && !ocrRunning) {
      const timer = setTimeout(() => { runTesseractHighlight(); }, 500);
      return () => clearTimeout(timer);
    }
  }, [isScanned, resolvedPage, card.sourceText]);"""

    if old_reset in text:
        text = text.replace(old_reset, new_reset)
        print("✅ Reset + trigger")

    path.write_text(text, encoding='utf-8')
    print("✅ Parte 1 lista")
