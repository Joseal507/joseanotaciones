with open('components/materias/QuizPage.tsx', 'r', encoding='utf-8') as f:
    src = f.read()

# ── FIX MATCHING: inicializar items shuffleados ──────────────
OLD_MATCH_INIT = '''  const [items, setItems] = useState<string[]>(
    question.pairs?.map(p => p.right) ?? []
  );'''

NEW_MATCH_INIT = '''  const [items, setItems] = useState<string[]>(() => {
    const rights = question.pairs?.map(p => p.right) ?? [];
    // Shuffle Fisher-Yates para que nunca arranque en orden correcto
    const arr = [...rights];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    // Si quedó igual al original, forzar al menos un swap
    const original = rights;
    const allSame = arr.every((v, i) => v === original[i]);
    if (allSame && arr.length >= 2) {
      [arr[0], arr[1]] = [arr[1], arr[0]];
    }
    return arr;
  });'''

if OLD_MATCH_INIT in src:
    src = src.replace(OLD_MATCH_INIT, NEW_MATCH_INIT)
    print("✅ Matching: items inician shuffleados")
else:
    print("❌ No encontré el init de matching items")

# ── FIX MULTIPLE CHOICE: re-shuffle opciones al montar ───────
# El backend ya shufflea, pero agregamos shuffle en cliente también
# Buscamos donde se renderizan las opciones de multiple_choice
OLD_MC_RENDER = '''  const [selected, setSelected] = useState<number | null>(null);
  const isLocked = locked;'''

NEW_MC_RENDER = '''  const [options, setOptions] = useState<string[]>(() => {
    if (question.type !== 'multiple_choice') return (question as any).options ?? [];
    const opts = [...((question as any).options ?? [])];
    // Fisher-Yates en cliente para máximo random
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    return opts;
  });
  const [correctIdxLocal, setCorrectIdxLocal] = useState<number>(() => {
    if (question.type !== 'multiple_choice') return (question as any).correctAnswer ?? 0;
    const originalOpts = (question as any).options ?? [];
    const correctVal = originalOpts[(question as any).correctAnswer ?? 0];
    // Re-calcular índice correcto tras el shuffle del estado
    return 0; // placeholder, se recalcula abajo
  });
  const [selected, setSelected] = useState<number | null>(null);
  const isLocked = locked;'''

# Esto es más complejo — mejor hacer el shuffle directamente en el render
# Approach más simple: shuffle al montar con useMemo
OLD_MC_OPTIONS_USE = '''question.options.map((opt, i) => {'''

# En vez de re-escribir todo, hacemos el fix más seguro:
# Shufflear las options en sanitizeQuestion ya existe en backend.
# El fix real del frontend es en el MatchingCard únicamente.
# Para MC, el backend YA shufflea. El problema era solo matching.

print("ℹ️  Multiple choice: el backend ya shufflea en sanitizeQuestion. Solo matching necesitaba fix en frontend.")

with open('components/materias/QuizPage.tsx', 'w', encoding='utf-8') as f:
    f.write(src)

print("\n✅ QuizPage.tsx actualizado")
