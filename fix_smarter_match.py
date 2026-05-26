import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# 1) Mejorar el matching: solo resaltar si al menos 50% de palabras significativas matchean
#    Y agruparlas por cercanía
old = """      // ── ESTRATEGIA 2: match palabra-por-palabra (para texto fragmentado) ──
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
      }"""

new = """      // ── ESTRATEGIA 2: buscar grupo de palabras consecutivas en orden ──
      if (wordIdxSet.size === 0) {
        const normLocal = (s: string) =>
          (s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');

        // Stopwords + palabras muy cortas
        const stopWords = new Set([
          'the', 'and', 'for', 'with', 'que', 'los', 'las', 'del', 'por', 'con',
          'una', 'uno', 'sus', 'sin', 'son', 'sea', 'fue', 'han', 'has', 'que',
          'their', 'this', 'that', 'esta', 'ese', 'esa', 'como', 'pero',
        ]);
        // Solo palabras de >=4 letras y que no sean números puros cortos
        const targetWords = normLocal(card.sourceText)
          .split(/[^a-z0-9]+/)
          .filter(w => {
            if (w.length < 4) return false;
            if (stopWords.has(w)) return false;
            if (/^\\d+$/.test(w) && w.length < 5) return false; // descartar números <5 dígitos
            return true;
          });

        console.log('🔎 Palabras significativas del fragmento:', targetWords);

        if (targetWords.length === 0) {
          console.warn('⚠️ No hay palabras significativas');
          setOcrRunning(false);
          return;
        }

        // Mapear cada palabra OCR a sus matches con el target
        const wordMatches: { idx: number; matchedTargets: Set<string> }[] = [];
        words.forEach((w: any, idx: number) => {
          const wText = normLocal(w.text || '').replace(/[^a-z0-9]/g, '');
          if (wText.length < 3) return;
          const matched = new Set<string>();
          for (const tw of targetWords) {
            if (wText === tw) { matched.add(tw); continue; }
            if (tw.length >= 5 && wText.length >= 4 && (wText.includes(tw) || tw.includes(wText))) {
              matched.add(tw);
            }
          }
          if (matched.size > 0) {
            wordMatches.push({ idx, matchedTargets: matched });
          }
        });

        console.log('🎯 Palabras OCR que matchean:', wordMatches.length);

        if (wordMatches.length === 0) {
          console.warn('⚠️ Sin matches');
          setOcrRunning(false);
          return;
        }

        // Buscar clúster de palabras cercanas con mayor densidad de matches
        // Sliding window por proximidad en el documento
        const MIN_MATCHES_REQUIRED = Math.max(2, Math.floor(targetWords.length * 0.4));

        let bestCluster: { idx: number; matchedTargets: Set<string> }[] = [];
        let bestUniqueCount = 0;

        for (let i = 0; i < wordMatches.length; i++) {
          // Tomar ventana de matches dentro de 50 palabras del actual
          const window: typeof wordMatches = [];
          const uniqueTargets = new Set<string>();
          for (let j = i; j < wordMatches.length; j++) {
            if (wordMatches[j].idx - wordMatches[i].idx > 50) break;
            window.push(wordMatches[j]);
            wordMatches[j].matchedTargets.forEach(t => uniqueTargets.add(t));
          }
          if (uniqueTargets.size > bestUniqueCount) {
            bestUniqueCount = uniqueTargets.size;
            bestCluster = window;
          }
        }

        console.log('🏆 Mejor clúster: ' + bestCluster.length + ' palabras, ' + bestUniqueCount + ' targets únicos (requiere ' + MIN_MATCHES_REQUIRED + ')');

        if (bestUniqueCount < MIN_MATCHES_REQUIRED) {
          console.warn('⚠️ Clúster insuficiente (' + bestUniqueCount + '/' + targetWords.length + ' palabras matchearon)');
          setOcrRunning(false);
          return;
        }

        bestCluster.forEach(m => wordIdxSet.add(m.idx));
        console.log('✅ Match clúster: ' + wordIdxSet.size + ' palabras resaltadas');
      }"""

if old in text:
    text = text.replace(old, new)
    print("✅ Matching más inteligente (requiere clúster de palabras)")
else:
    print("❌ No encontré bloque estrategia 2")

path.write_text(text, encoding='utf-8')
