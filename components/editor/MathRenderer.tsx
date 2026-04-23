'use client';

import { useEffect, useRef } from 'react';

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
        katex.render(cleanMath(math), ref.current!, {
          displayMode: display,
          throwOnError: false,
          errorColor: '#ef4444',
          trust: false,
          strict: false,
        });
      } catch (e) {
        // Si KaTeX falla, mostrar texto plano
        if (ref.current) ref.current.textContent = math;
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

// Convierte texto plano a LaTeX válido
export function cleanMath(text: string): string {
  if (!text) return '';
  
  return text
    // Ya tiene LaTeX → limpiar
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '\\frac{$1}{$2}')
    // Texto plano → LaTeX
    .replace(/\bsqrt\(([^)]+)\)/g, '\\sqrt{$1}')
    .replace(/\bsqrt\b/g, '\\sqrt')
    .replace(/\bpi\b/g, '\\pi')
    .replace(/\btheta\b/g, '\\theta')
    .replace(/\balpha\b/g, '\\alpha')
    .replace(/\bbeta\b/g, '\\beta')
    .replace(/\binfty\b/g, '\\infty')
    .replace(/\binfinity\b/g, '\\infty')
    .replace(/\binfinito\b/g, '\\infty')
    .replace(/\bsum\b/g, '\\sum')
    .replace(/\bintegral\b/g, '\\int')
    .replace(/\bdelta\b/g, '\\Delta')
    .replace(/\bsigma\b/g, '\\sigma')
    .replace(/([a-zA-Z0-9])\^2\b/g, '$1^{2}')
    .replace(/([a-zA-Z0-9])\^3\b/g, '$1^{3}')
    .replace(/\(([^)]+)\)\/\(([^)]+)\)/g, '\\frac{$1}{$2}')
    .replace(/([a-zA-Z0-9]+)\/([a-zA-Z0-9]+)/g, '\\frac{$1}{$2}')
    .replace(/\*\*/g, '\\cdot ')
    .replace(/\*/g, '\\cdot ')
    .replace(/!=/g, '\\neq ')
    .replace(/<=/g, '\\leq ')
    .replace(/>=/g, '\\geq ')
    .replace(/\+-/g, '\\pm ')
    .trim();
}
