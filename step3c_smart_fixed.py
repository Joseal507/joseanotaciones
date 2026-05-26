import pathlib
import re

path = pathlib.Path('components/materias/TemaView.tsx')
text = path.read_text(encoding='utf-8')

# ─────────────────────────────────────────────────────────
# 1) Reemplazar el toggle simple por el inteligente
# ─────────────────────────────────────────────────────────
old_toggle = """    if (n.type === 'doc') {
      setSelectedIds(prev =>
        prev.includes(n.data.id)
          ? prev.filter(x => x !== n.data.id)
          : prev.length < 5 ? [...prev, n.data.id] : prev
      );
    }"""

new_toggle = """    if (n.type === 'doc') {
      // ── Toggle inteligente con sesiones ──
      const matId = n.data.id;
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
          return [...sessionIds].slice(0, 5);
        }

        // CASO B: el material clickeado NO pertenece a ninguna sesión
        // Si actualmente hay una sesión completa seleccionada → reemplazar por solo este
        if (currentMatchesSession) {
          return [matId];
        }

        // CASO C: selección libre normal (toggle clásico con límite 5)
        return prev.includes(matId)
          ? prev.filter(x => x !== matId)
          : prev.length < 5 ? [...prev, matId] : prev;
      });
    }"""

if old_toggle in text:
    text = text.replace(old_toggle, new_toggle, 1)
    print("✅ Toggle inteligente con sesiones aplicado")
else:
    print("❌ No encontré el toggle simple")

# ─────────────────────────────────────────────────────────
# 2) Salto directo al enfoque desde EnfoqueWheel si coincide con sesión
# ─────────────────────────────────────────────────────────
old_enfoque_select = """              onSelect={(id: string) => {
               if (id === 'teorico' || id === 'matematico' || id === 'mixto') {
                 setEnfoqueElegido(id as any);
                 setShowEnfoque(false);
                 setShowSeleccion(true);
               } else {
                 setShowEnfoque(false);
               }
             }}"""

new_enfoque_select = """              onSelect={(id: string) => {
               if (id === 'teorico' || id === 'matematico' || id === 'mixto') {
                 const enfoqueId = id as any;
                 // ── Buscar sesión existente que coincida con selección actual + enfoque ──
                 const matchingSession = activeSessions.find(s => {
                   if (s.enfoque !== enfoqueId) return false;
                   if (s.materialIds.length !== selectedIds.length) return false;
                   const setA = new Set(s.materialIds);
                   return selectedIds.every(matId => setA.has(matId));
                 });

                 if (matchingSession && matchingSession.selectedPages) {
                   // ── Salto directo al enfoque con páginas guardadas ──
                   setEnfoqueElegido(enfoqueId);
                   const rebuilt = matchingSession.materialIds.map((matId: string, idx: number) => ({
                     materialId: matId,
                     materialIndex: idx,
                     pages: matchingSession.selectedPages![matId] || [],
                   }));
                   setSeleccionResult(rebuilt as any);
                   setShowEnfoque(false);
                   setOpenTeorico(true);
                   console.log('🚀 Salto directo a sesión existente:', matchingSession.id);
                 } else {
                   // Flujo normal
                   setEnfoqueElegido(enfoqueId);
                   setShowEnfoque(false);
                   setShowSeleccion(true);
                 }
               } else {
                 setShowEnfoque(false);
               }
             }}"""

if old_enfoque_select in text:
    text = text.replace(old_enfoque_select, new_enfoque_select, 1)
    print("✅ Salto directo al enfoque aplicado en EnfoqueWheel")
else:
    print("❌ No encontré onSelect de EnfoqueWheel - intentando match flexible")
    # Match flexible con normalización de espacios
    m = re.search(
        r"onSelect=\{\(id:\s*string\)\s*=>\s*\{\s*if\s*\(id\s*===\s*'teorico'.*?else\s*\{\s*setShowEnfoque\(false\);\s*\}\s*\}\}",
        text, re.DOTALL
    )
    if m:
        print(f"   Encontrado en línea {text[:m.start()].count(chr(10)) + 1}")
        # Reemplazar con regex
        text = text[:m.start()] + new_enfoque_select.strip() + text[m.end():]
        print("✅ Reemplazado vía regex")
    else:
        print("   No match")

path.write_text(text, encoding='utf-8')
print("\n🎉 Listo. Reinicia con npm run dev y prueba el flujo completo.")
