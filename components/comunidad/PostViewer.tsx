'use client';
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import NoteRenderer from './NoteRenderer';
import EstudioModal from '../flashcards/EstudioModal';
import { supabase } from '../../lib/supabase';

// ─── Comentario individual — FUERA del componente principal ───
const ComentarioItem = memo(({ c, color, isOwner, userId, token, isReply, onLikeComentario, onBorrarComentario, onReply }: any) => {
  const esMio = c.user_id === userId;
  const puedeEliminar = esMio || isOwner;

  return (
    <div style={{ background: isReply ? '#0d0d0d' : '#111', borderRadius: '12px', padding: '12px 14px', border: '1px solid ' + (isReply ? '#1a1a1a' : '#222'), marginLeft: isReply ? '28px' : '0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', background: color, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 900, flexShrink: 0 }}>
          {(c.user_profiles?.nombre || 'E')[0].toUpperCase()}
        </div>
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#fff' }}>{c.user_profiles?.nombre || 'Estudiante'}</span>
        <span style={{ fontSize: '10px', color: '#555' }}>{new Date(c.created_at).toLocaleDateString()}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button onClick={() => onLikeComentario(c.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: c._liked ? '#ff4d6d' : '#555', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px', padding: '2px 4px' }}>
            {c._liked ? '❤️' : '🤍'} {c.likes || 0}
          </button>
          {!isReply && (
            <button onClick={() => onReply(c)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: '11px', padding: '2px 4px' }}>
              💬 Responder
            </button>
          )}
          {puedeEliminar && (
            <button onClick={() => onBorrarComentario(c.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#444', fontSize: '11px', padding: '2px 4px' }}>
              🗑️
            </button>
          )}
        </div>
      </div>
      <p style={{ color: '#ccc', fontSize: '13px', margin: 0, lineHeight: 1.5, wordBreak: 'break-word' }}>{c.texto}</p>
      {!isReply && c.respuestas?.length > 0 && (
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {c.respuestas.map((r: any) => (
            <ComentarioItem key={r.id} c={r} color={color} isOwner={isOwner} userId={userId} token={token} isReply
              onLikeComentario={onLikeComentario} onBorrarComentario={onBorrarComentario} onReply={onReply} />
          ))}
        </div>
      )}
    </div>
  );
});
ComentarioItem.displayName = 'ComentarioItem';

// ─── Sección de comentarios — FUERA del componente principal ───
const SeccionComentarios = memo(({ postId, postOwnerId, userId, token, color, isOwner, commentsDisabled, onToggleComments, isBot }: any) => {
  const [comentarios, setComentarios] = useState<any[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [show, setShow] = useState(false);
  const [replyTo, setReplyTo] = useState<any>(null);
  const [replyTexto, setReplyTexto] = useState('');
  const [enviandoReply, setEnviandoReply] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    if (!postId || isBot) return;
    const res = await fetch('/api/comunidad/comentarios?post_id=' + postId);
    const d = await res.json();
    setComentarios(d.data || []);
  }, [postId, isBot]);

  useEffect(() => { if (show) cargar(); }, [show, cargar]);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [comentarios]);

  const enviar = async () => {
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    const t = texto;
    setTexto('');
    try {
      const res = await fetch('/api/comunidad/comentarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ post_id: postId, texto: t }),
      });
      const d = await res.json();
      if (d.success) cargar(); else setTexto(t);
    } catch { setTexto(t); }
    setEnviando(false);
  };

  const enviarReply = async (parentId: string) => {
    if (!replyTexto.trim() || enviandoReply) return;
    setEnviandoReply(true);
    const t = replyTexto;
    setReplyTexto('');
    try {
      const res = await fetch('/api/comunidad/comentarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ post_id: postId, texto: t, parent_id: parentId }),
      });
      const d = await res.json();
      if (d.success) { cargar(); setReplyTo(null); } else setReplyTexto(t);
    } catch { setReplyTexto(t); }
    setEnviandoReply(false);
  };

  const likeComentario = async (comentarioId: string) => {
    if (isBot) return;
    const res = await fetch('/api/comunidad/comentarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ comentario_id: comentarioId, accion: 'like' }),
    });
    const d = await res.json();
    setComentarios(prev => prev.map(c => {
      if (c.id === comentarioId) return { ...c, likes: d.likes, _liked: d.liked };
      return { ...c, respuestas: (c.respuestas || []).map((r: any) => r.id === comentarioId ? { ...r, likes: d.likes, _liked: d.liked } : r) };
    }));
  };

  const borrarComentario = async (id: string) => {
    if (!confirm('¿Borrar comentario?')) return;
    await fetch(`/api/comunidad/comentarios?id=${id}&post_owner=${postOwnerId}`, {
      method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token },
    });
    cargar();
  };

  return (
    <div style={{ marginTop: '12px' }}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <button onClick={() => setShow(!show)}
          style={{ flex: 1, padding: '14px', borderRadius: '12px', border: '1px solid #222', background: '#111', color: '#888', fontWeight: 700, cursor: 'pointer', fontSize: '14px', textAlign: 'left' }}>
          💬 {show ? 'Ocultar' : 'Ver'} comentarios {comentarios.length > 0 ? `(${comentarios.length})` : ''}
        </button>
        {isOwner && (
          <button onClick={onToggleComments}
            style={{ padding: '10px 14px', borderRadius: '12px', border: '1px solid #333', background: 'transparent', color: commentsDisabled ? '#ff4d6d' : '#555', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
            {commentsDisabled ? '🔒 Activar' : '🔓 Desactivar'}
          </button>
        )}
      </div>

      {show && (
        <div>
          {commentsDisabled && !isOwner ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#555', background: '#111', borderRadius: '12px', border: '1px solid #222', fontSize: '13px' }}>
              🔒 El autor desactivó los comentarios
            </div>
          ) : (
            <>
              <div ref={ref} style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                {comentarios.length === 0
                  ? <p style={{ color: '#555', textAlign: 'center', padding: '24px 0', fontSize: '13px' }}>Sin comentarios. ¡Sé el primero!</p>
                  : comentarios.map((c: any) => (
                    <div key={c.id}>
                      <ComentarioItem c={c} color={color} isOwner={isOwner} userId={userId} token={token} isReply={false}
                        onLikeComentario={likeComentario} onBorrarComentario={borrarComentario} onReply={setReplyTo} />
                      {replyTo?.id === c.id && (
                        <div style={{ marginTop: '6px', marginLeft: '28px', display: 'flex', gap: '6px' }}>
                          <textarea
                            value={replyTexto}
                            onChange={e => setReplyTexto(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarReply(c.id); } }}
                            placeholder={'Responder a ' + (c.user_profiles?.nombre || 'Estudiante') + '...'}
                            rows={2}
                            style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontSize: '12px', outline: 'none', resize: 'none', fontFamily: 'inherit' }}
                          />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <button onClick={() => enviarReply(c.id)} disabled={!replyTexto.trim()}
                              style={{ padding: '8px 12px', borderRadius: '8px', border: 'none', background: replyTexto.trim() ? color : '#333', color: replyTexto.trim() ? '#000' : '#555', fontWeight: 800, cursor: 'pointer', fontSize: '12px' }}>
                              {enviandoReply ? '...' : '↩'}
                            </button>
                            <button onClick={() => { setReplyTo(null); setReplyTexto(''); }}
                              style={{ padding: '6px', borderRadius: '8px', border: '1px solid #333', background: 'transparent', color: '#555', fontSize: '11px', cursor: 'pointer' }}>✕</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                }
              </div>
              {!commentsDisabled && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                  <textarea
                    value={texto}
                    onChange={e => setTexto(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                    placeholder="Escribe tu comentario... (Enter para enviar)"
                    rows={2}
                    style={{ flex: 1, padding: '10px 14px', borderRadius: '10px', border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontSize: '13px', outline: 'none', resize: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
                  />
                  <button onClick={enviar} disabled={!texto.trim() || enviando}
                    style={{ padding: '10px 16px', borderRadius: '10px', border: 'none', background: texto.trim() ? color : '#333', color: texto.trim() ? '#000' : '#555', fontWeight: 800, cursor: texto.trim() ? 'pointer' : 'not-allowed', height: '44px', flexShrink: 0 }}>
                    {enviando ? '...' : '→'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});
SeccionComentarios.displayName = 'SeccionComentarios';

// ─── Rating — FUERA del componente principal ──────────────
const SeccionRating = memo(({ myRating, ratingSum, ratingCount, onRate }: any) => {
  const avg = ratingCount > 0 ? (ratingSum / ratingCount).toFixed(1) : null;
  return (
    <div style={{ padding: '20px', background: '#111', borderRadius: '16px', border: '1px solid #222', marginBottom: '12px' }}>
      {avg && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '8px 12px', background: '#1a1500', borderRadius: '10px', border: '1px solid #f5c84233' }}>
          <span style={{ fontSize: '16px' }}>⭐</span>
          <span style={{ fontSize: '18px', fontWeight: 900, color: '#f5c842' }}>{avg}</span>
          <span style={{ fontSize: '11px', color: '#888' }}>de {ratingCount} {ratingCount === 1 ? 'valoración' : 'valoraciones'}</span>
        </div>
      )}
      <p style={{ color: '#888', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', margin: '0 0 10px' }}>⭐ Tu valoración</p>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        {[1,2,3,4,5].map(r => (
          <button key={r} onClick={() => onRate(r)}
            style={{ fontSize: '28px', background: 'none', border: 'none', cursor: 'pointer', opacity: r <= myRating ? 1 : 0.25, transition: 'all 0.15s', lineHeight: 1, transform: r <= myRating ? 'scale(1.15)' : 'scale(1)', padding: '2px' }}>
            ⭐
          </button>
        ))}
        {myRating > 0 && <span style={{ fontSize: '12px', color: '#f5c842', fontWeight: 700, marginLeft: '8px' }}>¡{myRating}★!</span>}
      </div>
    </div>
  );
});
SeccionRating.displayName = 'SeccionRating';

// ─── Componente principal ──────────────────────────────────
export default function PostViewer({ post, userId, onClose, onDelete, onUnsave }: any) {
  const [token, setToken] = useState('');
  const [likes, setLikes] = useState(post.likes || 0);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(post._saved || false);
  const [savingInProgress, setSavingInProgress] = useState(false);
  const [likingInProgress, setLikingInProgress] = useState(false);
  const [myRating, setMyRating] = useState(0);
  const [ratingSum, setRatingSum] = useState(post.rating_sum || 0);
  const [ratingCount, setRatingCount] = useState(post.rating_count || 0);
  const [views, setViews] = useState(post.views || 0);
  const [commentsDisabled, setCommentsDisabled] = useState(post.comments_disabled || false);
  const [quizIdx, setQuizIdx] = useState(0);
  const [quizSel, setQuizSel] = useState<number | null>(null);
  const [quizResp, setQuizResp] = useState(false);
  const [quizPuntos, setQuizPuntos] = useState(0);
  const [quizFin, setQuizFin] = useState(false);
  const [fcIdx, setFcIdx] = useState(0);
  const [fcFlipped, setFcFlipped] = useState(false);
  const [flashMode, setFlashMode] = useState<'preview' | 'study'>('preview');
  const [showReport, setShowReport] = useState(false);
  const [reportMotivo, setReportMotivo] = useState('');
  const [reportSent, setReportSent] = useState(false);
  const [haEstudiado, setHaEstudiado] = useState(false);

  const isOwner = post.user_id === userId;
  const isBot = post._bot;
  const autor = post.user_id === userId ? 'Tú' : (post.user_profiles?.nombre || 'Estudiante');
  const avatar = post.user_profiles?.avatar_url || post.user_profiles?.foto_url;
  const inicial = autor[0]?.toUpperCase() || '?';
  const color = post.color || '#f5c842';
  const fecha = post.created_at ? new Date(post.created_at).toLocaleDateString() : '';
  const isApunte = post.tipo === 'apunte';
  const isQuiz = post.tipo === 'quiz' || post.contenido?.tipo === 'quiz';
  const isFlash = post.tipo === 'flashcard' || post.tipo === 'flashcards' || post.contenido?.tipo === 'flashcard';
  const preguntas = post.contenido?.preguntas || [];
  const flashcards = post.contenido?.flashcards || [];
  const avgRating = ratingCount > 0 ? (ratingSum / ratingCount).toFixed(1) : null;
  const tipoLabel = isQuiz ? '🤓 Quiz' : isFlash ? '🎴 Flashcards' : '📝 Apunte';

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const t = data.session?.access_token || '';
      const uid = data.session?.user.id || '';
      setToken(t);
      if (!isBot && post.id && uid) {
        const [likeRes, savedRes, ratingRes] = await Promise.all([
          supabase.from('post_likes').select('id').eq('post_id', post.id).eq('user_id', uid).maybeSingle(),
          supabase.from('post_favorites').select('id').eq('post_id', post.id).eq('user_id', uid).maybeSingle(),
          supabase.from('post_ratings').select('rating').eq('post_id', post.id).eq('user_id', uid).maybeSingle(),
        ]);
        setLiked(!!likeRes.data);
        if (!post._saved) setSaved(!!savedRes.data);
        if (ratingRes.data) setMyRating(ratingRes.data.rating);
      }
    });
    if (!isBot && post.id) {
      fetch('/api/comunidad/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ post_id: post.id }) })
        .then(() => setViews((v: number) => v + 1)).catch(() => {});
    }
    if (isApunte) setHaEstudiado(true);
  }, []);

  useEffect(() => { if (quizFin) setHaEstudiado(true); }, [quizFin]);

  const handleLike = async () => {
    if (isBot) { setLiked(!liked); setLikes((l: number) => liked ? l - 1 : l + 1); return; }
    const newLiked = !liked;
    setLiked(newLiked);
    setLikes((l: number) => newLiked ? l + 1 : Math.max(0, l - 1));
    try {
      const res = await fetch('/api/comunidad/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ post_id: post.id }),
      });
      const d = await res.json();
      setLiked(d.liked);
      if (d.likes !== undefined) setLikes(d.likes);
    } catch { setLiked(!newLiked); setLikes((l: number) => newLiked ? Math.max(0, l - 1) : l + 1); }
  };

  const handleSave = async () => {
    if (isBot) { setSaved(!saved); return; }
    const newSaved = !saved;
    setSaved(newSaved);
    try {
      const res = await fetch('/api/comunidad/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ post_id: post.id }),
      });
      const d = await res.json();
      setSaved(d.saved);
    } catch { setSaved(!newSaved); }
  };

  const handleRating = async (r: number) => {
    setMyRating(r);
    if (isBot) return;
    try {
      const res = await fetch('/api/comunidad/rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ post_id: post.id, rating: r }),
      });
      const d = await res.json();
      if (d.rating_sum !== undefined) { setRatingSum(d.rating_sum); setRatingCount(d.rating_count); }
    } catch {}
  };

  const handleBorrar = async () => {
    if (!confirm('¿Borrar esta publicación?')) return;
    await fetch('/api/comunidad/post?id=' + post.id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
    onDelete(post.id);
    onClose();
  };

  const handleReport = async () => {
    await fetch('/api/user/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ reported_user_id: post.user_id, reported_post_id: post.id, motivo: reportMotivo }),
    });
    setReportSent(true);
  };

  const handleToggleComments = async () => {
    const newVal = !commentsDisabled;
    setCommentsDisabled(newVal);
    await supabase.from('comunidad_posts').update({ comments_disabled: newVal }).eq('id', post.id);
  };

  const qPregunta = preguntas[quizIdx];
  const quizResponder = (i: number) => {
    if (quizResp) return;
    setQuizSel(i); setQuizResp(true);
    if (i === qPregunta.correcta) setQuizPuntos(p => p + 1);
  };
  const quizSiguiente = () => {
    if (quizIdx + 1 >= preguntas.length) { setQuizFin(true); return; }
    setQuizIdx(i => i + 1); setQuizSel(null); setQuizResp(false);
  };
  const quizReiniciar = () => { setQuizIdx(0); setQuizSel(null); setQuizResp(false); setQuizPuntos(0); setQuizFin(false); };

  if (flashMode === 'study' && isFlash) {
    return <EstudioModal flashcards={flashcards} temaColor={color} materiaNombre={post.materia} materiaColor={color}
      onClose={() => { setFlashMode('preview'); setHaEstudiado(true); }} />;
  }

  const BannerEstudia = () => (
    <div style={{ marginTop: '32px', padding: '24px', background: '#0d0d0d', borderRadius: '16px', border: '1px dashed #333', textAlign: 'center' }}>
      <div style={{ fontSize: '32px', marginBottom: '10px' }}>🔒</div>
      <p style={{ color: '#aaa', fontWeight: 800, fontSize: '15px', margin: '0 0 6px' }}>
        {isQuiz ? 'Completa el quiz para comentar y valorar' : 'Usa el modo Estudiar para comentar y valorar'}
      </p>
      <p style={{ color: '#555', fontSize: '12px', margin: 0 }}>
        {isQuiz ? 'Responde todas las preguntas' : 'Haz click en ✍️ Estudiar y completa la sesión'}
      </p>
    </div>
  );

  const SeccionInteraccion = () => (
    <>
      <SeccionRating myRating={myRating} ratingSum={ratingSum} ratingCount={ratingCount} onRate={handleRating} />
      <SeccionComentarios
        postId={post.id} postOwnerId={post.user_id} userId={userId} token={token}
        color={color} isOwner={isOwner} commentsDisabled={commentsDisabled}
        onToggleComments={handleToggleComments} isBot={isBot}
      />
    </>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px' }}>
      <div style={{ background: '#0a0a0a', width: '100vw', maxWidth: '1400px', height: '95vh', borderRadius: '24px', border: '1px solid #222', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* HEADER */}
        <div style={{ padding: '14px 24px', borderBottom: '1px solid #1a1a1a', background: '#111', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
            <div onClick={() => { if (post.user_id && !isBot) window.location.href = '/perfil-publico?uid=' + post.user_id; }}
              style={{ cursor: isBot ? 'default' : 'pointer', flexShrink: 0 }}>
              {avatar
                ? <img src={avatar} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} alt="" />
                : <div style={{ width: 36, height: 36, borderRadius: '50%', background: color, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 900 }}>{inicial}</div>
              }
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span onClick={() => { if (post.user_id && !isBot) window.location.href = '/perfil-publico?uid=' + post.user_id; }}
                  style={{ fontSize: '14px', fontWeight: 800, color: '#fff', cursor: isBot ? 'default' : 'pointer', textDecoration: isBot ? 'none' : 'underline' }}>{autor}</span>
                <span style={{ fontSize: '10px', color: color, fontWeight: 700, background: color + '15', padding: '2px 8px', borderRadius: '6px' }}>{post.emoji} {post.materia}</span>
                <span style={{ fontSize: '10px', color: '#555' }}>{tipoLabel} · {fecha}</span>
                <span style={{ fontSize: '10px', color: '#555' }}>👁️ {views}</span>
                {avgRating && <span style={{ fontSize: '11px', color: '#f5c842', fontWeight: 700 }}>⭐ {avgRating} ({ratingCount})</span>}
              </div>
              <h2 style={{ color: '#fff', fontSize: '16px', fontWeight: 800, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.titulo}</h2>
            </div>
          </div>
          <button onClick={onClose} style={{ background: '#222', border: 'none', color: '#fff', width: '34px', height: '34px', borderRadius: '50%', cursor: 'pointer', fontSize: '15px', flexShrink: 0 }}>✕</button>
        </div>

        {post.descripcion && (
          <div style={{ padding: '10px 24px', borderBottom: '1px solid #1a1a1a', background: '#0d0d0d' }}>
            <p style={{ color: '#aaa', fontSize: '13px', margin: 0 }}>{post.descripcion}</p>
          </div>
        )}

        {/* CONTENIDO */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', background: '#050505' }}>
          <div style={{ width: '100%', maxWidth: '900px', margin: '0 auto' }}>

            {isApunte && (
              <>
                {post.contenido?.paginas?.length > 0
                  ? post.contenido.paginas.map((pag: any, idx: number) => <NoteRenderer key={pag.id || idx} pagina={pag} postContenido={post.contenido} />)
                  : <div style={{ textAlign: 'center', padding: '60px', color: '#555' }}><div style={{ fontSize: '48px' }}>📝</div><p>Sin contenido visible</p></div>
                }
                <SeccionInteraccion />
              </>
            )}

            {isQuiz && preguntas.length > 0 && !quizFin && qPregunta && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <span style={{ fontSize: '13px', color: '#888' }}>{quizIdx + 1} / {preguntas.length}</span>
                  <span style={{ fontSize: '13px', color: '#4ade80', fontWeight: 700 }}>✓ {quizPuntos}</span>
                </div>
                <div style={{ height: '6px', background: '#222', borderRadius: '3px', marginBottom: '24px', overflow: 'hidden' }}>
                  <div style={{ width: `${((quizIdx + (quizResp ? 1 : 0)) / preguntas.length) * 100}%`, height: '100%', background: color, transition: 'width 0.4s' }} />
                </div>
                <div style={{ background: '#111', borderRadius: '16px', border: '2px solid ' + color + '33', padding: '24px', marginBottom: '16px' }}>
                  <span style={{ fontSize: '11px', color: color, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px' }}>Pregunta {quizIdx + 1}</span>
                  <p style={{ fontSize: '18px', fontWeight: 700, color: '#fff', margin: '10px 0 0', lineHeight: 1.5 }}>{qPregunta.pregunta}</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                  {qPregunta.opciones?.map((op: string, i: number) => {
                    const isCorrect = i === qPregunta.correcta;
                    const isSel = i === quizSel;
                    return (
                      <button key={i} onClick={() => quizResponder(i)} disabled={quizResp}
                        style={{ padding: '14px 18px', borderRadius: '12px', border: !quizResp ? '2px solid #333' : isCorrect ? '2px solid #4ade80' : isSel ? '2px solid #ff4d6d' : '2px solid #222', background: !quizResp ? '#1a1a1a' : isCorrect ? 'rgba(74,222,128,0.12)' : isSel ? 'rgba(255,77,109,0.12)' : '#1a1a1a', color: '#fff', fontSize: '14px', cursor: quizResp ? 'default' : 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
                        <span style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 800, background: !quizResp ? '#333' : isCorrect ? '#4ade80' : isSel ? '#ff4d6d' : '#333', color: (!quizResp || (!isCorrect && !isSel)) ? '#aaa' : '#000' }}>
                          {!quizResp ? ['A','B','C','D'][i] : isCorrect ? '✓' : isSel ? '✗' : ['A','B','C','D'][i]}
                        </span>
                        {op}
                      </button>
                    );
                  })}
                </div>
                {quizResp && (
                  <>
                    <div style={{ background: quizSel === qPregunta.correcta ? '#4ade8010' : '#ff4d6d10', border: '1px solid ' + (quizSel === qPregunta.correcta ? '#4ade8044' : '#ff4d6d44'), borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
                      <p style={{ fontSize: '12px', fontWeight: 800, color: quizSel === qPregunta.correcta ? '#4ade80' : '#ff4d6d', margin: '0 0 4px' }}>{quizSel === qPregunta.correcta ? '✓ ¡Correcto!' : '✗ Incorrecto'}</p>
                      <p style={{ fontSize: '13px', color: '#aaa', margin: 0 }}>{qPregunta.explicacion}</p>
                    </div>
                    <button onClick={quizSiguiente} style={{ width: '100%', padding: '14px', borderRadius: '12px', border: 'none', background: color, color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                      {quizIdx + 1 >= preguntas.length ? '🏁 Ver resultados y opinar' : 'Siguiente →'}
                    </button>
                  </>
                )}
                <BannerEstudia />
              </div>
            )}

            {isQuiz && quizFin && (
              <div>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                  <div style={{ fontSize: '64px', marginBottom: '12px' }}>{quizPuntos / preguntas.length >= 0.8 ? '🏆' : '📚'}</div>
                  <h2 style={{ color: '#fff', fontWeight: 900, fontSize: '28px', margin: '0 0 8px' }}>¡Quiz completado!</h2>
                  <div style={{ fontSize: '56px', fontWeight: 900, color: quizPuntos / preguntas.length >= 0.8 ? '#4ade80' : '#f5c842' }}>{Math.round((quizPuntos / preguntas.length) * 100)}%</div>
                  <p style={{ color: '#888', margin: '8px 0 24px' }}>{quizPuntos} / {preguntas.length} correctas</p>
                  <button onClick={quizReiniciar} style={{ padding: '14px 32px', borderRadius: '12px', border: 'none', background: color, color: '#000', fontWeight: 800, cursor: 'pointer' }}>🔄 Repetir</button>
                </div>
                <SeccionInteraccion />
              </div>
            )}

            {isFlash && flashcards.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '18px', flexWrap: 'wrap' }}>
                  <button onClick={() => setFlashMode('preview')} style={{ padding: '10px 18px', borderRadius: '10px', border: 'none', background: color, color: '#000', fontWeight: 800, cursor: 'pointer' }}>👁️ Leer</button>
                  <button onClick={() => setFlashMode('study')} style={{ padding: '10px 18px', borderRadius: '10px', border: '2px solid #38bdf8', background: 'transparent', color: '#38bdf8', fontWeight: 700, cursor: 'pointer' }}>✍️ Estudiar</button>
                </div>
                <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                  <span style={{ background: color, color: '#000', padding: '4px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 800 }}>{fcIdx + 1} / {flashcards.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '20px', flexWrap: 'wrap' }}>
                  {flashcards.map((_: any, i: number) => (
                    <div key={i} onClick={() => { setFcIdx(i); setFcFlipped(false); }}
                      style={{ width: i === fcIdx ? '20px' : '8px', height: '8px', borderRadius: '4px', background: i === fcIdx ? color : '#333', cursor: 'pointer', transition: 'all 0.3s' }} />
                  ))}
                </div>
                <div onClick={() => setFcFlipped(!fcFlipped)}
                  style={{ background: '#111', borderRadius: '20px', border: '2px solid ' + color + '33', minHeight: '220px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', cursor: 'pointer', position: 'relative' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: fcFlipped ? '#ff4d6d' : color }} />
                  <div style={{ position: 'absolute', top: '14px', left: '14px', background: fcFlipped ? '#ff4d6d' : color, color: '#000', padding: '3px 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 800 }}>{fcFlipped ? 'RESPUESTA' : 'PREGUNTA'}</div>
                  <p style={{ fontSize: '20px', fontWeight: 700, color: '#fff', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>{fcFlipped ? flashcards[fcIdx]?.answer : flashcards[fcIdx]?.question}</p>
                  <p style={{ color: '#555', fontSize: '11px', marginTop: '16px' }}>Toca para voltear</p>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '16px' }}>
                  <button onClick={() => { setFcIdx(Math.max(0, fcIdx - 1)); setFcFlipped(false); }} style={{ padding: '10px 24px', borderRadius: '10px', border: '2px solid #333', background: 'transparent', color: '#888', fontWeight: 700, cursor: 'pointer' }}>⬅️</button>
                  <button onClick={() => { setFcIdx(Math.min(flashcards.length - 1, fcIdx + 1)); setFcFlipped(false); }} style={{ padding: '10px 24px', borderRadius: '10px', border: '2px solid #333', background: 'transparent', color: '#888', fontWeight: 700, cursor: 'pointer' }}>➡️</button>
                </div>
                {!haEstudiado ? <BannerEstudia /> : <SeccionInteraccion />}
              </div>
            )}
          </div>
        </div>

        {/* FOOTER */}
        <div style={{ padding: '12px 24px', background: '#111', borderTop: '1px solid #1a1a1a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button onClick={handleLike}
              style={{ padding: '8px 14px', borderRadius: '10px', border: liked ? '2px solid #ff4d6d' : '2px solid #333', background: liked ? '#ff4d6d15' : 'transparent', color: liked ? '#ff4d6d' : '#888', fontSize: '13px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}>
              {liked ? '❤️' : '🤍'} {likes}
            </button>
            <button
              onClick={handleSave}
              disabled={savingInProgress}
              style={{
                padding: '8px 14px', borderRadius: '10px',
                border: saved ? '2px solid #4ade80' : '2px solid #333',
                background: saved ? '#4ade8015' : 'transparent',
                color: savingInProgress ? '#555' : saved ? '#4ade80' : '#888',
                fontSize: '13px', fontWeight: 700,
                cursor: savingInProgress ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
                opacity: savingInProgress ? 0.6 : 1,
              }}>
              {savingInProgress ? '⏳' : saved ? '🔖 Guardado' : '📌 Guardar'}
            </button>
            {saved && (
              <button onClick={() => window.location.href = '/guardados'}
                style={{ padding: '8px 12px', borderRadius: '10px', border: '2px solid #333', background: 'transparent', color: '#666', fontSize: '12px', cursor: 'pointer' }}>
                Ver todos →
              </button>
            )}
            {!isBot && !isOwner && (
              <button onClick={() => setShowReport(true)}
                style={{ padding: '8px 10px', borderRadius: '10px', border: '2px solid #333', background: 'transparent', color: '#888', fontSize: '13px', cursor: 'pointer' }}>⚑</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {isOwner && !isBot && (
              <button onClick={handleBorrar}
                style={{ padding: '8px 14px', borderRadius: '10px', border: '1px solid #ff4d6d44', background: 'transparent', color: '#ff4d6d', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>🗑️ Borrar</button>
            )}
            <button onClick={onClose}
              style={{ padding: '8px 18px', borderRadius: '10px', background: '#222', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>Cerrar</button>
          </div>
        </div>
      </div>

      {showReport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '16px' }}>
          <div style={{ background: '#111', borderRadius: '20px', padding: '24px', width: '100%', maxWidth: '360px', border: '1px solid #333' }}>
            {reportSent ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
                <h3 style={{ color: '#fff', margin: '0 0 8px' }}>Reporte enviado</h3>
                <button onClick={() => { setShowReport(false); setReportSent(false); }} style={{ padding: '10px 24px', borderRadius: '10px', border: 'none', background: color, color: '#000', fontWeight: 800, cursor: 'pointer' }}>Cerrar</button>
              </div>
            ) : (
              <>
                <h3 style={{ color: '#fff', margin: '0 0 16px', fontWeight: 800 }}>🚨 Reportar publicación</h3>
                {['Contenido inapropiado', 'Spam', 'Plagio', 'Información falsa', 'Otro'].map(m => (
                  <button key={m} onClick={() => setReportMotivo(m)}
                    style={{ display: 'block', width: '100%', padding: '10px', borderRadius: '8px', border: '2px solid ' + (reportMotivo === m ? '#ef4444' : '#333'), background: reportMotivo === m ? '#ef444415' : 'transparent', color: reportMotivo === m ? '#ef4444' : '#aaa', fontWeight: 600, cursor: 'pointer', marginBottom: '6px', textAlign: 'left' }}>
                    {m}
                  </button>
                ))}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button onClick={() => setShowReport(false)} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '2px solid #333', background: 'transparent', color: '#888', fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
                  <button onClick={handleReport} disabled={!reportMotivo}
                    style={{ flex: 2, padding: '10px', borderRadius: '10px', border: 'none', background: reportMotivo ? '#ef4444' : '#333', color: reportMotivo ? '#fff' : '#555', fontWeight: 800, cursor: reportMotivo ? 'pointer' : 'not-allowed' }}>
                    Reportar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
