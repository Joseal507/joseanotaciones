import pathlib

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

# Añadir useEffect de navegación con flechas en StudyRepite
# Buscar useEffect que enfoca el textarea para insertar el listener después
old = """  useEffect(() => {
    if (!readOnly) textareaRef.current?.focus();
  }, [currentId, readOnly]);"""

new = """  useEffect(() => {
    if (!readOnly) textareaRef.current?.focus();
  }, [currentId, readOnly]);

  // ── Navegación con flechas (solo después de responder) ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Solo navegar si ya respondió (revealed)
      if (!revealed) return;
      // Ignorar si está escribiendo en input/textarea
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        // Ir a la card anterior si existe
        if (typeof handlePrev === 'function') handlePrev();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleNext();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [revealed, currentId]);"""

if old in text:
    text = text.replace(old, new, 1)
    print("✅ Navegación con flechas añadida a StudyRepite")
else:
    print("❌ No encontré useEffect de focus")

path.write_text(text, encoding='utf-8')
