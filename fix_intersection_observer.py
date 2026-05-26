from pathlib import Path

path = Path("components/materias/FlashcardsPDFViewer.tsx")
text = path.read_text(encoding='utf-8')

# ── Reemplazar el bloque del IntersectionObserver ──
old_observer = """  // ── Detectar qué página está visible al scrollear ──
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || pages.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // No actualizar si estamos en scroll programático
        if (programmaticScrollRef.current) return;
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible) {
          const pageNum = parseInt((visible.target as HTMLElement).dataset.pageNum || '0', 10);
          if (pageNum > 0) {
            setCurrentPage(prev => prev === pageNum ? prev : pageNum);
          }
        }
      },
      {
        root: scrollEl,
        threshold: [0.3, 0.5, 0.7],
        rootMargin: '-20% 0px -20% 0px',
      }
    );

    // Observar cada página después de un tiempo (esperar a que renderen)
    const timer = setTimeout(() => {
      Object.values(pageRefs.current).forEach(el => {
        if (el) observer.observe(el);
      });
    }, 500);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [pages, numPages]);"""

new_observer = """  // ── Detectar qué página está visible al scrollear (scroll event, sin glitches) ──
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || pages.length === 0) return;

    let rafId: number;

    const onScroll = () => {
      if (programmaticScrollRef.current) return;

      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const scrollRect = scrollEl.getBoundingClientRect();
        const scrollCenter = scrollRect.top + scrollRect.height / 2;

        let bestPage = currentPage;
        let bestDist = Infinity;

        for (const [pageNumStr, el] of Object.entries(pageRefs.current)) {
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          const elCenter = rect.top + rect.height / 2;
          const dist = Math.abs(elCenter - scrollCenter);
          if (dist < bestDist) {
            bestDist = dist;
            bestPage = parseInt(pageNumStr, 10);
          }
        }

        if (bestPage > 0) {
          setCurrentPage(prev => prev === bestPage ? prev : bestPage);
        }
      });
    };

    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, numPages]);"""

if old_observer in text:
    text = text.replace(old_observer, new_observer, 1)
    print("✅ IntersectionObserver reemplazado por scroll event + rAF")
else:
    print("❌ No matcheó el bloque. Buscando fragmento parcial...")
    if "Detectar qué página está visible" in text:
        print("   El comentario existe")
    if "IntersectionObserver" in text:
        print("   IntersectionObserver existe")

path.write_text(text, encoding='utf-8')
print("🎉 Listo")
