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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${plusJakartaSans.variable}`}>
      <head>
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
