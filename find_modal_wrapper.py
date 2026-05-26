import pathlib
import re

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# Buscar overflow
print("📍 overflow encontrados:")
for m in re.finditer(r"overflow[A-Za-z]*:\s*['\"]?(auto|scroll|hidden)", text):
    line_num = text[:m.start()].count('\n') + 1
    line_start = text.rfind('\n', 0, m.start()) + 1
    line_end = text.find('\n', m.end())
    print(f"  Línea {line_num}: {text[line_start:line_end].strip()}")

print("\n📍 maxHeight encontrados:")
for m in re.finditer(r"maxHeight:\s*[^,\n}]+", text):
    line_num = text[:m.start()].count('\n') + 1
    print(f"  Línea {line_num}: {m.group(0)}")

print("\n📍 height: explícitos:")
for m in re.finditer(r"\bheight:\s*['\"][^'\"]+['\"]", text):
    line_num = text[:m.start()].count('\n') + 1
    print(f"  Línea {line_num}: {m.group(0)}")
