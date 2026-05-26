import pathlib

path = pathlib.Path('components/materias/TemaView.tsx')
text = path.read_text(encoding='utf-8')

# Modificar el bloque que crea los nodos doc para añadir hasSession + sessionInfo
old = """        tema.documentos.forEach((d: any, i: number) => {
          const t = n === 1 ? 0.5 : i / (n - 1);
          const angleDeg = startAngle + t * arcSpread;
          const angle = angleDeg * (Math.PI / 180);
          const sel = selectedIds.includes(d.id);
          list.push({
            id: `d-${d.id}`,
            x: subirRama.x + Math.cos(angle) * dist,
            y: subirRama.y + Math.sin(angle) * dist,
            emoji: getDocEmoji(d),
            label: d.nombre,
            color: materialColor,
            size: 95,
            type: 'doc',
            data: d,
            selected: sel,
          });
        });"""

new = """        tema.documentos.forEach((d: any, i: number) => {
          const t = n === 1 ? 0.5 : i / (n - 1);
          const angleDeg = startAngle + t * arcSpread;
          const angle = angleDeg * (Math.PI / 180);
          const sel = selectedIds.includes(d.id);
          // ── Buscar sesiones activas para este material ──
          const matSessions = activeSessions.filter(s => s.materialIds.includes(d.id));
          list.push({
            id: `d-${d.id}`,
            x: subirRama.x + Math.cos(angle) * dist,
            y: subirRama.y + Math.sin(angle) * dist,
            emoji: getDocEmoji(d),
            label: d.nombre,
            color: materialColor,
            size: 95,
            type: 'doc',
            data: d,
            selected: sel,
            hasSession: matSessions.length > 0,
            sessions: matSessions,
          });
        });"""

if old in text:
    text = text.replace(old, new, 1)
    print("✅ Nodos doc ahora incluyen info de sesiones activas")
else:
    print("❌ No encontré bloque de creación de nodos doc")

# Añadir activeSessions a las deps del useMemo (línea 763)
old_deps = "}, [tema, expanded, selectedIds, themeColor]);"
new_deps = "}, [tema, expanded, selectedIds, themeColor, activeSessions]);"

if old_deps in text:
    text = text.replace(old_deps, new_deps, 1)
    print("✅ activeSessions añadido a las deps del useMemo de nodos")
else:
    print("⚠️ No encontré deps del useMemo de nodos")

path.write_text(text, encoding='utf-8')
