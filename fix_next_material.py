import pathlib

path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')
text = path.read_text(encoding='utf-8')

# El problema actual: cuando estás en la última página del material 1,
# si haces scroll abajo no hace nada (porque ya no hay más páginas para mostrar)
# Solo funciona si tocas el botón "Siguiente"
#
# Y el goNext actual ya tiene la lógica correcta... el problema puede ser que
# pages.indexOf(currentPage) no coincide bien

# Verificar que goNext esté bien implementado
old_gonext = """  const goNext = useCallback(() => {
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

new_gonext = """  const goNext = useCallback(() => {
    const idx = pages.indexOf(currentPage);
    console.log('🔜 goNext:', { currentPage, idx, totalPages: pages.length, hasGlobal: hasGlobalSelection });
    // Si NO es la última página del material actual, avanzar dentro
    if (idx >= 0 && idx < pages.length - 1) {
      changePage(pages[idx + 1]);
      return;
    }
    // Si SÍ es la última página → pedir siguiente material/sesión
    if (onRequestNext) {
      console.log('➡️ Saltando al siguiente material');
      onRequestNext();
    }
  }, [pages, currentPage, onRequestNext, changePage]);"""

if old_gonext in text:
    text = text.replace(old_gonext, new_gonext, 1)
    print("✅ goNext con log debug + simplificado")

# También goPrev
old_goprev = """  const goPrev = useCallback(() => {
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

new_goprev = """  const goPrev = useCallback(() => {
    const idx = pages.indexOf(currentPage);
    if (idx > 0) {
      changePage(pages[idx - 1]);
      return;
    }
    if (onRequestPrev) {
      console.log('⬅️ Saltando al material anterior');
      onRequestPrev();
    }
  }, [pages, currentPage, onRequestPrev, changePage]);"""

if old_goprev in text:
    text = text.replace(old_goprev, new_goprev, 1)
    print("✅ goPrev simplificado")

# canPrev / canNext: deben estar disponibles si hay onRequestPrev/Next
# (osea siempre que haya múltiples materiales)
old_can = """  const canPrev = hasGlobalSelection ? globalIndex > 0 : currentIndex > 0;
  const canNext = hasGlobalSelection
    ? globalIndex >= 0 && globalIndex < (globalSelectedTotal || 0) - 1
    : currentIndex >= 0 && currentIndex < pages.length - 1;"""

new_can = """  // canPrev/canNext: habilitar si hay páginas en el mismo material O si hay otro material
  const idxLocal = pages.indexOf(currentPage);
  const canPrev = idxLocal > 0 || !!onRequestPrev;
  const canNext = (idxLocal >= 0 && idxLocal < pages.length - 1) || !!onRequestNext;"""

if old_can in text:
    text = text.replace(old_can, new_can, 1)
    print("✅ canPrev/canNext usan onRequestPrev/Next")
else:
    print("⚠️ canPrev/canNext no matchearon")

# Añadir scroll handler: cuando el usuario scrollea más allá del fondo,
# pedir siguiente material
old_pages_render = """          {/* Renderizar TODAS las páginas seleccionadas en lista vertical */}
          {pages.map((pageNum) => ("""

new_pages_render = """          {/* Renderizar TODAS las páginas seleccionadas en lista vertical */}
          {pages.map((pageNum) => ("""

# (no cambio aquí, dejarlo igual)

# Añadir un useEffect que detecta scroll al fondo y llama onRequestNext
old_observer_start_block = """  // ── Detectar qué página está visible al scrollear ──"""

new_observer_with_bottom = """  // ── Detectar scroll al final → siguiente material ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !onRequestNext) return;

    let cooldown = false;

    const checkBottom = () => {
      if (cooldown) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 5;
      if (atBottom) {
        // Verificar que también estamos en la última página
        const idx = pages.indexOf(currentPage);
        if (idx === pages.length - 1) {
          cooldown = true;
          console.log('📜 Scroll al fondo en última página → siguiente material');
          onRequestNext();
          setTimeout(() => { cooldown = false; }, 1500);
        }
      }
    };

    el.addEventListener('scroll', checkBottom);
    return () => el.removeEventListener('scroll', checkBottom);
  }, [onRequestNext, pages, currentPage]);

  // ── Detectar qué página está visible al scrollear ──"""

if old_observer_start_block in text:
    text = text.replace(old_observer_start_block, new_observer_with_bottom, 1)
    print("✅ Scroll al fondo dispara onRequestNext automáticamente")

path.write_text(text, encoding='utf-8')
print("\n🎉 Navegación entre materiales mejorada:")
print("   - Botón Siguiente usa onRequestNext si está en última página")
print("   - Scroll al fondo en última página → siguiente material automático")
print("   - canNext/canPrev funcionan con onRequest callbacks")
