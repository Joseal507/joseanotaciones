import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# Reemplazar el algoritmo de búsqueda por uno basado en palabras significativas
old = """      const targetLetters = onlyLettersHelper(card.sourceText);
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
      for (let i = pos; i < endPos; i++) wordIdxSet.add(letterMap[i].wordIdx);"""

new = """      const targetLetters = onlyLettersHelper(card.sourceText);
      if (targetLetters.length < 4) { setOcrRunning(false); return; }

      const wordIdxSet = new Set<number>();

      // ── ESTRATEGIA 1: match de secuencia contigua ──
      let pos = stream.indexOf(targetLetters);
      if (pos < 0) {
        const partial = targetLetters.slice(0, Math.max(8, Math.floor(targetLetters.length * 0.7)));
        pos = stream.indexOf(partial);
      }
      if (pos < 0) {
        const partial = targetLetters.slice(0, Math.max(6, Math.floor(targetLetters.length * 0.5)));
        pos = stream.indexOf(partial);
      }

      if (pos >= 0) {
        const endPos = Math.min(pos + targetLetters.length, stream.length);
        for (let i = pos; i < endPos; i++) wordIdxSet.add(letterMap[i].wordIdx);
        console.log('✅ Match contiguo encontrado en pos', pos);
      }

      // ── ESTRATEGIA 2: match palabra-por-palabra (para texto fragmentado) ──
      if (wordIdxSet.size === 0) {
        const normLocal = (s: string) =>
          (s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');

        // Palabras significativas del sourceText (>= 3 letras, sin stopwords)
        const stopWords = new Set(['the', 'and', 'for', 'with', 'que', 'los', 'las', 'del', 'por', 'con', 'una', 'uno', 'sus', 'que']);
        const targetWords = normLocal(card.sourceText)
          .split(/[^a-z0-9]+/)
          .filter(w => w.length >= 3 && !stopWords.has(w));

        console.log('🔎 Buscando palabras:', targetWords.slice(0, 10));

        // Para cada palabra del target, buscar en las palabras OCR
        words.forEach((w: any, idx: number) => {
          const wText = normLocal(w.text || '').replace(/[^a-z0-9]/g, '');
          if (wText.length < 2) return;
          for (const tw of targetWords) {
            // Match exacto o sustring
            if (wText === tw || (tw.length >= 4 && wText.includes(tw)) || (wText.length >= 4 && tw.includes(wText))) {
              wordIdxSet.add(idx);
              break;
            }
          }
        });

        if (wordIdxSet.size > 0) {
          console.log('✅ Match palabra-por-palabra: ' + wordIdxSet.size + ' palabras');
        }
      }

      if (wordIdxSet.size === 0) {
        console.warn('⚠️ Tesseract: no encontró fragmento');
        setOcrRunning(false);
        return;
      }"""

if old in text:
    text = text.replace(old, new)
    print("✅ Algoritmo de matching mejorado (contiguo + palabra-por-palabra)")
else:
    print("❌ No encontré bloque")

path.write_text(text, encoding='utf-8')
