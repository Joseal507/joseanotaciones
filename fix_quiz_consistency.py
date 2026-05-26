import re

path = 'components/materias/QuizPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

changes = []

# ============================================================
# 1) TRUE/FALSE feedback: convertir 0/1 -> boolean
# ============================================================
tf_pattern = re.compile(
    r"""if \(question\.type === 'true_false'\) \{
[\s\S]*?
\}
\s*
\s*if \(question\.type === 'multi_select'\) \{""",
    re.S
)

tf_replacement = """if (question.type === 'true_false') {
    const correct = !!question.correctAnswer;

    const normalizedUser =
      userAnswer === null || userAnswer === undefined
        ? null
        : typeof userAnswer === 'boolean'
        ? userAnswer
        : userAnswer === 0
        ? true
        : userAnswer === 1
        ? false
        : !!userAnswer;

    if (normalizedUser === correct) {
      return {
        label: 'Correcto',
        percent: 100,
        color: good,
        reason: `Marcaste "${correct ? 'Verdadero' : 'Falso'}", que es la respuesta correcta.`
      };
    }

    if (normalizedUser === null) {
      return {
        label: 'Incorrecto',
        percent: 0,
        color: bad,
        reason: `No seleccionaste una opción. La respuesta correcta era "${correct ? 'Verdadero' : 'Falso'}".`
      };
    }

    return {
      label: 'Incorrecto',
      percent: 0,
      color: bad,
      reason: `Marcaste "${normalizedUser ? 'Verdadero' : 'Falso'}", pero la correcta era "${correct ? 'Verdadero' : 'Falso'}".`
    };
  }

  if (question.type === 'multi_select') {"""

src2, n = tf_pattern.subn(tf_replacement, src, count=1)
if n:
    src = src2
    changes.append("✅ True/False feedback corregido")
else:
    changes.append("❌ No encontré el bloque true_false de feedback")

# ============================================================
# 2) MatchingQuestion completa:
#    - click izquierda -> click derecha
#    - si la derecha ya estaba ocupada, se reasigna al nuevo left
#    - setUserAnswer se sincroniza al instante
#    - verificar funciona
# ============================================================
start_marker = "// ─── Matching con Reorder ─────────────────────────────────────"
end_marker = "// RESULTS SCREEN"

if start_marker in src and end_marker in src:
    start = src.index(start_marker)
    end = src.index(end_marker)

    new_matching = """// ─── Matching con Reorder ─────────────────────────────────────
function MatchingQuestion({
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

  const [shuffledRight] = useState<string[]>(() => {
    const rights = pairs.map(p => p.right);
    const arr = [...rights];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (arr.length >= 2 && arr.every((v, i) => v === rights[i])) {
      [arr[0], arr[arr.length - 1]] = [arr[arr.length - 1], arr[0]];
    }
    return arr;
  });

  const [connections, setConnections] = useState<Record<number, number>>({});
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);

  const buildAnswer = (map: Record<number, number>) => {
    const hasAny = Object.keys(map).length > 0;
    if (!hasAny) return null;
    return pairs.map((_, i) => {
      const rIdx = map[i];
      return rIdx !== undefined ? shuffledRight[rIdx] : null;
    });
  };

  useEffect(() => {
    setUserAnswer(buildAnswer(connections));
  }, []); // inicializar

  const applyConnections = (next: Record<number, number>) => {
    setConnections(next);
    setUserAnswer(buildAnswer(next));
  };

  const connect = (leftIdx: number, rightIdx: number) => {
    const next = { ...connections };

    // Si ese right ya estaba usado por otro left, quitarlo de ahí
    for (const key of Object.keys(next)) {
      if (next[Number(key)] === rightIdx) {
        delete next[Number(key)];
      }
    }

    // Reemplazar también lo que tuviera este left
    next[leftIdx] = rightIdx;

    applyConnections(next);
  };

  const disconnectLeft = (leftIdx: number) => {
    const next = { ...connections };
    delete next[leftIdx];
    applyConnections(next);
  };

  const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
  const getColor = (i: number) => COLORS[i % COLORS.length];

  const handleLeftClick = (leftIdx: number) => {
    if (isLocked) return;

    if (selectedLeft === leftIdx) {
      setSelectedLeft(null);
      return;
    }

    setSelectedLeft(leftIdx);
  };

  const handleRightClick = (rightIdx: number) => {
    if (isLocked) return;

    // Si hay izquierda seleccionada, SIEMPRE reasignar en el mismo click
    if (selectedLeft !== null) {
      connect(selectedLeft, rightIdx);
      setSelectedLeft(null);
      return;
    }

    // Si no hay izquierda seleccionada y este right ya estaba usado, desconectarlo
    const existing = Object.entries(connections).find(([, r]) => Number(r) === rightIdx);
    if (existing) {
      disconnectLeft(Number(existing[0]));
    }
  };

  const results = pairs.map((pair, leftIdx) => {
    const rIdx = connections[leftIdx];
    if (rIdx === undefined) {
      return {
        connected: false,
        correct: false,
        userAnswer: null,
        correctAnswer: pair.right,
      };
    }

    const picked = shuffledRight[rIdx];
    return {
      connected: true,
      correct: picked === pair.right,
      userAnswer: picked,
      correctAnswer: pair.right,
    };
  });

  const correctCount = results.filter(r => r.correct).length;
  const total = Math.max(results.length, 1);
  const percent = Math.round((correctCount / total) * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!isLocked && (
        <div
          style={{
            fontSize: 12,
            color: '#888',
            textAlign: 'center',
            fontFamily: BODY,
            fontStyle: 'italic',
          }}
        >
          Toca un elemento de la izquierda y luego su pareja de la derecha. Si la derecha ya estaba ocupada, se reasigna a la nueva selección.
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 48px 1fr',
          gap: 8,
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pairs.map((p, i) => {
            const isSelected = selectedLeft === i;
            const isConnected = connections[i] !== undefined;
            const res = results[i];

            const border = isLocked
              ? (res.connected ? (res.correct ? '#10b981' : '#ef4444') : '#cbd5e1')
              : isSelected ? themeColor
              : isConnected ? getColor(i)
              : 'rgba(0,0,0,0.14)';

            const bg = isLocked
              ? (res.connected ? (res.correct ? '#ecfdf5' : '#fef2f2') : '#f8fafc')
              : isSelected ? `${themeColor}18`
              : isConnected ? `${getColor(i)}12`
              : 'rgba(0,0,0,0.03)';

            return (
              <button
                key={`left-${i}`}
                onClick={() => handleLeftClick(i)}
                style={{
                  minHeight: 58,
                  padding: '12px 14px',
                  borderRadius: 14,
                  border: `2.5px solid ${border}`,
                  background: bg,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  textAlign: 'left',
                  cursor: isLocked ? 'default' : 'pointer',
                  fontFamily: BODY,
                }}
              >
                {isLocked ? (
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 900,
                      color: res.connected ? (res.correct ? '#10b981' : '#ef4444') : '#94a3b8',
                      flexShrink: 0,
                    }}
                  >
                    {res.connected ? (res.correct ? '✓' : '✕') : '•'}
                  </span>
                ) : isConnected ? (
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: getColor(i),
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 900,
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </span>
                ) : isSelected ? (
                  <span style={{ color: themeColor, fontWeight: 900, flexShrink: 0 }}>●</span>
                ) : null}

                <span style={{ fontSize: 14, fontWeight: 700, color: '#222', lineHeight: 1.35 }}>
                  {p.left}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pairs.map((_, i) => {
            const isConnected = connections[i] !== undefined;
            const res = results[i];
            const color = isLocked
              ? (res.connected ? (res.correct ? '#10b981' : '#ef4444') : '#cbd5e1')
              : isConnected ? getColor(i) : '#cbd5e1';

            return (
              <div
                key={`mid-${i}`}
                style={{
                  minHeight: 58,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color,
                  fontWeight: 900,
                  fontSize: 18,
                  fontFamily: BODY,
                }}
              >
                {isConnected ? '→' : '·'}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shuffledRight.map((item, rIdx) => {
            const found = Object.entries(connections).find(([, r]) => Number(r) === rIdx);
            const connected = !!found;
            const leftIdx = found ? Number(found[0]) : -1;
            const res = connected ? results[leftIdx] : null;

            const border = isLocked
              ? (connected ? (res?.correct ? '#10b981' : '#ef4444') : '#cbd5e1')
              : connected ? getColor(leftIdx)
              : selectedLeft !== null ? themeColor + '88'
              : 'rgba(0,0,0,0.14)';

            const bg = isLocked
              ? (connected ? (res?.correct ? '#ecfdf5' : '#fef2f2') : '#fff')
              : connected ? `${getColor(leftIdx)}12`
              : selectedLeft !== null ? `${themeColor}10`
              : '#fff';

            return (
              <button
                key={`right-${rIdx}`}
                onClick={() => handleRightClick(rIdx)}
                style={{
                  minHeight: 58,
                  padding: '12px 14px',
                  borderRadius: 14,
                  border: `2.5px solid ${border}`,
                  background: bg,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  textAlign: 'left',
                  cursor: isLocked ? 'default' : 'pointer',
                  fontFamily: BODY,
                }}
              >
                {isLocked && connected ? (
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 900,
                      color: res?.correct ? '#10b981' : '#ef4444',
                      flexShrink: 0,
                    }}
                  >
                    {res?.correct ? '✓' : '✕'}
                  </span>
                ) : !isLocked && connected ? (
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: getColor(leftIdx),
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 900,
                      flexShrink: 0,
                    }}
                  >
                    {leftIdx + 1}
                  </span>
                ) : null}

                <span style={{ fontSize: 14, fontWeight: 700, color: '#222', lineHeight: 1.35 }}>
                  {item}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {isLocked && (
        <div
          style={{
            padding: '14px 16px',
            borderRadius: 14,
            background: percent === 100 ? '#ecfdf5' : percent > 0 ? '#fffbeb' : '#fef2f2',
            border: `1px solid ${percent === 100 ? '#10b98133' : percent > 0 ? '#f59e0b33' : '#ef444433'}`,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 900,
              fontFamily: BODY,
              marginBottom: 8,
              color: percent === 100 ? '#10b981' : percent > 0 ? '#d97706' : '#ef4444',
            }}
          >
            {percent === 100 ? 'Correcto' : percent > 0 ? 'Parcialmente correcto' : 'Incorrecto'} — {correctCount}/{results.length} relaciones correctas ({percent}%)
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {results.map((r, i) => (
              <div
                key={i}
                style={{
                  fontSize: 13,
                  color: '#555',
                  lineHeight: 1.45,
                  fontFamily: BODY,
                }}
              >
                <span style={{ fontWeight: 900, color: r.correct ? '#10b981' : '#ef4444' }}>
                  {r.correct ? '✓' : '✕'}
                </span>
                {' '}<strong>{pairs[i].left}</strong>
                {' → '}
                {r.connected ? (
                  <>
                    <span style={{ color: r.correct ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                      {r.userAnswer}
                    </span>
                    {!r.correct && (
                      <span style={{ color: '#64748b' }}>
                        {' · correcto: '}
                        <span style={{ color: '#10b981', fontWeight: 700 }}>{r.correctAnswer}</span>
                      </span>
                    )}
                  </>
                ) : (
                  <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>
                    sin conectar · correcto: <span style={{ color: '#10b981', fontWeight: 700 }}>{r.correctAnswer}</span>
                  </span>
                )}
              </div>
            ))}
          </div>

          {question.explanation && (
            <div style={{ marginTop: 10, fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: BODY }}>
              💡 {question.explanation}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"""
    src = src[:start] + new_matching + src[end:]
    changes.append("✅ Matching reemplazado: reasignación 1→1 y sync inmediata")
else:
    changes.append("❌ No encontré el bloque MatchingQuestion")

# ============================================================
# 3) Enter global = verificar / siguiente
# ============================================================
if "const onQuizEnterGlobal" not in src:
    insert_pattern = re.compile(
        r"(const handleNext = useCallback\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);)",
        re.S
    )
    enter_block = r"""\1

  useEffect(() => {
    const onQuizEnterGlobal = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName?.toLowerCase();
      if (tag === 'textarea') return;

      e.preventDefault();

      if (isLocked) {
        handleNext();
        return;
      }

      if (userAnswer !== null && userAnswer !== undefined) {
        handleVerify();
      }
    };

    window.addEventListener('keydown', onQuizEnterGlobal);
    return () => window.removeEventListener('keydown', onQuizEnterGlobal);
  }, [isLocked, userAnswer, handleVerify, handleNext]);"""

    src2, n = insert_pattern.subn(enter_block, src, count=1)
    if n:
        src = src2
        changes.append("✅ Enter global agregado")
    else:
        changes.append("❌ No pude insertar el Enter global")
else:
    changes.append("ℹ️ Enter global ya existía")

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)

print('\\n'.join(changes))
