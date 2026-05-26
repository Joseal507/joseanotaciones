path = 'components/materias/QuizPage.tsx'

with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

if "function QuestionOptions(" in src:
    print("ℹ️ QuestionOptions ya existe; no hago cambios.")
    raise SystemExit(0)

marker = "// ─── Matching visual con líneas ─────────────────────────────────"

if marker not in src:
    print("❌ No encontré el marcador de MatchingQuestion")
    raise SystemExit(1)

insert_at = src.index(marker)

block = '''
// ═══════════════════════════════════════════════════════════════
// QUESTION OPTIONS — 6 tipos
// ═══════════════════════════════════════════════════════════════
function QuestionOptions({
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
  const renderChoice = ({
    text,
    label,
    selected,
    onClick,
    correct = false,
    wrong = false,
    square = false,
  }: {
    text: string;
    label: string;
    selected: boolean;
    onClick: () => void;
    correct?: boolean;
    wrong?: boolean;
    square?: boolean;
  }) => {
    const borderColor = correct
      ? '#4caf50'
      : wrong
      ? '#f44336'
      : selected
      ? themeColor
      : 'rgba(0,0,0,0.14)';

    const background = correct
      ? 'rgba(76,175,80,0.10)'
      : wrong
      ? 'rgba(244,67,54,0.10)'
      : selected
      ? `${themeColor}12`
      : '#fff';

    return (
      <button
        type="button"
        disabled={isLocked}
        onClick={onClick}
        style={{
          width: '100%',
          minHeight: 56,
          padding: '12px 14px',
          borderRadius: 14,
          border: `2.5px solid ${borderColor}`,
          background,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          textAlign: 'left',
          cursor: isLocked ? 'default' : 'pointer',
          transition: 'all 0.15s ease',
          boxShadow: correct
            ? '0 4px 16px rgba(76,175,80,0.3)'
            : wrong
            ? '0 4px 16px rgba(244,67,54,0.3)'
            : selected
            ? `0 4px 16px ${themeColor}33`
            : 'none',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: square ? 6 : '50%',
            border: `2px solid ${borderColor}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 900,
            color: correct ? '#2e7d32' : wrong ? '#c62828' : selected ? themeColor : '#999',
            flexShrink: 0,
            fontFamily: BODY,
            background: selected || correct || wrong ? 'rgba(0,0,0,0.04)' : 'transparent',
          }}
        >
          {correct ? '✓' : wrong ? '✗' : label}
        </div>

        <span
          style={{
            fontSize: 15,
            fontWeight: selected || correct ? 700 : 500,
            color: '#111',
            fontFamily: BODY,
            lineHeight: 1.4,
          }}
        >
          <MathText text={text} />
        </span>
      </button>
    );
  };

  if (question.type === 'multiple_choice') {
    const options = question.options ?? [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {options.map((opt: string, i: number) => {
          const selected = userAnswer === i;
          const correct = isLocked && i === question.correctAnswer;
          const wrong = isLocked && selected && i !== question.correctAnswer;
          return (
            <div key={i}>
              {renderChoice({
                text: opt,
                label: String.fromCharCode(65 + i),
                selected,
                onClick: () => !isLocked && setUserAnswer(i),
                correct,
                wrong,
              })}
            </div>
          );
        })}
      </div>
    );
  }

  if (question.type === 'true_false') {
    const correctIsTrue =
      question.correctAnswer === true ||
      question.correctAnswer === 0 ||
      String(question.correctAnswer).toLowerCase() === 'true' ||
      String(question.correctAnswer).toLowerCase() === 'verdadero';

    const options = [
      { value: 0, text: 'Verdadero', label: 'V' },
      { value: 1, text: 'Falso', label: 'F' },
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {options.map(opt => {
          const selected = userAnswer === opt.value;
          const correct = isLocked && ((opt.value === 0) === correctIsTrue);
          const wrong = isLocked && selected && !correct;
          return (
            <div key={opt.value}>
              {renderChoice({
                text: opt.text,
                label: opt.label,
                selected,
                onClick: () => !isLocked && setUserAnswer(opt.value),
                correct,
                wrong,
              })}
            </div>
          );
        })}
      </div>
    );
  }

  if (question.type === 'multi_select') {
    const options = question.options ?? [];
    const selectedArr = Array.isArray(userAnswer) ? userAnswer : [];
    const correctSet = new Set(Array.isArray(question.correctAnswers) ? question.correctAnswers : []);

    const toggle = (idx: number) => {
      if (isLocked) return;
      const next = selectedArr.includes(idx)
        ? selectedArr.filter((x: number) => x !== idx)
        : [...selectedArr, idx].sort((a: number, b: number) => a - b);
      setUserAnswer(next.length ? next : null);
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {options.map((opt: string, i: number) => {
          const selected = selectedArr.includes(i);
          const correct = isLocked && correctSet.has(i);
          const wrong = isLocked && selected && !correctSet.has(i);
          return (
            <div key={i}>
              {renderChoice({
                text: opt,
                label: String(i + 1),
                selected,
                onClick: () => toggle(i),
                correct,
                wrong,
                square: true,
              })}
            </div>
          );
        })}
      </div>
    );
  }

  if (question.type === 'fill_blank') {
    return (
      <input
        type="text"
        value={userAnswer ?? ''}
        disabled={isLocked}
        onChange={(e) => setUserAnswer(e.target.value.trim() ? e.target.value : null)}
        placeholder="Escribe tu respuesta..."
        style={{
          width: '100%',
          minHeight: 54,
          padding: '14px 16px',
          borderRadius: 14,
          border: `2px solid ${isLocked ? '#d1d5db' : `${themeColor}55`}`,
          outline: 'none',
          fontSize: 15,
          fontFamily: BODY,
          color: '#111',
          background: isLocked ? '#f8fafc' : '#fff',
        }}
      />
    );
  }

  if (question.type === 'short_answer') {
    return (
      <textarea
        value={userAnswer ?? ''}
        disabled={isLocked}
        onChange={(e) => setUserAnswer(e.target.value.trim() ? e.target.value : null)}
        placeholder="Escribe tu respuesta..."
        rows={5}
        style={{
          width: '100%',
          padding: '14px 16px',
          borderRadius: 14,
          border: `2px solid ${isLocked ? '#d1d5db' : `${themeColor}55`}`,
          outline: 'none',
          fontSize: 15,
          fontFamily: BODY,
          color: '#111',
          background: isLocked ? '#f8fafc' : '#fff',
          resize: 'vertical',
          lineHeight: 1.5,
        }}
      />
    );
  }

  if (question.type === 'matching') {
    return (
      <MatchingQuestion
        question={question}
        userAnswer={userAnswer}
        setUserAnswer={setUserAnswer}
        isLocked={isLocked}
        themeColor={themeColor}
      />
    );
  }

  return null;
}

'''

src = src[:insert_at] + block + src[insert_at:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)

print("✅ QuestionOptions restaurado correctamente")
