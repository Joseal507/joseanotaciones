import pathlib
import re

# ════════════════════════════════════════════════════
# FIX 1: BODY undefined en TemaView
# ════════════════════════════════════════════════════
path1 = pathlib.Path('components/materias/TemaView.tsx')
text1 = path1.read_text(encoding='utf-8')

# Reemplazar BODY por string literal en el modal
text1 = text1.replace("fontFamily: BODY,", "fontFamily: 'Inter, sans-serif',")
print("✅ BODY reemplazado por 'Inter, sans-serif'")

path1.write_text(text1, encoding='utf-8')

# ════════════════════════════════════════════════════
# FIX 2: Cachear el análisis de TeoricoWorkspace
# ════════════════════════════════════════════════════
# El análisis se hace en TeoricoWorkspace.tsx con fetch a /api/enfoques/teorico/start
# Necesitamos:
# 1. Saber el sessionId en TeoricoWorkspace
# 2. Guardar la respuesta del análisis en la sesión
# 3. Al montar, si la sesión tiene análisis → usarlo en vez de fetch

path2 = pathlib.Path('components/materias/TeoricoWorkspace.tsx')
text2 = path2.read_text(encoding='utf-8')

print("\n=== Analizando TeoricoWorkspace ===")

# Ver firma actual
m = re.search(r"export default function TeoricoWorkspace\(\{[^}]+\}: Props\)", text2)
if m:
    print(f"Firma actual: {m.group(0)}")

# Ver dónde se llama al fetch del análisis
fetches = list(re.finditer(r"fetch\(['\"]\/api\/enfoques\/teorico\/start['\"]", text2))
print(f"Encontradas {len(fetches)} llamadas a /api/enfoques/teorico/start")
for f in fetches:
    line = text2[:f.start()].count('\n') + 1
    print(f"  Línea {line}")
