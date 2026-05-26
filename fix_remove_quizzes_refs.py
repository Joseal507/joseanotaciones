from pathlib import Path
import re

# ══════════════════════════════════════════════
# 1) NavLoader.tsx — quitar entrada /quizzes
# ══════════════════════════════════════════════
nav_loader = Path("components/NavLoader.tsx")
if nav_loader.exists():
    txt = nav_loader.read_text(encoding='utf-8')
    txt = re.sub(r"\s*'/quizzes':\s*'[^']*',?\n?", '\n', txt)
    nav_loader.write_text(txt, encoding='utf-8')
    print("✅ NavLoader.tsx: /quizzes eliminado")

# ══════════════════════════════════════════════
# 2) NavbarMobile.tsx — quitar link a /quizzes
# ══════════════════════════════════════════════
navbar_mobile = Path("components/NavbarMobile.tsx")
if navbar_mobile.exists():
    txt = navbar_mobile.read_text(encoding='utf-8')
    txt = re.sub(r"\s*\{[^}]*'quizzes'[^}]*href:\s*'/quizzes'[^}]*\},?\n?", '\n', txt)
    navbar_mobile.write_text(txt, encoding='utf-8')
    print("✅ NavbarMobile.tsx: /quizzes eliminado")

# ══════════════════════════════════════════════
# 3) Buscador.tsx — quitar referencias a /quizzes
# ══════════════════════════════════════════════
buscador = Path("components/Buscador.tsx")
if buscador.exists():
    txt = buscador.read_text(encoding='utf-8')
    # Quitar la entrada de página de quizzes del array de páginas
    txt = re.sub(
        r"\s*\{\s*titulo:\s*tr\('quizzes'\)[^}]*href:\s*'/quizzes'[^}]*\},?\n?",
        '\n',
        txt
    )
    # Cambiar hrefs de /quizzes a /materias en los resultados de búsqueda
    txt = txt.replace("href: '/quizzes'", "href: '/materias'")
    buscador.write_text(txt, encoding='utf-8')
    print("✅ Buscador.tsx: /quizzes → /materias")

# ══════════════════════════════════════════════
# 4) app/page.tsx — quitar /quizzes del array de rutas
# ══════════════════════════════════════════════
app_page = Path("app/page.tsx")
if app_page.exists():
    txt = app_page.read_text(encoding='utf-8')
    txt = txt.replace("'/quizzes', ", "")
    txt = txt.replace(", '/quizzes'", "")
    txt = txt.replace("'/quizzes'", "")
    app_page.write_text(txt, encoding='utf-8')
    print("✅ app/page.tsx: /quizzes eliminado del array de rutas")

# ══════════════════════════════════════════════
# 5) flashcards/QuizModal.tsx — limpiar refs a /quizzes
# ══════════════════════════════════════════════
quiz_modal = Path("components/flashcards/QuizModal.tsx")
if quiz_modal.exists():
    txt = quiz_modal.read_text(encoding='utf-8')
    # Quitar el mensaje de "Ve a /quizzes"
    txt = re.sub(
        r'<p[^>]*>⏳ Guardado por 24h\. Ve a[^<]*</p>',
        '',
        txt
    )
    # Quitar botón "Mis quizzes" que va a /quizzes
    txt = re.sub(
        r"<button onClick=\{[^}]*router\.push\('/quizzes'\)[^}]*\}[^>]*>.*?</button>",
        '',
        txt,
        flags=re.DOTALL
    )
    quiz_modal.write_text(txt, encoding='utf-8')
    print("✅ QuizModal.tsx: refs a /quizzes eliminadas")

# ══════════════════════════════════════════════
# 6) TabQuiz.tsx — limpiar botón "Mis Quizzes" que va a /quizzes
# ══════════════════════════════════════════════
tab_quiz = Path("components/materias/TabQuiz.tsx")
if tab_quiz.exists():
    txt = tab_quiz.read_text(encoding='utf-8')
    # Quitar botón que navega a /quizzes
    txt = re.sub(
        r"<button onClick=\{\(\) => \(\(window as any\)\.__showNavLoader\?\.\('/quizzes'\).*?router\.push\('/quizzes'\)\)[^}]*\}.*?</button>",
        '',
        txt,
        flags=re.DOTALL
    )
    tab_quiz.write_text(txt, encoding='utf-8')
    print("✅ TabQuiz.tsx: botón /quizzes eliminado")

print("\n🎉 Limpieza completa de referencias a /quizzes")
