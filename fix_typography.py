from pathlib import Path
import re

# ══════════════════════════════════════════════
# 1) globals.css — añadir Inter + reglas base
# ══════════════════════════════════════════════
css_path = Path("app/globals.css")
css = css_path.read_text(encoding='utf-8')

font_import = """@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

"""

base_rules = """
/* ── Tipografía base ── */
body, input, textarea, select, button {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

/* Caveat solo para elementos decorativos */
.hand, .font-hand {
  font-family: var(--font-caveat), 'Caveat', cursive;
}

/* Texto de contenido siempre Inter */
p, span:not(.hand), li, td, th, label, small {
  font-family: inherit;
}
"""

if '@import url' not in css:
    css = font_import + css

if '/* ── Tipografía base ── */' not in css:
    css = css + base_rules

css_path.write_text(css, encoding='utf-8')
print("✅ globals.css actualizado con Inter + reglas base")

# ══════════════════════════════════════════════
# 2) layout.tsx — añadir Inter de next/font
# ══════════════════════════════════════════════
layout_path = Path("app/layout.tsx")
layout = layout_path.read_text(encoding='utf-8')

old_font = """import { Caveat } from 'next/font/google';"""
new_font = """import { Caveat, Inter } from 'next/font/google';"""

old_caveat = """const caveat = Caveat({
  subsets: ['latin'],
  weight: ['600', '700'],
  display: 'swap',
  variable: '--font-caveat',
});"""

new_caveat = """const caveat = Caveat({
  subsets: ['latin'],
  weight: ['600', '700'],
  display: 'swap',
  variable: '--font-caveat',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
});"""

old_html = """    <html lang="es" className={caveat.variable}>"""
new_html = """    <html lang="es" className={`${caveat.variable} ${inter.variable}`}>"""

if old_font in layout:
    layout = layout.replace(old_font, new_font)
    print("✅ layout: Inter importado")

if old_caveat in layout:
    layout = layout.replace(old_caveat, new_caveat)
    print("✅ layout: Inter font definido")

if old_html in layout:
    layout = layout.replace(old_html, new_html)
    print("✅ layout: Inter variable aplicado al html")

layout_path.write_text(layout, encoding='utf-8')

# ══════════════════════════════════════════════
# 3) Definir constantes tipográficas globales
#    HAND = Caveat (solo títulos/labels/badges)
#    BODY = Inter (todo el texto de contenido)
# ══════════════════════════════════════════════

# Regla: qué usos de HAND deben cambiarse a BODY
# Si el contexto sugiere texto corrido → BODY
# Si es título, label, badge, número grande → HAND

def patch_file(filepath: Path):
    text = filepath.read_text(encoding='utf-8')
    original = text
    
    # Asegurar que BODY esté definido si HAND lo está
    if "const HAND" in text and "const BODY" not in text:
        text = text.replace(
            "const HAND = \"'Caveat', cursive\";",
            "const HAND = \"'Caveat', cursive\";\nconst BODY = \"'Inter', system-ui, sans-serif\";"
        )
        text = text.replace(
            "const HAND = \"'Caveat',cursive\";",
            "const HAND = \"'Caveat',cursive\";\nconst BODY = \"'Inter', system-ui, sans-serif\";"
        )
        text = text.replace(
            "const HAND = \"'Caveat', cursive\"\n",
            "const HAND = \"'Caveat', cursive\";\nconst BODY = \"'Inter', system-ui, sans-serif\";\n"
        )
    
    # Patrones de texto corrido que deben usar BODY
    # Busca fontFamily: HAND en contextos de párrafo/descripción/contenido
    
    # 1. fontSize <= 14 y NO fontWeight >= 800 → probablemente texto normal
    # Hacemos reemplazos específicos por contexto:
    
    # Explicaciones / descripciones largas
    text = re.sub(
        r"((?:explicacion|descripcion|content|texto|body|parrafo|desc|subtitle|subtitulo|mensaje|info|detail)[^}]{0,200}fontFamily:\s*)HAND",
        r"\1BODY",
        text, flags=re.IGNORECASE
    )
    
    # p tags y elementos de texto
    text = re.sub(
        r"(<p [^>]*style=\{[^}]*fontFamily:\s*['\"])HAND(['\"])",
        r"\1BODY\2",
        text
    )
    
    if text != original:
        filepath.write_text(text, encoding='utf-8')
        return True
    return False

# ══════════════════════════════════════════════
# 4) Patch específico por archivo clave
# ══════════════════════════════════════════════

# QuizPage.tsx - el más importante
quiz_path = Path("components/materias/QuizPage.tsx")
if quiz_path.exists():
    text = quiz_path.read_text(encoding='utf-8')
    
    # Asegurar BODY definido
    if "const BODY" not in text:
        text = text.replace(
            "const HAND = \"'Caveat', cursive\";",
            "const HAND = \"'Caveat', cursive\";\nconst BODY = \"'Inter', system-ui, sans-serif\";"
        )
    
    # Texto de pregunta → BODY
    text = text.replace(
        "fontFamily: BODY, fontSize: 17, fontWeight: 500,\n            color: 'rgba(255,255,255,0.9)', margin: 0, lineHeight: 1.7,",
        "fontFamily: BODY, fontSize: 16, fontWeight: 400,\n            color: 'rgba(255,255,255,0.9)', margin: 0, lineHeight: 1.75,"
    )
    
    # Opciones → BODY
    text = text.replace(
        "fontFamily: BODY, fontSize: 15, fontWeight: 500, color, lineHeight: 1.45, flex: 1",
        "fontFamily: BODY, fontSize: 14, fontWeight: 400, color, lineHeight: 1.5, flex: 1"
    )
    
    # Explicación → BODY
    text = text.replace(
        "fontFamily: BODY, fontSize: 14, lineHeight: 1.65, color: 'rgba(255,255,255,0.7)', margin: 0",
        "fontFamily: BODY, fontSize: 14, lineHeight: 1.7, color: 'rgba(255,255,255,0.75)', margin: 0"
    )
    
    # Detalle por pregunta → BODY
    text = text.replace(
        "fontFamily: BODY, fontSize: 14, color: 'rgba(255,255,255,0.75)', lineHeight: 1.4",
        "fontFamily: BODY, fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5"
    )
    
    # Sub-textos descriptivos pequeños → BODY
    # Estos usan HAND con fontSize 12-13 en contexto de descripción
    text = re.sub(
        r"(fontFamily: HAND, fontSize: 1[23], color: 'rgba\(255,255,255,0\.[34]\)', marginTop: [0-9]+)",
        lambda m: m.group(0).replace("fontFamily: HAND", "fontFamily: BODY"),
        text
    )
    
    # "Guardado por 24h..." → BODY
    text = re.sub(
        r"(Guardado automáticamente[^'\"]*fontFamily: )HAND",
        r"\1BODY",
        text
    )
    
    quiz_path.write_text(text, encoding='utf-8')
    print("✅ QuizPage.tsx tipografía mejorada")

# FlashcardsPage.tsx
flash_path = Path("components/materias/FlashcardsPage.tsx")
if flash_path.exists():
    text = flash_path.read_text(encoding='utf-8')
    if "const BODY" not in text:
        text = text.replace(
            "const HAND = \"'Caveat', cursive\";",
            "const HAND = \"'Caveat', cursive\";\nconst BODY = \"'Inter', system-ui, sans-serif\";"
        )
    # Texto de flashcard (pregunta/respuesta) → BODY
    text = re.sub(
        r"(fontSize: [12][0-9], (?:fontWeight: [456789]00, )?color: [^,]+,\s*lineHeight: [^,]+,\s*fontFamily: )HAND",
        r"\1BODY",
        text
    )
    flash_path.write_text(text, encoding='utf-8')
    print("✅ FlashcardsPage.tsx tipografía mejorada")

# AnalisisTeorico / TeoricoWorkspace — texto de contenido
for fname in ["components/materias/AnalisisTeorico.tsx", "components/materias/TeoricoWorkspace.tsx"]:
    fp = Path(fname)
    if fp.exists():
        text = fp.read_text(encoding='utf-8')
        if "const BODY" not in text and "const HAND" in text:
            text = text.replace(
                "const HAND = \"'Caveat', cursive\";",
                "const HAND = \"'Caveat', cursive\";\nconst BODY = \"'Inter', system-ui, sans-serif\";"
            )
        fp.write_text(text, encoding='utf-8')
        print(f"✅ {fname} BODY añadido")

# ══════════════════════════════════════════════
# 5) globals.css — body font-family Inter
# ══════════════════════════════════════════════
css = css_path.read_text(encoding='utf-8')

body_rule = """
body {
  font-family: var(--font-inter, 'Inter', system-ui, -apple-system, sans-serif);
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-caveat, 'Caveat', cursive);
  font-weight: 700;
}

/* Inputs y botones heredan Inter */
input, textarea, select {
  font-family: var(--font-inter, 'Inter', system-ui, sans-serif);
}
"""

if 'font-family: var(--font-inter' not in css:
    css = css + body_rule
    css_path.write_text(css, encoding='utf-8')
    print("✅ globals.css: body Inter aplicado globalmente")

print("\n🎉 Tipografía actualizada:")
print("  · Inter para todo el texto de contenido")
print("  · Caveat solo para títulos, labels, badges")
print("  · globals.css con reglas base")
print("  · layout.tsx con Inter de next/font")
