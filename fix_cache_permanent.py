import pathlib

# ════════════════════════════════════════════════════
# FIX 1: cleanExtractedText preserva \f
# ════════════════════════════════════════════════════
path1 = pathlib.Path('app/api/enfoques/teorico/start/route.ts')
text1 = path1.read_text(encoding='utf-8')

old_clean = """function cleanExtractedText(text: string): string {
  return text
    // Quitar referencias de imágenes markdown
    .replace(/!\\[.*?\\]\\(.*?\\)/g, '')
    .replace(/\\b\\S+\\.(jpeg|jpg|png|gif|webp|svg|bmp)\\b/gi, '')
    // Normalizar saltos de línea
    .replace(/\\r\\n/g, '\\n')
    .replace(/\\n{4,}/g, '\\n\\n\\n')
    // Quitar líneas que son solo espacios
    .replace(/^[ \\t]+$/gm, '')
    .trim();
}"""

new_clean = """function cleanExtractedText(text: string): string {
  // Proteger separadores de página ANTES de limpiar
  const MARKER = '<<PAGE_BREAK>>';
  return text
    .replace(/\\f/g, MARKER)
    // Quitar referencias de imágenes markdown
    .replace(/!\\[.*?\\]\\(.*?\\)/g, '')
    .replace(/\\b\\S+\\.(jpeg|jpg|png|gif|webp|svg|bmp)\\b/gi, '')
    // Normalizar saltos de línea (sin tocar el MARKER)
    .replace(/\\r\\n/g, '\\n')
    .replace(/\\n{4,}/g, '\\n\\n\\n')
    // Quitar líneas que son solo espacios
    .replace(/^[ \\t]+$/gm, '')
    // Restaurar separadores de página
    .replace(new RegExp(MARKER, 'g'), '\\f')
    .trim();
}"""

if old_clean in text1:
    text1 = text1.replace(old_clean, new_clean, 1)
    path1.write_text(text1, encoding='utf-8')
    print("✅ FIX 1: cleanExtractedText preserva \\f")
else:
    print("❌ FIX 1: No matcheó exacto, buscando variante...")
    if 'cleanExtractedText' in text1:
        # Mostrar la función actual
        idx = text1.find('function cleanExtractedText')
        print(f"   Función actual:\n{text1[idx:idx+400]}")

# ════════════════════════════════════════════════════
# FIX 2: shouldRefreshPdfCache solo si NO tiene [Pagina N]
# ni \f — no reextraer si Gemini OCR ya lo procesó
# ════════════════════════════════════════════════════
path2 = pathlib.Path('app/api/enfoques/teorico/start/route.ts')
text2 = path2.read_text(encoding='utf-8')

old_refresh = """          const shouldRefreshPdfCache =
            !!cached &&
            material.kind === 'pdf' &&
            cached.raw_text.length > 0 &&
            !cached.raw_text.includes('\\f');"""

new_refresh = """          // Solo reextraer si el texto NO tiene separadores de ningún tipo
          // \f = pdf-parse nativo | [Pagina N] = formato legacy | texto largo = Gemini OCR (sin páginas, ok)
          const hasPageSeparators =
            cached?.raw_text.includes('\\f') ||
            cached?.raw_text.includes('[Pagina ') ||
            cached?.raw_text.includes('[Página ') ||
            cached?.raw_text.includes('[Page ');
          // Si el texto es suficientemente largo aunque no tenga separadores (Gemini OCR), NO reextraer
          const isLongEnough = (cached?.raw_text.length ?? 0) > 500;
          const shouldRefreshPdfCache =
            !!cached &&
            material.kind === 'pdf' &&
            cached.raw_text.length > 0 &&
            !hasPageSeparators &&
            !isLongEnough;"""

if old_refresh in text2:
    text2 = text2.replace(old_refresh, new_refresh, 1)
    path2.write_text(text2, encoding='utf-8')
    print("✅ FIX 2: shouldRefreshPdfCache no reextrae si Gemini OCR ya lo procesó")
else:
    print("❌ FIX 2: No matcheó exacto")
    if 'shouldRefreshPdfCache' in text2:
        idx = text2.find('shouldRefreshPdfCache')
        print(f"   Actual:\n{text2[idx-20:idx+300]}")

print("\n🎉 Fixes aplicados:")
print("   - cleanExtractedText preserva \\f (separadores de página)")
print("   - shouldRefreshPdfCache no reextrae texto largo de Gemini OCR")
print("   - Segunda vez con 'seguir estudiando': instantáneo desde DB cache")
