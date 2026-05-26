import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# Línea 808: span.style.background = `${color}88`;
# Añadir data-attribute justo después
old = "span.style.background = `${color}88`;"
new = """span.style.background = `${color}88`;
        span.setAttribute('data-flashka-highlight', '1');"""

if old in text:
    text = text.replace(old, new, 1)
    print("✅ data-flashka-highlight añadido al span de highlight")
else:
    print("❌ No encontré línea exacta")

path.write_text(text, encoding='utf-8')
