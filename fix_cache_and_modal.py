import pathlib
import re

# ════════════════════════════════════════════════════
# FIX 1: handler de TemaView siempre busca/crea sesión
# y la pasa correctamente
# ════════════════════════════════════════════════════
path1 = pathlib.Path('components/materias/TemaView.tsx')
text1 = path1.read_text(encoding='utf-8')

# El problema: cuando entras vía "seguir estudiando", resumeSessionId tiene valor
# pero cuando entras vía "empezar a estudiar", se calcula savedSessionId DENTRO del handler
# Sin embargo, el upsertSession ya devuelve la sesión correcta (existente o nueva)
# Pero estamos también haciendo "resumeSessionId || savedSessionId" lo cual está bien.
#
# El verdadero problema es que el handler se ejecuta sólo cuando TeoricoWorkspace llama
# onOpenFlashcards. Y cada vez ARMA un savedSessionId nuevo. Si una sesión ya existía,
# upsertSession devuelve la MISMA sesión (no crea nueva). Eso está bien.
#
# Verificar: añadir un console.log más explícito
old_log = """                if (tema?.id && enfoqueElegido && matIds.length > 0) {
                  const sess = upsertSession({
                    temaId: tema.id,
                    enfoque: enfoqueElegido as any,
                    materialIds: matIds,
                    selectedPages: Object.keys(pagesByMat).length ? pagesByMat : undefined,
                  });
                  savedSessionId = sess.id;
                  refreshSessions();
                  console.log('💾 Sesión guardada:', enfoqueElegido, matIds, '→', sess.id);
                }"""

new_log = """                if (tema?.id && enfoqueElegido && matIds.length > 0) {
                  const sess = upsertSession({
                    temaId: tema.id,
                    enfoque: enfoqueElegido as any,
                    materialIds: matIds,
                    selectedPages: Object.keys(pagesByMat).length ? pagesByMat : undefined,
                  });
                  savedSessionId = sess.id;
                  refreshSessions();
                  console.log('💾 [TemaView] Sesión upsertada:', sess.id, '| flashcards en cache:', sess.flashcards?.length || 0);
                }"""

if old_log in text1:
    text1 = text1.replace(old_log, new_log, 1)
    print("✅ Log mejorado en TemaView")

# Resetear resumeSessionId cuando se cierra el enfoque
old_close = """      onClose={() => { setOpenTeorico(false); setSeleccionResult(null); setEnfoqueElegido(null); }}"""
new_close = """      onClose={() => { setOpenTeorico(false); setSeleccionResult(null); setEnfoqueElegido(null); setResumeSessionId(null); refreshSessions(); }}"""

if old_close in text1:
    text1 = text1.replace(old_close, new_close, 1)
    print("✅ resumeSessionId se resetea al cerrar + refreshSessions")

# ════════════════════════════════════════════════════
# FIX 2: Reemplazar confirm() por modal bonito
# ════════════════════════════════════════════════════
old_delete_btn = """    {/* BOTÓN ELIMINAR */}
    <button
      onClick={() => {
        const count = selectedIds.length;
        const msg = count === 1
          ? '¿Eliminar este material? Esta acción no se puede deshacer.'
          : `¿Eliminar ${count} materiales? Esta acción no se puede deshacer.`;
        if (!window.confirm(msg)) return;

        // Borrar cada material seleccionado
        const idsToDelete = [...selectedIds];
        idsToDelete.forEach(id => {
          try { onEliminarDocumento?.(id); } catch (e) { console.warn('Error eliminando', id, e); }
        });
        setSelectedIds([]);
      }}"""

new_delete_btn = """    {/* BOTÓN ELIMINAR */}
    <button
      onClick={() => setDeleteConfirmOpen(true)}"""

if old_delete_btn in text1:
    text1 = text1.replace(old_delete_btn, new_delete_btn, 1)
    print("✅ Botón eliminar abre modal en vez de confirm()")
else:
    print("⚠️ No encontré botón eliminar exacto")

# Añadir estado para modal y para loading de eliminación
old_state2 = """  // ── ID de sesión a reanudar (cuando se hace "seguir estudiando") ──
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);"""

new_state2 = """  // ── ID de sesión a reanudar (cuando se hace "seguir estudiando") ──
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);

  // ── Modal de confirmación de borrado ──
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ done: 0, total: 0 });"""

if old_state2 in text1:
    text1 = text1.replace(old_state2, new_state2, 1)
    print("✅ Estados para modal y progreso de borrado añadidos")

# Añadir el modal antes del cierre del componente (antes del último </div>)
# Buscamos un anchor: el cierre del bloque del botón Estudiar+Eliminar
# Mejor: ponerlo justo después del wrapper del botón
modal_jsx = '''
      {/* ═══════════════════════════════════════════════ */}
      {/* MODAL ELIMINAR MATERIALES                       */}
      {/* ═══════════════════════════════════════════════ */}
      {deleteConfirmOpen && (
        <div
          onClick={() => !deleting && setDeleteConfirmOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            background: 'rgba(0,0,0,0.78)',
            backdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'linear-gradient(135deg, #1a1010, #2a1515)',
              border: '2px solid rgba(255,68,68,0.5)',
              borderRadius: 20,
              padding: 32,
              maxWidth: 460,
              width: '90%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(255,68,68,0.3)',
              animation: 'studyBtnIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            <div style={{
              fontSize: 48, textAlign: 'center', marginBottom: 16,
              filter: 'drop-shadow(0 0 12px rgba(255,68,68,0.6))',
            }}>🗑️</div>

            <div style={{
              fontFamily: HAND, fontSize: 28, fontWeight: 800,
              color: '#ff8888', textAlign: 'center', marginBottom: 8,
              textShadow: '0 0 10px rgba(255,68,68,0.4)',
            }}>
              {selectedIds.length === 1 ? '¿Eliminar este material?' : `¿Eliminar ${selectedIds.length} materiales?`}
            </div>

            <div style={{
              fontFamily: BODY, fontSize: 14, color: 'rgba(255,255,255,0.7)',
              textAlign: 'center', marginBottom: 20, lineHeight: 1.5,
            }}>
              Esta acción no se puede deshacer. Los archivos se borrarán permanentemente
              junto con sus sesiones de estudio.
            </div>

            {/* Lista de materiales a borrar */}
            <div style={{
              maxHeight: 160, overflow: 'auto',
              background: 'rgba(0,0,0,0.3)', borderRadius: 10,
              padding: '10px 14px', marginBottom: 20,
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {tema.documentos.filter((d: any) => selectedIds.includes(d.id)).map((d: any) => (
                <div key={d.id} style={{
                  fontFamily: BODY, fontSize: 13, color: 'rgba(255,255,255,0.85)',
                  padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span>📄</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.nombre}
                  </span>
                </div>
              ))}
            </div>

            {deleting && (
              <div style={{
                marginBottom: 16, padding: '10px 14px',
                background: 'rgba(255,68,68,0.08)', borderRadius: 10,
                border: '1px solid rgba(255,68,68,0.25)',
                fontFamily: BODY, fontSize: 13, color: '#ffaaaa',
                textAlign: 'center',
              }}>
                Eliminando {deleteProgress.done} de {deleteProgress.total}...
                <div style={{
                  marginTop: 6, height: 4, background: 'rgba(0,0,0,0.4)', borderRadius: 4, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${(deleteProgress.done / Math.max(1, deleteProgress.total)) * 100}%`,
                    background: 'linear-gradient(90deg, #ff4444, #ff8888)',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleting}
                style={{
                  flex: 1, padding: '12px 20px', borderRadius: 12,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1.5px solid rgba(255,255,255,0.15)',
                  color: '#fff', fontFamily: HAND, fontSize: 18, fontWeight: 700,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  opacity: deleting ? 0.5 : 1,
                  transition: 'all 0.2s',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  const idsToDelete = [...selectedIds];
                  setDeleting(true);
                  setDeleteProgress({ done: 0, total: idsToDelete.length });

                  for (let i = 0; i < idsToDelete.length; i++) {
                    const id = idsToDelete[i];
                    try {
                      await Promise.resolve(onEliminarDocumento?.(id));
                    } catch (e) {
                      console.warn('Error eliminando', id, e);
                    }
                    setDeleteProgress({ done: i + 1, total: idsToDelete.length });
                    await new Promise(r => setTimeout(r, 150)); // pequeña pausa visual
                  }

                  setSelectedIds([]);
                  setDeleting(false);
                  setDeleteConfirmOpen(false);
                  setDeleteProgress({ done: 0, total: 0 });
                  refreshSessions();
                }}
                disabled={deleting}
                style={{
                  flex: 1, padding: '12px 20px', borderRadius: 12,
                  background: 'linear-gradient(135deg, #ff4444, #cc2222)',
                  border: '1.5px solid #ff4444',
                  color: '#fff', fontFamily: HAND, fontSize: 18, fontWeight: 800,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  opacity: deleting ? 0.7 : 1,
                  boxShadow: '0 4px 16px rgba(255,68,68,0.4)',
                  transition: 'all 0.2s',
                }}
              >
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

'''

# Insertar el modal antes del último </div>) del return principal del componente
# Anchor seguro: justo antes del </div> que cierra el contenedor principal
# Buscamos el último cierre antes del cierre de la función
# Una buena heurística: insertarlo antes del cierre del enfoqueWheel o seleccionPaginas
# Pero más seguro: insertarlo justo antes de "{showEnfoque && ("
old_anchor = """      {showEnfoque && ("""
new_anchor = modal_jsx + """      {showEnfoque && ("""

if old_anchor in text1:
    text1 = text1.replace(old_anchor, new_anchor, 1)
    print("✅ Modal de eliminación añadido antes de EnfoqueWheel")
else:
    print("⚠️ No encontré anchor showEnfoque - revisa manual")

path1.write_text(text1, encoding='utf-8')
print("\n🎉 Fixes aplicados:")
print("   - Modal bonito reemplaza confirm() nativo")
print("   - Borrado secuencial con barra de progreso")
print("   - refreshSessions() después de cerrar/borrar")
print("   - Log mejorado para debug del cache")
