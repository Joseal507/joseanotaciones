import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# ── FIX 1: resolver material por ID primero, luego por contenido ──
old = '''  // ── Resolver material correcto SIEMPRE por contenido ───────────────────────
  useEffect(() => {
    if (!materiales.length) {
      setResolving(false);
      return;
    }

    // Si solo hay un material → directo
    if (materiales.length === 1) {
      setResolvedMaterial(materiales[0]);
      setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
      setResolving(false);
      return;
    }

    // Múltiples materiales → resolver por sourceText (ignoramos el ID de la IA)
    const resolveByContent = async () => {
      setResolving(true);

      if (!card.sourceText) {
        // Sin sourceText → intentar por ID al menos
        if (card.sourceMaterialId) {
          const sid = String(card.sourceMaterialId).trim();
          const found = materiales.find((m: any) => {
            const mid = String(m?.materialId || m?.id || '').trim();
            return mid === sid;
          });
          if (found) {
            setResolvedMaterial(found);
            setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
            setResolving(false);
            return;
          }
        }
        setResolvedMaterial(materiales[0]);
        setResolvedPage(1);
        setResolving(false);
        return;
      }

      const needle = norm(card.sourceText).slice(0, 80);
      const needleShort = norm(card.sourceText).split(\' \').slice(0, 5).join(\' \');

      const session = (await supabase.auth.getSession()).data.session;
      const authHeader: HeadersInit = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      let bestMatch: { mat: any; page: number } | null = null;

      for (const mat of materiales) {
        const matId = mat?.materialId || mat?.id;
        if (!matId) continue;

        try {
          // Cache check
          let fullText = materialTextCache.get(matId);

          if (!fullText) {
            const res = await fetch(\'/api/enfoques/teorico/start\', {
              method: \'POST\',
              headers: { \'Content-Type\': \'application/json\', ...authHeader },
              body: JSON.stringify({ materialIds: [matId] }),
            });
            if (!res.ok) continue;
            const data = await res.json();
            fullText = \'\';
            const mats = data?.materials || {};
            for (const k of Object.keys(mats)) {
              fullText += \'\\n\' + (mats[k]?.text || \'\');
            }
            materialTextCache.set(matId, fullText);
          }

          const normFull = norm(fullText);

          if (normFull.includes(needle) || normFull.includes(needleShort)) {
            // Encontrar página: buscar [Pagina N] cerca del match
            let matchPage = card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1;
            const idx = normFull.indexOf(needle) >= 0
              ? normFull.indexOf(needle)
              : normFull.indexOf(needleShort);

            if (idx >= 0) {
              // Buscar el marcador [Pagina N] anterior al match
              const before = normFull.slice(0, idx);
              const pageMatches = [...before.matchAll(/\\[pagina (\\d+)\\]/g)];
              if (pageMatches.length > 0) {
                const lastPage = pageMatches[pageMatches.length - 1][1];
                matchPage = parseInt(lastPage, 10) || matchPage;
              }
            }

            bestMatch = { mat, page: matchPage };
            console.log(\'✅ Match encontrado en material:\', matId, \'página:\', matchPage);
            break;
          }
        } catch (e) {
          console.warn(\'Error consultando material\', matId, e);
        }
      }

      if (bestMatch) {
        setResolvedMaterial(bestMatch.mat);
        setResolvedPage(bestMatch.page);
      } else {
        // No se encontró en ninguno → usar el ID de la IA si matchea, sino el primero
        if (card.sourceMaterialId) {
          const sid = String(card.sourceMaterialId).trim();
          const found = materiales.find((m: any) => {
            const mid = String(m?.materialId || m?.id || \'\').trim();
            return mid === sid;
          });
          if (found) {
            setResolvedMaterial(found);
            setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
            setResolving(false);
            return;
          }
        }
        console.warn(\'⚠️ No se pudo localizar el fragmento en ningún material\');
        setResolvedMaterial(materiales[0]);
        setResolvedPage(1);
      }
      setResolving(false);
    };

    resolveByContent();
  }, [card.sourceMaterialId, card.sourceText, card.sourcePage, materiales]);'''

new = '''  // ── Resolver material correcto ───────────────────────────────────────────────
  useEffect(() => {
    if (!materiales.length) { setResolving(false); return; }

    // Un solo material → directo
    if (materiales.length === 1) {
      setResolvedMaterial(materiales[0]);
      setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
      setResolving(false);
      return;
    }

    const resolveByContent = async () => {
      setResolving(true);

      // ── ESTRATEGIA 1: match por índice numérico en sourceMaterialId ──
      // La IA recibe "[Material 1: ...]" y debe devolver "1" o "mat_xxx"
      // Intentamos parsear el número de material
      if (card.sourceMaterialId) {
        const sid = String(card.sourceMaterialId).trim();

        // Caso A: es un número → índice del material (1-based)
        const asNum = parseInt(sid, 10);
        if (!isNaN(asNum) && asNum >= 1 && asNum <= materiales.length) {
          const mat = materiales[asNum - 1];
          setResolvedMaterial(mat);
          setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
          setResolving(false);
          console.log('✅ Material resuelto por índice:', asNum);
          return;
        }

        // Caso B: es un ID real → buscar en materiales
        const byId = materiales.find((m: any) => {
          const mid = String(m?.materialId || m?.id || '').trim();
          return mid === sid || mid.includes(sid) || sid.includes(mid);
        });
        if (byId) {
          setResolvedMaterial(byId);
          setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
          setResolving(false);
          console.log('✅ Material resuelto por ID:', sid);
          return;
        }

        // Caso C: es un nombre → buscar por nombre
        const byName = materiales.find((m: any) => {
          const mname = String(m?.nombre || m?.name || '').toLowerCase().trim();
          return mname.includes(sid.toLowerCase()) || sid.toLowerCase().includes(mname);
        });
        if (byName) {
          setResolvedMaterial(byName);
          setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
          setResolving(false);
          console.log('✅ Material resuelto por nombre:', sid);
          return;
        }
      }

      // ── ESTRATEGIA 2: buscar sourceText en el contenido de cada material ──
      if (card.sourceText && card.sourceText.length >= 10) {
        const needle = norm(card.sourceText).slice(0, 100);
        const needleShort = norm(card.sourceText).split(' ').slice(0, 6).join(' ');

        const session = (await supabase.auth.getSession()).data.session;
        const authHeader: HeadersInit = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};

        for (const mat of materiales) {
          const matId = mat?.materialId || mat?.id;
          if (!matId) continue;

          try {
            let fullText = materialTextCache.get(matId);
            if (!fullText) {
              const res = await fetch('/api/enfoques/teorico/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader },
                body: JSON.stringify({ materialIds: [matId] }),
              });
              if (!res.ok) continue;
              const data = await res.json();
              fullText = '';
              const mats = data?.materials || {};
              for (const k of Object.keys(mats)) {
                fullText += '\n' + (mats[k]?.text || '');
              }
              materialTextCache.set(matId, fullText);
            }

            const normFull = norm(fullText);
            if (normFull.includes(needle) || normFull.includes(needleShort)) {
              let matchPage = card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1;
              const idx = normFull.indexOf(needle) >= 0 ? normFull.indexOf(needle) : normFull.indexOf(needleShort);
              if (idx >= 0) {
                const before = normFull.slice(0, idx);
                const pageMatches = [...before.matchAll(/\[pagina (\d+)\]/g)];
                if (pageMatches.length > 0) {
                  matchPage = parseInt(pageMatches[pageMatches.length - 1][1], 10) || matchPage;
                }
              }
              setResolvedMaterial(mat);
              setResolvedPage(matchPage);
              setResolving(false);
              console.log('✅ Material resuelto por contenido:', matId, 'página:', matchPage);
              return;
            }
          } catch (e) {
            console.warn('Error consultando material', matId, e);
          }
        }
      }

      // ── FALLBACK: primer material ──
      console.warn('⚠️ No se pudo localizar material, usando el primero');
      setResolvedMaterial(materiales[0]);
      setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
      setResolving(false);
    };

    resolveByContent();
  }, [card.sourceMaterialId, card.sourceText, card.sourcePage, materiales]);'''

if old in text:
    text = text.replace(old, new)
    print("✅ Fix 1: lógica de resolución de material mejorada")
else:
    print("❌ No encontré bloque de resolución de material")

# ── FIX 2: Highlight más robusto con reintentos ──
old2 = '''      {!resolving && pdfUrl && !error && (
                <div style={{ borderRadius: 14, overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.5)', background: '#fff' }}>
                  <Document file={pdfUrl}>
                    <Page
                      pageNumber={resolvedPage}
                      width={containerWidth}
                      onRenderTextLayerSuccess={() => {
                        setTimeout(highlight, 300);
                        setTimeout(highlight, 800);
                      }}
                      renderAnnotationLayer={false}
                    />
                  </Document>
                </div>
              )}'''

new2 = '''      {!resolving && pdfUrl && !error && (
                <div style={{ borderRadius: 14, overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.5)', background: '#fff' }}>
                  <Document file={pdfUrl}>
                    <Page
                      pageNumber={resolvedPage}
                      width={containerWidth}
                      onRenderTextLayerSuccess={() => {
                        // Reintentos progresivos para que el DOM del text layer esté listo
                        setTimeout(highlight, 200);
                        setTimeout(highlight, 600);
                        setTimeout(highlight, 1200);
                        setTimeout(highlight, 2500);
                      }}
                      renderAnnotationLayer={true}
                      renderTextLayer={true}
                    />
                  </Document>
                </div>
              )}'''

if old2 in text:
    text = text.replace(old2, new2)
    print("✅ Fix 2: highlight con más reintentos")
else:
    print("❌ No encontré bloque del PDF viewer")

path.write_text(text, encoding='utf-8')
