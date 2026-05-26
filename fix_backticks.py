path = 'components/materias/QuizPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

# Reemplazar los backticks escapados que quedaron en el archivo
fixes = [
    (r'\`Tu respuesta cubre el concepto correctamente.\${hitsStr}\`',
     '`Tu respuesta cubre el concepto correctamente.${hitsStr}`'),
    (r'\`Tu respuesta captura la idea principal.\${hitsStr} Respuesta esperada: "\${best}".\`',
     '`Tu respuesta captura la idea principal.${hitsStr} Respuesta esperada: "${best}".`'),
    (r'\`Mencionaste \${hitWords.slice(0, 3).join(\', \')}\${missedWords.length > 0 ? \`',
     '`Mencionaste ${hitWords.slice(0, 3).join(\', \')}${missedWords.length > 0 ? `'),
    (r'\`Tu respuesta va en parte en la dirección correcta. Respuesta esperada: "\${best}".\`',
     '`Tu respuesta va en parte en la dirección correcta. Respuesta esperada: "${best}".`'),
    (r'\`Tu respuesta no cubre los conceptos principales.\${keywordsStr} Una respuesta aceptada: "\${best}".\`',
     '`Tu respuesta no cubre los conceptos principales.${keywordsStr} Una respuesta aceptada: "${best}".`'),
]

for old, new in fixes:
    if old in src:
        src = src.replace(old, new)
        print(f'✅ {old[:50]}...')
    else:
        print(f'❌ no encontré: {old[:50]}...')

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
