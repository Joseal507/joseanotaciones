import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'JoseAnotaciones',
  description: 'Tu plataforma de estudio personal',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-black text-white">{children}</body>
    </html>
  );
}