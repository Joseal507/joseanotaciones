import pathlib
import re

# ════════════════════════════════════════════════════
# PASO 1: TemaView pasa sessionId a onOpenFlashcards
# ════════════════════════════════════════════════════
path1 = pathlib.Path('components/materias/TemaView.tsx')
text1 = path1.read_text(encoding='utf-8')

old_call = """              // ── Guardar sesión de estudio para persistencia ──
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

new_call = """              // ── Guardar sesión de estudio para persistencia ──
              let savedSessionId: string | null = null;
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
                  const sess = upsertSession({
                    temaId: tema.id,
                    enfoque: enfoqueElegido as any,
                    materialIds: matIds,
                    selectedPages: Object.keys(pagesByMat).length ? pagesByMat : undefined,
                  });
                  savedSessionId = sess.id;
                  refreshSessions();
                  console.log('💾 Sesión guardada:', enfoqueElegido, matIds, '→', sess.id);
                }
              } catch (e) {
                console.warn('Error guardando sesión:', e);
              }

              onOpenFlashcards?.(
                matsSeleccionados,
                normalizedSel.length ? normalizedSel : undefined,
                savedSessionId
              );"""

if old_call in text1:
    text1 = text1.replace(old_call, new_call, 1)
    print("✅ [TemaView] sessionId pasado en onOpenFlashcards")
else:
    print("❌ [TemaView] No encontré el call de onOpenFlashcards")

# También aplicarlo cuando "seguir estudiando" (botón modo resume)
old_resume = """        if (isResumeMode && matchingSession) {
          // ── Saltar directo al enfoque guardado con sus páginas ──
          setEnfoqueElegido(matchingSession.enfoque as any);
          if (matchingSession.selectedPages) {
            const rebuilt = matchingSession.materialIds.map((matId: string, idx: number) => ({
              materialId: matId,
              materialIndex: idx,
              pages: matchingSession.selectedPages![matId] || [],
            }));
            setSeleccionResult(rebuilt as any);
          }
          setOpenTeorico(true);
          console.log('🔁 Continuando sesión:', matchingSession.id);
        } else {
          setShowEnfoque(true);
        }"""

new_resume = """        if (isResumeMode && matchingSession) {
          // ── Saltar directo al enfoque guardado con sus páginas ──
          setEnfoqueElegido(matchingSession.enfoque as any);
          if (matchingSession.selectedPages) {
            const rebuilt = matchingSession.materialIds.map((matId: string, idx: number) => ({
              materialId: matId,
              materialIndex: idx,
              pages: matchingSession.selectedPages![matId] || [],
            }));
            setSeleccionResult(rebuilt as any);
          }
          // Guardar sessionId para que FlashcardsPage pueda cargar el cache
          setResumeSessionId(matchingSession.id);
          setOpenTeorico(true);
          console.log('🔁 Continuando sesión:', matchingSession.id);
        } else {
          setResumeSessionId(null);
          setShowEnfoque(true);
        }"""

if old_resume in text1:
    text1 = text1.replace(old_resume, new_resume, 1)
    print("✅ [TemaView] resumeSessionId guardado en modo resume")
else:
    print("⚠️ [TemaView] No encontré modo resume")

# Añadir estado resumeSessionId
old_state = """  // ── Sesiones de estudio activas en este tema ──
  const [activeSessions, setActiveSessions] = useState<StudySession[]>([]);"""

new_state = """  // ── Sesiones de estudio activas en este tema ──
  const [activeSessions, setActiveSessions] = useState<StudySession[]>([]);
  // ── ID de sesión a reanudar (cuando se hace "seguir estudiando") ──
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);"""

if old_state in text1:
    text1 = text1.replace(old_state, new_state, 1)
    print("✅ [TemaView] Estado resumeSessionId añadido")

# Pasar resumeSessionId también desde onOpenFlashcards cuando viene de resume
# El handler general ya pasa savedSessionId, pero cuando es resume no entra ahí.
# Necesitamos que onOpenFlashcards del TeoricoWorkspace use resumeSessionId si existe
old_pass = """              onOpenFlashcards?.(
                matsSeleccionados,
                normalizedSel.length ? normalizedSel : undefined,
                savedSessionId
              );"""

new_pass = """              onOpenFlashcards?.(
                matsSeleccionados,
                normalizedSel.length ? normalizedSel : undefined,
                resumeSessionId || savedSessionId
              );"""

if old_pass in text1:
    text1 = text1.replace(old_pass, new_pass, 1)
    print("✅ [TemaView] Prioriza resumeSessionId sobre savedSessionId")

path1.write_text(text1, encoding='utf-8')

# ════════════════════════════════════════════════════
# PASO 2: page.tsx propaga sessionId a FlashcardsPage
# ════════════════════════════════════════════════════
path2 = pathlib.Path('app/materias/page.tsx')
text2 = path2.read_text(encoding='utf-8')

# Añadir estado flashcardsSessionId
old_state_page = """  const [flashcardsMateriales, setFlashcardsMateriales] = useState<any[]>([]);
  const [flashcardsSeleccion, setFlashcardsSeleccion] = useState<any[] | null>(null);"""

new_state_page = """  const [flashcardsMateriales, setFlashcardsMateriales] = useState<any[]>([]);
  const [flashcardsSeleccion, setFlashcardsSeleccion] = useState<any[] | null>(null);
  const [flashcardsSessionId, setFlashcardsSessionId] = useState<string | null>(null);"""

if old_state_page in text2:
    text2 = text2.replace(old_state_page, new_state_page, 1)
    print("✅ [page.tsx] Estado flashcardsSessionId añadido")
else:
    print("❌ [page.tsx] No encontré estados de flashcards")

# Modificar el handler onOpenFlashcards para recibir sessionId
m = re.search(r"onOpenFlashcards=\{\(mats\?:\s*any\[\],\s*sel\?:\s*any\[\]\)\s*=>\s*\{", text2)
if m:
    old_sig = m.group(0)
    new_sig = "onOpenFlashcards={(mats?: any[], sel?: any[], sessionId?: string | null) => {"
    text2 = text2.replace(old_sig, new_sig, 1)
    print("✅ [page.tsx] Firma de onOpenFlashcards actualizada con sessionId")

# Añadir setFlashcardsSessionId después de setFlashcardsSeleccion
old_set = """              setFlashcardsMateriales(matsToUse);
              setFlashcardsSeleccion(normalizedSel);"""

new_set = """              setFlashcardsMateriales(matsToUse);
              setFlashcardsSeleccion(normalizedSel);
              setFlashcardsSessionId(sessionId || null);"""

if old_set in text2:
    text2 = text2.replace(old_set, new_set, 1)
    print("✅ [page.tsx] setFlashcardsSessionId añadido al handler")

# Pasar sessionId a FlashcardsPage
old_render = """          <FlashcardsPage
            materiales={flashcardsMateriales.length > 0 ? flashcardsMateriales : temaActual.documentos}
            seleccion={flashcardsSeleccion}
            tema={temaActual}
            materia={materiaActual}
            onBack={() => setVista('tema')}
          />"""

new_render = """          <FlashcardsPage
            materiales={flashcardsMateriales.length > 0 ? flashcardsMateriales : temaActual.documentos}
            seleccion={flashcardsSeleccion}
            tema={temaActual}
            materia={materiaActual}
            sessionId={flashcardsSessionId}
            onBack={() => setVista('tema')}
          />"""

if old_render in text2:
    text2 = text2.replace(old_render, new_render, 1)
    print("✅ [page.tsx] sessionId pasado a FlashcardsPage")

path2.write_text(text2, encoding='utf-8')

# ════════════════════════════════════════════════════
# PASO 3: FlashcardsPage usa sessionId para cache
# ════════════════════════════════════════════════════
path3 = pathlib.Path('components/materias/FlashcardsPage.tsx')
text3 = path3.read_text(encoding='utf-8')

# Añadir import del helper
if "from '../../lib/studySessions'" not in text3:
    # Buscar último import y añadir después
    imports = list(re.finditer(r"^import .+;$", text3, re.MULTILINE))
    if imports:
        last = imports[-1]
        import_line = "\nimport { upsertSession, getSessionsByTema } from '../../lib/studySessions';"
        text3 = text3[:last.end()] + import_line + text3[last.end():]
        print("✅ [FlashcardsPage] Import de studySessions añadido")

# Actualizar Props interface
old_props = """interface Props {
  materiales: any[];
  seleccion?: SeleccionItem[] | null;
  tema: any;
  materia: any;
  onBack: () => void;
}"""

new_props = """interface Props {
  materiales: any[];
  seleccion?: SeleccionItem[] | null;
  tema: any;
  materia: any;
  sessionId?: string | null;
  onBack: () => void;
}"""

if old_props in text3:
    text3 = text3.replace(old_props, new_props, 1)
    print("✅ [FlashcardsPage] Props interface con sessionId")

# Actualizar firma del componente
old_sig = "export default function FlashcardsPage({ materiales, seleccion, tema, materia, onBack }: Props) {"
new_sig = "export default function FlashcardsPage({ materiales, seleccion, tema, materia, sessionId, onBack }: Props) {"

if old_sig in text3:
    text3 = text3.replace(old_sig, new_sig, 1)
    print("✅ [FlashcardsPage] Firma actualizada")

# Añadir useEffect para CARGAR desde cache cuando hay sessionId
# Después del estado de flashcards
old_after_state = """  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [generating, setGenerating] = useState(false);"""

new_after_state = """  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [generating, setGenerating] = useState(false);
  const [cacheLoaded, setCacheLoaded] = useState(false);

  // ── Cargar flashcards desde cache de sesión al montar ──
  useEffect(() => {
    if (!sessionId || cacheLoaded) return;
    try {
      const sessions = getSessionsByTema(tema?.id || '');
      const sess = sessions.find(s => s.id === sessionId);
      if (sess?.flashcards && sess.flashcards.length > 0) {
        console.log('📦 Cache hit: cargando', sess.flashcards.length, 'flashcards desde sesión', sessionId);
        setFlashcards(sess.flashcards);
      }
    } catch (e) {
      console.warn('Error cargando cache de sesión:', e);
    }
    setCacheLoaded(true);
  }, [sessionId, tema?.id, cacheLoaded]);

  // ── Auto-guardar flashcards en sesión (con debounce) ──
  useEffect(() => {
    if (!sessionId || !cacheLoaded) return;
    if (flashcards.length === 0) return;
    const t = setTimeout(() => {
      try {
        const sessions = getSessionsByTema(tema?.id || '');
        const sess = sessions.find(s => s.id === sessionId);
        if (sess) {
          upsertSession({
            temaId: sess.temaId,
            enfoque: sess.enfoque,
            materialIds: sess.materialIds,
            selectedPages: sess.selectedPages,
            flashcards: flashcards,
          });
          console.log('💾 Cache guardado:', flashcards.length, 'flashcards en', sessionId);
        }
      } catch (e) {
        console.warn('Error guardando cache:', e);
      }
    }, 800);
    return () => clearTimeout(t);
  }, [flashcards, sessionId, tema?.id, cacheLoaded]);

"""

if old_after_state in text3:
    text3 = text3.replace(old_after_state, new_after_state, 1)
    print("✅ [FlashcardsPage] Cache load + auto-save añadidos")
else:
    print("❌ [FlashcardsPage] No encontré estado de flashcards")

path3.write_text(text3, encoding='utf-8')

print("\n🎉 Sistema de cache de sesiones aplicado.")
print("   - TemaView pasa sessionId al abrir flashcards")
print("   - page.tsx propaga sessionId a FlashcardsPage")
print("   - FlashcardsPage carga cache al montar")
print("   - FlashcardsPage auto-guarda cambios (debounce 800ms)")
