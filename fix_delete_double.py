import pathlib

path = pathlib.Path('components/materias/TemaView.tsx')
text = path.read_text(encoding='utf-8')

# FIX: El botón de eliminar en el modal debe ser protegido contra doble click
# con un ref o con un flag adicional
old_btn = """                onClick={async () => {
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
                disabled={deleting}"""

new_btn = """                onClick={async () => {
                  if (deleting) return; // guard anti doble-click
                  const idsToDelete = [...selectedIds]; // snapshot inmutable
                  setDeleting(true);
                  setDeleteProgress({ done: 0, total: idsToDelete.length });

                  // Cerrar modal ANTES de borrar para evitar re-clicks
                  setDeleteConfirmOpen(false);

                  let borrados = 0;
                  for (const id of idsToDelete) {
                    try {
                      const result = onEliminarDocumento?.(id);
                      // Esperar si es Promise
                      if (result && typeof (result as any).then === 'function') {
                        await result;
                      }
                      borrados++;
                    } catch (e) {
                      console.warn('Error eliminando', id, e);
                    }
                    setDeleteProgress({ done: borrados, total: idsToDelete.length });
                    // Pequeña pausa para que el servidor procese
                    await new Promise(r => setTimeout(r, 300));
                  }

                  setSelectedIds([]);
                  setDeleting(false);
                  setDeleteProgress({ done: 0, total: 0 });
                  refreshSessions();
                }}
                disabled={deleting}"""

if old_btn in text:
    text = text.replace(old_btn, new_btn, 1)
    print("✅ Botón eliminar protegido contra doble-click")
else:
    print("❌ No encontré el botón exacto")
    # Buscar variante
    if 'idsToDelete = [...selectedIds]' in text:
        print("   → El código existe pero el texto no matchea exacto")
        idx = text.find('idsToDelete = [...selectedIds]')
        print(f"   Contexto: {text[idx-100:idx+300]}")

path.write_text(text, encoding='utf-8')
