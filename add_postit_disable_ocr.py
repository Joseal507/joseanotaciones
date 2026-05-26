import pathlib
import re

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# 1) Desactivar la llamada a runTesseractHighlight (línea ~584-585)
old_call = """        if (typeof runTesseractHighlight === 'function') {
          runTesseractHighlight();
        }"""
new_call = """        // OCR Tesseract desactivado - usamos post-it visual en su lugar
        // if (typeof runTesseractHighlight === 'function') runTesseractHighlight();"""

if old_call in text:
    text = text.replace(old_call, new_call)
    print("✅ Llamada a Tesseract desactivada")
else:
    # Buscar variantes
    m = re.search(r"if\s*\(typeof\s+runTesseractHighlight[^}]+\}", text)
    if m:
        text = text.replace(m.group(0), "/* OCR desactivado */")
        print("✅ Llamada a Tesseract desactivada (variante)")
    else:
        print("⚠️ No encontré llamada a runTesseractHighlight")

# 2) Buscar el bloque del modal donde se muestra el PDF y añadir el post-it
# Necesitamos encontrar dónde está el <Page> de react-pdf
# Pista: buscar "pageNumber={resolvedPage}"

m = re.search(r"<Page\s+pageNumber=\{resolvedPage\}[^/]*/>", text)
if m:
    print(f"📍 <Page> encontrado en pos {m.start()}")
else:
    # Buscar variante
    m = re.search(r"pageNumber=\{resolvedPage\}", text)
    if m:
        print(f"📍 pageNumber=resolvedPage en pos {m.start()}")
        # Mostrar contexto
        start = max(0, m.start() - 200)
        end = min(len(text), m.end() + 300)
        print("CONTEXTO:")
        print(text[start:end])
    else:
        print("⚠️ No encontré <Page>")

path.write_text(text, encoding='utf-8')
