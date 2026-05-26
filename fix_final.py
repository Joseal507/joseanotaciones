path = 'components/materias/QuizPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

changes = []

# ══════════════════════════════════════════════════════════════
# FIX 1: checkAnswer matching — 'a' → userAnswer (ya está ok según sed)
# Verificar y corregir por si acaso
# ══════════════════════════════════════════════════════════════
if "return Array.isArray(a) &&" in src:
    src = src.replace(
        "return Array.isArray(a) &&\n      a.length === rights.length &&\n      rights.every((right, i) => a[i] === right);",
        "return Array.isArray(userAnswer) &&\n      userAnswer.length === rights.length &&\n      rights.every((right, i) => userAnswer[i] === right);"
    )
    changes.append("✅ FIX 1: checkAnswer 'a' → userAnswer")
else:
    changes.append("ℹ️ FIX 1: ya estaba correcto")

# ══════════════════════════════════════════════════════════════
# FIX 2: short_answer — scoring semántico mejorado
# Reemplazar bloque completo dentro de getQuizAnswerFeedback
# ══════════════════════════════════════════════════════════════
old_short = """  if (question.type === 'short_answer') {
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
  }"""

new_short = """  if (question.type === 'short_answer') {
    const accepted: string[] = Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers : [];
    const user = String(userAnswer || '').trim();

    if (!user) {
      return {
        label: 'Incorrecto',
        percent: 0,
        color: bad,
        reason: `No escribiste una respuesta. Se esperaba: "${accepted[0] ?? ''}".`
      };
    }

    const userNorm = normalizeEvalText(user);
    let best = accepted[0] ?? '';
    let bestScore = 0;

    for (const ans of accepted) {
      const ansNorm = normalizeEvalText(ans);

      // Exacto
      if (userNorm === ansNorm) { bestScore = 1; best = ans; break; }

      // Palabras clave: cuántas palabras importantes de la respuesta correcta
      // aparecen en la respuesta del usuario
      const ansWords = ansNorm.split(' ').filter((w: string) => w.length > 3);
      const userWordsSet = new Set(userNorm.split(' ').filter((w: string) => w.length > 3));
      const keyHits = ansWords.filter((w: string) => userWordsSet.has(w)).length;
      const keyScore = ansWords.length > 0 ? keyHits / ansWords.length : 0;

      // Contención: la respuesta del usuario contiene las palabras clave
      const containScore =
        ansNorm.length > 4 && userNorm.includes(ansNorm) ? 0.92 :
        userNorm.length > 4 && ansNorm.includes(userNorm) ? 0.82 : 0;

      // Bigram + token
      const bigramScore = diceSimilarity(user, ans);
      const tokenScore = tokenOverlapScore(user, ans);

      // Para respuestas largas del usuario, las palabras clave pesan más
      const userWordCount = userNorm.split(' ').filter(Boolean).length;
      const isLong = userWordCount >= 5;

      const combined = isLong
        ? Math.max(containScore, keyScore * 0.95, bigramScore * 0.65, tokenScore * 0.85)
        : Math.max(containScore, bigramScore, tokenScore, keyScore * 0.9);

      if (combined > bestScore) { bestScore = combined; best = ans; }
    }

    const percent = Math.round(Math.min(bestScore, 1) * 100);

    // Calcular qué palabras clave acertó para dar feedback específico
    const bestNorm = normalizeEvalText(best);
    const bestWords = bestNorm.split(' ').filter((w: string) => w.length > 3);
    const userWordsSet2 = new Set(userNorm.split(' ').filter((w: string) => w.length > 3));
    const hitWords = bestWords.filter((w: string) => userWordsSet2.has(w));
    const missedWords = bestWords.filter((w: string) => !userWordsSet2.has(w));

    if (percent >= 85) {
      const hitsStr = hitWords.length > 0
        ? ` Conceptos clave que mencionaste: ${hitWords.slice(0, 4).join(', ')}.`
        : '';
      return {
        label: percent >= 97 ? 'Correcto' : 'Parcialmente correcto',
        percent: Math.min(percent, 100),
        color: percent >= 97 ? good : mid,
        reason: percent >= 97
          ? \`Tu respuesta cubre el concepto correctamente.\${hitsStr}\`
          : \`Tu respuesta captura la idea principal.\${hitsStr} Respuesta esperada: "\${best}".\`
      };
    }

    if (percent >= 45) {
      const reason = hitWords.length > 0
        ? \`Mencionaste \${hitWords.slice(0, 3).join(', ')}\${missedWords.length > 0 ? \`, pero faltó incluir: \${missedWords.slice(0, 3).join(', ')}\` : ''}. Respuesta esperada: "\${best}".\`
        : \`Tu respuesta va en parte en la dirección correcta. Respuesta esperada: "\${best}".\`;
      return {
        label: 'Parcialmente correcto',
        percent,
        color: mid,
        reason
      };
    }

    const keywordsStr = bestWords.length > 0
      ? \` Conceptos clave esperados: \${bestWords.slice(0, 4).join(', ')}.\`
      : '';
    return {
      label: 'Incorrecto',
      percent: Math.min(percent, 30),
      color: bad,
      reason: \`Tu respuesta no cubre los conceptos principales.\${keywordsStr} Una respuesta aceptada: "\${best}".\`
    };
  }"""

if old_short in src:
    src = src.replace(old_short, new_short)
    changes.append("✅ FIX 2: short_answer scoring semántico mejorado")
else:
    changes.append("❌ FIX 2: no encontré el bloque short_answer exacto")

# ══════════════════════════════════════════════════════════════
# FIX 3: MatchingQuestion completa — reemplazar desde línea 2444
# ══════════════════════════════════════════════════════════════
start_marker = "// ─── Matching visual con líneas ─────────────────────────────────"
end_marker = "// RESULTS SCREEN\n// ═══════════════════════════════════════════════════════════════"

if start_marker in src and end_marker in src:
    start_idx = src.index(start_marker)
    end_idx = src.index(end_marker)

    new_matching = '''// ─── Matching visual con líneas ─────────────────────────────────
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
  const leftRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rightRefs = useRef<(HTMLDivElement | null)[]>([]);

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
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });
  const [lineCoords, setLineCoords] = useState<
    { x1: number; y1: number; x2: number; y2: number; leftIdx: number }[]
  >([]);

  // Sincronizar answer con el padre
  const syncAnswer = (map: Record<number, number>) => {
    const answer = pairs.map((_, i) => {
      const rIdx = map[i];
      return rIdx !== undefined ? shuffledRight[rIdx] : null;
    });
    setUserAnswer(answer);
  };

  const applyConnect = (leftIdx: number, rightIdx: number) => {
    setConnections(prev => {
      const next = { ...prev };
      // Quitar cualquier left que ya apuntara a este right
      for (const k of Object.keys(next)) {
        if (next[Number(k)] === rightIdx) delete next[Number(k)];
      }
      // Asignar (sobreescribe si leftIdx ya tenía algo)
      next[leftIdx] = rightIdx;
      syncAnswer(next);
      return next;
    });
  };

  const applyDisconnect = (leftIdx: number) => {
    setConnections(prev => {
      const next = { ...prev };
      delete next[leftIdx];
      syncAnswer(next);
      return next;
    });
  };

  const handleLeftClick = (leftIdx: number) => {
    if (isLocked) return;
    if (selectedLeft === leftIdx) {
      // Segundo click en el mismo → deseleccionar (sin desconectar)
      setSelectedLeft(null);
      return;
    }
    setSelectedLeft(leftIdx);
  };

  const handleRightClick = (rightIdx: number) => {
    if (isLocked) return;

    if (selectedLeft !== null) {
      // SIEMPRE conectar: si el right ya tenía dueño, se reasigna
      applyConnect(selectedLeft, rightIdx);
      setSelectedLeft(null);
      return;
    }

    // Sin left seleccionado: si el right estaba conectado, desconectarlo
    const entry = Object.entries(connections).find(([, r]) => Number(r) === rightIdx);
    if (entry) applyDisconnect(Number(entry[0]));
  };

  // Recalcular líneas SVG
  useEffect(() => {
    const recalc = () => {
      if (!containerRef.current) return;
      const box = containerRef.current.getBoundingClientRect();
      setSvgSize({ w: box.width, h: box.height });

      const coords: typeof lineCoords = [];
      for (const [lStr, rIdx] of Object.entries(connections)) {
        const lEl = leftRefs.current[Number(lStr)];
        const rEl = rightRefs.current[rIdx];
        if (!lEl || !rEl) continue;
        const lr = lEl.getBoundingClientRect();
        const rr = rEl.getBoundingClientRect();
        coords.push({
          x1: lr.right - box.left,
          y1: lr.top + lr.height / 2 - box.top,
          x2: rr.left - box.left,
          y2: rr.top + rr.height / 2 - box.top,
          leftIdx: Number(lStr),
        });
      }
      setLineCoords(coords);
    };

    recalc();
    // Pequeño delay para que el DOM esté renderizado
    const t = setTimeout(recalc, 30);
    window.addEventListener('resize', recalc);
    return () => { clearTimeout(t); window.removeEventListener('resize', recalc); };
  }, [connections, shuffledRight]);

  const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
  const col = (i: number) => COLORS[i % COLORS.length];

  const results = pairs.map((pair, li) => {
    const ri = connections[li];
    if (ri === undefined) return { connected: false, correct: false, got: null as string | null, expected: pair.right };
    const got = shuffledRight[ri];
    return { connected: true, correct: got === pair.right, got, expected: pair.right };
  });
  const correctCount = results.filter(r => r.correct).length;
  const pct = Math.round(correctCount / Math.max(pairs.length, 1) * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!isLocked && (
        <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', fontFamily: BODY, fontStyle: 'italic' }}>
          Toca un concepto de la izquierda → luego su par de la derecha.
          Si el par ya estaba usado, se reasigna.
        </div>
      )}

      {/* Grid con SVG overlay */}
      <div ref={containerRef} style={{ position: 'relative' }}>
        {/* Líneas SVG */}
        <svg
          width={svgSize.w}
          height={svgSize.h}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 10, overflow: 'visible' }}
        >
          {lineCoords.map((ln, idx) => {
            const res = results[ln.leftIdx];
            const stroke = isLocked
              ? (res.correct ? '#10b981' : '#ef4444')
              : col(ln.leftIdx);
            const mx = (ln.x1 + ln.x2) / 2;
            return (
              <g key={idx}>
                <path
                  d={`M ${ln.x1} ${ln.y1} C ${mx} ${ln.y1}, ${mx} ${ln.y2}, ${ln.x2} ${ln.y2}`}
                  stroke={stroke}
                  strokeWidth={isLocked ? 3.5 : 2.5}
                  fill="none"
                  strokeLinecap="round"
                  opacity={0.75}
                />
                <circle cx={ln.x2} cy={ln.y2} r={4} fill={stroke} opacity={0.85} />
              </g>
            );
          })}
        </svg>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 1fr', alignItems: 'start', gap: 0 }}>
          {/* Columna izquierda */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pairs.map((p, li) => {
              const isConn = connections[li] !== undefined;
              const isSel = selectedLeft === li;
              const res = results[li];

              const border = isLocked
                ? (res.connected ? (res.correct ? '#10b981' : '#ef4444') : '#d1d5db')
                : isSel ? themeColor
                : isConn ? col(li)
                : 'rgba(0,0,0,0.13)';

              const bg = isLocked
                ? (res.connected ? (res.correct ? '#ecfdf5' : '#fef2f2') : '#f8fafc')
                : isSel ? `${themeColor}18`
                : isConn ? `${col(li)}10`
                : 'rgba(0,0,0,0.025)';

              return (
                <div
                  key={li}
                  ref={el => { leftRefs.current[li] = el; }}
                  onClick={() => handleLeftClick(li)}
                  style={{
                    minHeight: 54, padding: '10px 14px',
                    background: bg, border: `2.5px solid ${border}`, borderRadius: 13,
                    display: 'flex', alignItems: 'center', gap: 8,
                    cursor: isLocked ? 'default' : 'pointer',
                    fontFamily: BODY, transition: 'all 0.15s',
                    boxShadow: isSel ? `0 0 0 3px ${themeColor}30` : 'none',
                    userSelect: 'none',
                  }}
                >
                  {isLocked ? (
                    <span style={{ fontSize: 14, fontWeight: 900, flexShrink: 0,
                      color: res.connected ? (res.correct ? '#10b981' : '#ef4444') : '#94a3b8' }}>
                      {res.connected ? (res.correct ? '✓' : '✕') : '·'}
                    </span>
                  ) : isConn ? (
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%', background: col(li),
                      color: '#fff', fontSize: 9, fontWeight: 900, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{li + 1}</span>
                  ) : isSel ? (
                    <span style={{ fontSize: 8, color: themeColor, fontWeight: 900, flexShrink: 0 }}>●</span>
                  ) : (
                    <span style={{ fontSize: 8, color: '#cbd5e1', flexShrink: 0 }}>○</span>
                  )}
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#222', lineHeight: 1.35, flex: 1 }}>
                    {p.left}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Espacio central para las líneas */}
          <div style={{ minHeight: pairs.length * 62 }} />

          {/* Columna derecha */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shuffledRight.map((item, ri) => {
              const entry = Object.entries(connections).find(([, r]) => Number(r) === ri);
              const isConn = !!entry;
              const li = entry ? Number(entry[0]) : -1;
              const res = isConn ? results[li] : null;
              const isTarget = selectedLeft !== null && !isConn;

              const border = isLocked
                ? (isConn ? (res?.correct ? '#10b981' : '#ef4444') : '#d1d5db')
                : isConn ? col(li)
                : isTarget ? themeColor + '66'
                : 'rgba(0,0,0,0.13)';

              const bg = isLocked
                ? (isConn ? (res?.correct ? '#ecfdf5' : '#fef2f2') : '#fff')
                : isConn ? `${col(li)}10`
                : isTarget ? `${themeColor}08`
                : '#fff';

              return (
                <div
                  key={ri}
                  ref={el => { rightRefs.current[ri] = el; }}
                  onClick={() => handleRightClick(ri)}
                  style={{
                    minHeight: 54, padding: '10px 14px',
                    background: bg, border: `2.5px solid ${border}`, borderRadius: 13,
                    display: 'flex', alignItems: 'center', gap: 8,
                    cursor: isLocked ? 'default' : 'pointer',
                    fontFamily: BODY, transition: 'all 0.15s',
                    userSelect: 'none',
                  }}
                >
                  {isLocked && isConn ? (
                    <span style={{ fontSize: 14, fontWeight: 900, flexShrink: 0,
                      color: res?.correct ? '#10b981' : '#ef4444' }}>
                      {res?.correct ? '✓' : '✕'}
                    </span>
                  ) : !isLocked && isConn ? (
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%', background: col(li),
                      color: '#fff', fontSize: 9, fontWeight: 900, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{li + 1}</span>
                  ) : (
                    <span style={{ fontSize: 8, color: isTarget ? themeColor : '#cbd5e1', flexShrink: 0 }}>
                      {isTarget ? '●' : '○'}
                    </span>
                  )}
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#222', lineHeight: 1.35, flex: 1 }}>
                    {item}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Resultado tras verificar */}
      {isLocked && (
        <div style={{
          padding: '14px 16px', borderRadius: 13,
          background: pct === 100 ? '#ecfdf5' : pct > 0 ? '#fffbeb' : '#fef2f2',
          border: `1px solid ${pct === 100 ? '#10b98130' : pct > 0 ? '#f59e0b30' : '#ef444430'}`,
        }}>
          <div style={{ fontSize: 14, fontWeight: 900, fontFamily: BODY, marginBottom: 8,
            color: pct === 100 ? '#10b981' : pct > 0 ? '#d97706' : '#ef4444' }}>
            {pct === 100 ? '¡Perfecto!' : pct > 0 ? 'Parcialmente correcto' : 'Incorrecto'}
            {' — '}{correctCount}/{pairs.length} relaciones correctas ({pct}%)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {results.map((r, i) => (
              <div key={i} style={{ fontSize: 13, fontFamily: BODY, color: '#444', lineHeight: 1.4 }}>
                <span style={{ fontWeight: 900, color: r.correct ? '#10b981' : '#ef4444' }}>
                  {r.correct ? '✓' : '✕'}
                </span>
                {' '}<strong>{pairs[i].left}</strong>{' → '}
                {r.connected
                  ? <span style={{ color: r.correct ? '#10b981' : '#ef4444', fontWeight: 700 }}>{r.got}</span>
                  : <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>sin conectar</span>
                }
                {!r.correct && (
                  <span style={{ color: '#64748b' }}>
                    {' · correcto: '}
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
}

'''

    src = src[:start_idx] + new_matching + src[end_idx:]
    changes.append("✅ FIX 3: MatchingQuestion con SVG lines reemplazada")
else:
    changes.append(f"❌ FIX 3: marcadores no encontrados — start={start_marker in src}, end={end_marker in src}")

# ══════════════════════════════════════════════════════════════
# FIX 4: true_false en checkAnswer — normalizar 0/1 vs true/false
# ══════════════════════════════════════════════════════════════
old_tf_check = """  if (q.type === 'true_false') {
    // correctAnswer puede ser boolean (true/false) o número (0/1)
    // userAnswer es siempre 0 (Verdadero) o 1 (Falso)
    const correctIsTrue = q.correctAnswer === true || q.correctAnswer === 0 || String(q.correctAnswer).toLowerCase() === 'true' || String(q.correctAnswer).toLowerCase() === 'verdadero';
    const userIsTrue = userAnswer === 0;
    return correctIsTrue === userIsTrue;
  }"""

new_tf_check = """  if (q.type === 'true_false') {
    // userAnswer: 0 = Verdadero, 1 = Falso (desde la UI)
    // correctAnswer: puede ser true/false (bool) o 0/1 (número) o string
    const correctIsTrue =
      q.correctAnswer === true ||
      q.correctAnswer === 0 ||
      String(q.correctAnswer).toLowerCase() === 'true' ||
      String(q.correctAnswer).toLowerCase() === 'verdadero';
    const userIsTrue =
      userAnswer === true ||
      userAnswer === 0;
    return correctIsTrue === userIsTrue;
  }"""

if old_tf_check in src:
    src = src.replace(old_tf_check, new_tf_check)
    changes.append("✅ FIX 4: true_false checkAnswer normalizado")
else:
    changes.append("ℹ️ FIX 4: true_false checkAnswer ya estaba ok o no encontrado")

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)

print('\n'.join(changes))
