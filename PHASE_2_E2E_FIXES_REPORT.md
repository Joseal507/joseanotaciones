# PHASE 2 — E2E FIXES REPORT

Fecha: 2026-07-15

## Estado

Incompleto por bloqueo de ejecución. Línea base recibida y confirmada por el log de fase 1: 33 pruebas, 24 PASS y 9 FAIL, sin retries. Los cambios de esta fase compilan, pero no se puede afirmar 33/33 sin ejecutar Chromium.

## Fallos 1–3 — introducción y libro canónico

- Clasificación final: A, bug del test/selector.
- Evidencia: screenshots, error-context y trace sitúan el timeout esperando `/Continuar/`; `IntroSession` muestra `Siguiente →` en pasos 1–2 y `¡Comenzar a estudiar! →` en el paso 3.
- Causa raíz: el helper `finishIntro` buscaba etiquetas que no pertenecen a esta UI.
- Test rojo: `adaptive-intro.spec.ts` casos 01, 02 y 03.
- Corrección: testids `intro-next` e `intro-enter-program`; el helper usa la semántica real sin cambiar etiquetas visuales.
- Archivos modificados: `components/materias/adaptive/IntroSession.tsx`, `tests/e2e/adaptive-intro.spec.ts`.
- Test verde: ejecución intentada; bloqueada antes del test por `listen EPERM` en `127.0.0.1:3100`.

## Fallo 4 — categorías del resumen

- Clasificación final: A, bug del selector.
- Evidencia: el contenido correcto está visible en el screenshot; `getByText(...).locator('..')` selecciona el padre inmediato del título, no la tarjeta de categoría.
- Causa raíz: locator dependiente de la estructura interna.
- Test rojo: `adaptive-summary.spec.ts`, caso 15.
- Corrección: testids `summary-studied`, `summary-mastered`, `summary-reinforcement` y assertions explícitas de pertenencia y exclusión.
- Archivos modificados: `StudyALSessionV3.tsx`, `adaptive-summary.spec.ts`.
- Test verde: ejecución intentada; bloqueada antes del test por `listen EPERM` en `127.0.0.1:3100`.

## Fallos 5–6 — refresh y salir/volver

- Clasificación final: B, bugs reales del producto.
- Evidencia: `StudyALSessionV3` iniciaba todos sus campos con estado vacío y `initSession` llamaba siempre al tutor tras construir el grafo. No existía persistencia de página, fase, respuesta, evaluación, feedback ni confianza.
- Causa raíz: snapshot de interacción exclusivamente en memoria React.
- Tests rojos: casos 27 y 28 de `adaptive-v3.spec.ts`.
- Corrección: snapshot por usuario/material/sesión, restaurado antes de llamar al tutor, con identidad, fase, actividad, respuesta, evaluación, feedback, confianza, pendientes e historial anti-repetición.
- Archivos modificados: `StudyALSessionV3.tsx`.
- Tests verdes: pendientes; el servidor Playwright está bloqueado por `listen EPERM`.

## Fallos 7–9 — repair y final review

- Clasificación final: C, contrato ambiguo/no aplicado en el límite cliente-servidor.
- Evidencia: el cliente aceptaba sin validación cualquier siguiente actividad devuelta por el tutor, incluso questionId, factKey o prompt normalizado ya usados.
- Causa raíz: no había historial persistente ni rechazo explícito de candidatos repetidos.
- Tests rojos: casos 29, 30 y 31 de `adaptive-v3.spec.ts`.
- Corrección: historial persistente de questionIds, factKeys y fingerprints; rechazo de questionId/texto repetido y de factKey repetido salvo intención canónica. Los fixtures ahora prueban recuperación real: respuesta inválida seguida de una actividad genuinamente nueva.
- Archivos modificados: `StudyALSessionV3.tsx`, `adaptive-v3.spec.ts`.
- Tests verdes: pendientes; el servidor Playwright está bloqueado por `listen EPERM`.

## Bloqueo de ejecución

Los intentos de Playwright terminan antes de ejecutar assertions porque el entorno deniega `listen(127.0.0.1:3100)` con `EPERM`.

## Validación final

- `npx tsc --noEmit`: PASS.
- `npm run test:e2e`: BLOQUEADO antes del primer test; `listen EPERM 127.0.0.1:3100`.
- `git diff --check`: PASS.
- Playwright confirmado después de los cambios: 0 ejecutados; no se fabrican PASS/FAIL.
- Retries configurados: 0.
- Skips/fixme/only añadidos: 0.

## Estado pendiente

Debe reejecutarse `npm run test:e2e` en un entorno que permita abrir localhost. Hasta entonces no se confirma el verde de los nueve casos ni el objetivo 33/33.

## Fase 2B — cuatro fallos restantes

### Fallos 09 y 11 — Continuar y limpieza de confianza

- Causa raíz confirmada: la validación anti-repetición comparaba el fingerprint del prompt para toda actividad. `q1` y `q2` tienen questionId distintos, pero el mismo prompt normalizado; por eso la respuesta válida `q2` se convertía en `null`, `pendingNextPage` nunca se asignaba y Continuar conservaba `q1` mientras solicitaba otra actividad.
- Evidencia: ambos `error-context.md` recibidos muestran `data-interaction-id="q1"` tras Continuar; el código registraba el prompt de `q1` al aceptarlo y rechazaba `q2` en `repeatsPrompt`. Las respuestas mock entregan `q2` en `data.page.interaction`, no en otro campo.
- Test rojo: ejecución manual recibida, casos 09 y 11 en FAIL (29 PASS / 4 FAIL total). El intento local de `adaptive-interaction.spec.ts` del 15 de julio de 2026 quedó bloqueado antes del primer test por `listen EPERM 127.0.0.1:3100`.
- Cambio aplicado: questionId y factKey siguen siendo barreras globales; el fingerprint literal se exige en final review, donde el contrato lo requiere. La actividad se registra como usada al entrar realmente al flujo, no al ser un candidato pendiente. Continuar consume `pendingNextPage`, actualiza identidad/fase y limpia evaluación, respuesta y confianza sin una llamada adicional.
- Archivos modificados: `components/materias/adaptive/v3/StudyALSessionV3.tsx`.
- Test verde: no confirmable en este sandbox; Playwright no pudo iniciar el servidor. `npx tsc --noEmit` sí pasa.
- Posibles regresiones verificadas: el flujo conserva rechazo por questionId (caso 29), factKey sin intención (caso 30) y prompt literal en final review (caso 31) por inspección del mismo camino. Su ejecución real permanece pendiente por el bloqueo de localhost.

### Fallo 28 — salir y volver conserva la sesión

- Causa raíz confirmada: el primer fallo ocurría antes de salir por el mismo rechazo erróneo de `q-after-continue`. Además, la navegación dependía de que el `useEffect` de persistencia ejecutara después del commit de React, sin garantía antes del desmontaje.
- Evidencia: `error-context.md` muestra `q-before-exit` en la assertion inmediatamente posterior a Continuar. El handler de salida llamaba directamente a `onClose`; la única escritura del snapshot estaba en un efecto.
- Test rojo: ejecución manual recibida, caso 28 en FAIL. El intento local de `adaptive-v3.spec.ts` quedó bloqueado antes del primer test por `listen EPERM 127.0.0.1:3100`.
- Cambio aplicado: al consumir la página pendiente se persiste explícita y síncronamente el snapshot siguiente (`q-after-continue`) y el botón VOLVER AL LIBRO vuelve a persistir el estado más reciente antes de navegar. La restauración existente continúa evitando una llamada al tutor cuando hay snapshot.
- Archivos modificados: `components/materias/adaptive/v3/StudyALSessionV3.tsx`.
- Test verde: no confirmable en este sandbox; Playwright no pudo iniciar el servidor.
- Posibles regresiones verificadas: la puerta de cierre sigue usando `canRenderSessionComplete` y `isProgramComplete` no fue alterado. El caso 32 no cambia de ruta; su ejecución real permanece pendiente por el bloqueo.

### Fallo 23 — LaTeX crudo

- Causa raíz confirmada: `MathText` pedía la salida predeterminada `htmlAndMathml` de KaTeX. La fórmula visual era correcta, pero el MathML incluía un nodo `annotation` con el source `E_n=-\\frac{13.6}{n^2}`, que Playwright encontraba como texto del DOM.
- Evidencia: el mock contiene una sola fórmula y `PaginatedBookPage` la entrega una sola vez a `MathText`; la salida aislada anterior al cambio incluía la anotación de KaTeX. Después del cambio, `renderToString` reporta `hasRaw: false` y una sola coincidencia `katex-display`.
- Test rojo: ejecución manual recibida, caso 23 en FAIL. El intento local de `adaptive-math.spec.ts` quedó bloqueado antes del primer test por `listen EPERM 127.0.0.1:3100`.
- Cambio aplicado: KaTeX genera salida `html`, que mantiene el render visual y elimina el source LaTeX crudo del DOM.
- Archivos modificados: `components/MathText.tsx`.
- Test verde: verificación aislada PASS (`hasRaw: false`, `katex-display: 1`); la confirmación Playwright permanece bloqueada por localhost.
- Posibles regresiones verificadas: el marcador `.katex-display` continúa apareciendo exactamente una vez, preservando el contrato del caso 24; no se renderizan simultáneamente LaTeX y `plain`.

### Estado de validación de Fase 2B

- `npx tsc --noEmit`: PASS después de los cambios.
- Playwright específico: BLOQUEADO antes de ejecutar assertions por `listen EPERM 127.0.0.1:3100`.
- Retries: 0; no se añadieron `skip`, `fixme`, `only`, timeouts ni retries.
- No se hizo commit ni deploy.
