import pathlib

path = pathlib.Path('app/api/flashcards/route.ts')
text = path.read_text(encoding='utf-8')

old = '''- "sourceMaterialId": OBLIGATORIO si hay varios materiales. El material empieza con [Material N: ID_AQUI | ...]. Copia ese ID exacto. Si solo hay un material, omítelo.'''

new = '''- "sourceMaterialId": OBLIGATORIO si hay varios materiales. El material empieza con [Material N: ID=VALOR | ...]. Copia EXACTAMENTE el VALOR después de "ID=". Ejemplo: si ves [Material 2: ID=mat_abc123 | ...] escribe "mat_abc123". Si solo hay un material, omítelo.'''

if old in text:
    text = text.replace(old, new)
    print("✅ Fix prompt ES: instrucción ID mejorada")
else:
    print("❌ No encontré prompt ES")

old2 = '''- "sourceMaterialId": REQUIRED if multiple materials. Material starts with [Material N: ID_HERE | ...]. Copy that ID. Omit if single material.'''

new2 = '''- "sourceMaterialId": REQUIRED if multiple materials. Material starts with [Material N: ID=VALUE | ...]. Copy EXACTLY the VALUE after "ID=". Example: if you see [Material 2: ID=mat_abc123 | ...] write "mat_abc123". Omit if single material.'''

if old2 in text:
    text = text.replace(old2, new2)
    print("✅ Fix prompt EN: instrucción ID mejorada")
else:
    print("❌ No encontré prompt EN")

path.write_text(text, encoding='utf-8')
