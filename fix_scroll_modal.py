import pathlib
import re

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# 1) Encontrar el contenedor scrollable padre del PDF y darle altura/overflow
# Buscamos el div con flex que contiene el pageRef
m = re.search(r"<div ref=\{pageRef\} style=\{\{[\s\S]*?\}\}>", text)
if m:
    print("📍 pageRef encontrado")
    # Mostrar contexto del padre
    start = max(0, m.start() - 800)
    print("=== CONTEXTO PADRE ===")
    print(text[start:m.start()])
    print("=== FIN ===")
