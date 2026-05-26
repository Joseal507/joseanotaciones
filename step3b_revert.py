import pathlib

path = pathlib.Path('components/materias/TemaView.tsx')
text = path.read_text(encoding='utf-8')

# Revertir el handleNodeClick al original
old_click = """  const handleNodeClick = (n: any) => {
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

new_click = """  const handleNodeClick = (n: any) => {
    if (n.id === 'cuaderno' || n.id === 'material') {
      setExpanded(prev => prev.includes(n.id) ? prev.filter(x => x !== n.id) : [...prev, n.id]);
      return;
    }
    if (n.disabled) return;
    if (n.action) { n.action(); return; }
    if (n.type === 'apunte') { onAbrirApunte(n.data); return; }
    if (n.type === 'doc') {"""

if old_click in text:
    text = text.replace(old_click, new_click, 1)
    print("✅ handleNodeClick revertido al original")
else:
    print("⚠️ No encontré el handler modificado (puede que ya esté limpio)")

path.write_text(text, encoding='utf-8')
