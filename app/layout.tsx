import type { Metadata } from 'next';
import './globals.css';
import ThemeInit from '../components/ThemeInit';
import PomodoroFlotante from '../components/PomodoroFlotante';
import ChatFlotante from '../components/ChatFlotante';

export const metadata: Metadata = {
  title: 'StudyAL',
  description: 'Tu plataforma de estudio definitiva',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <ThemeInit />
        {children}
        <PomodoroFlotante />
        <ChatFlotante />
      </body>
    </html>
  );
}