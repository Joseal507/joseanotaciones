import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import RangoWatcher from '../components/RangoWatcher';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import 'katex/dist/katex.min.css';
import ThemeInit from '../components/ThemeInit';
import NavLoader from '../components/NavLoader';
import PomodoroProvider from '../components/PomodoroProvider';
import XPToast from '../components/XPToast';
import NotifToast from '../components/NotifToast';
import NotifPoller from '../components/NotifPoller';
import RachaInit from '../components/RachaInit';
import AuthSessionProvider from '../components/auth/AuthSessionProvider';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-global-g',
});

export const metadata: Metadata = {
  title: 'StudyAL',
  description: 'Tu plataforma de estudio definitiva',
};

// ── ANTI-FOUC THEME BOOTSTRAP ─────────────────────────────────────
// Corre de forma sincrónica y bloqueante ANTES del primer paint, así
// un usuario en light no ve un frame oscuro (el CSS base es dark).
// Replica exactamente la semántica de hooks/useDarkMode.ts (dark |
// light | auto = claro 6am-18h) y de components/ThemeInit.tsx
// (data-theme + custom properties). ThemeInit sigue siendo el
// responsable de la reactividad post-mount y de la migración de
// claves viejas; esto solo adelanta el primer pintado.
const THEME_BOOTSTRAP = `(function(){try{
var d=document.documentElement;
var dm=localStorage.getItem('studyal_darkmode')||localStorage.getItem('josea_darkmode');
var isDark;
if(dm==='auto'||!dm){var h=new Date().getHours();isDark=h<6||h>=18;}
else{isDark=dm!=='light';}
if(isDark){d.classList.remove('light');}else{d.classList.add('light');}
var V=['default','playa','executive','sunset','neon','custom'];
var raw=localStorage.getItem('studyal_settings')||localStorage.getItem('josea_settings');
var t='default',ct=null;
if(raw){var p=JSON.parse(raw);if(p&&p.tema&&V.indexOf(p.tema)>-1){t=p.tema;ct=p.customTheme||null;}}
d.setAttribute('data-theme',t);
if(t==='custom'&&ct){
var f=function(hex,a){var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return'rgba('+r+','+g+','+b+','+a+')';};
[['gold',0.15,0.35],['red',0.15,0.3],['blue',0.15,0.3],['pink',0.15,0.3]].forEach(function(k){
var name=k[0],v=ct[name];if(!v)return;
d.style.setProperty('--'+name,v);
d.style.setProperty('--'+name+'-dim',f(v,k[1]));
d.style.setProperty('--'+name+'-border',f(v,k[2]));});
}
}catch(e){document.documentElement.setAttribute('data-theme','default');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${plusJakartaSans.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        {/* katex css loaded via import in each page that uses it */}
      </head>
      <body>
        <ThemeInit />
        <NavLoader />
        <RachaInit />
        <AuthSessionProvider>
          <PomodoroProvider>
            <NotifToast/>
            <NotifPoller/>
            {children}
          </PomodoroProvider>
        </AuthSessionProvider>
        <XPToast />
        <Analytics />
        <RangoWatcher />
      </body>
    </html>
  );
}
