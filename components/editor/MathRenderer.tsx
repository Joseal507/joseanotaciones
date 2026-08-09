'use client';

import { useEffect, useRef } from 'react';
import { normalizeAcademicContent } from '../../lib/academic-content/validation';

interface Props {
  math: string;
  display?: boolean;
  color?: string;
  fontSize?: string;
}

export default function MathRenderer({ math, display = false, color = 'inherit', fontSize = 'inherit' }: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!ref.current || !math) return;
    
    const render = async () => {
      try {
        const katex = (await import('katex')).default;
        const cleaned = cleanMath(math);
        const normalized = normalizeAcademicContent(`$${cleaned}$`);
        if (!normalized.validation.valid) throw new Error('Invalid academic math node');
        katex.render(cleaned, ref.current!, {
          displayMode: display,
          throwOnError: false,
          errorColor: '#ef4444',
          trust: false,
          strict: false,
        });
      } catch (e) {
        if (ref.current) ref.current.textContent = 'Contenido matemático no disponible.';
      }
    };
    
    render();
  }, [math, display]);

  if (!math) return null;

  return (
    <span
      ref={ref}
      style={{ color, fontSize, fontFamily: display ? undefined : 'inherit' }}
    />
  );
}

// Compatibilidad: la inferencia de texto plano fue retirada. Solo se normalizan
// invariantes Unicode que no cambian la semántica.
export function cleanMath(text: string): string {
  if (!text) return '';
  return text
    .replace(/[−–—]/g, '-')
    .replace(/\u00a0/g, ' ')
    .trim();
}
