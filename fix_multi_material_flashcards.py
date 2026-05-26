import pathlib

# ════════════════════════════════════════════════════
# FIX: API de flashcards procesa cada material
# por separado y garantiza cobertura del 100%
# ════════════════════════════════════════════════════

# Primero ver cómo FlashcardsPage manda el texto a la API
path1 = pathlib.Path('components/materias/FlashcardsPage.tsx')
text1 = path1.read_text(encoding='utf-8')

# Ver qué se manda al endpoint /api/flashcards
idx = text1.find("body: JSON.stringify({")
found = []
while idx >= 0:
    chunk = text1[idx:idx+300]
    if 'flashcard' in text1[max(0,idx-200):idx].lower() or 'flashcard' in chunk.lower():
        found.append((idx, chunk))
    idx = text1.find("body: JSON.stringify({", idx+1)

for pos, chunk in found:
    line = text1[:pos].count('\n') + 1
    print(f"Línea {line}: {chunk[:200]}")
