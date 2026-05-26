import pathlib
import re

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

# Ver contexto exacto alrededor de línea 2619
lines = text.splitlines()
print("=== Contexto líneas 2610-2640 ===")
for i, l in enumerate(lines[2609:2640], start=2610):
    print(f"{i}: {l}")
