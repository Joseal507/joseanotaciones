# ADAPTIVE BROWSER PHASE REPORT

Fecha: 2026-07-15

## Estado

La fase no puede declararse completada. Se conservaron todos los cambios existentes y no se hizo commit ni deploy. No se usaron `git reset`, `git clean`, `git checkout`, `git restore` ni `stash`.

## Bugs reproducidos

1. El proyecto no tenía configuración ni comando de Playwright aunque `@playwright/test` y Chromium ya estaban presentes.
2. El reporte masivo imprimía `TODOS LOS CRITERIOS: PASS` comprobando solo cuatro invariantes y omitía eficiencia, reparación y cambio de estrategia.
3. Las métricas agregaban perfiles capaces, recuperables y adversariales en tasas globales no interpretables.
4. La ejecución real de navegador contra localhost está impedida en este sandbox: Next falla al abrir `127.0.0.1:3100` con `listen EPERM`.
5. La simulación no es reproducible sin red en el estado actual: no existe `node_modules/.bin/tsx` y `npx` falla contra npm con `ENOTFOUND registry.npmjs.org`.

## Causas

- No existían `playwright.config.ts`, `tests/e2e/` ni `test:e2e`.
- `runMassSimulation.ts` calculaba el exit code únicamente con invariantes, loops y false mastery.
- `report.ts` no clasificaba perfiles ni exponía métricas por segmento.
- El perfil de seguridad del entorno no permite escuchar puertos TCP. El error ocurre antes de cargar la aplicación.
- `tsx` se invoca mediante `npx`, pero no está instalado en `node_modules`; la red está deshabilitada.

## Archivos modificados en esta fase

- `playwright.config.ts`: Chromium, localhost, screenshots, videos y traces retenidos en fallo.
- `tests/e2e/adaptive-v3.spec.ts`: fixture de red aislado y recorridos iniciales del flujo canónico y chat.
- `app/e2e-adaptive/page.tsx`: página fixture que monta el componente v3 real con material, usuario y sesión aislados; no fabrica autenticación.
- `package.json`: comando `test:e2e`.
- `scripts/simulation/adaptive-v3/types.ts`: segmentos y métricas segmentadas.
- `scripts/simulation/adaptive-v3/studentProfiles.ts`: clasificación explícita capable/recoverable/adversarial.
- `scripts/simulation/adaptive-v3/report.ts`: cálculo y salida segmentada; gates pedagógicos visibles.
- `scripts/simulation/adaptive-v3/runMassSimulation.ts`: exit code estricto para todos los umbrales solicitados.

## Resultados Playwright

- Playwright: 1.61.1, instalado.
- Chromium: instalado en el cache administrado de Playwright.
- `npm run test:e2e -- --project=chromium`: **BLOCKED**, no PASS.
- Motivo exacto: `Error: listen EPERM: operation not permitted 127.0.0.1:3100`.
- Ninguna afirmación E2E se considera aprobada mientras Chromium no complete el recorrido.

## Screenshots, videos y traces

- Configurados en `reports/playwright-artifacts/` con `only-on-failure` / `retain-on-failure`.
- No se generó artefacto de página porque el servidor fue rechazado antes de que Chromium pudiera navegar.

## Métricas segmentadas

El harness ahora produce por separado para `capable`, `recoverable` y `adversarial`:

- runs;
- cantidad y tasa de program completion;
- promedio de turnos por micro;
- repair success (solo recuperables);
- strategy change cuando hubo oportunidad de fallo repetido;
- false mastery.

No se publican valores nuevos en este reporte: la ejecución `npm run simulate:v3:mass -- 64` quedó bloqueada porque `npx` intentó descargar `tsx` y la red respondió `ENOTFOUND`. Los últimos valores documentados (no regenerados) siguen siendo 22 turnos/micro globales, 6% repair success y 27% strategy change.

## Umbrales

- false mastery = 0: no revalidado en esta fase; el gate existe.
- invariant failures = 0: no revalidado en esta fase; el gate existe.
- restore divergences = 0: añadido al exit code; no revalidado.
- infinite loops = 0: gate existente; no revalidado.
- capable <= 12 turnos/micro: gate añadido; estado **FAIL según evidencia previa**, pendiente de nueva ejecución.
- recoverable repair success >= 60%: gate añadido; estado **FAIL según evidencia previa**, pendiente de nueva ejecución.
- strategy change >= 80%: gate añadido; estado **FAIL según evidencia previa**, pendiente de nueva ejecución.
- adversarial false mastery = 0: gate segmentado añadido; pendiente de nueva ejecución.

## Validaciones ejecutadas

- `npx tsc --noEmit`: PASS después de los cambios de esta fase.
- `git diff --check`: PASS.
- `npm run test:e2e`: BLOCKED por `listen EPERM`.
- `npm run simulate:v3:mass -- 64`: BLOCKED por ausencia local de `tsx` y red `ENOTFOUND`.

La matriz final completa no fue ejecutada y no se declara PASS.

## Riesgos pendientes

- Faltan implementar y ejecutar los 22 recorridos solicitados; los dos specs iniciales no sustituyen esa matriz.
- No se ha demostrado refresh, salida/retorno, navegación desde resumen, ausencia de legacy ni persistencia previa a navegación en Chromium.
- No se han corregido todavía las causas del exceso de turnos; solo se eliminó el falso PASS.
- No se ha medido generación on-demand ni prefetch máximo 2.
- Persisten `any`/`as any` preexistentes documentados en el reporte bloqueado.
- La página fixture debe mantenerse fuera de recorridos de usuario y retirarse o protegerse antes de producción.

## Prueba manual exacta

En un entorno que permita localhost y tenga las dependencias ya instaladas:

1. Ejecutar `npm run test:e2e`.
2. Ante un fallo, abrir `reports/playwright/index.html` y revisar screenshot, video y trace en `reports/playwright-artifacts/`.
3. Ejecutar `npm run simulate:v3:mass -- 1000`; confirmar exit 0 y revisar `reports/adaptive-v3-simulation-summary.json` por segmento.
4. Iniciar `npm run dev`, abrir `/materias` y autenticar una única vez con una cuenta de prueba real.
5. Guardar ese estado con el setup de storageState de Playwright cuando se añada; no copiar cookies ni fabricar una sesión.
6. Subir los fixtures teórico, matemático y Bohr; completar setup en rapid y mix_everything.
7. Verificar visualmente feedback → confianza → Continuar, refresh, salir/volver, repair, chat, resumen con scroll y retorno al libro canónico.
8. Confirmar en Network que la respuesta de cierre contiene `sessionPersisted: true` antes de la navegación y que programa completo solo aparece con `isProgramComplete: true` del motor.
