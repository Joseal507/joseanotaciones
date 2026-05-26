import pathlib

path = pathlib.Path('components/materias/TemaView.tsx')
text = path.read_text(encoding='utf-8')

# Buscar el wrapper del botón Estudiar y envolverlo en un row con el nuevo botón Eliminar
old = """      {selectedIds.length > 0 && (
  <div style={{
    position: 'fixed', bottom: 32, left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1000,
    animation: 'studyBtnIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 8,
  }}>
    {/* Texto guía arriba */}
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
    </div>

    <button
      onClick={() => setShowEnfoque(true)}"""

new = """      {selectedIds.length > 0 && (
  <div style={{
    position: 'fixed', bottom: 32, left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1000,
    animation: 'studyBtnIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 8,
  }}>
    {/* Texto guía arriba */}
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
    </div>

    {/* Row: Eliminar + Estudiar */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>

    {/* BOTÓN ELIMINAR */}
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
      }}
      title={selectedIds.length === 1 ? 'Eliminar material' : `Eliminar ${selectedIds.length} materiales`}
      style={{
        position: 'relative',
        background: 'linear-gradient(135deg, rgba(20,20,25,0.95), rgba(40,15,15,0.95))',
        color: '#fff',
        border: '2px solid rgba(255,68,68,0.6)',
        padding: '14px 18px',
        borderRadius: 16,
        fontFamily: HAND,
        fontSize: 22,
        fontWeight: 800,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: '0 0 0 1px rgba(255,68,68,0.2), 0 0 16px rgba(255,68,68,0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
        transition: 'all 0.3s cubic-bezier(.2,.8,.2,1)',
        whiteSpace: 'nowrap',
        backdropFilter: 'blur(8px)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 0 0 1px rgba(255,68,68,0.5), 0 0 24px rgba(255,68,68,0.6), inset 0 1px 0 rgba(255,255,255,0.08)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 0 0 1px rgba(255,68,68,0.2), 0 0 16px rgba(255,68,68,0.35), inset 0 1px 0 rgba(255,255,255,0.08)';
      }}
    >
      <span style={{ fontSize: 22 }}>🗑️</span>
      <span style={{
        color: '#ff8888',
        textShadow: '0 0 8px rgba(255,68,68,0.5)',
      }}>eliminar</span>
    </button>

    {/* BOTÓN ESTUDIAR */}
    <button
      onClick={() => setShowEnfoque(true)}"""

if old in text:
    text = text.replace(old, new, 1)
    print("✅ Botón Eliminar añadido a la izquierda del botón Estudiar")
else:
    print("❌ No encontré bloque del botón Estudiar")

# Cerrar el div extra del row después del cierre del botón Estudiar
# Buscar el cierre del botón Estudiar (suele terminar con </button>\n  </div>\n)
# Necesitamos cerrar el row antes del cierre del div principal
old_close = """      }}>{selectedIds.length}/5</span>

      <span style={{
        fontSize: 22,
        color: 'var(--red)',
        filter: 'drop-shadow(0 0 6px var(--red))',
        animation: 'arrowSlide 1.5s ease-in-out infinite',
        display: 'inline-block',"""

# No tocamos el cierre — solo necesitamos cerrar el row </div> antes del cierre del wrapper principal
# Buscar el patrón "</button>\n  </div>\n      )}" que cierra todo
import re
# Encontrar el cierre completo del bloque
# Justo después del botón Estudiar termina </button>, luego cierra el wrapper </div>) y luego )}
m = re.search(r"(</span>\s*</button>)(\s*</div>\s*\)\})", text)
if m:
    # Añadir el cierre del row antes de cerrar el wrapper
    text = text[:m.end(1)] + "\n    </div>" + text[m.end(1):]
    print("✅ Cierre del row añadido")
else:
    print("⚠️ No encontré cierre del wrapper - revisa manualmente")

path.write_text(text, encoding='utf-8')
