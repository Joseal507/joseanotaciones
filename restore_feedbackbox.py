path = 'components/materias/QuizPage.tsx'

with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

start_marker = "// ─── FeedbackBox ──────────────────────────────────────────────"
end_marker = "// ─── Matching visual con líneas ─────────────────────────────────"

if start_marker not in src or end_marker not in src:
    print("❌ No encontré los marcadores necesarios")
    print("start:", start_marker in src)
    print("end:", end_marker in src)
    raise SystemExit(1)

start = src.index(start_marker)
end = src.index(end_marker)

new_block = '''// ─── FeedbackBox ──────────────────────────────────────────────
function FeedbackBox({
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
  const bg = skipped ? '#fff7ed' : correct ? '#ecfdf5' : '#fef2f2';
  const border = skipped ? '#fb923c' : correct ? '#10b981' : '#ef4444';
  const clr = skipped ? '#ea580c' : correct ? '#047857' : '#b91c1c';

  const correctLabel = (() => {
    if (question.type === 'multiple_choice') {
      const idx = question.correctAnswer as number;
      return question.options?.[idx] ?? String(idx);
    }

    if (question.type === 'true_false') {
      const correctIsTrue =
        question.correctAnswer === true ||
        question.correctAnswer === 0 ||
        String(question.correctAnswer).toLowerCase() === 'true' ||
        String(question.correctAnswer).toLowerCase() === 'verdadero';
      return correctIsTrue ? 'Verdadero' : 'Falso';
    }

    if (question.type === 'multi_select') {
      return (question.correctAnswers ?? [])
        .map((i: number) => question.options?.[i])
        .filter(Boolean)
        .join(', ');
    }

    if (question.type === 'fill_blank') {
      return question.acceptedAnswers?.[0] ?? (question as any).answer ?? String(question.correctAnswer ?? '');
    }

    if (question.type === 'short_answer') {
      return question.acceptedAnswers?.[0] ?? String(question.correctAnswer ?? '');
    }

    if (question.type === 'matching') {
      return (question.pairs ?? [])
        .map((p: any) => `${p.left} → ${p.right}`)
        .join(' · ');
    }

    return String(question.correctAnswer ?? '');
  })();

  const userLabel = (() => {
    if (userAnswer === null || userAnswer === undefined) return 'Sin respuesta';

    if (question.type === 'multiple_choice') {
      return question.options?.[userAnswer] ?? String(userAnswer);
    }

    if (question.type === 'true_false') {
      const isTrue =
        userAnswer === true ||
        userAnswer === 0 ||
        String(userAnswer).toLowerCase() === 'true' ||
        String(userAnswer).toLowerCase() === 'verdadero';
      return isTrue ? 'Verdadero' : 'Falso';
    }

    if (question.type === 'multi_select') {
      return Array.isArray(userAnswer)
        ? userAnswer.map((i: number) => question.options?.[i]).filter(Boolean).join(', ')
        : 'Sin respuesta';
    }

    if (question.type === 'fill_blank' || question.type === 'short_answer') {
      return String(userAnswer);
    }

    if (question.type === 'matching') {
      if (!Array.isArray(userAnswer)) return 'Sin relaciones';
      const pairs = question.pairs ?? [];
      return pairs
        .map((p: any, i: number) => `${p.left} → ${userAnswer[i] ?? 'sin conectar'}`)
        .join(' · ');
    }

    return String(userAnswer);
  })();

  const fb = getQuizAnswerFeedback(question, userAnswer);

  return (
    <div
      style={{
        marginTop: 14,
        padding: '14px 16px',
        borderRadius: 16,
        background: bg,
        border: `1.5px solid ${border}`,
        boxShadow: `0 8px 24px ${border}18`,
      }}
    >
      <div
        style={{
          fontSize: 18,
          fontWeight: 900,
          color: clr,
          marginBottom: 10,
          fontFamily: BODY,
        }}
      >
        {skipped ? '⏭️ OMITIDA' : correct ? '✅ ¡CORRECTO!' : '❌ INCORRECTO'}
      </div>

      <div
        style={{
          fontSize: 14,
          color: '#111',
          lineHeight: 1.55,
          fontFamily: BODY,
          marginBottom: 6,
        }}
      >
        <span style={{ fontWeight: 900, color: '#10b981' }}>✓ Respuesta correcta:</span>{' '}
        <span>{correctLabel || '—'}</span>
      </div>

      {!skipped && (
        <div
          style={{
            fontSize: 14,
            color: '#111',
            lineHeight: 1.55,
            fontFamily: BODY,
            marginBottom: 6,
          }}
        >
          <span style={{ fontWeight: 900, color: correct ? '#10b981' : '#ef4444' }}>Tu respuesta:</span>{' '}
          <span>"{userLabel}"</span>
        </div>
      )}

      <div
        style={{
          marginTop: 8,
          fontSize: 14,
          fontWeight: 900,
          color: fb.color,
          fontFamily: BODY,
        }}
      >
        {fb.label} ({fb.percent}%)
      </div>

      {fb.reason && (
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: '#444',
            lineHeight: 1.5,
            fontFamily: BODY,
          }}
        >
          {fb.reason}
        </div>
      )}

      {question.explanation && (
        <div
          style={{
            marginTop: 10,
            fontSize: 13,
            color: '#64748b',
            lineHeight: 1.5,
            fontFamily: BODY,
            borderTop: `1px dashed ${themeColor}33`,
            paddingTop: 10,
          }}
        >
          💡 {question.explanation}
        </div>
      )}
    </div>
  );
}

'''

src = src[:start] + new_block + src[end:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)

print("✅ FeedbackBox restaurado correctamente")
