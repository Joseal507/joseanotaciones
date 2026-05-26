path = 'components/materias/QuizPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

# El problema: dentro de FeedbackBox (línea ~1620) hay código de getQuizAnswerFeedback
# que se insertó mal. Necesitamos encontrar dónde empieza el bloque malo
# y cortarlo hasta donde debería terminar FeedbackBox realmente.

# Buscar el inicio del bloque malo dentro de FeedbackBox
bad_start_marker = """    if (question.type === 'short_answer') {
    const accepted: string[] = Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers : [];
    const user = String(userAnswer || '').trim();

    if (!user) {
      return {
        label: 'Incorrecto',
        percent: 0,
        color: bad,
        reason: 'No escribiste una respuesta. Se esperaba: "' + (accepted[0] ?? '') + '".'
      };
    }"""

# Buscar dónde termina el bloque malo (justo antes de "// ─── Matching visual")
end_bad_marker = "\n// ─── Matching visual con líneas ─────────────────────────────────"

if bad_start_marker in src and end_bad_marker in src:
    bad_start = src.index(bad_start_marker)
    
    # Retroceder para ver qué había justo antes del bloque malo
    # Debería ser el cierre de short_answer en correctLabel dentro de FeedbackBox
    # Buscar la línea anterior al bloque malo
    before = src[:bad_start]
    
    # El bloque malo termina justo antes de "// ─── Matching visual"
    bad_end = src.index(end_bad_marker)
    
    # Lo que hay entre bad_start y bad_end es basura que hay que borrar
    # Pero necesitamos cerrar bien FeedbackBox primero
    # Ver qué había justo antes del bloque malo
    print("=== CONTEXTO ANTES DEL BLOQUE MALO ===")
    print(repr(before[-300:]))
    print("=== PRIMERAS LÍNEAS DEL BLOQUE MALO ===")
    print(repr(src[bad_start:bad_start+200]))
    print("=== CONTEXTO DESPUÉS DEL BLOQUE MALO ===")
    print(repr(src[bad_end:bad_end+200]))
else:
    print(f"bad_start found: {bad_start_marker in src}")
    print(f"end_bad found: {end_bad_marker in src}")
    # Buscar alternativos
    idx = src.find("if (question.type === 'short_answer') {\n    const accepted")
    print(f"short_answer block at: {idx}")
    if idx > 0:
        print(repr(src[idx-200:idx+100]))
