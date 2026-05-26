from pathlib import Path

path = Path("components/materias/QuizPage.tsx")
text = path.read_text(encoding='utf-8')

# ══════════════════════════════════════════════
# FIX 1: Explicación cortada — el botón fijo tapa el contenido
# Cambiar height: 80 spacer a 120 y el botón de position absolute a sticky
# ══════════════════════════════════════════════

# Más espacio para el spacer
text = text.replace(
    "<div style={{ height: 80 }}/>",
    "<div style={{ height: 120, flexShrink: 0 }}/>",
    1
)
print("✅ Spacer aumentado a 120px")

# ══════════════════════════════════════════════
# FIX 2: Asegurar que se usan TODOS los materiales seleccionados
# El texto se construye de todos los materiales concatenados
# ══════════════════════════════════════════════

# Cambiar extractAllText para forzar que procese TODOS los materiales
old_extract = """    const mats = matsUsados.length > 0 ? matsUsados : [];

    for (let i = 0; i < mats.length; i++) {
      const mat = mats[i];
      const matId = mat?.materialId || mat?.id;
      const sel = tieneSeleccion
        ? seleccion.find(s => s.materialIndex === i || s.materialId === String(matId))
        : null;

      // Si ya viene texto pre-extraído
      if (sel?.text) {
        texts.push(sel.text);
        continue;
      }

      // Si hay contenido directo
      const raw = mat?.contenido || mat?.content || '';
      if (raw.trim()) {
        const pages = sel?.pages || [];
        texts.push(pages.length > 0 ? filterTextByPages(raw, pages) : raw);
        continue;
      }

      // Extraer desde API
      if (!matId || !session) continue;
      try {
        const res = await fetch('/api/enfoques/teorico/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ materialIds: [matId] }),
        });
        const data = await res.json();
        const fullText = data.materials?.[matId]?.text || '';
        if (!fullText) continue;

        const pages = sel?.pages || [];
        texts.push(pages.length > 0 ? filterTextByPages(fullText, pages) : fullText);
      } catch (e) {
        console.warn('Error extrayendo material', matId, e);
      }
    }

    return texts.join('\\n\\n---\\n\\n');"""

new_extract = """    const mats = matsUsados.length > 0 ? matsUsados : [];
    
    // Recopilar todos los materialIds para extraer en batch
    const allMatIds: string[] = [];
    const matIdToIndex: Record<string, number> = {};

    for (let i = 0; i < mats.length; i++) {
      const mat = mats[i];
      const matId = mat?.materialId || mat?.material_id || mat?.id;
      const sel = tieneSeleccion
        ? seleccion.find(s => s.materialIndex === i || s.materialId === String(matId))
        : null;

      // Si ya viene texto pre-extraído, usarlo directo
      if (sel?.text) {
        console.log(`📦 Material ${i + 1}: texto pre-extraído (${sel.text.length} chars)`);
        texts.push(`[Material ${i + 1}: ${mat?.nombre || matId}]\\n${sel.text}`);
        continue;
      }

      // Si hay contenido directo en el objeto
      const raw = mat?.contenido || mat?.content || '';
      if (raw.trim()) {
        const pages = sel?.pages || [];
        const filtered = pages.length > 0 ? filterTextByPages(raw, pages) : raw;
        console.log(`📝 Material ${i + 1}: contenido directo (${filtered.length} chars)`);
        texts.push(`[Material ${i + 1}: ${mat?.nombre || matId}]\\n${filtered}`);
        continue;
      }

      // Necesita extracción por API
      if (matId) {
        allMatIds.push(String(matId));
        matIdToIndex[String(matId)] = i;
      }
    }

    // Extraer todos los materiales pendientes en un solo batch
    if (allMatIds.length > 0 && session) {
      try {
        console.log('🔄 Extrayendo', allMatIds.length, 'materiales en batch...');
        const res = await fetch('/api/enfoques/teorico/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ materialIds: allMatIds }),
        });
        const data = await res.json();

        if (data.materials) {
          for (const matId of allMatIds) {
            const fullText = data.materials[matId]?.text || '';
            if (!fullText) {
              console.warn(`⚠️ Material ${matId}: sin texto`);
              continue;
            }

            const i = matIdToIndex[matId];
            const mat = mats[i];
            const sel = tieneSeleccion
              ? seleccion.find(s => s.materialIndex === i || s.materialId === matId)
              : null;
            const pages = sel?.pages || [];
            const filtered = pages.length > 0 ? filterTextByPages(fullText, pages) : fullText;

            console.log(`✅ Material ${i + 1} (${mat?.nombre || matId}): ${filtered.length} chars${pages.length ? ` (${pages.length} págs)` : ''}`);
            texts.push(`[Material ${i + 1}: ${mat?.nombre || matId}]\\n${filtered}`);
          }
        }
      } catch (e) {
        console.warn('Error extrayendo materiales en batch:', e);
      }
    }

    console.log(`📊 Quiz: ${texts.length} materiales extraídos, ${texts.reduce((a, t) => a + t.length, 0)} chars total`);
    return texts.join('\\n\\n---\\n\\n');"""

if old_extract in text:
    text = text.replace(old_extract, new_extract, 1)
    print("✅ extractAllText: batch + logs de cada material")
else:
    print("❌ No matcheó extractAllText")

path.write_text(text, encoding='utf-8')
print("\n🎉 Fixes aplicados:")
print("  1. Spacer más grande para que la explicación no se corte")
print("  2. Extracción en batch de todos los materiales con logs")
