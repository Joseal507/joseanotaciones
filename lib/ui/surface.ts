/**
 * Vocabulario visual mínimo compartido para la pasada de cohesión P0
 * (Adaptive / Manual / Flashcards). No es un design system: son 4
 * helpers que expresan la gramática ya existente en Home/Free
 * (borde de tinta, sombra dura sin blur, radios 10/14, tintes vía
 * color-mix) para no repetir los mismos strings por archivo.
 */

export const RADIUS = { card: 14, control: 10, chip: 4 } as const;

/** Borde de tinta: usa el color del texto, no un gris neutro. */
export function inkBorder(width = 2, color = 'var(--text-primary)'): string {
  return `${width}px solid ${color}`;
}

/** Sombra dura sin blur (papel recortado), como en Home/Free. */
export function hardShadow(color = 'var(--text-primary)', x = 4, y = 5): string {
  return `${x}px ${y}px 0 ${color}`;
}

/** Tinte de acento sobre una superficie, adaptado a cualquier paleta. */
export function accentTint(accentVar: string, pct = 12, base = 'var(--bg-card)'): string {
  return `color-mix(in srgb, ${accentVar} ${pct}%, ${base})`;
}
