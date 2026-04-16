'use client';

type PaperStyle = 'blank' | 'lined' | 'grid' | 'dotted';

interface Props {
  style: PaperStyle;
  temaColor: string;
}

export default function PaperBackground({ style, temaColor }: Props) {
  if (style === 'blank') return null;

  const lineH = 32;
  const lineColor = '#e2e8f0';
  const redLine = '#fca5a5';
  const redX = 64;

  if (style === 'lined') {
    return (
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        pointerEvents: 'none',
        zIndex: 0,
      }}>
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', top: 0, left: 0 }}>
          <defs>
            <pattern id="lined" x="0" y="0" width="100%" height={lineH} patternUnits="userSpaceOnUse">
              <line x1="0" y1={lineH - 0.5} x2="100%" y2={lineH - 0.5} stroke={lineColor} strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#lined)" />
          {/* Línea roja vertical */}
          <line x1={redX} y1="0" x2={redX} y2="100%" stroke={redLine} strokeWidth="1.5"/>
        </svg>
      </div>
    );
  }

  if (style === 'grid') {
    return (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 0 }}>
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', top: 0, left: 0 }}>
          <defs>
            <pattern id="grid" x="0" y="0" width={lineH} height={lineH} patternUnits="userSpaceOnUse">
              <path d={`M ${lineH} 0 L 0 0 0 ${lineH}`} fill="none" stroke={lineColor} strokeWidth="0.8"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>
    );
  }

  if (style === 'dotted') {
    return (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 0 }}>
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', top: 0, left: 0 }}>
          <defs>
            <pattern id="dotted" x={lineH / 2} y={lineH / 2} width={lineH} height={lineH} patternUnits="userSpaceOnUse">
              <circle cx="0" cy="0" r="1.2" fill="#c7d2e8"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dotted)" />
        </svg>
      </div>
    );
  }

  return null;
}