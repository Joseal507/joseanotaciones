path = 'components/materias/QuizPage.tsx'

with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

if "function getQuizAnswerFeedback(" in src or "function normalizeEvalText(" in src:
    print("ℹ️ Ya existe al menos una de las helpers; no inserto para evitar duplicados.")
    raise SystemExit(0)

marker = "// ─── FeedbackBox ──────────────────────────────────────────────"
if marker not in src:
    print("❌ No encontré el marcador de FeedbackBox")
    raise SystemExit(1)

insert_at = src.index(marker)

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
  if (s1.length < 2 || s2.length < 2) return 0;

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
    const chosenText =
      typeof userAnswer === 'number'
        ? (options?.[userAnswer] ?? 'opción seleccionada')
        : '';

    if (userAnswer === correctIdx) {
      return {
        label: 'Correcto',
        percent: 100,
        color: good,
        reason: 'Elegiste la opción correcta: "' + correctText + '".'
      };
    }

    if (userAnswer === null || userAnswer === undefined) {
      return {
        label: 'Incorrecto',
        percent: 0,
        color: bad,
        reason: 'No seleccionaste ninguna opción. La correcta era "' + correctText + '".'
      };
    }

    return {
      label: 'Incorrecto',
      percent: 0,
      color: bad,
      reason: 'Elegiste "' + chosenText + '", pero la correcta era "' + correctText + '".'
    };
  }

  if (question.type === 'true_false') {
    const correctIsTrue =
      question.correctAnswer === true ||
      question.correctAnswer === 0 ||
      String(question.correctAnswer).toLowerCase() === 'true' ||
      String(question.correctAnswer).toLowerCase() === 'verdadero';

    const userIsTrue =
      userAnswer === true ||
      userAnswer === 0 ||
      String(userAnswer).toLowerCase() === 'true' ||
      String(userAnswer).toLowerCase() === 'verdadero';

    const correctLabel = correctIsTrue ? 'Verdadero' : 'Falso';
    const userLabel =
      userAnswer === null || userAnswer === undefined
        ? null
        : (userIsTrue ? 'Verdadero' : 'Falso');

    if (userLabel === null) {
      return {
        label: 'Incorrecto',
        percent: 0,
        color: bad,
        reason: 'No seleccionaste una opción. La respuesta correcta era "' + correctLabel + '".'
      };
    }

    if (correctIsTrue === userIsTrue) {
      return {
        label: 'Correcto',
        percent: 100,
        color: good,
        reason: 'Marcaste "' + userLabel + '", que es la respuesta correcta.'
      };
    }

    return {
      label: 'Incorrecto',
      percent: 0,
      color: bad,
      reason: 'Marcaste "' + userLabel + '", pero la correcta era "' + correctLabel + '".'
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
    const percent = Math.round(Math.max(0, hits / denom) * 100);

    const correctTexts = correctAnswers
      .map(i => options[i])
      .filter(Boolean)
      .join(', ');

    if (selected.length === 0) {
      return {
        label: 'Incorrecto',
        percent: 0,
        color: bad,
        reason: 'No seleccionaste ninguna opción. Las correctas eran: ' + correctTexts + '.'
      };
    }

    if (hits === correctAnswers.length && extras === 0) {
      return {
        label: 'Correcto',
        percent: 100,
        color: good,
        reason: 'Seleccionaste todas las opciones correctas: ' + correctTexts + '.'
      };
    }

    if (hits > 0) {
      return {
        label: 'Parcialmente correcto',
        percent,
        color: mid,
        reason: 'Acertaste ' + hits + ' opción(es), te faltó ' + missed + ' y marcaste ' + extras + ' incorrecta(s). Correctas: ' + correctTexts + '.'
      };
    }

    return {
      label: 'Incorrecto',
      percent: 0,
      color: bad,
      reason: 'No seleccionaste ninguna de las opciones correctas. Las correctas eran: ' + correctTexts + '.'
    };
  }

  if (question.type === 'fill_blank') {
    const targets: string[] =
      Array.isArray(question.acceptedAnswers) && question.acceptedAnswers.length
        ? question.acceptedAnswers.map(String)
        : (question.answer !== undefined
            ? [String(question.answer)]
            : question.correctAnswer !== undefined
            ? [String(question.correctAnswer)]
            : []);

    const user = String(userAnswer || '').trim();

    if (!user) {
      return {
        label: 'Incorrecto',
        percent: 0,
        color: bad,
        reason: 'No completaste el espacio. La respuesta esperada era "' + (targets[0] ?? '') + '".'
      };
    }

    let best = targets[0] ?? '';
    let bestScore = 0;

    for (const t of targets) {
      const exact = normalizeEvalText(user) === normalizeEvalText(t);
      const score = exact ? 1 : Math.max(diceSimilarity(user, t), tokenOverlapScore(user, t));
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }

    const percent = Math.round(bestScore * 100);

    if (percent >= 97) {
      return {
        label: 'Correcto',
        percent: 100,
        color: good,
        reason: 'Completaste correctamente con "' + best + '".'
      };
    }

    if (percent >= 60) {
      return {
        label: 'Parcialmente correcto',
        percent,
        color: mid,
        reason: 'Tu respuesta "' + user + '" se parece bastante a la esperada, que era "' + best + '".'
      };
    }

    return {
      label: 'Incorrecto',
      percent: Math.min(percent, 35),
      color: bad,
      reason: 'Escribiste "' + user + '", pero la respuesta esperada era "' + best + '".'
    };
  }

  if (question.type === 'short_answer') {
    const accepted: string[] =
      Array.isArray(question.acceptedAnswers) && question.acceptedAnswers.length
        ? question.acceptedAnswers.map(String)
        : question.correctAnswer !== undefined
        ? [String(question.correctAnswer)]
        : [];

    const refs: { text: string; source: 'accepted' | 'explanation' }[] = [
      ...accepted.map(t => ({ text: t, source: 'accepted' as const })),
      ...(question.explanation ? [{ text: String(question.explanation), source: 'explanation' as const }] : []),
    ];

    const user = String(userAnswer || '').trim();

    if (!user) {
      return {
        label: 'Incorrecto',
        percent: 0,
        color: bad,
        reason: 'No escribiste una respuesta. Una respuesta válida era: "' + (accepted[0] ?? '') + '".'
      };
    }

    if (refs.length === 0) {
      return {
        label: 'Sin evaluar',
        percent: 0,
        color: '#999',
        reason: 'No hay respuestas de referencia para evaluar esta pregunta.'
      };
    }

    const userNorm = normalizeEvalText(user);
    let bestRef = refs[0].text;
    let bestSource: 'accepted' | 'explanation' = refs[0].source;
    let bestScore = 0;

    for (const ref of refs) {
      const refNorm = normalizeEvalText(ref.text);

      const exact = userNorm === refNorm ? 1 : 0;

      const refWords = refNorm.split(' ').filter((w: string) => w.length > 3);
      const userWords = new Set(userNorm.split(' ').filter((w: string) => w.length > 3));
      const keyHits = refWords.filter((w: string) => userWords.has(w)).length;
      const keyScore = refWords.length > 0 ? keyHits / refWords.length : 0;

      const containsScore =
        refNorm.length > 4 && userNorm.includes(refNorm) ? 0.95 :
        userNorm.length > 4 && refNorm.includes(userNorm) ? 0.82 :
        0;

      const bigram = diceSimilarity(user, ref.text);
      const token = tokenOverlapScore(user, ref.text);

      let score = Math.max(exact, keyScore * 0.95, containsScore, bigram * 0.72, token * 0.9);

      // Si viene de explanation, permitimos análisis semántico,
      // pero no lo inflamos tanto como una accepted exacta.
      if (ref.source === 'explanation') {
        score = Math.min(score, 0.9);
      }

      if (score > bestScore) {
        bestScore = score;
        bestRef = ref.text;
        bestSource = ref.source;
      }
    }

    const percent = Math.round(Math.min(bestScore, 1) * 100);

    const refNorm2 = normalizeEvalText(bestRef);
    const refWords2 = refNorm2.split(' ').filter((w: string) => w.length > 3);
    const userWords2 = new Set(userNorm.split(' ').filter((w: string) => w.length > 3));
    const hitWords = refWords2.filter((w: string) => userWords2.has(w));
    const missedWords = refWords2.filter((w: string) => !userWords2.has(w));

    if (percent >= 97 && bestSource === 'accepted') {
      return {
        label: 'Correcto',
        percent: 100,
        color: good,
        reason: 'Tu respuesta coincide claramente con una respuesta aceptada.'
      };
    }

    if (percent >= 55) {
      const hitText =
        hitWords.length > 0
          ? ' Conceptos que sí captaste: ' + hitWords.slice(0, 4).join(', ') + '.'
          : '';

      const missedText =
        missedWords.length > 0 && bestSource === 'accepted'
          ? ' Te faltó mencionar: ' + missedWords.slice(0, 3).join(', ') + '.'
          : '';

      return {
        label: 'Parcialmente correcto',
        percent,
        color: mid,
        reason:
          'Tu respuesta va en la dirección correcta.' +
          hitText +
          missedText +
          (bestSource === 'accepted'
            ? ' Una forma esperada era: "' + bestRef + '".'
            : ' Se alinea con la explicación del material.')
      };
    }

    return {
      label: 'Incorrecto',
      percent: Math.min(percent, 30),
      color: bad,
      reason:
        'Tu respuesta no coincide suficientemente con la idea esperada.' +
        (accepted[0] ? ' Una respuesta válida era: "' + accepted[0] + '".' : '')
    };
  }

  if (question.type === 'matching') {
    const rights = question.pairs?.map((p: any) => p.right) ?? [];
    const arr = Array.isArray(userAnswer) ? userAnswer : [];
    const hits = rights.filter((r: string, i: number) => arr[i] === r).length;
    const total = rights.length || 1;
    const percent = Math.round((hits / total) * 100);

    if (!Array.isArray(userAnswer) || userAnswer.length === 0) {
      return {
        label: 'Incorrecto',
        percent: 0,
        color: bad,
        reason: 'No conectaste ninguna relación.'
      };
    }

    if (hits === total) {
      return {
        label: 'Correcto',
        percent: 100,
        color: good,
        reason: 'Relacionaste correctamente los ' + total + ' pares.'
      };
    }

    if (hits > 0) {
      return {
        label: 'Parcialmente correcto',
        percent,
        color: mid,
        reason: 'Acertaste ' + hits + ' de ' + total + ' relaciones.'
      };
    }

    return {
      label: 'Incorrecto',
      percent: 0,
      color: bad,
      reason: 'Ninguna de las relaciones quedó en la posición correcta.'
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

src = src[:insert_at] + helpers + "\n" + src[insert_at:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)

print("✅ Helpers de feedback restauradas correctamente")
