import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

old = '''  // ── Highlight ───────────────────────────────────────────────────────────────
  const onlyLetters = (s: string) =>
    norm(s).replace(/[^a-z0-9]/g, '');

  const highlight = () => {
    if (!card.sourceText) return;

    const sourceLetters = onlyLetters(card.sourceText);
    if (sourceLetters.length < 4) return;

    // Extraer palabras clave largas (raíces) del sourceText
    const sourceWords = norm(card.sourceText)
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 5);

    const layers = document.querySelectorAll('.react-pdf__Page__textContent');

    layers.forEach(layer => {
      const spans = Array.from(layer.querySelectorAll('span')) as HTMLSpanElement[];
      if (!spans.length) return;

      // ── ESTRATEGIA 1: comparar letras puras (sin espacios ni símbolos) ──
      // Construir el "letterStream" del PDF y mapear cada letra a su span
      const letterMap: { spanIdx: number }[] = [];
      let letterStream = '';
      spans.forEach((sp, idx) => {
        const t = norm(sp.textContent || '');
        for (const ch of t) {
          if (/[a-z0-9]/.test(ch)) {
            letterStream += ch;
            letterMap.push({ spanIdx: idx });
          }
        }
      });

      let matchedAny = false;

      // Buscar el sourceLetters dentro del letterStream
      let pos = letterStream.indexOf(sourceLetters);

      // Si no se encuentra entero, buscar al menos el 60% inicial
      if (pos < 0) {
        const partial = sourceLetters.slice(0, Math.max(10, Math.floor(sourceLetters.length * 0.6)));
        pos = letterStream.indexOf(partial);
      }

      if (pos >= 0) {
        const endPos = Math.min(pos + sourceLetters.length, letterStream.length);
        const spansToHL = new Set<number>();
        for (let i = pos; i < endPos; i++) {
          spansToHL.add(letterMap[i].spanIdx);
        }
        spansToHL.forEach(idx => {
          applyHL(spans[idx]);
          matchedAny = true;
        });
      }

      // ── ESTRATEGIA 2 (fallback): resaltar spans que contengan palabras clave ──
      if (!matchedAny && sourceWords.length > 0) {
        spans.forEach(span => {
          const t = norm(span.textContent || '');
          if (!t) return;
          const hasKey = sourceWords.some(w => t.includes(w) || w.includes(t));
          if (hasKey && t.length >= 3) {
            applyHL(span);
            matchedAny = true;
          }
        });
      }
    });
  };'''

new = '''  // ── Highlight ───────────────────────────────────────────────────────────────
  const onlyLetters = (s: string) =>
    norm(s).replace(/[^a-z0-9]/g, '');

  const highlight = () => {
    if (!card.sourceText) return;

    const sourceLetters = onlyLetters(card.sourceText);
    if (sourceLetters.length < 4) return;

    // Palabras clave del sourceText (>= 4 letras)
    const sourceWords = norm(card.sourceText)
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 4)
      .sort((a, b) => b.length - a.length); // más largas primero

    // Buscar en TODAS las capas de texto del PDF visible
    const layers = document.querySelectorAll('.react-pdf__Page__textContent');
    if (!layers.length) return;

    layers.forEach(layer => {
      // Limpiar highlights anteriores
      layer.querySelectorAll('span[data-hl="1"]').forEach((sp: Element) => {
        const el = sp as HTMLSpanElement;
        el.dataset.hl = '';
        el.style.background = '';
        el.style.borderRadius = '';
        el.style.mixBlendMode = '';
        el.style.outline = '';
      });

      const spans = Array.from(layer.querySelectorAll('span')).filter(
        sp => (sp as HTMLSpanElement).textContent?.trim()
      ) as HTMLSpanElement[];
      if (!spans.length) return;

      // ── ESTRATEGIA 1: stream de letras puras ──
      const letterMap: { spanIdx: number }[] = [];
      let letterStream = '';
      spans.forEach((sp, idx) => {
        const t = norm(sp.textContent || '');
        for (const ch of t) {
          if (/[a-z0-9]/.test(ch)) {
            letterStream += ch;
            letterMap.push({ spanIdx: idx });
          }
        }
      });

      let matchedAny = false;

      // Buscar coincidencia exacta
      let pos = letterStream.indexOf(sourceLetters);

      // Buscar 80% del inicio
      if (pos < 0) {
        const partial = sourceLetters.slice(0, Math.max(8, Math.floor(sourceLetters.length * 0.8)));
        pos = letterStream.indexOf(partial);
      }

      // Buscar 60% del inicio
      if (pos < 0) {
        const partial = sourceLetters.slice(0, Math.max(6, Math.floor(sourceLetters.length * 0.6)));
        pos = letterStream.indexOf(partial);
      }

      if (pos >= 0) {
        const endPos = Math.min(pos + sourceLetters.length, letterStream.length);
        const spansToHL = new Set<number>();
        for (let i = pos; i < endPos; i++) {
          spansToHL.add(letterMap[i].spanIdx);
        }
        spansToHL.forEach(idx => {
          applyHL(spans[idx]);
          matchedAny = true;
        });
      }

      // ── ESTRATEGIA 2: palabras clave ──
      if (!matchedAny && sourceWords.length > 0) {
        // Buscar spans que contengan las palabras más largas
        const topWords = sourceWords.slice(0, 5);
        spans.forEach(span => {
          const t = norm(span.textContent || '');
          if (!t || t.length < 2) return;
          const hits = topWords.filter(w => t.includes(w) || (w.length >= 6 && w.includes(t)));
          if (hits.length >= 1) {
            applyHL(span);
            matchedAny = true;
          }
        });
      }

      // ── ESTRATEGIA 3: al menos 2 palabras cortas coinciden ──
      if (!matchedAny && sourceWords.length >= 2) {
        spans.forEach(span => {
          const t = norm(span.textContent || '');
          if (!t || t.length < 2) return;
          const hits = sourceWords.filter(w => t.includes(w));
          if (hits.length >= 2) {
            applyHL(span);
            matchedAny = true;
          }
        });
      }

      if (!matchedAny) {
        console.warn('⚠️ Highlight: no se encontró el fragmento en el PDF visible');
      }
    });
  };'''

if old in text:
    text = text.replace(old, new)
    print("✅ Fix highlight: estrategias mejoradas + limpieza previa")
else:
    print("❌ No encontré bloque highlight")

# Fix applyHL: hacerlo más visible
old2 = '''  const applyHL = (span: HTMLSpanElement) => {
    if (span.dataset.hl === '1') return;
    span.dataset.hl = '1';
    span.style.background = `${color}55`;
    span.style.borderRadius = '3px';
    span.style.mixBlendMode = 'multiply';
  };'''

new2 = '''  const applyHL = (span: HTMLSpanElement) => {
    if (span.dataset.hl === '1') return;
    span.dataset.hl = '1';
    span.style.background = `${color}88`;
    span.style.borderRadius = '3px';
    span.style.outline = `1px solid ${color}99`;
    span.style.mixBlendMode = 'multiply';
  };'''

if old2 in text:
    text = text.replace(old2, new2)
    print("✅ Fix applyHL: más visible")
else:
    print("❌ No encontré applyHL")

path.write_text(text, encoding='utf-8')
