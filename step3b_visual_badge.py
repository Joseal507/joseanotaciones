import pathlib

path = pathlib.Path('components/materias/TemaView.tsx')
text = path.read_text(encoding='utf-8')

# 1) Cambiar la sombra del nodo para incluir glow dorado si hasSession
old_shadow = """            // Sombra común
            const baseShadow = n.selected
              ? `0 0 0 3px ${pal.ink}, 0 14px 32px ${pal.shadow}, 0 6px 12px rgba(0,0,0,0.5)`
              : isH
                ? `0 18px 38px rgba(0,0,0,0.55), 0 8px 16px ${pal.shadow}`
                : `0 8px 20px rgba(0,0,0,0.5), 0 3px 6px rgba(0,0,0,0.3)`;"""

new_shadow = """            // Sombra común (con glow dorado si tiene sesión activa)
            const goldGlow = n.hasSession
              ? `0 0 0 2.5px #f5c842, 0 0 24px rgba(245,200,66,0.55), 0 0 48px rgba(245,200,66,0.25),`
              : '';
            const baseShadow = n.selected
              ? `${goldGlow} 0 0 0 3px ${pal.ink}, 0 14px 32px ${pal.shadow}, 0 6px 12px rgba(0,0,0,0.5)`
              : isH
                ? `${goldGlow} 0 18px 38px rgba(0,0,0,0.55), 0 8px 16px ${pal.shadow}`
                : `${goldGlow} 0 8px 20px rgba(0,0,0,0.5), 0 3px 6px rgba(0,0,0,0.3)`;"""

if old_shadow in text:
    text = text.replace(old_shadow, new_shadow, 1)
    print("✅ Glow dorado aplicado a materiales con sesión")
else:
    print("❌ No encontré bloque de baseShadow")

# 2) Modificar handleNodeClick para que materiales con sesión vayan directo al enfoque
old_click = """  const handleNodeClick = (n: any) => {
    if (n.id === 'cuaderno' || n.id === 'material') {
      setExpanded(prev => prev.includes(n.id) ? prev.filter(x => x !== n.id) : [...prev, n.id]);
      return;
    }
    if (n.disabled) return;
    if (n.action) { n.action(); return; }
    if (n.type === 'apunte') { onAbrirApunte(n.data); return; }
    if (n.type === 'doc') {"""

new_click = """  const handleNodeClick = (n: any) => {
    if (n.id === 'cuaderno' || n.id === 'material') {
      setExpanded(prev => prev.includes(n.id) ? prev.filter(x => x !== n.id) : [...prev, n.id]);
      return;
    }
    if (n.disabled) return;
    if (n.action) { n.action(); return; }
    if (n.type === 'apunte') { onAbrirApunte(n.data); return; }
    if (n.type === 'doc') {
      // ── Si tiene sesión activa, restaurarla y abrirla directamente ──
      if (n.hasSession && n.sessions && n.sessions.length > 0) {
        // Tomar la sesión más reciente (ya vienen ordenadas)
        const sess = n.sessions[0];
        // Marcar todos los materiales de esa sesión como seleccionados
        setSelectedIds(sess.materialIds);
        setEnfoqueElegido(sess.enfoque);
        // Reconstruir seleccionResult con las páginas guardadas
        if (sess.selectedPages) {
          const rebuilt = sess.materialIds.map((matId: string, idx: number) => ({
            materialId: matId,
            materialIndex: idx,
            pages: sess.selectedPages[matId] || [],
          }));
          setSeleccionResult(rebuilt as any);
        }
        // Abrir el enfoque directamente
        setOpenTeorico(true);
        return;
      }"""

if old_click in text:
    text = text.replace(old_click, new_click, 1)
    print("✅ Click en material con sesión → abre enfoque directamente")
else:
    print("❌ No encontré handleNodeClick")

path.write_text(text, encoding='utf-8')
