'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useIdioma } from '@/hooks/useIdioma';
import { useIsMobile } from '@/hooks/useIsMobile';
import Link from 'next/link';
import MathText from '@/components/MathText';
import ApuntePagesViewer from '@/components/comunidad/ApuntePagesViewer';

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


function StarSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: 'flex', gap: '4px' }}>
      {[1, 2, 3, 4, 5].map(s => (
        <button key={s}
          onMouseEnter={() => setHover(s)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(s)}
          style={{ background: 'none', border: 'none', fontSize: '28px', cursor: 'pointer', padding: '2px', color: s <= (hover || value) ? '#f5c842' : 'var(--border-color)', transform: s <= (hover || value) ? 'scale(1.2)' : 'scale(1)', transition: 'all 0.15s' }}>
          ★
        </button>
      ))}
    </div>
  );
}

// ─── FlashcardsViewer ─────────────────────────────────────────────────────────
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
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {(['flip', 'escritura'] as const).map(m => (
          <button key={m} onClick={() => setModo(m)} style={{ padding: '7px 14px', borderRadius: '20px', border: '2px solid', borderColor: modo === m ? '#a78bfa' : 'var(--border-color)', background: modo === m ? '#a78bfa22' : 'transparent', color: modo === m ? '#a78bfa' : 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            {m === 'flip' ? tr('voltear') : tr('escrituraMode')}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--text-muted)' }}>{idx + 1} / {cards.length}</span>
      </div>

      {modo === 'flip' ? (
        <div onClick={() => setFlipped(!flipped)} style={{ background: flipped ? 'linear-gradient(135deg,#7c3aed22,#db277722)' : 'linear-gradient(135deg,#1d4ed822,#7c3aed22)', border: `2px solid ${flipped ? '#a78bfa' : '#6366f1'}`, borderRadius: '20px', padding: '40px 24px', minHeight: '180px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', textAlign: 'center', transition: 'all 0.3s' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: flipped ? '#a78bfa' : '#6366f1', marginBottom: '16px', letterSpacing: '0.08em' }}>{flipped ? tr('respuestaUp') : tr('preguntaUp')}</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.4 }}><MathText text={flipped ? card.answer : card.question} /></div>
          {!flipped && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '20px' }}>👆 Toca para ver respuesta</div>}
        </div>
      ) : (
        <div>
          <div style={{ background: 'linear-gradient(135deg,#1d4ed822,#7c3aed22)', border: '2px solid #6366f1', borderRadius: '20px', padding: '24px', textAlign: 'center', marginBottom: '12px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#6366f1', marginBottom: '12px' }}>PREGUNTA</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}><MathText text={card.question} /></div>
          </div>
          <textarea value={respuesta} onChange={e => setRespuesta(e.target.value)} placeholder="{tr('escribeTuRespuestaCom')}" rows={3}
            style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', marginBottom: '10px' }} />
          {!mostrarRespuesta
            ? <button onClick={() => setMostrarRespuesta(true)} style={{ padding: '10px 20px', borderRadius: '12px', border: 'none', background: '#a78bfa', color: '#fff', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>{tr('verRespuestaBtn')}</button>
            : <div style={{ background: '#a78bfa22', border: '2px solid #a78bfa', borderRadius: '12px', padding: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#a78bfa', marginBottom: '8px' }}>RESPUESTA CORRECTA</div>
                <div style={{ fontSize: '15px', color: 'var(--text-primary)' }}><MathText text={card.answer} /></div>
              </div>
          }
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'center' }}>
        <button onClick={anterior} style={{ padding: '10px 20px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>← Anterior</button>
        <button onClick={siguiente} style={{ padding: '10px 20px', borderRadius: '12px', border: 'none', background: '#a78bfa', color: '#fff', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>Siguiente →</button>
      </div>
    </div>
  );
}

// ─── QuizViewer ───────────────────────────────────────────────────────────────
function QuizViewer({ preguntas, onTerminar }: { preguntas: any[]; onTerminar: () => void }) {
  const { tr, idioma } = useIdioma();
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
    const {tr('correctasQuiz')} = preguntas.filter((p, i) => seleccionadas[i] === p.correcta).length;
    const pct = Math.round(({tr('correctasQuiz')} / preguntas.length) * 100);
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: '60px', marginBottom: '16px' }}>{pct >= 70 ? '🎉' : pct >= 50 ? '😅' : '😓'}</div>
        <h2 style={{ fontSize: '28px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 8px' }}>{{tr('correctasQuiz')}} / {preguntas.length} {tr('correctasQuiz')}</h2>
        <div style={{ fontSize: '48px', fontWeight: 900, color: pct >= 70 ? '#34d399' : pct >= 50 ? '#f5c842' : '#ef4444', marginBottom: '16px' }}>{pct}%</div>
        <button onClick={() => { setIdx(0); setSeleccionadas({}); setTerminado(false); }} style={{ padding: '12px 24px', borderRadius: '12px', border: 'none', background: '#34d399', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>🔄 Repetir</button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>Pregunta {idx + 1} de {preguntas.length}</span>
        <div style={{ flex: 1, height: '6px', background: 'var(--bg-secondary)', borderRadius: '3px' }}>
          <div style={{ height: '100%', width: `${(idx / preguntas.length) * 100}%`, background: '#34d399', borderRadius: '3px', transition: 'width 0.3s' }} />
        </div>
      </div>
      <div style={{ background: 'var(--bg-secondary)', borderRadius: '16px', padding: '24px', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, lineHeight: 1.4 }}><MathText text={pregunta.pregunta} /></h3>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
        {pregunta.opciones.map((op: string, i: number) => {
          let borderColor = 'var(--border-color)', bg = 'transparent', color = 'var(--text-primary)';
          if (respondida) {
            if (i === pregunta.correcta) { borderColor = '#34d399'; bg = '#34d39922'; color = '#34d399'; }
            else if (i === seleccionada) { borderColor = '#ef4444'; bg = '#ef444422'; color = '#ef4444'; }
          }
          return (
            <button key={i} onClick={() => !respondida && setSeleccionadas(p => ({ ...p, [idx]: i }))} disabled={respondida}
              style={{ padding: '14px 18px', borderRadius: '12px', border: `2px solid ${borderColor}`, background: bg, color, fontSize: '14px', fontWeight: 600, cursor: respondida ? 'default' : 'pointer', textAlign: 'left', transition: 'all 0.2s' }}>
              <span style={{ fontWeight: 800, marginRight: '10px' }}>{['A', 'B', 'C', 'D'][i]}.</span>
              <MathText text={op} />
            </button>
          );
        })}
      </div>
      {respondida && pregunta.explicacion && (
        <div style={{ background: '#34d39922', border: '2px solid #34d399', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#34d399', marginBottom: '6px' }}>💡 Explicación</div>
          <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}><MathText text={pregunta.explicacion} /></div>
        </div>
      )}
      {respondida && (
        <button onClick={siguiente} style={{ width: '100%', padding: '14px', borderRadius: '14px', border: 'none', background: '#34d399', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
          {idx < preguntas.length - 1 ? tr('siguienteFlechaDer') : '🏁 Ver Resultados'}
        </button>
      )}
    </div>
  );
}

// ─── SeccionComentarios ───────────────────────────────────────────────────────
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

  const Avatar = ({ nombre, avatar, size = 28 }: { nombre: string; avatar?: string; size?: number }) => (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.45, fontWeight: 800, color: '#000', overflow: 'hidden', flexShrink: 0 }}>
      {avatar ? <img src={avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : nombre?.[0]?.toUpperCase()}
    </div>
  );

  const Item = ({ c, nivel = 0 }: { c: Comentario; nivel?: number }) => (
    <div style={{ marginLeft: nivel > 0 ? '32px' : '0', marginBottom: '10px' }}>
      <div style={{ background: 'var(--bg-secondary)', borderRadius: '14px', padding: '12px 14px', border: `1px solid ${nivel > 0 ? '#a78bfa22' : 'var(--border-color)'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Avatar nombre={c.user_nombre} avatar={c.user_avatar} />
            <div>
              <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)' }}>{c.user_nombre}</span>
              <span style={{ fontSize: '11px', color: 'var(--text-faint)', marginLeft: '6px' }}>{timeAgo(c.created_at)}</span>
              {c.editado && <span style={{ fontSize: '10px', color: 'var(--text-faint)', marginLeft: '6px' }}>(editado)</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            {userId && commentsActivos && nivel === 0 && (
              <button onClick={() => setRespondiendo(respondiendo === c.id ? null : c.id)} style={{ background: 'none', border: 'none', fontSize: '11px', color: '#a78bfa', cursor: 'pointer', fontWeight: 700 }}>Responder</button>
            )}
            {c.user_id === userId && editando !== c.id && (
              <button onClick={() => { setEditando(c.id); setEditTexto(c.contenido); }} style={{ background: 'none', border: 'none', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 700 }}>Editar</button>
            )}
            {(c.user_id === userId || postUserId === userId) && (
              <button onClick={() => borrar(c.id)} style={{ background: 'none', border: 'none', fontSize: '11px', color: '#ef4444', cursor: 'pointer', fontWeight: 700 }}>Borrar</button>
            )}
          </div>
        </div>
        {editando === c.id ? (
          <div>
            <textarea value={editTexto} onChange={e => setEditTexto(e.target.value)} rows={2} style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '2px solid var(--gold)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '14px', resize: 'none', outline: 'none', boxSizing: 'border-box', marginBottom: '8px' }} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => editar(c.id)} style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>Guardar</button>
              <button onClick={() => setEditando(null)} style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: '14px', color: 'var(--text-primary)', margin: 0, lineHeight: 1.5 }}>{c.contenido}</p>
        )}
      </div>
      {respondiendo === c.id && (
        <div style={{ marginLeft: '32px', marginTop: '8px' }}>
          <textarea value={respuestaTexto} onChange={e => setRespuestaTexto(e.target.value)} placeholder="{tr('escribeTuRespuestaCom')}" rows={2}
            style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '2px solid #a78bfa', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '14px', resize: 'none', outline: 'none', boxSizing: 'border-box', marginBottom: '8px' }} />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => enviar(respuestaTexto, c.id)} disabled={!respuestaTexto.trim()} style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', background: '#a78bfa', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>Responder</button>
            <button onClick={() => setRespondiendo(null)} style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}
      {comentarios.filter(r => r.parent_id === c.id).map(r => <Item key={r.id} c={r} nivel={1} />)}
    </div>
  );

  const raiz = comentarios.filter(c => !c.parent_id);

  return (
    <div>
      <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 16px' }}>💬 Comentarios ({comentarios.length})</h3>
      {commentsActivos && userId && (
        <div style={{ marginBottom: '20px' }}>
          <textarea value={nuevoComentario} onChange={e => setNuevoComentario(e.target.value)} placeholder="Escribe un comentario..." rows={3}
            style={{ width: '100%', padding: '12px', borderRadius: '14px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', marginBottom: '10px' }}
            onFocus={e => (e.target.style.borderColor = 'var(--gold)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border-color)')}
          />
          <button onClick={() => enviar(nuevoComentario)} disabled={!nuevoComentario.trim() || enviando}
            style={{ padding: '10px 20px', borderRadius: '12px', border: 'none', background: nuevoComentario.trim() ? 'var(--gold)' : 'var(--border-color)', color: nuevoComentario.trim() ? '#000' : 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: nuevoComentario.trim() ? 'pointer' : 'not-allowed' }}>
            {enviando ? 'Enviando...' : '📤 Comentar'}
          </button>
        </div>
      )}
      {!commentsActivos && (
        <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '16px', textAlign: 'center', marginBottom: '16px' }}>
          <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>🔒 Comentarios desactivados por el autor</span>
        </div>
      )}
      {raiz.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '40px', marginBottom: '8px' }}>💭</div>
          <p style={{ margin: 0 }}>Sé el primero en comentar</p>
        </div>
      ) : (
        raiz.map(c => <Item key={c.id} c={c} />)
      )}
    </div>
  );
}

// ─── Modal de confirmación para borrar ───────────────────────────────────────
function ModalConfirmar({ onConfirmar, onCancelar, borrando }: { onConfirmar: () => void; onCancelar: () => void; borrando: boolean }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)', padding: '32px', maxWidth: '380px', width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🗑️</div>
        <h3 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 8px' }}>¿Borrar este post?</h3>
        <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 24px', lineHeight: 1.6 }}>Esta acción no se puede deshacer. El post y todos sus comentarios se eliminarán permanentemente.</p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button onClick={onCancelar} disabled={borrando} style={{ padding: '12px 24px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={onConfirmar} disabled={borrando} style={{ padding: '12px 24px', borderRadius: '12px', border: 'none', background: '#ef4444', color: '#fff', fontSize: '14px', fontWeight: 700, cursor: borrando ? 'not-allowed' : 'pointer', opacity: borrando ? 0.7 : 1 }}>
            {borrando ? 'Borrando...' : '🗑️ Sí, borrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal editar post ────────────────────────────────────────────────────────
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)', padding: '32px', maxWidth: '480px', width: '100%' }}>
        <h3 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 24px' }}>✏️ Editar post</h3>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Título</label>
          <input
            value={titulo}
            onChange={e => setTitulo(e.target.value)}
            placeholder="Título del post"
            style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }}
            onFocus={e => (e.target.style.borderColor = 'var(--gold)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border-color)')}
          />
        </div>
        <div style={{ marginBottom: '24px' }}>
          <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Descripción (opcional)</label>
          <textarea
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            placeholder="Descripción del post..."
            rows={3}
            style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
            onFocus={e => (e.target.style.borderColor = 'var(--gold)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border-color)')}
          />
        </div>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onCancelar} disabled={guardando} style={{ padding: '11px 22px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={handleGuardar} disabled={!titulo.trim() || guardando} style={{ padding: '11px 22px', borderRadius: '12px', border: 'none', background: titulo.trim() ? 'var(--gold)' : 'var(--border-color)', color: titulo.trim() ? '#000' : 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: titulo.trim() && !guardando ? 'pointer' : 'not-allowed' }}>
            {guardando ? 'Guardando...' : '✅ Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
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

  // Menú dueño
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
      router.push('/comunidad');
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
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: '40px' }}>⏳</div>
    </div>
  );

  if (!post) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <div style={{ fontSize: '60px', marginBottom: '16px' }}>😕</div>
      <h2 style={{ color: 'var(--text-primary)', margin: '0 0 8px' }}>Post no encontrado</h2>
      <Link href="/comunidad" style={{ color: 'var(--gold)', fontWeight: 700 }}>← Volver a Comunidad</Link>
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
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>

      {/* Modales */}
      {showBorrar && (
        <ModalConfirmar
          onConfirmar={handleBorrar}
          onCancelar={() => setShowBorrar(false)}
          borrando={borrando}
        />
      )}
      {showEditar && (
        <ModalEditar
          post={post}
          onGuardar={handleEditar}
          onCancelar={() => setShowEditar(false)}
        />
      )}

      {/* Header */}
      <header style={{ background: 'var(--bg-card)', borderBottom: '2px solid var(--border-color)', padding: '0 20px', position: 'sticky', top: 0, zIndex: 100, height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <Link href="/comunidad" style={{ color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, textDecoration: 'none', flexShrink: 0 }}>← Comunidad</Link>
          <span style={{ background: tipoInfo.color, color: '#000', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 800, flexShrink: 0 }}>{tipoInfo.emoji} {tipoInfo.label}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
          <button onClick={handleLike} style={{ padding: '7px 13px', borderRadius: '20px', border: 'none', background: liked ? '#ef4444' : 'var(--bg-secondary)', color: liked ? '#fff' : 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            ❤️ {likesCount}
          </button>
          <button onClick={handleGuardar} style={{ padding: '7px 13px', borderRadius: '20px', border: 'none', background: guardado ? '#f5c842' : 'var(--bg-secondary)', color: guardado ? '#000' : 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            🔖 {guardado ? 'Guardado' : 'Guardar'}
          </button>

          {/* Menú dueño */}
          {esDueno && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setMenuAbierto(!menuAbierto)}
                style={{ width: '36px', height: '36px', borderRadius: '50%', border: '2px solid var(--border-color)', background: menuAbierto ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-muted)', fontSize: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}
              >
                ⋯
              </button>
              {menuAbierto && (
                <>
                  <div onClick={() => setMenuAbierto(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
                  <div style={{ position: 'absolute', right: 0, top: '44px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '8px', zIndex: 200, minWidth: '180px', boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}>
                    <button
                      onClick={() => { setMenuAbierto(false); setShowEditar(true); }}
                      style={{ width: '100%', padding: '11px 14px', borderRadius: '10px', border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      ✏️ Editar post
                    </button>
                    <div style={{ height: '1px', background: 'var(--border-color)', margin: '4px 0' }} />
                    <button
                      onClick={() => { setMenuAbierto(false); setShowBorrar(true); }}
                      style={{ width: '100%', padding: '11px 14px', borderRadius: '10px', border: 'none', background: 'transparent', color: '#ef4444', fontSize: '14px', fontWeight: 700, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#ef444415')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
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

      <div style={{ maxWidth: '800px', margin: '0 auto', padding: isMobile ? '16px' : '32px 24px' }}>

        {/* Info: SIN portada aquí dentro */}
        <div style={{ marginBottom: '24px' }}>
          {post.materia_nombre && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: `${post.materia_color}22`, border: `1px solid ${post.materia_color}44`, borderRadius: '20px', padding: '4px 12px', marginBottom: '12px' }}>
              <span>{post.materia_emoji}</span>
              <span style={{ fontSize: '12px', fontWeight: 700, color: post.materia_color }}>{post.materia_nombre}</span>
            </div>
          )}

          <h1 style={{ fontSize: isMobile ? '22px' : '30px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 10px', lineHeight: 1.25 }}>{post.titulo}</h1>

          {post.descripcion && (
            <p style={{ fontSize: '15px', color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.65 }}>{post.descripcion}</p>
          )}

          {/* Autor + stats */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', padding: '14px 16px', background: 'var(--bg-secondary)', borderRadius: '14px' }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
              onClick={() => window.location.href = `/u/${encodeURIComponent(post.user_id)}`}
            >
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 800, color: '#000', overflow: 'hidden', flexShrink: 0 }}>
                {post.user_avatar
                  ? <img src={post.user_avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={post.user_nombre} />
                  : post.user_nombre?.[0]?.toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', textDecoration: 'underline dotted' }}>{post.user_nombre}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
                  {new Date(post.created_at).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '14px', marginLeft: 'auto' }}>
              {[{ emoji: '👁️', val: post.views, label: 'vistas' }, { emoji: '📖', val: post.estudiados, label: 'estudiados' }, { emoji: '❤️', val: likesCount, label: 'likes' }].map((s, i) => (
                <div key={i} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '14px', fontWeight: 900, color: 'var(--text-primary)' }}>{s.emoji} {s.val}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-faint)' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Contenido */}
        <div style={{ background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)', padding: isMobile ? '16px' : '28px', marginBottom: '24px' }}>

          {/* APUNTE */}
          {post.tipo === 'apunte' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', paddingBottom: '14px', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '20px' }}>📝</span>
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Apunte</h3>
              </div>
              <ApuntePagesViewer contenido={post.contenido} />
            </div>
          )}

          {/* POST */}
          {post.tipo === 'post' && (
            <div style={{ fontSize: '15px', color: 'var(--text-primary)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
              {post.contenido?.texto || post.contenido?.contenido || post.descripcion || (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '40px', marginBottom: '8px' }}>💬</div>
                  <p style={{ margin: 0 }}>Post de la comunidad StudyAL</p>
                </div>
              )}
            </div>
          )}

          {/* FLASHCARDS */}
          {post.tipo === 'flashcards' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', paddingBottom: '14px', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '20px' }}>🎴</span>
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#a78bfa', margin: 0 }}>Flashcards ({flashcards.length})</h3>
              </div>
              {flashcards.length > 0
                ? <FlashcardsViewer cards={flashcards} />
                : <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}><div style={{ fontSize: '40px', marginBottom: '8px' }}>🎴</div><p>No hay flashcards disponibles</p></div>
              }
            </div>
          )}

          {/* QUIZ */}
          {post.tipo === 'quiz' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', paddingBottom: '14px', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '20px' }}>🧠</span>
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#34d399', margin: 0 }}>Quiz ({quiz.length} preguntas)</h3>
              </div>
              {quiz.length > 0
                ? <QuizViewer preguntas={quiz} onTerminar={() => registrarEstudiado()} />
                : <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}><div style={{ fontSize: '40px', marginBottom: '8px' }}>🧠</div><p>No hay preguntas disponibles</p></div>
              }
            </div>
          )}

          {/* VIDEO */}
          {post.tipo === 'video' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', paddingBottom: '14px', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '20px' }}>🎥</span>
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#ff4d6d', margin: 0 }}>Video de estudio</h3>
              </div>
              {post.video_url ? (
                <div style={{ borderRadius: '16px', overflow: 'hidden', background: '#000', position: 'relative' }}>
                  <video
                    src={post.video_url}
                    controls
                    playsInline
                    style={{
                      width: '100%',
                      maxHeight: '520px',
                      display: 'block',
                      objectFit: 'contain',
                      background: '#000',
                    }}
                  />
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '40px', marginBottom: '8px' }}>🎥</div>
                  <p>Video no disponible</p>
                </div>
              )}
              {post.descripcion && (
                <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '14px 0 0', lineHeight: 1.6 }}>
                  {post.descripcion}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Rating */}
        <div style={{ background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)', padding: '24px', marginBottom: '24px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 12px' }}>⭐ Califica este {tipoInfo.label.toLowerCase()}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            {userId
              ? <>
                  <StarSelector value={userRating} onChange={handleRating} />
                  {userRating > 0 && <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>Tu calificación: {userRating} ★</p>}
                </>
              : <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Inicia sesión para calificar</p>
            }
            {ratingsCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '24px', fontWeight: 900, color: '#f5c842' }}>{avgRating}</span>
                <div>
                  <div style={{ display: 'flex', gap: '2px' }}>
                    {[1,2,3,4,5].map(s => <span key={s} style={{ fontSize: '14px', color: s <= Math.round(avgRating) ? '#f5c842' : 'var(--border-color)' }}>★</span>)}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{ratingsCount} calificaciones</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Comentarios */}
        <div style={{ background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)', padding: isMobile ? '16px' : '28px' }}>
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
    </div>
  );
}
