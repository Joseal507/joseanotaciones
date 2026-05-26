import pathlib

path = pathlib.Path('components/materias/FlashcardsPDFViewer.tsx')
text = path.read_text(encoding='utf-8')

# Quitar el wheel handler que cambia páginas (lo añadimos antes)
old_wheel = """  // ── Scroll para cambiar página ──
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

if old_wheel in text:
    text = text.replace(old_wheel, '', 1)
    print("✅ Wheel handler de cambio brusco removido")

# Reemplazar el render del PDF: en vez de mostrar 1 sola página,
# mostrar todas las páginas seleccionadas en lista vertical
# con scroll natural + detección de página visible para sincronizar el header

old_render = """        <Document
          file={url}
          onLoadSuccess={handleLoad}
          loading={
            <div style={{ color: '#777', fontSize: 14, paddingTop: 30 }}>
              Cargando documento...
            </div>
          }
          error={
            <div style={{ color: '#f87171', fontSize: 14, paddingTop: 30 }}>
              No se pudo abrir el PDF.
            </div>
          }
          noData={
            <div style={{ color: '#777', fontSize: 14, paddingTop: 30 }}>
              No hay PDF disponible.
            </div>
          }
        >
          <div
            style={{
              opacity: transitioning ? 0.7 : 1,
              transform: transitioning ? 'scale(0.995)' : 'scale(1)',
              transition: 'all 0.18s ease',
              background: '#fff',
              borderRadius: 14,
              boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
              overflow: 'hidden',
            }}
          >
            <Page
              pageNumber={currentPage}
              renderAnnotationLayer
              renderTextLayer
              width={Math.min(760, typeof window !== 'undefined' ? window.innerWidth * 0.42 : 760)}
            />
          </div>
        </Document>

        <div style={{ fontSize: 13, color: '#666', textAlign: 'center' }}>
          {canNext
            ? '~ scroll abajo o → para la siguiente página ~'
            : normalizedSelectedPages.length > 0
              ? '~ fin de la selección ~'
              : '~ fin del documento ~'}
        </div>"""

new_render = """        <Document
          file={url}
          onLoadSuccess={handleLoad}
          loading={
            <div style={{ color: '#777', fontSize: 14, paddingTop: 30 }}>
              Cargando documento...
            </div>
          }
          error={
            <div style={{ color: '#f87171', fontSize: 14, paddingTop: 30 }}>
              No se pudo abrir el PDF.
            </div>
          }
          noData={
            <div style={{ color: '#777', fontSize: 14, paddingTop: 30 }}>
              No hay PDF disponible.
            </div>
          }
        >
          {/* Renderizar TODAS las páginas seleccionadas en lista vertical */}
          {pages.map((pageNum) => (
            <div
              key={`page-${pageNum}`}
              data-page-num={pageNum}
              ref={(el) => {
                if (el) pageRefs.current[pageNum] = el;
              }}
              style={{
                background: '#fff',
                borderRadius: 14,
                boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
                overflow: 'hidden',
                marginBottom: 4,
                position: 'relative',
              }}
            >
              {/* Etiqueta de página flotante */}
              <div style={{
                position: 'absolute',
                top: 10,
                left: 10,
                background: pageNum === currentPage ? `${themeColor}ee` : 'rgba(0,0,0,0.55)',
                color: '#fff',
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                zIndex: 5,
                fontFamily: 'Inter, sans-serif',
                letterSpacing: 0.3,
                boxShadow: pageNum === currentPage ? `0 0 12px ${themeColor}88` : '0 2px 6px rgba(0,0,0,0.3)',
                transition: 'all 0.2s ease',
              }}>
                pág {pageNum}
              </div>
              <Page
                pageNumber={pageNum}
                renderAnnotationLayer
                renderTextLayer
                width={Math.min(760, typeof window !== 'undefined' ? window.innerWidth * 0.42 : 760)}
              />
            </div>
          ))}
        </Document>

        <div style={{ fontSize: 13, color: '#666', textAlign: 'center', padding: '8px 0' }}>
          ~ fin de {normalizedSelectedPages.length > 0 ? 'la selección' : 'el documento'} ~
        </div>"""

if old_render in text:
    text = text.replace(old_render, new_render, 1)
    print("✅ PDF ahora renderiza todas las páginas en lista vertical (scroll continuo)")
else:
    print("❌ No encontré el render del PDF")

# Añadir el ref para las páginas y observer para detectar página visible
old_state = """  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);"""

new_state = """  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement>>({});"""

if old_state in text:
    text = text.replace(old_state, new_state, 1)
    print("✅ pageRefs añadido")

# Añadir IntersectionObserver para detectar página visible y actualizar header
# También cambiar el comportamiento de changePage para hacer scroll en vez de cambiar
old_change_page = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      setTransitioning(true);
      setCurrentPage(newPage);
      onSelectionMenu?.(null);

      if (scrollRef.current) {
        scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }

      setTimeout(() => setTransitioning(false), 180);
    },
    [pages, onSelectionMenu]
  );"""

new_change_page = """  const changePage = useCallback(
    (newPage: number) => {
      if (!pages.includes(newPage)) return;

      setCurrentPage(newPage);
      onSelectionMenu?.(null);

      // Scrollear a la página específica en la lista vertical
      const pageEl = pageRefs.current[newPage];
      if (pageEl && scrollRef.current) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [pages, onSelectionMenu]
  );

  // ── Detectar qué página está visible al scrollear ──
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || pages.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
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

if old_change_page in text:
    text = text.replace(old_change_page, new_change_page, 1)
    print("✅ changePage ahora hace scrollIntoView + IntersectionObserver para detectar página visible")
else:
    print("❌ No encontré changePage")

path.write_text(text, encoding='utf-8')
print("\n🎉 PDF Viewer ahora tiene scroll continuo:")
print("   - Todas las páginas seleccionadas visibles en lista vertical")
print("   - Scroll natural del navegador (smooth)")
print("   - Header se sincroniza con la página visible")
print("   - Botones ← Anterior / Siguiente → hacen scroll a la página")
print("   - Etiqueta 'pág N' flotante en cada página")
