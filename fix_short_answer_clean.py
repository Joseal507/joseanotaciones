path = 'components/materias/QuizPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

# Encontrar el bloque short_answer en getQuizAnswerFeedback y reemplazarlo
# Buscar desde "if (question.type === 'short_answer')" hasta el siguiente "if (question.type ==="

import re

pattern = re.compile(
    r"  if \(question\.type === 'short_answer'\) \{.*?^  \}(?=\s*\n\s*if \(question\.type === 'matching'\))",
    re.S | re.M
)

new_block = """  if (question.type === 'short_answer') {
    const accepted: string[] = Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers : [];
    const user = String(userAnswer || '').trim();

    if (!user) {
      return {
        label: 'Incorrecto',
        percent: 0,
        color: bad,
        reason: 'No escribiste una respuesta. Se esperaba: "' + (accepted[0] ?? '') + '".'
      };
    }

    const userNorm = normalizeEvalText(user);
    let best = accepted[0] ?? '';
    let bestScore = 0;

    for (const ans of accepted) {
      const ansNorm = normalizeEvalText(ans);

      if (userNorm === ansNorm) { bestScore = 1; best = ans; break; }

      const ansWords = ansNorm.split(' ').filter((w: string) => w.length > 3);
      const userWordsSet = new Set(userNorm.split(' ').filter((w: string) => w.length > 3));
      const keyHits = ansWords.filter((w: string) => userWordsSet.has(w)).length;
      const keyScore = ansWords.length > 0 ? keyHits / ansWords.length : 0;

      const containScore =
        ansNorm.length > 4 && userNorm.includes(ansNorm) ? 0.92 :
        userNorm.length > 4 && ansNorm.includes(userNorm) ? 0.82 : 0;

      const bigramScore = diceSimilarity(user, ans);
      const tokenScore = tokenOverlapScore(user, ans);

      const userWordCount = userNorm.split(' ').filter(Boolean).length;
      const isLong = userWordCount >= 5;

      const combined = isLong
        ? Math.max(containScore, keyScore * 0.95, bigramScore * 0.65, tokenScore * 0.85)
        : Math.max(containScore, bigramScore, tokenScore, keyScore * 0.9);

      if (combined > bestScore) { bestScore = combined; best = ans; }
    }

    const percent = Math.round(Math.min(bestScore, 1) * 100);

    const bestNorm = normalizeEvalText(best);
    const bestWords = bestNorm.split(' ').filter((w: string) => w.length > 3);
    const userWordsSet2 = new Set(userNorm.split(' ').filter((w: string) => w.length > 3));
    const hitWords = bestWords.filter((w: string) => userWordsSet2.has(w));
    const missedWords = bestWords.filter((w: string) => !userWordsSet2.has(w));

    if (percent >= 85) {
      const hitsStr = hitWords.length > 0
        ? ' Conceptos clave que mencionaste: ' + hitWords.slice(0, 4).join(', ') + '.'
        : '';
      return {
        label: percent >= 97 ? 'Correcto' : 'Parcialmente correcto',
        percent: Math.min(percent, 100),
        color: percent >= 97 ? good : mid,
        reason: percent >= 97
          ? 'Tu respuesta cubre el concepto correctamente.' + hitsStr
          : 'Tu respuesta captura la idea principal.' + hitsStr + ' Respuesta esperada: "' + best + '".'
      };
    }

    if (percent >= 45) {
      const hitsStr2 = hitWords.length > 0
        ? 'Mencionaste: ' + hitWords.slice(0, 3).join(', ') + (missedWords.length > 0 ? ', pero faltó incluir: ' + missedWords.slice(0, 3).join(', ') : '') + '. Respuesta esperada: "' + best + '".'
        : 'Tu respuesta va en parte en la dirección correcta. Respuesta esperada: "' + best + '".';
      return {
        label: 'Parcialmente correcto',
        percent,
        color: mid,
        reason: hitsStr2
      };
    }

    const keywordsStr = bestWords.length > 0
      ? ' Conceptos clave esperados: ' + bestWords.slice(0, 4).join(', ') + '.'
      : '';
    return {
      label: 'Incorrecto',
      percent: Math.min(percent, 30),
      color: bad,
      reason: 'Tu respuesta no cubre los conceptos principales.' + keywordsStr + ' Una respuesta aceptada: "' + best + '".'
    };
  }"""

m = pattern.search(src)
if m:
    src = src[:m.start()] + new_block + src[m.end():]
    print('✅ short_answer reemplazado sin backticks problemáticos')
else:
    print('❌ no encontré el bloque — buscando manualmente...')
    idx = src.find("if (question.type === 'short_answer')")
    print(f'   Posición del bloque: {idx}')
    print(f'   Contexto: {src[idx:idx+100]}')

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
