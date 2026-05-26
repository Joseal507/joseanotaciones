path = 'components/materias/QuizPage.tsx'

with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

# Marcadores exactos
feedback_start = "// ─── FeedbackBox ──────────────────────────────────────────────"
options_start  = "// ═══════════════════════════════════════════════════════════════\n// QUESTION OPTIONS — 6 tipos"
matching_start = "// ─── Matching visual con líneas ─────────────────────────────────"
normalize_start = "function normalizeEvalText("

# Verificar que existen
for name, marker in [
    ("FeedbackBox", feedback_start),
    ("QuestionOptions", options_start),
    ("MatchingQuestion", matching_start),
    ("normalizeEvalText", normalize_start),
]:
    print(f"{'✅' if marker in src else '❌'} {name}: {'encontrado' if marker in src else 'NO ENCONTRADO'}")

if not all(m in src for m in [feedback_start, options_start, matching_start, normalize_start]):
    print("❌ Faltan marcadores, abortando")
    raise SystemExit(1)

# Extraer cada bloque
def extract_block(text, start_marker, end_marker):
    s = text.index(start_marker)
    e = text.index(end_marker, s)
    return text[s:e], s, e

# Posiciones actuales
fb_pos    = src.index(feedback_start)
opts_pos  = src.index(options_start)
match_pos = src.index(matching_start)
norm_pos  = src.index(normalize_start)

print(f"\nOrden actual:")
print(f"  FeedbackBox:      línea ~{src[:fb_pos].count(chr(10))}")
print(f"  QuestionOptions:  línea ~{src[:opts_pos].count(chr(10))}")
print(f"  normalizeEvalText: línea ~{src[:norm_pos].count(chr(10))}")
print(f"  MatchingQuestion: línea ~{src[:match_pos].count(chr(10))}")

# El orden correcto debe ser:
# 1. normalizeEvalText + diceSimilarity + tokenOverlapScore + getQuizAnswerFeedback
# 2. MatchingQuestion
# 3. QuestionOptions  
# 4. FeedbackBox

# Extraer bloque FeedbackBox (de su inicio hasta QuestionOptions)
fb_block = src[fb_pos:opts_pos]

# Quitar FeedbackBox de donde está
src_without_fb = src[:fb_pos] + src[opts_pos:]

# Ahora insertar FeedbackBox justo DESPUÉS de QuestionOptions
# Buscar el fin de QuestionOptions (es justo antes de MatchingQuestion o al final del bloque)
# QuestionOptions termina justo antes de matching_start en el texto modificado
match_pos2 = src_without_fb.index(matching_start)

# Insertar al final de QuestionOptions (antes de MatchingQuestion)
src_new = src_without_fb[:match_pos2] + fb_block + src_without_fb[match_pos2:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(src_new)

print("\n✅ FeedbackBox movida después de QuestionOptions")
print("Nuevo orden:")
for name, marker in [
    ("normalizeEvalText", normalize_start),
    ("QuestionOptions", options_start),
    ("FeedbackBox", feedback_start),
    ("MatchingQuestion", matching_start),
]:
    if marker in src_new:
        print(f"  línea ~{src_new[:src_new.index(marker)].count(chr(10))}: {name}")
