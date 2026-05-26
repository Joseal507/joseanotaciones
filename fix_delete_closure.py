import pathlib

path = pathlib.Path('app/materias/page.tsx')
text = path.read_text(encoding='utf-8')

# El problema: dentro del callback de setMaterias, temaActual y materiaActual
# son closures del momento en que se llamó eliminarDocumento
# Para borrado múltiple, el segundo llama con los mismos valores
# PERO como usamos prevMaterias (el estado más reciente), el filter funciona bien
# El problema real es que setTemaActual y setMateriaActual dentro del callback
# de setMaterias puede causar problemas (no se debe llamar setState dentro de setState)

old_callback = """  setMaterias(prevMaterias => {
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

new_callback = """  // Capturar IDs en el momento del cierre (no son stale)
  const temaId = temaActual?.id;
  const materiaId = materiaActual?.id;

  setMaterias(prevMaterias => {
    const nuevas = prevMaterias.map(m => {
      if (!temaId || m.id !== materiaId) return m;
      return {
        ...m,
        temas: m.temas.map(t => {
          if (t.id !== temaId) return t;
          return {
            ...t,
            documentos: t.documentos.filter((d: any) => d.id !== id),
          };
        }),
      };
    });
    saveMaterias(nuevas);
    return nuevas;
  });

  // Actualizar temaActual y materiaActual FUERA del callback de setMaterias
  setTemaActual(prev => {
    if (!prev || prev.id !== temaId) return prev;
    return {
      ...prev,
      documentos: prev.documentos.filter((d: any) => d.id !== id),
    };
  });
  setMateriaActual(prev => {
    if (!prev || prev.id !== materiaId) return prev;
    return {
      ...prev,
      temas: prev.temas.map((t: any) => {
        if (t.id !== temaId) return t;
        return {
          ...t,
          documentos: t.documentos.filter((d: any) => d.id !== id),
        };
      }),
    };
  });
};"""

if old_callback in text:
    text = text.replace(old_callback, new_callback, 1)
    path.write_text(text, encoding='utf-8')
    print("✅ eliminarDocumento: setState separados, sin setState anidado")
else:
    print("❌ No encontré el bloque")
    idx = text.find('setMaterias(prevMaterias =>')
    if idx >= 0:
        print(f"Contexto actual:\n{text[idx:idx+600]}")
