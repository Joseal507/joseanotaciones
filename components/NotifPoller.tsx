'use client';

import { useEffect } from 'react';
import { getSession } from 'next-auth/react';

const STORAGE_KEY = 'studyal_notif_leidas';

function getLeidas(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); } catch { return new Set(); }
}

export default function NotifPoller() {
  useEffect(() => {
    let activo = true;

    const checkNotifs = async () => {
      try {
        const session = await getSession();
        if (!session?.user || !activo) return;

        const leidas = getLeidas();
        const vistasKey = 'studyal_notif_vistas';
        const vistas = new Set<string>(JSON.parse(localStorage.getItem(vistasKey) || '[]'));

        try {
          const r = await fetch('/api/notif-unread', { credentials: 'same-origin' });
          if (r.ok) {
            const { unread } = await r.json();
            (unread || []).forEach((u: any) => {
              const id = 'chat-' + u.chat_id + '-' + u.last_at;
              if (!leidas.has(id) && !vistas.has(id)) {
                window.dispatchEvent(new CustomEvent('studyal:newNotif', { detail: {
                  id, tipo: 'chat',
                  titulo: '💬 ' + u.sender_nombre,
                  desc: u.count === 1 ? (u.last_content || '').substring(0, 60) : u.count + ' mensajes nuevos',
                  emoji: '💬', color: 'var(--blue)',
                  href: '/partners?chat=' + u.chat_id,
                }}));
                vistas.add(id);
              }
            });
          }
        } catch {}

        try {
          const r = await fetch('/api/partners', { credentials: 'same-origin' });
          if (r.ok) {
            const data = await r.json();
            (data.solicitudes || []).forEach((s: any) => {
              const id = 'req-' + s.id;
              if (!leidas.has(id) && !vistas.has(id)) {
                window.dispatchEvent(new CustomEvent('studyal:newNotif', { detail: {
                  id, tipo: 'partner',
                  titulo: '🤝 Solicitud de partner',
                  desc: (s.partner?.nombre || 'Alguien') + ' quiere ser tu partner',
                  emoji: '🤝', color: '#22c55e',
                  href: '/partners',
                }}));
                vistas.add(id);
              }
            });
          }
        } catch {}

        try { localStorage.setItem(vistasKey, JSON.stringify([...vistas].slice(-200))); } catch {}
      } catch {}
    };

    const initial = setTimeout(checkNotifs, 5000);
    const iv = setInterval(checkNotifs, 30000);

    return () => { activo = false; clearTimeout(initial); clearInterval(iv); };
  }, []);

  return null;
}

