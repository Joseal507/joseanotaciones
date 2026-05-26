import pathlib

path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')
text = path.read_text(encoding='utf-8')

# Añadir wheel handler para cambiar página con scroll
old_keyboard = """  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goPrev, goNext]);"""

new_keyboard = """  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goPrev, goNext]);

  // ── Scroll para cambiar página ──
  // Cuando el usuario llega al fondo del PDF → siguiente página
  // Cuando está al tope y scrollea arriba → página anterior
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let lastScrollTop = 0;
    let scrollCooldown = false;

    const handleWheel = (e: WheelEvent) => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 10;
      const atTop = scrollTop <= 10;

      // Cooldown para evitar cambios de página muy rápidos
      if (scrollCooldown) return;

      if (e.deltaY > 0 && atBottom && canNext) {
        // Scrolleando hacia abajo en el fondo → siguiente página
        e.preventDefault();
        scrollCooldown = true;
        goNext();
        setTimeout(() => {
          scrollCooldown = false;
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        }, 600);
      } else if (e.deltaY < 0 && atTop && canPrev) {
        // Scrolleando hacia arriba en el tope → página anterior
        e.preventDefault();
        scrollCooldown = true;
        goPrev();
        setTimeout(() => {
          scrollCooldown = false;
          // Al ir atrás, ir al fondo de la página anterior
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        }, 600);
      }

      lastScrollTop = scrollTop;
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [canNext, canPrev, goNext, goPrev]);"""

if old_keyboard in text:
    text = text.replace(old_keyboard, new_keyboard, 1)
    path.write_text(text, encoding='utf-8')
    print("✅ Scroll para cambiar página añadido")
    print("   - Scroll abajo en el fondo → siguiente página")
    print("   - Scroll arriba en el tope → página anterior")
    print("   - Cooldown de 600ms para evitar cambios accidentales")
else:
    print("❌ No encontré el bloque del keyboard handler")
