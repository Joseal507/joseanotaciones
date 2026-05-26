import pathlib
import re

path = pathlib.Path('components/materias/TemaView.tsx')
text = path.read_text(encoding='utf-8')

# 1) Calcular si hay sesión que coincida con la selección actual
#    Añadir un useMemo antes del return del JSX del botón
#    Buscar un buen anchor: justo antes del botón Estudiar

anchor = """      {/* ═══════════════════════════════════════════════════════ */}
      {/* BOTÓN ESTUDIAR — REDISEÑO ÉPICO                        */}
      {/* ═══════════════════════════════════════════════════════ */}
      {selectedIds.length > 0 && ("""

new_anchor = """      {/* ═══════════════════════════════════════════════════════ */}
      {/* BOTÓN ESTUDIAR — REDISEÑO ÉPICO                        */}
      {/* ═══════════════════════════════════════════════════════ */}
      {(() => {
        // ── Detectar si la selección actual coincide con una sesión guardada ──
        const matchingSession = selectedIds.length > 0
          ? activeSessions.find(s => {
              if (s.materialIds.length !== selectedIds.length) return false;
              const setA = new Set(s.materialIds);
              return selectedIds.every(id => setA.has(id));
            })
          : null;
        const isResumeMode = !!matchingSession;
        return null;
      })()}
      {selectedIds.length > 0 && ("""

if anchor in text:
    text = text.replace(anchor, new_anchor, 1)
    print("⚠️ Anchor reemplazado pero la lógica está rota — vamos por otro approach")
else:
    print("ℹ️ No usaré el anchor, vamos directo al botón")

# Mejor approach: refactor del wrapper entero a IIFE para tener acceso a matchingSession
# Buscar el bloque completo del botón y envolverlo

# Primero revertir si lo dañé
if "// ── Detectar si la selección actual coincide" in text:
    text = text.replace(new_anchor, anchor, 1)
    print("↩️ Revertido el cambio intermedio")

# Approach correcto: cambiar `{selectedIds.length > 0 && (` por una IIFE
old_open = """      {selectedIds.length > 0 && (
  <div style={{
    position: 'fixed', bottom: 32, left: '50%',"""

new_open = """      {selectedIds.length > 0 && (() => {
        // ── Detectar si la selección actual coincide con una sesión guardada ──
        const matchingSession = activeSessions.find(s => {
          if (s.materialIds.length !== selectedIds.length) return false;
          const setA = new Set(s.materialIds);
          return selectedIds.every(id => setA.has(id));
        });
        const isResumeMode = !!matchingSession;
        return (
  <div style={{
    position: 'fixed', bottom: 32, left: '50%',"""

if old_open in text:
    text = text.replace(old_open, new_open, 1)
    print("✅ Wrapper convertido a IIFE para acceso a matchingSession")
else:
    print("❌ No encontré apertura del botón Estudiar")

# Cambiar el texto guía arriba según modo
old_guia = """    {/* Texto guía arriba */}
    <div style={{
      fontFamily: HAND,
      fontSize: 15,
      color: 'var(--red)',
      fontStyle: 'italic',
      opacity: 0.85,
      textShadow: '0 0 8px var(--red)',
      letterSpacing: 0.5,
    }}>
      ↓ dale al play ↓
    </div>"""

new_guia = """    {/* Texto guía arriba */}
    <div style={{
      fontFamily: HAND,
      fontSize: 15,
      color: isResumeMode ? '#f5c842' : 'var(--red)',
      fontStyle: 'italic',
      opacity: 0.85,
      textShadow: isResumeMode ? '0 0 8px #f5c842' : '0 0 8px var(--red)',
      letterSpacing: 0.5,
    }}>
      {isResumeMode ? '↓ continuar donde lo dejaste ↓' : '↓ dale al play ↓'}
    </div>"""

if old_guia in text:
    text = text.replace(old_guia, new_guia, 1)
    print("✅ Texto guía cambia según modo")

# Cambiar el botón Estudiar: onClick + texto + colores según modo
old_button = """    {/* BOTÓN ESTUDIAR */}
    <button
      onClick={() => setShowEnfoque(true)}
      className="study-btn-neon"
      style={{
        position: 'relative',
        background: 'linear-gradient(135deg, rgba(20,20,25,0.95), rgba(40,15,20,0.95))',
        color: '#fff',
        border: '2px solid var(--red)',
        padding: '16px 32px',
        borderRadius: 16,
        fontFamily: HAND,
        fontSize: 28,
        fontWeight: 800,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxShadow: '0 0 0 1px rgba(239,68,68,0.3), 0 0 20px rgba(239,68,68,0.5), 0 0 40px rgba(239,68,68,0.25), inset 0 1px 0 rgba(255,255,255,0.1)',
        transition: 'all 0.3s cubic-bezier(.2,.8,.2,1)',
        whiteSpace: 'nowrap',
        backdropFilter: 'blur(8px)',
      }}
    >
      <span style={{
        fontSize: 26,
        filter: 'drop-shadow(0 0 6px rgba(245,200,66,0.7))',
        animation: 'sparkle 2s ease-in-out infinite',
        display: 'inline-block',
      }}>✨</span>

      <span style={{
        letterSpacing: 0.3,
        textShadow: '0 0 10px rgba(239,68,68,0.6), 0 1px 2px rgba(0,0,0,0.5)',
        background: 'linear-gradient(135deg, #fff, #ffd6d6)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}>empezar a estudiar</span>"""

new_button = """    {/* BOTÓN ESTUDIAR / SEGUIR */}
    <button
      onClick={() => {
        if (isResumeMode && matchingSession) {
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
        }
      }}
      className="study-btn-neon"
      style={{
        position: 'relative',
        background: isResumeMode
          ? 'linear-gradient(135deg, rgba(25,20,15,0.95), rgba(45,35,10,0.95))'
          : 'linear-gradient(135deg, rgba(20,20,25,0.95), rgba(40,15,20,0.95))',
        color: '#fff',
        border: isResumeMode ? '2px solid #f5c842' : '2px solid var(--red)',
        padding: '16px 32px',
        borderRadius: 16,
        fontFamily: HAND,
        fontSize: 28,
        fontWeight: 800,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxShadow: isResumeMode
          ? '0 0 0 1px rgba(245,200,66,0.35), 0 0 20px rgba(245,200,66,0.5), 0 0 40px rgba(245,200,66,0.25), inset 0 1px 0 rgba(255,255,255,0.1)'
          : '0 0 0 1px rgba(239,68,68,0.3), 0 0 20px rgba(239,68,68,0.5), 0 0 40px rgba(239,68,68,0.25), inset 0 1px 0 rgba(255,255,255,0.1)',
        transition: 'all 0.3s cubic-bezier(.2,.8,.2,1)',
        whiteSpace: 'nowrap',
        backdropFilter: 'blur(8px)',
      }}
    >
      <span style={{
        fontSize: 26,
        filter: 'drop-shadow(0 0 6px rgba(245,200,66,0.7))',
        animation: 'sparkle 2s ease-in-out infinite',
        display: 'inline-block',
      }}>{isResumeMode ? '📖' : '✨'}</span>

      <span style={{
        letterSpacing: 0.3,
        textShadow: isResumeMode
          ? '0 0 10px rgba(245,200,66,0.6), 0 1px 2px rgba(0,0,0,0.5)'
          : '0 0 10px rgba(239,68,68,0.6), 0 1px 2px rgba(0,0,0,0.5)',
        background: isResumeMode
          ? 'linear-gradient(135deg, #fff, #fff5d0)'
          : 'linear-gradient(135deg, #fff, #ffd6d6)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}>{isResumeMode ? 'seguir estudiando' : 'empezar a estudiar'}</span>"""

if old_button in text:
    text = text.replace(old_button, new_button, 1)
    print("✅ Botón Estudiar es ahora inteligente (modo continuar)")
else:
    print("❌ No encontré bloque del botón Estudiar")

# El badge "X/5" también debe cambiar color en modo resume
old_badge = """      }}>{selectedIds.length}/5</span>"""
new_badge = """      }}>{isResumeMode ? matchingSession?.enfoque || 'teorico' : `${selectedIds.length}/5`}</span>"""

if old_badge in text:
    text = text.replace(old_badge, new_badge, 1)
    print("✅ Badge cambia a mostrar enfoque en modo resume")

# La flecha también
# (la dejamos igual, solo cambiamos colores del borde)

# Cerrar la IIFE: cambiar el cierre )}  por  );  })()}
# Buscar el cierre del wrapper principal
old_close = """      }}>{selectedIds.length}/5</span>"""
# Ya lo cambiamos arriba. El cierre del wrapper debe pasar de )} a ); })()}

# Buscar el cierre completo del bloque selectedIds.length > 0 && (
# Patrón: </button>\n    </div>\n  </div>\n      )}
# Necesitamos cambiar el último )} por ); })()}

# Buscar específicamente: el patrón de cierre del wrapper IIFE
# Hay un </div></div>)} al final
import re
# Buscamos el cierre que tenemos que modificar
m = re.search(r"(</button>\s*\n\s*</div>\s*\n\s*</div>\s*\n\s*)\)\}", text)
if m:
    text = text[:m.start(0)] + m.group(1) + ");\n      })()}" + text[m.end(0):]
    print("✅ Cierre del IIFE aplicado")
else:
    print("⚠️ Cierre del IIFE no encontrado - puede haber error de sintaxis")
    # Listar cierres similares
    candidates = list(re.finditer(r"</div>\s*\n\s*\)\}", text))
    print(f"   Candidatos cercanos: {len(candidates)}")

path.write_text(text, encoding='utf-8')
