import fs from "fs";

function w(path, content) {
  fs.writeFileSync(path, content.trimStart() + "\n");
  console.log("updated", path);
}

// XP client sin Supabase
w("lib/xpClient.ts", `
import { registrarXpDiario } from './xpDiario';

export type FuenteXP = 'timer' | 'flashcards' | 'quiz' | 'post' | 'objetivo' | 'login' | 'racha' | 'comunidad' | 'daily_reward';

export async function darXP(
  fuente: FuenteXP,
  cantidad: number,
  meta?: Record<string, any>
): Promise<{ ok: boolean; xpGanado: number; xpTotal: number; nivel: number; subioNivel: boolean }> {
  try {
    if (cantidad === 0) return { ok: false, xpGanado: 0, xpTotal: 0, nivel: 1, subioNivel: false };

    const res = await fetch('/api/xp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ fuente, cantidad, meta }),
    });

    if (!res.ok) return { ok: false, xpGanado: 0, xpTotal: 0, nivel: 1, subioNivel: false };

    const data = await res.json();
    const xpGanado = data.xp_ganado ?? 0;

    if (xpGanado > 0) {
      registrarXpDiario(xpGanado);
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('xp:ganada', { detail: { xp: xpGanado } }));
        }
      } catch {}
    }

    return {
      ok: data.ok ?? false,
      xpGanado,
      xpTotal: data.xp_total ?? 0,
      nivel: data.nivel ?? 1,
      subioNivel: data.subio_nivel ?? false,
    };
  } catch {
    return { ok: false, xpGanado: 0, xpTotal: 0, nivel: 1, subioNivel: false };
  }
}
`);

// Racha sin Supabase
let racha = fs.readFileSync("lib/racha.ts", "utf8");
racha = racha.replace(/const \{ supabase \} = await import\('\.\/supabase'\);\s*const \{ data: sessionData \} = await supabase\.auth\.getSession\(\);\s*const token = sessionData\.session\?\.access_token;\s*if \(!token\) return;\s*/g, "");
racha = racha.replace(/const \{ supabase \} = await import\('\.\/supabase'\);\s*const \{ data: sessionData \} = await supabase\.auth\.getSession\(\);\s*const token = sessionData\.session\?\.access_token;\s*if \(!token\) return getRacha\(\);\s*/g, "");
racha = racha.replace(/headers: \{\s*Authorization: `Bearer \$\{token\}`,\s*'Content-Type': 'application\/json',\s*\}/g, "headers: { 'Content-Type': 'application/json' },\n      credentials: 'same-origin'");
racha = racha.replace(/headers: \{ Authorization: `Bearer \$\{token\}` \},/g, "credentials: 'same-origin',");
fs.writeFileSync("lib/racha.ts", racha);
console.log("patched lib/racha.ts");

// syncLeaderboard sin Supabase
w("lib/syncLeaderboard.ts", `
import { getPerfil } from './storage';
import { getRacha } from './racha';

export const syncLeaderboard = async () => {
  try {
    const perfil = getPerfil();

    const totalAcertadas = Object.values(perfil.flashcardsAcertadas || {}).reduce(
      (a: number, b: any) => a + b, 0
    );
    const totalFalladas = Object.values(perfil.flashcardsFalladas || {}).reduce(
      (a: number, b: any) => a + b, 0
    );
    const total = totalAcertadas + totalFalladas;
    const precision = total > 0 ? Math.round((totalAcertadas / total) * 100) : 0;

    const quizzesTotales = Object.values(perfil.materiasStats || {}).reduce(
      (a: number, m: any) => a + (m.quizzes || 0), 0
    );

    const currentRes = await fetch('/api/leaderboard', { cache: 'no-store', credentials: 'same-origin' });
    const currentData = await currentRes.json().catch(() => ({}));
    const sessionRes = await fetch('/api/auth/session', { cache: 'no-store' });
    const session = await sessionRes.json().catch(() => ({}));
    const userId = session?.user?.id;

    const current = (currentData?.data || []).find((x: any) => x.user_id === userId) || {};

    const flashcardsActuales = current?.flashcards_estudiadas || 0;
    const flashcardsNuevas = Math.max(flashcardsActuales, total);

    const rachaData = getRacha();
    const rachaActual = rachaData.rachaActual;
    const mejorRacha = Math.max(
      current?.mejor_racha || 0,
      rachaData.mejorRacha,
      rachaActual
    );

    await fetch('/api/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        flashcards_estudiadas: flashcardsNuevas,
        precision_global: precision,
        racha_actual: rachaActual,
        mejor_racha: mejorRacha,
        quizzes_completados: quizzesTotales,
      }),
    });
  } catch (err) {
    console.error('syncLeaderboard error:', err);
  }
};
`);

// leaderboard page sin Supabase
let lbPage = fs.readFileSync("app/leaderboard/page.tsx", "utf8");
lbPage = lbPage.replace("import { supabase } from '../../lib/supabase';\n", "import { useSession } from 'next-auth/react';\n");
lbPage = lbPage.replace(
  "  const [checking, setChecking] = useState(true);",
  "  const { status } = useSession();\n  const [checking, setChecking] = useState(true);"
);
lbPage = lbPage.replace(/  useEffect\(\(\) => \{[\s\S]*?\n  \}, \[\]\);/, `  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') {
      try { (window as any).__showNavLoader?.('/landing'); } catch {}
      router.push('/landing');
      return;
    }
    setChecking(false);
  }, [status, router]);`);
fs.writeFileSync("app/leaderboard/page.tsx", lbPage);
console.log("patched app/leaderboard/page.tsx");

// NotifPoller sin Supabase
w("components/NotifPoller.tsx", `
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
`);
