import pathlib

path = pathlib.Path('app/api/flashcards/route.ts')
text = path.read_text(encoding='utf-8')

# ════════════════════════════════════════════════════
# FIX 1: Igualar prompt EN con ES (más exhaustivo)
# ════════════════════════════════════════════════════
old_en_prompt = """      const extractPrompt = lang === 'en'
        ? `Extract EVERY piece of knowledge from this material. Be exhaustive, miss nothing.

IMPORTANT: Only extract facts that are EXPLICITLY stated in the material.
Do NOT invent or assume anything not written in the text.

List every concept, definition, fact, rule, date, name, formula, process, and exception.
Each item on its own line starting with "- ".
Include the actual values, names, and details from the text.

Material:
${chunk}`"""

new_en_prompt = """      const extractPrompt = lang === 'en'
        ? `You are an exhaustive knowledge extractor. Your mission: extract ABSOLUTELY EVERYTHING from the material, omit nothing.

STRICT RULES:
1. Extract EVERY fact, number, name, date, definition, rule, process, exception, formula, example
2. Only EXPLICIT facts in the text. Zero inventions.
3. Be granular: if there are 10 characteristics, list all 10 separately
4. Include exact numerical details (percentages, dates, quantities)
5. Each item on its own line starting with "- "
6. Minimum 20 concepts per page of material. More is better.

Material (${chunk.length} chars):
${chunk}`"""

if old_en_prompt in text:
    text = text.replace(old_en_prompt, new_en_prompt, 1)
    print("✅ FIX 1: Prompt EN actualizado (igual de exhaustivo que ES)")
else:
    print("❌ No encontré prompt EN")

# ════════════════════════════════════════════════════
# FIX 2: Procesar chunks en PARALELO (más rápido)
# ════════════════════════════════════════════════════
old_sequential = """    // ─── PASO 2: Extraer conceptos de cada chunk ───
    const allConcepts: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];"""

new_parallel = """    // ─── PASO 2: Extraer conceptos de cada chunk (PARALELO) ───
    const allConcepts: string[] = [];

    // Procesar hasta 3 chunks en paralelo para material largo
    const PARALLEL = 3;
    for (let start = 0; start < chunks.length; start += PARALLEL) {
      const batch_chunks = chunks.slice(start, start + PARALLEL);
      const batch_results = await Promise.all(
        batch_chunks.map(async (chunk, batchIdx) => {
          const i = start + batchIdx;"""

if old_sequential in text:
    text = text.replace(old_sequential, new_parallel, 1)
    print("✅ FIX 2a: Loop paralelo iniciado")
else:
    print("❌ No encontré loop secuencial")

# Cerrar el loop paralelo correctamente
# Hay que encontrar el cierre del for loop y añadir el cierre del Promise.all
old_loop_end = """      allConcepts.push(...concepts);
      console.log(`📝 Chunk ${i + 1}/${chunks.length}: ${concepts.length} conceptos | Total: ${allConcepts.length}`);
    }"""

new_loop_end = """          return concepts;
        })
      );
      // Aplanar resultados del batch paralelo
      for (let b = 0; b < batch_results.length; b++) {
        const concepts = batch_results[b];
        const i = start + b;
        allConcepts.push(...concepts);
        console.log(`📝 Chunk ${i + 1}/${chunks.length}: ${concepts.length} conceptos | Total: ${allConcepts.length}`);
      }
    }"""

if old_loop_end in text:
    text = text.replace(old_loop_end, new_loop_end, 1)
    print("✅ FIX 2b: Loop paralelo cerrado correctamente")
else:
    print("❌ No encontré cierre del loop")
    # Buscar la línea exacta
    if 'allConcepts.push(...concepts)' in text:
        idx = text.find('allConcepts.push(...concepts)')
        print(f"   Contexto: {repr(text[idx-20:idx+120])}")

# Necesitamos también ajustar el return de concepts dentro del map
# El groqRequest devuelve concepts, hay que hacer que el bloque lo retorne
old_concepts_push = """      allConcepts.push(...concepts);"""
# Ya fue reemplazado arriba, verificar

path.write_text(text, encoding='utf-8')
print("\n✅ Flashcards route actualizada con paralelo")

# Verificar resultado
text_check = path.read_text(encoding='utf-8')
if 'Promise.all' in text_check:
    print("✅ Promise.all confirmado en el archivo")
if 'PARALLEL = 3' in text_check:
    print("✅ PARALLEL = 3 confirmado")
