import assert from 'node:assert/strict';
import {
  saveMaterialMastery,
  __clearMasteryServerSyncCache,
  processEvent,
  createEmptyMastery,
  type MaterialMastery,
} from '../../lib/masteryEngine';

// ═══════════════════════════════════════════════════════════════════
// FREE MASTERY UPDATE STORM — regression contracts
//
// Antes del fix, cada saveMaterialMastery hacia 1 POST /api/mastery/update
// directo. Combinado con 8 useEffect en herramientas Free reportando
// freeModeUse/freeDomainPct en cada render, esto producia tormentas de
// cientos de requests por sesion.
//
// 2026 simplification: las 8 herramientas Free ya NO reportan
// freeModeUse/freeDomainPct/freeEvidenceQuality en absoluto (el progreso
// de uso vive en lib/freeToolState.ts, derivado de los envelopes
// durables, sin ningún dispatch de evento). El vector de tormenta original
// queda eliminado en la fuente. Este contrato prueba que el mecanismo de
// debounce/dedupe que protege saveMaterialMastery (todavía usado por
// examen/repasar para concept-tracking de Adaptive) sigue intacto:
//   A. saveMaterialMastery con mismo payload N veces → 1 POST (dedupe)
//   B. saveMaterialMastery con cambios reales → M POST (M = cambios reales)
//   C. Debounce: 10 saves en < 800ms → 1 POST (colapsa)
//   D. processEvent (ruta general, sin freeModeUse) sigue produciendo
//      toolsCompleted correcto para el concept-tracking que examen/repasar
//      SÍ conservan tras la limpieza de Mission 4.
// ═══════════════════════════════════════════════════════════════════

const memory = new Map<string, string>();
const originalWindow = (globalThis as any).window;
const originalLocalStorage = (globalThis as any).localStorage;
const originalFetch = globalThis.fetch;

let postCount = 0;
const postPayloads: string[] = [];

Object.assign(globalThis, {
  window: {},
  localStorage: {
    getItem: (k: string) => memory.get(k) || null,
    setItem: (k: string, v: string) => memory.set(k, v),
    removeItem: (k: string) => memory.delete(k),
  },
});

globalThis.fetch = (async (url: any, init?: any) => {
  const urlStr = String(url);
  if (urlStr.includes('/api/mastery/update')) {
    postCount++;
    if (init?.body) postPayloads.push(String(init.body));
  }
  return new Response(JSON.stringify({ success: true }), { status: 200 });
}) as typeof fetch;

function resetPostCounter() {
  postCount = 0;
  postPayloads.length = 0;
  __clearMasteryServerSyncCache();
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForDebounce() {
  // Debounce es 800ms, esperar 900ms para asegurar
  await sleep(900);
}

async function main() {
try {
  // ═══════════════════════════════════════════════════════════════════
  // TEST A: mismo payload N veces → 1 POST
  // ═══════════════════════════════════════════════════════════════════
  {
    resetPostCounter();
    const mastery = createEmptyMastery({
      materialIds: ['mat-A'],
      materialNames: ['Material A'],
      sessionKey: 'test-A-sessionkey',
    });

    // Llamar 20 veces con el mismo mastery (simula reopen/reload/rerender)
    for (let i = 0; i < 20; i++) {
      saveMaterialMastery(mastery);
    }

    await waitForDebounce();

    assert.equal(postCount, 1, `TEST A: mismo payload 20 veces → esperado 1 POST, real ${postCount}`);
    console.log(`TEST A PASS: 20 saves de mismo payload → ${postCount} POST (esperado 1)`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // TEST B: cambios reales → múltiples POST (uno por cambio distinto)
  // ═══════════════════════════════════════════════════════════════════
  {
    resetPostCounter();
    let mastery = createEmptyMastery({
      materialIds: ['mat-B'],
      materialNames: ['Material B'],
      sessionKey: 'test-B-sessionkey',
    });

    // Cambio 1: examen reporta resultado real (score → toolsCompleted)
    mastery = processEvent(mastery, {
      tool: 'examen',
      materialId: 'mat-B',
      sessionKey: 'test-B-sessionkey',
      timestamp: Date.now(),
      score: 85,
      confidence: 70,
      conceptsIdentified: ['concepto-1'],
    });
    saveMaterialMastery(mastery);
    await waitForDebounce();
    const afterChange1 = postCount;

    // Cambio 2: repasar reporta resultado real
    mastery = processEvent(mastery, {
      tool: 'repasar',
      materialId: 'mat-B',
      sessionKey: 'test-B-sessionkey',
      timestamp: Date.now(),
      score: 60,
      coveragePercent: 40,
      conceptsIdentified: ['concepto-2'],
    });
    saveMaterialMastery(mastery);
    await waitForDebounce();
    const afterChange2 = postCount;

    assert.equal(afterChange1, 1, `TEST B: primer cambio → 1 POST, real ${afterChange1}`);
    assert.equal(afterChange2, 2, `TEST B: segundo cambio real → 2 POST totales, real ${afterChange2}`);
    console.log(`TEST B PASS: 2 cambios reales → ${afterChange2} POST (esperado 2)`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // TEST C: burst de 10 saves en < 800ms → 1 POST (debounce colapsa)
  // ═══════════════════════════════════════════════════════════════════
  {
    resetPostCounter();
    let mastery = createEmptyMastery({
      materialIds: ['mat-C'],
      materialNames: ['Material C'],
      sessionKey: 'test-C-sessionkey',
    });

    // Simular 10 llamadas rápidas cambiando toolsData (para que hash sea distinto)
    for (let i = 0; i < 10; i++) {
      mastery = processEvent(mastery, {
        tool: 'examen',
        materialId: 'mat-C',
        sessionKey: 'test-C-sessionkey',
        timestamp: Date.now(),
        score: i + 1, // cambia cada vez
      });
      saveMaterialMastery(mastery);
      await sleep(50); // rápido, < 800ms entre saves
    }

    await waitForDebounce();

    // Debounce debe colapsar el burst en 1 sola POST (el último estado)
    assert.equal(postCount, 1, `TEST C: 10 saves rápidos → esperado 1 POST (debounce colapsa), real ${postCount}`);
    console.log(`TEST C PASS: burst de 10 saves → ${postCount} POST (esperado 1)`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // TEST D: ruta general de processEvent (sin freeModeUse) sigue marcando
  // toolsCompleted correctamente — el concept-tracking que examen/repasar
  // conservan tras la limpieza de Mission 4 no se rompió.
  // ═══════════════════════════════════════════════════════════════════
  {
    const base = createEmptyMastery({
      materialIds: ['mat-D'],
      materialNames: ['Material D'],
      sessionKey: 'test-D-sessionkey',
    });
    assert.equal(base.toolsCompleted.examen, false);

    const afterExam = processEvent(base, {
      tool: 'examen', materialId: 'mat-D', sessionKey: 'test-D-sessionkey',
      timestamp: Date.now(), score: 90, confidence: 80,
    });
    assert.equal(afterExam.toolsCompleted.examen, true, 'TEST D: un evento con score debe marcar toolsCompleted');
    assert.notEqual(afterExam, base, 'TEST D: un cambio real debe producir una nueva identidad');

    console.log('TEST D PASS: ruta general de processEvent (post-limpieza) sigue funcionando');
  }

  console.log('\n═══ free-mastery-update-storm-contracts: 4/4 PASS ═══');
  console.log('Storm murió en la fuente (0 eventos freeModeUse en los 8 tools) + debounce/dedupe intacto.');

} catch (err) {
  console.error('CONTRACT FAILED:', err);
  process.exit(1);
} finally {
  globalThis.fetch = originalFetch;
  Object.assign(globalThis, { window: originalWindow, localStorage: originalLocalStorage });
}
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
