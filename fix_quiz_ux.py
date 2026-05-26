import os

# 1. ─── ACTUALIZAR PROMPTS DE IA (route.ts) ───
with open('app/api/quiz/route.ts', 'r', encoding='utf-8') as f:
    src = f.read()

OLD_FB_ES = '''"fill_blank": "question" DEBE contener exactamente un "___" reemplazando una palabra crucial. Asegúrate de remover la palabra reemplazada de la oración para que NO quede duplicada (por ejemplo, si la frase es "Niels Bohr estudió en la Universidad de Copenhague", reemplazar "Universidad" debe dar como resultado "Niels Bohr estudió en la ___ de Copenhague", NO "Niels Bohr estudió en la ___ Universidad de Copenhague"). "answer" es la palabra. "wordBank" tiene exactamente 4 opciones.'''
NEW_FB_ES = '''"fill_blank": "question" DEBE contener exactamente un "___" reemplazando una palabra crucial. REGLA GRAMATICAL: Todas las opciones en "wordBank" DEBEN compartir el mismo género (masculino/femenino) y número (singular/plural) que la respuesta correcta, para que la respuesta no sea obvia por descartes del texto previo (ej. "el", "una"). "answer" es la palabra correcta. "wordBank" tiene 4 opciones.'''
src = src.replace(OLD_FB_ES, NEW_FB_ES)

OLD_MATCH_ES = '''"matching": "pairs" DEBE contener exactamente 4 objetos: { "left": "concepto", "right": "definición" }. NO uses placeholders abstractos. Extrae hechos reales.'''
NEW_MATCH_ES = '''"matching": "pairs" DEBE contener exactamente 4 objetos: { "left": "concepto", "right": "definición" }. REGLA CRÍTICA: Los 4 conceptos DEBEN pertenecer a la MISMA CATEGORÍA EXACTA (ej. 4 fechas, 4 autores, o 4 teorías) para que la respuesta requiera conocimiento y no sea deducible por simple descarte. Extrae hechos reales.'''
src = src.replace(OLD_MATCH_ES, NEW_MATCH_ES)

with open('app/api/quiz/route.ts', 'w', encoding='utf-8') as f:
    f.write(src)
print("✅ Prompts actualizados (Gramática en Fill Blank y Categorías en Matching)")

# 2. ─── ACTUALIZAR UI DE MATCHING (QuizPage.tsx) ───
with open('components/materias/QuizPage.tsx', 'r', encoding='utf-8') as f:
    src = f.read()

OLD_REORDER = '''<Reorder.Group
    axis="y"
    values={items}
    onReorder={v => !isLocked && setItems(v)}
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      listStyle: 'none',
      margin: 0,
      padding: 0,
    }}
  >
    {items.map(item => (
      <Reorder.Item'''

NEW_REORDER = '''<Reorder.Group
    axis="y"
    values={items}
    onReorder={v => !isLocked && setItems(v)}
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      listStyle: 'none',
      margin: 0,
      padding: 0,
    }}
  >
    {items.map((item, index) => {
      const isRight = item === question.pairs?.[index]?.right;
      return (
      <Reorder.Item'''

OLD_REORDER_BODY = '''<div
          style={{
            height: 54,
            padding: '0 16px',
            background: isLocked ? '#f1f3f5' : '#fff',
            border: `2px solid ${isLocked ? 'rgba(0,0,0,0.1)' : themeColor + '55'}`,
            borderRadius: 12,'''

NEW_REORDER_BODY = '''<div
          style={{
            height: 54,
            padding: '0 16px',
            background: isLocked ? (isRight ? '#ecfdf5' : '#fef2f2') : '#fff',
            border: `2px solid ${isLocked ? (isRight ? '#10b981' : '#ef4444') : themeColor + '55'}`,
            borderRadius: 12,'''

if OLD_REORDER in src and OLD_REORDER_BODY in src:
    src = src.replace(OLD_REORDER, NEW_REORDER)
    src = src.replace(OLD_REORDER_BODY, NEW_REORDER_BODY)
    src = src.replace('''</Reorder.Item>
    ))}
  </Reorder.Group>''', '''</Reorder.Item>
      );
    })}
  </Reorder.Group>''')
    print("✅ Matching UI: Ahora te muestra qué pusiste verde (bien) y qué pusiste rojo (mal)")
else:
    print("❌ No encontré el Reorder.Group de Matching en QuizPage.tsx")

with open('components/materias/QuizPage.tsx', 'w', encoding='utf-8') as f:
    f.write(src)
