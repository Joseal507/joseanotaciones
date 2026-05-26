import pathlib

path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')
text = path.read_text(encoding='utf-8')

# Reemplazar changePage con versión con logs detallados
old_change = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      onSelectionMenu?.(null);
      setCurrentPage(newPage);

      // Bloquear observer mientras hacemos scroll programático
      programmaticScrollRef.current = true;

      const pageEl = pageRefs.current[newPage];
      const scrollEl = scrollRef.current;
      if (pageEl && scrollEl) {
        // Calcular posición exacta usando offsetTop relativo al scrollEl
        // Recorremos el árbol acumulando offsetTop hasta llegar al scrollEl
        let target = 0;
        let node: HTMLElement | null = pageEl;
        while (node && node !== scrollEl) {
          target += node.offsetTop;
          node = node.offsetParent as HTMLElement | null;
          if (node === scrollEl) break;
        }
        scrollEl.scrollTo({
          top: target,
          behavior: 'smooth',
        });
      }

      setTimeout(() => {
        programmaticScrollRef.current = false;
      }, 1000);
    },
    [pages, onSelectionMenu]
  );"""

new_change = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      onSelectionMenu?.(null);
      setCurrentPage(newPage);

      programmaticScrollRef.current = true;

      const pageEl = pageRefs.current[newPage];
      const scrollEl = scrollRef.current;
      if (pageEl && scrollEl) {
        // Medir todo
        const pageRect = pageEl.getBoundingClientRect();
        const scrollRect = scrollEl.getBoundingClientRect();
        const currentScrollTop = scrollEl.scrollTop;
        const diff = pageRect.top - scrollRect.top;
        const targetByDiff = currentScrollTop + diff;

        // offsetTop directo
        const offsetTopDirect = pageEl.offsetTop;

        console.log('📏 SCROLL DEBUG', {
          newPage,
          'pageRect.top': pageRect.top,
          'scrollRect.top': scrollRect.top,
          'diff (pageTop - scrollTop)': diff,
          'currentScrollTop': currentScrollTop,
          'targetByDiff': targetByDiff,
          'offsetTopDirect': offsetTopDirect,
          'pageEl.offsetParent': pageEl.offsetParent?.tagName,
          'scrollEl height': scrollRect.height,
          'pageEl height': pageRect.height,
        });

        // Usar diff puro - es la posición exacta
        scrollEl.scrollTo({
          top: Math.max(0, targetByDiff),
          behavior: 'smooth',
        });
      }

      setTimeout(() => {
        programmaticScrollRef.current = false;
      }, 1000);
    },
    [pages, onSelectionMenu]
  );"""

if old_change in text:
    text = text.replace(old_change, new_change, 1)
    path.write_text(text, encoding='utf-8')
    print("✅ Debug logs añadidos a changePage")
else:
    print("❌ No matcheó")
