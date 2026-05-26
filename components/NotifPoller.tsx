'use client';

import { useEffect } from 'react';
import { supabase } from '../lib/supabase';

const STORAGE_KEY = 'studyal_notif_leidas';

function getLeidas(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); } catch { return new Set(); }
}

export default function NotifPoller() {
  useEffect(() => {
    let activo = true;

    const checkNotifs = async () => {
      try {
        // Obtener token
        let token: string | null = null;
        try {
          const result: any = await Promise.race([
            supabase.auth.getSession(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
          ]);
          token = result?.data?.session?.access_token || null;
        } catch {
          try {
            const k = Object.keys(localStorage).find(x => x.startsWith('sb-') && x.endsWith('-auth-token'));
            if (k) {
              const parsed = JSON.parse(localStorage.getItem(k) || '{}');
              token = parsed?.access_token || null;
            }
          } catch {}
        }
        if (!token || !activo) return;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !activo) return;

        const leidas = getLeidas();
        const vistasKey = 'studyal_notif_vistas';
        const vistas = new Set<string>(JSON.parse(localStorage.getItem(vistasKey) || '[]'));

        // 1) Chats no leídos
        try {
          const r = await fetch('/api/notif-unread', { headers: { 'Authorization': 'Bearer ' + token } });
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

        // 2) Solicitudes de partner
        try {
          const r = await fetch('/api/partners', { headers: { 'Authorization': 'Bearer ' + token } });
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

    // Primera vez tras 5s (no spamear al cargar)
    const initial = setTimeout(checkNotifs, 5000);
    // Después cada 30s
    const iv = setInterval(checkNotifs, 30000);

    return () => { activo = false; clearTimeout(initial); clearInterval(iv); };
  }, []);

  return null;
}
