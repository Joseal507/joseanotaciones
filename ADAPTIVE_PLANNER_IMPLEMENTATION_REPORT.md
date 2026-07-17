# StudyAL — implementación del planner adaptativo

## Arquitectura anterior

La planificación estaba repartida entre tipos legacy, `generate-program`, prompts LLM, el tutor y `StudyALProcess`. El setup controlaba nivel, duración, fecha relativa, nota y preferencia de evaluación, pero no modelaba tipo de examen, fecha/hora exacta, disponibilidad ni prioridades. No existía un `StudyPlan` importable como fuente común por API, UI, simulación y Playwright. La pantalla enseñaba una lista de sesiones, pero no una explicación temporal/factible del siguiente paso.

Clasificación: la ausencia del planner era un contrato ambiguo y arquitectura duplicada; los cortes por timeout del arnés siguen siendo bugs del arnés; pérdida de micros, cierre sin mastery o sesiones posteriores al examen serían bugs de producto y ahora tienen invariantes explícitos.

## Arquitectura final

El núcleo puro se separa en:

- `planner/`: modelos, adaptación del setup y plan inicial.
- `scheduling/`: fechas disponibles y límite del examen.
- `feasibility/`: minutos estimados/disponibles y riesgo honesto.
- `assessmentPreferences/`: política rapid, writing y mixed.
- `activitySelection/`: objetivo pedagógico y selección determinista.
- `templates/`: intención pedagógica separada del widget visual.
- `planRevision/`: repair, ritmo, ausencias y nueva fecha.
- `readiness/`: coverage, mastery y exam readiness separados.
- presentación: `AdaptiveProgramHome`, setup ampliado y pausa de sesión.

`generate-program` construye `studyPlan` desde todos los micros del grafo actual. El programa legacy lo transporta como adaptador; no existe un segundo conjunto de required micros. El tutor usa el selector canónico después de que `objectiveSelector` determina qué evidencia falta. Simulador y Playwright importan las mismas funciones.

Las sesiones ejecutables se adaptan desde `studyPlan`: IDs asignados, propósito, duración, fecha, motivo, modo y alineación de examen provienen del plan canónico. Las sesiones de aprendizaje llevan required; reviews y final exam llevan retention sobre los micros planificados. La lista LLM anterior ya no puede divergir del calendario mostrado.

## Modelos y setup

Se añadieron `StudyPlan`, `PlanSession`, `PlanRevision`, `PlannerSetup`, `Availability`, `ExamContext`, `Feasibility`, `AssessmentMode`, `ExamFormat`, propósitos y estados del calendario.

El setup visible tiene ocho pasos: nivel, duración, fecha/hora, nota, modo de evaluación, tipo de examen, minutos/días disponibles y prioridades. Las prioridades aumentan prioridad sin excluir micros. `examDateTime` prevalece sobre presets relativos.

## Planificador, calendario y factibilidad

- Mañana: mayor densidad, pocas sesiones, retrieval/repair inmediato y simulación final.
- Semana: sesiones distribuidas y review espaciado.
- Mes: aprendizaje, integración, delayed review y examen.
- Tiempo insuficiente: `insufficient_time`, mensaje de riesgo y minutos adicionales recomendados; todos los micros permanecen required.
- Ninguna sesión se fecha después del examen.
- Nota alta, nivel inicial, duración, formato del examen y disponibilidad modifican costo, densidad, duración o alineación.

## Actividad, modos y plantillas

El nivel 1 usa objetivos `teach`, `diagnose`, `recognize`, `retrieve`, `discriminate`, `organize`, `explain`, `apply`, `integrate`, `transfer`, `repair`, `review`, `exam` y `metacognition`. El nivel 2 elige formato según modo y evidencia.

- Rapid prioriza formatos cortos; transferencia usa mini caso/predicción/procedimiento, nunca open response larga ni step-by-step largo.
- Writing prioriza explicación, teach-back, error, comparación, caso y predicción, con diagnóstico MCQ ocasional.
- Mixed decide por objetivo, no por alternancia aleatoria.

Las plantillas (`correct_peer_mistake`, `new_case`, `guided_comparison`, etc.) son independientes del renderer. Una misma intención puede usar writing o selección. El selector evita formatos/templates recientes y el pipeline existente conserva prompt, factKey, questionId, ejemplo y estrategia anti-repetición.

Una aplicación no enseñada baja a reconocimiento salvo diagnóstico. Incorrecta con confianza alta produce repair por ilusión de conocimiento. Correcta con confianza baja produce verificación breve, no repair. Ayuda fuerte exige evidencia independiente posterior. Mastery Contracts no cambian.

## Adaptación del plan

Después de una sesión se crea una revisión versionada usando únicamente resultados del motor:

- `unresolved` inserta repair;
- ritmo rápido acorta duración pendiente;
- sesión perdida se reprograma;
- fecha nueva redistribuye pendientes;
- final exam permanece;
- completadas son inmutables;
- required micros nunca se eliminan.

La revisión y el plan persisten dentro de `AdaptiveProgram`; restore conserva su historial.

## UI y comodidad

La pantalla muestra una acción principal: “Tu próxima sesión”, duración, objetivo, motivo, examen y “Empezar sesión”. Si el tiempo no alcanza, muestra riesgo sin prometer 100%. El calendario enumera hoy/próximas sesiones sin microIds. La sesión puede pausarse y reanudarse sin desmontar actividad ni evidencia. El cambio de plan tiene explicación humana.

## Examen final y readiness

Cada plan conserva una sesión `final_exam` alineada a selección múltiple, desarrollo, mixto, matemático, práctico o desconocido. La sesión incluye todos los required micros como retrieval/integración y no modifica contratos de dominio.

Las métricas son independientes:

- `coveragePercent`: material trabajado.
- `masteryPercent`: micros con dominio contractual.
- `examReadinessPercent`: dominio y transferencia ponderados por formato.

Coverage 100 con mastery 0 permanece `isProgramComplete=false`. El cierre sólo sigue aceptando `isProgramComplete === true` del motor y unresolved vacío.

## Bugs y contratos aclarados

- Se eliminó la falsa equivalencia “template separado = template distinto”: una plantilla puede conservarse cambiando el formato.
- El timeout del recorrido asistido sigue siendo responsabilidad del runner, no del planner.
- El planner nunca usa sesiones completadas como proxy de dominio.
- La nota objetivo cambia profundidad estimada, no reduce Mastery Contracts.
- No se hardcodeó por material, perfil, microId ni questionId.

## Tests y Playwright

El primer test rojo falló porque no existía `planner/initialPlanner`. Después, los contratos puros cubren examen mañana/semana/mes, factibilidad, cobertura total, fechas, final exam, modos, enseñanza previa, confianza, asistencia, templates, repair, ritmo, ausencia, cambio de fecha, restore conceptual y readiness.

`test:e2e:adaptive-planner` contiene 14 recorridos visuales: Bohr mañana/semana, matemático, médico, jurídico, tiempo insuficiente, nueva fecha, ausencia, ritmo rápido, repair, pausa, examen, coverage sin mastery y program complete contractual.

## Simulaciones

`simulate:adaptive-planner` cubre capable, misconception-prone, low-confidence, assistance-dependent, random-guesser, inconsistent, missed-sessions, fast-mastery y slow-mastery. Registra completion, adherence, added sessions, reschedules, repairs, coverage, mastery, readiness, deadline violations, lost micros y burden. Resultado inicial: 9/9, false mastery 0, micros lost 0, deadline violations 0.

## Limitaciones

- La factibilidad es determinista y conservadora; todavía no aprende coeficientes de tiempo entre materiales reales.
- Horarios opcionales se modelan, pero la UI inicial selecciona minutos y días; edición detallada de franjas queda disponible en el contrato.
- Readiness es una estimación, no sustituye mastery ni garantiza nota.
- Los formatos visuales especializados sólo pueden seleccionarse si el grafo/material aporta recursos; no se inventan imágenes o datos clínicos.

## Estado de validación

| Validación | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run test` | PASS, incluido `adaptive-planner-contracts` |
| `npm run test:adaptive-v3-bohr` | 42/42 PASS; false mastery 0 |
| `npm run simulate:v3:smoke` | PASS; 0 invariantes, loops, restore divergences y false mastery |
| `npm run simulate:v3:deterministic` | 22/22 escenarios PASS; la muestra pequeña conserva una alerta agregada histórica de strategy change |
| `npm run simulate:v3:mass -- 1000` | PASS; 1000 runs, strategy change 94%, false mastery 0 |
| `npm run simulate:adaptive-planner` | 9/9 perfiles PASS; micros lost 0, deadline violations 0, false mastery 0 |
| `npm run test:e2e` | 33/33 PASS |
| `npm run test:e2e:real-materials` | 10/10 PASS; cold compile multipart corregido en el arnés |
| `npm run test:e2e:real-sessions` | 10/10 PASS |
| `npm run test:e2e:adaptive-planner` | 14/14 PASS, retries 0 |
| `npm run build` | PASS; advertencia preexistente de configuración ESLint `next/typescript`, exit 0 |
| `git diff --check` | PASS |

No hubo commit ni deploy.

## Integración real de producto

La auditoría posterior detectó que varias capacidades estaban demostradas sólo por `/e2e-adaptive-planner`. Esta etapa conectó el mismo motor canónico al recorrido de `/materias`.

| Brecha inicial | Causa raíz | Integración y evidencia real |
|---|---|---|
| Missed/reschedule sólo harness | `reviseStudyPlan` no tenía acción en el libro | `StudyALBook` ofrece “No pude hacer esta sesión” y “Reprogramar sesión”; `StudyALProcess.applyRealPlanRevision` persiste la revisión, conserva completadas y vuelve a proyectar sesiones. |
| Cambio de examen sólo harness | no existía editor en el producto | El libro edita fecha/hora, revisa `examContext`, redistribuye pendientes en franjas válidas y restaura el cambio tras refresh. |
| Readiness invisible | `calculateExamReadiness` no consumía evidencia del programa | El libro muestra Cobertura, Dominio y Preparación por separado; la métrica es informativa y no participa en `programComplete`. |
| Plan y ejecutables divergentes | generación y revisión mantenían mapeos distintos | `adaptStudyPlanToSessions` es la única proyección usada por generación, revisión y restore; conserva completed/active y reconstruye locks, IDs y repairs. |
| `missingEvidence` incorrecto | el tutor enviaba `[objective]` | El tutor usa `getMissingEvidences` sobre el `EvidenceProfile` contractual del micro actual. |
| `priorTeaching` siempre verdadero | `shortDescription` actuaba como fallback booleano | `hasRealPriorTeaching` exige un turn de teaching real del mismo micro. |
| `examFormat=unknown` | la sesión no lo enviaba | Cada sesión proyectada conserva `examFormat` y `StudyALSessionV3` lo envía al tutor. |
| Pausa no restaurable | `paused` no pertenecía al snapshot ni se restauraba la vista running | Snapshot y marcador de sesión pausada restauran diálogo, página y fase; resume limpia el marcador. |
| `timeSlots` ignorados | scheduler sólo miraba días | `availableDates` usa día/hora de cada franja; revisión y cambio de examen reutilizan ese scheduler y no inventan una franja cuando no existe. |
| create-plan paralelo | el endpoint legacy no declaraba procedencia | Su respuesta queda marcada `legacy_compatibility_only`; `isCanonicalStudyPlan` impide que sustituya un plan `canonical_study_plan_v1`. |

Los tests rojos iniciales fueron `adaptive-product-integration-contracts`: faltaba la proyección canónica y fallaban sincronización, preservación de estado, aislamiento legacy, enseñanza real y franjas. El contrato ahora pasa. La nueva matriz `test:e2e:adaptive-product-real` abre `/materias?adaptive-product-real=1` con fixture determinista, pero monta `StudyALProcess`, `StudyALBook` y `StudyALSessionV3` reales. Sus 20 recorridos cubren urgencias y modos, riesgo insuficiente, missed/reschedule, fecha con refresh, readiness, conservación de micros, sincronización, formatos de examen, ausencia de false completion y pausa con refresh. Las únicas respuestas mockeadas son build-graph/tutor en el caso de pausa para mantener determinista la actividad; la máquina y persistencia del cliente son las reales.

Limitación real: la matriz de integración usa una identidad/material determinista dentro de la ruta real `/materias`; no realiza extracción OCR ni llama a un proveedor LLM. Esas dependencias se mantienen cubiertas por las suites de materiales y sesiones reales. El producto normal no entra en el fixture sin el query param explícito de E2E.

### Validación de integración real

| Validación | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run test` | PASS |
| `npm run test:adaptive-v3-bohr` | 42/42 PASS; false mastery 0 |
| `npm run simulate:v3:smoke` | PASS; false mastery 0 |
| `npm run simulate:v3:deterministic` | 22/22 escenarios; exit 0, con alerta agregada no bloqueante de strategy-change en la muestra pequeña |
| `npm run simulate:v3:mass -- 1000` | PASS; 1000 runs, false mastery 0, invariantes 0, restore divergences 0 |
| `npm run simulate:adaptive-planner` | 9/9; micros lost 0, deadline violations 0, false mastery 0 |
| `npm run test:e2e` | 33/33 PASS |
| `npm run test:e2e:real-materials` | 10/10 PASS |
| `npm run test:e2e:real-sessions` | 10/10 PASS |
| `npm run test:e2e:adaptive-planner` | 14/14 PASS |
| `npm run test:e2e:adaptive-product-real` | 20/20 PASS; `/materias`, componentes reales y pausa+refresh |
| `npm run build` | PASS; mantiene advertencia preexistente ESLint `next/typescript` |
| `git diff --check` | PASS |

La primera corrida del E2E original detectó que una respuesta rápida podía retirar el loading antes de completar su percepción visual. El producto ahora conserva el estado por un mínimo acotado de 700 ms; el test específico y la matriz 33/33 pasaron después del cambio.

## Prueba manual real y cierre UX

La auditoría del recorrido `/materias` convirtió los hallazgos manuales en contratos del producto:

- la fecha exacta usa `datetime-local`, se interpreta en la zona horaria local, valida futuro, prevalece sobre el preset, persiste como ISO y redistribuye sin crear sesiones posteriores al examen;
- `dailyMinutes` ya no recorta la duración ejecutable: se conserva como `plannedMinutesPerDay` y `optionalSessionTarget`, separado de `estimatedTotalMinutes` y `actualStudyMinutes`;
- nivel inicial `zero` usa orden topológico de prerrequisitos y dificultad ascendente antes de priorizar contenido avanzado;
- el plan genera títulos temáticos y objetivos de capacidad (`comprender`, `distinguir`, `aplicar`, `explicar`, `integrar`, `transferir`) desde los nombres reales del grafo;
- la introducción muestra material, micros reales, urgencia, tipo de plan, sesiones, estimación, temas completos, rationale y factibilidad;
- cobertura/dominio/preparación quedan en un encabezado compacto y los ajustes administrativos viven en un drawer cerrado por defecto;
- ausencia y reprogramación se presentan como opciones, no como requisito para continuar;
- `fill_blank_bank` exige al menos tres opciones, prohíbe placeholders y blanks triviales; si no existe un banco fiable cambia a otro formato compatible;
- el runner expone concepto actual, trabajados, dominados y cobertura como métricas distintas, y conserva la máquina `answering → evaluating → collecting_confidence → ready_to_continue → advancing` con identidades por interacción;
- se añadió `test:e2e:adaptive-manual-journey` sobre `/materias` con viewport 1440×768 y se amplió la matriz de producto con foco y apertura/cierre del drawer.

Validación ejecutada el 16 de julio de 2026:

| Validación | Resultado real |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run test` | PASS |
| `npm run test:adaptive-v3-bohr` | 42/42 PASS; false mastery 0 |
| `npm run simulate:v3:smoke` | PASS; false mastery 0, loops 0, invariantes 0 |
| `npm run simulate:v3:deterministic` | 22/22 escenarios; el reporte agregado de muestra pequeña aún marca strategy-change por debajo de 80% |
| `npm run simulate:v3:mass -- 1000` | PASS; 1000 runs, false mastery 0, loops 0, invariantes 0, strategy-change 94% |
| `npm run simulate:adaptive-planner` | 9/9 PASS; micros lost 0, deadline violations 0 |
| Playwright (todas las configuraciones) | BLOQUEO EXTERNO: el sandbox niega `listen` en localhost (`EPERM 127.0.0.1:3104`) antes de ejecutar casos |
| `npm run build` | BLOQUEO EXTERNO: `next/font` no puede resolver `fonts.googleapis.com` (`ENOTFOUND`) y webpack detiene el build |
| `git diff --check` | PASS |

No se hizo commit ni deploy. No se declara cierre completo mientras el entorno no permita ejecutar las matrices Playwright y mientras la alerta agregada determinista siga visible.

## Cierre pendiente por entorno

### Investigación de `strategy-change`

La investigación separó dos fenómenos:

1. **Problema real de métrica, corregido.** `measureStrategyChangesAfterRepeatedFailure` contaba una misma racha como oportunidades superpuestas al llegar al segundo, tercero, cuarto y posteriores fallos. También incorporaba al denominador una racha terminada al final del run, aunque no existiera una actividad posterior cuya estrategia pudiera cambiar. La métrica ahora registra una oportunidad al cruzar exactamente el umbral de dos fallos y únicamente cuando existe una decisión posterior observable.
2. **Ruido de muestra pequeña residual, conservado visiblemente.** La muestra deterministic obtiene 90% global (86 cambios de 97 oportunidades), pero el segmento `capable` contiene solo 9 oportunidades y queda en 7/9 = 77,8%. Una sola observación separa ese segmento del 80%. No se cambió el threshold ni se suprimió la alerta. En mass 1000, `capable` obtiene 295/333 = 88,6%, `recoverable` 1472/1634 = 90,1% y `adversarial` 1780/1998 = 89,1%. Esto descarta un bug sistemático del motor y clasifica la alerta residual deterministic como varianza de una muestra segmentada insuficiente.

El contrato nuevo `scripts/tests/simulation-strategy-metrics.ts` prueba causalmente que:

- una racha larga representa una sola oportunidad;
- una racha terminal sin actividad siguiente no es una oportunidad observable;
- repetir realmente la misma estrategia después de dos fallos sigue contando como fallo.

Los reportes ahora muestran numerador y denominador por segmento y perfil. No se modificaron Mastery Contracts, decisiones pedagógicas ni criterios de aceptación.

### Comandos ejecutados dentro del sandbox

| Comando | Estado |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run test` | PASS, incluido el contrato causal de strategy-change |
| `npm run test:adaptive-v3-bohr` | 42/42 PASS; false mastery 0 |
| `npm run simulate:v3:smoke` | PASS; criterios agregados verdes, false mastery 0 |
| `npm run simulate:v3:deterministic` | 22/22 escenarios PASS; 90% global; alerta segmentada visible por `capable` 7/9 |
| `npm run simulate:v3:mass -- 1000` | PASS; 1000 runs, false mastery 0, invariantes 0, loops 0, restore divergences 0; todos los segmentos > 80% |
| `npm run simulate:adaptive-planner` | 9/9 PASS; micros lost 0, deadline violations 0, false mastery 0 |
| `git diff --check` | PASS |

### Bloqueos externos, no fallos del producto

- **Playwright / permisos:** el proceso `next dev` no llega a iniciar porque el sandbox rechaza `listen` con `EPERM: operation not permitted 127.0.0.1:3104`. Los casos de navegador no comienzan; no existe un resultado funcional negativo del producto. No se modificó código de producto para sortear permisos.
- **Build / red:** `next/font` intenta obtener Plus Jakarta Sans desde `fonts.googleapis.com` y la resolución DNS falla con `ENOTFOUND`. Webpack termina con ``next/font` error: Failed to fetch `Plus Jakarta Sans` from Google Fonts.` Es un bloqueo externo de red. No se cambiaron fuentes ni configuración para fabricar un PASS.

### Comandos manuales fuera del sandbox

Ejecutar en un entorno con localhost permitido y acceso de red:

```bash
npm run test:e2e
npm run test:e2e:real-materials
npm run test:e2e:real-sessions
npm run test:e2e:adaptive-planner
npm run test:e2e:adaptive-product-real
npm run test:e2e:adaptive-manual-journey
npm run build
git diff --check
```

### Condición exacta para declarar COMPLETADO

Solo se puede declarar COMPLETADO cuando los siete comandos anteriores finalicen con exit code 0 fuera del sandbox, las matrices Playwright confirmen el recorrido manual de `/materias` sin repetición ni bloqueo y el build de producción termine correctamente. La alerta deterministic 7/9 debe permanecer documentada como señal de muestra pequeña; mass 1000 debe conservar false mastery 0, cero invariantes, cero loops, cero divergencias de restore y strategy-change segmentado por encima de 80%.
