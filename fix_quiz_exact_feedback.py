import re

quiz_path = 'components/materias/QuizPage.tsx'
with open(quiz_path, 'r', encoding='utf-8') as f:
    quiz = f.read()

changed = False

# ============================================================
# 1) Helper de feedback inteligente
# ============================================================
helpers = r'''
function normalizeEvalText(s: any): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function diceSimilarity(a: any, b: any): number {
  const s1 = normalizeEvalText(a);
  const s2 = normalizeEvalText(b);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) {
    return s1 === s2 ? 1 : 0;
  }

  const bigrams = (s: string) => {
    const arr: string[] = [];
    for (let i = 0; i < s.length - 1; i++) arr.push(s.slice(i, i + 2));
    return arr;
  };

  const a2 = bigrams(s1);
  const b2 = bigrams(s2);
  const counts = new Map<string, number>();
  for (const x of a2) counts.set(x, (counts.get(x) || 0) + 1);

  let overlap = 0;
  for (const x of b2) {
    const c = counts.get(x) || 0;
    if (c > 0) {
      overlap++;
      counts.set(x, c - 1);
    }
  }

  return (2 * overlap) / (a2.length + b2.length);
}

function tokenOverlapScore(a: any, b: any): number {
  const ta = new Set(normalizeEvalText(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeEvalText(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach(x => { if (tb.has(x)) inter++; });
  return inter / Math.max(ta.size, tb.size);
}

function getQuizAnswerFeedback(question: any, userAnswer: any): {
  label: string;
  percent: number;
  color: string;
  reason: string;
} {
  if (!question) {
    return { label: 'Sin evaluar', percent: 0, color: '#999', reason: '' };
  }

  const good = '#10b981';
  const mid = '#d97706';
  const bad = '#ef4444';

  if (question.type === 'multiple_choice') {
    const options = question.options ?? [];
    const correctIdx = question.correctAnswer;
    const correctText = options?.[correctIdx] ?? 'respuesta correcta';
    const chosenText = typeof userAnswer === 'number' ? (options?.[userAnswer] ?? 'opción seleccionada') : '';

    if (userAnswer === correctIdx) {
      return {
        label: 'Correcto',
        percent: 100,
        color: good,
        reason: `Elegiste la opción correcta: "${correctText}".`
      };
    }

    if (userAnswer === null || userAnswer === undefined) {
      return {
        label: 'Incorrecto',
        percent: 0,
        color: bad,
        reason: `No seleccionaste ninguna opción. La correcta era "${correctText}".`
      };
    }

    return {
      label: 'Incorrecto',
      percent: 0,
      color: bad,
      reason: `Elegiste "${chosenText}", pero la correcta era "${correctText}".`
    };
  }

  if (question.type === 'true_false') {
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
  }

  if (question.type === 'multi_select') {
    const options = question.options ?? [];
    const correctAnswers: number[] = Array.isArray(question.correctAnswers) ? question.correctAnswers : [];
    const selected: number[] = Array.isArray(userAnswer) ? userAnswer : [];

    const correctSet = new Set(correctAnswers);
    const selectedSet = new Set(selected);

    const hits = selected.filter(i => correctSet.has(i)).length;
    const extras = selected.filter(i => !correctSet.has(i)).length;
    const missed = correctAnswers.filter(i => !selectedSet.has(i)).length;

    const denom = Math.max(correctAnswers.length + extras, 1);
    const raw = Math.max(0, hits / denom);
    const percent = Math.round(raw * 100);

    const correctTexts = correctAnswers.map(i => options[i]).filter(Boolean).join(', ');

    if (hits === correctAnswers.length && extras === 0) {
      return {
        label: 'Correcto',
        percent: 100,
        color: good,
        reason: `Seleccionaste todas las opciones correctas: ${correctTexts}.`
      };
    }

    if (hits > 0) {
      return {
        label: 'Parcialmente correcto',
        percent,
        color: mid,
        reason: `Acertaste ${hits} opción(es), pero te faltó ${missed} y marcaste ${extras} incorrecta(s). Correctas: ${correctTexts}.`
      };
    }

    return {
      label: 'Incorrecto',
      percent: 0,
      color: bad,
      reason: `No seleccionaste ninguna de las opciones correctas. Las correctas eran: ${correctTexts}.`
    };
  }

  if (question.type === 'fill_blank') {
    const correct = String(question.answer || '').trim();
    const user = String(userAnswer || '').trim();

    if (!user) {
      return {
        label: 'Incorrecto',
        percent: 0,
        color: bad,
        reason: `No completaste el espacio. La respuesta correcta era "${correct}".`
      };
    }

    const exact = normalizeEvalText(user) === normalizeEvalText(correct);
    if (exact) {
      return {
        label: 'Correcto',
        percent: 100,
        color: good,
        reason: `Completaste correctamente con "${correct}".`
      };
    }

    const sim = Math.max(
      diceSimilarity(user, correct),
      tokenOverlapScore(user, correct)
    );
    const percent = Math.round(sim * 100);

    if (percent >= 55) {
      return {
        label: 'Parcialmente correcto',
        percent,
        color: mid,
        reason: `Tu respuesta "${user}" se parece a la correcta, pero la forma esperada era "${correct}".`
      };
    }

    return {
      label: 'Incorrecto',
      percent: Math.min(percent, 35),
      color: bad,
      reason: `Escribiste "${user}", pero la palabra correcta era "${correct}".`
    };
  }

  if (question.type === 'short_answer') {
    const accepted: string[] = Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers : [];
    const user = String(userAnswer || '').trim();

    if (!user) {
      return {
        label: 'Incorrecto',
        percent: 0,
        color: bad,
        reason: `No escribiste una respuesta. Respuestas aceptadas: ${accepted.join(', ')}.`
      };
    }

    let best = '';
    let bestScore = 0;

    for (const ans of accepted) {
      const exact = normalizeEvalText(user) === normalizeEvalText(ans);
      const score = exact ? 1 : Math.max(
        diceSimilarity(user, ans),
        tokenOverlapScore(user, ans),
        normalizeEvalText(ans).includes(normalizeEvalText(user)) ? 0.7 : 0,
        normalizeEvalText(user).includes(normalizeEvalText(ans)) ? 0.7 : 0
      );
      if (score > bestScore) {
        bestScore = score;
        best = ans;
      }
    }

    const percent = Math.round(bestScore * 100);

    if (percent >= 95) {
      return {
        label: 'Correcto',
        percent: 100,
        color: good,
        reason: `Tu respuesta coincide con una respuesta aceptada: "${best}".`
      };
    }

    if (percent >= 55) {
      return {
        label: 'Parcialmente correcto',
        percent,
        color: mid,
        reason: `Tu respuesta va en la dirección correcta, pero la forma esperada era algo como "${best}".`
      };
    }

    return {
      label: 'Incorrecto',
      percent: Math.min(percent, 35),
      color: bad,
      reason: `Tu respuesta "${user}" no coincide suficientemente con las respuestas aceptadas${best ? `; una forma correcta era "${best}"` : ''}.`
    };
  }

  if (question.type === 'matching') {
    const rights = question.pairs?.map((p: any) => p.right) ?? [];
    const arr = Array.isArray(userAnswer) ? userAnswer : [];
    const hits = rights.filter((r: string, i: number) => arr[i] === r).length;
    const total = rights.length || 1;
    const percent = Math.round((hits / total) * 100);

    if (hits === total) {
      return {
        label: 'Correcto',
        percent: 100,
        color: good,
        reason: `Relacionaste correctamente los ${total} pares.`
      };
    }

    if (hits > 0) {
      return {
        label: 'Parcialmente correcto',
        percent,
        color: mid,
        reason: `Acertaste ${hits} de ${total} relaciones.`
      };
    }

    return {
      label: 'Incorrecto',
      percent: 0,
      color: bad,
      reason: `Ninguna de las relaciones quedó en la posición correcta.`
    };
  }

  return {
    label: 'Sin evaluar',
    percent: 0,
    color: '#999',
    reason: ''
  };
}
'''

if 'function getQuizAnswerFeedback(' not in quiz:
    anchor = '// ─── Matching con Reorder ─────────────────────────────────────'
    if anchor in quiz:
        quiz = quiz.replace(anchor, helpers + '\n' + anchor, 1)
        changed = True
        print('✅ Helper de feedback agregado')
    else:
        print('❌ No encontré ancla para insertar helper')

# ============================================================
# 2) Matching: validación real, no auto-correcto
# ============================================================
old_validation_pattern = re.compile(
    r"if \(q\.type === 'matching'\) \{\s*// matching siempre correcto si se envía \(validación visual\)\s*return[\s\S]*?\n\s*\}",
    re.S
)

new_validation = """if (q.type === 'matching') {
      const rights = q.pairs?.map(p => p.right) ?? [];
      return Array.isArray(a) &&
        a.length === rights.length &&
        rights.every((right, i) => a[i] === right);
    }"""

if old_validation_pattern.search(quiz):
    quiz = old_validation_pattern.sub(new_validation, quiz, count=1)
    changed = True
    print('✅ Validación real de matching aplicada')
else:
    print('ℹ️ No encontré el bloque viejo de validación de matching')

# ============================================================
# 3) Reemplazar MatchingQuestion completa por versión visual
# ============================================================
start_anchor = '// ─── Matching con Reorder ─────────────────────────────────────'
end_anchor = '// RESULTS SCREEN'

if start_anchor in quiz and end_anchor in quiz:
    start = quiz.index(start_anchor)
    end = quiz.index(end_anchor)

    new_matching_block = r'''// ─── Matching visual con líneas ─────────────────────────────────
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
  const containerRef = useRef<HTMLDivElement>(null);
  const leftRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rightRefs = useRef<(HTMLButtonElement | null)[]>([]);

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
  const [selectedRight, setSelectedRight] = useState<number | null>(null);
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number; leftIdx: number }[]>([]);

  useEffect(() => {
    const answer = pairs.map((_, i) => {
      const rightIdx = connections[i];
      return rightIdx !== undefined ? shuffledRight[rightIdx] : null;
    });
    setUserAnswer(answer);
  }, [connections, shuffledRight, pairs, setUserAnswer]);

  useEffect(() => {
    const recalc = () => {
      if (!containerRef.current) return;
      const root = containerRef.current.getBoundingClientRect();
      const next: { x1: number; y1: number; x2: number; y2: number; leftIdx: number }[] = [];

      Object.entries(connections).forEach(([leftStr, rightIdx]) => {
        const leftIdx = Number(leftStr);
        const leftEl = leftRefs.current[leftIdx];
        const rightEl = rightRefs.current[rightIdx];
        if (!leftEl || !rightEl) return;

        const l = leftEl.getBoundingClientRect();
        const r = rightEl.getBoundingClientRect();

        next.push({
          x1: l.right - root.left,
          y1: l.top + l.height / 2 - root.top,
          x2: r.left - root.left,
          y2: r.top + r.height / 2 - root.top,
          leftIdx,
        });
      });

      setLines(next);
    };

    recalc();
    const t = setTimeout(recalc, 0);
    window.addEventListener('resize', recalc);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', recalc);
    };
  }, [connections, shuffledRight]);

  const palette = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
  const getColor = (idx: number) => palette[idx % palette.length];

  const disconnectLeft = (leftIdx: number) => {
    setConnections(prev => {
      const next = { ...prev };
      delete next[leftIdx];
      return next;
    });
  };

  const disconnectRight = (rightIdx: number) => {
    const found = Object.entries(connections).find(([, r]) => r === rightIdx);
    if (!found) return;
    setConnections(prev => {
      const next = { ...prev };
      delete next[Number(found[0])];
      return next;
    });
  };

  const handleLeftClick = (leftIdx: number) => {
    if (isLocked) return;

    if (connections[leftIdx] !== undefined) {
      disconnectLeft(leftIdx);
      setSelectedLeft(null);
      setSelectedRight(null);
      return;
    }

    if (selectedRight !== null) {
      const rightInUse = Object.values(connections).includes(selectedRight);
      if (!rightInUse) {
        setConnections(prev => ({ ...prev, [leftIdx]: selectedRight }));
      }
      setSelectedLeft(null);
      setSelectedRight(null);
      return;
    }

    setSelectedLeft(prev => prev === leftIdx ? null : leftIdx);
  };

  const handleRightClick = (rightIdx: number) => {
    if (isLocked) return;

    const found = Object.entries(connections).find(([, r]) => r === rightIdx);
    if (found) {
      disconnectRight(rightIdx);
      setSelectedLeft(null);
      setSelectedRight(null);
      return;
    }

    if (selectedLeft !== null && connections[selectedLeft] === undefined) {
      setConnections(prev => ({ ...prev, [selectedLeft]: rightIdx }));
      setSelectedLeft(null);
      setSelectedRight(null);
      return;
    }

    setSelectedRight(prev => prev === rightIdx ? null : rightIdx);
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
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: '1fr 110px 1fr',
          gap: 0,
          alignItems: 'start',
        }}
      >
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'visible',
            zIndex: 1,
          }}
        >
          {lines.map((line, idx) => {
            const result = results[line.leftIdx];
            const stroke = isLocked
              ? (result?.correct ? '#10b981' : '#ef4444')
              : getColor(line.leftIdx);
            const midX = (line.x1 + line.x2) / 2;
            return (
              <g key={idx}>
                <path
                  d={`M ${line.x1} ${line.y1} C ${midX} ${line.y1}, ${midX} ${line.y2}, ${line.x2} ${line.y2}`}
                  stroke={stroke}
                  strokeWidth={isLocked ? 3.5 : 3}
                  fill="none"
                  strokeLinecap="round"
                  opacity={0.85}
                />
                <circle cx={line.x2} cy={line.y2} r={4.5} fill={stroke} />
              </g>
            );
          })}
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, zIndex: 2 }}>
          {pairs.map((p, i) => {
            const isSelected = selectedLeft === i;
            const isConnected = connections[i] !== undefined;
            const res = results[i];
            const color = isLocked
              ? (res.connected ? (res.correct ? '#10b981' : '#ef4444') : '#cbd5e1')
              : isSelected ? themeColor : isConnected ? getColor(i) : 'rgba(0,0,0,0.14)';
            const bg = isLocked
              ? (res.connected ? (res.correct ? '#ecfdf5' : '#fef2f2') : '#f8fafc')
              : isSelected ? `${themeColor}16` : isConnected ? `${getColor(i)}12` : 'rgba(0,0,0,0.03)';

            return (
              <button
                key={`left-${i}`}
                ref={el => { leftRefs.current[i] = el; }}
                onClick={() => handleLeftClick(i)}
                style={{
                  minHeight: 58,
                  padding: '12px 14px',
                  borderRadius: 14,
                  border: `2.5px solid ${color}`,
                  background: bg,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  textAlign: 'left',
                  cursor: isLocked ? 'default' : 'pointer',
                  fontFamily: BODY,
                  position: 'relative',
                }}
              >
                {!isLocked && isConnected && (
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: getColor(i), color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 900, flexShrink: 0,
                  }}>
                    {i + 1}
                  </span>
                )}
                {isLocked && (
                  <span style={{
                    fontSize: 15,
                    fontWeight: 900,
                    color: res.connected ? (res.correct ? '#10b981' : '#ef4444') : '#94a3b8',
                    flexShrink: 0,
                  }}>
                    {res.connected ? (res.correct ? '✓' : '✕') : '•'}
                  </span>
                )}
                <span style={{ fontSize: 14, fontWeight: 700, color: '#222', lineHeight: 1.35 }}>
                  {p.left}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ minHeight: pairs.length * 68 }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, zIndex: 2 }}>
          {shuffledRight.map((item, rIdx) => {
            const selected = selectedRight === rIdx;
            const found = Object.entries(connections).find(([, r]) => r === rIdx);
            const connected = !!found;
            const leftIdx = found ? Number(found[0]) : -1;
            const res = connected ? results[leftIdx] : null;

            const color = isLocked
              ? (connected ? (res?.correct ? '#10b981' : '#ef4444') : '#cbd5e1')
              : selected ? themeColor : connected ? getColor(leftIdx) : 'rgba(0,0,0,0.14)';
            const bg = isLocked
              ? (connected ? (res?.correct ? '#ecfdf5' : '#fef2f2') : '#fff')
              : selected ? `${themeColor}16` : connected ? `${getColor(leftIdx)}12` : '#fff';

            return (
              <button
                key={`right-${rIdx}`}
                ref={el => { rightRefs.current[rIdx] = el; }}
                onClick={() => handleRightClick(rIdx)}
                style={{
                  minHeight: 58,
                  padding: '12px 14px',
                  borderRadius: 14,
                  border: `2.5px solid ${color}`,
                  background: bg,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  textAlign: 'left',
                  cursor: isLocked ? 'default' : 'pointer',
                  fontFamily: BODY,
                  position: 'relative',
                }}
              >
                {!isLocked && connected && (
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: getColor(leftIdx), color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 900, flexShrink: 0,
                  }}>
                    {leftIdx + 1}
                  </span>
                )}
                {isLocked && connected && (
                  <span style={{
                    fontSize: 15,
                    fontWeight: 900,
                    color: res?.correct ? '#10b981' : '#ef4444',
                    flexShrink: 0,
                  }}>
                    {res?.correct ? '✓' : '✕'}
                  </span>
                )}
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
          Toca un elemento de la izquierda y luego su pareja de la derecha. Cada opción solo se puede usar una vez.
        </div>
      )}
    </div>
  );
}

'''
    quiz = quiz[:start] + new_matching_block + '\n' + quiz[end:]
    changed = True
    print('✅ Matching visual reemplazado completo')
else:
    print('❌ No encontré anclas para reemplazar MatchingQuestion')

# ============================================================
# 4) Reemplazar feedback corto por feedback inteligente
# ============================================================
old_inline_feedback = '💡 {question.explanation}'
new_inline_feedback = '''<>
          {(() => {
            const fb = getQuizAnswerFeedback(question, userAnswer);
            return (
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontWeight: 900, color: fb.color }}>
                  {fb.label} ({fb.percent}%)
                </span>
                {fb.reason ? (
                  <span style={{ color: '#555' }}> — {fb.reason}</span>
                ) : null}
              </div>
            );
          })()}
          💡 {question.explanation}
        </>'''

if old_inline_feedback in quiz:
    quiz = quiz.replace(old_inline_feedback, new_inline_feedback)
    changed = True
    print('✅ Feedback inteligente en evaluación agregado')
else:
    print('ℹ️ No encontré el texto exacto "💡 {question.explanation}"')

# ============================================================
# 5) Dar un poco más de claridad también en results screen
# ============================================================
if '💡 Explicación: {q.explanation}' not in quiz and '💡 {q.explanation}' in quiz:
    quiz = quiz.replace('💡 {q.explanation}', '💡 Explicación: {q.explanation}')
    changed = True
    print('✅ Results screen aclarado')

with open(quiz_path, 'w', encoding='utf-8') as f:
    f.write(quiz)

print('\\n' + ('✅ QuizPage.tsx actualizado' if changed else 'ℹ️ Sin cambios'))
