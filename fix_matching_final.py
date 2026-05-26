import re

quiz_path = 'components/materias/QuizPage.tsx'
with open(quiz_path, 'r', encoding='utf-8') as f:
    quiz = f.read()

changed = False

# ══════════════════════════════════════════════════════════════
# 1. Reemplazar MatchingQuestion COMPLETA
# ══════════════════════════════════════════════════════════════

# Encontrar y reemplazar la función completa
old_pattern = re.compile(
    r'(// ─── Matching con Reorder ─+\n)function MatchingQuestion\(\{[\s\S]*?\n\}\n(\n// ═+\n// RESULTS SCREEN)',
    re.S
)

new_matching = r'''\1function MatchingQuestion({
  question,
  userAnswer,
  setUserAnswer,
  isLocked,
  themeColor,
}: {
  question: Question;
  userAnswer: any;
  setUserAnswer: (v: any) => void;
  isLocked: boolean;
  themeColor: string;
}) {
  const pairs = question.pairs ?? [];
  
  // Columna derecha shuffleada
  const [shuffledRight] = useState<string[]>(() => {
    const rights = pairs.map(p => p.right);
    const arr = [...rights];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (arr.length >= 2 && arr.every((v, k) => v === rights[k])) {
      [arr[0], arr[arr.length - 1]] = [arr[arr.length - 1], arr[0]];
    }
    return arr;
  });

  // connections: { [leftIndex]: rightIndex }
  const [connections, setConnections] = useState<Record<number, number>>({});
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);
  const [selectedRight, setSelectedRight] = useState<number | null>(null);

  // Sincronizar userAnswer con connections
  useEffect(() => {
    const answer = pairs.map((_, i) => {
      const rightIdx = connections[i];
      return rightIdx !== undefined ? shuffledRight[rightIdx] : null;
    });
    setUserAnswer(answer);
  }, [connections, shuffledRight, pairs.length, setUserAnswer]);

  const handleLeftClick = (leftIdx: number) => {
    if (isLocked) return;
    
    // Si ya está conectado, desconectar
    if (connections[leftIdx] !== undefined) {
      setConnections(prev => {
        const next = { ...prev };
        delete next[leftIdx];
        return next;
      });
      setSelectedLeft(null);
      setSelectedRight(null);
      return;
    }

    setSelectedLeft(leftIdx);

    // Si ya hay un derecho seleccionado, conectar
    if (selectedRight !== null) {
      // Verificar que el derecho no esté ya usado
      const rightAlreadyUsed = Object.values(connections).includes(selectedRight);
      if (!rightAlreadyUsed) {
        setConnections(prev => ({ ...prev, [leftIdx]: selectedRight }));
      }
      setSelectedLeft(null);
      setSelectedRight(null);
    }
  };

  const handleRightClick = (rightIdx: number) => {
    if (isLocked) return;

    // Si ya está conectado, desconectar
    const connectedLeft = Object.entries(connections).find(([, r]) => r === rightIdx);
    if (connectedLeft) {
      setConnections(prev => {
        const next = { ...prev };
        delete next[Number(connectedLeft[0])];
        return next;
      });
      setSelectedLeft(null);
      setSelectedRight(null);
      return;
    }

    setSelectedRight(rightIdx);

    // Si ya hay un izquierdo seleccionado, conectar
    if (selectedLeft !== null) {
      // Verificar que el izquierdo no esté ya conectado
      if (connections[selectedLeft] === undefined) {
        setConnections(prev => ({ ...prev, [selectedLeft]: rightIdx }));
      }
      setSelectedLeft(null);
      setSelectedRight(null);
    }
  };

  // Colores para las líneas de conexión
  const connectionColors = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
  ];

  const getConnectionColor = (leftIdx: number) => {
    return connectionColors[leftIdx % connectionColors.length];
  };

  // Verificar resultados cuando está locked
  const results = pairs.map((pair, leftIdx) => {
    const rightIdx = connections[leftIdx];
    if (rightIdx === undefined) return { connected: false, correct: false, userAnswer: null, correctAnswer: pair.right };
    const userRight = shuffledRight[rightIdx];
    return {
      connected: true,
      correct: userRight === pair.right,
      userAnswer: userRight,
      correctAnswer: pair.right,
    };
  });

  const correctCount = results.filter(r => r.correct).length;
  const allConnected = Object.keys(connections).length === pairs.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'start' }}>
        
        {/* Columna izquierda */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pairs.map((p, i) => {
            const isConnected = connections[i] !== undefined;
            const isSelected = selectedLeft === i;
            const result = isLocked ? results[i] : null;
            const borderColor = isLocked
              ? (result?.connected ? (result.correct ? '#10b981' : '#ef4444') : '#aaa')
              : isSelected
                ? themeColor
                : isConnected
                  ? getConnectionColor(i)
                  : 'rgba(0,0,0,0.15)';
            const bg = isLocked
              ? (result?.connected ? (result.correct ? '#ecfdf5' : '#fef2f2') : '#f9fafb')
              : isSelected
                ? `${themeColor}15`
                : isConnected
                  ? `${getConnectionColor(i)}12`
                  : 'rgba(0,0,0,0.04)';

            return (
              <button
                key={`left-${i}`}
                onClick={() => handleLeftClick(i)}
                style={{
                  height: 54,
                  padding: '0 16px',
                  background: bg,
                  border: `2.5px solid ${borderColor}`,
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#333',
                  fontFamily: BODY,
                  cursor: isLocked ? 'default' : 'pointer',
                  transition: 'all 0.15s',
                  textAlign: 'left',
                }}
              >
                {isConnected && !isLocked && (
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: getConnectionColor(i),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: '#fff', fontWeight: 900, flexShrink: 0,
                  }}>
                    {i + 1}
                  </span>
                )}
                {isLocked && result?.connected && (
                  <span style={{ fontSize: 16, fontWeight: 900, color: result.correct ? '#10b981' : '#ef4444', flexShrink: 0 }}>
                    {result.correct ? '✓' : '✕'}
                  </span>
                )}
                <span style={{ flex: 1 }}>{p.left}</span>
              </button>
            );
          })}
        </div>

        {/* Columna central — indicadores de conexión */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 0, minWidth: 40, alignItems: 'center' }}>
          {pairs.map((_, i) => {
            const isConnected = connections[i] !== undefined;
            const result = isLocked ? results[i] : null;
            return (
              <div
                key={`arrow-${i}`}
                style={{
                  height: 54,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  color: isLocked
                    ? (result?.connected ? (result.correct ? '#10b981' : '#ef4444') : '#ccc')
                    : isConnected
                      ? getConnectionColor(i)
                      : '#ddd',
                  transition: 'all 0.2s',
                }}
              >
                {isConnected ? '━━▶' : '· · ·'}
              </div>
            );
          })}
        </div>

        {/* Columna derecha — shuffleada */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shuffledRight.map((item, rIdx) => {
            const isSelected = selectedRight === rIdx;
            const connectedLeftIdx = Object.entries(connections).find(([, r]) => r === rIdx);
            const isConnected = !!connectedLeftIdx;
            const leftIdx = connectedLeftIdx ? Number(connectedLeftIdx[0]) : -1;
            const result = isLocked && isConnected ? results[leftIdx] : null;
            const borderColor = isLocked
              ? (isConnected ? (result?.correct ? '#10b981' : '#ef4444') : '#aaa')
              : isSelected
                ? themeColor
                : isConnected
                  ? getConnectionColor(leftIdx)
                  : 'rgba(0,0,0,0.15)';
            const bg = isLocked
              ? (isConnected ? (result?.correct ? '#ecfdf5' : '#fef2f2') : '#f9fafb')
              : isSelected
                ? `${themeColor}15`
                : isConnected
                  ? `${getConnectionColor(leftIdx)}12`
                  : '#fff';

            return (
              <button
                key={`right-${rIdx}`}
                onClick={() => handleRightClick(rIdx)}
                style={{
                  height: 54,
                  padding: '0 16px',
                  background: bg,
                  border: `2.5px solid ${borderColor}`,
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#222',
                  fontFamily: BODY,
                  cursor: isLocked ? 'default' : 'pointer',
                  transition: 'all 0.15s',
                  textAlign: 'left',
                }}
              >
                {isConnected && !isLocked && (
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: getConnectionColor(leftIdx),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: '#fff', fontWeight: 900, flexShrink: 0,
                  }}>
                    {leftIdx + 1}
                  </span>
                )}
                {isLocked && isConnected && (
                  <span style={{ fontSize: 16, fontWeight: 900, color: result?.correct ? '#10b981' : '#ef4444', flexShrink: 0 }}>
                    {result?.correct ? '✓' : '✕'}
                  </span>
                )}
                <span style={{ flex: 1 }}>{item}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Resultado al verificar */}
      {isLocked && (
        <div style={{
          padding: '12px 16px',
          borderRadius: 12,
          background: correctCount === pairs.length ? '#ecfdf5' : '#fef2f2',
          border: `1px solid ${correctCount === pairs.length ? '#10b98133' : '#ef444433'}`,
        }}>
          <div style={{
            fontSize: 14,
            fontWeight: 800,
            color: correctCount === pairs.length ? '#10b981' : '#ef4444',
            fontFamily: BODY,
            marginBottom: 8,
          }}>
            {correctCount}/{pairs.length} relaciones correctas
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {results.map((r, i) => (
              <div key={i} style={{ fontSize: 13, color: '#555', fontFamily: BODY }}>
                <span style={{ fontWeight: 700, color: r.correct ? '#10b981' : '#ef4444' }}>
                  {r.correct ? '✓' : '✕'}
                </span>
                {' '}{pairs[i].left} → {r.connected ? r.userAnswer : '(sin conectar)'}
                {!r.correct && (
                  <span style={{ color: '#10b981', fontWeight: 600 }}> (correcto: {r.correctAnswer})</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!isLocked && !allConnected && (
        <div style={{ fontSize: 12, color: '#999', fontFamily: BODY, textAlign: 'center', fontStyle: 'italic' }}>
          Toca un concepto de la izquierda y luego su par de la derecha. Toca de nuevo para desconectar.
        </div>
      )}
    </div>
  );
}

\2'''

m2 = old_pattern.search(quiz)
if m2:
    quiz = old_pattern.sub(new_matching, quiz, count=1)
    changed = True
    print("✅ MatchingQuestion reemplazada completamente con sistema de flechas")
else:
    print("❌ No encontré la función MatchingQuestion para reemplazar")


# ══════════════════════════════════════════════════════════════
# 2. Fix validación: matching valida par por par
# ══════════════════════════════════════════════════════════════

old_validation = re.compile(
    r"""if \(q\.type === 'matching'\) \{[^}]*?return Array\.isArray\((\w+)\)[^}]*?\}""",
    re.S
)

m3 = old_validation.search(quiz)
if m3:
    answer_var = m3.group(1)
    new_validation = f"""if (q.type === 'matching') {{
      const correctRights = q.pairs?.map(p => p.right) ?? [];
      if (!Array.isArray({answer_var})) return false;
      return correctRights.every((right, i) => {answer_var}[i] === right);
    }}"""
    quiz = old_validation.sub(new_validation, quiz, count=1)
    changed = True
    print("✅ Validación de matching actualizada (par por par)")
else:
    print("ℹ️ Validación de matching ya actualizada o no encontrada")


# ══════════════════════════════════════════════════════════════
# 3. Quitar import de Reorder si ya no se usa en otro lado
# ══════════════════════════════════════════════════════════════
# No quitar — puede usarse en otro componente. Solo verificar.
if 'Reorder.Group' not in quiz and 'Reorder.Item' not in quiz:
    quiz = quiz.replace(", Reorder ", " ")
    quiz = quiz.replace(", Reorder}", "}")
    print("✅ Import de Reorder limpiado")


# ══════════════════════════════════════════════════════════════
# 4. Enter global para verificar/siguiente
# ══════════════════════════════════════════════════════════════
if "onQuizEnterKey" not in quiz:
    enter_hook = '''
  // ── Enter = Verificar / Siguiente ──────────────────────────
  useEffect(() => {
    const onQuizEnterKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'textarea') return;
      
      e.preventDefault();
      
      const buttons = Array.from(document.querySelectorAll('button')).filter(btn => {
        const s = window.getComputedStyle(btn);
        return s.display !== 'none' && s.visibility !== 'hidden' && !btn.disabled;
      }) as HTMLButtonElement[];
      
      const verify = buttons.find(b => /verificar|comprobar|check/i.test(b.textContent || ''));
      const next = buttons.find(b => /siguiente|next/i.test(b.textContent || ''));
      (verify || next)?.click();
    };
    window.addEventListener('keydown', onQuizEnterKey);
    return () => window.removeEventListener('keydown', onQuizEnterKey);
  }, []);

'''
    # Insertar antes del return principal del componente QuizPage
    insert_re = re.compile(r'(const handleNext = useCallback\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);)\n', re.S)
    m4 = insert_re.search(quiz)
    if m4:
        insert_pos = m4.end()
        quiz = quiz[:insert_pos] + enter_hook + quiz[insert_pos:]
        changed = True
        print("✅ Enter global agregado (Verificar / Siguiente)")
    else:
        print("❌ No pude insertar el hook de Enter")


with open(quiz_path, 'w', encoding='utf-8') as f:
    f.write(quiz)

print(f"\n{'✅ QuizPage.tsx actualizado' if changed else 'ℹ️ Sin cambios'}")
