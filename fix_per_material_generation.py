import pathlib

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

# ════════════════════════════════════════════════════
# FIX: Generar flashcards por material separado
# En vez de concatenar todo y mandar 1 request,
# manda 1 request por material en paralelo
# ════════════════════════════════════════════════════

old_generate_call = """      const lang = detectContentLanguage(texto, 'es');
      const session = (await supabase.auth.getSession()).data.session;

      const res = await fetch('/api/flashcards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          content: texto,
          idioma: lang,
          materialId: matActual?.materialId || matActual?.id,
          seleccion,
          selectedPages,
          totalSelectedPages,
        }),
      });

      const data = await res.json();
      if (!data.success || !data.flashcards?.length) {
        setError(data.error || 'No se pudieron generar flashcards.'); return;
      }

      const raw = dedupe(data.flashcards);"""

new_generate_call = """      const lang = detectContentLanguage(texto, 'es');
      const session = (await supabase.auth.getSession()).data.session;

      // ── Separar texto por material para garantizar 100% cobertura ──
      // El texto tiene bloques: [Material N: ID=xxx | nombre | páginas]\\ntexto
      const materialBlocks: { text: string; materialId: string }[] = [];
      const blockRegex = /\\[Material \\d+: ID=([^|\\]]+)[^\\]]*\\]\\n([\\s\\S]*?)(?=\\n\\[Material \\d+:|$)/g;
      let blockMatch;
      let hasMultipleBlocks = false;

      while ((blockMatch = blockRegex.exec(texto)) !== null) {
        const matId = blockMatch[1].trim();
        const matText = blockMatch[2].trim();
        if (matText.length > 50) {
          materialBlocks.push({ text: matText, materialId: matId });
          hasMultipleBlocks = true;
        }
      }

      // Si no se pudieron separar, usar el texto completo como un bloque
      if (materialBlocks.length === 0) {
        materialBlocks.push({
          text: texto,
          materialId: matActual?.materialId || matActual?.id || '',
        });
      }

      console.log(`🔀 Procesando ${materialBlocks.length} material(es) por separado`);

      // ── Llamar API por cada material EN PARALELO ──
      const allResponses = await Promise.all(
        materialBlocks.map(async (block, blockIdx) => {
          setGeneratingStep(`Generando flashcards del material ${blockIdx + 1}/${materialBlocks.length}...`);
          const res = await fetch('/api/flashcards', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
            },
            body: JSON.stringify({
              content: block.text,
              idioma: lang,
              materialId: block.materialId,
              seleccion,
              selectedPages,
              totalSelectedPages,
            }),
          });
          const data = await res.json();
          if (!data.success || !data.flashcards?.length) {
            console.warn(`⚠️ Material ${blockIdx + 1} sin flashcards:`, data.error);
            return [];
          }
          console.log(`✅ Material ${blockIdx + 1}: ${data.flashcards.length} flashcards`);
          return data.flashcards;
        })
      );

      // Combinar todas las flashcards de todos los materiales
      const allCards = allResponses.flat();
      if (allCards.length === 0) {
        setError('No se pudieron generar flashcards.'); return;
      }

      const raw = dedupe(allCards);"""

if old_generate_call in text:
    text = text.replace(old_generate_call, new_generate_call, 1)
    path.write_text(text, encoding='utf-8')
    print("✅ Generación por material separado en paralelo")
else:
    print("❌ No encontré el bloque exacto")
    # Debug
    if "const res = await fetch('/api/flashcards'" in text:
        idx = text.find("const res = await fetch('/api/flashcards'")
        print(f"  Contexto: {text[idx-200:idx+100]}")
