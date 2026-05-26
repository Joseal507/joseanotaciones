import pathlib

path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')
text = path.read_text(encoding='utf-8')

# El problema: goNext puede llamar onRequestNext (cambio de material)
# o changePage (cambio dentro del mismo material)
# Si llama changePage pero el pageRef no está, no hace nada
# Y si llama onRequestNext, sí cambia pero no hace scroll

# FIX: cuando cambia currentPage por cualquier razón, hacer scroll auto
# Añadir un useEffect que reacciona a cambios de currentPage

old_after_change = """  // ── Detectar qué página está visible al scrollear ──"""

new_before_observer = """  // ── Auto-scroll cuando currentPage cambia (por botón o por forced) ──
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

if old_after_change in text:
    text = text.replace(old_after_change, new_before_observer, 1)
    path.write_text(text, encoding='utf-8')
    print("✅ useEffect de auto-scroll en cambio de currentPage añadido")
else:
    print("❌ No encontré el anchor")

# También verificar que goNext llama bien a changePage
# El IntersectionObserver puede estar peleando con el scroll manual
# Necesitamos que el observer NO se active durante el scroll programático

old_observer_start = """  // ── Detectar qué página está visible al scrollear ──
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || pages.length === 0) return;

    const observer = new IntersectionObserver("""

new_observer_start = """  // Flag para deshabilitar observer durante scroll programático
  const programmaticScrollRef = useRef(false);

  // ── Detectar qué página está visible al scrollear ──
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || pages.length === 0) return;

    const observer = new IntersectionObserver("""

text2 = path.read_text(encoding='utf-8')
if old_observer_start in text2:
    text2 = text2.replace(old_observer_start, new_observer_start, 1)
    
    # Modificar el observer callback para respetar el flag
    old_cb = """      (entries) => {
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
    
    new_cb = """      (entries) => {
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
    
    if old_cb in text2:
        text2 = text2.replace(old_cb, new_cb, 1)
        print("✅ Observer respeta scroll programático")
    
    path.write_text(text2, encoding='utf-8')
    print("✅ Flag programmaticScrollRef añadido")

# Modificar changePage para activar el flag durante el scroll
text3 = path.read_text(encoding='utf-8')
old_change = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      setCurrentPage(newPage);
      onSelectionMenu?.(null);

      // Scroll suave a la página con pequeño offset arriba
      // para que se vea un pedacito de la página anterior (sensación de continuidad)
      const pageEl = pageRefs.current[newPage];
      const scrollEl = scrollRef.current;
      if (pageEl && scrollEl) {
        const offsetTop = pageEl.offsetTop - 24; // 24px de margen arriba
        scrollEl.scrollTo({
          top: offsetTop,
          behavior: 'smooth',
        });
      }
    },
    [pages, onSelectionMenu]
  );"""

new_change = """  const changePage = useCallback(
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

if old_change in text3:
    text3 = text3.replace(old_change, new_change, 1)
    path.write_text(text3, encoding='utf-8')
    print("✅ changePage usa flag programático")

print("\n🎉 Scroll al cambiar página corregido:")
print("   - useEffect auto-scroll en cualquier cambio de currentPage")
print("   - Flag para que el IntersectionObserver no pelee")
