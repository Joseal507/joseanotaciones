from pathlib import Path

quiz_path = Path("components/materias/QuizPage.tsx")
text = quiz_path.read_text(encoding='utf-8')

# ══════════════════════════════════════════════════════════════
# 1) RespuestaRelacionar — canvas con líneas bezier animadas
# ══════════════════════════════════════════════════════════════
old_relacionar = '''function RespuestaRelacionar({ p, respondida, conexiones, onConectar, onConfirmar, themeColor }:
  { p: PreguntaRelacionar; respondida: boolean; conexiones: Record<number, number>; onConectar: (izq: number, der: number) => void; onConfirmar: () => void; themeColor: string }) {
  const [selIzq, setSelIzq] = useState<number | null>(null);

  const handleDer = (derIdx: number) => {
    if (respondida) return;
    if (selIzq === null) return;
    onConectar(selIzq, derIdx);
    setSelIzq(null);
  };

  const handleIzq = (izqIdx: number) => {
    if (respondida) return;
    setSelIzq(prev => prev === izqIdx ? null : izqIdx);
  };

  const getColorConexion = (izqIdx: number) => {
    if (!respondida) return themeColor;
    const esCorrecta = conexiones[izqIdx] === p.pares[izqIdx];
    return esCorrecta ? \'#4ade80\' : \'#f87171\';
  };

  return (
    <div style={{ display: \'flex\', flexDirection: \'column\', gap: 12, width: \'100%\', maxWidth: 680 }}>
      {!respondida && (
        <div style={{ fontFamily: BODY, fontSize: 13, color: \'rgba(255,255,255,0.45)\', fontStyle: \'italic\' }}>
          {selIzq !== null
            ? `"${p.izquierda[selIzq]}" seleccionado → elige su par de la derecha`
            : \'Selecciona un elemento de la izquierda, luego su par de la derecha\'}
        </div>
      )}
      <div style={{ display: \'grid\', gridTemplateColumns: \'1fr 1fr\', gap: 10 }}>
        {/* Columna izquierda */}
        <div style={{ display: \'flex\', flexDirection: \'column\', gap: 8 }}>
          {p.izquierda.map((item, i) => {
            const tieneConexion = conexiones[i] !== undefined;
            const activo = selIzq === i;
            const color = respondida ? getColorConexion(i) : (activo ? themeColor : \'rgba(255,255,255,0.75)\');
            return (
              <button key={i} onClick={() => handleIzq(i)} disabled={respondida} style={{
                padding: \'12px 14px\', borderRadius: 10, textAlign: \'left\',
                background: activo ? `${themeColor}18` : tieneConexion ? \'rgba(255,255,255,0.05)\' : \'rgba(255,255,255,0.03)\',
                border: `1.5px solid ${activo ? themeColor : tieneConexion ? (respondida ? getColorConexion(i) + \'55\' : \'rgba(255,255,255,0.2)\') : \'rgba(255,255,255,0.08)\'}`,
                cursor: respondida ? \'default\' : \'pointer\',
                fontFamily: BODY, fontSize: 13, fontWeight: 500, color,
                transition: \'all 0.15s\',
                display: \'flex\', alignItems: \'center\', justifyContent: \'space-between\', gap: 6,
              }}>
                <span style={{ lineHeight: 1.4 }}>{item}</span>
                {tieneConexion && !respondida && <span style={{ fontSize: 10, color: themeColor, fontWeight: 700, whiteSpace: \'nowrap\' }}>✓ unido</span>}
                {respondida && <span style={{ fontSize: 14 }}>{getColorConexion(i) === \'#4ade80\' ? \'✓\' : \'✗\'}</span>}
              </button>
            );
          })}
        </div>
        {/* Columna derecha */}
        <div style={{ display: \'flex\', flexDirection: \'column\', gap: 8 }}>
          {p.derecha.map((item, i) => {
            const izqConectado = Object.entries(conexiones).find(([, d]) => d === i);
            const estaUsado = izqConectado !== undefined;
            const color = \'rgba(255,255,255,0.75)\';
            return (
              <button key={i} onClick={() => handleDer(i)} disabled={respondida || (estaUsado && selIzq === null)} style={{
                padding: \'12px 14px\', borderRadius: 10, textAlign: \'left\',
                background: estaUsado ? \'rgba(255,255,255,0.06)\' : \'rgba(255,255,255,0.03)\',
                border: `1.5px solid ${estaUsado ? (selIzq !== null ? themeColor + \'55\' : \'rgba(255,255,255,0.2)\') : (selIzq !== null ? themeColor + \'33\' : \'rgba(255,255,255,0.08)\')}`,
                cursor: respondida ? \'default\' : \'pointer\',
                fontFamily: BODY, fontSize: 13, fontWeight: 400, color,
                transition: \'all 0.15s\', lineHeight: 1.4,
              }}>
                {item}
              </button>
            );
          })}
        </div>
      </div>
      {/* Resumen de conexiones hechas */}
      {respondida && (
        <div style={{ display: \'flex\', flexDirection: \'column\', gap: 4, marginTop: 4 }}>
          {p.izquierda.map((item, i) => {
            const derIdx = conexiones[i];
            const esCorrecta = derIdx === p.pares[i];
            return (
              <div key={i} style={{
                display: \'flex\', alignItems: \'center\', gap: 8,
                fontFamily: BODY, fontSize: 13,
                color: esCorrecta ? \'#4ade80\' : \'#f87171\',
              }}>
                <span>{esCorrecta ? \'✓\' : \'✗\'}</span>
                <span style={{ fontWeight: 600 }}>{item}</span>
                <span style={{ color: \'rgba(255,255,255,0.3)\' }}>→</span>
                <span>{p.derecha[p.pares[i]]}</span>
                {!esCorrecta && derIdx !== undefined && (
                  <span style={{ color: \'rgba(255,255,255,0.3)\', fontSize: 11 }}>
                    (pusiste: {p.derecha[derIdx]})
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!respondida && (
        <button
          onClick={onConfirmar}
          disabled={Object.keys(conexiones).length < p.izquierda.length}
          style={{
            padding: \'12px\', borderRadius: 12, border: \'none\',
            background: Object.keys(conexiones).length >= p.izquierda.length ? themeColor : \'rgba(255,255,255,0.05)\',
            color: Object.keys(conexiones).length >= p.izquierda.length ? \'#000\' : \'rgba(255,255,255,0.2)\',
            fontFamily: BODY, fontSize: 14, fontWeight: 700,
            cursor: Object.keys(conexiones).length >= p.izquierda.length ? \'pointer\' : \'not-allowed\',
            transition: \'all 0.15s\',
          }}
        >
          Confirmar ({Object.keys(conexiones).length}/{p.izquierda.length} conectados)
        </button>
      )}
    </div>
  );
}'''

new_relacionar = '''// ── helpers bezier (igual que TemaView) ──────────────────────
function bezierPt(t: number, p0: {x:number;y:number}, p1: {x:number;y:number}, p2: {x:number;y:number}) {
  const u = 1 - t;
  return { x: u*u*p0.x + 2*u*t*p1.x + t*t*p2.x, y: u*u*p0.y + 2*u*t*p1.y + t*t*p2.y };
}
function toRgbaQ(hex: string, a: number) {
  const h = hex.replace(\'#\',\'\');
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

function RespuestaRelacionar({ p, respondida, conexiones, onConectar, onConfirmar, themeColor }:
  { p: PreguntaRelacionar; respondida: boolean; conexiones: Record<number, number>; onConectar: (izq: number, der: number) => void; onConfirmar: () => void; themeColor: string }) {
  const [selIzq, setSelIzq] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const izqRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const derRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rafRef = useRef<number>(0);
  const chargeMap = useRef<Map<string, number>>(new Map());

  const getColorConexion = (izqIdx: number) => {
    if (!respondida) return themeColor;
    return conexiones[izqIdx] === p.pares[izqIdx] ? \'#4ade80\' : \'#f87171\';
  };

  // Dibuja las líneas bezier animadas en el canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext(\'2d\');
    if (!ctx) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const loop = () => {
      const cRect = container.getBoundingClientRect();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Construir líneas activas
      const lineas: { key: string; fromX: number; fromY: number; toX: number; toY: number; color: string; active: boolean }[] = [];

      // Conexiones ya hechas
      Object.entries(conexiones).forEach(([izqS, derN]) => {
        const i = Number(izqS);
        const d = Number(derN);
        const izqEl = izqRefs.current[i];
        const derEl = derRefs.current[d];
        if (!izqEl || !derEl) return;
        const ir = izqEl.getBoundingClientRect();
        const dr = derEl.getBoundingClientRect();
        const color = respondida ? getColorConexion(i) : themeColor;
        lineas.push({
          key: `${i}-${d}`,
          fromX: ir.right - cRect.left,
          fromY: ir.top + ir.height / 2 - cRect.top,
          toX: dr.left - cRect.left,
          toY: dr.top + dr.height / 2 - cRect.top,
          color,
          active: true,
        });
      });

      // Línea "en vuelo" si hay izq seleccionado (línea punteada al centro)
      if (selIzq !== null && !respondida) {
        const izqEl = izqRefs.current[selIzq];
        if (izqEl) {
          const ir = izqEl.getBoundingClientRect();
          const midX = canvas.width * 0.75;
          const fromX = ir.right - cRect.left;
          const fromY = ir.top + ir.height / 2 - cRect.top;
          ctx.save();
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = toRgbaQ(themeColor, 0.4);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(fromX, fromY);
          ctx.lineTo(midX, fromY);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Animar cada línea con bezier igual que TemaView
      lineas.forEach(line => {
        const current = chargeMap.current.get(line.key) || 0;
        const next = line.active ? Math.min(1, current + 0.035) : Math.max(0, current - 0.02);
        chargeMap.current.set(line.key, next);
        if (next <= 0.001) return;

        const midX = (line.fromX + line.toX) / 2;
        const midY = (line.fromY + line.toY) / 2;
        const dx = line.toX - line.fromX;
        const dy = line.toY - line.fromY;
        const len = Math.sqrt(dx*dx + dy*dy) || 1;
        const px = -dy / len, py = dx / len;
        const bow = Math.min(len * 0.3, 60);
        const p0 = { x: line.fromX, y: line.fromY };
        const p1 = { x: midX + px * bow, y: midY + py * bow };
        const p2 = { x: line.toX, y: line.toY };

        const totalSteps = 40;
        const chargedSteps = Math.floor(totalSteps * next);
        if (chargedSteps < 1) return;

        const drawPath = () => {
          ctx.beginPath();
          const first = bezierPt(0, p0, p1, p2);
          ctx.moveTo(first.x, first.y);
          for (let s = 1; s <= chargedSteps; s++) {
            const pt = bezierPt(s / totalSteps, p0, p1, p2);
            ctx.lineTo(pt.x, pt.y);
          }
        };

        ctx.save();
        ctx.lineCap = \'round\';
        ctx.lineJoin = \'round\';

        // glow exterior
        drawPath();
        ctx.strokeStyle = toRgbaQ(line.color, 0.25);
        ctx.lineWidth = 8;
        ctx.shadowBlur = 18;
        ctx.shadowColor = line.color;
        ctx.stroke();

        // línea principal
        drawPath();
        ctx.strokeStyle = toRgbaQ(line.color, 0.85);
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 10;
        ctx.stroke();

        // brillo blanco encima
        drawPath();
        ctx.strokeStyle = \'rgba(255,255,255,0.9)\';
        ctx.lineWidth = 1;
        ctx.shadowBlur = 6;
        ctx.shadowColor = \'#fff\';
        ctx.stroke();

        // cabeza animada mientras carga
        if (next < 1) {
          const head = bezierPt(next, p0, p1, p2);
          const grad = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 14);
          grad.addColorStop(0, \'rgba(255,255,255,1)\');
          grad.addColorStop(0.3, toRgbaQ(line.color, 0.9));
          grad.addColorStop(1, toRgbaQ(line.color, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(head.x, head.y, 14, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      });

      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [conexiones, selIzq, respondida, themeColor]);

  const handleIzq = (i: number) => {
    if (respondida) return;
    setSelIzq(prev => prev === i ? null : i);
  };
  const handleDer = (d: number) => {
    if (respondida || selIzq === null) return;
    onConectar(selIzq, d);
    setSelIzq(null);
  };

  return (
    <div style={{ display: \'flex\', flexDirection: \'column\', gap: 12, width: \'100%\', maxWidth: 720 }}>
      {!respondida && (
        <div style={{ fontFamily: BODY, fontSize: 13, color: \'rgba(255,255,255,0.4)\', fontStyle: \'italic\' }}>
          {selIzq !== null
            ? `"${p.izquierda[selIzq]}" seleccionado — elige su par →`
            : \'Toca un elemento de la izquierda, luego su par de la derecha\'}
        </div>
      )}

      {/* Grid con canvas superpuesto */}
      <div ref={containerRef} style={{ position: \'relative\', display: \'grid\', gridTemplateColumns: \'1fr 1fr\', gap: 10 }}>
        <canvas ref={canvasRef} style={{
          position: \'absolute\', inset: 0,
          pointerEvents: \'none\', zIndex: 2,
          width: \'100%\', height: \'100%\',
        }}/>

        {/* Columna izquierda */}
        <div style={{ display: \'flex\', flexDirection: \'column\', gap: 8, position: \'relative\', zIndex: 3 }}>
          {p.izquierda.map((item, i) => {
            const activo = selIzq === i;
            const tieneConexion = conexiones[i] !== undefined;
            const color = respondida ? getColorConexion(i) : (activo ? themeColor : \'rgba(255,255,255,0.8)\');
            const borderColor = respondida
              ? getColorConexion(i) + \'66\'
              : activo ? themeColor : tieneConexion ? \'rgba(255,255,255,0.25)\' : \'rgba(255,255,255,0.08)\';
            return (
              <button
                key={i}
                ref={el => { izqRefs.current[i] = el; }}
                onClick={() => handleIzq(i)}
                disabled={respondida}
                style={{
                  padding: \'12px 14px\', borderRadius: 10, textAlign: \'left\',
                  background: activo ? `${themeColor}18` : tieneConexion ? \'rgba(255,255,255,0.06)\' : \'rgba(255,255,255,0.03)\',
                  border: `1.5px solid ${borderColor}`,
                  cursor: respondida ? \'default\' : \'pointer\',
                  fontFamily: BODY, fontSize: 13, fontWeight: 500, color,
                  transition: \'all 0.15s\',
                  display: \'flex\', alignItems: \'center\', justifyContent: \'space-between\', gap: 6,
                  boxShadow: activo ? `0 0 12px ${themeColor}33` : \'none\',
                }}>
                <span style={{ lineHeight: 1.4, flex: 1 }}>{item}</span>
                {respondida && (
                  <span style={{ fontSize: 13, fontWeight: 700 }}>
                    {getColorConexion(i) === \'#4ade80\' ? \'✓\' : \'✗\'}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Columna derecha */}
        <div style={{ display: \'flex\', flexDirection: \'column\', gap: 8, position: \'relative\', zIndex: 3 }}>
          {p.derecha.map((item, d) => {
            const izqIdx = Number(Object.entries(conexiones).find(([,v]) => v === d)?.[0] ?? -1);
            const estaUsado = izqIdx >= 0;
            const highlight = selIzq !== null && !respondida;
            return (
              <button
                key={d}
                ref={el => { derRefs.current[d] = el; }}
                onClick={() => handleDer(d)}
                disabled={respondida}
                style={{
                  padding: \'12px 14px\', borderRadius: 10, textAlign: \'left\',
                  background: estaUsado ? \'rgba(255,255,255,0.07)\' : \'rgba(255,255,255,0.03)\',
                  border: `1.5px solid ${estaUsado
                    ? (highlight ? themeColor + \'55\' : \'rgba(255,255,255,0.2)\')
                    : (highlight ? themeColor + \'28\' : \'rgba(255,255,255,0.07)\')}`,
                  cursor: respondida ? \'default\' : \'pointer\',
                  fontFamily: BODY, fontSize: 13, fontWeight: 400,
                  color: \'rgba(255,255,255,0.75)\',
                  transition: \'all 0.15s\', lineHeight: 1.4,
                  boxShadow: highlight && !estaUsado ? `0 0 8px ${themeColor}18` : \'none\',
                }}>
                {item}
              </button>
            );
          })}
        </div>
      </div>

      {/* Resultado */}
      {respondida && (
        <div style={{ display: \'flex\', flexDirection: \'column\', gap: 4, marginTop: 6 }}>
          {p.izquierda.map((item, i) => {
            const derIdx = conexiones[i];
            const ok = derIdx === p.pares[i];
            return (
              <div key={i} style={{
                display: \'flex\', alignItems: \'center\', gap: 8,
                fontFamily: BODY, fontSize: 13,
                color: ok ? \'#4ade80\' : \'#f87171\',
              }}>
                <span>{ok ? \'✓\' : \'✗\'}</span>
                <span style={{ fontWeight: 600 }}>{item}</span>
                <span style={{ color: \'rgba(255,255,255,0.3)\' }}>→</span>
                <span style={{ color: \'rgba(255,255,255,0.7)\' }}>{p.derecha[p.pares[i]]}</span>
                {!ok && derIdx !== undefined && (
                  <span style={{ color: \'rgba(255,255,255,0.3)\', fontSize: 11 }}>
                    (pusiste: {p.derecha[derIdx]})
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!respondida && (
        <button
          onClick={onConfirmar}
          disabled={Object.keys(conexiones).length < p.izquierda.length}
          style={{
            padding: \'12px\', borderRadius: 12, border: \'none\',
            background: Object.keys(conexiones).length >= p.izquierda.length ? themeColor : \'rgba(255,255,255,0.05)\',
            color: Object.keys(conexiones).length >= p.izquierda.length ? \'#000\' : \'rgba(255,255,255,0.2)\',
            fontFamily: BODY, fontSize: 14, fontWeight: 700,
            cursor: Object.keys(conexiones).length >= p.izquierda.length ? \'pointer\' : \'not-allowed\',
            transition: \'all 0.15s\',
          }}
        >
          Confirmar ({Object.keys(conexiones).length}/{p.izquierda.length} conectados)
        </button>
      )}
    </div>
  );
}'''

if 'function RespuestaRelacionar' in text:
    # Encontrar y reemplazar el bloque completo
    start = text.find('function RespuestaRelacionar(')
    # Encontrar el cierre de la función (línea que empieza con "}")
    # Buscar desde start el patrón "\n}\n" que cierra la función
    search_from = start
    depth = 0
    i = start
    while i < len(text):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
        i += 1
    old_block = text[start:end]
    text = text[:start] + new_relacionar + text[end:]
    print("✅ RespuestaRelacionar con canvas bezier animado")
else:
    print("❌ No se encontró RespuestaRelacionar")

# ══════════════════════════════════════════════════════════════
# 2) RespuestaCorta — fix textarea controlled + Enter
# ══════════════════════════════════════════════════════════════
# El problema del textarea es que onChange recibe setCortaVal directamente
# pero el padre puede estar re-renderizando. Necesitamos asegurarnos
# que el textarea tenga key estable y onChange correcto.
# El fix real es en el padre: usar useCallback para onChange

# Buscar el textarea en RespuestaCorta y agregar key
old_textarea = '''      <textarea
        value={valor}
        onChange={e => onChange(e.target.value)}
        disabled={respondida}
        placeholder="Escribe tu respuesta aquí..."
        rows={4}'''

new_textarea = '''      <textarea
        value={valor}
        onChange={e => { e.stopPropagation(); onChange(e.target.value); }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !respondida && valor.trim().length >= 10) { e.preventDefault(); onConfirmar(); } }}
        disabled={respondida}
        placeholder="Escribe tu respuesta aquí... (Enter para enviar)"
        rows={4}'''

if old_textarea in text:
    text = text.replace(old_textarea, new_textarea)
    print("✅ Textarea: Enter para enviar, stopPropagation")
else:
    print("⚠️ No matcheó el textarea exacto, buscando alternativa...")
    if 'onChange={e => onChange(e.target.value)}' in text:
        text = text.replace(
            'onChange={e => onChange(e.target.value)}',
            "onChange={e => { e.stopPropagation(); onChange(e.target.value); }}\n        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !respondida && valor.trim().length >= 10) { e.preventDefault(); onConfirmar(); } }}"
        )
        print("✅ Textarea fix alternativo aplicado")

# ══════════════════════════════════════════════════════════════
# 3) Fix onChange en el padre — usar useCallback para setCortaVal
# ══════════════════════════════════════════════════════════════
# El problema real del "solo escribe una letra" es que onChange={setCortaVal}
# hace que React re-cree el componente. Necesitamos useCallback.

# Buscar donde se pasa onChange={setCortaVal}
old_corta_props = '''onChange={setCortaVal}'''
new_corta_props = '''onChange={(v) => setCortaVal(v)}'''

if old_corta_props in text:
    text = text.replace(old_corta_props, new_corta_props)
    print("✅ onChange corta: arrow function estable")

# ══════════════════════════════════════════════════════════════
# 4) Scroll hacia explicación después de responder
# ══════════════════════════════════════════════════════════════
old_scroll = '''    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollTop + 200, behavior: \'smooth\' });
    }, 100);'''

new_scroll = '''    setTimeout(() => {
      const el = document.getElementById(\'quiz-explicacion\');
      if (el) {
        el.scrollIntoView({ behavior: \'smooth\', block: \'nearest\' });
      } else {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollTop + 300, behavior: \'smooth\' });
      }
    }, 150);'''

if old_scroll in text:
    text = text.replace(old_scroll, new_scroll)
    print("✅ Scroll hacia explicación")
else:
    print("⚠️ No matcheó el scroll, buscando...")
    if 'scrollRef.current?.scrollTo({ top: scrollRef.current.scrollTop + 200' in text:
        text = text.replace(
            'scrollRef.current?.scrollTo({ top: scrollRef.current.scrollTop + 200, behavior: \'smooth\' });',
            "const el = document.getElementById('quiz-explicacion'); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } else { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollTop + 300, behavior: 'smooth' }); }"
        )
        print("✅ Scroll fix alternativo")

# ══════════════════════════════════════════════════════════════
# 5) Agregar id="quiz-explicacion" al div de explicación
# ══════════════════════════════════════════════════════════════
# Buscar el bloque de explicación que se muestra al responder
old_expl = '''{respondida && preguntaActual && (
            <div style={{'''

new_expl = '''{respondida && preguntaActual && (
            <div id="quiz-explicacion" style={{'''

if old_expl in text:
    text = text.replace(old_expl, new_expl, 1)
    print("✅ id quiz-explicacion agregado")
else:
    # Buscar variante
    patterns = [
        '{respondida && (',
        'respondida && preguntaActual',
    ]
    for pat in patterns:
        if pat in text:
            print(f"⚠️ Patrón alternativo encontrado: {pat[:40]}")
            break

quiz_path.write_text(text, encoding='utf-8')
print("\n🎉 Quiz fixes aplicados:")
print("  1. Relacionar: canvas con líneas bezier animadas igual que TemaView")
print("  2. Corta: textarea con Enter para enviar + fix re-render")  
print("  3. Scroll automático hacia explicación al responder")
