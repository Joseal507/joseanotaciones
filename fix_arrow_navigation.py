import pathlib

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

# Eliminar el useEffect roto (con handleNext/handlePrev inexistentes)
old_broken = """  // ── Navegación con flechas (solo después de responder) ──
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
  }, [revealed, currentId]);

"""

if old_broken in text:
    text = text.replace(old_broken, "", 1)
    print("✅ useEffect roto eliminado")
else:
    print("⚠️ No encontré useEffect roto (puede que ya esté limpio)")

# Insertar el useEffect bueno DESPUÉS de goBack y continueNextWithHistory
# Buscar el final de handleDontKnowWithHistory para añadirlo ahí
old_anchor = """  const handleDontKnowWithHistory = () => {
    setHistory(h => [...h, currentId]);
    handleDontKnow();
  };"""

new_anchor = """  const handleDontKnowWithHistory = () => {
    setHistory(h => [...h, currentId]);
    handleDontKnow();
  };

  // ── Navegación con flechas (solo después de responder) ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Solo navegar si ya respondió (revealed o evaluation existe)
      if (!revealed) return;
      // Ignorar si está escribiendo en input/textarea
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        continueNextWithHistory();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (canGoBack) goBack();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [revealed, currentId, canGoBack]);"""

if old_anchor in text:
    text = text.replace(old_anchor, new_anchor, 1)
    print("✅ useEffect de flechas reinsertado en posición correcta")
else:
    print("❌ No encontré handleDontKnowWithHistory")

path.write_text(text, encoding='utf-8')
