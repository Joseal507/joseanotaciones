import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# La línea rota tiene un salto de línea literal dentro de comillas simples
# Necesitamos reemplazarla por un template literal o \n

old = "                fullText += '\n' + (mats[k]?.text || '');"
new = "                fullText += '\\n' + (mats[k]?.text || '');"

if old in text:
    text = text.replace(old, new)
    print("✅ Fix newline: corregido")
else:
    # Buscar la línea rota
    lines = text.split('\n')
    for i, line in enumerate(lines):
        if "fullText +=" in line and "mats[k]" not in line:
            print(f"Línea {i+1}: {repr(line)}")
    print("❌ No encontré el patrón exacto, buscando...")
    # Mostrar contexto
    idx = text.find("fullText += '")
    if idx >= 0:
        print("Contexto:", repr(text[idx:idx+80]))

path.write_text(text, encoding='utf-8')
