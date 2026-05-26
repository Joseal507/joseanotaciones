from pathlib import Path
import re

# ============================================================
# 1) BACKEND: fill_blank menos obvio + prompt más estricto
# ============================================================
route_path = Path('app/api/quiz/route.ts')
route_src = route_path.read_text(encoding='utf-8')

# ── Prompt más estricto para fill_blank y matching ──────────
route_src = route_src.replace(
    '''"fill_blank": "question" DEBE contener exactamente un "___" reemplazando una palabra crucial. Asegúrate de remover la palabra reemplazada de la oración para que NO quede duplicada (por ejemplo, si la frase es "Niels Bohr estudió en la Universidad de Copenhague", reemplazar "Universidad" debe dar como resultado "Niels Bohr estudió en la ___ de Copenhague", NO "Niels Bohr estudió en la ___ Universidad de Copenhague"). "answer" es la palabra. "wordBank" tiene exactamente 4 opciones.''',
    '''"fill_blank": "question" DEBE contener exactamente un "___" reemplazando una palabra crucial. Asegúrate de remover la palabra reemplazada de la oración para que NO quede duplicada. REGLA CRÍTICA: las 4 opciones del "wordBank" deben ser gramaticalmente compatibles con el contexto inmediato del espacio en blanco (mismo género y estructura básica cuando el contexto use artículos como "un", "una", "el", "la"), para que la respuesta NO sea obvia por descarte gramatical. "answer" es la palabra. "wordBank" tiene exactamente 4 opciones.'''
)

route_src = route_src.replace(
    '''"matching": "pairs" DEBE contener exactamente 4 objetos: { "left": "concepto", "right": "definición" }. NO uses placeholders abstractos. Extrae hechos reales.''',
    '''"matching": "pairs" DEBE contener exactamente 4 objetos: { "left": "concepto", "right": "definición" }. REGLA CRÍTICA: los 4 pares deben pertenecer a la misma categoría de comparación o a categorías muy homogéneas, para que no se puedan resolver por simple descarte visual o gramatical. NO uses placeholders abstractos. Extrae hechos reales.'''
)

# ── Fill blank: filtrar banco por compatibilidad gramatical básica ──
fill_pattern = re.compile(
    r"""if \(!wordBank\.includes\(answer\)\) \{
\s*wordBank\.unshift\(answer\);
\s*\}

\s*if \(wordBank\.length < 4\) \{
\s*const fallbacks = \['teoría', 'proceso', 'concepto', 'estructura', 'método', 'función', 'análisis'\];
\s*for \(const f of fallbacks\) \{
\s*if \(!wordBank\.map\(w => w\.toLowerCase\(\)\)\.includes\(f\.toLowerCase\(\)\) && wordBank\.length < 4\) \{
\s*wordBank\.push\(f\);
\s*\}
\s*\}
\s*\}

\s*const shuffledBank = wordBank\.sort\(\(\) => Math\.random\(\) - 0\.5\)\.slice\(0, 5\);
\s*return \{ \.\.\.base, type, question: updatedQuestion, answer, wordBank: shuffledBank \} as FillBlankQuestion;""",
    re.S
)

fill_replacement = """if (!wordBank.includes(answer)) {
  wordBank.unshift(answer);
}

const beforeBlank = updatedQuestion.split('___')[0].trim().toLowerCase();
const article = (beforeBlank.match(/\\b(el|la|los|las|un|una|unos|unas)\\s*$/i)?.[1] || '').toLowerCase();
const genderHint =
  ['la', 'una', 'las', 'unas'].includes(article) ? 'f' :
  ['el', 'un', 'los', 'unos'].includes(article) ? 'm' :
  '';

const classifyGender = (w: string): 'f' | 'm' | 'u' => {
  const s = String(w || '').trim().toLowerCase();
  if (!s || s.includes(' ')) return 'u';
  if (/(ción|sión|dad|tad|tud|umbre|ez|eza|ncia|encia|triz)$/.test(s)) return 'f';
  if (/(aje|or|án|ambre)$/.test(s)) return 'm';
  if (s.endsWith('a') && !/(ma)$/.test(s)) return 'f';
  if (s.endsWith('o')) return 'm';
  return 'u';
};

let candidateBank = Array.from(new Set(wordBank.map((w: any) => String(w).trim()).filter(Boolean)));

if (genderHint) {
  const filtered = candidateBank.filter(w => {
    const g = classifyGender(w);
    return g === genderHint || g === 'u';
  });

  const answerNorm = answer.toLowerCase().trim();
  if (filtered.length >= 4 && filtered.some(w => w.toLowerCase().trim() == answerNorm)) {
    candidateBank = filtered;
  }
}

if (candidateBank.length < 4) {
  const fallbacks =
    genderHint === 'f'
      ? ['alternativa', 'estrategia', 'respuesta', 'ventaja', 'consecuencia', 'hipótesis']
      : genderHint === 'm'
      ? ['proceso', 'mecanismo', 'resultado', 'concepto', 'desafío', 'principio']
      : ['teoría', 'proceso', 'concepto', 'estructura', 'método', 'función', 'análisis'];

  for (const f of fallbacks) {
    if (!candidateBank.map(w => w.toLowerCase()).includes(f.toLowerCase()) && candidateBank.length < 4) {
      candidateBank.push(f);
    }
  }
}

if (!candidateBank.map(w => w.toLowerCase().trim()).includes(answer.toLowerCase().trim())) {
  candidateBank.unshift(answer);
}

candidateBank = Array.from(new Set(candidateBank.map(w => String(w).trim()).filter(Boolean)));

const shuffledBank = [...candidateBank].sort(() => Math.random() - 0.5);
let finalBank = shuffledBank.slice(0, 4);

if (!finalBank.map(w => w.toLowerCase().trim()).includes(answer.toLowerCase().trim())) {
  if (finalBank.length < 4) finalBank.push(answer);
  else finalBank[Math.floor(Math.random() * finalBank.length)] = answer;
}

finalBank = Array.from(new Set(finalBank.map(w => String(w).trim()).filter(Boolean)));

const rescueFallbacks =
  genderHint === 'f'
    ? ['alternativa', 'estrategia', 'respuesta', 'ventaja']
    : genderHint === 'm'
    ? ['proceso', 'mecanismo', 'resultado', 'concepto']
    : ['teoría', 'proceso', 'concepto', 'estructura'];

for (const f of rescueFallbacks) {
  if (finalBank.length >= 4) break;
  if (!finalBank.map(w => w.toLowerCase()).includes(f.toLowerCase())) {
    finalBank.push(f);
  }
}

finalBank = finalBank.slice(0, 4).sort(() => Math.random() - 0.5);

return { ...base, type, question: updatedQuestion, answer, wordBank: finalBank } as FillBlankQuestion;"""

route_src, route_fill_count = fill_pattern.subn(fill_replacement, route_src)

route_path.write_text(route_src, encoding='utf-8')

# ============================================================
# 2) FRONTEND: matching real + colores por relación + Enter
# ============================================================
quiz_path = Path('components/materias/QuizPage.tsx')
quiz_src = quiz_path.read_text(encoding='utf-8')

# ── Matching ya no cuenta como correcto solo por enviar ─────
quiz_src, validate_count = re.subn(
    r"""if \(q\.type === 'matching'\) \{
\s*// matching siempre correcto si se envía \(validación visual\)
\s*return .*?;
\s*\}""",
    """if (q.type === 'matching') {
    if (!Array.isArray(userAnswer) || !Array.isArray(q.pairs)) return false;
    if (userAnswer.length !== q.pairs.length) return false;
    return userAnswer.every((v, i) =>
      String(v ?? '').trim() === String(q.pairs?.[i]?.right ?? '').trim()
    );
  }""",
    quiz_src,
    flags=re.S
)

# ── Matching UI: pintar cada relación bien/mal ──────────────
if "{items.map(item => (" in quiz_src:
    quiz_src = quiz_src.replace(
        "{items.map(item => (",
        """{items.map((item, idx) => {
      const isCorrectPlacement = item === question.pairs?.[idx]?.right;
      return ("""
    )

quiz_src = quiz_src.replace(
    "background: isLocked ? '#f1f3f5' : '#fff',",
    "background: isLocked ? (isCorrectPlacement ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)') : '#fff',"
)

quiz_src = quiz_src.replace(
    "border: `2px solid ${isLocked ? 'rgba(0,0,0,0.1)' : themeColor + '55'}`,",
    "border: `2px solid ${isLocked ? (isCorrectPlacement ? '#10b981' : '#ef4444') : themeColor + '55'}`,"
)

quiz_src = quiz_src.replace(
    """</Reorder.Item>
    ))}
  </Reorder.Group>""",
    """</Reorder.Item>
      );
    })}
  </Reorder.Group>"""
)

# ── Matching UI: contador parcial 2/4 relaciones correctas ──
if "relaciones correctas" not in quiz_src:
    quiz_src = quiz_src.replace(
        """  </Reorder.Group>
</div>
);
}""",
        """  </Reorder.Group>

  {isLocked && (
    <div
      style={{
        gridColumn: '1 / -1',
        marginTop: 4,
        fontSize: 13,
        fontWeight: 800,
        color: '#666',
        fontFamily: BODY,
      }}
    >
      {items.filter((item, idx) => item === question.pairs?.[idx]?.right).length}/{question.pairs?.length ?? 0} relaciones correctas
    </div>
  )}
</div>
);
}"""
    )

# ── Enter = verificar / siguiente ────────────────────────────
if "window.addEventListener('keydown', onQuizEnter)" not in quiz_src:
    anchor = quiz_src.find("const handleNext = useCallback(() => {")
    if anchor != -1:
        insert_at = quiz_src.find("\n  return (", anchor)
        if insert_at == -1:
            insert_at = quiz_src.find("\nreturn (", anchor)

        if insert_at != -1:
            enter_effect = """

  useEffect(() => {
    const onQuizEnter = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (quizState !== 'playing') return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();

      if (tag === 'textarea') return;

      e.preventDefault();

      if (locked) handleNext();
      else handleVerify();
    };

    window.addEventListener('keydown', onQuizEnter);
    return () => window.removeEventListener('keydown', onQuizEnter);
  }, [quizState, locked, handleVerify, handleNext]);
"""
            quiz_src = quiz_src[:insert_at] + enter_effect + quiz_src[insert_at:]

quiz_path.write_text(quiz_src, encoding='utf-8')

print("✅ route.ts actualizado")
print(f"   - fill_blank anti-obvio: {'OK' if route_fill_count else 'NO ENCONTRADO'}")
print("✅ QuizPage.tsx actualizado")
print(f"   - matching validación real: {'OK' if validate_count else 'NO ENCONTRADO'}")
print("   - matching UI por relación: aplicado")
print("   - Enter para verificar/siguiente: aplicado si encontró handleNext")
