import re

quiz_path = 'components/materias/QuizPage.tsx'
with open(quiz_path, 'r', encoding='utf-8') as f:
    quiz = f.read()

changed = False

# ══════════════════════════════════════════════════════════════
# 1. Reemplazar MatchingQuestion con SVG lines
# ══════════════════════════════════════════════════════════════

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
    if (arr.length >= 2 && arr.every((v, k) => v === rights[k])) {
      [arr[0], arr[arr.length - 1]] = [arr[arr.length - 1], arr[0]];
    }
    return arr;
  });

  const [connections, setConnections] = useState<Record<number, number>>({});
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);
  const [selectedRight, setSelectedRight] = useState<number | null>(null);
  const [lineCoords, setLineCoords] = useState<{lx: number; ly: number; rx: number; ry: number; leftIdx: number}[]>([]);

  useEffect(() => {
    const answer = pairs.map((_, i) => {
      const rightIdx = connections[i];
      return rightIdx !== undefined ? shuffledRight[rightIdx] : null;
    });
    setUserAnswer(answer);
  }, [connections, shuffledRight, pairs.length, setUserAnswer]);

  // Recalcular coordenadas de líneas
  useEffect(() => {
    const recalc = () => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const coords: typeof lineCoords = [];
      for (const [leftStr, rightIdx] of Object.entries(connections)) {
        const leftIdx = Number(leftStr);
        const leftEl = leftRefs.current[leftIdx];
        const rightEl = rightRefs.current[rightIdx];
        if (!leftEl || !rightEl) continue;
        const lr = leftEl.getBoundingClientRect();
        const rr = rightEl.getBoundingClientRect();
        coords.push({
          lx: lr.right - containerRect.left,
          ly: lr.top + lr.height / 2 - containerRect.top,
          rx: rr.left - containerRect.left,
          ry: rr.top + rr.height / 2 - containerRect.top,
          leftIdx,
        });
      }
      setLineCoords(coords);
    };
    recalc();
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  }, [connections]);

  const handleLeftClick = (leftIdx: number) => {
    if (isLocked) return;
    if (connections[leftIdx] !== undefined) {
      setConnections(prev => { const n = { ...prev }; delete n[leftIdx]; return n; });
      setSelectedLeft(null); setSelectedRight(null); return;
    }
    setSelectedLeft(leftIdx);
    if (selectedRight !== null) {
      const used = Object.values(connections).includes(selectedRight);
      if (!used) setConnections(prev => ({ ...prev, [leftIdx]: selectedRight }));
      setSelectedLeft(null); setSelectedRight(null);
    }
  };

  const handleRightClick = (rIdx: number) => {
    if (isLocked) return;
    const entry = Object.entries(connections).find(([, r]) => r === rIdx);
    if (entry) {
      setConnections(prev => { const n = { ...prev }; delete n[Number(entry[0])]; return n; });
      setSelectedLeft(null); setSelectedRight(null); return;
    }
    setSelectedRight(rIdx);
    if (selectedLeft !== null) {
      if (connections[selectedLeft] === undefined) setConnections(prev => ({ ...prev, [selectedLeft]: rIdx }));
      setSelectedLeft(null); setSelectedRight(null);
    }
  };

  const colors = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
  const getColor = (i: number) => colors[i % colors.length];

  const results = pairs.map((pair, leftIdx) => {
    const rIdx = connections[leftIdx];
    if (rIdx === undefined) return { connected: false, correct: false, userAnswer: null, correctAnswer: pair.right };
    const userRight = shuffledRight[rIdx];
    return { connected: true, correct: userRight === pair.right, userAnswer: userRight, correctAnswer: pair.right };
  });
  const correctCount = results.filter(r => r.correct).length;
  const allConnected = Object.keys(connections).length === pairs.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div ref={containerRef} style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 0, alignItems: 'start' }}>
        
        {/* SVG overlay para líneas */}
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}>
          {lineCoords.map((c, i) => {
            const result = isLocked ? results[c.leftIdx] : null;
            const strokeColor = isLocked
              ? (result?.correct ? '#10b981' : '#ef4444')
              : getColor(c.leftIdx);
            const mx = (c.lx + c.rx) / 2;
            return (
              <g key={i}>
                <path
                  d={`M ${c.lx} ${c.ly} C ${mx} ${c.ly}, ${mx} ${c.ry}, ${c.rx} ${c.ry}`}
                  stroke={strokeColor}
                  strokeWidth={isLocked ? 3 : 2.5}
                  fill="none"
                  strokeLinecap="round"
                  opacity={isLocked ? 0.8 : 0.6}
                />
                {/* Flecha */}
                <circle cx={c.rx - 2} cy={c.ry} r={4} fill={strokeColor} opacity={isLocked ? 0.8 : 0.6} />
              </g>
            );
          })}
        </svg>

        {/* Columna izquierda */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, zIndex: 2 }}>
          {pairs.map((p, i) => {
            const isConn = connections[i] !== undefined;
            const isSel = selectedLeft === i;
            const r = isLocked ? results[i] : null;
            const border = isLocked
              ? (r?.connected ? (r.correct ? '#10b981' : '#ef4444') : '#ccc')
              : isSel ? themeColor : isConn ? getColor(i) : 'rgba(0,0,0,0.12)';
            const bg = isLocked
              ? (r?.connected ? (r.correct ? '#ecfdf5' : '#fef2f2') : '#f9fafb')
              : isSel ? `${themeColor}15` : isConn ? `${getColor(i)}10` : 'rgba(0,0,0,0.03)';
            return (
              <button
                key={`l-${i}`}
                ref={el => { leftRefs.current[i] = el; }}
                onClick={() => handleLeftClick(i)}
                style={{
                  height: 56, padding: '0 14px', background: bg,
                  border: `2.5px solid ${border}`, borderRadius: 14,
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 13, fontWeight: 700, color: '#333', fontFamily: BODY,
                  cursor: isLocked ? 'default' : 'pointer', transition: 'all 0.15s',
                  textAlign: 'left', position: 'relative',
                }}
              >
                {isLocked && r?.connected && (
                  <span style={{ fontSize: 15, fontWeight: 900, color: r.correct ? '#10b981' : '#ef4444', flexShrink: 0 }}>
                    {r.correct ? '✓' : '✕'}
                  </span>
                )}
                {!isLocked && isConn && (
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%', background: getColor(i),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: '#fff', fontWeight: 900, flexShrink: 0,
                  }}>{i + 1}</span>
                )}
                <span style={{ flex: 1 }}>{p.left}</span>
                {!isLocked && isSel && (
                  <span style={{ fontSize: 10, color: themeColor, fontWeight: 900 }}>●</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Espacio central para las líneas */}
        <div style={{ minHeight: pairs.length * 66 }} />

        {/* Columna derecha */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, zIndex: 2 }}>
          {shuffledRight.map((item, rIdx) => {
            const isSel = selectedRight === rIdx;
            const entry = Object.entries(connections).find(([, r]) => r === rIdx);
            const isConn = !!entry;
            const lIdx = entry ? Number(entry[0]) : -1;
            const r = isLocked && isConn ? results[lIdx] : null;
            const border = isLocked
              ? (isConn ? (r?.correct ? '#10b981' : '#ef4444') : '#ccc')
              : isSel ? themeColor : isConn ? getColor(lIdx) : 'rgba(0,0,0,0.12)';
            const bg = isLocked
              ? (isConn ? (r?.correct ? '#ecfdf5' : '#fef2f2') : '#f9fafb')
              : isSel ? `${themeColor}15` : isConn ? `${getColor(lIdx)}10` : '#fff';
            return (
              <button
                key={`r-${rIdx}`}
                ref={el => { rightRefs.current[rIdx] = el; }}
                onClick={() => handleRightClick(rIdx)}
                style={{
                  height: 56, padding: '0 14px', background: bg,
                  border: `2.5px solid ${border}`, borderRadius: 14,
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 13, fontWeight: 700, color: '#222', fontFamily: BODY,
                  cursor: isLocked ? 'default' : 'pointer', transition: 'all 0.15s',
                  textAlign: 'left', position: 'relative',
                }}
              >
                {isLocked && isConn && (
                  <span style={{ fontSize: 15, fontWeight: 900, color: r?.correct ? '#10b981' : '#ef4444', flexShrink: 0 }}>
                    {r?.correct ? '✓' : '✕'}
                  </span>
                )}
                {!isLocked && isConn && (
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%', background: getColor(lIdx),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: '#fff', fontWeight: 900, flexShrink: 0,
                  }}>{lIdx + 1}</span>
                )}
                <span style={{ flex: 1 }}>{item}</span>
                {!isLocked && isSel && (
                  <span style={{ fontSize: 10, color: themeColor, fontWeight: 900 }}>●</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Feedback detallado al verificar */}
      {isLocked && (
        <div style={{
          padding: '14px 16px', borderRadius: 14,
          background: correctCount === pairs.length ? '#ecfdf5' : correctCount > 0 ? '#fffbeb' : '#fef2f2',
          border: `1px solid ${correctCount === pairs.length ? '#10b98133' : correctCount > 0 ? '#f59e0b33' : '#ef444433'}`,
        }}>
          <div style={{
            fontSize: 15, fontWeight: 800, marginBottom: 10, fontFamily: BODY,
            color: correctCount === pairs.length ? '#10b981' : correctCount > 0 ? '#d97706' : '#ef4444',
          }}>
            {correctCount === pairs.length ? '¡Perfecto!' : correctCount > 0 ? 'Parcialmente correcto' : 'Incorrecto'}
            {' — '}{correctCount}/{pairs.length} relaciones correctas
            {pairs.length > 0 && ` (${Math.round(correctCount / pairs.length * 100)}%)`}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {results.map((res, i) => (
              <div key={i} style={{
                fontSize: 13, fontFamily: BODY, padding: '6px 10px',
                borderRadius: 8, background: res.correct ? '#d1fae522' : '#fef2f222',
                border: `1px solid ${res.correct ? '#10b98118' : '#ef444418'}`,
              }}>
                <span style={{ fontWeight: 800, color: res.correct ? '#10b981' : '#ef4444' }}>
                  {res.correct ? '✓' : '✕'}
                </span>
                {' '}<strong>{pairs[i].left}</strong>
                {' → '}
                {res.connected ? (
                  <>
                    <span style={{ color: res.correct ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                      {res.userAnswer}
                    </span>
                    {!res.correct && (
                      <span style={{ color: '#666' }}>
                        {' · Correcto: '}<span style={{ color: '#10b981', fontWeight: 700 }}>{res.correctAnswer}</span>
                      </span>
                    )}
                  </>
                ) : (
                  <span style={{ color: '#999', fontStyle: 'italic' }}>sin conectar · Correcto: <span style={{ color: '#10b981', fontWeight: 700 }}>{res.correctAnswer}</span></span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!isLocked && !allConnected && (
        <div style={{
          fontSize: 12, color: '#888', fontFamily: BODY, textAlign: 'center',
          fontStyle: 'italic', padding: '4px 0',
        }}>
          💡 Toca un concepto de la izquierda y luego su par de la derecha · Toca de nuevo para desconectar
        </div>
      )}
    </div>
  );
}

\2'''

m = old_pattern.search(quiz)
if m:
    quiz = old_pattern.sub(new_matching, quiz, count=1)
    changed = True
    print("✅ MatchingQuestion reemplazada con SVG lines")
else:
    print("❌ No encontré la función MatchingQuestion")


# ══════════════════════════════════════════════════════════════
# 2. Agregar useRef import si no está
# ══════════════════════════════════════════════════════════════
if 'useRef' not in quiz.split('\n')[0] and 'useRef' not in quiz.split('\n')[1] and 'useRef' not in quiz.split('\n')[2]:
    quiz = quiz.replace(
        "import { useState, useEffect, useCallback, useMemo } from 'react';",
        "import { useState, useEffect, useCallback, useMemo, useRef } from 'react';",
        1
    )
    if 'useRef' not in quiz[:500]:
        quiz = quiz.replace("useState, useEffect, useCallback", "useState, useEffect, useCallback, useRef", 1)
    changed = True
    print("✅ useRef importado")


# ══════════════════════════════════════════════════════════════
# 3. Fix feedback panel: añadir análisis para fill_blank y short_answer
# ══════════════════════════════════════════════════════════════

# Buscar el bloque de feedback/explanation después de verificar
old_explanation = '''          {showExplanation && currentQ?.explanation && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                padding: '14px 18px',
                borderRadius: 14,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.08)',
                marginTop: 8,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 800, color: themeColor, marginBottom: 6, fontFamily: BODY }}>
                💡 Explicación
              </div>
              <div style={{ fontSize: 14, color: '#ccc', lineHeight: 1.5, fontFamily: BODY }}>
                {currentQ.explanation}
              </div>
            </motion.div>
          )}'''

new_explanation = '''          {showExplanation && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                padding: '14px 18px',
                borderRadius: 14,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.08)',
                marginTop: 8,
              }}
            >
              {/* Feedback específico para fill_blank */}
              {currentQ?.type === 'fill_blank' && (
                <div style={{ marginBottom: currentQ.explanation ? 10 : 0 }}>
                  <div style={{ fontSize: 13, fontFamily: BODY, color: '#ccc', lineHeight: 1.6 }}>
                    {(() => {
                      const userAns = String(userAnswers[currentIndex] ?? '').trim();
                      const correct = (currentQ as any).answer || '';
                      const isCorrect = userAns.toLowerCase() === correct.toLowerCase();
                      if (isCorrect) return (
                        <span style={{ color: '#10b981' }}>
                          ✓ <strong>{userAns}</strong> es la respuesta correcta.
                        </span>
                      );
                      if (!userAns) return (
                        <span style={{ color: '#ef4444' }}>
                          No seleccionaste ninguna respuesta. La correcta era <strong style={{ color: '#10b981' }}>{correct}</strong>.
                        </span>
                      );
                      return (
                        <span style={{ color: '#ef4444' }}>
                          Elegiste <strong>{userAns}</strong>, pero la respuesta correcta es <strong style={{ color: '#10b981' }}>{correct}</strong>.
                        </span>
                      );
                    })()}
                  </div>
                </div>
              )}
              
              {/* Feedback para short_answer */}
              {currentQ?.type === 'short_answer' && (
                <div style={{ marginBottom: currentQ.explanation ? 10 : 0 }}>
                  <div style={{ fontSize: 13, fontFamily: BODY, color: '#ccc', lineHeight: 1.6 }}>
                    {(() => {
                      const userAns = String(userAnswers[currentIndex] ?? '').trim();
                      const accepted = (currentQ as any).acceptedAnswers ?? [];
                      const isCorrect = accepted.some((a: string) =>
                        a.toLowerCase().trim() === userAns.toLowerCase()
                      );
                      const isPartial = !isCorrect && userAns && accepted.some((a: string) =>
                        a.toLowerCase().includes(userAns.toLowerCase()) ||
                        userAns.toLowerCase().includes(a.toLowerCase())
                      );
                      if (isCorrect) return (
                        <span style={{ color: '#10b981' }}>
                          ✓ Tu respuesta <strong>"{userAns}"</strong> es correcta.
                        </span>
                      );
                      if (isPartial) return (
                        <span style={{ color: '#d97706' }}>
                          ⚡ Tu respuesta <strong>"{userAns}"</strong> es parcialmente correcta. Las respuestas aceptadas son: {accepted.map((a: string, i: number) => (
                            <span key={i}><strong style={{ color: '#10b981' }}>{a}</strong>{i < accepted.length - 1 ? ', ' : ''}</span>
                          ))}
                        </span>
                      );
                      if (!userAns) return (
                        <span style={{ color: '#ef4444' }}>
                          No escribiste ninguna respuesta. Las respuestas aceptadas son: {accepted.map((a: string, i: number) => (
                            <span key={i}><strong style={{ color: '#10b981' }}>{a}</strong>{i < accepted.length - 1 ? ', ' : ''}</span>
                          ))}
                        </span>
                      );
                      return (
                        <span style={{ color: '#ef4444' }}>
                          Tu respuesta <strong>"{userAns}"</strong> no coincide. Las respuestas aceptadas son: {accepted.map((a: string, i: number) => (
                            <span key={i}><strong style={{ color: '#10b981' }}>{a}</strong>{i < accepted.length - 1 ? ', ' : ''}</span>
                          ))}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Feedback para true_false */}
              {currentQ?.type === 'true_false' && (
                <div style={{ marginBottom: currentQ.explanation ? 10 : 0 }}>
                  <div style={{ fontSize: 13, fontFamily: BODY, color: '#ccc', lineHeight: 1.6 }}>
                    {(() => {
                      const userAns = userAnswers[currentIndex];
                      const correct = (currentQ as any).correctAnswer;
                      const isCorrect = userAns === correct;
                      if (isCorrect) return (
                        <span style={{ color: '#10b981' }}>
                          ✓ Correcto. La afirmación es <strong>{correct ? 'Verdadera' : 'Falsa'}</strong>.
                        </span>
                      );
                      return (
                        <span style={{ color: '#ef4444' }}>
                          Incorrecto. Elegiste <strong>{userAns ? 'Verdadero' : 'Falso'}</strong>, pero la respuesta correcta es <strong style={{ color: '#10b981' }}>{correct ? 'Verdadero' : 'Falso'}</strong>.
                        </span>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Feedback para multiple_choice */}
              {currentQ?.type === 'multiple_choice' && (
                <div style={{ marginBottom: currentQ.explanation ? 10 : 0 }}>
                  <div style={{ fontSize: 13, fontFamily: BODY, color: '#ccc', lineHeight: 1.6 }}>
                    {(() => {
                      const userIdx = userAnswers[currentIndex];
                      const correctIdx = (currentQ as any).correctAnswer;
                      const options = (currentQ as any).options ?? [];
                      const isCorrect = userIdx === correctIdx;
                      if (isCorrect) return (
                        <span style={{ color: '#10b981' }}>
                          ✓ Correcto: <strong>{options[correctIdx]}</strong>
                        </span>
                      );
                      if (userIdx === null || userIdx === undefined) return (
                        <span style={{ color: '#ef4444' }}>
                          No seleccionaste respuesta. La correcta era <strong style={{ color: '#10b981' }}>{options[correctIdx]}</strong>.
                        </span>
                      );
                      return (
                        <span style={{ color: '#ef4444' }}>
                          Elegiste <strong>{options[userIdx]}</strong>. La respuesta correcta es <strong style={{ color: '#10b981' }}>{options[correctIdx]}</strong>.
                        </span>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Feedback para multi_select */}
              {currentQ?.type === 'multi_select' && (
                <div style={{ marginBottom: currentQ.explanation ? 10 : 0 }}>
                  <div style={{ fontSize: 13, fontFamily: BODY, color: '#ccc', lineHeight: 1.6 }}>
                    {(() => {
                      const userIdxs: number[] = userAnswers[currentIndex] ?? [];
                      const correctIdxs: number[] = (currentQ as any).correctAnswers ?? [];
                      const options = (currentQ as any).options ?? [];
                      const correctSet = new Set(correctIdxs);
                      const userSet = new Set(userIdxs);
                      const allCorrect = correctIdxs.every(i => userSet.has(i)) && userIdxs.every(i => correctSet.has(i));
                      const partial = !allCorrect && userIdxs.some(i => correctSet.has(i));
                      const correctNames = correctIdxs.map(i => options[i]).filter(Boolean);
                      
                      if (allCorrect) return <span style={{ color: '#10b981' }}>✓ ¡Todas las opciones correctas!</span>;
                      if (partial) {
                        const hits = userIdxs.filter(i => correctSet.has(i)).length;
                        return (
                          <span style={{ color: '#d97706' }}>
                            ⚡ Parcialmente correcto ({hits}/{correctIdxs.length}). Las correctas son: {correctNames.map((n, i) => (
                              <span key={i}><strong style={{ color: '#10b981' }}>{n}</strong>{i < correctNames.length - 1 ? ', ' : ''}</span>
                            ))}
                          </span>
                        );
                      }
                      return (
                        <span style={{ color: '#ef4444' }}>
                          Incorrecto. Las respuestas correctas son: {correctNames.map((n, i) => (
                            <span key={i}><strong style={{ color: '#10b981' }}>{n}</strong>{i < correctNames.length - 1 ? ', ' : ''}</span>
                          ))}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Explicación general de la IA */}
              {currentQ?.explanation && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 800, color: themeColor, marginBottom: 6, fontFamily: BODY }}>
                    💡 Explicación
                  </div>
                  <div style={{ fontSize: 14, color: '#ccc', lineHeight: 1.5, fontFamily: BODY }}>
                    {currentQ.explanation}
                  </div>
                </>
              )}
            </motion.div>
          )}'''

if old_explanation in quiz:
    quiz = quiz.replace(old_explanation, new_explanation)
    changed = True
    print("✅ Feedback inteligente agregado para todos los tipos")
else:
    print("❌ No encontré el bloque de explicación — buscando variante...")
    if 'showExplanation && currentQ?.explanation' in quiz:
        print("   Encontré la condición vieja, intentando con regex...")
        exp_pattern = re.compile(
            r'\{showExplanation && currentQ\?\.\s*explanation && \(\s*<motion\.div[\s\S]*?💡 Explicación[\s\S]*?</motion\.div>\s*\)\}',
            re.S
        )
        if exp_pattern.search(quiz):
            quiz = exp_pattern.sub(new_explanation.lstrip().rstrip(), quiz, count=1)
            changed = True
            print("✅ Feedback inteligente agregado (via regex)")


with open(quiz_path, 'w', encoding='utf-8') as f:
    f.write(quiz)

print(f"\n{'✅ QuizPage.tsx actualizado completamente' if changed else 'ℹ️ Sin cambios'}")
