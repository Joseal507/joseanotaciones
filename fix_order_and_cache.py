import pathlib
import re

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

print(f"Total líneas: {len(text.splitlines())}")

# ════════════════════════════════════════════════════
# FIX 1: Remover materialText del dep array del useEffect
# (el useState está DESPUÉS = TDZ error)
# ════════════════════════════════════════════════════
if '}, [flashcards, materialText, sessionId, tema?.id, cacheLoaded]);' in text:
    text = text.replace(
        '}, [flashcards, materialText, sessionId, tema?.id, cacheLoaded]);',
        '}, [flashcards, sessionId, tema?.id, cacheLoaded]);'
    )
    print("✅ FIX 1: materialText removido del dep array")
elif '}, [flashcards, sessionId, tema?.id, cacheLoaded]);' in text:
    print("✅ FIX 1: ya estaba corregido")
else:
    # Buscar variante
    m = re.search(r'\}, \[flashcards,.*?materialText.*?cacheLoaded\]\);', text)
    if m:
        old = m.group(0)
        new = re.sub(r',\s*materialText', '', old)
        text = text.replace(old, new, 1)
        print(f"✅ FIX 1 variante: {old[:60]} → {new[:60]}")
    else:
        print("❌ FIX 1: No encontré el dep array")

path.write_text(text, encoding='utf-8')
print("Archivo guardado")
