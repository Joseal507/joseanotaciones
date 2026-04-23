'use client';

import katex from 'katex';

interface Props {
  text: string;
  color?: string;
  fontSize?: string | number;
  weight?: number | string;
  lineHeight?: number | string;
  textAlign?: 'left' | 'center' | 'right';
}

export default function MathText({
  text,
  color = 'inherit',
  fontSize = 'inherit',
  weight = 'inherit',
  lineHeight = 1.6,
  textAlign = 'left',
}: Props) {
  const parts = text
    .split(/(\$\$[\s\S]+?\$\$|\$[^$]+\$)/g)
    .filter(Boolean);

  return (
    <div style={{ color, fontSize, fontWeight: weight, lineHeight, textAlign }}>
      {parts.map((part, i) => {
        const isBlock = part.startsWith('$$') && part.endsWith('$$');
        const isInline = part.startsWith('$') && part.endsWith('$') && !isBlock;

        if (isBlock) {
          const expr = part.slice(2, -2).trim();
          return (
            <div
              key={i}
              style={{ margin: '8px 0', overflowX: 'auto' }}
              dangerouslySetInnerHTML={{
                __html: katex.renderToString(expr, {
                  throwOnError: false,
                  displayMode: true,
                }),
              }}
            />
          );
        }

        if (isInline) {
          const expr = part.slice(1, -1).trim();
          return (
            <span
              key={i}
              dangerouslySetInnerHTML={{
                __html: katex.renderToString(expr, {
                  throwOnError: false,
                  displayMode: false,
                }),
              }}
            />
          );
        }

        return <span key={i}>{part}</span>;
      })}
    </div>
  );
}
