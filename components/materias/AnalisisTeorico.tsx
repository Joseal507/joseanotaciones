'use client';
import { useState, useEffect, useRef, useMemo } from 'react';

const HAND = "'Caveat', cursive";
const BODY = "'Inter', system-ui, -apple-system, sans-serif";

interface Props {
  materiales: any[];
  onClose: () => void;
  onGuardarApunte?: (titulo: string, contenido: string) => void;
  materialId?: string;  // ID del nuevo sistema para cache
}

type Analisis = {
  titulo: string;
  vision_general: string;
  conceptos: { nombre: string; definicion_simple: string; definicion_tecnica: string; por_que_importa: string; ejemplo_concreto: string }[];
  conexiones: { de: string; a: string; como: string }[];
  ejemplos: { titulo: string; problema: string; razonamiento: string; respuesta: string }[];
  analogias: { concepto: string; analogia: string }[];
  errores_comunes: { confusion: string; por_que_pasa: string; como_evitarlo: string }[];
  resumen_final: string[];
  autoevaluacion: { pregunta: string; respuesta_esperada: string }[];
  idioma?: 'es' | 'en';
  docNames?: string[];
};

const STEPS = [
  { emoji: '📄', label: 'leyendo materiales...' },
  { emoji: '🧩', label: 'entendiendo conceptos...' },
  { emoji: '🎨', label: 'estructurando explicación...' },
  { emoji: '✨', label: 'puliendo detalles...' },
];

export default function AnalisisTeorico({ materiales, onClose, onGuardarApunte, materialId }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [leidas, setLeidas] = useState<Set<string>>(new Set());
  const [activeSection, setActiveSection] = useState<string>('vision');
  const [showSelfCheck, setShowSelfCheck] = useState<Record<number, boolean>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ═══ Animación de steps ═══
  useEffect(() => {
    if (!loading) return;
    const intv = setInterval(() => {
      setStepIdx(i => (i + 1) % STEPS.length);
    }, 1400);
    return () => clearInterval(intv);
  }, [loading]);

  // ═══ Fetch del análisis ═══
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        // Obtener token para cache por usuario
        let authToken = '';
        try {
          const { supabase } = await import('../../lib/supabase');
          authToken = '';
        } catch {}

        const res = await fetch('/api/analizar-teorico', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({
            documentos: materiales.map(m => ({
              id: m.id,
              nombre: m.nombre,
              contenido: m.contenido || '',
              tipo: m.tipo,
            })),
            materialId: materialId || materiales[0]?.materialId || materiales[0]?.id,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.success && data.analisis) {
          setAnalisis(data.analisis);
          setLoading(false);
        } else {
          setError(data.error || 'Error generando análisis');
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || 'Error de conexión');
          setLoading(false);
        }
      }
    };
    run();
    return () => { cancelled = true; };
  }, [materiales]);

  // ═══ Scroll spy ═══
  useEffect(() => {
    if (!analisis || !scrollRef.current) return;
    const onScroll = () => {
      const scrollEl = scrollRef.current!;
      const sections = Object.entries(sectionRefs.current);
      let current = sections[0]?.[0] || 'vision';
      for (const [id, el] of sections) {
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight / 3) current = id;
      }
      setActiveSection(current);
    };
    const el = scrollRef.current;
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [analisis]);

  // ═══ Bloqueo zoom navegador ═══
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); }
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['+','-','=','0'].includes(e.key)) e.preventDefault();
    };
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    document.addEventListener('keydown', onKey, { capture: true });
    return () => {
      document.removeEventListener('wheel', onWheel, { capture: true } as any);
      document.removeEventListener('keydown', onKey, { capture: true } as any);
    };
  }, []);

  const toggleLeida = (id: string) => {
    setLeidas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const scrollTo = (id: string) => {
    const el = sectionRefs.current[id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const sectionsList = useMemo(() => {
    if (!analisis) return [];
    const list: { id: string; emoji: string; label: string }[] = [
      { id: 'vision', emoji: '🎯', label: 'Visión general' },
    ];
    if (analisis.conceptos?.length) list.push({ id: 'conceptos', emoji: '📚', label: 'Conceptos clave' });
    if (analisis.conexiones?.length) list.push({ id: 'conexiones', emoji: '🔗', label: 'Conexiones' });
    if (analisis.ejemplos?.length) list.push({ id: 'ejemplos', emoji: '💡', label: 'Ejemplos' });
    if (analisis.analogias?.length) list.push({ id: 'analogias', emoji: '🧠', label: 'Analogías' });
    if (analisis.errores_comunes?.length) list.push({ id: 'errores', emoji: '⚠️', label: 'Errores comunes' });
    if (analisis.resumen_final?.length) list.push({ id: 'resumen', emoji: '✅', label: 'Resumen' });
    if (analisis.autoevaluacion?.length) list.push({ id: 'quiz', emoji: '🎓', label: 'Autoevaluación' });
    return list;
  }, [analisis]);

  const totalSecciones = sectionsList.length;
  const progreso = totalSecciones > 0 ? Math.round((leidas.size / totalSecciones) * 100) : 0;

  // ═══ LOADING SCREEN ═══
  if (loading) {
    return (
      <div style={overlayStyle}>
        <BgCuaderno />
        <div style={{
          position: 'fixed', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 24, zIndex: 10,
        }}>
          <div style={{
            fontFamily: HAND, fontSize: 32, fontWeight: 800,
            color: 'var(--text-primary)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 44, animation: 'lupa 2s ease-in-out infinite' }}>🔬</span>
            <span>Analizando tu material…</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            {STEPS.map((s, i) => {
              const done = i < stepIdx;
              const active = i === stepIdx;
              return (
                <div key={i} style={{
                  fontFamily: HAND, fontSize: 22,
                  color: active ? 'var(--gold)' : done ? 'var(--text-muted)' : 'var(--text-faint)',
                  display: 'flex', alignItems: 'center', gap: 10,
                  opacity: done ? 0.6 : 1,
                  transition: 'all 0.3s',
                }}>
                  <span style={{ fontSize: 24 }}>{done ? '✅' : active ? s.emoji : '⬜'}</span>
                  <span>{s.label}</span>
                  {active && <span style={{ display: 'inline-block', animation: 'dotPulse 1s infinite' }}>...</span>}
                </div>
              );
            })}
          </div>

          <div style={{
            fontFamily: BODY, fontSize: 16, color: 'var(--text-faint)',
            fontStyle: 'italic', marginTop: 14,
          }}>
            esto puede tardar unos 15-30 segundos ✨
          </div>
        </div>
        <Styles />
      </div>
    );
  }

  // ═══ ERROR SCREEN ═══
  if (error) {
    return (
      <div style={overlayStyle}>
        <BgCuaderno />
        <div style={{
          position: 'fixed', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 20, zIndex: 10,
        }}>
          <div style={{ fontSize: 60 }}>😅</div>
          <div style={{ fontFamily: HAND, fontSize: 28, color: 'var(--text-primary)', textAlign: 'center', maxWidth: 500 }}>
            ups, algo salió mal
          </div>
          <div style={{ fontFamily: BODY, fontSize: 15, color: 'var(--text-muted)', maxWidth: 500, textAlign: 'center' }}>
            {error}
          </div>
          <button onClick={onClose} style={btnPrimario}>← volver</button>
        </div>
        <Styles />
      </div>
    );
  }

  if (!analisis) return null;

  // ═══ MAIN UI ═══
  return (
    <div style={overlayStyle}>
      <BgCuaderno />

      {/* ═══ TOP BAR ═══ */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
        background: 'color-mix(in srgb, var(--bg-primary) 92%, transparent)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1.5px solid color-mix(in srgb, var(--text-primary) 12%, transparent)',
        padding: '12px 20px',
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <button onClick={onClose} style={{
          background: 'transparent', border: '1.5px solid var(--text-primary)',
          color: 'var(--text-primary)', padding: '6px 16px',
          borderRadius: 10, fontFamily: HAND, fontSize: 18, fontWeight: 700,
          cursor: 'pointer', boxShadow: '2px 3px 0 var(--text-primary)',
          transition: 'transform .2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
        >← cerrar</button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 22 }}>🔬</span>
            <div style={{
              fontFamily: HAND, fontSize: 26, fontWeight: 900,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{analisis.titulo}</div>
          </div>
          <div style={{
            fontFamily: BODY, fontSize: 13, color: 'var(--text-muted)',
            fontStyle: 'italic',
          }}>
            análisis de {materiales.length} {materiales.length === 1 ? 'material' : 'materiales'}
          </div>
        </div>

        {/* Progreso */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140 }}>
          <div style={{
            fontFamily: BODY, fontSize: 14, color: 'var(--text-muted)',
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>progreso</span>
            <span style={{ color: 'var(--gold)', fontWeight: 800 }}>{progreso}%</span>
          </div>
          <div style={{
            height: 6, background: 'color-mix(in srgb, var(--text-primary) 12%, transparent)',
            borderRadius: 3, overflow: 'hidden',
          }}>
            <div style={{
              width: `${progreso}%`, height: '100%',
              background: 'linear-gradient(90deg, var(--gold), color-mix(in srgb, var(--gold) 70%, #fff))',
              borderRadius: 3, transition: 'width 0.4s',
            }} />
          </div>
        </div>
      </div>

      {/* ═══ LAYOUT ═══ */}
      <div style={{
        position: 'fixed', top: 78, left: 0, right: 0, bottom: 0,
        display: 'flex', zIndex: 5,
      }}>
        {/* ─── SIDEBAR ÍNDICE ─── */}
        <aside style={{
          width: 240, flexShrink: 0,
          padding: '20px 14px',
          overflowY: 'auto',
          background: 'transparent',
        }}>
          <div style={{
            position: 'relative',
            background: '#fde047',
            border: '1.5px solid #78350f',
            borderRadius: 4,
            padding: '34px 14px 18px',
            boxShadow: '0 8px 18px rgba(0,0,0,0.45), 0 3px 6px rgba(0,0,0,0.25)',
            transform: 'rotate(-1.5deg)',
          }}>
            <div style={{
              position: 'absolute', top: -10, left: '50%',
              width: 70, height: 14,
              transform: 'translateX(-50%) rotate(-4deg)',
              background: 'rgba(245,245,240,0.7)',
              border: '1px solid rgba(0,0,0,0.12)',
              boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
            }} />
            <div style={{
              fontFamily: HAND, fontSize: 18, fontWeight: 900,
              color: '#422006', marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              📋 <span>Índice</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sectionsList.map(s => {
                const isLeida = leidas.has(s.id);
                const isActive = activeSection === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => scrollTo(s.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: isActive ? 'rgba(66,32,6,0.15)' : 'transparent',
                      border: 'none', textAlign: 'left',
                      padding: '6px 8px', borderRadius: 4,
                      cursor: 'pointer',
                      fontFamily: HAND, fontSize: 17, fontWeight: 700,
                      color: '#422006',
                      transition: 'background 0.2s, transform 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(3px)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateX(0)'; }}
                  >
                    <span style={{ fontSize: 14, opacity: isLeida ? 1 : 0.4 }}>
                      {isLeida ? '✅' : '⬜'}
                    </span>
                    <span style={{ fontSize: 16 }}>{s.emoji}</span>
                    <span style={{
                      flex: 1,
                      textDecoration: isLeida ? 'line-through' : 'none',
                      opacity: isLeida ? 0.65 : 1,
                    }}>{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{
            marginTop: 18, padding: '10px 12px',
            fontFamily: BODY, fontSize: 13,
            color: 'var(--text-faint)', fontStyle: 'italic',
            textAlign: 'center', lineHeight: 1.3,
          }}>
            tip: marca como leído al terminar cada sección 📌
          </div>
        </aside>

        {/* ─── CONTENIDO ─── */}
        <main ref={scrollRef} style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px 32px 80px',
        }}>
          <div style={{ maxWidth: 820, margin: '0 auto' }}>

            {/* Visión general */}
            <Seccion
              id="vision" emoji="🎯" titulo="Visión general"
              setRef={(el: any) => { sectionRefs.current['vision'] = el; }}
              leida={leidas.has('vision')}
              onToggleLeida={() => toggleLeida('vision')}
              onGuardar={() => onGuardarApunte?.(`🎯 Visión general — ${analisis.titulo}`, Array.isArray(analisis.vision_general) ? analisis.vision_general.join('\n\n') : String(analisis.vision_general))}
            >
              {(Array.isArray(analisis.vision_general) ? analisis.vision_general : String(analisis.vision_general).split(/\n\n+/).filter(Boolean)).map((p: string, i: number) => (
                <p key={i} style={{...parrafo, marginBottom: 18}}>{p}</p>
              ))}
            </Seccion>

            {/* Conceptos */}
            {analisis.conceptos?.length > 0 && (
              <Seccion
              id="conceptos" emoji="📚" titulo="Conceptos clave"
              setRef={(el: any) => { sectionRefs.current['conceptos'] = el; }}
              leida={leidas.has('conceptos')}
              onToggleLeida={() => toggleLeida('conceptos')}
              onGuardar={() => onGuardarApunte?.(`📚 Conceptos — ${analisis.titulo}`,
                analisis.conceptos.map(c => `• ${c.nombre}: ${c.definicion_simple}`).join('\n'))}
            >
              {analisis.conceptos.map((c, i) => (
                <div key={i} style={conceptoCard}>
                  <div style={{ fontFamily: HAND, fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 6 }}>
                    {i+1}. {c.nombre}
                  </div>
                  {c.definicion_simple && (
                    <div style={{ ...miniCard, background: 'color-mix(in srgb, #fde047 30%, var(--bg-card))', borderColor: '#a16207' }}>
                      <strong style={miniLabel}>🟡 En simple:</strong> {c.definicion_simple}
                    </div>
                  )}
                  {c.definicion_tecnica && (
                    <div style={{ ...miniCard, background: 'color-mix(in srgb, var(--blue) 18%, var(--bg-card))', borderColor: 'var(--blue)' }}>
                      <strong style={miniLabel}>🔵 Técnico:</strong> {c.definicion_tecnica}
                    </div>
                  )}
                  {c.por_que_importa && (
                    <div style={{ ...miniCard, background: 'color-mix(in srgb, #84cc16 18%, var(--bg-card))', borderColor: '#65a30d' }}>
                      <strong style={miniLabel}>🟢 Por qué importa:</strong> {c.por_que_importa}
                    </div>
                  )}
                  {c.ejemplo_concreto && (
                    <div style={{ ...miniCard, background: 'color-mix(in srgb, #fb923c 18%, var(--bg-card))', borderColor: '#ea580c' }}>
                      <strong style={miniLabel}>🟠 Ejemplo:</strong> {c.ejemplo_concreto}
                    </div>
                  )}
                </div>
              ))}
            </Seccion>
            )}

            {/* Conexiones */}
            {analisis.conexiones?.length > 0 && (
              <Seccion
                id="conexiones" emoji="🔗" titulo="Cómo se conectan"
                setRef={(el: any) => { sectionRefs.current['conexiones'] = el; }}
                leida={leidas.has('conexiones')}
                onToggleLeida={() => toggleLeida('conexiones')}
                onGuardar={() => onGuardarApunte?.(`🔗 Conexiones — ${analisis.titulo}`,
                  analisis.conexiones.map(c => `${c.de} → ${c.a}: ${c.como}`).join('\n\n'))}
              >
                {analisis.conexiones.map((c, i) => (
                  <div key={i} style={{
                    ...miniCard,
                    background: 'color-mix(in srgb, #84cc16 15%, var(--bg-card))',
                    borderColor: '#65a30d',
                    marginBottom: 10,
                  }}>
                    <div style={{ fontFamily: HAND, fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                      {c.de} <span style={{ color: '#65a30d' }}>→</span> {c.a}
                    </div>
                    <div style={parrafoMini}>{c.como}</div>
                  </div>
                ))}
              </Seccion>
            )}

            {/* Ejemplos */}
            {analisis.ejemplos?.length > 0 && (
              <Seccion
                id="ejemplos" emoji="💡" titulo="Ejemplos prácticos"
                setRef={(el: any) => { sectionRefs.current['ejemplos'] = el; }}
                leida={leidas.has('ejemplos')}
                onToggleLeida={() => toggleLeida('ejemplos')}
                onGuardar={() => onGuardarApunte?.(`💡 Ejemplos — ${analisis.titulo}`,
                  analisis.ejemplos.map((e, i) => `EJEMPLO ${i+1}: ${e.titulo}\nProblema: ${e.problema}\nRazonamiento: ${e.razonamiento}\nRespuesta: ${e.respuesta}`).join('\n\n'))}
              >
                {analisis.ejemplos.map((ej, i) => (
                  <div key={i} style={{ ...conceptoCard, background: 'color-mix(in srgb, #fde047 12%, var(--bg-card))', borderColor: '#a16207' }}>
                    <div style={{ fontFamily: HAND, fontSize: 21, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 6 }}>
                      💡 Ejemplo {i+1}: {ej.titulo}
                    </div>
                    {ej.problema && (
                      <div style={{ ...miniCard, background: 'color-mix(in srgb, var(--text-primary) 6%, var(--bg-card))', borderColor: 'var(--text-muted)' }}>
                        <strong style={miniLabel}>❓ Problema:</strong> {ej.problema}
                      </div>
                    )}
                    {ej.razonamiento && (
                      <div style={{ ...miniCard, background: 'color-mix(in srgb, var(--blue) 12%, var(--bg-card))', borderColor: 'var(--blue)' }}>
                        <strong style={miniLabel}>🧩 Razonamiento:</strong> {ej.razonamiento}
                      </div>
                    )}
                    {ej.respuesta && (
                      <div style={{ ...miniCard, background: 'color-mix(in srgb, #84cc16 18%, var(--bg-card))', borderColor: '#65a30d' }}>
                        <strong style={miniLabel}>✅ Respuesta:</strong> {ej.respuesta}
                      </div>
                    )}
                  </div>
                ))}
              </Seccion>
            )}

            {/* Analogías */}
            {analisis.analogias?.length > 0 && (
              <Seccion
                id="analogias" emoji="🧠" titulo="Analogías para entenderlo"
                setRef={(el: any) => { sectionRefs.current['analogias'] = el; }}
                leida={leidas.has('analogias')}
                onToggleLeida={() => toggleLeida('analogias')}
                onGuardar={() => onGuardarApunte?.(`🧠 Analogías — ${analisis.titulo}`,
                  analisis.analogias.map(a => `${a.concepto}: ${a.analogia}`).join('\n\n'))}
              >
                {analisis.analogias.map((a, i) => (
                  <div key={i} style={{
                    ...miniCard,
                    background: 'color-mix(in srgb, #c4b5fd 22%, var(--bg-card))',
                    borderColor: '#7c3aed',
                    marginBottom: 10,
                  }}>
                    <div style={{ fontFamily: HAND, fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                      🧠 {a.concepto}
                    </div>
                    <div style={parrafoMini}>{a.analogia}</div>
                  </div>
                ))}
              </Seccion>
            )}

            {/* Errores comunes */}
            {analisis.errores_comunes?.length > 0 && (
              <Seccion
                id="errores" emoji="⚠️" titulo="Errores comunes (cuidado con esto)"
                setRef={(el: any) => { sectionRefs.current['errores'] = el; }}
                leida={leidas.has('errores')}
                onToggleLeida={() => toggleLeida('errores')}
                onGuardar={() => onGuardarApunte?.(`⚠️ Errores — ${analisis.titulo}`,
                  analisis.errores_comunes.map(e => `${e.confusion}\nPor qué: ${e.por_que_pasa}\nEvítalo: ${e.como_evitarlo}`).join('\n\n'))}
              >
                {analisis.errores_comunes.map((er, i) => (
                  <div key={i} style={{
                    ...conceptoCard,
                    background: 'color-mix(in srgb, #fca5a5 15%, var(--bg-card))',
                    borderColor: '#dc2626',
                  }}>
                    <div style={{ fontFamily: HAND, fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
                      ⚠️ {er.confusion}
                    </div>
                    {er.por_que_pasa && (
                      <div style={{ ...miniCard, background: 'transparent', borderColor: '#dc262644' }}>
                        <strong style={miniLabel}>🤔 Por qué pasa:</strong> {er.por_que_pasa}
                      </div>
                    )}
                    {er.como_evitarlo && (
                      <div style={{ ...miniCard, background: 'color-mix(in srgb, #84cc16 15%, var(--bg-card))', borderColor: '#65a30d' }}>
                        <strong style={miniLabel}>✅ Cómo evitarlo:</strong> {er.como_evitarlo}
                      </div>
                    )}
                  </div>
                ))}
              </Seccion>
            )}

            {/* Resumen */}
            {analisis.resumen_final?.length > 0 && (
              <Seccion
              id="resumen" emoji="✅" titulo="Si solo te llevas esto..."
              setRef={(el: any) => { sectionRefs.current['resumen'] = el; }}
              leida={leidas.has('resumen')}
              onToggleLeida={() => toggleLeida('resumen')}
              onGuardar={() => onGuardarApunte?.(`✅ Resumen — ${analisis.titulo}`,
                analisis.resumen_final.map((b, i) => `${i+1}. ${b}`).join('\n'))}
            >
              <ol style={{ paddingLeft: 24, margin: 0 }}>
                {analisis.resumen_final.map((b, i) => (
                  <li key={i} style={{ ...parrafo, marginBottom: 10 }}>
                    <strong>{b}</strong>
                  </li>
                ))}
              </ol>
            </Seccion>
            )}

            {/* Autoevaluación */}
            {analisis.autoevaluacion?.length > 0 && (
              <Seccion
                id="quiz" emoji="🎓" titulo="¿Lo entendiste? Autoevaluación"
                setRef={(el: any) => { sectionRefs.current['quiz'] = el; }}
                leida={leidas.has('quiz')}
                onToggleLeida={() => toggleLeida('quiz')}
                onGuardar={() => onGuardarApunte?.(`🎓 Autoevaluación — ${analisis.titulo}`,
                  analisis.autoevaluacion.map((q, i) => `P${i+1}: ${q.pregunta}\nRespuesta esperada: ${q.respuesta_esperada}`).join('\n\n'))}
              >
                {analisis.autoevaluacion.map((q, i) => (
                  <div key={i} style={{
                    ...conceptoCard,
                    background: 'color-mix(in srgb, var(--gold) 10%, var(--bg-card))',
                    borderColor: 'var(--gold)',
                  }}>
                    <div style={{ fontFamily: HAND, fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
                      🎓 Pregunta {i+1}
                    </div>
                    <div style={{ ...parrafo, marginBottom: 10 }}>{q.pregunta}</div>
                    <button
                      onClick={() => setShowSelfCheck(s => ({ ...s, [i]: !s[i] }))}
                      style={{
                        background: 'var(--gold)', color: 'var(--text-primary)',
                        border: '1.5px solid var(--text-primary)',
                        padding: '6px 14px', borderRadius: 8,
                        fontFamily: HAND, fontSize: 15, fontWeight: 700,
                        cursor: 'pointer',
                        boxShadow: '2px 3px 0 var(--text-primary)',
                      }}
                    >
                      {showSelfCheck[i] ? '🙈 ocultar' : '👁️ ver respuesta esperada'}
                    </button>
                    {showSelfCheck[i] && (
                      <div style={{
                        ...miniCard, marginTop: 10,
                        background: 'color-mix(in srgb, #84cc16 15%, var(--bg-card))',
                        borderColor: '#65a30d',
                      }}>
                        <strong style={miniLabel}>✅ Respuesta esperada:</strong> {q.respuesta_esperada}
                      </div>
                    )}
                  </div>
                ))}
              </Seccion>
            )}

            {/* Footer */}
            <div style={{
              marginTop: 60, padding: '24px 0',
              borderTop: '1.5px dashed color-mix(in srgb, var(--text-primary) 20%, transparent)',
              textAlign: 'center',
              fontFamily: BODY, fontSize: 18, color: 'var(--text-muted)',
              fontStyle: 'italic',
            }}>
              🎉 ¡Terminaste! ¿Listo para hacer flashcards o un quiz? ✨
            </div>
          </div>
        </main>
      </div>

      <Styles />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTES AUXILIARES
// ═══════════════════════════════════════════════════════════════

function Seccion({ id, emoji, titulo, children, setRef, leida, onToggleLeida, onGuardar }: any) {
  return (
    <section
      ref={setRef}
      style={{
        position: 'relative',
        background: 'var(--bg-card)',
        border: '1.5px solid color-mix(in srgb, var(--text-primary) 20%, transparent)',
        borderRadius: 8,
        padding: '24px 28px',
        marginBottom: 32,
        boxShadow: '0 8px 20px rgba(0,0,0,0.25), 0 2px 4px rgba(0,0,0,0.15)',
        scrollMarginTop: 24,
      }}
    >
      {/* Cinta scotch arriba */}
      <div style={{
        position: 'absolute', top: -8, left: 28,
        width: 76, height: 14,
        background: leida ? 'rgba(245,200,66,0.7)' : 'rgba(245,245,240,0.65)',
        border: '1px solid rgba(0,0,0,0.12)',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        transform: 'rotate(-3deg)',
      }} />

      <header style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 18, paddingBottom: 12,
        borderBottom: '1.5px dashed color-mix(in srgb, var(--text-primary) 18%, transparent)',
      }}>
        <span style={{ fontSize: 32 }}>{emoji}</span>
        <h2 style={{
          fontFamily: HAND, fontSize: 32, fontWeight: 900,
          color: 'var(--text-primary)', margin: 0,
          letterSpacing: 0.3,
        }}>{titulo}</h2>
      </header>

      <div>{children}</div>

      {/* Botones de acción */}
      <div style={{
        display: 'flex', gap: 8, marginTop: 18,
        paddingTop: 14,
        borderTop: '1px dashed color-mix(in srgb, var(--text-primary) 14%, transparent)',
      }}>
        <button onClick={onToggleLeida} style={{
          background: leida ? 'var(--gold)' : 'transparent',
          color: leida ? 'var(--text-primary)' : 'var(--text-muted)',
          border: `1.5px solid ${leida ? 'var(--gold)' : 'var(--text-muted)'}`,
          padding: '6px 14px', borderRadius: 8,
          fontFamily: BODY, fontSize: 15, fontWeight: 700,
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}>
          {leida ? '✅ leído' : '⬜ marcar leído'}
        </button>
        {onGuardar && (
          <button onClick={onGuardar} style={{
            background: 'transparent',
            color: 'var(--text-muted)',
            border: '1.5px solid var(--text-muted)',
            padding: '6px 14px', borderRadius: 8,
            fontFamily: BODY, fontSize: 15, fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.color = 'var(--gold)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--text-muted)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            📝 guardar como apunte
          </button>
        )}
      </div>
    </section>
  );
}

function BgCuaderno() {
  return (
    <>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0,
        background: 'var(--bg-primary)',
      }} />
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1,
        backgroundImage: `linear-gradient(to bottom, transparent 0, transparent 47px, color-mix(in srgb, var(--text-primary) 5%, transparent) 47px, color-mix(in srgb, var(--text-primary) 5%, transparent) 48px, transparent 48px)`,
        backgroundSize: '100% 48px',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'fixed', left: 80, top: 0, bottom: 0, width: 1.5,
        background: 'rgba(239,68,68,0.35)',
        zIndex: 1, pointerEvents: 'none',
      }} />
    </>
  );
}

function Styles() {
  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes lupa {
          0%, 100% { transform: rotate(-8deg) scale(1); }
          50%      { transform: rotate(8deg) scale(1.15); }
        }
        @keyframes dotPulse {
          0%, 100% { opacity: 0.3; }
          50%      { opacity: 1; }
        }
      `}</style>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// ESTILOS
// ═══════════════════════════════════════════════════════════════

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 99999,
  background: 'var(--bg-primary)',
  overflow: 'hidden',
  isolation: 'isolate',
};

const btnPrimario: React.CSSProperties = {
  background: 'var(--gold)', color: 'var(--text-primary)',
  border: '2px solid var(--text-primary)',
  padding: '10px 24px', borderRadius: 12,
  fontFamily: HAND, fontSize: 20, fontWeight: 800,
  cursor: 'pointer',
  boxShadow: '3px 4px 0 var(--text-primary)',
};

const conceptoCard: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--text-primary) 4%, var(--bg-card))',
  border: '1.5px solid color-mix(in srgb, var(--text-primary) 15%, transparent)',
  borderRadius: 6,
  padding: '14px 16px',
  marginBottom: 16,
};

const miniCard: React.CSSProperties = {
  border: '1.5px solid',
  borderRadius: 5,
  padding: '10px 12px',
  marginTop: 8,
  fontFamily: BODY,
  fontSize: 15,
  lineHeight: 1.55,
  color: 'var(--text-primary)',
};

const miniLabel: React.CSSProperties = {
  fontFamily: HAND,
  fontSize: 16,
  fontWeight: 800,
  marginRight: 4,
};

const parrafo: React.CSSProperties = {
  fontFamily: BODY,
  fontSize: 16,
  lineHeight: 1.65,
  color: 'var(--text-primary)',
  margin: '0 0 12px',
};

const parrafoMini: React.CSSProperties = {
  fontFamily: BODY,
  fontSize: 15,
  lineHeight: 1.55,
  color: 'var(--text-primary)',
};
