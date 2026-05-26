import pathlib

path = pathlib.Path('app/api/flashcards/route.ts')
text = path.read_text(encoding='utf-8')

# 1) Aumentar max_tokens de extracción de conceptos
text = text.replace(
    "max_tokens: 3000,\n        });\n        const text = r.choices[0]?.message?.content || '';\n        return text\n          .split('\\n')\n          .filter((l: string) => l.trim().startsWith('- '))",
    "max_tokens: 6000,\n        });\n        const text = r.choices[0]?.message?.content || '';\n        return text\n          .split('\\n')\n          .filter((l: string) => l.trim().startsWith('- '))"
)

# 2) Reducir BATCH_SIZE de 25 a 12 para que cada lote quepa cómodo en 8k tokens
text = text.replace("const BATCH_SIZE = 25;", "const BATCH_SIZE = 12;")

# 3) Aumentar max_tokens del lote a 10000
text = text.replace("max_tokens: 8000,", "max_tokens: 10000,")

# 4) Aumentar slice de existentes para evitar duplicados (de -20 a -60)
text = text.replace("${existentesAll.slice(-20).join(' | ')}", "${existentesAll.slice(-60).join(' | ')}")

# 5) Aumentar CHUNK_SIZE a 8000 para tener más control y menos chunks gigantes
# (10000 ya está bien, lo dejamos)

path.write_text(text, encoding='utf-8')
print("✅ API ajustado para generar 100% del material")
print("   - max_tokens extracción: 3000 → 6000")
print("   - BATCH_SIZE: 25 → 12 (lotes más pequeños = más confiables)")
print("   - max_tokens flashcards: 8000 → 10000")
print("   - dedupe context: 20 → 60 questions previas")
