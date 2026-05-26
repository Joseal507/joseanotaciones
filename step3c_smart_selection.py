import pathlib
import re

path = pathlib.Path('components/materias/TemaView.tsx')
text = path.read_text(encoding='utf-8')

# ─────────────────────────────────────────────────────────
# 1) Encontrar la lógica actual de toggle de selección
# ─────────────────────────────────────────────────────────
# Buscar setSelectedIds(prev => ... en línea 865
print("=== Buscando lógica de toggle actual ===")
matches = list(re.finditer(r"setSelectedIds\(prev\s*=>", text))
for m in matches:
    line = text[:m.start()].count('\n') + 1
    print(f"  Línea {line}")

# ─────────────────────────────────────────────────────────
# 2) Reemplazar el toggle simple por uno inteligente con sesiones
# ─────────────────────────────────────────────────────────
old_toggle = """      setSelectedIds(prev =>
        prev.includes(d.id) ? prev.filter(x => x !== d.id) : [...prev, d.id]
      );"""

new_toggle = """      // ── Toggle inteligente con sesiones ──
      const matId = d.id;
      const matSessions = activeSessions.filter(s => s.materialIds.includes(matId));
      const clickedSession = matSessions[0] || null;

      setSelectedIds(prev => {
        // ¿La selección actual coincide con alguna sesión completa?
        const currentMatchesSession = activeSessions.find(s => {
          if (s.materialIds.length !== prev.length) return false;
          const setA = new Set(s.materialIds);
          return prev.every(id => setA.has(id));
        });

        // CASO A: el material clickeado pertenece a una sesión
        if (clickedSession) {
          const sessionIds = clickedSession.materialIds;
          const isFullSessionSelected = sessionIds.length === prev.length
            && sessionIds.every(id => prev.includes(id));

          if (isFullSessionSelected) {
            // Toggle OFF: la sesión completa ya estaba seleccionada → deseleccionar todo
            return [];
          }
          // Cambiar a esta sesión (limpia selección previa)
          return [...sessionIds];
        }

        // CASO B: el material clickeado NO pertenece a ninguna sesión
        // Si actualmente hay una sesión completa seleccionada → reemplazar por solo este
        if (currentMatchesSession) {
          return [matId];
        }

        // CASO C: selección libre normal (toggle clásico)
        return prev.includes(matId)
          ? prev.filter(x => x !== matId)
          : [...prev, matId];
      });"""

if old_toggle in text:
    text = text.replace(old_toggle, new_toggle, 1)
    print("✅ Toggle inteligente con sesiones aplicado")
else:
    print("❌ No encontré el toggle simple. Buscando variantes...")
    # Buscar variante por línea 865 aprox
    m = re.search(r"setSelectedIds\(prev\s*=>\s*\n?\s*prev\.includes\([^)]+\)\s*\?\s*prev\.filter\([^)]+\)\s*:\s*\[\.\.\.prev,\s*[^\]]+\]\s*\);", text)
    if m:
        print(f"   Variante encontrada en línea {text[:m.start()].count(chr(10)) + 1}")
        print(f"   Texto: {m.group(0)[:120]}")
    else:
        print("   No encontré ninguna variante")

# ─────────────────────────────────────────────────────────
# 3) Botón "Estudiar" inteligente: si coincide con sesión → ir directo
# ─────────────────────────────────────────────────────────
# El botón Estudiar abre el EnfoqueWheel. Necesitamos saber si la selección actual
# coincide con una sesión guardada para saltar directo al enfoque.
# Buscar dónde se renderiza el EnfoqueWheel
print("\n=== Buscando EnfoqueWheel ===")
ew_match = re.search(r"<EnfoqueWheel[^/]*", text)
if ew_match:
    print(f"   EnfoqueWheel en línea {text[:ew_match.start()].count(chr(10)) + 1}")
    # Mostrar contexto
    start = max(0, ew_match.start() - 200)
    end = min(len(text), ew_match.end() + 400)
    print("   CONTEXTO:")
    print("   " + text[start:end].replace('\n', '\n   '))

path.write_text(text, encoding='utf-8')
