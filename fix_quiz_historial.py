from pathlib import Path
import re

path = Path("components/materias/QuizPage.tsx")
text = path.read_text(encoding='utf-8')

# ══════════════════════════════════════════════
# 1) Cambiar el useEffect de carga: incluir TEMPORALES + GUARDADOS
# ══════════════════════════════════════════════
old_load = """  // Cargar historial de quizzes guardados del tema
  useEffect(() => {
    const load = async () => {
      try {
        await cargarQuizzesDesdeDB();
      } catch {}
      const todos = getQuizzesGuardados();
      // Filtrar los que pertenecen a este tema (por nombre del tema en el nombre)
      const delTema = todos.filter(q =>
        q.materiaNombre === materia.nombre &&
        (q.nombre.includes(tema.nombre) || true) // todos los de la materia por ahora
      );
      setHistorialQuizzes(delTema);
    };
    load();
  }, [materia.nombre, tema.nombre, guardadoOk]);"""

new_load = """  // Cargar historial de quizzes (temporales + guardados) del tema
  const recargarHistorial = async () => {
    try {
      await cargarQuizzesDesdeDB();
    } catch (e) {
      console.warn('Error cargando quizzes de DB:', e);
    }
    const guardados = getQuizzesGuardados();
    const temporales = getQuizzesTemporales();
    
    // Filtrar por materia (más permisivo)
    const filtrar = (q: QuizGuardado) => {
      if (q.materiaNombre && q.materiaNombre === materia.nombre) return true;
      if (q.nombre && q.nombre.toLowerCase().includes(tema.nombre.toLowerCase())) return true;
      return false;
    };
    
    const guardadosFiltrados = guardados.filter(filtrar);
    const temporalesFiltrados = temporales.filter(filtrar);
    
    // Combinar: primero guardados, luego temporales
    const todos = [
      ...guardadosFiltrados.map(q => ({ ...q, esTemporal: false })),
      ...temporalesFiltrados.map(q => ({ ...q, esTemporal: true })),
    ];
    
    console.log('📋 Historial cargado:', {
      total: todos.length,
      guardados: guardadosFiltrados.length,
      temporales: temporalesFiltrados.length,
      materia: materia.nombre,
    });
    
    setHistorialQuizzes(todos);
  };

  useEffect(() => {
    recargarHistorial();
  }, [materia.nombre, tema.nombre, guardadoOk, fase]);"""

if old_load in text:
    text = text.replace(old_load, new_load, 1)
    print("✅ Carga de historial mejorada (temporales + guardados)")
else:
    print("❌ No matcheó el useEffect de carga")

# ══════════════════════════════════════════════
# 2) Mostrar siempre el post-it (también vacío)
# ══════════════════════════════════════════════
# Cambiar la condición del render
text = text.replace(
    "{historialQuizzes.length > 0 && showHistorial && (",
    "{showHistorial && (",
    1
)
text = text.replace(
    "{historialQuizzes.length > 0 && !showHistorial && (",
    "{!showHistorial && (",
    1
)
print("✅ Post-it se muestra siempre")

# ══════════════════════════════════════════════
# 3) Actualizar el contenido del post-it para mostrar temporales con badge
# ══════════════════════════════════════════════
old_postit_body = """            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 12, fontStyle: 'italic' }}>
              ~ {historialQuizzes.length} en {materia.nombre} ~
            </div>

            <div style={{
              flex: 1, overflow: 'auto',
              display: 'flex', flexDirection: 'column', gap: 8,
              marginRight: -4, paddingRight: 4,
            }}>
              {historialQuizzes.map((q) => {
                const meta = NIVELES.find(n => n.id === q.nivel) || NIVELES[1];
                return (
                  <div key={q.id} style={{
                    background: 'rgba(0,0,0,0.25)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    position: 'relative',
                    transition: 'all 0.15s',
                  }}>
                    <div style={{
                      fontSize: 14, fontWeight: 700, color: '#fff',
                      lineHeight: 1.3, marginBottom: 4,
                      paddingRight: 22,
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {q.nombre}
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 11, color: 'rgba(255,255,255,0.5)',
                      marginBottom: 8,
                    }}>
                      <span>{meta.emoji}</span>
                      <span>{q.preguntas.length}p</span>
                      <span>·</span>
                      <span>{q.fechaCreacion}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => cargarQuizDelHistorial(q)} style={{
                        flex: 1, padding: '5px 8px',
                        background: themeColor, color: '#000',
                        border: 'none', borderRadius: 6,
                        fontFamily: HAND, fontSize: 13, fontWeight: 800,
                        cursor: 'pointer',
                      }}>▶ Jugar</button>
                      <button onClick={() => borrarDelHistorial(q.id)} style={{
                        padding: '5px 8px',
                        background: 'rgba(248,113,113,0.15)',
                        color: '#f87171',
                        border: '1px solid rgba(248,113,113,0.3)',
                        borderRadius: 6,
                        fontFamily: HAND, fontSize: 13, fontWeight: 700,
                        cursor: 'pointer',
                      }}>🗑</button>
                    </div>
                  </div>
                );
              })}
            </div>"""

new_postit_body = """            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 12, fontStyle: 'italic' }}>
              ~ {historialQuizzes.length} {historialQuizzes.length === 1 ? 'quiz' : 'quizzes'} en {materia.nombre} ~
            </div>

            {historialQuizzes.length === 0 ? (
              <div style={{
                padding: '20px 8px', textAlign: 'center',
                color: 'rgba(255,255,255,0.5)', fontSize: 14,
                fontStyle: 'italic', lineHeight: 1.5,
              }}>
                Todavía no hay quizzes.<br/>
                Genera uno y aparecerá aquí 📝
              </div>
            ) : (
              <div style={{
                flex: 1, overflow: 'auto',
                display: 'flex', flexDirection: 'column', gap: 8,
                marginRight: -4, paddingRight: 4,
              }}>
                {historialQuizzes.map((q: any) => {
                  const meta = NIVELES.find(n => n.id === q.nivel) || NIVELES[1];
                  const esTemp = q.esTemporal || (q.expiraEn && q.expiraEn > Date.now());
                  const tiempoExp = esTemp && q.expiraEn ? getTiempoRestante(q.expiraEn) : null;
                  
                  return (
                    <div key={q.id} style={{
                      background: esTemp ? 'rgba(245,200,66,0.08)' : 'rgba(0,0,0,0.25)',
                      border: esTemp ? '1px dashed rgba(245,200,66,0.35)' : '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      position: 'relative',
                      transition: 'all 0.15s',
                    }}>
                      {esTemp && (
                        <div style={{
                          position: 'absolute',
                          top: -7, right: 8,
                          background: '#f5c842',
                          color: '#000',
                          fontSize: 9, fontWeight: 900,
                          padding: '1px 7px', borderRadius: 4,
                          fontFamily: HAND, letterSpacing: 0.3,
                          textTransform: 'uppercase',
                        }}>
                          ⏳ {tiempoExp || '24h'}
                        </div>
                      )}
                      <div style={{
                        fontSize: 14, fontWeight: 700, color: '#fff',
                        lineHeight: 1.3, marginBottom: 4,
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {q.nombre}
                      </div>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        fontSize: 11, color: 'rgba(255,255,255,0.5)',
                        marginBottom: 8,
                      }}>
                        <span>{meta.emoji}</span>
                        <span>{q.preguntas.length}p</span>
                        <span>·</span>
                        <span>{q.fechaCreacion}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => cargarQuizDelHistorial(q)} style={{
                          flex: 1, padding: '5px 8px',
                          background: themeColor, color: '#000',
                          border: 'none', borderRadius: 6,
                          fontFamily: HAND, fontSize: 13, fontWeight: 800,
                          cursor: 'pointer',
                        }}>▶ Jugar</button>
                        <button onClick={() => borrarDelHistorial(q.id, esTemp)} style={{
                          padding: '5px 8px',
                          background: 'rgba(248,113,113,0.15)',
                          color: '#f87171',
                          border: '1px solid rgba(248,113,113,0.3)',
                          borderRadius: 6,
                          fontFamily: HAND, fontSize: 13, fontWeight: 700,
                          cursor: 'pointer',
                        }}>🗑</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}"""

if old_postit_body in text:
    text = text.replace(old_postit_body, new_postit_body, 1)
    print("✅ Post-it body actualizado con temporales + vacío")
else:
    print("❌ No matcheó el body del post-it")

# ══════════════════════════════════════════════
# 4) Actualizar borrarDelHistorial para soportar temporales
# ══════════════════════════════════════════════
old_borrar = """  const borrarDelHistorial = async (id: string) => {
    if (!confirm('¿Eliminar este quiz guardado?')) return;
    await eliminarQuizGuardado(id);
    setHistorialQuizzes(prev => prev.filter(q => q.id !== id));
  };"""

new_borrar = """  const borrarDelHistorial = async (id: string, esTemp: boolean = false) => {
    if (!confirm('¿Eliminar este quiz?')) return;
    if (esTemp) {
      const { eliminarQuizTemporal } = await import('../../lib/quizStorage');
      eliminarQuizTemporal(id);
    } else {
      await eliminarQuizGuardado(id);
    }
    setHistorialQuizzes(prev => prev.filter(q => q.id !== id));
  };"""

if old_borrar in text:
    text = text.replace(old_borrar, new_borrar, 1)
    print("✅ borrarDelHistorial soporta temporales")

# ══════════════════════════════════════════════
# 5) Reducir el width del post-it para que no sea tan grande
# ══════════════════════════════════════════════
text = text.replace(
    "width: 280, flexShrink: 0,\n            position: 'sticky', top: 0,",
    "width: 260, flexShrink: 0,\n            position: 'sticky', top: 0, alignSelf: 'flex-start',",
    1
)

path.write_text(text, encoding='utf-8')
print("\n🎉 Listo:")
print("  · Post-it siempre visible (con mensaje si vacío)")
print("  · Muestra temporales (con badge ⏳) y permanentes")
print("  · Recarga al cambiar de fase")
print("  · Logs en consola para debug")
