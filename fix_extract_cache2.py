import pathlib

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

# ════════════════════════════════════════════════════
# FIX: Reemplazar las líneas exactas 2619-2624
# ════════════════════════════════════════════════════

old = """    try {
      const texto = await extractText();
      if (!texto.trim()) { setError('No se pudo extraer texto del material.'); return; }

      // Guardar para que evaluar tenga contexto
      setMaterialText(texto);
      console.log('📚 Texto usado para flashcards:', texto.length, 'chars');"""

new = """    try {
      // ── Usar texto cacheado si existe (evita re-llamar OCR/Gemini) ──
      let texto = materialText;
      if (!texto || texto.trim().length < 50) {
        console.log('🔍 Sin cache de texto, extrayendo con OCR/Gemini...');
        texto = await extractText();
        if (!texto.trim()) { setError('No se pudo extraer texto del material.'); return; }

        // Guardar para que evaluar tenga contexto
        setMaterialText(texto);

        // Persistir en localStorage junto a la sesión
        if (sessionId) {
          try {
            const keys = Object.keys(localStorage).filter(k => k.startsWith('study_sessions_v1_'));
            for (const k of keys) {
              const data = JSON.parse(localStorage.getItem(k) || '{}');
              if (data[sessionId]) {
                data[sessionId].materialText = texto;
                localStorage.setItem(k, JSON.stringify(data));
                console.log('💾 materialText cacheado (' + texto.length + ' chars)');
                break;
              }
            }
          } catch (e) {
            console.warn('Error cacheando materialText:', e);
          }
        }
      } else {
        console.log('⚡ Texto ya cacheado (' + texto.length + ' chars) - saltando OCR');
      }
      console.log('📚 Texto usado para flashcards:', texto.length, 'chars');"""

if old in text:
    text = text.replace(old, new, 1)
    path.write_text(text, encoding='utf-8')
    print("✅ FIX aplicado: generate() reutiliza materialText cacheado")
else:
    print("❌ No encontré el bloque exacto")
    # Debug: mostrar dónde está extractText
    lines = text.splitlines()
    for i, l in enumerate(lines):
        if 'extractText()' in l and 'await' in l:
            print(f"  Línea {i+1}: {l.strip()}")
