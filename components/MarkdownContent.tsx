'use client';

import { AcademicContent } from './academic/AcademicContent';

interface Props {
  content: string;
  color?: string;
  size?: number;
  center?: boolean;
}

export default function MarkdownContent({
  content,
  color = '#e5e7eb',
  size = 16,
  center = false,
}: Props) {
  return (
    <div
      style={{
        color,
        fontSize: `${size}px`,
        lineHeight: 1.7,
        textAlign: center ? 'center' : 'left',
        wordBreak: 'break-word',
      }}
    >
      <AcademicContent content={content || ''} />
    </div>
  );
}
