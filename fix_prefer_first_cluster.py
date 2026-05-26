import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# Cambiar la lógica: cuando hay empate en uniqueTargets, preferir el clúster que aparece PRIMERO
# Y cuando el targetWords es muy chico (<=3), expandir el clúster a las palabras circundantes
old = """        let bestCluster: { idx: number; matchedTargets: Set<string> }[] = [];
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
        }"""

new = """        let bestCluster: { idx: number; matchedTargets: Set<string> }[] = [];
        let bestUniqueCount = 0;
        let bestDensity = 0; // matches por palabra de ventana (más denso = mejor)

        for (let i = 0; i < wordMatches.length; i++) {
          // Ventana más chica para texto corto (más preciso)
          const windowSize = targetWords.length <= 3 ? 15 : 50;
          const window: typeof wordMatches = [];
          const uniqueTargets = new Set<string>();
          for (let j = i; j < wordMatches.length; j++) {
            if (wordMatches[j].idx - wordMatches[i].idx > windowSize) break;
            window.push(wordMatches[j]);
            wordMatches[j].matchedTargets.forEach(t => uniqueTargets.add(t));
          }
          // Densidad: targets únicos / spread de palabras OCR
          const spread = window.length > 1 ? (window[window.length-1].idx - window[0].idx + 1) : 1;
          const density = uniqueTargets.size / Math.max(1, Math.log2(spread + 1));

          // Preferir: más targets únicos, luego mayor densidad (más compacto)
          if (uniqueTargets.size > bestUniqueCount ||
              (uniqueTargets.size === bestUniqueCount && density > bestDensity)) {
            bestUniqueCount = uniqueTargets.size;
            bestDensity = density;
            bestCluster = window;
          }
        }

        // Si target es muy corto (<=3 palabras), incluir palabras vecinas para contexto visual
        if (targetWords.length <= 3 && bestCluster.length > 0) {
          const firstIdx = bestCluster[0].idx;
          const lastIdx = bestCluster[bestCluster.length - 1].idx;
          const expanded = new Set(bestCluster.map(m => m.idx));
          // Añadir hasta 2 palabras antes y 2 después (mismo renglón típicamente)
          for (let k = Math.max(0, firstIdx - 2); k <= Math.min(words.length - 1, lastIdx + 2); k++) {
            // Solo si está en el mismo renglón aproximado (y similar al primer match)
            const baseY = (words[firstIdx]?.bbox?.y0 || 0);
            const thisY = (words[k]?.bbox?.y0 || 0);
            if (Math.abs(thisY - baseY) < 20) {
              expanded.add(k);
            }
          }
          bestCluster = Array.from(expanded).sort((a,b) => a-b).map(idx => ({
            idx,
            matchedTargets: new Set<string>(),
          }));
          console.log('📌 Clúster expandido a ' + bestCluster.length + ' palabras (texto corto)');
        }"""

if old in text:
    text = text.replace(old, new)
    print("✅ Lógica de clúster mejorada: prefiere densidad + expande texto corto")
else:
    print("❌ No encontré bloque cluster")

path.write_text(text, encoding='utf-8')
