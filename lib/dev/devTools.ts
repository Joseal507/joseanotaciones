// Puerta de visibilidad para herramientas DEV-ONLY (recorrido rápido de sesiones
// para QA/UX — ver lib/adaptive/dev/devCanonicalAnswer.ts). Ambas condiciones se
// inlinean en build time por Next.js (process.env.NODE_ENV y cualquier
// process.env.NEXT_PUBLIC_* se reemplazan estáticamente en el bundle), así que es
// seguro leerlas desde código de cliente: en un build de producción sin
// NEXT_PUBLIC_STUDYAL_DEV_TOOLS activado explícitamente, esta función se
// convierte en `return false` literal — el control ni siquiera existe en el JS
// servido a usuarios reales.
export function isDevToolsEnabled(): boolean {
  if (process.env.NODE_ENV !== 'production') return true
  return process.env.NEXT_PUBLIC_STUDYAL_DEV_TOOLS === 'true'
}
