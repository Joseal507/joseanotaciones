'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useIdioma } from '@/hooks/useIdioma';
import { useIsMobile } from '@/hooks/useIsMobile';
import Link from 'next/link';
import MathText from '@/components/MathText';
import ApuntePagesViewer from '@/components/comunidad/ApuntePagesViewer';

const HAND = "'Caveat',cursive";

interface Post {
  id: string;
  user_id: string;
  user_nombre: string;
  user_avatar?: string;
  tipo: string;
  titulo: string;
  descripcion?: string;
  portada_url?: string;
  video_url?: string;
  contenido?: any;
  materia_nombre?: string;
  materia_color?: string;
  materia_emoji?: string;
  es_partner: boolean;
  comments_activos: boolean;
  views: number;
  estudiados: number;
  likes_count: number;
  user_liked: boolean;
  avg_rating: number;
  ratings_count: number;
  guardado: boolean;
  user_rating?: number;
  created_at: string;
}

interface Comentario {
  id: string;
  user_id: string;
  user_nombre: string;
  user_avatar?: string;
  parent_id?: string;
  contenido: string;
  editado: boolean;
  created_at: string;
  updated_at: string;
}

// ─── STAR SELECTOR ───
function StarSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {[1, 2, 3, 4, 5].map((s, i) => (
        <button key={s}
          onMouseEnter={() => setHover(s)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(s)}
          style={{
            background: 'none', border: 'none',
            fontSize: 36, cursor: 'pointer', padding: 2,
            color: s <= (hover || value) ? '#f5c842' : 'var(--border-color)',
            transform: s <= (hover || value) ? `rotate(${i % 2 === 0 ? -8 : 8}deg) scale(1.2)` : `rotate(${i % 2 === 0 ? -2 : 2}deg)`,
            transition: 'all 0.15s cubic-bezier(.34,1.4,.64,1)',
            filter: s <= (hover || value) ? 'drop-shadow(0 2px 4px rgba(245,200,66,0.5))' : 'none',
          }}>
          ★
        </button>
      ))}
    </div>
  );
}

// ─── FLASHCARDS VIEWER ───
function FlashcardsViewer({ cards }: { cards: { question: string; answer: string }[] }) {
  const { tr, idioma } = useIdioma();
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [modo, setModo] = useState<'flip' | 'escritura'>('flip');
  const [respuesta, setRespuesta] = useState('');
  const [mostrarRespuesta, setMostrarRespuesta] = useState(false);
  const card = cards[idx];
  const siguiente = () => { setFlipped(false); setMostrarRespuesta(false); setRespuesta(''); setIdx(p => (p + 1) % cards.length); };
  const anterior = () => { setFlipped(false); setMostrarRespuesta(false); setRespuesta(''); setIdx(p => (p - 1 + cards.length) % cards.length); };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['flip', 'escritura'] as const).map((m, i) => {
          const active = modo === m;
          return (
            <button key={m} onClick={() => setModo(m)}
              style={{
                padding: '7px 16px',
                borderRadius: 10,
                border: `2.5px ${active ? 'solid' : 'dashed'} ${active ? '#a78bfa' : 'var(--border-color)'}`,
                background: active ? 'color-mix(in srgb,#a78bfa 18%,transparent)' : 'transparent',
                color: active ? '#a78bfa' : 'var(--text-muted)',
                fontFamily: HAND, fontSize: 16, fontWeight: 800,
                cursor: 'pointer',
                boxShadow: active ? '2px 3px 0 #a78bfa' : 'none',
                transform: active ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` : `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}>
              {m === 'flip' ? `🔄 ${tr('voltear')}` : `✏️ ${tr('escrituraMode')}`}
            </button>
          );
        })}
        <span style={{
          marginLeft: 'auto',
          fontFamily: HAND, fontSize: 17, fontStyle: 'italic',
          color: 'var(--text-muted)',
        }}>
          ~ {idx + 1} / {cards.length} ~
        </span>
      </div>

      {modo === 'flip' ? (
        <div onClick={() => setFlipped(!flipped)} style={{
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 16,
          padding: '40px 24px', minHeight: 200,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', textAlign: 'center',
          boxShadow: `5px 6px 0 ${flipped ? '#a78bfa' : '#6366f1'}`,
          transform: 'rotate(-0.6deg)',
          transition: 'all 0.3s',
          position: 'relative',
        }}>
          {/* Cinta scotch */}
          <div style={{
            position: 'absolute', top: -10, left: '50%',
            transform: 'translateX(-50%) rotate(-4deg)',
            width: 80, height: 18,
            background: `color-mix(in srgb,${flipped ? '#a78bfa' : '#6366f1'} 55%,transparent)`,
            border: `1px solid color-mix(in srgb,${flipped ? '#a78bfa' : '#6366f1'} 30%,transparent)`,
            boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
          }}/>

          <div style={{
            fontFamily: HAND, fontSize: 16, fontWeight: 800,
            color: flipped ? '#a78bfa' : '#6366f1',
            fontStyle: 'italic',
            marginBottom: 16, letterSpacing: 1,
          }}>
            {flipped ? `💡 ${tr('respuestaUp')}` : `❓ ${tr('preguntaUp')}`}
          </div>
          <div style={{
            fontFamily: HAND, fontSize: 24, fontWeight: 700,
            color: 'var(--text-primary)', lineHeight: 1.35,
          }}>
            <MathText text={flipped ? card.answer : card.question} />
          </div>
          {!flipped && (
            <div style={{
              fontFamily: HAND, fontSize: 14, fontStyle: 'italic',
              color: 'var(--text-faint)', marginTop: 20,
            }}>
              ~ 👆 toca para ver respuesta ~
            </div>
          )}
        </div>
      ) : (
        <div>
          <div style={{
            background: 'var(--bg-card)',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 14,
            padding: 22, textAlign: 'center',
            marginBottom: 12,
            boxShadow: '4px 5px 0 #6366f1',
            transform: 'rotate(-0.4deg)',
          }}>
            <div style={{
              fontFamily: HAND, fontSize: 16, fontWeight: 800,
              color: '#6366f1', fontStyle: 'italic',
              marginBottom: 10,
            }}>
              ❓ PREGUNTA
            </div>
            <div style={{
              fontFamily: HAND, fontSize: 20, fontWeight: 700,
              color: 'var(--text-primary)',
            }}>
              <MathText text={card.question} />
            </div>
          </div>
          <textarea value={respuesta} onChange={(e: any) => setRespuesta(e.target.value)} placeholder='✏️ escribe tu respuesta...' rows={3}
            style={{
              width: '100%', padding: 12,
              borderRadius: 12,
              border: '2.5px solid var(--text-primary)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontFamily: HAND, fontSize: 18, fontWeight: 600,
              resize: 'vertical', outline: 'none', boxSizing: 'border-box',
              marginBottom: 10,
              boxShadow: '3px 3px 0 var(--text-primary)',
              transform: 'rotate(-0.3deg)',
            }} />
          {!mostrarRespuesta
            ? <button onClick={() => setMostrarRespuesta(true)}
                style={{
                  padding: '10px 22px',
                  borderRadius: 12,
                  border: '2.5px solid var(--text-primary)',
                  background: '#a78bfa', color: '#fff',
                  fontFamily: HAND, fontSize: 18, fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '3px 4px 0 var(--text-primary)',
                  textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                  transform: 'rotate(-1deg)',
                }}>
                💡 {tr('verRespuestaBtn')}
              </button>
            : <div style={{
                background: 'color-mix(in srgb,#a78bfa 18%,transparent)',
                border: '2.5px dashed #a78bfa',
                borderRadius: 12, padding: 16,
                transform: 'rotate(0.4deg)',
              }}>
                <div style={{
                  fontFamily: HAND, fontSize: 16, fontWeight: 800,
                  color: '#a78bfa', fontStyle: 'italic',
                  marginBottom: 8,
                }}>
                  ✓ RESPUESTA CORRECTA
                </div>
                <div style={{
                  fontFamily: HAND, fontSize: 18, fontWeight: 600,
                  color: 'var(--text-primary)',
                }}>
                  <MathText text={card.answer} />
                </div>
              </div>
          }
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'center' }}>
        <button onClick={anterior}
          style={{
            padding: '10px 22px',
            borderRadius: 12,
            border: '2.5px solid var(--text-primary)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            fontFamily: HAND, fontSize: 17, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '2px 3px 0 var(--text-primary)',
            transform: 'rotate(-1.5deg)',
          }}>
          ← Anterior
        </button>
        <button onClick={siguiente}
          style={{
            padding: '10px 22px',
            borderRadius: 12,
            border: '2.5px solid var(--text-primary)',
            background: '#a78bfa', color: '#fff',
            fontFamily: HAND, fontSize: 17, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '3px 4px 0 var(--text-primary)',
            textShadow: '0 1px 2px rgba(0,0,0,0.3)',
            transform: 'rotate(1.5deg)',
          }}>
          Siguiente →
        </button>
      </div>
    </div>
  );
}

// ─── QUIZ VIEWER ───
function QuizViewer({ preguntas, onTerminar }: { preguntas: any[]; onTerminar: () => void }) {
  const { tr } = useIdioma();
  const [idx, setIdx] = useState(0);
  const [seleccionadas, setSeleccionadas] = useState<Record<number, number>>({});
  const [terminado, setTerminado] = useState(false);
  const pregunta = preguntas[idx];
  const seleccionada = seleccionadas[idx];
  const respondida = seleccionada !== undefined;

  const siguiente = () => {
    if (idx < preguntas.length - 1) setIdx(idx + 1);
    else { setTerminado(true); onTerminar(); }
  };

  if (terminado) {
    const correctasQuiz = preguntas.filter((p, i) => seleccionadas[i] === p.correcta).length;
    const pct = Math.round((correctasQuiz / preguntas.length) * 100);
    return (
      <div style={{
        textAlign: 'center', padding: '40px 20px',
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 16,
        boxShadow: '5px 6px 0 #34d399',
        transform: 'rotate(-0.4deg)',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute', top: -10, left: '50%',
          transform: 'translateX(-50%) rotate(-3deg)',
          width: 80, height: 18,
          background: 'rgba(52,211,153,0.55)',
          border: '1px solid rgba(52,211,153,0.3)',
          boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
        }}/>

        <div style={{ fontSize: 70, marginBottom: 12 }}>
          {pct >= 70 ? '🎉' : pct >= 50 ? '😅' : '😓'}
        </div>
        <h2 style={{
          fontFamily: HAND, fontSize: 36, fontWeight: 900,
          color: 'var(--text-primary)', margin: '0 0 8px',
          transform: 'rotate(-1deg)', display: 'inline-block',
        }}>
          {correctasQuiz} / {preguntas.length} correctas
        </h2>
        <div style={{
          fontFamily: HAND, fontSize: 60, fontWeight: 900,
          color: pct >= 70 ? '#34d399' : pct >= 50 ? '#f5c842' : '#ef4444',
          marginBottom: 18, lineHeight: 1,
          textShadow: `0 0 12px ${pct >= 70 ? '#34d399' : pct >= 50 ? '#f5c842' : '#ef4444'}33`,
        }}>
          {pct}%
        </div>
        <button onClick={() => { setIdx(0); setSeleccionadas({}); setTerminado(false); }}
          style={{
            padding: '12px 26px',
            borderRadius: 12,
            border: '2.5px solid var(--text-primary)',
            background: '#34d399', color: '#000',
            fontFamily: HAND, fontSize: 19, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '3px 4px 0 var(--text-primary)',
            transform: 'rotate(-1deg)',
          }}>
          🔄 Repetir
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <span style={{
          fontFamily: HAND, fontSize: 16, fontStyle: 'italic',
          color: 'var(--text-muted)', flexShrink: 0,
        }}>
          ~ Pregunta {idx + 1} / {preguntas.length} ~
        </span>
        <div style={{
          flex: 1, height: 8,
          background: 'var(--bg-secondary)',
          border: '1.5px solid var(--text-primary)',
          borderRadius: 4, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${(idx / preguntas.length) * 100}%`,
            background: '#34d399',
            transition: 'width 0.3s',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
          }} />
        </div>
      </div>

      <div style={{
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 14,
        boxShadow: '4px 5px 0 #34d399',
        transform: 'rotate(-0.3deg)',
        marginBottom: 16,
        overflow: 'hidden',
      }}>
        <div style={{
          background: '#34d399',
          padding: '8px 18px',
          borderBottom: '2px solid var(--text-primary)',
        }}>
          <span style={{
            fontFamily: HAND, fontSize: 16, fontWeight: 800,
            color: '#000', fontStyle: 'italic',
          }}>
            ❓ Pregunta {idx + 1}
          </span>
        </div>
        <div style={{ padding: 20 }}>
          <h3 style={{
            fontFamily: HAND, fontSize: 22, fontWeight: 700,
            color: 'var(--text-primary)', margin: 0, lineHeight: 1.4,
          }}>
            <MathText text={pregunta.pregunta} />
          </h3>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {pregunta.opciones.map((op: string, i: number) => {
          let borderColor = 'var(--text-primary)', bg = 'var(--bg-card)', color = 'var(--text-primary)', shadow = 'var(--text-primary)';
          if (respondida) {
            if (i === pregunta.correcta) { borderColor = '#34d399'; bg = 'color-mix(in srgb,#34d399 18%,var(--bg-card))'; color = '#16a34a'; shadow = '#34d399'; }
            else if (i === seleccionada) { borderColor = '#ef4444'; bg = 'color-mix(in srgb,#ef4444 18%,var(--bg-card))'; color = '#ef4444'; shadow = '#ef4444'; }
          }
          return (
            <button key={i} onClick={() => !respondida && setSeleccionadas(p => ({ ...p, [idx]: i }))} disabled={respondida}
              style={{
                padding: '13px 18px',
                borderRadius: 12,
                border: `2.5px solid ${borderColor}`,
                background: bg, color,
                fontFamily: HAND, fontSize: 18, fontWeight: 700,
                cursor: respondida ? 'default' : 'pointer',
                textAlign: 'left',
                boxShadow: respondida && (i === pregunta.correcta || i === seleccionada)
                  ? `3px 4px 0 ${shadow}` : '2px 3px 0 var(--text-primary)',
                transform: `rotate(${(i % 2 === 0 ? -0.4 : 0.4)}deg)`,
                transition: 'all 0.2s',
              }}>
              <span style={{ fontWeight: 900, marginRight: 10 }}>{['A', 'B', 'C', 'D'][i]}.</span>
              <MathText text={op} />
            </button>
          );
        })}
      </div>

      {respondida && pregunta.explicacion && (
        <div style={{
          background: 'color-mix(in srgb,#34d399 14%,transparent)',
          border: '2.5px dashed #34d399',
          borderRadius: 12, padding: 16,
          marginBottom: 14,
          transform: 'rotate(0.4deg)',
        }}>
          <div style={{
            fontFamily: HAND, fontSize: 17, fontWeight: 800,
            color: '#16a34a', fontStyle: 'italic',
            marginBottom: 6,
          }}>
            💡 Explicación
          </div>
          <div style={{
            fontFamily: HAND, fontSize: 17, fontWeight: 600,
            color: 'var(--text-primary)',
          }}>
            <MathText text={pregunta.explicacion} />
          </div>
        </div>
      )}

      {respondida && (
        <button onClick={siguiente}
          style={{
            width: '100%', padding: 14,
            borderRadius: 14,
            border: '2.5px solid var(--text-primary)',
            background: '#34d399', color: '#000',
            fontFamily: HAND, fontSize: 20, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '3px 4px 0 var(--text-primary)',
            transform: 'rotate(-1deg)',
          }}>
          {idx < preguntas.length - 1 ? tr('siguienteFlechaDer') : '🏁 Ver Resultados'}
        </button>
      )}
    </div>
  );
}

// ─── COMENTARIOS ───
function SeccionComentarios({ postId, userId, userNombre, userAvatar, commentsActivos, postUserId }: {
  postId: string; userId: string; userNombre: string; userAvatar?: string; commentsActivos: boolean; postUserId: string;
}) {
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [nuevoComentario, setNuevoComentario] = useState('');
  const [respondiendo, setRespondiendo] = useState<string | null>(null);
  const [respuestaTexto, setRespuestaTexto] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [editTexto, setEditTexto] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/comunidad/comentarios?post_id=${postId}`);
    const data = await res.json();
    setComentarios(data.comentarios || []);
  }, [postId]);

  useEffect(() => { cargar(); }, [cargar]);

  const enviar = async (texto: string, parentId?: string) => {
    if (!texto.trim() || !userId) return;
    setEnviando(true);
    await fetch('/api/comunidad/comentarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ post_id: postId, user_id: userId, user_nombre: userNombre, user_avatar: userAvatar, parent_id: parentId, contenido: texto.trim() }) });
    if (parentId) { setRespondiendo(null); setRespuestaTexto(''); } else setNuevoComentario('');
    setEnviando(false);
    cargar();
  };

  const editar = async (id: string) => {
    await fetch('/api/comunidad/comentarios', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, user_id: userId, contenido: editTexto }) });
    setEditando(null);
    cargar();
  };

  const borrar = async (id: string) => {
    if (!confirm('¿Borrar este comentario?')) return;
    await fetch(`/api/comunidad/comentarios?id=${id}&userId=${userId}`, { method: 'DELETE' });
    cargar();
  };

  const timeAgo = (d: string) => {
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'ahora';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };

  const Avatar = ({ nombre, avatar, size = 32 }: { nombre: string; avatar?: string; size?: number }) => (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--gold)',
      border: '2px solid var(--text-primary)',
      boxShadow: '1px 1px 0 var(--text-primary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: HAND, fontSize: size * 0.5, fontWeight: 800, color: '#000',
      overflow: 'hidden', flexShrink: 0,
      transform: 'rotate(-3deg)',
    }}>
      {avatar ? <img src={avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : nombre?.[0]?.toUpperCase()}
    </div>
  );

  const Item = ({ c, nivel = 0 }: { c: Comentario; nivel?: number }) => (
    <div style={{ marginLeft: nivel > 0 ? 36 : 0, marginBottom: 12 }}>
      <div style={{
        background: 'var(--bg-secondary)',
        border: `2px ${nivel > 0 ? 'dashed' : 'solid'} ${nivel > 0 ? '#a78bfa' : 'var(--text-primary)'}`,
        borderRadius: 12, padding: '12px 14px',
        boxShadow: nivel > 0 ? '2px 3px 0 #a78bfa' : '2px 3px 0 var(--text-primary)',
        transform: `rotate(${nivel > 0 ? 0.4 : -0.3}deg)`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar nombre={c.user_nombre} avatar={c.user_avatar} />
            <div>
              <span style={{
                fontFamily: HAND, fontSize: 17, fontWeight: 800,
                color: 'var(--text-primary)',
              }}>{c.user_nombre}</span>
              <span style={{
                fontFamily: HAND, fontSize: 13, fontStyle: 'italic',
                color: 'var(--text-faint)', marginLeft: 6,
              }}>{timeAgo(c.created_at)}</span>
              {c.editado && (
                <span style={{
                  fontFamily: HAND, fontSize: 12, fontStyle: 'italic',
                  color: 'var(--text-faint)', marginLeft: 6,
                }}>~ editado ~</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {userId && commentsActivos && nivel === 0 && (
              <button onClick={() => setRespondiendo(respondiendo === c.id ? null : c.id)}
                style={{
                  background: 'transparent', border: 'none',
                  fontFamily: HAND, fontSize: 14, fontWeight: 800,
                  color: '#a78bfa', cursor: 'pointer',
                  fontStyle: 'italic',
                }}>
                ↩ responder
              </button>
            )}
            {c.user_id === userId && editando !== c.id && (
              <button onClick={() => { setEditando(c.id); setEditTexto(c.contenido); }}
                style={{
                  background: 'transparent', border: 'none',
                  fontFamily: HAND, fontSize: 14, fontWeight: 800,
                  color: 'var(--text-muted)', cursor: 'pointer',
                  fontStyle: 'italic',
                }}>
                ✏️ editar
              </button>
            )}
            {(c.user_id === userId || postUserId === userId) && (
              <button onClick={() => borrar(c.id)}
                style={{
                  background: 'transparent', border: 'none',
                  fontFamily: HAND, fontSize: 14, fontWeight: 800,
                  color: '#ef4444', cursor: 'pointer',
                  fontStyle: 'italic',
                }}>
                🗑️ borrar
              </button>
            )}
          </div>
        </div>
        {editando === c.id ? (
          <div>
            <textarea value={editTexto} onChange={(e: any) => setEditTexto(e.target.value)} rows={2}
              style={{
                width: '100%', padding: 10,
                borderRadius: 10,
                border: '2.5px solid var(--gold)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontFamily: HAND, fontSize: 17, fontWeight: 600,
                resize: 'none', outline: 'none', boxSizing: 'border-box',
                marginBottom: 8,
                boxShadow: '2px 2px 0 var(--gold)',
              }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => editar(c.id)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: '2px solid var(--text-primary)',
                  background: 'var(--gold)', color: '#000',
                  fontFamily: HAND, fontSize: 15, fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '2px 2px 0 var(--text-primary)',
                  transform: 'rotate(-1deg)',
                }}>
                💾 Guardar
              </button>
              <button onClick={() => setEditando(null)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: '2px dashed var(--text-faint)',
                  background: 'transparent', color: 'var(--text-muted)',
                  fontFamily: HAND, fontSize: 15, fontWeight: 800,
                  cursor: 'pointer',
                  transform: 'rotate(1deg)',
                }}>
                ✕
              </button>
            </div>
          </div>
        ) : (
          <p style={{
            fontFamily: HAND, fontSize: 17, fontWeight: 600,
            color: 'var(--text-primary)',
            margin: 0, lineHeight: 1.45,
          }}>{c.contenido}</p>
        )}
      </div>
      {respondiendo === c.id && (
        <div style={{ marginLeft: 36, marginTop: 8 }}>
          <textarea value={respuestaTexto} onChange={(e: any) => setRespuestaTexto(e.target.value)} placeholder='✏️ escribe tu respuesta...' rows={2}
            style={{
              width: '100%', padding: 10,
              borderRadius: 10,
              border: '2.5px solid #a78bfa',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontFamily: HAND, fontSize: 17, fontWeight: 600,
              resize: 'none', outline: 'none', boxSizing: 'border-box',
              marginBottom: 8,
              boxShadow: '2px 2px 0 #a78bfa',
            }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => enviar(respuestaTexto, c.id)} disabled={!respuestaTexto.trim()}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: '2px solid var(--text-primary)',
                background: '#a78bfa', color: '#fff',
                fontFamily: HAND, fontSize: 15, fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '2px 2px 0 var(--text-primary)',
                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                transform: 'rotate(-1deg)',
              }}>
              💬 Responder
            </button>
            <button onClick={() => setRespondiendo(null)}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: '2px dashed var(--text-faint)',
                background: 'transparent', color: 'var(--text-muted)',
                fontFamily: HAND, fontSize: 15, fontWeight: 800,
                cursor: 'pointer',
                transform: 'rotate(1deg)',
              }}>
              ✕
            </button>
          </div>
        </div>
      )}
      {comentarios.filter(r => r.parent_id === c.id).map(r => <Item key={r.id} c={r} nivel={1} />)}
    </div>
  );

  const raiz = comentarios.filter(c => !c.parent_id);

  return (
    <div>
      <h3 style={{
        fontFamily: HAND, fontSize: 28, fontWeight: 900,
        color: 'var(--text-primary)',
        margin: '0 0 16px', lineHeight: 1.05,
        transform: 'rotate(-1deg)', display: 'inline-block',
      }}>
        💬 Comentarios ({comentarios.length})
      </h3>
      {commentsActivos && userId && (
        <div style={{ marginBottom: 22 }}>
          <textarea value={nuevoComentario} onChange={(e: any) => setNuevoComentario(e.target.value)} placeholder="✏️ escribe un comentario..." rows={3}
            style={{
              width: '100%', padding: 12,
              borderRadius: 14,
              border: '2.5px solid var(--text-primary)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontFamily: HAND, fontSize: 17, fontWeight: 600,
              resize: 'vertical', outline: 'none', boxSizing: 'border-box',
              marginBottom: 10,
              boxShadow: '3px 3px 0 var(--text-primary)',
              transform: 'rotate(-0.3deg)',
            }}
          />
          <button onClick={() => enviar(nuevoComentario)} disabled={!nuevoComentario.trim() || enviando}
            style={{
              padding: '10px 22px',
              borderRadius: 12,
              border: '2.5px solid var(--text-primary)',
              background: nuevoComentario.trim() ? 'var(--gold)' : 'var(--border-color)',
              color: nuevoComentario.trim() ? '#000' : 'var(--text-muted)',
              fontFamily: HAND, fontSize: 18, fontWeight: 800,
              cursor: nuevoComentario.trim() ? 'pointer' : 'not-allowed',
              boxShadow: nuevoComentario.trim() ? '3px 4px 0 var(--text-primary)' : 'none',
              transform: 'rotate(-1deg)',
            }}>
            {enviando ? '⏳ Enviando...' : '📤 Comentar'}
          </button>
        </div>
      )}
      {!commentsActivos && (
        <div style={{
          background: 'var(--bg-secondary)',
          border: '2.5px dashed var(--border-color)',
          borderRadius: 12, padding: 16,
          textAlign: 'center', marginBottom: 16,
          transform: 'rotate(-0.4deg)',
        }}>
          <span style={{
            fontFamily: HAND, fontSize: 17, fontStyle: 'italic',
            color: 'var(--text-muted)',
          }}>
            🔒 ~ comentarios desactivados por el autor ~
          </span>
        </div>
      )}
      {raiz.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 36,
          background: 'var(--bg-secondary)',
          border: '2px dashed var(--border-color)',
          borderRadius: 12,
          transform: 'rotate(-0.5deg)',
        }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>💭</div>
          <p style={{
            fontFamily: HAND, fontSize: 19, fontStyle: 'italic',
            color: 'var(--text-muted)', margin: 0,
          }}>
            ~ sé el primero en comentar ~
          </p>
        </div>
      ) : (
        raiz.map(c => <Item key={c.id} c={c} />)
      )}
    </div>
  );
}

// ─── MODAL CONFIRMAR BORRAR ───
function ModalConfirmar({ onConfirmar, onCancelar, borrando }: { onConfirmar: () => void; onCancelar: () => void; borrando: boolean }) {
  return (
    <div onClick={onCancelar} style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.78)',
      backdropFilter: 'blur(6px)',
      zIndex: 999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 16,
        padding: 32, maxWidth: 400, width: '100%',
        textAlign: 'center',
        boxShadow: '6px 7px 0 #ef4444, 0 16px 50px rgba(0,0,0,0.4)',
        transform: 'rotate(-0.5deg)',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute', top: -10, left: '50%',
          transform: 'translateX(-50%) rotate(-4deg)',
          width: 80, height: 18,
          background: 'rgba(239,68,68,0.55)',
          border: '1px solid rgba(239,68,68,0.3)',
          boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
        }}/>

        <div style={{ fontSize: 56, marginBottom: 14 }}>🗑️</div>
        <h3 style={{
          fontFamily: HAND, fontSize: 28, fontWeight: 900,
          color: 'var(--text-primary)', margin: '0 0 8px',
          transform: 'rotate(-1deg)', display: 'inline-block',
        }}>¿Borrar este post?</h3>
        <p style={{
          fontFamily: HAND, fontSize: 17, fontStyle: 'italic',
          color: 'var(--text-muted)', margin: '8px 0 22px', lineHeight: 1.4,
        }}>
          ~ esta acción no se puede deshacer ~
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button onClick={onCancelar} disabled={borrando}
            style={{
              padding: '12px 22px',
              borderRadius: 12,
              border: '2.5px dashed var(--text-faint)',
              background: 'transparent', color: 'var(--text-muted)',
              fontFamily: HAND, fontSize: 18, fontWeight: 800,
              cursor: 'pointer',
              transform: 'rotate(1deg)',
            }}>
            ✕ Cancelar
          </button>
          <button onClick={onConfirmar} disabled={borrando}
            style={{
              padding: '12px 22px',
              borderRadius: 12,
              border: '2.5px solid var(--text-primary)',
              background: '#ef4444', color: '#fff',
              fontFamily: HAND, fontSize: 18, fontWeight: 800,
              cursor: borrando ? 'not-allowed' : 'pointer',
              opacity: borrando ? 0.7 : 1,
              boxShadow: '3px 4px 0 var(--text-primary)',
              textShadow: '0 1px 2px rgba(0,0,0,0.3)',
              transform: 'rotate(-1deg)',
            }}>
            {borrando ? '⏳ Borrando...' : '🗑️ Sí, borrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL EDITAR POST ───
function ModalEditar({ post, onGuardar, onCancelar }: { post: Post; onGuardar: (datos: { titulo: string; descripcion: string }) => Promise<void>; onCancelar: () => void }) {
  const [titulo, setTitulo] = useState(post.titulo);
  const [descripcion, setDescripcion] = useState(post.descripcion || '');
  const [guardando, setGuardando] = useState(false);

  const handleGuardar = async () => {
    if (!titulo.trim()) return;
    setGuardando(true);
    await onGuardar({ titulo: titulo.trim(), descripcion: descripcion.trim() });
    setGuardando(false);
  };

  return (
    <div onClick={onCancelar} style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.78)',
      backdropFilter: 'blur(6px)',
      zIndex: 999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 16,
        padding: 0, maxWidth: 500, width: '100%',
        boxShadow: '6px 7px 0 var(--gold), 0 16px 50px rgba(0,0,0,0.4)',
        transform: 'rotate(-0.5deg)',
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute', top: -10, left: '50%',
          transform: 'translateX(-50%) rotate(-3deg)',
          width: 80, height: 18,
          background: 'rgba(245,200,66,0.55)',
          border: '1px solid rgba(245,200,66,0.3)',
          boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
          zIndex: 5,
        }}/>

        <div style={{
          background: 'var(--gold)',
          padding: '12px 28px',
          borderBottom: '2px solid var(--text-primary)',
        }}>
          <h3 style={{
            fontFamily: HAND, fontSize: 26, fontWeight: 900,
            color: '#000', margin: 0, lineHeight: 1.1,
            transform: 'rotate(-0.8deg)', display: 'inline-block',
            fontStyle: 'italic',
          }}>
            ✏️ Editar post
          </h3>
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ marginBottom: 14 }}>
            <label style={{
              fontFamily: HAND, fontSize: 15, fontWeight: 800,
              color: 'var(--text-muted)', fontStyle: 'italic',
              display: 'block', marginBottom: 6,
            }}>✏️ Título</label>
            <input value={titulo} onChange={(e: any) => setTitulo(e.target.value)} placeholder="Título del post"
              style={{
                width: '100%', padding: 12,
                borderRadius: 12,
                border: '2.5px solid var(--text-primary)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontFamily: HAND, fontSize: 19, fontWeight: 600,
                outline: 'none', boxSizing: 'border-box',
                boxShadow: '3px 3px 0 var(--text-primary)',
                transform: 'rotate(-0.3deg)',
              }}
            />
          </div>
          <div style={{ marginBottom: 22 }}>
            <label style={{
              fontFamily: HAND, fontSize: 15, fontWeight: 800,
              color: 'var(--text-muted)', fontStyle: 'italic',
              display: 'block', marginBottom: 6,
            }}>✏️ Descripción (opcional)</label>
            <textarea value={descripcion} onChange={(e: any) => setDescripcion(e.target.value)} placeholder="Descripción del post..." rows={3}
              style={{
                width: '100%', padding: 12,
                borderRadius: 12,
                border: '2.5px solid var(--text-primary)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontFamily: HAND, fontSize: 17, fontWeight: 600,
                resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                boxShadow: '3px 3px 0 var(--text-primary)',
                transform: 'rotate(-0.3deg)',
              }}
            />
          </div>
          <div style={{
            display: 'flex', gap: 12, justifyContent: 'flex-end',
            paddingTop: 14, borderTop: '1.5px dashed var(--border-color)',
          }}>
            <button onClick={onCancelar} disabled={guardando}
              style={{
                padding: '11px 22px',
                borderRadius: 12,
                border: '2.5px dashed var(--text-faint)',
                background: 'transparent', color: 'var(--text-muted)',
                fontFamily: HAND, fontSize: 18, fontWeight: 800,
                cursor: 'pointer',
                transform: 'rotate(1deg)',
              }}>
              ✕ Cancelar
            </button>
            <button onClick={handleGuardar} disabled={!titulo.trim() || guardando}
              style={{
                padding: '11px 22px',
                borderRadius: 12,
                border: '2.5px solid var(--text-primary)',
                background: titulo.trim() ? 'var(--gold)' : 'var(--border-color)',
                color: titulo.trim() ? '#000' : 'var(--text-muted)',
                fontFamily: HAND, fontSize: 18, fontWeight: 800,
                cursor: titulo.trim() && !guardando ? 'pointer' : 'not-allowed',
                boxShadow: titulo.trim() ? '3px 4px 0 var(--text-primary)' : 'none',
                transform: 'rotate(-1deg)',
              }}>
              {guardando ? '⏳ Guardando...' : '✅ Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PÁGINA PRINCIPAL ───
export default function PostPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isMobile = useIsMobile();

  const [post, setPost] = useState<Post | null>(null);
  const [userId, setUserId] = useState('');
  const [userNombre, setUserNombre] = useState('');
  const [userAvatar, setUserAvatar] = useState('');
  const [loading, setLoading] = useState(true);

  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [guardado, setGuardado] = useState(false);
  const [userRating, setUserRating] = useState(0);
  const [avgRating, setAvgRating] = useState(0);
  const [ratingsCount, setRatingsCount] = useState(0);
  const [estudiadoRegistrado, setEstudiadoRegistrado] = useState(false);

  const [menuAbierto, setMenuAbierto] = useState(false);
  const [showEditar, setShowEditar] = useState(false);
  const [showBorrar, setShowBorrar] = useState(false);
  const [borrando, setBorrando] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id);
        setUserNombre(data.user.user_metadata?.nombre || data.user.email?.split('@')[0] || '');
        setUserAvatar(data.user.user_metadata?.avatar_url || '');
      }
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    const cargar = async () => {
      setLoading(true);
      try {
        const uid = (await supabase.auth.getUser()).data.user?.id || '';
        const params = new URLSearchParams({ tipo: 'all', filtro: 'todos' });
        if (uid) params.append('userId', uid);
        const res = await fetch(`/api/comunidad/posts?${params}`);
        const data = await res.json();
        const p = data.posts?.find((x: Post) => x.id === id);
        if (p) {
          setPost(p);
          setLiked(p.user_liked);
          setLikesCount(p.likes_count);
          setGuardado(p.guardado);
          setAvgRating(p.avg_rating);
          setRatingsCount(p.ratings_count);
          setUserRating(p.user_rating || 0);
          fetch('/api/comunidad/views', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ post_id: id, tipo: 'view' }) });
        }
      } finally { setLoading(false); }
    };
    cargar();
  }, [id]);

  const handleLike = async () => {
    if (!userId || !post) return;
    await fetch('/api/comunidad/likes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ post_id: post.id, user_id: userId }) });
    setLiked(l => !l);
    setLikesCount(c => c + (liked ? -1 : 1));
  };

  const handleGuardar = async () => {
    if (!userId || !post) return;
    await fetch('/api/comunidad/guardados', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ post_id: post.id, user_id: userId }) });
    setGuardado(g => !g);
  };

  const handleRating = async (r: number) => {
    if (!userId || !post) return;
    setUserRating(r);
    const res = await fetch('/api/comunidad/ratings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ post_id: post.id, user_id: userId, rating: r }) });
    const data = await res.json();
    setAvgRating(data.avg);
    setRatingsCount(data.count);
  };

  const registrarEstudiado = () => {
    if (estudiadoRegistrado || !post) return;
    setEstudiadoRegistrado(true);
    fetch('/api/comunidad/views', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ post_id: post.id, tipo: 'estudiado' }) });
  };

  const handleBorrar = async () => {
    if (!post) return;
    setBorrando(true);
    try {
      await fetch(`/api/comunidad/posts?postId=${post.id}&userId=${userId}`, { method: 'DELETE' });
      ((window as any).__showNavLoader?.('/comunidad'), router.push('/comunidad'));
    } catch {
      setBorrando(false);
      setShowBorrar(false);
    }
  };

  const handleEditar = async (datos: { titulo: string; descripcion: string }) => {
    if (!post) return;
    await fetch('/api/comunidad/posts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: post.id, userId, titulo: datos.titulo, descripcion: datos.descripcion })
    });
    setPost(p => p ? { ...p, titulo: datos.titulo, descripcion: datos.descripcion } : p);
    setShowEditar(false);
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 50, animation: 'spin 1.2s linear infinite' }}>⏳</div>
      <p style={{ fontFamily: HAND, fontSize: 19, fontStyle: 'italic', color: 'var(--text-faint)', margin: 0 }}>~ cargando post ~</p>
    </div>
  );

  if (!post) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: 20 }}>
      <div style={{
        background: 'var(--bg-card)',
        border: '2.5px dashed var(--border-color)',
        borderRadius: 16, padding: '40px 32px',
        textAlign: 'center', maxWidth: 420,
        transform: 'rotate(-0.5deg)',
      }}>
        <div style={{ fontSize: 70, marginBottom: 12 }}>😕</div>
        <h2 style={{
          fontFamily: HAND, fontSize: 28, fontWeight: 900,
          color: 'var(--text-primary)', margin: '0 0 16px',
          transform: 'rotate(-1deg)', display: 'inline-block',
        }}>Post no encontrado</h2>
        <Link href="/comunidad" style={{
          fontFamily: HAND, fontSize: 18, fontWeight: 800,
          color: 'var(--gold)', textDecoration: 'underline dotted',
        }}>← Volver a Comunidad</Link>
      </div>
    </div>
  );

  const tipoInfo = {
    apunte:     { label: 'Apunte',     emoji: '📝', color: '#f5c842' },
    flashcards: { label: 'Flashcards', emoji: '🎴', color: '#a78bfa' },
    quiz:       { label: 'Quiz',       emoji: '🧠', color: '#34d399' },
    post:       { label: 'Post',       emoji: '💬', color: '#38bdf8' },
    video:      { label: 'Video',      emoji: '🎥', color: '#ff4d6d' },
  }[post.tipo] || { label: 'Post', emoji: '💬', color: '#38bdf8' };

  const flashcards = post.contenido?.flashcards || [];
  const quiz = post.contenido?.quiz || [];
  const esDueno = userId === post.user_id;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', position: 'relative' }}>

      {showBorrar && <ModalConfirmar onConfirmar={handleBorrar} onCancelar={() => setShowBorrar(false)} borrando={borrando} />}
      {showEditar && <ModalEditar post={post} onGuardar={handleEditar} onCancelar={() => setShowEditar(false)} />}

      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'color-mix(in srgb,var(--bg-primary) 92%,transparent)',
        backdropFilter: 'blur(14px)',
        borderBottom: '2.5px solid var(--text-primary)',
        padding: '12px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Link href="/comunidad" style={{ textDecoration: 'none' }}>
            <button style={{
              background: 'var(--bg-card)',
              border: '2.5px solid var(--text-primary)',
              color: 'var(--text-primary)',
              padding: '8px 14px', borderRadius: 10,
              fontFamily: HAND, fontSize: 16, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '3px 3px 0 var(--text-primary)',
              transform: 'rotate(-1.5deg)',
            }}>
              ← Comunidad
            </button>
          </Link>
          <span style={{
            background: tipoInfo.color, color: '#000',
            border: '2px solid var(--text-primary)',
            boxShadow: '2px 2px 0 var(--text-primary)',
            padding: '3px 12px', borderRadius: 8,
            fontFamily: HAND, fontSize: 15, fontWeight: 800,
            transform: 'rotate(2deg)',
            display: 'inline-block', flexShrink: 0,
            fontStyle: 'italic',
          }}>
            {tipoInfo.emoji} {tipoInfo.label}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <button onClick={handleLike}
            style={{
              padding: '8px 16px',
              borderRadius: 10,
              border: `2.5px ${liked ? 'solid' : 'dashed'} ${liked ? '#ef4444' : 'var(--border-color)'}`,
              background: liked ? 'color-mix(in srgb,#ef4444 18%,transparent)' : 'transparent',
              color: liked ? '#ef4444' : 'var(--text-muted)',
              fontFamily: HAND, fontSize: 16, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: liked ? '2px 3px 0 #ef4444' : 'none',
              transform: 'rotate(-1deg)',
            }}>
            {liked ? '❤️' : '🤍'} {likesCount}
          </button>
          <button onClick={handleGuardar}
            style={{
              padding: '8px 16px',
              borderRadius: 10,
              border: `2.5px ${guardado ? 'solid' : 'dashed'} ${guardado ? '#f5c842' : 'var(--border-color)'}`,
              background: guardado ? 'color-mix(in srgb,#f5c842 18%,transparent)' : 'transparent',
              color: guardado ? '#f5c842' : 'var(--text-muted)',
              fontFamily: HAND, fontSize: 16, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: guardado ? '2px 3px 0 #f5c842' : 'none',
              transform: 'rotate(1deg)',
            }}>
            {guardado ? '🔖' : '🏷️'}
          </button>

          {esDueno && (
            <div style={{ position: 'relative' }}>
              <button onClick={() => setMenuAbierto(!menuAbierto)}
                style={{
                  width: 38, height: 38, borderRadius: 10,
                  border: '2.5px solid var(--text-primary)',
                  background: menuAbierto ? 'var(--bg-secondary)' : 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontFamily: HAND, fontSize: 22, fontWeight: 900,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '2px 3px 0 var(--text-primary)',
                  transform: 'rotate(-2deg)',
                }}>
                ⋯
              </button>
              {menuAbierto && (
                <>
                  <div onClick={() => setMenuAbierto(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
                  <div style={{
                    position: 'absolute', right: 0, top: 48,
                    background: 'var(--bg-card)',
                    border: '2.5px solid var(--text-primary)',
                    borderRadius: 12, padding: 8,
                    zIndex: 200, minWidth: 200,
                    boxShadow: '4px 5px 0 var(--text-primary)',
                    transform: 'rotate(-1deg)',
                  }}>
                    <button onClick={() => { setMenuAbierto(false); setShowEditar(true); }}
                      style={{
                        width: '100%', padding: '11px 14px', borderRadius: 8,
                        border: 'none', background: 'transparent',
                        color: 'var(--text-primary)',
                        fontFamily: HAND, fontSize: 17, fontWeight: 800,
                        cursor: 'pointer', textAlign: 'left',
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}
                      onMouseEnter={(e: any) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                      onMouseLeave={(e: any) => (e.currentTarget.style.background = 'transparent')}
                    >
                      ✏️ Editar post
                    </button>
                    <div style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }} />
                    <button onClick={() => { setMenuAbierto(false); setShowBorrar(true); }}
                      style={{
                        width: '100%', padding: '11px 14px', borderRadius: 8,
                        border: 'none', background: 'transparent',
                        color: '#ef4444',
                        fontFamily: HAND, fontSize: 17, fontWeight: 800,
                        cursor: 'pointer', textAlign: 'left',
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}
                      onMouseEnter={(e: any) => (e.currentTarget.style.background = 'color-mix(in srgb,#ef4444 14%,transparent)')}
                      onMouseLeave={(e: any) => (e.currentTarget.style.background = 'transparent')}
                    >
                      🗑️ Borrar post
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Línea rasgada */}
      <svg viewBox="0 0 1200 14" preserveAspectRatio="none" style={{
        display: 'block', width: '100%', height: 14,
      }}>
        <path
          d="M 0 7 Q 50 2 100 6 T 200 5 T 300 8 T 400 4 T 500 7 T 600 5 T 700 8 T 800 4 T 900 7 T 1000 5 T 1100 8 T 1200 6"
          fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" opacity="0.45"
        />
      </svg>

      <div style={{ maxWidth: 850, margin: '0 auto', padding: isMobile ? 16 : '28px 24px' }}>

        {/* Info post */}
        <div style={{ marginBottom: 22 }}>
          {post.materia_nombre && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: `color-mix(in srgb,${post.materia_color} 18%,transparent)`,
              border: `2.5px dashed ${post.materia_color}`,
              borderRadius: 8, padding: '4px 12px',
              marginBottom: 12,
              transform: 'rotate(-1deg)',
            }}>
              <span style={{ fontSize: 18 }}>{post.materia_emoji}</span>
              <span style={{
                fontFamily: HAND, fontSize: 16, fontWeight: 800,
                color: post.materia_color, fontStyle: 'italic',
              }}>
                {post.materia_nombre}
              </span>
            </div>
          )}

          <h1 style={{
            fontFamily: HAND, fontSize: isMobile ? 32 : 44, fontWeight: 900,
            color: 'var(--text-primary)', margin: '0 0 10px',
            lineHeight: 1.1,
            transform: 'rotate(-0.5deg)', display: 'inline-block',
          }}>
            {post.titulo}
          </h1>

          {post.descripcion && (
            <p style={{
              fontFamily: HAND, fontSize: 19, fontStyle: 'italic',
              color: 'var(--text-muted)',
              margin: '4px 0 16px', lineHeight: 1.5,
            }}>
              ~ {post.descripcion} ~
            </p>
          )}

          {/* Autor + stats */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center',
            padding: 14,
            background: 'var(--bg-card)',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 14,
            boxShadow: '3px 4px 0 var(--gold)',
            transform: 'rotate(-0.3deg)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
              onClick={() => router.push(`/u/${encodeURIComponent(post.user_id)}`)}
            >
              <div style={{
                width: 42, height: 42, borderRadius: '50%',
                background: 'var(--gold)',
                border: '2.5px solid var(--text-primary)',
                boxShadow: '2px 2px 0 var(--text-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: HAND, fontSize: 18, fontWeight: 900, color: '#000',
                overflow: 'hidden', flexShrink: 0,
                transform: 'rotate(-4deg)',
              }}>
                {post.user_avatar
                  ? <img src={post.user_avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={post.user_nombre} />
                  : post.user_nombre?.[0]?.toUpperCase()}
              </div>
              <div>
                <div style={{
                  fontFamily: HAND, fontSize: 19, fontWeight: 900,
                  color: 'var(--text-primary)', lineHeight: 1.05,
                  textDecoration: 'underline dotted',
                }}>{post.user_nombre}</div>
                <div style={{
                  fontFamily: HAND, fontSize: 13, fontStyle: 'italic',
                  color: 'var(--text-faint)',
                }}>
                  {new Date(post.created_at).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, marginLeft: 'auto' }}>
              {[
                { emoji: '👁️', val: post.views,       label: 'vistas',     rot: -1 },
                { emoji: '📖', val: post.estudiados,  label: 'estudiados', rot: 1 },
                { emoji: '❤️', val: likesCount,       label: 'likes',      rot: -1 },
              ].map((s, i) => (
                <div key={i} style={{
                  textAlign: 'center',
                  padding: '4px 10px',
                  background: 'var(--bg-secondary)',
                  border: '2px dashed var(--border-color)',
                  borderRadius: 8,
                  transform: `rotate(${s.rot}deg)`,
                }}>
                  <div style={{
                    fontFamily: HAND, fontSize: 17, fontWeight: 900,
                    color: 'var(--text-primary)',
                  }}>{s.emoji} {s.val}</div>
                  <div style={{
                    fontFamily: HAND, fontSize: 12, fontStyle: 'italic',
                    color: 'var(--text-faint)',
                  }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Contenido */}
        <div style={{
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 16,
          padding: isMobile ? 16 : 26,
          marginBottom: 22,
          boxShadow: `4px 5px 0 ${tipoInfo.color}`,
          transform: 'rotate(-0.3deg)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            marginBottom: 20, paddingBottom: 14,
            borderBottom: '2px dashed var(--border-color)',
          }}>
            <span style={{ fontSize: 24 }}>{tipoInfo.emoji}</span>
            <h3 style={{
              fontFamily: HAND, fontSize: 22, fontWeight: 900,
              color: tipoInfo.color, margin: 0, lineHeight: 1,
              fontStyle: 'italic',
              transform: 'rotate(-0.5deg)', display: 'inline-block',
            }}>
              {tipoInfo.label}
              {post.tipo === 'flashcards' && ` (${flashcards.length})`}
              {post.tipo === 'quiz' && ` (${quiz.length} preguntas)`}
            </h3>
          </div>

          {post.tipo === 'apunte' && <ApuntePagesViewer contenido={post.contenido} />}

          {post.tipo === 'post' && (
            <div style={{
              fontFamily: HAND, fontSize: 19, fontWeight: 600,
              color: 'var(--text-primary)',
              lineHeight: 1.6, whiteSpace: 'pre-wrap',
            }}>
              {post.contenido?.texto || post.contenido?.contenido || post.descripcion || (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>💬</div>
                  <p style={{ fontFamily: HAND, fontSize: 19, fontStyle: 'italic', margin: 0 }}>
                    ~ post de la comunidad StudyAL ~
                  </p>
                </div>
              )}
            </div>
          )}

          {post.tipo === 'flashcards' && (
            flashcards.length > 0
              ? <FlashcardsViewer cards={flashcards} />
              : <div style={{ textAlign: 'center', padding: 40 }}>
                  <div style={{ fontSize: 50, marginBottom: 8 }}>🎴</div>
                  <p style={{ fontFamily: HAND, fontSize: 19, fontStyle: 'italic', color: 'var(--text-muted)', margin: 0 }}>~ no hay flashcards ~</p>
                </div>
          )}

          {post.tipo === 'quiz' && (
            quiz.length > 0
              ? <QuizViewer preguntas={quiz} onTerminar={() => registrarEstudiado()} />
              : <div style={{ textAlign: 'center', padding: 40 }}>
                  <div style={{ fontSize: 50, marginBottom: 8 }}>🧠</div>
                  <p style={{ fontFamily: HAND, fontSize: 19, fontStyle: 'italic', color: 'var(--text-muted)', margin: 0 }}>~ no hay preguntas ~</p>
                </div>
          )}

          {post.tipo === 'video' && (
            <div>
              {post.video_url ? (
                <div style={{
                  borderRadius: 14, overflow: 'hidden',
                  background: '#000',
                  border: '2.5px solid var(--text-primary)',
                  boxShadow: '4px 5px 0 var(--text-primary)',
                  transform: 'rotate(-0.5deg)',
                }}>
                  <video src={post.video_url} controls playsInline
                    style={{
                      width: '100%', maxHeight: 520,
                      display: 'block', objectFit: 'contain',
                      background: '#000',
                    }}
                  />
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <div style={{ fontSize: 50, marginBottom: 8 }}>🎥</div>
                  <p style={{ fontFamily: HAND, fontSize: 19, fontStyle: 'italic', color: 'var(--text-muted)', margin: 0 }}>~ video no disponible ~</p>
                </div>
              )}
              {post.descripcion && (
                <p style={{
                  fontFamily: HAND, fontSize: 17, fontStyle: 'italic',
                  color: 'var(--text-muted)',
                  margin: '14px 0 0', lineHeight: 1.5,
                }}>
                  ~ {post.descripcion} ~
                </p>
              )}
            </div>
          )}
        </div>

        {/* Rating */}
        <div style={{
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 16,
          padding: 24, marginBottom: 22,
          textAlign: 'center',
          boxShadow: '4px 5px 0 #f5c842',
          transform: 'rotate(0.3deg)',
        }}>
          <h3 style={{
            fontFamily: HAND, fontSize: 24, fontWeight: 900,
            color: 'var(--text-primary)', margin: '0 0 14px',
            transform: 'rotate(-1deg)', display: 'inline-block',
          }}>
            ⭐ Califica este {tipoInfo.label.toLowerCase()}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {userId
              ? <>
                  <StarSelector value={userRating} onChange={handleRating} />
                  {userRating > 0 && (
                    <p style={{
                      fontFamily: HAND, fontSize: 16, fontStyle: 'italic',
                      color: 'var(--text-muted)', margin: 0,
                    }}>
                      ~ tu calificación: {userRating} ★ ~
                    </p>
                  )}
                </>
              : <p style={{
                  fontFamily: HAND, fontSize: 17, fontStyle: 'italic',
                  color: 'var(--text-muted)', margin: 0,
                }}>
                  ~ inicia sesión para calificar ~
                </p>
            }
            {ratingsCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  fontFamily: HAND, fontSize: 36, fontWeight: 900,
                  color: '#f5c842',
                }}>{avgRating}</span>
                <div>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {[1,2,3,4,5].map(s => (
                      <span key={s} style={{
                        fontSize: 16,
                        color: s <= Math.round(avgRating) ? '#f5c842' : 'var(--border-color)',
                      }}>★</span>
                    ))}
                  </div>
                  <div style={{
                    fontFamily: HAND, fontSize: 13, fontStyle: 'italic',
                    color: 'var(--text-faint)',
                  }}>{ratingsCount} calificaciones</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Comentarios */}
        <div style={{
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 16,
          padding: isMobile ? 16 : 26,
          boxShadow: '4px 5px 0 var(--blue)',
          transform: 'rotate(-0.3deg)',
        }}>
          <SeccionComentarios
            postId={post.id}
            userId={userId}
            userNombre={userNombre}
            userAvatar={userAvatar}
            commentsActivos={post.comments_activos}
            postUserId={post.user_id}
          />
        </div>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}