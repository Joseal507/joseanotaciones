'use client';

import { AcademicContent } from './academic/AcademicContent';

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
  return (
    <div style={{ color, fontSize, fontWeight: weight, lineHeight, textAlign }}>
      <AcademicContent content={text} />
    </div>
  );
}
