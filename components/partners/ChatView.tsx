'use client';

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { PartnerInfo, Message, PendingAttachment } from './types';
import { Av, fmtSize } from './helpers';
import { ImageViewer, ReportModal } from './Modals';
import SavedModal from './SavedModal';
import PartnerProfileModal from './PartnerProfileModal';
import MessageBubble from './MessageBubble';

const HAND = "'Caveat',cursive";

export default function ChatView({ partner, miUserId, miInfo, onBack, onChatDeleted, token, isMobile, wallpaper, chatId: initChatId }: {
  partner: PartnerInfo;
  miUserId: string;
  miInfo: PartnerInfo;
  onBack: () => void;
  onChatDeleted: () => void;
  token: string;
  isMobile: boolean;
  wallpaper?: string;
  chatId?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [savedMsgs, setSavedMsgs] = useState<Message[]>([]);
  const [chatIdState, setChatIdState] = useState(initChatId || '');
  const [chatData, setChatData] = useState<any>(null);
  const [input, setInput] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [grabando, setGrabando] = useState(false);
  const [viewImage, setViewImage] = useState<{ url: string; id: string } | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showWallpaper, setShowWallpaper] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [copiedNotif, setCopiedNotif] = useState(false);
  const [jumpedMsgId, setJumpedMsgId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wpRef = useRef<HTMLInputElement>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);

  const messageNodeMap = useRef<Record<string, HTMLDivElement | null>>({});
  const lastSignatureRef = useRef('');
  const lastSavedRef = useRef('');
  const lastWallpaperRef = useRef('');
  const pendingScrollRef = useRef<{ mode: 'none' | 'preserve' | 'bottom'; top?: number }>({ mode: 'none' });
  const mountedRef = useRef(false);

  const buildMsgSignature = (msgs: Message[]) =>
    JSON.stringify(
      msgs.map(m => [
        m.id, m.content, m.type, m.edited_at, m.deleted_at, m.read_at, m.expires_at,
        m.file_url, m.file_name, m.metadata?.reply_to || null, m.metadata?.reply_preview || null,
      ])
    );

  const jumpToMessage = (id: string) => {
    const el = messageNodeMap.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setJumpedMsgId(id);
    setTimeout(() => setJumpedMsgId(prev => (prev === id ? null : prev)), 1800);
  };

  const cargar = useCallback(async (opts?: { forceBottom?: boolean }) => {
    const container = messagesRef.current;
    const currentTop = container?.scrollTop ?? 0;
    const nearBottom = container
      ? (container.scrollHeight - container.scrollTop - container.clientHeight) < 120
      : true;

    const res = await fetch(`/api/partner-chat?partnerId=${partner.user_id}&saved=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.success) return;

    const newMessages: Message[] = data.messages || [];
    const newSaved: string[] = data.saved || [];
    const newWallpaper = data.chat?.wallpaper_url || '';

    const msgSig = buildMsgSignature(newMessages);
    const savedSig = JSON.stringify(newSaved);

    const nothingChanged =
      msgSig === lastSignatureRef.current &&
      savedSig === lastSavedRef.current &&
      newWallpaper === lastWallpaperRef.current;

    if (nothingChanged) return;

    if (!mountedRef.current || opts?.forceBottom) {
      pendingScrollRef.current = { mode: 'bottom' };
    } else if (nearBottom) {
      pendingScrollRef.current = { mode: 'bottom' };
    } else {
      pendingScrollRef.current = { mode: 'preserve', top: currentTop };
    }

    lastSignatureRef.current = msgSig;
    lastSavedRef.current = savedSig;
    lastWallpaperRef.current = newWallpaper;

    setMessages(newMessages);
    setSaved(newSaved);
    if (data.chatId) setChatIdState(data.chatId);
    if (data.chat) setChatData(data.chat);
    setSavedMsgs(newMessages.filter(m => newSaved.includes(m.id)));
  }, [partner.user_id, token]);

  useLayoutEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    const pending = pendingScrollRef.current;
    if (pending.mode === 'preserve' && typeof pending.top === 'number') {
      container.scrollTop = pending.top;
    } else if (pending.mode === 'bottom') {
      bottomRef.current?.scrollIntoView({ behavior: mountedRef.current ? 'smooth' : 'auto' });
    }
    pendingScrollRef.current = { mode: 'none' };
  }, [messages, saved]);

  useEffect(() => {
    cargar({ forceBottom: true }).then(() => { mountedRef.current = true; });
    const iv = setInterval(() => { cargar(); }, 4000);
    return () => clearInterval(iv);
  }, [cargar]);

  const subirYEnviar = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { alert('Máx 10MB'); return null; }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('folder', 'partner-files');
    const res = await fetch('/api/partner-upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok || !data.success) { alert('Error: ' + (data.error || '?')); return null; }
    return data;
  };

  const enviarTodo = async () => {
    const texto = input.trim();
    if (!texto && pendingFiles.length === 0) return;
    setEnviando(true);

    for (const pf of pendingFiles) {
      const uploaded = await subirYEnviar(pf.file);
      if (uploaded) {
        const body: any = {
          partnerId: partner.user_id,
          content: pf.name,
          type: pf.type,
          file_url: uploaded.url,
          file_name: pf.name,
          file_size: pf.size,
        };
        if (replyTo) {
          body.metadata = {
            reply_to: replyTo.id,
            reply_preview: replyTo.content?.slice(0, 80) || replyTo.file_name || replyTo.type,
          };
        }
        await fetch('/api/partner-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
      }
    }

    if (texto) {
      const body: any = { partnerId: partner.user_id, content: texto, type: 'text' };
      if (replyTo && pendingFiles.length === 0) {
        body.metadata = {
          reply_to: replyTo.id,
          reply_preview: replyTo.content?.slice(0, 80) || replyTo.file_name || replyTo.type,
        };
      }
      await fetch('/api/partner-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    }

    setPendingFiles([]);
    setInput('');
    setReplyTo(null);
    await cargar({ forceBottom: true });
    setEnviando(false);
    inputRef.current?.focus();
  };

  const addPendingFile = (file: File) => {
    const tipo: 'image' | 'audio' | 'file' =
      file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('audio/') ? 'audio'
      : 'file';
    const att: PendingAttachment = {
      id: Math.random().toString(36).slice(2),
      file, type: tipo,
      name: file.name, size: file.size,
    };
    if (tipo === 'image') att.preview = URL.createObjectURL(file);
    setPendingFiles(prev => [...prev, att]);
  };

  const removePending = (id: string) => {
    setPendingFiles(prev => {
      const item = prev.find(p => p.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return prev.filter(p => p.id !== id);
    });
  };

  const editarMsg = async (id: string, content: string) => {
    if (!content.trim()) return;
    await fetch('/api/partner-chat', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message_id: id, action: 'edit', content: content.trim() }),
    });
    await cargar();
  };

  const borrarMsg = async (id: string) => {
    if (!confirm('¿Eliminar?')) return;
    await fetch('/api/partner-chat', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message_id: id, action: 'delete' }),
    });
    await cargar();
  };

  const guardarMsg = async (id: string) => {
    const res = await fetch('/api/partner-chat', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message_id: id, action: 'save', chat_id: chatIdState }),
    });
    const data = await res.json();
    if (data.success) await cargar();
  };

  const copyText = (t: string) => {
    navigator.clipboard.writeText(t);
    setCopiedNotif(true);
    setTimeout(() => setCopiedNotif(false), 1500);
  };

  const borrarChat = async () => {
    if (!chatIdState || !confirm(`¿Borrar chat con ${partner.nombre}?`)) return;
    await fetch(`/api/partner-chat?chatId=${chatIdState}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    onChatDeleted();
  };

  const setWallpaperFn = async (file?: File) => {
    if (!chatIdState) return;
    if (!file) {
      await fetch('/api/partner-chat', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'set_wallpaper', chat_id: chatIdState, wallpaper_url: '' }),
      });
      setChatData((prev: any) => prev ? { ...prev, wallpaper_url: null, wallpaper_set_by: null } : prev);
      setShowWallpaper(false);
      setTimeout(async () => { await cargar(); }, 300);
      return;
    }
    if (file.size > 5 * 1024 * 1024) { alert('Máx 5MB'); return; }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('folder', 'wallpapers');
    const res = await fetch('/api/partner-upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok || !data.success) { alert('Error subiendo'); return; }
    await fetch('/api/partner-chat', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'set_wallpaper', chat_id: chatIdState, wallpaper_url: data.url }),
    });
    await cargar();
    setShowWallpaper(false);
  };

  const toggleGrabar = async () => {
    if (grabando) { mediaRecRef.current?.stop(); setGrabando(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = e => chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        addPendingFile(new File([new Blob(chunksRef.current, { type: 'audio/webm' })], `audio_${Date.now()}.webm`, { type: 'audio/webm' }));
      };
      rec.start();
      mediaRecRef.current = rec;
      setGrabando(true);
    } catch {
      alert('Sin acceso al micrófono');
    }
  };

  const wp = typeof chatData?.wallpaper_url !== 'undefined' ? chatData.wallpaper_url : wallpaper;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>

      {/* Notif copiado */}
      {copiedNotif && (
        <div style={{
          position: 'fixed', top: 80, left: '50%',
          transform: 'translateX(-50%) rotate(-2deg)',
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 10,
          padding: '10px 20px',
          zIndex: 9998,
          fontFamily: HAND, fontSize: 17, fontWeight: 800,
          color: 'var(--text-primary)',
          boxShadow: '3px 4px 0 var(--gold)',
          fontStyle: 'italic',
        }}>
          📋 ~ copiado ~
        </div>
      )}

      {viewImage && (
        <ImageViewer
          src={viewImage.url}
          messageId={viewImage.id}
          isSaved={saved.includes(viewImage.id)}
          onSave={guardarMsg}
          onClose={() => setViewImage(null)}
        />
      )}

      {showReport && <ReportModal partner={partner} token={token} onClose={() => setShowReport(false)} />}

      {showProfile && (
        <PartnerProfileModal
          partner={partner}
          savedMsgs={savedMsgs}
          onOpenSaved={() => { setShowProfile(false); setShowSaved(true); }}
          onClose={() => setShowProfile(false)}
        />
      )}

      {showSaved && (
        <SavedModal
          savedMsgs={savedMsgs}
          onGuardar={guardarMsg}
          onViewImage={(url, id) => { setShowSaved(false); setViewImage({ url, id }); }}
          onClose={() => setShowSaved(false)}
        />
      )}

      {/* Modal wallpaper */}
      {showWallpaper && (
        <div onClick={() => setShowWallpaper(false)} style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.78)',
          backdropFilter: 'blur(8px)',
          zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}>
          <div onClick={(e: any) => e.stopPropagation()} style={{
            background: 'var(--bg-card)',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 16,
            padding: 28,
            maxWidth: 400, width: '100%',
            textAlign: 'center',
            boxShadow: '6px 7px 0 #38bdf8, 0 16px 50px rgba(0,0,0,0.4)',
            transform: 'rotate(-0.5deg)',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute', top: -10, left: '50%',
              transform: 'translateX(-50%) rotate(-3deg)',
              width: 80, height: 18,
              background: 'rgba(56,189,248,0.55)',
              border: '1px solid rgba(56,189,248,0.3)',
              boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
            }}/>

            <h3 style={{
              fontFamily: HAND, fontSize: 26, fontWeight: 900,
              color: 'var(--text-primary)', margin: '6px 0 4px',
              transform: 'rotate(-1deg)', display: 'inline-block',
            }}>
              🖼️ Fondo del chat
            </h3>
            <p style={{
              fontFamily: HAND, fontSize: 15, fontStyle: 'italic',
              color: 'var(--text-muted)', margin: '0 0 18px',
            }}>
              ~ ambos verán el mismo fondo ~
            </p>

            {wp && (
              <div style={{
                marginBottom: 16,
                borderRadius: 10,
                overflow: 'hidden',
                border: '2.5px solid var(--text-primary)',
                boxShadow: '3px 4px 0 #38bdf8',
                transform: 'rotate(-1.5deg)',
              }}>
                <img src={wp} alt="" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }} />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={() => wpRef.current?.click()}
                style={{
                  padding: 14,
                  borderRadius: 12,
                  border: '2.5px solid var(--text-primary)',
                  background: '#38bdf8', color: '#000',
                  fontFamily: HAND, fontSize: 19, fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '3px 4px 0 var(--text-primary)',
                  transform: 'rotate(-1deg)',
                }}>
                📤 {wp ? 'Cambiar' : 'Subir'} imagen
              </button>
              {wp && (
                <button onClick={() => setWallpaperFn()}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: '2.5px dashed var(--red)',
                    background: 'transparent', color: 'var(--red)',
                    fontFamily: HAND, fontSize: 18, fontWeight: 800,
                    cursor: 'pointer',
                    transform: 'rotate(1deg)',
                  }}>
                  🗑️ Quitar fondo
                </button>
              )}
              <button onClick={() => setShowWallpaper(false)}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: '2.5px dashed var(--text-faint)',
                  background: 'transparent', color: 'var(--text-muted)',
                  fontFamily: HAND, fontSize: 17, fontWeight: 800,
                  cursor: 'pointer',
                  transform: 'rotate(-0.5deg)',
                }}>
                ✕ Cancelar
              </button>
            </div>
            <input ref={wpRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={(e: any) => { if (e.target.files?.[0]) setWallpaperFn(e.target.files[0]); }} />
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{
        padding: '10px 16px',
        background: 'var(--bg-card)',
        borderBottom: '2.5px solid var(--text-primary)',
        display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0,
      }}>
        {isMobile && (
          <button onClick={onBack}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--gold)',
              fontFamily: HAND, fontSize: 24, fontWeight: 900,
              cursor: 'pointer', padding: '4px 8px',
            }}>
            ←
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, cursor: 'pointer' }}
          onClick={() => setShowProfile(true)}>
          <Av user={partner} size={42} />
          <div style={{ minWidth: 0 }}>
            <h3 style={{
              fontFamily: HAND, fontSize: 20, fontWeight: 900,
              color: 'var(--text-primary)',
              margin: 0, lineHeight: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              transform: 'rotate(-0.5deg)', display: 'inline-block',
            }}>
              {partner.nombre}
            </h3>
            {partner.carrera && (
              <p style={{
                fontFamily: HAND, fontSize: 13, fontStyle: 'italic',
                color: 'var(--text-faint)', margin: '2px 0 0',
              }}>
                ~ 🎓 {partner.carrera} ~
              </p>
            )}
          </div>
        </div>
        {[
          { fn: () => setShowSaved(true),     ic: '📌', c: 'var(--gold)', title: 'Guardados' },
          { fn: () => setShowWallpaper(true), ic: '🖼️', c: 'var(--text-muted)', title: 'Wallpaper' },
          { fn: () => setShowReport(true),    ic: '🚨', c: 'var(--red)', title: 'Reportar' },
          { fn: borrarChat,                   ic: '🗑️', c: 'var(--text-faint)', title: 'Borrar' },
        ].map((b, i) => (
          <button key={i} onClick={b.fn} title={b.title}
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: `2px dashed ${b.c}55`,
              background: 'transparent', color: b.c,
              fontFamily: HAND, fontSize: 16,
              cursor: 'pointer',
              transform: `rotate(${i % 2 === 0 ? -2 : 2}deg)`,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.borderStyle='solid';e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.borderStyle='dashed';e.currentTarget.style.transform=`rotate(${i % 2 === 0 ? -2 : 2}deg)`;}}
          >
            {b.ic}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div
        ref={messagesRef}
        style={{
          flex: 1, overflowY: 'auto',
          padding: '20px 16px',
          display: 'flex', flexDirection: 'column',
          background: wp ? undefined : 'var(--bg-primary)',
          backgroundImage: wp ? `url(${wp})` : undefined,
          backgroundSize: wp ? 'cover' : undefined,
          backgroundPosition: wp ? 'center' : undefined,
          position: 'relative',
        }}
      >
        {messages.length === 0 && (
          <div style={{
            margin: 'auto', textAlign: 'center',
            background: 'var(--bg-card)',
            border: '2.5px dashed var(--border-color)',
            borderRadius: 14,
            padding: 30,
            transform: 'rotate(-0.5deg)',
            maxWidth: 320,
          }}>
            <div style={{ fontSize: 54, marginBottom: 12 }}>👥</div>
            <p style={{
              fontFamily: HAND, fontSize: 24, fontWeight: 900,
              color: 'var(--text-primary)',
              margin: '0 0 4px',
              transform: 'rotate(-1deg)', display: 'inline-block',
            }}>
              ¡Son partners!
            </p>
            <p style={{
              fontFamily: HAND, fontSize: 17, fontStyle: 'italic',
              color: 'var(--text-muted)', margin: 0,
            }}>
              ~ envía el primer mensaje ~
            </p>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            esMio={msg.sender_id === miUserId}
            partner={partner}
            miInfo={miInfo}
            isMobile={isMobile}
            isSavedMsg={saved.includes(msg.id)}
            onGuardar={guardarMsg}
            onBorrar={borrarMsg}
            onEditar={editarMsg}
            onReply={m => { setReplyTo(m); inputRef.current?.focus(); }}
            onCopy={copyText}
            onViewImage={(url, id) => setViewImage({ url, id })}
            onShowProfile={() => setShowProfile(true)}
            onJumpToMessage={jumpToMessage}
            registerRef={el => { messageNodeMap.current[msg.id] = el; }}
            jumped={jumpedMsgId === msg.id}
          />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        background: 'var(--bg-card)',
        borderTop: '2.5px solid var(--text-primary)',
        flexShrink: 0,
      }}>
        {/* Reply preview */}
        {replyTo && (
          <div style={{
            padding: '8px 16px',
            borderBottom: '2px dashed #38bdf8',
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'color-mix(in srgb,#38bdf8 8%,transparent)',
          }}>
            <div style={{
              width: 4, height: 32,
              background: '#38bdf8',
              borderRadius: 2,
              flexShrink: 0,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontFamily: HAND, fontSize: 14, fontWeight: 800,
                color: '#38bdf8', margin: 0,
                fontStyle: 'italic',
              }}>
                ↩️ ~ respondiendo ~
              </p>
              <p style={{
                fontFamily: HAND, fontSize: 15, fontWeight: 600,
                color: 'var(--text-muted)', margin: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {replyTo.type === 'image' ? '🖼️ Imagen'
                  : replyTo.type === 'audio' ? '🎵 Audio'
                  : replyTo.type === 'file' ? `📎 ${replyTo.file_name}`
                  : replyTo.content?.slice(0, 60)}
              </p>
            </div>
            <button onClick={() => setReplyTo(null)}
              style={{
                background: 'transparent', border: '1.5px dashed var(--text-faint)',
                borderRadius: 6,
                color: 'var(--text-faint)',
                fontFamily: HAND, fontSize: 15, fontWeight: 800,
                cursor: 'pointer',
                padding: '2px 8px',
              }}>
              ✕
            </button>
          </div>
        )}

        {/* Pending files */}
        {pendingFiles.length > 0 && (
          <div style={{
            padding: '10px 16px',
            borderBottom: '2px dashed var(--border-color)',
            display: 'flex', gap: 10, overflowX: 'auto',
          }}>
            {pendingFiles.map((pf, i) => (
              <div key={pf.id} style={{
                position: 'relative', flexShrink: 0,
                transform: `rotate(${i % 2 === 0 ? -2 : 2}deg)`,
              }}>
                {pf.type === 'image' && pf.preview ? (
                  <div style={{
                    width: 76, height: 76,
                    borderRadius: 10,
                    overflow: 'hidden',
                    border: '2.5px solid #38bdf8',
                    boxShadow: '2px 3px 0 #38bdf8',
                  }}>
                    <img src={pf.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                ) : (
                  <div style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--bg-secondary)',
                    border: '2.5px solid var(--text-primary)',
                    boxShadow: '2px 3px 0 var(--text-primary)',
                    display: 'flex', alignItems: 'center', gap: 6,
                    maxWidth: 160,
                  }}>
                    <span style={{ fontSize: 22 }}>{pf.type === 'audio' ? '🎵' : '📎'}</span>
                    <div style={{ minWidth: 0 }}>
                      <p style={{
                        fontFamily: HAND, fontSize: 15, fontWeight: 800,
                        color: 'var(--text-primary)', margin: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        lineHeight: 1.1,
                      }}>{pf.name}</p>
                      <p style={{
                        fontFamily: HAND, fontSize: 12, fontStyle: 'italic',
                        color: 'var(--text-faint)', margin: 0,
                      }}>{fmtSize(pf.size)}</p>
                    </div>
                  </div>
                )}
                <button onClick={() => removePending(pf.id)}
                  style={{
                    position: 'absolute', top: -8, right: -8,
                    width: 22, height: 22,
                    borderRadius: '50%',
                    border: '2px solid var(--text-primary)',
                    background: 'var(--red)', color: '#fff',
                    fontFamily: HAND, fontSize: 13, fontWeight: 900,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '1px 1px 0 var(--text-primary)',
                  }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: '12px 14px' }}>
          {/* Botones de acción */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, overflowX: 'auto' }}>
            {[
              { l: '📎', fn: () => { if (fileRef.current) { fileRef.current.accept = '*/*'; fileRef.current.click(); } }, c: 'var(--text-muted)' },
              { l: '🖼️', fn: () => { if (fileRef.current) { fileRef.current.accept = 'image/*'; fileRef.current.click(); } }, c: '#a78bfa' },
              { l: grabando ? '⏹️' : '🎙️', fn: toggleGrabar, c: grabando ? 'var(--red)' : '#34d399' },
            ].map((b, i) => (
              <button key={i} onClick={b.fn}
                style={{
                  padding: '7px 14px',
                  borderRadius: 10,
                  border: `2px dashed ${b.c}`,
                  background: grabando && i === 2 ? `color-mix(in srgb,${b.c} 16%,transparent)` : 'transparent',
                  color: b.c,
                  fontFamily: HAND, fontSize: 18,
                  cursor: 'pointer',
                  flexShrink: 0,
                  transform: `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e:any)=>{e.currentTarget.style.borderStyle='solid';e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';}}
                onMouseLeave={(e:any)=>{e.currentTarget.style.borderStyle='dashed';e.currentTarget.style.transform=`rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`;}}
              >
                {b.l}
              </button>
            ))}
          </div>

          {/* Input + send */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e: any) => setInput(e.target.value)}
              onKeyDown={(e: any) => e.key === 'Enter' && !e.shiftKey && enviarTodo()}
              placeholder="✏️ escribe un mensaje..."
              style={{
                flex: 1, padding: '11px 14px',
                borderRadius: 12,
                border: '2.5px solid var(--text-primary)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontFamily: HAND, fontSize: 18, fontWeight: 600,
                outline: 'none',
                boxShadow: '3px 3px 0 var(--text-primary)',
                transform: 'rotate(-0.3deg)',
              }}
            />
            <button onClick={enviarTodo} disabled={(!input.trim() && pendingFiles.length === 0) || enviando}
              style={{
                padding: '11px 20px',
                borderRadius: 12,
                border: '2.5px solid var(--text-primary)',
                background: (input.trim() || pendingFiles.length > 0) ? '#38bdf8' : 'var(--bg-secondary)',
                color: (input.trim() || pendingFiles.length > 0) ? '#000' : 'var(--text-faint)',
                fontFamily: HAND, fontSize: 22, fontWeight: 800,
                cursor: (input.trim() || pendingFiles.length > 0) ? 'pointer' : 'not-allowed',
                boxShadow: (input.trim() || pendingFiles.length > 0) ? '3px 4px 0 var(--text-primary)' : 'none',
                transform: 'rotate(-1deg)',
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}
              onMouseEnter={(e:any)=>{if(input.trim() || pendingFiles.length > 0){e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';e.currentTarget.style.boxShadow='4px 6px 0 var(--text-primary)';}}}
              onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1deg)';if(input.trim() || pendingFiles.length > 0)e.currentTarget.style.boxShadow='3px 4px 0 var(--text-primary)';}}
            >
              {enviando ? '⏳' : '➤'}
            </button>
          </div>
        </div>

        <input ref={fileRef} type="file" multiple style={{ display: 'none' }}
          onChange={(e: any) => {
            if (e.target.files) Array.from(e.target.files).forEach((f: any) => addPendingFile(f as File));
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}