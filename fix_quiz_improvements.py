import re

# ── Leer archivo ──────────────────────────────────────────────
with open('components/materias/QuizPage.tsx', 'r', encoding='utf-8') as f:
    src = f.read()

# ══════════════════════════════════════════════════════════════
# 1. Agregar acceptedAnswers y correctAnswer al tipo Question
#    (ya existe, solo aseguramos que fill_blank tenga answer tb)
# ══════════════════════════════════════════════════════════════

# 2. Mejorar FeedbackBox para que SIEMPRE muestre la correcta
OLD_FEEDBACK = '''function FeedbackBox({
  correct,
  question,
  userAnswer,
  themeColor,
}: {
  correct: boolean;
  question: Question;
  userAnswer: any;
  themeColor: string;
}) {
  const bg     = correct ? \'#e8f5e9\' : \'#ffebee\';
  const border = correct ? \'#4caf50\' : \'#f44336\';
  const clr    = correct ? \'#2e7d32\' : \'#c62828\';

  const correctLabel = (() => {
    if (question.type === \'multiple_choice\' || question.type === \'true_false\') {
      const idx = question.correctAnswer as number;
      if (question.type === \'true_false\') return question.correctAnswer ? \'Verdadero\' : \'Falso\';
      return question.options?.[idx] ?? String(idx);
    }
    if (question.type === \'multi_select\') {
      return (question.correctAnswers ?? [])
        .map((i: number) => question.options?.[i])
        .filter(Boolean)
        .join(\', \');
    }
    if (question.type === \'fill_blank\') return question.acceptedAnswers?.[0] ?? \'\';
    if (question.type === \'short_answer\') return question.acceptedAnswers?.[0] ?? \'\';
    return \'\';
  })();

  const userLabel = (() => {
    if (question.type === \'multiple_choice\') {
      return question.options?.[userAnswer as number] ?? String(userAnswer ?? \'\');
    }
    if (question.type === \'true_false\') {
      if (typeof userAnswer === \'number\')
        return userAnswer === 0 ? \'Verdadero\' : \'Falso\';
      return userAnswer ? \'Verdadero\' : \'Falso\';
    }
    if (question.type === \'multi_select\') {
      return (Array.isArray(userAnswer) ? userAnswer : [])
        .map((i: number) => question.options?.[i])
        .filter(Boolean)
        .join(\', \');
    }
    return String(userAnswer ?? \'\');
  })();

  return (
    <div
      style={{
        padding: \'20px 22px\',
        borderRadius: 18,
        background: bg,
        border: `2px dashed ${border}`,
        display: \'flex\',
        flexDirection: \'column\',
        gap: 10,
      }}
    >
      <div
        style={{
          display: \'flex\',
          alignItems: \'center\',
          gap: 8,
          color: clr,
          fontWeight: 900,
          fontSize: 16,
          fontFamily: BODY,
        }}
      >
        {correct ? \'✅ ¡CORRECTO!\' : \'❌ INCORRECTO\'}
      </div>

      {!correct && correctLabel && (
        <div style={{ fontSize: 14, color: \'#333\', fontFamily: BODY }}>
          <span style={{ fontWeight: 700 }}>Respuesta correcta:</span>{' '}
          <span style={{ color: \'#1b5e20\', fontWeight: 700 }}>{correctLabel}</span>
        </div>
      )}

      {!correct && userLabel && (
        <div style={{ fontSize: 13, color: \'#555\', fontFamily: BODY, fontStyle: \'italic\' }}>
          Tu respuesta: "{userLabel}"
        </div>
      )}

      {question.explanation && (
        <div
          style={{
            fontSize: 14,
            color: \'#444\',
            fontFamily: BODY,
            lineHeight: 1.5,
            borderTop: \'1px dashed rgba(0,0,0,0.1)\',
            paddingTop: 10,
          }}
        >
          💡 {question.explanation}
        </div>
      )}
    </div>
  );
}'''

NEW_FEEDBACK = '''function FeedbackBox({
  correct,
  skipped,
  question,
  userAnswer,
  themeColor,
}: {
  correct: boolean;
  skipped?: boolean;
  question: Question;
  userAnswer: any;
  themeColor: string;
}) {
  const bg     = skipped ? \'#fff3e0\' : correct ? \'#e8f5e9\' : \'#ffebee\';
  const border = skipped ? \'#ff9800\' : correct ? \'#4caf50\' : \'#f44336\';
  const clr    = skipped ? \'#e65100\' : correct ? \'#2e7d32\' : \'#c62828\';

  const correctLabel = (() => {
    if (question.type === \'multiple_choice\') {
      const idx = question.correctAnswer as number;
      return question.options?.[idx] ?? String(idx);
    }
    if (question.type === \'true_false\') {
      const correctIsTrue = question.correctAnswer === true
        || question.correctAnswer === 0
        || String(question.correctAnswer).toLowerCase() === \'true\'
        || String(question.correctAnswer).toLowerCase() === \'verdadero\';
      return correctIsTrue ? \'Verdadero\' : \'Falso\';
    }
    if (question.type === \'multi_select\') {
      return (question.correctAnswers ?? [])
        .map((i: number) => question.options?.[i])
        .filter(Boolean)
        .join(\', \');
    }
    if (question.type === \'fill_blank\') {
      return question.acceptedAnswers?.[0] ?? (question as any).answer ?? \'\';
    }
    if (question.type === \'short_answer\') {
      return question.acceptedAnswers?.[0] ?? \'\';
    }
    return \'\';
  })();

  const userLabel = (() => {
    if (skipped) return null;
    if (question.type === \'multiple_choice\') {
      return question.options?.[userAnswer as number] ?? String(userAnswer ?? \'\');
    }
    if (question.type === \'true_false\') {
      if (typeof userAnswer === \'number\')
        return userAnswer === 0 ? \'Verdadero\' : \'Falso\';
      return userAnswer ? \'Verdadero\' : \'Falso\';
    }
    if (question.type === \'multi_select\') {
      return (Array.isArray(userAnswer) ? userAnswer : [])
        .map((i: number) => question.options?.[i])
        .filter(Boolean)
        .join(\', \');
    }
    return String(userAnswer ?? \'\');
  })();

  return (
    <div
      style={{
        padding: \'20px 22px\',
        borderRadius: 18,
        background: bg,
        border: `2px dashed ${border}`,
        display: \'flex\',
        flexDirection: \'column\',
        gap: 10,
      }}
    >
      <div
        style={{
          display: \'flex\',
          alignItems: \'center\',
          gap: 8,
          color: clr,
          fontWeight: 900,
          fontSize: 16,
          fontFamily: BODY,
        }}
      >
        {skipped ? \'🤷 NO SABÍAS\' : correct ? \'✅ ¡CORRECTO!\' : \'❌ INCORRECTO\'}
      </div>

      {/* Siempre mostrar la respuesta correcta cuando no es correcto o es skipped */}
      {(!correct || skipped) && correctLabel && (
        <div style={{
          padding: \'10px 14px\',
          background: \'rgba(27,94,32,0.08)\',
          borderRadius: 10,
          fontSize: 14,
          color: \'#333\',
          fontFamily: BODY,
          borderLeft: \'3px solid #4caf50\',
        }}>
          <span style={{ fontWeight: 700, color: \'#1b5e20\' }}>✓ Respuesta correcta:</span>{' '}
          <span style={{ color: \'#1b5e20\', fontWeight: 700 }}>{correctLabel}</span>
        </div>
      )}

      {/* Siempre mostrar la respuesta correcta cuando ES correcto también */}
      {correct && !skipped && correctLabel && (
        <div style={{
          padding: \'8px 14px\',
          background: \'rgba(27,94,32,0.06)\',
          borderRadius: 10,
          fontSize: 13,
          color: \'#2e7d32\',
          fontFamily: BODY,
        }}>
          ✓ {correctLabel}
        </div>
      )}

      {!skipped && userLabel && !correct && (
        <div style={{ fontSize: 13, color: \'#555\', fontFamily: BODY, fontStyle: \'italic\' }}>
          Tu respuesta: "{userLabel}"
        </div>
      )}

      {question.explanation && (
        <div
          style={{
            fontSize: 14,
            color: \'#444\',
            fontFamily: BODY,
            lineHeight: 1.5,
            borderTop: \'1px dashed rgba(0,0,0,0.1)\',
            paddingTop: 10,
          }}
        >
          💡 {question.explanation}
        </div>
      )}
    </div>
  );
}'''

src = src.replace(OLD_FEEDBACK, NEW_FEEDBACK)

# ══════════════════════════════════════════════════════════════
# 3. Agregar prop skipped al HistoryEntry y handleSkip
# ══════════════════════════════════════════════════════════════

OLD_HISTORY_INTERFACE = '''interface HistoryEntry {
  question: Question;
  userAnswer: any;
  correct: boolean;
  timeMs: number;
}'''

NEW_HISTORY_INTERFACE = '''interface HistoryEntry {
  question: Question;
  userAnswer: any;
  correct: boolean;
  skipped: boolean;
  timeMs: number;
}'''

src = src.replace(OLD_HISTORY_INTERFACE, NEW_HISTORY_INTERFACE)

# ══════════════════════════════════════════════════════════════
# 4. Reemplazar handleVerify para incluir skipped=false
# ══════════════════════════════════════════════════════════════

OLD_HANDLE_VERIFY = '''  // ── Verificar respuesta (acepta answer directo para auto-verify) ───
  const handleVerify = useCallback((directAnswer?: any) => {
    const answerToCheck = directAnswer !== undefined ? directAnswer : userAnswer;
    if (isLocked || answerToCheck === null || answerToCheck === undefined) return;
    const q = questions[currentIndex];
    const correct = checkAnswer(q, answerToCheck);
    const timeMs  = Date.now() - questionStartTime;

    // Actualizar userAnswer si vino directo
    if (directAnswer !== undefined) setUserAnswer(directAnswer);

    const entry: HistoryEntry = { question: q, userAnswer: answerToCheck, correct, timeMs };
    const newHistory = [...history, entry];
    setHistory(newHistory);
    setIsLocked(true);

    if (correct && currentIndex === questions.length - 1) {
      confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
    }
  }, [isLocked, userAnswer, questions, currentIndex, history, questionStartTime]);'''

NEW_HANDLE_VERIFY = '''  // ── Verificar respuesta (acepta answer directo para auto-verify) ───
  const handleVerify = useCallback((directAnswer?: any) => {
    const answerToCheck = directAnswer !== undefined ? directAnswer : userAnswer;
    if (isLocked || answerToCheck === null || answerToCheck === undefined) return;
    const q = questions[currentIndex];
    const correct = checkAnswer(q, answerToCheck);
    const timeMs  = Date.now() - questionStartTime;

    // Actualizar userAnswer si vino directo
    if (directAnswer !== undefined) setUserAnswer(directAnswer);

    const entry: HistoryEntry = { question: q, userAnswer: answerToCheck, correct, skipped: false, timeMs };
    const newHistory = [...history, entry];
    setHistory(newHistory);
    setIsLocked(true);

    if (correct && currentIndex === questions.length - 1) {
      confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
    }
  }, [isLocked, userAnswer, questions, currentIndex, history, questionStartTime]);

  // ── No sé — marca como incorrecta y revela respuesta ──────
  const handleSkip = useCallback(() => {
    if (isLocked) return;
    const q = questions[currentIndex];
    const timeMs = Date.now() - questionStartTime;
    const entry: HistoryEntry = { question: q, userAnswer: null, correct: false, skipped: true, timeMs };
    setHistory(prev => [...prev, entry]);
    setUserAnswer(null);
    setIsLocked(true);
  }, [isLocked, questions, currentIndex, questionStartTime]);'''

src = src.replace(OLD_HANDLE_VERIFY, NEW_HANDLE_VERIFY)

# ══════════════════════════════════════════════════════════════
# 5. Pasar handleSkip a QuestionCard y actualizar su interfaz
# ══════════════════════════════════════════════════════════════

OLD_QUESTION_CARD_CALL = '''            {quizState === 'playing' && currentQ && (
              <QuestionCard
                key={`q-${currentIndex}`}
                question={currentQ}
                index={currentIndex}
                total={questions.length}
                themeColor={themeColor}
                userAnswer={userAnswer}
                setUserAnswer={setUserAnswer}
                isLocked={isLocked}
                lastEntry={history[history.length - 1] ?? null}
                showWordBank={showWordBank}
                setShowWordBank={setShowWordBank}
                onVerify={handleVerify}
                onNext={handleNext}
                isLast={isLastQ}
              />'''

NEW_QUESTION_CARD_CALL = '''            {quizState === 'playing' && currentQ && (
              <QuestionCard
                key={`q-${currentIndex}`}
                question={currentQ}
                index={currentIndex}
                total={questions.length}
                themeColor={themeColor}
                userAnswer={userAnswer}
                setUserAnswer={setUserAnswer}
                isLocked={isLocked}
                lastEntry={history[history.length - 1] ?? null}
                showWordBank={showWordBank}
                setShowWordBank={setShowWordBank}
                onVerify={handleVerify}
                onSkip={handleSkip}
                onNext={handleNext}
                isLast={isLastQ}
              />'''

src = src.replace(OLD_QUESTION_CARD_CALL, NEW_QUESTION_CARD_CALL)

# ══════════════════════════════════════════════════════════════
# 6. Actualizar QuestionCard para recibir onSkip y mostrar botón
# ══════════════════════════════════════════════════════════════

OLD_QC_PROPS = '''  onVerify: (directAnswer?: any) => void;
  onNext: () => void;
  isLast: boolean;
}) {
  const isCorrect = lastEntry?.correct ?? null;'''

NEW_QC_PROPS = '''  onVerify: (directAnswer?: any) => void;
  onSkip: () => void;
  onNext: () => void;
  isLast: boolean;
}) {
  const isCorrect = lastEntry?.correct ?? null;
  const isSkipped = lastEntry?.skipped ?? false;'''

src = src.replace(OLD_QC_PROPS, NEW_QC_PROPS)

# Actualizar la destructuración en la firma de QuestionCard
OLD_QC_DESTRUCTURE = '''{
  question,
  index,
  total,
  themeColor,
  userAnswer,
  setUserAnswer,
  isLocked,
  lastEntry,
  showWordBank,
  setShowWordBank,
  onVerify,
  onNext,
  isLast,
}: {
  question: Question;
  index: number;
  total: number;
  themeColor: string;
  userAnswer: any;
  setUserAnswer: (v: any) => void;
  isLocked: boolean;
  lastEntry: HistoryEntry | null;
  showWordBank: boolean;
  setShowWordBank: (v: boolean) => void;
  onVerify: (directAnswer?: any) => void;
  onNext: () => void;
  isLast: boolean;'''

NEW_QC_DESTRUCTURE = '''{
  question,
  index,
  total,
  themeColor,
  userAnswer,
  setUserAnswer,
  isLocked,
  lastEntry,
  showWordBank,
  setShowWordBank,
  onVerify,
  onSkip,
  onNext,
  isLast,
}: {
  question: Question;
  index: number;
  total: number;
  themeColor: string;
  userAnswer: any;
  setUserAnswer: (v: any) => void;
  isLocked: boolean;
  lastEntry: HistoryEntry | null;
  showWordBank: boolean;
  setShowWordBank: (v: boolean) => void;
  onVerify: (directAnswer?: any) => void;
  onSkip: () => void;
  onNext: () => void;
  isLast: boolean;'''

src = src.replace(OLD_QC_DESTRUCTURE, NEW_QC_DESTRUCTURE)

# ══════════════════════════════════════════════════════════════
# 7. Reemplazar el footer de QuestionCard (verificar/feedback/siguiente)
#    para agregar botón "No sé" y pasar skipped a FeedbackBox
# ══════════════════════════════════════════════════════════════

OLD_FOOTER = '''        {/* Footer: verificar / feedback / siguiente */}
        <div style={{ marginTop: 32 }}>
          {!isLocked ? (
            (question.type === 'fill_blank' ||
              question.type === 'short_answer' ||
              question.type === 'multi_select' ||
              question.type === 'matching') ? (
              <button
                disabled={
                  userAnswer === null ||
                  userAnswer === undefined ||
                  (Array.isArray(userAnswer) && userAnswer.length === 0) ||
                  (typeof userAnswer === 'string' && !userAnswer.trim())
                }
                onClick={() => onVerify()}
                style={{
                  width: '100%',
                  padding: '18px',
                  borderRadius: 16,
                  border: 'none',
                  cursor:
                    userAnswer === null ||
                    userAnswer === undefined ||
                    (Array.isArray(userAnswer) && userAnswer.length === 0) ||
                    (typeof userAnswer === 'string' && !userAnswer.trim())
                      ? 'not-allowed'
                      : 'pointer',
                  background:
                    userAnswer === null ||
                    userAnswer === undefined ||
                    (Array.isArray(userAnswer) && userAnswer.length === 0) ||
                    (typeof userAnswer === 'string' && !userAnswer.trim())
                      ? '#ccc'
                      : `linear-gradient(135deg, ${themeColor}, ${themeColor}cc)`,
                  color: '#000',
                  fontWeight: 900,
                  fontSize: 17,
                  fontFamily: BODY,
                  transition: 'all 0.2s',
                  boxShadow:
                    userAnswer !== null &&
                    userAnswer !== undefined &&
                    !(Array.isArray(userAnswer) && userAnswer.length === 0) &&
                    !(typeof userAnswer === 'string' && !userAnswer.trim())
                      ? `0 8px 24px ${themeColor}44`
                      : 'none',
                }}
              >
                VERIFICAR ✓
              </button>
            ) : null
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              {/* Feedback box */}
              <FeedbackBox
                correct={isCorrect ?? false}
                question={question}
                userAnswer={lastEntry?.userAnswer}
                themeColor={themeColor}
              />
              <button
                onClick={onNext}
                style={{
                  width: '100%',
                  padding: '18px',
                  borderRadius: 16,
                  border: 'none',
                  cursor: 'pointer',
                  background: '#1a1a2e',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: 17,
                  fontFamily: BODY,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={e =>
                  ((e.currentTarget as HTMLElement).style.background = '#22223a')
                }
                onMouseLeave={e =>
                  ((e.currentTarget as HTMLElement).style.background = '#1a1a2e')
                }
              >
                {isLast ? '✓ VER RESULTADOS' : 'SIGUIENTE →'}
              </button>
            </motion.div>
          )}
        </div>'''

NEW_FOOTER = '''        {/* Footer: verificar / no sé / feedback / siguiente */}
        <div style={{ marginTop: 32 }}>
          {!isLocked ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(question.type === 'fill_blank' ||
                question.type === 'short_answer' ||
                question.type === 'multi_select' ||
                question.type === 'matching') && (
                <button
                  disabled={
                    userAnswer === null ||
                    userAnswer === undefined ||
                    (Array.isArray(userAnswer) && userAnswer.length === 0) ||
                    (typeof userAnswer === 'string' && !userAnswer.trim())
                  }
                  onClick={() => onVerify()}
                  style={{
                    width: '100%',
                    padding: '18px',
                    borderRadius: 16,
                    border: 'none',
                    cursor:
                      userAnswer === null ||
                      userAnswer === undefined ||
                      (Array.isArray(userAnswer) && userAnswer.length === 0) ||
                      (typeof userAnswer === 'string' && !userAnswer.trim())
                        ? 'not-allowed'
                        : 'pointer',
                    background:
                      userAnswer === null ||
                      userAnswer === undefined ||
                      (Array.isArray(userAnswer) && userAnswer.length === 0) ||
                      (typeof userAnswer === 'string' && !userAnswer.trim())
                        ? '#ccc'
                        : `linear-gradient(135deg, ${themeColor}, ${themeColor}cc)`,
                    color: '#000',
                    fontWeight: 900,
                    fontSize: 17,
                    fontFamily: BODY,
                    transition: 'all 0.2s',
                    boxShadow:
                      userAnswer !== null &&
                      userAnswer !== undefined &&
                      !(Array.isArray(userAnswer) && userAnswer.length === 0) &&
                      !(typeof userAnswer === 'string' && !userAnswer.trim())
                        ? `0 8px 24px ${themeColor}44`
                        : 'none',
                  }}
                >
                  VERIFICAR ✓
                </button>
              )}
              {/* Botón No sé — siempre visible cuando no está bloqueado */}
              <button
                onClick={onSkip}
                style={{
                  width: '100%',
                  padding: '14px',
                  borderRadius: 16,
                  border: '2px dashed rgba(0,0,0,0.2)',
                  cursor: 'pointer',
                  background: 'rgba(0,0,0,0.04)',
                  color: '#666',
                  fontWeight: 700,
                  fontSize: 15,
                  fontFamily: BODY,
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(255,152,0,0.08)';
                  (e.currentTarget as HTMLElement).style.borderColor = '#ff9800';
                  (e.currentTarget as HTMLElement).style.color = '#e65100';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)';
                  (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,0,0,0.2)';
                  (e.currentTarget as HTMLElement).style.color = '#666';
                }}
              >
                🤷 No sé — ver respuesta
              </button>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              {/* Feedback box */}
              <FeedbackBox
                correct={isCorrect ?? false}
                skipped={isSkipped}
                question={question}
                userAnswer={lastEntry?.userAnswer}
                themeColor={themeColor}
              />
              <button
                onClick={onNext}
                style={{
                  width: '100%',
                  padding: '18px',
                  borderRadius: 16,
                  border: 'none',
                  cursor: 'pointer',
                  background: '#1a1a2e',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: 17,
                  fontFamily: BODY,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={e =>
                  ((e.currentTarget as HTMLElement).style.background = '#22223a')
                }
                onMouseLeave={e =>
                  ((e.currentTarget as HTMLElement).style.background = '#1a1a2e')
                }
              >
                {isLast ? '✓ VER RESULTADOS' : 'SIGUIENTE →'}
              </button>
            </motion.div>
          )}
        </div>'''

src = src.replace(OLD_FOOTER, NEW_FOOTER)

# ══════════════════════════════════════════════════════════════
# 8. Actualizar ReviewItem para mostrar skipped y respuesta correcta
# ══════════════════════════════════════════════════════════════

OLD_REVIEW_ITEM_DESTRUCTURE = '''  const { question: q, correct, userAnswer } = entry;'''
NEW_REVIEW_ITEM_DESTRUCTURE = '''  const { question: q, correct, skipped, userAnswer } = entry;'''
src = src.replace(OLD_REVIEW_ITEM_DESTRUCTURE, NEW_REVIEW_ITEM_DESTRUCTURE)

OLD_REVIEW_ICON = '''        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: correct ? '#4ade8022' : '#f8717122',
            border: `2px solid ${correct ? '#4ade80' : '#f87171'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            color: correct ? '#4ade80' : '#f87171',
            fontWeight: 900,
            flexShrink: 0,
          }}
        >
          {correct ? '✓' : '✗'}
        </div>'''

NEW_REVIEW_ICON = '''        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: skipped ? '#ff980022' : correct ? '#4ade8022' : '#f8717122',
            border: `2px solid ${skipped ? '#ff9800' : correct ? '#4ade80' : '#f87171'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            color: skipped ? '#ff9800' : correct ? '#4ade80' : '#f87171',
            fontWeight: 900,
            flexShrink: 0,
          }}
        >
          {skipped ? '?' : correct ? '✓' : '✗'}
        </div>'''

src = src.replace(OLD_REVIEW_ICON, NEW_REVIEW_ICON)

# Agregar la respuesta correcta en ReviewItem expandido
OLD_REVIEW_EXPANDED = '''            <div
              style={{
                padding: '0 20px 20px 62px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {userLabel && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: correct ? '#4ade8011' : '#f8717111',
                    borderRadius: 10,
                    fontSize: 13,
                    color: correct ? '#4ade80' : '#f87171',
                    fontFamily: BODY,
                  }}
                >
                  <strong>Tu respuesta:</strong> {userLabel}
                </div>
              )}
              {q.explanation && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'rgba(255,255,255,0.04)',
                    borderRadius: 10,
                    fontSize: 13,
                    color: '#bbb',
                    fontFamily: BODY,
                    lineHeight: 1.5,
                  }}
                >
                  💡 {q.explanation}
                </div>
              )}
            </div>'''

NEW_REVIEW_EXPANDED = '''            <div
              style={{
                padding: '0 20px 20px 62px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {/* Respuesta correcta — siempre visible */}
              {(() => {
                let correctLabel = '';
                if (q.type === 'multiple_choice') {
                  correctLabel = q.options?.[q.correctAnswer as number] ?? '';
                } else if (q.type === 'true_false') {
                  const correctIsTrue = q.correctAnswer === true || q.correctAnswer === 0
                    || String(q.correctAnswer).toLowerCase() === 'true'
                    || String(q.correctAnswer).toLowerCase() === 'verdadero';
                  correctLabel = correctIsTrue ? 'Verdadero' : 'Falso';
                } else if (q.type === 'multi_select') {
                  correctLabel = (q.correctAnswers ?? []).map((i: number) => q.options?.[i]).filter(Boolean).join(', ');
                } else if (q.type === 'fill_blank') {
                  correctLabel = q.acceptedAnswers?.[0] ?? (q as any).answer ?? '';
                } else if (q.type === 'short_answer') {
                  correctLabel = q.acceptedAnswers?.[0] ?? '';
                }
                if (!correctLabel) return null;
                return (
                  <div style={{
                    padding: '10px 14px',
                    background: 'rgba(76,175,80,0.1)',
                    borderRadius: 10,
                    fontSize: 13,
                    color: '#4ade80',
                    fontFamily: BODY,
                    borderLeft: '3px solid #4ade80',
                  }}>
                    <strong>✓ Respuesta correcta:</strong> {correctLabel}
                  </div>
                );
              })()}
              {!skipped && userLabel && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: correct ? '#4ade8011' : '#f8717111',
                    borderRadius: 10,
                    fontSize: 13,
                    color: correct ? '#4ade80' : '#f87171',
                    fontFamily: BODY,
                  }}
                >
                  <strong>Tu respuesta:</strong> {userLabel}
                </div>
              )}
              {skipped && (
                <div style={{
                  padding: '10px 14px',
                  background: '#ff980011',
                  borderRadius: 10,
                  fontSize: 13,
                  color: '#ff9800',
                  fontFamily: BODY,
                }}>
                  🤷 No respondiste esta pregunta
                </div>
              )}
              {q.explanation && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'rgba(255,255,255,0.04)',
                    borderRadius: 10,
                    fontSize: 13,
                    color: '#bbb',
                    fontFamily: BODY,
                    lineHeight: 1.5,
                  }}
                >
                  💡 {q.explanation}
                </div>
              )}
            </div>'''

src = src.replace(OLD_REVIEW_EXPANDED, NEW_REVIEW_EXPANDED)

# ══════════════════════════════════════════════════════════════
# 9. Mejorar el visor PDF del quiz para que sea igual al de flashcards
#    (con onRequestPrev/Next multi-material y totalSelectedPages)
# ══════════════════════════════════════════════════════════════

OLD_PDF_VIEWER_CALL = '''              <div style={{ flex: 1, overflow: 'hidden' }}>
                <PDFViewer
                  key={`${activeMaterialIndex}-${pdfUrl}`}
                  url={pdfUrl}
                  themeColor={themeColor}
                  selectedPages={activeMaterialSelectedPages}
                  onTotalPages={setNumPages}
                  activeMaterialIndex={activeMaterialIndex}
                  forcedPage={currentQ?.sourcePage}
                />
              </div>'''

NEW_PDF_VIEWER_CALL = '''              <div style={{ flex: 1, overflow: 'hidden' }}>
                <PDFViewer
                  key={`${activeMaterialIndex}-${pdfUrl}`}
                  url={pdfUrl}
                  themeColor={themeColor}
                  selectedPages={activeMaterialSelectedPages}
                  onTotalPages={setNumPages}
                  activeMaterialIndex={activeMaterialIndex}
                  materialesCount={materiales.length}
                  totalSelectedPages={seleccion?.reduce((acc: number, s: any) => {
                    const pages = Array.isArray(s?.paginasSeleccionadas) ? s.paginasSeleccionadas :
                                  Array.isArray(s?.pages) ? s.pages : [];
                    return acc + pages.length;
                  }, 0) ?? 0}
                  forcedPage={currentQ?.sourcePage}
                  onRequestPrev={activeMaterialIndex > 0 ? () => setActiveMaterialIndex(i => i - 1) : undefined}
                  onRequestNext={activeMaterialIndex < materiales.length - 1 ? () => setActiveMaterialIndex(i => i + 1) : undefined}
                />
              </div>'''

src = src.replace(OLD_PDF_VIEWER_CALL, NEW_PDF_VIEWER_CALL)

# ══════════════════════════════════════════════════════════════
# 10. Arreglar el checkAnswer para fill_blank usando también .answer
# ══════════════════════════════════════════════════════════════

OLD_CHECK_FILL = '''  if (q.type === 'fill_blank' || q.type === 'short_answer') {
    const targets = q.acceptedAnswers?.length
      ? q.acceptedAnswers
      : q.correctAnswer !== undefined
      ? [String(q.correctAnswer)]
      : [];
    const norm = (s: string) => String(s).toLowerCase().trim().replace(/[^a-záéíóúüñ0-9\\s]/gi, '');
    return targets.some(t => norm(t) === norm(String(userAnswer ?? '')));
  }'''

NEW_CHECK_FILL = '''  if (q.type === 'fill_blank' || q.type === 'short_answer') {
    const targets = q.acceptedAnswers?.length
      ? q.acceptedAnswers
      : (q as any).answer
      ? [String((q as any).answer)]
      : q.correctAnswer !== undefined
      ? [String(q.correctAnswer)]
      : [];
    const norm = (s: string) => String(s).toLowerCase().trim().replace(/[^a-záéíóúüñ0-9\\s]/gi, '');
    return targets.some(t => norm(t) === norm(String(userAnswer ?? '')));
  }'''

src = src.replace(OLD_CHECK_FILL, NEW_CHECK_FILL)

# ══════════════════════════════════════════════════════════════
# Escribir archivo
# ══════════════════════════════════════════════════════════════
with open('components/materias/QuizPage.tsx', 'w', encoding='utf-8') as f:
    f.write(src)

print('✅ QuizPage.tsx actualizado correctamente')
print('   - FeedbackBox siempre muestra respuesta correcta')
print('   - fill_blank muestra la respuesta si es incorrecta')
print('   - Botón "No sé" en todas las preguntas')
print('   - Vista PDF igual que flashcards (onRequestPrev/Next)')
print('   - ReviewItem muestra respuesta correcta siempre')
print('   - skipped se distingue en colores naranja')
