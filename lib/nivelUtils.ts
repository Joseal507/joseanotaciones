/**
 * nivelUtils.ts
 * Fuente única de verdad para calcular niveles.
 * Usado tanto en cliente como en servidor.
 */

export function calcularNivel(xpTotal: number): number {
  let nivel = 1;
  let acumulado = 0;
  while (nivel < 100) {
    const necesario = Math.floor(100 * Math.pow(nivel, 1.5));
    if (xpTotal < acumulado + necesario) break;
    acumulado += necesario;
    nivel++;
  }
  return Math.min(nivel, 100);
}
