import type { Metadata } from 'next';
import './globals.css';
import ThemeInit from '../components/ThemeInit';

export const metadata: Metadata = {
  title: 'JoseAnotaciones',
  description: 'Tu plataforma de estudio',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
      </head>
      <body>
        <ThemeInit />
        {children}
      </body>
    </html>
  );
}