import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# Verificar que no esté ya
if 'runTesseractHighlight' in text:
    print("⚠️ Ya tiene runTesseractHighlight, abortando")
else:
    # Insertar la función justo antes del "const hasSource"
    old = """  const hasSource = !!card.sourceText;
  const materialName = resolvedMaterial?.nombre || resolvedMaterial?.name || '';"""

    new = """  // ── OCR Tesseract para PDFs escaneados ─────────────────────
  const runTesseractHighlight = async () => {
    if (!isScanned || !card.sourceText || !pageRef.current) return;

    const matId = resolvedMaterial?.materialId || resolvedMaterial?.id || 'x';
    const cacheKey = matId + '_p' + resolvedPage + '_' + onlyLetters(card.sourceText).slice(0, 50);

    const canvas = pageRef.current.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      console.warn('⚠️ No hay canvas para OCR');
      return;
    }

    const cached = ocrCache.get(cacheKey);
    if (cached) {
      console.log('✅ OCR desde cache');
      setOcrRects(cached);
      setHighlightSuccess(true);
      return;
    }

    setOcrRunning(true);
    setOcrProgress(0);

    try {
      const Tesseract = (await import('tesseract.js')).default;
      console.log('🔍 Tesseract iniciado…');

      const result = await Tesseract.recognize(canvas, 'spa+eng', {
        logger: (m: any) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            setOcrProgress(Math.round(m.progress * 100));
          }
        },
      });

      const words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[] =
        (result.data as any).words || [];
      console.log('📝 ' + words.length + ' palabras detectadas');

      if (!words.length) { setOcrRunning(false); return; }

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
      if (targetLetters.length < 4) { setOcrRunning(false); return; }

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
        console.warn('⚠️ Tesseract: no encontró fragmento');
        setOcrRunning(false);
        return;
      }

      const endPos = Math.min(pos + targetLetters.length, stream.length);
      const wordIdxSet = new Set<number>();
      for (let i = pos; i < endPos; i++) wordIdxSet.add(letterMap[i].wordIdx);

      const cw = canvas.width;
      const ch = canvas.height;
      const matchedWords = Array.from(wordIdxSet).sort((a, b) => a - b).map(i => words[i]).filter(Boolean);

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

      const rects: { x: number; y: number; w: number; h: number }[] = [];
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

      console.log('✅ Tesseract: ' + rects.length + ' líneas resaltadas');
      ocrCache.set(cacheKey, rects);
      setOcrRects(rects);
      setHighlightSuccess(true);
    } catch (e) {
      console.error('Error Tesseract:', e);
    } finally {
      setOcrRunning(false);
    }
  };

  const hasSource = !!card.sourceText;
  const materialName = resolvedMaterial?.nombre || resolvedMaterial?.name || '';"""

    if old in text:
        text = text.replace(old, new)
        print("✅ Función runTesseractHighlight añadida")
    else:
        print("❌ No encontré punto de inserción")

    path.write_text(text, encoding='utf-8')
