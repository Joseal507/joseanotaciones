import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# Buscar el bloque que dice "Un solo material → directo" y modificarlo
old = """    // Un solo material → directo
    if (materiales.length === 1) {
      setResolvedMaterial(materiales[0]);
      setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
      setResolving(false);
      return;
    }"""

new = """    // Un solo material → verificar página por contenido
    if (materiales.length === 1) {
      const mat = materiales[0];
      setResolvedMaterial(mat);

      // Si tenemos sourceText, buscar la página real por contenido
      if (card.sourceText && card.sourceText.length >= 10) {
        (async () => {
          const matId = mat?.materialId || mat?.id;
          if (!matId) {
            setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
            setResolving(false);
            return;
          }

          try {
            let fullText = materialTextCache.get(matId);
            if (!fullText) {
              const session = (await supabase.auth.getSession()).data.session;
              const authHeader: HeadersInit = session?.access_token
                ? { Authorization: `Bearer ${session.access_token}` }
                : {};
              const res = await fetch('/api/enfoques/teorico/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader },
                body: JSON.stringify({ materialIds: [matId] }),
              });
              if (res.ok) {
                const data = await res.json();
                fullText = '';
                const mats = data?.materials || {};
                for (const k of Object.keys(mats)) {
                  fullText += '\\n' + (mats[k]?.text || '');
                }
                materialTextCache.set(matId, fullText);
              }
            }

            if (fullText) {
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
            }
          } catch (e) {
            console.warn('Error buscando página real:', e);
          }

          setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
          setResolving(false);
        })();
        return;
      }

      setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
      setResolving(false);
      return;
    }"""

if old in text:
    text = text.replace(old, new)
    print("✅ Ahora SIEMPRE busca página real por contenido (incluso con 1 material)")
else:
    print("❌ No encontré bloque 'Un solo material'")

path.write_text(text, encoding='utf-8')
