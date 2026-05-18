'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const HAND = "'Caveat',cursive";

interface ToastData {
  id: string;
  titulo: string;
  desc: string;
  emoji: string;
  color: string;
  href: string;
}

export default function NotifToast() {
  const router = useRouter();
  const [toasts, setToasts] = useState<ToastData[]>([]);

  useEffect(() => {
    const handler = (e: any) => {
      const n = e.detail;
      if (!n) return;

      // Evitar duplicados en pantalla
      setToasts(prev => {
        if (prev.find(t => t.id === n.id)) return prev;
        return [...prev, {
          id: n.id,
          titulo: n.titulo,
          desc: n.desc,
          emoji: n.emoji,
          color: n.color,
          href: n.href,
        }].slice(-3); // máximo 3 a la vez
      });

      // Auto-dismiss en 5s
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== n.id));
      }, 5000);
    };

    window.addEventListener('studyal:newNotif', handler);
    return () => window.removeEventListener('studyal:newNotif', handler);
  }, []);

  const dismiss = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const ir = (t: ToastData) => {
    dismiss(t.id);
    try { (window as any).__showNavLoader?.(t.href); } catch {}
    try { router.push(t.href); } catch { window.location.href = t.href; }
  };

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 14,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 99999,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      pointerEvents: 'none',
      width: 'min(90vw, 380px)',
    }}>
      {toasts.map((t, i) => (
        <div
          key={t.id}
          onClick={() => ir(t)}
          style={{
            pointerEvents: 'auto',
            background: 'var(--bg-card)',
            border: '2.5px solid var(--text-primary)',
            borderLeft: '6px solid ' + t.color,
            borderRadius: 12,
            padding: '10px 14px',
            boxShadow: '4px 5px 0 ' + t.color + ', 0 10px 30px rgba(0,0,0,.35)',
            cursor: 'pointer',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            animation: 'toastIn .4s cubic-bezier(.34,1.5,.64,1)',
            transform: 'rotate(' + (i % 2 === 0 ? -0.5 : 0.5) + 'deg)',
            transition: 'all .2s',
          }}
          onMouseEnter={(e: any) => {
            e.currentTarget.style.transform = 'rotate(0) translateY(-2px) scale(1.02)';
          }}
          onMouseLeave={(e: any) => {
            e.currentTarget.style.transform = 'rotate(' + (i % 2 === 0 ? -0.5 : 0.5) + 'deg)';
          }}
        >
          <div style={{ fontSize: 26, flexShrink: 0 }}>{t.emoji}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontFamily: HAND, fontSize: 17, fontWeight: 900,
              color: t.color, margin: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{t.titulo}</p>
            <p style={{
              fontFamily: HAND, fontSize: 14,
              color: 'var(--text-muted)', margin: '1px 0 0',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{t.desc}</p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); dismiss(t.id); }}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 18, color: 'var(--text-faint)', padding: 4,
              lineHeight: 1, flexShrink: 0,
            }}
            title="Cerrar"
          >✕</button>
        </div>
      ))}

      <style>{`
        @keyframes toastIn {
          0% { opacity: 0; transform: translateY(-30px) scale(.8); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
