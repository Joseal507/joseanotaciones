import pathlib

path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')
text = path.read_text(encoding='utf-8')

# ════════════════════════════════════════════════════
# FIX 1: Detectar página por scroll SIN bloquear con flag programático
# (el flag estaba causando que perdiera sincronía después de scroll manual)
# ════════════════════════════════════════════════════
old_observer = """      (entries) => {
        // Si estamos en scroll programático, no actualizar
        if (programmaticScrollRef.current) return;
        // Encontrar la entry más visible
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible) {
          const pageNum = parseInt((visible.target as HTMLElement).dataset.pageNum || '0', 10);
          if (pageNum > 0 && pageNum !== currentPage) {
            setCurrentPage(pageNum);
          }
        }
      },"""

new_observer = """      (entries) => {
        // Siempre actualizar la página visible por scroll
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible) {
          const pageNum = parseInt((visible.target as HTMLElement).dataset.pageNum || '0', 10);
          if (pageNum > 0) {
            setCurrentPage(prev => prev === pageNum ? prev : pageNum);
          }
        }
      },"""

if old_observer in text:
    text = text.replace(old_observer, new_observer, 1)
    print("✅ FIX 1: Observer siempre detecta página visible")

# ════════════════════════════════════════════════════
# FIX 2: Eliminar useEffect duplicado de auto-scroll
# (causaba scroll automático no deseado)
# ════════════════════════════════════════════════════
old_auto_scroll = """  // ── Auto-scroll cuando currentPage cambia (por botón o por forced) ──
  useEffect(() => {
    if (!currentPage) return;
    const pageEl = pageRefs.current[currentPage];
    const scrollEl = scrollRef.current;
    if (pageEl && scrollEl) {
      // Pequeño delay para asegurar que la página está renderizada
      const t = setTimeout(() => {
        const offsetTop = pageEl.offsetTop - 24;
        scrollEl.scrollTo({
          top: offsetTop,
          behavior: 'smooth',
        });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [currentPage]);

  // ── Detectar qué página está visible al scrollear ──"""

new_auto_scroll = """  // ── Detectar qué página está visible al scrollear ──"""

if old_auto_scroll in text:
    text = text.replace(old_auto_scroll, new_auto_scroll, 1)
    print("✅ FIX 2: useEffect duplicado eliminado")

# ════════════════════════════════════════════════════
# FIX 3: Quitar flag programático del changePage y mejorar scroll
# Eliminar offset que dejaba ver pedazo de la anterior
# ════════════════════════════════════════════════════
old_change = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      onSelectionMenu?.(null);
      setCurrentPage(newPage);

      // Scroll suave a la página con pequeño offset
      // El useEffect de currentPage también hará scroll de backup
      const pageEl = pageRefs.current[newPage];
      const scrollEl = scrollRef.current;
      if (pageEl && scrollEl) {
        programmaticScrollRef.current = true;
        const offsetTop = pageEl.offsetTop - 24;
        scrollEl.scrollTo({
          top: offsetTop,
          behavior: 'smooth',
        });
        // Liberar el flag después de que termine el scroll
        setTimeout(() => {
          programmaticScrollRef.current = false;
        }, 800);
      }
    },
    [pages, onSelectionMenu]
  );"""

new_change = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      onSelectionMenu?.(null);
      setCurrentPage(newPage);

      // Scroll exacto al inicio de la página (sin offset)
      const pageEl = pageRefs.current[newPage];
      const scrollEl = scrollRef.current;
      if (pageEl && scrollEl) {
        scrollEl.scrollTo({
          top: pageEl.offsetTop,
          behavior: 'smooth',
        });
      }
    },
    [pages, onSelectionMenu]
  );"""

if old_change in text:
    text = text.replace(old_change, new_change, 1)
    print("✅ FIX 3: Scroll exacto al inicio de página (sin offset)")

# Remover el ref programmaticScrollRef que ya no se usa
old_ref = """  // Flag para deshabilitar observer durante scroll programático
  const programmaticScrollRef = useRef(false);

"""
if old_ref in text:
    text = text.replace(old_ref, '', 1)
    print("✅ Ref programático removido")

# ════════════════════════════════════════════════════
# FIX 4: goNext / goPrev usan la PÁGINA VISIBLE actual
# no la currentPage del state (que puede estar desactualizada)
# Y si llegamos al final del material → llamar onRequestNext
# ════════════════════════════════════════════════════
old_gonext = """  const goNext = useCallback(() => {
    if (hasGlobalSelection && onRequestNext) {
      onRequestNext();
      return;
    }
    if (currentIndex >= 0 && currentIndex < pages.length - 1) {
      changePage(pages[currentIndex + 1]);
    }
  }, [hasGlobalSelection, onRequestNext, currentIndex, pages, changePage]);"""

new_gonext = """  const goNext = useCallback(() => {
    // Usar currentPage para calcular el siguiente
    const idx = pages.indexOf(currentPage);
    // Si NO es la última página del material actual, avanzar dentro
    if (idx >= 0 && idx < pages.length - 1) {
      changePage(pages[idx + 1]);
      return;
    }
    // Si SÍ es la última página → pedir siguiente material/sesión
    if (hasGlobalSelection && onRequestNext) {
      onRequestNext();
    }
  }, [pages, currentPage, hasGlobalSelection, onRequestNext, changePage]);"""

if old_gonext in text:
    text = text.replace(old_gonext, new_gonext, 1)
    print("✅ FIX 4a: goNext usa currentPage real, salta al siguiente material al final")

old_goprev = """  const goPrev = useCallback(() => {
    if (hasGlobalSelection && onRequestPrev) {
      onRequestPrev();
      return;
    }
    if (currentIndex > 0) changePage(pages[currentIndex - 1]);
  }, [hasGlobalSelection, onRequestPrev, currentIndex, pages, changePage]);"""

new_goprev = """  const goPrev = useCallback(() => {
    const idx = pages.indexOf(currentPage);
    // Si NO es la primera página del material actual, retroceder dentro
    if (idx > 0) {
      changePage(pages[idx - 1]);
      return;
    }
    // Si SÍ es la primera página → pedir material anterior
    if (hasGlobalSelection && onRequestPrev) {
      onRequestPrev();
    }
  }, [pages, currentPage, hasGlobalSelection, onRequestPrev, changePage]);"""

if old_goprev in text:
    text = text.replace(old_goprev, new_goprev, 1)
    print("✅ FIX 4b: goPrev igual lógica que goNext")

path.write_text(text, encoding='utf-8')
print("\n🎉 Scroll y navegación corregidos:")
print("   1. Página visible se detecta correctamente al scrollear")
print("   2. Botón Siguiente lleva al INICIO exacto de la próxima página")
print("   3. Al llegar al final del material → siguiente material automático")
print("   4. Misma lógica para Anterior")
