import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import RangoWatcher from '../components/RangoWatcher';
import { Caveat } from 'next/font/google';
import './globals.css';
import ThemeInit from '../components/ThemeInit';
import PomodoroProvider from '../components/PomodoroProvider';
import XPToast from '../components/XPToast';
import RachaInit from '../components/RachaInit';

const caveat = Caveat({
  subsets: ['latin'],
  weight: ['600', '700'],
  display: 'swap',
  variable: '--font-caveat',
});

export const metadata: Metadata = {
  title: 'StudyAL',
  description: 'Tu plataforma de estudio definitiva',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={caveat.variable}>
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"
        />
      </head>
      <body>
        <ThemeInit />
        <RachaInit />
        <PomodoroProvider>
          {children}
        </PomodoroProvider>
        <XPToast />
        <Analytics />
        <RangoWatcher />
      </body>
    </html>
  );
}
