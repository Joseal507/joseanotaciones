path = 'components/materias/QuizPage.tsx'

with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

changes = []

# 1) Agregar onVerifyDirect al destructuring de QuestionOptions
old = """function QuestionOptions({
  question,
  userAnswer,
  setUserAnswer,
  isLocked,
  themeColor,
}: {"""

new = """function QuestionOptions({
  question,
  userAnswer,
  setUserAnswer,
  isLocked,
  themeColor,
  onVerifyDirect,
}: {"""

if old in src:
    src = src.replace(old, new, 1)
    changes.append("✅ destructuring de QuestionOptions actualizado")
else:
    changes.append("❌ no encontré destructuring de QuestionOptions")

# 2) Agregar tipo onVerifyDirect en props
old = """  setUserAnswer: (v: any) => void;
  isLocked: boolean;
  themeColor: string;
}) {"""

new = """  setUserAnswer: (v: any) => void;
  isLocked: boolean;
  themeColor: string;
  onVerifyDirect?: (directAnswer?: any) => void;
}) {"""

if old in src:
    src = src.replace(old, new, 1)
    changes.append("✅ tipo de props de QuestionOptions actualizado")
else:
    changes.append("❌ no encontré el bloque de tipos de QuestionOptions")

# 3) multiple_choice auto-verify
old = """                onClick: () => !isLocked && setUserAnswer(i),"""
new = """                onClick: () => {
                  if (isLocked) return;
                  if (onVerifyDirect) onVerifyDirect(i);
                  else setUserAnswer(i);
                },"""

if old in src:
    src = src.replace(old, new, 1)
    changes.append("✅ multiple_choice ahora verifica al tocar")
else:
    changes.append("❌ no encontré onClick de multiple_choice")

# 4) true_false auto-verify
old = """                onClick: () => !isLocked && setUserAnswer(opt.value),"""
new = """                onClick: () => {
                  if (isLocked) return;
                  if (onVerifyDirect) onVerifyDirect(opt.value);
                  else setUserAnswer(opt.value);
                },"""

if old in src:
    src = src.replace(old, new, 1)
    changes.append("✅ true_false ahora verifica al tocar")
else:
    changes.append("❌ no encontré onClick de true_false")

# 5) Reemplazar bloque completo de multi_select
start_marker = """  if (question.type === 'multi_select') {"""
end_marker = """  if (question.type === 'fill_blank') {"""

start = src.find(start_marker)
end = src.find(end_marker)

if start != -1 and end != -1 and end > start:
    new_block = """  if (question.type === 'multi_select') {
    const options = question.options ?? [];
    const selectedArr = Array.isArray(userAnswer) ? userAnswer : [];
    const correctAnswers = Array.isArray(question.correctAnswers) ? question.correctAnswers : [];
    const correctSet = new Set(correctAnswers);

    // Si solo hay 1 respuesta correcta, esta multi_select está mal generada.
    // La tratamos como selección única para que no se sienta absurda.
    const treatAsSingle = correctAnswers.length <= 1;

    const toggle = (idx: number) => {
      if (isLocked) return;

      if (treatAsSingle) {
        const next = [idx];
        if (onVerifyDirect) onVerifyDirect(next);
        else setUserAnswer(next);
        return;
      }

      const next = selectedArr.includes(idx)
        ? selectedArr.filter((x: number) => x !== idx)
        : [...selectedArr, idx].sort((a: number, b: number) => a - b);

      setUserAnswer(next.length ? next : null);
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {treatAsSingle && !isLocked && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 12,
              background: '#fff7ed',
              border: '1px solid #fdba74',
              color: '#9a3412',
              fontSize: 12,
              lineHeight: 1.45,
              fontFamily: BODY,
            }}
          >
            ⚠️ Esta pregunta vino como multi-select, pero solo tiene una respuesta correcta.
            La estoy tratando como selección única.
          </div>
        )}

        {options.map((opt: string, i: number) => {
          const selected = selectedArr.includes(i);
          const correct = isLocked && correctSet.has(i);
          const wrong = isLocked && selected && !correctSet.has(i);

          return (
            <div key={i}>
              {renderChoice({
                text: opt,
                label: treatAsSingle ? String.fromCharCode(65 + i) : String(i + 1),
                selected,
                onClick: () => toggle(i),
                correct,
                wrong,
                square: !treatAsSingle,
              })}
            </div>
          );
        })}
      </div>
    );
  }

"""
    src = src[:start] + new_block + src[end:]
    changes.append("✅ multi_select normalizado cuando solo hay 1 correcta")
else:
    changes.append("❌ no pude reemplazar el bloque multi_select")

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)

print("\\n".join(changes))
