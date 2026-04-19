'use client';

import { useId } from 'react';

type PaperStyle = 'blank' | 'lined' | 'grid' | 'dotted';

interface Props {
  style: PaperStyle;
  temaColor: string;
}

export default function PaperBackground({ style, temaColor }: Props) {
  // ✅ ID único por instancia para que no colisionen entre páginas
  const uid = useId().replace(/:/g, '');

  if (style === 'blank') return null;

  const lineH = 28;
  const lineColor = '#e5e7eb';
  const redLine = '#fca5a5';
  const redX = 56;

  if (style === 'lined') {
    const patId = `lined-${uid}`;
    return (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 0 }}>
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id={patId} x="0" y="0" width="100%" height={lineH} patternUnits="userSpaceOnUse">
              <line x1="0" y1={lineH} x2="100%" y2={lineH} stroke={lineColor} strokeWidth="0.7" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${patId})`} />
          <line x1={redX} y1="0" x2={redX} y2="100%" stroke={redLine} strokeWidth="1" opacity="0.5" />
        </svg>
      </div>
    );
  }

  if (style === 'grid') {
    const patId = `grid-${uid}`;
    const cellSize = 24;
    return (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 0 }}>
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id={patId} x="0" y="0" width={cellSize} height={cellSize} patternUnits="userSpaceOnUse">
              <path d={`M ${cellSize} 0 L 0 0 0 ${cellSize}`} fill="none" stroke={lineColor} strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${patId})`} />
        </svg>
      </div>
    );
  }

  if (style === 'dotted') {
    const patId = `dotted-${uid}`;
    const cellSize = 24;
    return (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 0 }}>
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id={patId} x={cellSize / 2} y={cellSize / 2} width={cellSize} height={cellSize} patternUnits="userSpaceOnUse">
              <circle cx="0" cy="0" r="1" fill="#cbd5e1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${patId})`} />
        </svg>
      </div>
    );
  }

  return null;
}