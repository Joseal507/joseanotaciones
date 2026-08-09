export function formatScoreDisplay(score: number | undefined | null): string {
  if (typeof score !== 'number' || isNaN(score)) return '0'
  const clamped = Math.max(0, Math.min(100, score))
  // Mostrar entero (ej. 42)
  return String(Math.round(clamped))
}
