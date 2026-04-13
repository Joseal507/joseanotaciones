import type { Metadata } from 'next';
import './globals.css';
import ThemeInit from '../components/ThemeInit';

export const metadata: Metadata = {
  title: 'JoseAnotaciones',
  description: 'Tu plataforma de estudio personal',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <ThemeInit />
        {children}
      </body>
    </html>
  );
}