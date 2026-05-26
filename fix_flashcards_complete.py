import pathlib
import re

# ════════════════════════════════════════════════════
# FIX 1: Flashcards - extraer 100% del material
# ════════════════════════════════════════════════════
path1 = pathlib.Path('app/api/flashcards/route.ts')
text1 = path1.read_text(encoding='utf-8')

# Problema 1: CHUNK_SIZE=10000 es pequeño, procesa en secuencia (lento)
# Problema 2: el contexto del material en el prompt flashcard usa solo 8000 chars
# Problema 3: BATCH_SIZE=12 es pequeño

old_chunk = """    // ─── PASO 1: Dividir documento en chunks ───
    const CHUNK_SIZE = 10000;
    const chunks: string[] = [];
    let remaining = texto.trim();

    while (remaining.length > 0) {
      if (remaining.length <= CHUNK_SIZE) {
        chunks.push(remaining);
        break;
      }
      let cut = remaining.lastIndexOf('\\n', CHUNK_SIZE);
      if (cut < CHUNK_SIZE * 0.6) cut = CHUNK_SIZE;
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trim();
    }

    console.log(`📄 ${chunks.length} chunk(s)`);"""

new_chunk = """    // ─── PASO 1: Dividir documento en chunks ───
    // Chunks más grandes para capturar más contexto por pasada
    const CHUNK_SIZE = 18000;
    const chunks: string[] = [];
    let remaining = texto.trim();

    while (remaining.length > 0) {
      if (remaining.length <= CHUNK_SIZE) {
        chunks.push(remaining);
        break;
      }
      // Cortar en párrafo completo para no partir conceptos a mitad
      let cut = remaining.lastIndexOf('\\n\\n', CHUNK_SIZE);
      if (cut < CHUNK_SIZE * 0.5) cut = remaining.lastIndexOf('\\n', CHUNK_SIZE);
      if (cut < CHUNK_SIZE * 0.5) cut = CHUNK_SIZE;
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trim();
    }

    console.log(`📄 ${chunks.length} chunk(s) de hasta ${CHUNK_SIZE} chars`);"""

if old_chunk in text1:
    text1 = text1.replace(old_chunk, new_chunk, 1)
    print("✅ CHUNK_SIZE aumentado a 18000 y corte mejorado")
else:
    print("❌ No encontré bloque de chunks")

# Problema 2: el prompt de extracción de conceptos limita la exhaustividad
old_extract_es = """        : `Extrae CADA pieza de conocimiento de este material. Sé exhaustivo, no omitas nada.

IMPORTANTE: Solo extrae hechos que estén EXPLÍCITAMENTE escritos en el material.
NO inventes ni asumas nada que no esté en el texto.

Lista cada concepto, definición, hecho, regla, fecha, nombre, fórmula, proceso y excepción.
Cada elemento en su propia línea comenzando con "- ".
Incluye los valores, nombres y detalles reales del texto.

Material:
${chunk}`;"""

new_extract_es = """        : `Eres un extractor de conocimiento exhaustivo. Tu misión: extraer ABSOLUTAMENTE TODO del material, sin omitir nada.

REGLAS ESTRICTAS:
1. Extrae CADA dato, cifra, nombre, fecha, definición, regla, proceso, excepción, fórmula, ejemplo
2. Solo hechos EXPLÍCITOS en el texto. Cero inventos.
3. Sé granular: si hay 10 características, lista las 10 por separado
4. Incluye detalles numéricos exactos (porcentajes, fechas, cantidades)
5. Cada elemento en su línea con "- "
6. Mínimo 20 conceptos por página de material. Más es mejor.

Material (${chunk.length} chars):
${chunk}`;"""

if old_extract_es in text1:
    text1 = text1.replace(old_extract_es, new_extract_es, 1)
    print("✅ Prompt de extracción mejorado (más exhaustivo)")
else:
    print("❌ No encontré prompt de extracción ES")

# Problema 3: BATCH_SIZE pequeño y contexto cortado en 8000
old_batch = """    // ─── PASO 3: Convertir conceptos en flashcards ───
    const BATCH_SIZE = 12;"""

new_batch = """    // ─── PASO 3: Convertir conceptos en flashcards ───
    const BATCH_SIZE = 15;"""

if old_batch in text1:
    text1 = text1.replace(old_batch, new_batch, 1)
    print("✅ BATCH_SIZE aumentado a 15")

# Problema 4: contexto del material cortado a 8000 en el prompt de flashcards
# Esto hace que se pierda contexto para sourcePage y sourceText
old_ctx_es = """Contexto del material:
${texto.slice(0, 8000)}

Conceptos:
${batch.map((c, idx) => `${idx + 1}. ${c}`).join('\\n')}`;"""

new_ctx_es = """Contexto del material:
${texto.slice(0, 14000)}

Conceptos:
${batch.map((c, idx) => `${idx + 1}. ${c}`).join('\\n')}`;"""

if old_ctx_es in text1:
    text1 = text1.replace(old_ctx_es, new_ctx_es, 1)
    print("✅ Contexto del material en prompt aumentado a 14000 chars")

old_ctx_en = """Material context:
${texto.slice(0, 8000)}

Concepts:
${batch.map((c, idx) => `${idx + 1}. ${c}`).join('\\n')}`"""

new_ctx_en = """Material context:
${texto.slice(0, 14000)}

Concepts:
${batch.map((c, idx) => `${idx + 1}. ${c}`).join('\\n')}`"""

if old_ctx_en in text1:
    text1 = text1.replace(old_ctx_en, new_ctx_en, 1)
    print("✅ Contexto EN aumentado a 14000 chars")

path1.write_text(text1, encoding='utf-8')
print("\n✅ Flashcards route actualizada")
