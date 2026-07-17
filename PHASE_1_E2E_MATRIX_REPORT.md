# PHASE 1 — E2E MATRIX REPORT

Fecha: 2026-07-15

## Resultado

La matriz Playwright quedó creada y Playwright descubre **33 pruebas en 8 archivos**. La ejecución real de Chromium no comenzó porque el entorno rechazó la apertura de `127.0.0.1:3100` con `listen EPERM`.

No se contabiliza ninguna prueba como PASS o FAIL sin ejecución real:

- total creado: 33;
- ejecutadas: 0;
- verdes confirmadas: 0;
- rojas confirmadas: 0;
- bloqueadas antes de ejecutar: 33.

`npx playwright test --list` sí terminó correctamente y enumeró las 33 pruebas. `npm run test:e2e` terminó antes del primer test con `Error: listen EPERM: operation not permitted 127.0.0.1:3100`.

## Pruebas creadas

1. introducción aparece una sola vez;
2. Finalizando no reinicia la introducción;
3. llegada al libro canónico;
4. Entendido avanza una sola vez;
5. doble clic produce una sola evaluación;
6. loading oculta el contenido anterior;
7. evaluar muestra feedback completo;
8. confianza no avanza;
9. Continuar es el único avance;
10. última respuesta no cierra antes de Continuar;
11. nueva pregunta limpia confianza anterior;
12. no aparecen microIds;
13. resumen tiene scroll;
14. resumen usa nombres humanos;
15. trabajado, dominado y refuerzo no se mezclan;
16. Ver mi progreso vuelve al libro canónico;
17. Ver mi programa vuelve al libro canónico;
18. no aparece ninguna vista legacy;
19. rapid rechaza open_response y step_by_step;
20. rapid fill_blank incluye word bank;
21. respuesta numérica acepta unidad opcional compatible;
22. respuesta semánticamente equivalente no exige texto exacto;
23. no aparece LaTeX crudo;
24. no se duplica una fórmula;
25. una pregunta no contiene su propia respuesta;
26. chat permite pregunta, respuesta, repregunta y scroll;
27. refresh conserva interactionId, questionId y fase;
28. salir y volver conserva la sesión;
29. repair no repite questionId;
30. repair no repite factKey sin intención explícita;
31. final review no repite literalmente preguntas anteriores;
32. persistencia ocurre antes de navegar;
33. programa completo exige isProgramComplete true.

## Verdes y rojas

No hay clasificación válida de verdes o rojas porque el servidor de Playwright no pudo escuchar en localhost y Chromium no ejecutó assertions. Marcar casos basándose en inspección estática o en resultados anteriores fabricaría el resultado.

Por la misma razón, no existe una “causa de cada roja” confirmada. La causa común de las 33 bloqueadas es externa a cada assertion: `webServer` falla antes de servir `/e2e-adaptive` por `listen EPERM`.

## Diseño determinista

- El fixture monta `StudyALSessionV3` real.
- Graph, tutor y chat se aíslan con respuestas deterministas del fixture de navegador.
- Loading, feedback, confianza, avance, resumen, navegación y chat se comprueban en el DOM real.
- Los contratos rapid y fuga de respuesta usan las funciones reales de `interactionContract`.
- La equivalencia numérica usa `evaluateNumericShort` real.
- Se añadieron atributos observables estables para `interactionId`, `questionId` y `factKey`.
- Screenshots se conservan solo en fallo; video y trace se retienen en fallo según `playwright.config.ts`.
- No se añadió ningún `skip` ni espera larga arbitraria.

## Archivos modificados en esta fase

- `app/e2e-adaptive/page.tsx`
- `components/materias/adaptive/v3/PaginatedBookPage.tsx`
- `components/materias/adaptive/v3/StudyALSessionV3.tsx`
- `tests/e2e/adaptive-intro.spec.ts`
- `tests/e2e/adaptive-interaction.spec.ts`
- `tests/e2e/adaptive-loading.spec.ts`
- `tests/e2e/adaptive-summary.spec.ts`
- `tests/e2e/adaptive-navigation.spec.ts`
- `tests/e2e/adaptive-rapid.spec.ts`
- `tests/e2e/adaptive-math.spec.ts`
- `tests/e2e/adaptive-v3.spec.ts`
- `PHASE_1_E2E_MATRIX_REPORT.md`

`tests/e2e/adaptive-fixtures.ts` ya existía como cambio no rastreado al iniciar esta fase y se conservó sin modificar como base compartida; no fue necesario alterar la pedagogía del motor.

## Siguiente orden recomendado

1. Ejecutar `npm run test:e2e` en un entorno que permita escuchar `127.0.0.1:3100` y registrar la clasificación real.
2. Corregir primero cualquier fallo del arnés o selector que impida llegar a la assertion específica.
3. Corregir después los fallos visibles de máquina de interacción: 4–11.
4. Continuar con restauración y persistencia: 27, 28 y 32.
5. Corregir navegación y resumen: 12–18.
6. Corregir contratos de formato, respuestas y matemáticas: 19–25.
7. Corregir anti-repetición y final review: 29–31.
8. Verificar al final la puerta canónica `isProgramComplete`: 33.

No se hizo commit ni deploy.
