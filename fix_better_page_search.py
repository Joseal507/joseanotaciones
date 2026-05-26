import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# Hacer que la búsqueda de página sea más robusta: buscar varios fragmentos del sourceText
old = """            if (fullText) {
              const needle = norm(card.sourceText).slice(0, 100);
              const needleShort = norm(card.sourceText).split(' ').slice(0, 6).join(' ');
              const normFull = norm(fullText);

              const idx = normFull.indexOf(needle) >= 0
                ? normFull.indexOf(needle)
                : normFull.indexOf(needleShort);

              if (idx >= 0) {
                const before = normFull.slice(0, idx);
                const pageMatches = [...before.matchAll(/\\[pagina (\\d+)\\]/g)];
                if (pageMatches.length > 0) {
                  const realPage = parseInt(pageMatches[pageMatches.length - 1][1], 10);
                  if (realPage > 0) {
                    setResolvedPage(realPage);
                    console.log('✅ Página real encontrada por contenido:', realPage, '(IA dijo:', card.sourcePage, ')');
                    setResolving(false);
                    return;
                  }
                }
              }
            }"""

new = """            if (fullText) {
              const normFull = norm(fullText);
              const normSrc = norm(card.sourceText);

              // Probar múltiples fragmentos del sourceText para encontrar el más confiable
              const candidates: string[] = [];

              // 1. Primeras 100 letras
              candidates.push(normSrc.slice(0, 100));
              // 2. Primeras 50 letras
              candidates.push(normSrc.slice(0, 50));
              // 3. Fragmento intermedio (más distintivo, evita inicios genéricos)
              if (normSrc.length > 80) {
                candidates.push(normSrc.slice(30, 100));
              }
              // 4. Primeras 6 palabras
              candidates.push(normSrc.split(' ').slice(0, 6).join(' '));
              // 5. Palabras 3-9 (saltando inicio común)
              const wParts = normSrc.split(' ');
              if (wParts.length >= 9) {
                candidates.push(wParts.slice(2, 9).join(' '));
              }

              let foundPage = -1;
              let foundIdx = -1;
              for (const cand of candidates) {
                if (cand.length < 8) continue;
                const idx = normFull.indexOf(cand);
                if (idx >= 0) {
                  const before = normFull.slice(0, idx);
                  const pageMatches = [...before.matchAll(/\\[pagina (\\d+)\\]/g)];
                  if (pageMatches.length > 0) {
                    const realPage = parseInt(pageMatches[pageMatches.length - 1][1], 10);
                    if (realPage > 0) {
                      foundPage = realPage;
                      foundIdx = idx;
                      console.log('🔎 Match candidato:', cand.slice(0, 40), '→ página', realPage);
                      break;
                    }
                  }
                }
              }

              if (foundPage > 0) {
                setResolvedPage(foundPage);
                console.log('✅ Página real encontrada por contenido:', foundPage, '(IA dijo:', card.sourcePage, ')');
                setResolving(false);
                return;
              } else {
                console.warn('⚠️ No se encontró el sourceText en el texto OCR. Usando página de IA:', card.sourcePage);
              }
            }"""

if old in text:
    text = text.replace(old, new)
    print("✅ Búsqueda de página mejorada con múltiples candidatos")
else:
    print("❌ No encontré bloque búsqueda página")

path.write_text(text, encoding='utf-8')
