import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# Buscar la función resolveByContent y reemplazarla por una que SIEMPRE verifique por contenido
old = '''    const resolveByContent = async () => {
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

      // ── ESTRATEGIA 2: buscar sourceText en el contenido de cada material ──'''

new = '''    const resolveByContent = async () => {
      setResolving(true);

      console.log('🔎 Resolviendo material para card:', {
        sourceMaterialId: card.sourceMaterialId,
        sourcePage: card.sourcePage,
        sourceTextPreview: card.sourceText?.slice(0, 80),
        materialesDisponibles: materiales.map((m: any, i: number) => ({
          idx: i + 1,
          id: m?.materialId || m?.id,
          nombre: m?.nombre || m?.name,
        })),
      });

      // ── ESTRATEGIA PRIORITARIA: buscar sourceText en el contenido ──
      // Esto es lo MÁS confiable porque la IA a veces se equivoca con el ID'''

if old in text:
    text = text.replace(old, new)
    print("✅ Fix: ahora prioriza búsqueda por contenido")
else:
    print("❌ No encontré bloque")

# Ahora hacer que el fallback final use el ID/índice solo si no se encontró por contenido
old2 = '''      // ── FALLBACK: primer material ──
      console.warn('⚠️ No se pudo localizar material, usando el primero');
      setResolvedMaterial(materiales[0]);
      setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
      setResolving(false);
    };'''

new2 = '''      // ── FALLBACK 1: usar ID/índice que dio la IA ──
      if (card.sourceMaterialId) {
        const sid = String(card.sourceMaterialId).trim();

        const asNum = parseInt(sid, 10);
        if (!isNaN(asNum) && asNum >= 1 && asNum <= materiales.length) {
          const mat = materiales[asNum - 1];
          setResolvedMaterial(mat);
          setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
          setResolving(false);
          console.log('⚠️ Fallback por índice IA:', asNum);
          return;
        }

        const byId = materiales.find((m: any) => {
          const mid = String(m?.materialId || m?.id || '').trim();
          return mid === sid;
        });
        if (byId) {
          setResolvedMaterial(byId);
          setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
          setResolving(false);
          console.log('⚠️ Fallback por ID IA:', sid);
          return;
        }

        const byName = materiales.find((m: any) => {
          const mname = String(m?.nombre || m?.name || '').toLowerCase().trim();
          return mname.includes(sid.toLowerCase()) || sid.toLowerCase().includes(mname);
        });
        if (byName) {
          setResolvedMaterial(byName);
          setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
          setResolving(false);
          console.log('⚠️ Fallback por nombre IA:', sid);
          return;
        }
      }

      // ── FALLBACK 2: primer material ──
      console.warn('⚠️ No se pudo localizar material, usando el primero');
      setResolvedMaterial(materiales[0]);
      setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
      setResolving(false);
    };'''

if old2 in text:
    text = text.replace(old2, new2)
    print("✅ Fix: fallbacks reordenados")
else:
    print("❌ No encontré fallback")

path.write_text(text, encoding='utf-8')
