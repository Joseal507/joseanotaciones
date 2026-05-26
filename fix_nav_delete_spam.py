import pathlib

# ════════════════════════════════════════════════════
# FIX 1: "Volver al enfoque" → vuelve a TeoricoWorkspace
# en page.tsx, cambiar onBack de flashcards
# ════════════════════════════════════════════════════
path1 = pathlib.Path('app/materias/page.tsx')
text1 = path1.read_text(encoding='utf-8')

# El FlashcardsPage onBack actualmente va a 'tema'
# Necesitamos que vuelva a 'tema' pero con el enfoque abierto
# La forma más simple: FlashcardsPage.onBack → setVista('tema')
# Pero TemaView debería re-abrir el enfoque automáticamente si hay sesión activa

# Solución: página flashcards vuelve a tema, y TemaView detecta que debe
# reabrir el enfoque si venimos de flashcards con sesión activa
# Más simple: que onBack de flashcards ponga vista='tema' Y setee un flag

# Approach más limpio: que flashcards vuelva a tema directamente
# porque TeoricoWorkspace ya está montado bajo TemaView
# El problema es que setVista('tema') desmonta todo y remonta TemaView
# que NO tiene el enfoque abierto

# La solución real: NO desmontar, usar un state en TemaView
# Pero eso requiere refactor grande. Fix pragmático:
# Guardar en page.tsx un flag "returnToEnfoque" que TemaView lea

old_flash_render = """        {vista === 'flashcards' && temaActual && materiaActual && (
          <FlashcardsPage
            materiales={flashcardsMateriales.length > 0 ? flashcardsMateriales : temaActual.documentos}
            seleccion={flashcardsSeleccion}
            tema={temaActual}
            materia={materiaActual}
            sessionId={flashcardsSessionId}
            onBack={() => setVista('tema')}
          />
        )}"""

new_flash_render = """        {vista === 'flashcards' && temaActual && materiaActual && (
          <FlashcardsPage
            materiales={flashcardsMateriales.length > 0 ? flashcardsMateriales : temaActual.documentos}
            seleccion={flashcardsSeleccion}
            tema={temaActual}
            materia={materiaActual}
            sessionId={flashcardsSessionId}
            onBack={() => {
              setReturnToEnfoque(true);
              setVista('tema');
            }}
          />
        )}"""

if old_flash_render in text1:
    text1 = text1.replace(old_flash_render, new_flash_render, 1)
    print("✅ FIX 1a: FlashcardsPage onBack setea returnToEnfoque")
else:
    print("❌ FIX 1a: No encontré el render de FlashcardsPage")

# Añadir estado returnToEnfoque
old_state = """  const [flashcardsSessionId, setFlashcardsSessionId] = useState<string | null>(null);"""
new_state = """  const [flashcardsSessionId, setFlashcardsSessionId] = useState<string | null>(null);
  const [returnToEnfoque, setReturnToEnfoque] = useState(false);"""

if old_state in text1:
    text1 = text1.replace(old_state, new_state, 1)
    print("✅ FIX 1b: Estado returnToEnfoque añadido")

# Pasar returnToEnfoque a TemaView
old_tema_render = """            onOpenFlashcards={(mats?: any[], sel?: any[], sessionId?: string | null) => {"""
new_tema_render = """            returnToEnfoque={returnToEnfoque}
            onClearReturnToEnfoque={() => setReturnToEnfoque(false)}
            onOpenFlashcards={(mats?: any[], sel?: any[], sessionId?: string | null) => {"""

if old_tema_render in text1:
    text1 = text1.replace(old_tema_render, new_tema_render, 1)
    print("✅ FIX 1c: returnToEnfoque pasado a TemaView")

path1.write_text(text1, encoding='utf-8')

# ════════════════════════════════════════════════════
# FIX 1d: TemaView recibe returnToEnfoque y reabre enfoque
# ════════════════════════════════════════════════════
path2 = pathlib.Path('components/materias/TemaView.tsx')
text2 = path2.read_text(encoding='utf-8')

# Añadir useEffect que detecta returnToEnfoque
old_refresh_effect = """  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);"""

new_refresh_effect = """  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  // ── Auto-reabrir enfoque cuando volvemos de flashcards ──
  useEffect(() => {
    if (!returnToEnfoque) return;
    onClearReturnToEnfoque?.();
    // Buscar la sesión activa más reciente para este tema
    const sessions = getSessionsByTema(tema?.id || '');
    if (sessions.length > 0) {
      const lastSession = sessions[sessions.length - 1];
      // Restaurar selección
      const matIds = lastSession.materialIds || [];
      setSelectedIds(matIds.map((id: string) => {
        const doc = tema.documentos?.find((d: any) => (d.materialId || d.id) === id);
        return doc?.id || id;
      }).filter(Boolean));
      // Restaurar enfoque
      setEnfoqueElegido(lastSession.enfoque as any);
      if (lastSession.selectedPages) {
        const rebuilt = lastSession.materialIds.map((matId: string, idx: number) => ({
          materialId: matId,
          materialIndex: idx,
          pages: lastSession.selectedPages![matId] || [],
        }));
        setSeleccionResult(rebuilt as any);
      }
      setResumeSessionId(lastSession.id);
      setOpenTeorico(true);
      console.log('🔄 Auto-reabriendo enfoque desde flashcards:', lastSession.id);
    }
  }, [returnToEnfoque]);"""

if old_refresh_effect in text2:
    text2 = text2.replace(old_refresh_effect, new_refresh_effect, 1)
    print("✅ FIX 1d: TemaView auto-reabre enfoque al volver de flashcards")

# Asegurar que TemaView recibe las props
old_sig = """export default function TemaView({ materia, tema, onBack, onBackMateria, onGoHome, onAbrirApunte, onAbrirDocumento, onEliminarApunte, onEliminarDocumento, onNuevoApunte, onSubirDocumento, subiendoDoc, onAbrirUploader, onOpenFlashcards, onOpenQuiz }: any) {"""
new_sig = """export default function TemaView({ materia, tema, onBack, onBackMateria, onGoHome, onAbrirApunte, onAbrirDocumento, onEliminarApunte, onEliminarDocumento, onNuevoApunte, onSubirDocumento, subiendoDoc, onAbrirUploader, onOpenFlashcards, onOpenQuiz, returnToEnfoque, onClearReturnToEnfoque }: any) {"""

if old_sig in text2:
    text2 = text2.replace(old_sig, new_sig, 1)
    print("✅ FIX 1e: TemaView firma actualizada con returnToEnfoque")

# ════════════════════════════════════════════════════
# FIX 2: Eliminar correctamente múltiples materiales
# ════════════════════════════════════════════════════

# Ver la función eliminarDocumento en page.tsx para entender si es async
path1_text = path1.read_text(encoding='utf-8')

# El problema: onEliminarDocumento puede no ser async.
# Fix en TemaView: snapshot ids, desactivar botón, borrar secuencialmente
# Ya hace eso (línea 2111-2126) pero el problema es que:
# 1) El sync de selectedIds con documentos existentes (línea 534) puede interferir
# 2) El loop puede disparar re-renders que resetean cosas

# Fix: desactivar el useEffect de limpieza mientras borramos
old_sync = """  // Sincronizar selectedIds con documentos existentes (limpia IDs de docs borrados)
  useEffect(() => {
    const existingIds = new Set(tema.documentos.map((d: any) => d.id));
    setSelectedIds(prev => {
      const filtered = prev.filter(id => existingIds.has(id));
      // Si ya no hay seleccionados y la pantalla estaba abierta, cerrarla
      if (filtered.length === 0 && prev.length > 0) {
        setShowSeleccion(false);
        setShowEnfoque(false);
        setEnfoqueElegido(null);
      }
      return filtered;
    });
  }, [tema.documentos]);"""

new_sync = """  // Sincronizar selectedIds con documentos existentes (limpia IDs de docs borrados)
  // Se desactiva mientras se está borrando para evitar interferencia
  useEffect(() => {
    if (deleting) return; // No limpiar mientras borramos
    const existingIds = new Set(tema.documentos.map((d: any) => d.id));
    setSelectedIds(prev => {
      const filtered = prev.filter(id => existingIds.has(id));
      if (filtered.length === 0 && prev.length > 0) {
        setShowSeleccion(false);
        setShowEnfoque(false);
        setEnfoqueElegido(null);
      }
      return filtered;
    });
  }, [tema.documentos, deleting]);"""

if old_sync in text2:
    text2 = text2.replace(old_sync, new_sync, 1)
    print("✅ FIX 2: Sync de selectedIds no interfiere durante borrado")

# ════════════════════════════════════════════════════
# FIX 3: Remover log spam del render
# ════════════════════════════════════════════════════
path3 = pathlib.Path('components/materias/FlashcardsPage.tsx')
text3 = path3.read_text(encoding='utf-8')

old_spam = """  console.log('📑 Flashcards selectedPages:', selectedPages, 'material:', matActual?.materialId || matActual?.id);"""
new_spam = """  // Log movido fuera del render para evitar spam
  // (selectedPages y matActual se logean en extractText)"""

if old_spam in text3:
    text3 = text3.replace(old_spam, new_spam, 1)
    path3.write_text(text3, encoding='utf-8')
    print("✅ FIX 3: Log spam removido del render")

path2.write_text(text2, encoding='utf-8')

print("\n🎉 3 fixes aplicados:")
print("   1. 'Volver al enfoque' → reabre TeoricoWorkspace automáticamente")
print("   2. Borrado múltiple no interfiere con sync de selectedIds")
print("   3. Log spam de selectedPages removido del render")
