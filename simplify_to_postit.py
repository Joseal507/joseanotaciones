import pathlib
import re

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# 1) Eliminar el useEffect de Tesseract (todo el bloque de OCR)
# Buscar desde "// ── Tesseract" o similar hasta el cierre del useEffect
patterns_to_remove = [
    # useEffect de Tesseract OCR
    (r"\n\s*//\s*──\s*Tesseract[^\n]*\n[\s\S]*?\}, \[isScanned, resolvedPage, card\.sourceText\]\);", "\n"),
    # useEffect de auto-scroll al highlight
    (r"\n\s*//\s*──\s*Auto-scroll al highlight[^\n]*\n[\s\S]*?\}, \[isScanned, resolvedPage, card\.sourceText\]\);", "\n"),
    # Función highlight() (matching de text layer)
    (r"\n\s*const highlight = \(\) => \{[\s\S]*?\n  \};", "\n  const highlight = () => {};"),
]

for pat, rep in patterns_to_remove:
    before = len(text)
    text = re.sub(pat, rep, text)
    after = len(text)
    if before != after:
        print(f"✅ Eliminado bloque ({before - after} chars)")
    else:
        print(f"⚠️  No encontré: {pat[:50]}...")

# 2) Eliminar las llamadas a setTimeout(highlight, ...)
text = re.sub(r"\s*setTimeout\(highlight,\s*\d+\);", "", text)

# 3) Eliminar imports/usos de Tesseract
text = re.sub(r"^import\s+\*?\s*as?\s*Tesseract\s+from\s+['\"]tesseract\.js['\"];?\s*\n", "", text, flags=re.MULTILINE)
text = re.sub(r"^import\s+Tesseract\s+from\s+['\"]tesseract\.js['\"];?\s*\n", "", text, flags=re.MULTILINE)

path.write_text(text, encoding='utf-8')
print("✅ Tesseract y highlight desactivados")
