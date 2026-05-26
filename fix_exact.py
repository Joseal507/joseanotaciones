path = 'components/materias/QuizPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

changes = []

# ============================================================
# FIX 1: checkAnswer matching — 'a' no definida → userAnswer
# ============================================================
old = """  if (q.type === 'matching') {
      const rights = q.pairs?.map(p => p.right) ?? [];
      return Array.isArray(a) &&
        a.length === rights.length &&
        rights.every((right, i) => a[i] === right);
    }"""

new = """  if (q.type === 'matching') {
    const rights = q.pairs?.map(p => p.right) ?? [];
    if (!Array.isArray(userAnswer)) return false;
    return userAnswer.length === rights.length &&
      rights.every((right, i) => userAnswer[i] === right);
  }"""

if old in src:
    src = src.replace(old, new)
    changes.append("✅ FIX 1: checkAnswer — 'a' → userAnswer")
else:
    changes.append("❌ FIX 1: no encontré el bloque exacto")

# ============================================================
# FIX 2: true_false feedback — userAnswer=0 es Verdadero
# Líneas 2206-2230 aprox
# ============================================================
old_tf = """  if (question.type === 'true_false') {
    const correct = !!question.correctAnswer;
    if (userAnswer === question.correctAnswer) {
      return {
        label: 'Correcto',
        percent: 100,
        color: good,
        reason: `Marcaste "${correct ? 'Verdadero' : 'Falso'}", que es la respuesta correcta.`
      };
    }

    if (userAnswer === null || userAnswer === undefined) {
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
      reason: `Marcaste "${userAnswer ? 'Verdadero' : 'Falso'}", pero la correcta era "${correct ? 'Verdadero' : 'Falso'}".`
    };
  }"""

new_tf = """  if (question.type === 'true_false') {
    // correctAnswer puede ser boolean true/false o 0/1
    // userAnswer es 0 (Verdadero) o 1 (Falso) desde la UI
    const correctIsTrue =
      question.correctAnswer === true ||
      question.correctAnswer === 0 ||
      String(question.correctAnswer).toLowerCase() === 'true' ||
      String(question.correctAnswer).toLowerCase() === 'verdadero';

    const userIsTrue =
      userAnswer === 0 ||
      userAnswer === true ||
      String(userAnswer).toLowerCase() === 'true' ||
      String(userAnswer).toLowerCase() === 'verdadero';

    const isCorrect = correctIsTrue === userIsTrue;

    const correctLabel = correctIsTrue ? 'Verdadero' : 'Falso';
    const userLabel =
      userAnswer === null || userAnswer === undefined
        ? null
        : userIsTrue ? 'Verdadero' : 'Falso';

    if (userLabel === null) {
      return {
        label: 'Incorrecto',
        percent: 0,
        color: bad,
        reason: `No seleccionaste una opción. La respuesta correcta era "${correctLabel}".`
      };
    }

    if (isCorrect) {
      return {
        label: 'Correcto',
        percent: 100,
        color: good,
        reason: `Marcaste "${userLabel}", que es la respuesta correcta.`
      };
    }

    return {
      label: 'Incorrecto',
      percent: 0,
      color: bad,
      reason: `Marcaste "${userLabel}", pero la correcta era "${correctLabel}".`
    };
  }"""

if old_tf in src:
    src = src.replace(old_tf, new_tf)
    changes.append("✅ FIX 2: true_false feedback corregido")
else:
    changes.append("❌ FIX 2: no encontré el bloque true_false de feedback")

# ============================================================
# FIX 3: MatchingQuestion — buscar por línea exacta y reemplazar
# ============================================================
import re

# Encontrar la función MatchingQuestion
match_fn_start = src.find("function MatchingQuestion(")
if match_fn_start == -1:
    changes.append("❌ FIX 3: no encontré function MatchingQuestion")
else:
    # Encontrar el final de la función contando llaves
    i = match_fn_start
    depth = 0
    in_fn = False
    fn_end = -1
    while i < len(src):
        c = src[i]
        if c == '{':
            depth += 1
            in_fn = True
        elif c == '}':
            depth -= 1
            if in_fn and depth == 0:
                fn_end = i + 1
                break
        i += 1

    if fn_end == -1:
        changes.append("❌ FIX 3: no pude encontrar el fin de MatchingQuestion")
    else:
        new_matching_fn = '''function MatchingQuestion({
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
    if (arr.length >= 2 && arr.every((v, k) => v === rights[k])) {
      [arr[0], arr[arr.length - 1]] = [arr[arr.length - 1], arr[0]];
    }
    return arr;
  });

  // connections[leftIdx] = rightIdx en shuffledRight
  const [connections, setConnections] = useState<Record<number, number>>({});
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);

  // Sincronizar con el padre inmediatamente
  const applyAndSync = (next: Record<number, number>) => {
    setConnections(next);
    // Construir array en orden de pairs
    const hasAny = Object.keys(next).length > 0;
    const answer = hasAny
      ? pairs.map((_, i) => {
          const rIdx = next[i];
          return rIdx !== undefined ? shuffledRight[rIdx] : null;
        })
      : null;
    setUserAnswer(answer);
  };

  const connect = (leftIdx: number, rightIdx: number) => {
    const next = { ...connections };
    // Quitar cualquier left que ya tuviera este right
    for (const k of Object.keys(next)) {
      if (next[Number(k)] === rightIdx) delete next[Number(k)];
    }
    // Asignar (reemplaza si leftIdx ya tenía algo)
    next[leftIdx] = rightIdx;
    applyAndSync(next);
  };

  const disconnectLeft = (leftIdx: number) => {
    const next = { ...connections };
    delete next[leftIdx];
    applyAndSync(next);
  };

  const handleLeftClick = (leftIdx: number) => {
    if (isLocked) return;
    if (selectedLeft === leftIdx) {
      // Segundo click en el mismo: desconectar si estaba conectado
      if (connections[leftIdx] !== undefined) disconnectLeft(leftIdx);
      setSelectedLeft(null);
      return;
    }
    setSelectedLeft(leftIdx);
  };

  const handleRightClick = (rightIdx: number) => {
    if (isLocked) return;

    if (selectedLeft !== null) {
      // Siempre conectar: reemplaza lo que había en left y en right
      connect(selectedLeft, rightIdx);
      setSelectedLeft(null);
      return;
    }

    // Sin izquierda seleccionada: desconectar el right si estaba usado
    const existing = Object.entries(connections).find(([, r]) => Number(r) === rightIdx);
    if (existing) disconnectLeft(Number(existing[0]));
  };

  const COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
  const getColor = (i: number) => COLORS[i % COLORS.length];

  const results = pairs.map((pair, li) => {
    const ri = connections[li];
    if (ri === undefined) return { connected: false, correct: false, got: null as string|null, expected: pair.right };
    const got = shuffledRight[ri];
    return { connected: true, correct: got === pair.right, got, expected: pair.right };
  });

  const correctCount = results.filter(r => r.correct).length;
  const percent = Math.round(correctCount / Math.max(pairs.length, 1) * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!isLocked && (
        <div style={{ fontSize: 12, color: '#888', textAlign: 'center', fontFamily: BODY, fontStyle: 'italic' }}>
          Toca un elemento de la izquierda y luego su pareja de la derecha.
          Puedes reasignar tocando encima de una conexión existente.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 1fr', alignItems: 'start' }}>

        {/* Izquierda */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pairs.map((p, li) => {
            const isConn = connections[li] !== undefined;
            const isSel = selectedLeft === li;
            const res = results[li];
            const border = isLocked
              ? (res.connected ? (res.correct ? '#10b981' : '#ef4444') : '#d1d5db')
              : isSel ? themeColor : isConn ? getColor(li) : 'rgba(0,0,0,0.14)';
            const bg = isLocked
              ? (res.connected ? (res.correct ? '#ecfdf5' : '#fef2f2') : '#f8fafc')
              : isSel ? `${themeColor}18` : isConn ? `${getColor(li)}12` : 'rgba(0,0,0,0.03)';
            return (
              <button key={li} onClick={() => handleLeftClick(li)} style={{
                minHeight: 56, padding: '10px 14px', borderRadius: 13,
                border: `2.5px solid ${border}`, background: bg,
                display: 'flex', alignItems: 'center', gap: 9,
                textAlign: 'left', cursor: isLocked ? 'default' : 'pointer',
                fontFamily: BODY, transition: 'all 0.15s',
                boxShadow: isSel ? `0 0 0 3px ${themeColor}33` : 'none',
              }}>
                {isLocked ? (
                  <span style={{ fontSize: 15, fontWeight: 900, flexShrink: 0,
                    color: res.connected ? (res.correct ? '#10b981' : '#ef4444') : '#94a3b8' }}>
                    {res.connected ? (res.correct ? '✓' : '✕') : '·'}
                  </span>
                ) : isConn ? (
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: getColor(li),
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 900, flexShrink: 0 }}>{li + 1}</span>
                ) : isSel ? (
                  <span style={{ color: themeColor, fontWeight: 900, flexShrink: 0, fontSize: 12 }}>●</span>
                ) : null}
                <span style={{ fontSize: 14, fontWeight: 700, color: '#222', lineHeight: 1.35, flex: 1 }}>{p.left}</span>
              </button>
            );
          })}
        </div>

        {/* Centro */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pairs.map((_, li) => {
            const isConn = connections[li] !== undefined;
            const res = results[li];
            return (
              <div key={li} style={{ minHeight: 56, display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontWeight: 900, fontSize: 16,
                color: isLocked
                  ? (res.connected ? (res.correct ? '#10b981' : '#ef4444') : '#d1d5db')
                  : isConn ? getColor(li) : '#d1d5db',
                transition: 'color 0.2s',
              }}>
                {isConn ? '→' : '·'}
              </div>
            );
          })}
        </div>

        {/* Derecha */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shuffledRight.map((item, ri) => {
            const found = Object.entries(connections).find(([, r]) => Number(r) === ri);
            const isConn = !!found;
            const li = found ? Number(found[0]) : -1;
            const res = isConn ? results[li] : null;
            const isHighlighted = selectedLeft !== null && !isConn;
            const border = isLocked
              ? (isConn ? (res?.correct ? '#10b981' : '#ef4444') : '#d1d5db')
              : isConn ? getColor(li) : isHighlighted ? themeColor + '77' : 'rgba(0,0,0,0.14)';
            const bg = isLocked
              ? (isConn ? (res?.correct ? '#ecfdf5' : '#fef2f2') : '#f9fafb')
              : isConn ? `${getColor(li)}12` : isHighlighted ? `${themeColor}09` : '#fff';
            return (
              <button key={ri} onClick={() => handleRightClick(ri)} style={{
                minHeight: 56, padding: '10px 14px', borderRadius: 13,
                border: `2.5px solid ${border}`, background: bg,
                display: 'flex', alignItems: 'center', gap: 9,
                textAlign: 'left', cursor: isLocked ? 'default' : 'pointer',
                fontFamily: BODY, transition: 'all 0.15s',
              }}>
                {isLocked && isConn ? (
                  <span style={{ fontSize: 15, fontWeight: 900, flexShrink: 0,
                    color: res?.correct ? '#10b981' : '#ef4444' }}>
                    {res?.correct ? '✓' : '✕'}
                  </span>
                ) : !isLocked && isConn ? (
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: getColor(li),
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 900, flexShrink: 0 }}>{li + 1}</span>
                ) : null}
                <span style={{ fontSize: 14, fontWeight: 700, color: '#222', lineHeight: 1.35, flex: 1 }}>{item}</span>
              </button>
            );
          })}
        </div>
      </div>

      {isLocked && (
        <div style={{
          padding: '14px 16px', borderRadius: 14,
          background: percent === 100 ? '#ecfdf5' : percent > 0 ? '#fffbeb' : '#fef2f2',
          border: `1px solid ${percent === 100 ? '#10b98133' : percent > 0 ? '#f59e0b33' : '#ef444433'}`,
        }}>
          <div style={{ fontSize: 14, fontWeight: 900, fontFamily: BODY, marginBottom: 8,
            color: percent === 100 ? '#10b981' : percent > 0 ? '#d97706' : '#ef4444' }}>
            {percent === 100 ? 'Correcto' : percent > 0 ? 'Parcialmente correcto' : 'Incorrecto'}{' — '}{correctCount}/{pairs.length} relaciones correctas ({percent}%)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {results.map((r, i) => (
              <div key={i} style={{ fontSize: 13, color: '#555', fontFamily: BODY, lineHeight: 1.45 }}>
                <span style={{ fontWeight: 900, color: r.correct ? '#10b981' : '#ef4444' }}>
                  {r.correct ? '✓' : '✕'}
                </span>
                {' '}<strong>{pairs[i].left}</strong>{' → '}
                {r.connected
                  ? <span style={{ color: r.correct ? '#10b981' : '#ef4444', fontWeight: 700 }}>{r.got}</span>
                  : <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>sin conectar</span>}
                {!r.correct && r.connected && (
                  <span style={{ color: '#64748b' }}>{' · correcto: '}
                    <span style={{ color: '#10b981', fontWeight: 700 }}>{r.expected}</span>
                  </span>
                )}
                {!r.connected && (
                  <span style={{ color: '#64748b' }}>{' · correcto: '}
                    <span style={{ color: '#10b981', fontWeight: 700 }}>{r.expected}</span>
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
}'''

        src = src[:match_fn_start] + new_matching_fn + src[fn_end:]
        changes.append("✅ FIX 3: MatchingQuestion reemplazada correctamente")

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)

print('\n'.join(changes))
