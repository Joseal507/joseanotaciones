from pathlib import Path
import re

path = Path("components/materias/QuizPage.tsx")
text = path.read_text(encoding='utf-8')

# ══════════════════════════════════════════════
# 1) Auto-scroll suave hacia abajo al responder
# ══════════════════════════════════════════════
old_responder = """  const responder = (i: number) => {
    if (respondida || !preguntaActual) return;
    setSeleccionada(i); setRespondida(true);
    const ok = i === preguntaActual.correcta;
    if (ok) setPuntos(p => p + 1);
    setResultados(prev => [...prev, ok]);
  };"""

new_responder = """  const responder = (i: number) => {
    if (respondida || !preguntaActual) return;
    setSeleccionada(i); setRespondida(true);
    const ok = i === preguntaActual.correcta;
    if (ok) setPuntos(p => p + 1);
    setResultados(prev => [...prev, ok]);
    // Auto-scroll suave para revelar la explicación
    setTimeout(() => {
      const el = scrollRef.current;
      if (el) {
        el.scrollTo({
          top: el.scrollTop + 220,
          behavior: 'smooth',
        });
      }
    }, 120);
  };"""

if old_responder in text:
    text = text.replace(old_responder, new_responder, 1)
    print("✅ Auto-scroll al responder añadido")
else:
    print("❌ No matcheó responder")

# ══════════════════════════════════════════════
# 2) Import getQuizzesGuardados para el historial
# ══════════════════════════════════════════════
old_import = """import {
  guardarQuizTemporal, guardarQuiz, getQuizzesTemporales,
  getTiempoRestante, QuizGuardado,
} from '../../lib/quizStorage';"""

new_import = """import {
  guardarQuizTemporal, guardarQuiz, getQuizzesTemporales,
  getTiempoRestante, QuizGuardado, getQuizzesGuardados,
  cargarQuizzesDesdeDB, eliminarQuizGuardado,
} from '../../lib/quizStorage';"""

if old_import in text:
    text = text.replace(old_import, new_import, 1)
    print("✅ Imports actualizados")

# ══════════════════════════════════════════════
# 3) Estado para historial de quizzes
# ══════════════════════════════════════════════
old_state = """  const [tiempoRestante, setTiempoRestante] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);"""

new_state = """  const [tiempoRestante, setTiempoRestante] = useState('');
  const [historialQuizzes, setHistorialQuizzes] = useState<QuizGuardado[]>([]);
  const [quizActivoId, setQuizActivoId] = useState<string | null>(null);
  const [showHistorial, setShowHistorial] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);"""

if old_state in text:
    text = text.replace(old_state, new_state, 1)
    print("✅ Estado historial añadido")

# ══════════════════════════════════════════════
# 4) Cargar historial al montar (filtrar por materia/tema)
# ══════════════════════════════════════════════
# Añadir useEffect después del de teclado
anchor = """  // Scroll al top cuando cambia pregunta
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [idx]);"""

new_anchor = """  // Scroll al top cuando cambia pregunta
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [idx]);

  // Cargar historial de quizzes guardados del tema
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
  }, [materia.nombre, tema.nombre, guardadoOk]);

  // Cargar quiz guardado del historial
  const cargarQuizDelHistorial = (q: QuizGuardado) => {
    setPreguntas(q.preguntas);
    setNivel(q.nivel || 'intermedio');
    setIdx(0); setSeleccionada(null); setRespondida(false);
    setPuntos(0); setResultados([]);
    setQuizActivoId(q.id);
    setGuardadoOk(true); // Ya está guardado
    setQuizTempId(null);
    setFase('jugando');
  };

  const borrarDelHistorial = async (id: string) => {
    if (!confirm('¿Eliminar este quiz guardado?')) return;
    await eliminarQuizGuardado(id);
    setHistorialQuizzes(prev => prev.filter(q => q.id !== id));
  };"""

if anchor in text:
    text = text.replace(anchor, new_anchor, 1)
    print("✅ Carga de historial añadida")

# ══════════════════════════════════════════════
# 5) Reset estados al volver a config para el quiz activo
# ══════════════════════════════════════════════
text = text.replace(
    "setGuardadoOk(false); setQuizTempId(null); setNombreGuardar('');\n      setFase('jugando');",
    "setGuardadoOk(false); setQuizTempId(null); setNombreGuardar(''); setQuizActivoId(null);\n      setFase('jugando');"
)

# ══════════════════════════════════════════════
# 6) Sidebar post-it con historial — modificar la fase CONFIG
# ══════════════════════════════════════════════
old_config_container = """  if (fase === 'config' || fase === 'generando') return (
    <Base>
      <Header/>
      <div ref={scrollRef} style={{
        flex: 1, overflow: 'auto', display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center',
        padding: '32px 20px',
      }}>
        <div style={{ width: '100%', maxWidth: 520 }}>"""

new_config_container = """  if (fase === 'config' || fase === 'generando') return (
    <Base>
      <Header/>
      <div ref={scrollRef} style={{
        flex: 1, overflow: 'auto', display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center',
        padding: '32px 20px', gap: 24,
        position: 'relative',
      }}>
        <div style={{ width: '100%', maxWidth: 520 }}>"""

if old_config_container in text:
    text = text.replace(old_config_container, new_config_container, 1)
    print("✅ Container config con gap")

# ══════════════════════════════════════════════
# 7) Insertar post-it ANTES del cierre del flex container en fase config
# ══════════════════════════════════════════════
# Buscar el cierre del contenedor de config
old_close_config = """          <button onClick={generate} disabled={fase === 'generando'} style={{
            width: '100%', padding: '18px',
            background: fase === 'generando'
              ? 'rgba(255,255,255,0.05)'
              : `linear-gradient(135deg, ${themeColor}dd, ${themeColor})`,
            color: fase === 'generando' ? 'rgba(255,255,255,0.3)' : '#000',
            border: 'none', borderRadius: 14,
            cursor: fase === 'generando' ? 'not-allowed' : 'pointer',
            fontFamily: HAND, fontSize: 22, fontWeight: 900,
            boxShadow: fase === 'generando' ? 'none' : `0 4px 24px ${themeColor}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            transition: 'all 0.2s',
          }}>
            {fase === 'generando' ? (
              <>
                <div style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
                Generando quiz...
              </>
            ) : `🚀 Empezar · ${count} preguntas`}
          </button>
        </div>
      </div>"""

new_close_config = """          <button onClick={generate} disabled={fase === 'generando'} style={{
            width: '100%', padding: '18px',
            background: fase === 'generando'
              ? 'rgba(255,255,255,0.05)'
              : `linear-gradient(135deg, ${themeColor}dd, ${themeColor})`,
            color: fase === 'generando' ? 'rgba(255,255,255,0.3)' : '#000',
            border: 'none', borderRadius: 14,
            cursor: fase === 'generando' ? 'not-allowed' : 'pointer',
            fontFamily: HAND, fontSize: 22, fontWeight: 900,
            boxShadow: fase === 'generando' ? 'none' : `0 4px 24px ${themeColor}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            transition: 'all 0.2s',
          }}>
            {fase === 'generando' ? (
              <>
                <div style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
                Generando quiz...
              </>
            ) : `🚀 Empezar · ${count} preguntas`}
          </button>
        </div>

        {/* ── Post-it lateral: historial de quizzes ── */}
        {historialQuizzes.length > 0 && showHistorial && (
          <div style={{
            width: 280, flexShrink: 0,
            position: 'sticky', top: 0,
            transform: 'rotate(1.2deg)',
            background: `linear-gradient(135deg, ${themeColor}28, ${themeColor}18)`,
            border: `1px solid ${themeColor}44`,
            borderRadius: 4,
            padding: '18px 16px 16px',
            boxShadow: `0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px ${themeColor}22`,
            fontFamily: HAND,
            position: 'relative',
            maxHeight: 'calc(100vh - 100px)',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Cinta scotch arriba */}
            <div style={{
              position: 'absolute',
              top: -10, left: '50%',
              transform: 'translateX(-50%) rotate(-3deg)',
              width: 70, height: 18,
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.2)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            }}/>

            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 12,
            }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: '#fff' }}>
                📌 Quizzes guardados
              </div>
              <button onClick={() => setShowHistorial(false)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'rgba(255,255,255,0.5)', fontSize: 18, padding: 0,
                lineHeight: 1,
              }}>×</button>
            </div>

            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 12, fontStyle: 'italic' }}>
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
            </div>
          </div>
        )}

        {/* Botón flotante para reabrir el post-it si está oculto */}
        {historialQuizzes.length > 0 && !showHistorial && (
          <button onClick={() => setShowHistorial(true)} style={{
            position: 'fixed', right: 24, top: 100,
            padding: '10px 14px', borderRadius: 10,
            background: `${themeColor}22`,
            border: `1px solid ${themeColor}55`,
            color: themeColor,
            fontFamily: HAND, fontSize: 14, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}>
            📌 {historialQuizzes.length} quizzes
          </button>
        )}
      </div>"""

if old_close_config in text:
    text = text.replace(old_close_config, new_close_config, 1)
    print("✅ Post-it lateral añadido a config")
else:
    print("❌ No matcheó cierre de config")

path.write_text(text, encoding='utf-8')
print("\n🎉 Listo:")
print("  · Auto-scroll suave al responder")
print("  · Post-it lateral con historial de quizzes guardados")
print("  · Botones de jugar/eliminar en cada quiz del historial")
