import pathlib

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

# FIX: goToGlobalSelection usa useRef para tener siempre el cursor actual
# El problema es que el callback pasado al viewer captura globalSelectedCursor stale

# Paso 1: añadir ref que siempre tenga el cursor actualizado
old_cursor = """  const [globalSelectedCursor, setGlobalSelectedCursor] = useState(0);"""

new_cursor = """  const [globalSelectedCursor, setGlobalSelectedCursor] = useState(0);
  const globalSelectedCursorRef = useRef(0);
  useEffect(() => {
    globalSelectedCursorRef.current = globalSelectedCursor;
  }, [globalSelectedCursor]);"""

if old_cursor in text:
    text = text.replace(old_cursor, new_cursor, 1)
    print("✅ Añadido globalSelectedCursorRef")
else:
    print("❌ No matcheó useState cursor")

# Paso 2: goToGlobalSelection usa la ref en vez del valor capturado
old_goto = """  const goToGlobalSelection = useCallback((nextIndex: number) => {
    if (!selectionSequence.length) return;

    const safeIndex = Math.max(0, Math.min(selectionSequence.length - 1, nextIndex));
    const entry = selectionSequence[safeIndex];

    setGlobalSelectedCursor(safeIndex);

    if (entry && entry.materialIndex !== activeMaterialIndex) {
      setActiveMaterialIndex(entry.materialIndex);
    }
  }, [selectionSequence, activeMaterialIndex]);"""

new_goto = """  const goToGlobalSelection = useCallback((nextIndex: number) => {
    if (!selectionSequence.length) return;

    const safeIndex = Math.max(0, Math.min(selectionSequence.length - 1, nextIndex));
    const entry = selectionSequence[safeIndex];

    setGlobalSelectedCursor(safeIndex);
    globalSelectedCursorRef.current = safeIndex;

    if (entry && entry.materialIndex !== activeMaterialIndex) {
      setActiveMaterialIndex(entry.materialIndex);
    }
  }, [selectionSequence, activeMaterialIndex]);

  // Callbacks estables que leen siempre el cursor actual via ref
  const goToNext = useCallback(() => {
    goToGlobalSelection(globalSelectedCursorRef.current + 1);
  }, [goToGlobalSelection]);

  const goToPrev = useCallback(() => {
    goToGlobalSelection(globalSelectedCursorRef.current - 1);
  }, [goToGlobalSelection]);"""

if old_goto in text:
    text = text.replace(old_goto, new_goto, 1)
    print("✅ goToGlobalSelection actualiza ref + callbacks estables goToNext/goToPrev")
else:
    print("❌ No matcheó goToGlobalSelection")

# Paso 3: usar goToNext/goToPrev en los props del viewer
old_props = """                  onRequestPrev={selectionSequence.length > 0 ? () => goToGlobalSelection(globalSelectedCursor - 1) : undefined}
                  onRequestNext={selectionSequence.length > 0 ? () => goToGlobalSelection(globalSelectedCursor + 1) : undefined}"""

new_props = """                  onRequestPrev={selectionSequence.length > 0 ? goToPrev : undefined}
                  onRequestNext={selectionSequence.length > 0 ? goToNext : undefined}"""

if old_props in text:
    text = text.replace(old_props, new_props, 1)
    print("✅ Props del viewer usan goToNext/goToPrev (sin stale closure)")
else:
    print("❌ No matcheó props del viewer")

# Paso 4: asegurarse que useRef está importado
if "useRef" not in text[:500]:
    text = text.replace("import { useState,", "import { useState, useRef,", 1)
    print("✅ useRef añadido al import")

path.write_text(text, encoding='utf-8')
print("\n🎉 Bug stale closure corregido")
print("   globalSelectedCursorRef siempre tiene el valor actual")
print("   goToNext/goToPrev leen la ref, nunca el closure viejo")
