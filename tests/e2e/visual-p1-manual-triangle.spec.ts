import { expect, test, type Page } from '@playwright/test';
import { MANUAL_TOOL_CAPS } from '../../lib/manualToolState';

// Verifica la fórmula de iluminación del triángulo Manual: cada lado es
// un gate binario (todas sus herramientas al 100%), nunca iluminación
// parcial por tocar una sola. Orden real de <line> en el SVG (ver
// StudyALManualProcess.tsx): 1=derecho, 2=inferior, 3=izquierdo.

async function sideStates(page: Page): Promise<{ right: boolean; bottom: boolean; left: boolean }> {
  const strokes = await page.locator('svg line').evaluateAll(els => els.map(el => el.getAttribute('stroke') || ''));
  const isComplete = (s: string) => s.startsWith('url(#glow');
  return { right: isComplete(strokes[0]), bottom: isComplete(strokes[1]), left: isComplete(strokes[2]) };
}

function query(progress: Partial<Record<string, number>>): string {
  return Object.entries(progress).map(([k, v]) => `${k}=${v}`).join('&');
}

const CAP = MANUAL_TOOL_CAPS;

const STEPS: Array<{ label: string; progress: Record<string, number>; expect: { left: boolean; right: boolean; bottom: boolean } }> = [
  { label: '0 herramientas', progress: {}, expect: { left: false, right: false, bottom: false } },
  { label: 'solo Leer', progress: { leer: CAP.leer }, expect: { left: false, right: false, bottom: false } },
  { label: 'Leer + ALAI', progress: { leer: CAP.leer, alai: CAP.alai }, expect: { left: false, right: false, bottom: false } },
  { label: 'Leer + ALAI + Examen', progress: { leer: CAP.leer, alai: CAP.alai, examen: CAP.examen }, expect: { left: true, right: false, bottom: false } },
  { label: '+ Flashcards (aún no Quizzes)', progress: { leer: CAP.leer, alai: CAP.alai, examen: CAP.examen, flashcards: CAP.flashcards }, expect: { left: true, right: false, bottom: false } },
  { label: '+ Quizzes (derecho completo)', progress: { leer: CAP.leer, alai: CAP.alai, examen: CAP.examen, flashcards: CAP.flashcards, quizzes: CAP.quizzes }, expect: { left: true, right: true, bottom: false } },
  { label: '+ Mi resumen (los 3 lados)', progress: { leer: CAP.leer, alai: CAP.alai, examen: CAP.examen, flashcards: CAP.flashcards, quizzes: CAP.quizzes, resumen: CAP.resumen }, expect: { left: true, right: true, bottom: true } },
];

for (const step of STEPS) {
  test(`Triángulo Manual: ${step.label}`, async ({ page }) => {
    await page.goto(`/e2e-visual-p1-manual?${query(step.progress)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await page.waitForFunction(() => {
      const el = document.querySelector('[style*="grid-template-columns"]') as HTMLElement | null;
      return el ? getComputedStyle(el).opacity === '1' : true;
    }, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const state = await sideStates(page);
    expect(state, step.label).toEqual(step.expect);
    await page.screenshot({ path: `reports/playwright/p1-triangle-${step.label.replace(/[^a-z0-9]+/gi, '-')}.png` });
  });
}

test('Triángulo Manual: ningún lado se ilumina a medias (1 sola tool del grupo no basta)', async ({ page }) => {
  // El lado derecho necesita Flashcards Y Quizzes; con solo Quizzes al 100%
  // y Flashcards en 0, NO debe iluminarse.
  await page.goto(`/e2e-visual-p1-manual?quizzes=${MANUAL_TOOL_CAPS.quizzes}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const state = await sideStates(page);
  expect(state.right, 'derecho no debe iluminarse solo con Quizzes').toBe(false);
  expect(state.left).toBe(false);
  expect(state.bottom).toBe(false);
});
