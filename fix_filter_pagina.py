import pathlib
import re

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

# Fix 1: aceptar tanto "Página" como "Pagina"
old1 = "    if (fullText.includes('[Página ') && fullText.includes('\\f')) {"
new1 = "    if ((fullText.includes('[Página ') || fullText.includes('[Pagina ')) && fullText.includes('\\f')) {"

if old1 in text:
    text = text.replace(old1, new1)
    print("✅ Fix 1: detectar Pagina/Página con form feed")
else:
    print("❌ Fix 1 falló")

old2 = "    if (pageTexts.length <= 1 && fullText.includes('[Página ')) {"
new2 = "    if (pageTexts.length <= 1 && (fullText.includes('[Página ') || fullText.includes('[Pagina '))) {"

if old2 in text:
    text = text.replace(old2, new2)
    print("✅ Fix 2: detectar Pagina/Página como separador")
else:
    print("❌ Fix 2 falló")

# Fix 3: regex de split debe aceptar ambos
old3 = "        .split(/(?=\\[Página \\d+\\])/g)"
new3 = "        .split(/(?=\\[P[áa]gina \\d+\\])/g)"

if old3 in text:
    text = text.replace(old3, new3)
    print("✅ Fix 3: regex split acepta ambos")
else:
    print("❌ Fix 3 falló")

path.write_text(text, encoding='utf-8')
