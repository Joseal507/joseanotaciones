import pathlib
import re

path = pathlib.Path('components/materias/TemaView.tsx')
text = path.read_text(encoding='utf-8')

# ─────────────────────────────────────────────────────────
# 1) Añadir import del helper
# ─────────────────────────────────────────────────────────
import_line = "import { upsertSession, cleanupSessions, getSessionsByTema, getMaterialSessions, type StudySession } from '../../lib/studySessions';\n"

# Buscar la zona de imports (después del último import)
import_matches = list(re.finditer(r"^import .+;$", text, re.MULTILINE))
if import_matches:
    last_import = import_matches[-1]
    insert_pos = last_import.end()
    text = text[:insert_pos] + "\n" + import_line + text[insert_pos:]
    print("✅ Import añadido")
else:
    print("❌ No encontré imports")

# ─────────────────────────────────────────────────────────
# 2) Añadir cleanup + estado de sesiones al inicio del componente
# ─────────────────────────────────────────────────────────
# Buscamos un punto seguro: justo después de "const [selectedIds, setSelectedIds]"
anchor_cleanup = """  const [selectedIds, setSelectedIds] = useState<string[]>([]);"""
add_cleanup = """  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // ── Sesiones de estudio activas en este tema ──
  const [activeSessions, setActiveSessions] = useState<StudySession[]>([]);

  const refreshSessions = useCallback(() => {
    if (!tema?.id) return;
    const existingIds = (tema.documentos || []).map((d: any) => d.id);
    cleanupSessions(tema.id, existingIds);
    setActiveSessions(getSessionsByTema(tema.id));
  }, [tema?.id, tema?.documentos]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);"""

if anchor_cleanup in text:
    text = text.replace(anchor_cleanup, add_cleanup, 1)
    print("✅ Estado de sesiones + cleanup añadidos")
else:
    print("❌ No encontré anchor de selectedIds")

# Asegurarnos que useCallback está importado
if "useCallback" not in text[:text.find("export default function")]:
    # Buscar el import de react
    react_import = re.search(r"import\s+(\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['\"]react['\"]", text)
    if react_import:
        old_import = react_import.group(0)
        if "useCallback" not in old_import:
            if "{" in old_import:
                new_import = old_import.replace("}", ", useCallback }").replace(", , useCallback", ", useCallback")
                text = text.replace(old_import, new_import, 1)
                print("✅ useCallback añadido al import de react")

# ─────────────────────────────────────────────────────────
# 3) Guardar sesión justo antes de onOpenFlashcards?.(...)
# ─────────────────────────────────────────────────────────
old_call = """              onOpenFlashcards?.(
                matsSeleccionados,
                normalizedSel.length ? normalizedSel : undefined
              );"""

new_call = """              // ── Guardar sesión de estudio para persistencia ──
              try {
                const pagesByMat: Record<string, number[]> = {};
                normalizedSel.forEach((n: any) => {
                  if (n?.materialId && Array.isArray(n.pages) && n.pages.length > 0) {
                    pagesByMat[n.materialId] = n.pages;
                  }
                });
                const matIds = matsSeleccionados
                  .map((m: any) => m?.materialId || m?.id)
                  .filter(Boolean) as string[];

                if (tema?.id && enfoqueElegido && matIds.length > 0) {
                  upsertSession({
                    temaId: tema.id,
                    enfoque: enfoqueElegido as any,
                    materialIds: matIds,
                    selectedPages: Object.keys(pagesByMat).length ? pagesByMat : undefined,
                  });
                  refreshSessions();
                  console.log('💾 Sesión guardada:', enfoqueElegido, matIds);
                }
              } catch (e) {
                console.warn('Error guardando sesión:', e);
              }

              onOpenFlashcards?.(
                matsSeleccionados,
                normalizedSel.length ? normalizedSel : undefined
              );"""

if old_call in text:
    text = text.replace(old_call, new_call, 1)
    print("✅ Guardado de sesión añadido al click de Flashcards")
else:
    print("❌ No encontré onOpenFlashcards?.(...)")

path.write_text(text, encoding='utf-8')
print("\n🎉 Paso 2 listo. Ahora cada vez que entres al enfoque teórico se guardará la sesión.")
