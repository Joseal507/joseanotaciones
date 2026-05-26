import pathlib

path = pathlib.Path('lib/materials/extractors.ts')
text = path.read_text(encoding='utf-8')

old = '''  const prompt = `Extrae TODO el texto de este PDF página por página.

REGLAS ESTRICTAS:
1. Para cada página devuelve EXACTAMENTE este formato:
[Pagina N]
<todo el texto de esa página tal cual aparece>

2. Conserva el orden de lectura natural (de arriba a abajo, izquierda a derecha)
3. Incluye títulos, párrafos, tablas (como texto plano), listas
4. NO inventes texto, solo extrae lo que ves
5. Separa cada página con dos saltos de línea
6. NO uses markdown, solo texto plano
7. Para fórmulas matemáticas usa notación LaTeX entre $...$

Devuelve SOLO el texto extraído, sin explicaciones adicionales.`;'''

new = '''  const prompt = `Eres un extractor de texto de PDF. Tu tarea: devolver TODO el texto del PDF organizado EXACTAMENTE por páginas.

FORMATO OBLIGATORIO (sin excepciones):

[Pagina 1]
texto de la página 1 aquí...
todo el texto literal sin omitir nada...

[Pagina 2]
texto de la página 2 aquí...

[Pagina 3]
texto de la página 3 aquí...

REGLAS:
- DEBES empezar cada página con el marcador exacto: [Pagina N] donde N es el número de página (1, 2, 3...)
- DEBES incluir TODAS las páginas del PDF (no omitas ninguna)
- Cada marcador [Pagina N] va en su propia línea
- Después del marcador viene el texto completo de esa página
- Si una página está vacía, escribe: [Pagina N]\\n(página vacía)
- Conserva orden de lectura natural (arriba→abajo, izq→der)
- Incluye títulos, párrafos, tablas como texto plano, listas, todo
- NO inventes texto, solo extrae lo visible
- NO uses markdown (sin #, sin **, sin --)
- Para fórmulas matemáticas usa LaTeX $...$
- NO añadas comentarios ni explicaciones tuyas

EJEMPLO de respuesta válida:
[Pagina 1]
Título del documento
Primer párrafo del documento...
Segundo párrafo...

[Pagina 2]
Sección 2: Detalles
Lista de elementos:
- Item 1
- Item 2

Empieza AHORA con [Pagina 1]:`;'''

if old in text:
    text = text.replace(old, new)
    print("✅ Prompt reforzado con formato estricto")
else:
    print("❌ No encontré prompt")

path.write_text(text, encoding='utf-8')
