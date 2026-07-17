# Fase 3 — Motor pedagógico adaptativo v3

**Estado final: INCOMPLETO.** Los objetivos pedagógicos duros pasan en la simulación final de 1000 corridas, pero no se cumplen todas las condiciones formales de salida: Playwright no pudo iniciar el servidor por `listen EPERM`, el build no pudo descargar Google Fonts por `ENOTFOUND`, y el resumen de aceptación de la muestra determinista pequeña marca 71% de cambio de estrategia en `capable` aunque sus 22 escenarios pasan y la muestra masiva registra 89% para ese segmento. No hubo commit ni deploy.

## 1. Baseline inicial

- `git diff --check`: PASS.
- `npx tsc --noEmit`: PASS.
- `npm run test:e2e`: bloqueado localmente por `listen EPERM 127.0.0.1:3100`. El estado de entrada aportado por el usuario era 33/33 PASS, 0 failed y 0 skipped; no se presenta como una revalidación posterior.
- `npm run test:adaptive-v3-bohr`: 42/42 PASS.
- Smoke inicial: `capable avgTurnsPerMicro=17.2`, `recoverable repairSuccessRate=0%`, `strategyChangeAfterRepeatedFailure=40%`, false mastery contractual 0.
- Deterministic inicial: 22/22 escenarios, pero gates pedagógicos rojos: capable 13.8 turnos/micro, repair recuperable 0% y cambio estratégico 36%.
- El arnés confundía proxies con resultados reales: repair por número de sesiones, cambio estratégico como booleano por corrida y false mastery mediante una comparación inválida entre un objeto de resolución y un string.
- Scripts reales confirmados en `package.json`: `test`, `test:adaptive-v3-bohr`, `simulate:v3:smoke`, `simulate:v3:deterministic`, `simulate:v3:mass`, `test:e2e` y `build`.

## 2. Métricas por perfil — simulación final de 1000 corridas

Seeds reproducibles: 10000–10999. Los 16 perfiles recorren los 8 programas sintéticos por bloques, evitando el acoplamiento previo entre índice de perfil e índice de programa.

| Segmento / perfil canónico | Runs | Completion | Avg turns/micro | Máx. turns/micro | Repair success | Cambio estrategia | False mastery |
|---|---:|---:|---:|---:|---:|---:|---:|
| **CAPABLE** | **189** | **85%** | **11.9** | **62** | **99%** | **89%** | **0** |
| expert | 63 | 86% | 10.5 | 46 | 99% | 90% | 0 |
| deep_understanding | 63 | 86% | 10.9 | 34 | 99% | 88% | 0 |
| strong_beginner | 63 | 84% | 14.2 | 62 | 98% | 89% | 0 |
| **RECOVERABLE** | **250** | **56%** | **36.2** | **90** | **69%** | **93%** | **0** |
| misconception_prone | 63 | 71% | 33.9 | 90 | 86% | 95% | 0 |
| low_confidence | 62 | 82% | 13.1 | 50 | 96% | 88% | 0 |
| inconsistent | 62 | 68% | 30.3 | 90 | 87% | 93% | 0 |
| assistance_dependent | 63 | 3% | 67.0 | 90 | 13% | 90% | 0 |
| **ADVERSARIAL** | **250** | **40%** | **46.6** | **90** | **55%** | **95%** | **0** |
| random_guesser | 63 | 6% | 63.6 | 90 | 23% | 95% | 0 |
| answer_repeater | 62 | 11% | 62.7 | 90 | 22% | 95% | 0 |
| reveal_dependent | 62 | 63% | 39.6 | 90 | 87% | 89% | 0 |
| memorizer_without_transfer | 63 | 78% | 20.4 | 90 | 96% | 92% | 0 |

Los perfiles auxiliares no se mezclaron en los gates obligatorios. En el total de 1000 corridas hubo 562 programas completos y 438 incompletos válidos.

## 3. Tests rojos creados

Se añadió `scripts/tests/phase10-pedagogical-contracts.ts` y se integró a `npm test`. Los rojos observados antes de cada corrección cubrieron:

1. más de dos enseñanzas consecutivas entre micros distintos;
2. consolidación heurística sin Mastery Contract;
3. una actividad nueva degradada por fallos históricos;
4. enseñanza sin efecto en el estado latente del alumno simulado;
5. dos fallos separados por feedback sin cambio real de estrategia;
6. intervención repetida sin volver a práctica;
7. repair success calculado mediante `sessionCount`;
8. strategy change calculado como booleano por corrida;
9. repair heredando un fusible agotado;
10. independencia en evidencia irrelevante compensando evidencia requerida asistida;
11. evidencia requerida demasiado asistida desapareciendo de los objetivos de repair.

Los contratos de assisted-only, revealed-only, fuse, cierre, cobertura, restore, rapid, no repetición de questionId/factKey y final review ya tenían assertions deterministas en las suites existentes; se conservaron sin `skip`, `fixme`, `only`, eliminación o debilitamiento.

## 4. Causas raíz

- El selector tomaba el último evento, no la última respuesta, y perdía el contexto del fallo tras enseñar.
- No distinguía si el fallo ya había recibido intervención, por lo que podía enseñar repetidamente.
- El límite de enseñanza era local al micro, no global a la sesión.
- Tres atajos de `consolidate` evitaban el contrato canónico de mastery.
- `minStrong=0` satisfacía accidentalmente contratos que requerían evidencia medium.
- La independencia se validaba globalmente, no por cada tipo de evidencia requerida y su asistencia.
- `getMissingEvidences` añadía tipos genéricos fuera del Mastery Contract y omitía tipos requeridos obtenidos con ayuda excesiva.
- El número histórico de intentos debilitaba evidencia de actividades nuevas.
- Una sesión repair conservaba `totalInteractions` del fusible anterior.
- El simulador no aplicaba aprendizaje después de una actividad teaching y sus métricas usaban proxies.
- La simulación masiva acoplaba perfiles y programas mediante módulos incompatibles, por lo que cada perfil no veía todos los programas.
- Una reenseñanza genérica cada tres aciertos añadía turnos sin evidencia contractual y empujaba capable sobre el límite.

## 5. Cambios aplicados

- `objectiveSelector`: última respuesta real, conteo de fallos atravesando feedback, una intervención por respuesta, rotación tras fallos repetidos, límite global de dos teaching, consolidación solo por `isMicroMastered` y eliminación de la reenseñanza periódica no contractual.
- `evidenceEngine` y `masteryContracts`: cumplimiento por evidencia requerida, fuerza, independencia y asistencia por tipo; objetivos repair contractuales; intento reiniciado por actividad.
- `stateMachine`: repair conserva evidencia histórica pero obtiene presupuesto de interacción nuevo; el fusible solo deja unresolved/processed.
- Ruta tutor: cada interacción nueva informa intento 1.
- Simulador: enseñanza modifica conocimiento latente cuando el perfil puede aprender; repair, estrategia, fuse, coverage, retention, restore, asistencia, independencia y cambios de actividad se derivan de eventos reales.
- Reporte del arnés: false mastery canónico separado de desacuerdo con conocimiento latente; segmentación obligatoria y métricas por perfil.
- Mass runner: distribución reproducible de todos los programas para cada perfil.

No se cambiaron thresholds canónicos, mínimos de evidencia, perfiles ni límites de turnos.

## 6. Tests verdes

- Phase 10 pedagogical contracts: 11/11 PASS.
- `npm run test`: PASS. Incluye Product Flow, Interaction Flow, Bohr Product Contracts y fases 2–10, todas con 0 fallos.
- `npm run test:adaptive-v3-bohr`: 42/42 PASS.
- Smoke final: criterios agregados PASS; teaching streak máximo 2, false mastery 0, repair recuperable 75%, capable 11.7 y cambio estratégico 96% total.
- Deterministic: 22/22 escenarios PASS; false mastery, invariantes, restore divergences, loops, premature fuse y cierres inválidos en cero. Su resumen segmentado pequeño conserva un gate rojo de estrategia capable (71%); por eso no se declara toda la validación verde.

## 7. Métricas finales

Simulación masiva final, 1000 corridas:

- capable avgTurnsPerMicro: **11.9** (objetivo ≤12: PASS);
- recoverable repairSuccessRate: **69%** (objetivo ≥60%: PASS);
- strategyChangeAfterRepeatedFailure: **94% total**; capable 89%, recoverable 93%, adversarial 95% (objetivo ≥80%: PASS);
- adversarial false mastery: **0**;
- false mastery contractual total: **0**;
- invariant failures: **0**;
- restore divergences: **0**;
- infinite loops: **0**;
- premature fuse: **0**;
- cierre sin `isProgramComplete`: **0**;
- required coverage de programas completos: **100%**;
- evidence diversity contractual: **100%**;
- máximo teaching consecutivo: **2**;
- repair success total: **70%**;
- actividad cambia tras respuesta correcta: **47.4%** en dimensión observable de objetivo/formato;
- actividad cambia tras respuesta incorrecta: **94.2%**;
- retained mastery en revisiones posteriores: **11.8%**;
- discrepancia “motor mastered / conocimiento latente insuficiente”: **8.5%**. Esta métrica de calibración no es false mastery contractual y se conserva separada, no se oculta.

`questionId`, `factKey` y prompt normalizado no existen en la simulación engine-only porque ésta no instancia el banco/LLM; por tanto sus métricas masivas son `null`, no cero fabricado. La no repetición se prueba en Bohr Product Contracts y las suites E2E/deterministas. El arnés sí registra formatos, evidencia objetivo y estrategia.

## 8. Regresiones ejecutadas

| Validación | Resultado final |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run test` | PASS |
| `npm run test:adaptive-v3-bohr` | 42/42 PASS |
| `npm run simulate:v3:smoke` | PASS en ejecución exacta previa; repetición final con `node --import tsx` PASS por bloqueo intermitente IPC de `npx tsx` |
| `npm run simulate:v3:deterministic` | 22/22 escenarios; resumen de gate segmentado pequeño rojo (capable strategy 71%) |
| `npm run simulate:v3:mass -- 1000` | comando exacto bloqueado por IPC `tsx`; comando equivalente `node --import tsx scripts/simulation/adaptive-v3/runMassSimulation.ts 1000` PASS, 1000/1000 procesadas |
| `npm run test:e2e` | NO EJECUTABLE: `listen EPERM 127.0.0.1:3100`; no se certifican post-cambio los 33 tests |
| `npm run build` | NO EJECUTABLE: `ENOTFOUND fonts.googleapis.com` en `next/font` |
| `git diff --check` | PASS |

Los bloqueos IPC de `tsx` son del entorno: el mismo archivo ejecutado por el loader oficial `node --import tsx` produce las métricas y archivos de reporte. No se fabricó un PASS para E2E ni build.

## 9. Limitaciones reales pendientes

1. Reejecutar Playwright en un entorno que permita escuchar en localhost y confirmar 33/33 después de estos cambios.
2. Reejecutar build con acceso a Google Fonts o con la caché requerida; no se cambió la política de fuentes en esta fase.
3. Resolver o redefinir con evidencia el gate estadístico del resumen determinista: 22 escenarios no proporcionan una muestra estable por segmento, mientras 1000 corridas dan 89% para capable. No se modificó el gate para esconderlo.
4. `assistance_dependent` individual tiene repair success 13%, aunque el segmento recoverable obligatorio alcanza 69%. Es una limitación real del perfil no recuperable bajo su configuración actual (`canImprove=false`).
5. `strong_beginner` individual usa 14.2 turnos/micro aunque el segmento capable cumple 11.9. No se alteró el perfil para facilitar el resultado.
6. La discrepancia con conocimiento latente (8.5%) y la retención posterior baja (11.8%) requieren calibración futura sin debilitar Mastery Contracts.
7. Las identidades reales de preguntas/prompts necesitan telemetría de la ruta tutor o navegador; el simulador del motor no debe inventarlas.

Hasta resolver las validaciones bloqueadas, **no avanzar a materiales reales ni producción**.
