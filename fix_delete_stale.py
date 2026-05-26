import pathlib

path = pathlib.Path('app/materias/page.tsx')
text = path.read_text(encoding='utf-8')

# FIX: actualizarTema debe usar callback funcional para evitar stale closure
# Y NO debe llamar setVista('tema') porque eso interfiere con el modal
old_end = """  actualizarTema({
    ...temaActual,
    documentos: temaActual.documentos.filter(d => d.id !== id),
  });
  setVista('tema');
};"""

new_end = """  // Actualizar estado local inmediatamente (sin stale closure)
  // Usar función callback para garantizar que lee el estado más reciente
  setMaterias(prevMaterias => {
    const nuevas = prevMaterias.map(m => {
      if (!temaActual || m.id !== materiaActual?.id) return m;
      return {
        ...m,
        temas: m.temas.map(t => {
          if (t.id !== temaActual.id) return t;
          return {
            ...t,
            documentos: t.documentos.filter((d: any) => d.id !== id),
          };
        }),
      };
    });
    saveMaterias(nuevas);
    // Actualizar temaActual en paralelo
    const materiaAct = nuevas.find(m => m.id === materiaActual?.id);
    const temaAct = materiaAct?.temas.find(t => t.id === temaActual?.id);
    if (temaAct) {
      setTemaActual(temaAct);
      setMateriaActual(materiaAct || null);
    }
    return nuevas;
  });
  // NO llamar setVista('tema') - el modal de TemaView maneja la UI
};"""

if old_end in text:
    text = text.replace(old_end, new_end, 1)
    path.write_text(text, encoding='utf-8')
    print("✅ eliminarDocumento usa callback funcional (sin stale closure)")
    print("   - actualizarTema reemplazado por setMaterias con función")
    print("   - NO llama setVista('tema') durante borrado múltiple")
else:
    print("❌ No encontré el bloque exacto")
    # Debug
    if 'actualizarTema' in text:
        idx = text.find('actualizarTema')
        while idx >= 0:
            print(f"  actualizarTema en: {text[idx:idx+100]}")
            idx = text.find('actualizarTema', idx+1)
