# Fase 5 — recorridos visuales completos con materiales reales

Fecha: 2026-07-16

## Estado

**INCOMPLETO — environment_blocked.** Se construyó la matriz separada y Playwright descubre 8 recorridos, pero este entorno deniega `listen(127.0.0.1)` antes del primer test. No se declara ningún recorrido PASS, no se hizo commit y no se hizo deploy.

## Baseline obligatorio

Antes de editar se ejecutó la cadena solicitada:

| Validación | Resultado |
|---|---|
| `git status --short` | inspeccionado; 25 archivos modificados y trabajo no rastreado de fases previas, todo preservado |
| `git diff --stat` | inspeccionado; 25 archivos, 2451 inserciones y 383 eliminaciones en el baseline |
| `git diff --check` | PASS |
| `npx tsc --noEmit` | PASS |
| `npm run test:e2e` | environment_blocked antes del primer caso: `listen EPERM 127.0.0.1:3100` |
| `npm run test:e2e:real-materials` | no alcanzado por la cadena porque el comando anterior terminó con exit code 1 |

El estado 33/33 y 10/10 aportado por el usuario se conserva como estado validado de entrada, no como una revalidación producida por este ambiente.

## 1. Arquitectura de prueba

### Capa real

- Los tres fixtures exactos se seleccionan mediante `<input type="file">`.
- Multipart, bytes, nombre, MIME, tamaño y extracción pasan por `/api/e2e-real-materials/extract` y `extractText(..., { localOnly: true })`.
- El grafo del recorrido usa los conceptos derivados determinísticamente del texto extraído; no sustituye el documento por un tema sintético.
- Se reutilizan `IntroSession` y `PaginatedBookPage`, incluidos widgets, feedback y render matemático real con KaTeX.
- Cada respuesta pasa por `recordEvidence`; cada micro se valida con `isMicroMastered` y la salida final proviene de `evaluateSessionCompletion().isProgramComplete`.
- La persistencia de material, sesión, interacción, respuesta, feedback, confianza, evidencia e historial se realiza en `localStorage` y se restaura al montar el harness.

### Capa determinista

- El tutor test-only selecciona una secuencia reproducible de formatos y objetivos a partir del `cognitiveType` derivado del material.
- Los perfiles automatizados determinan aciertos, errores, confianza y asistencia.
- El orden, latencia y presupuesto son reproducibles; máximo global 80 turnos y máximo efectivo 6 intentos por micro.

### Mocked

- Redacción y selección de actividades. Los prompts incorporan el nombre del micro y extracto del documento real.
- Conducta del estudiante automatizado.
- No se llama a un LLM, OpenRouter ni servicios de pago.

### No mocked

- Fixture, upload, bytes, extracción, identidad, texto, conceptos requeridos, componentes visuales de actividad, evidencia, asistencia, Mastery Contracts, dominio y cierre canónico.
- El tutor determinista no escribe mastery ni fabrica `program_complete`.

## 2. Materiales

Los conteos siguientes provienen de la extracción local ya verificada y de la configuración observable del nuevo recorrido. La ejecución visual permanece bloqueada.

| Nombre | Formato | Bytes | Extracción | Chars | Micros del recorrido | Required | Sesiones | Páginas |
|---|---|---:|---|---:|---:|---:|---:|---:|
| `niels bohr.pdf` | PDF | 262,349 | `pdf-parse`, texto nativo | 7,614 | 3 | 3 | 3 micros procesados secuencialmente | 5 |
| `Documento_Matematico_Calculo.docx` | DOCX | 37,604 | `mammoth`, local | 6,735 | 3 | 3 | 3 micros procesados secuencialmente | n/a |
| `Documento_Medico_Cardiovascular.docx` | DOCX | 37,483 | `mammoth`, local | 5,615 | 3 | 3 | 3 micros procesados secuencialmente | n/a |

El harness limita explícitamente la matriz a los primeros tres conceptos derivados para mantener un presupuesto visual acotado. No elimina IDs dentro del programa creado por el recorrido: esos tres forman su conjunto canónico `requiredMicroIds`.

## 3. Recorridos

Playwright descubre los siguientes recorridos. Como el web server no pudo arrancar, las métricas de turnos, repairs, cobertura y dominio se dejan como **no ejecutadas** y no se copian de simulaciones engine-only.

| Material | Perfil | Estado final | Turnos | Sesiones | Repairs | Strategy changes | Assistance max | Independent successes | Coverage | Mastery | Unresolved | isProgramComplete | False mastery | Repetidos q/fact/prompt |
|---|---|---|---:|---:|---:|---:|---|---:|---:|---:|---|---|---:|---|
| Niels Bohr | capable | environment_blocked | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e |
| Niels Bohr | misconception prone | environment_blocked | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e |
| Niels Bohr | refresh + salir/volver | environment_blocked | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e |
| Matemático | capable | environment_blocked | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e |
| Matemático | assistance dependent | environment_blocked | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e |
| Médico | capable | environment_blocked | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e |
| Médico | low confidence | environment_blocked | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e |
| Médico | random guesser | environment_blocked | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e |

La matriz contiene assertions para: partición mastered/unresolved; cobertura y dominio separados; completion canónica; ausencia de `questionId`, prompt y `factKey` repetidos salvo `repetitionIntent`; cambio de estrategia tras misconception; baja confianza sin repair; asistencia revelada sin mastery; random guesser incompleto; y restore en answering, feedback, collecting_confidence y salir/volver.

## Fase 5B — Niels Bohr

### Diagnóstico previo al fix

Los dos fallos se clasifican principalmente como **A. bug del arnés**, con un defecto compartido de interpretación de evidencias en el producto y un **C. contrato ambiguo** sobre la identidad del grafo. No hay evidencia de que `evaluateSessionCompletion` ni `isProgramComplete` fabriquen o pierdan mastery: ambos devolvieron correctamente `false` con tres unresolved.

1. `required-count=3` provenía de dos `slice(0, 3)` explícitos en el harness (ingesta y render), no del motor ni del documento. Era una muestra reducida creada para acotar la prueba.
2. Esos tres micros eran un **subset benchmark** del grafo determinista E2E derivado del texto. No eran los nueve micros canónicos de la regresión ni un fallback. El reporte anterior los describía incorrectamente como el conjunto canónico completo del recorrido.
3. Los tres quedaron tipados `conceptual`: el clasificador sólo reconoce matemático por nombre de archivo y causal por `/causa|efecto|transicion/`; ninguno de los tres nombres extraídos satisface esas reglas.
4. El contrato conceptual exige una evidencia `recognized` strong, una `explained` strong, una `connected` medium si no hay strong, tres éxitos independientes y asistencia máxima `minimal_hint`. Transfer, integración retenida y delayed recall no bloquean mastery provisional.
5. Capable registró por micro respuestas correctas e independientes en `multiple_choice` (`recognized` strong), `teach_back` (`explained` strong) y `matching` (`recognized` + `connected`, ambas strong). Misconception-prone registró primero un error independiente con confianza alta en `multiple_choice`, después éxito en `teach_back` y éxitos repetidos en `matching`; al indexar la secuencia por errores más evidencias, nunca volvió a producir `recognized` positivo.
6. Capable produjo cuatro éxitos independientes por tipo generado (recognized 2, explained 1, connected 1). Misconception-prone produjo explained 1 y connected/recognized desde matching, pero su reconocimiento inicial quedó fallido y la secuencia se desplazó; las repeticiones posteriores no cubrieron de forma fiable el gap seleccionado.
7. Todas las evidencias positivas de estos dos perfiles tuvieron `assistanceLevel=independent`. La confianza alta del primer error misconception-prone se recogió en UI, pero el snapshot anterior no la exponía junto a la evidencia incorrecta.
8. `mastered-count` permaneció 0 porque `checkMasteryContract` y `getMissingEvidences` interpretaban `minStrong=0, minMedium=1` como “debe ser medium exactamente”: una evidencia strong no satisfacía el mínimo medium, pese al comentario contractual “medium si no hay strong”. En misconception-prone se sumaba el desplazamiento de actividad por contar el fallo como si hubiese cubierto el primer tipo.
9. Ambos recorridos cerraron por el fusible local del harness (`microAttempts >= 6`), no por mastery. El harness fabricaba `totalInteractions=12` para procesados no dominados, por lo que el motor clasificó correctamente los tres como unresolved y cerró la sesión, no el programa.
10. Sí: el test esperaba `program_complete` sin conducir evidencia que el evaluador vigente aceptara y `finish()` retornaba en el primer `summary`.
11. Misconception-prone sólo recibía una reparación superficial: el string de estrategia cambiaba a `repair-*`, pero no existía una nueva sesión, presupuesto renovado ni selección de actividad guiada por `missingEvidences`.
12. No existía final review contractual separado. El último `matching` era una actividad visual ordinaria; el summary no creaba evidencia.

La ruta de extracción real devuelve ocho candidatos por un límite artificial de `humanConcepts`, mientras la regresión canónica usa un fixture pedagógico distinto de nueve micros (`b1`–`b9`). Por tanto, antes del fix había dos grafos Bohr distintos. Para cumplir el contrato de “material real completo”, Fase 5B eliminará el truncamiento, elevará el grafo textual determinista a nueve candidatos y recorrerá sus nueve required micros. La regresión de nueve micros sigue validando el grafo pedagógico canónico y aislamiento de Falcons; no se afirmará que ambos grafos tienen IDs o taxonomía idénticos.

### Fix y estado posterior

- Test rojo: `phase10-pedagogical-contracts` terminó 11 PASS / 1 FAIL con la assertion “evidencia strong satisface un mínimo medium”. Después del fix terminó 12/12 PASS.
- Contrato: no se cambió ningún `MASTERY_CONTRACT`. Sólo se corrigió la comparación de fuerza para que strong satisfaga un piso medium del mismo tipo, tanto al evaluar como al calcular gaps.
- Grafo: `humanConcepts` produce hasta nueve conceptos y el harness dejó de aplicar `slice(0, 3)`. La invocación directa con el PDF real confirmó 9 micros derivados y `required-count` queda afirmado como 9 en ambos tests Bohr.
- Actividades: el siguiente formato se deriva de `getMissingEvidences`; un fallo ya no consume/omite el tipo objetivo. El capable recibe recognized → explained → connected independientes. Misconception-prone falla primero con confianza alta, conserva el gap recognized, cambia a estrategia `repair-*` y recibe una actividad nueva antes de continuar con explained/connected.
- Sesiones y repairs: el fusible usa intentos de la sesión, no el número de evidencias (un `matching` crea dos). El summary unresolved expone `continue-repair`, renueva el presupuesto sólo de unresolved y el runner continúa; se detiene únicamente en `program_complete`, `valid_incomplete` sin repair o presupuesto explícito de 40 interacciones.
- Telemetría: `data-evidence-diagnostics` expone por micro cognitive type, contrato, evidencias, strengths, asistencia por tipo, éxitos independientes por tipo, mastery score, gaps, resolución e interacciones; también se exponen session count y fuse reason.
- Final review: continúa sin ser una fuente paralela de mastery. El summary no registra evidencia; sólo las respuestas evaluadas mediante `recordEvidence` cuentan.

Estado lógico esperado tras el fix (pendiente de certificación Chromium por bloqueo ambiental): capable `program_complete` en 27 respuestas como máximo para 9 micros conceptuales; misconception-prone `program_complete` en 36 como máximo (un error independiente y tres aciertos contractuales por micro), con repair y cambio de estrategia. En ambos casos `programComplete=true` sólo puede provenir de `evaluateSessionCompletion` con 9/9 mastered y unresolved vacío. No se presenta esta proyección determinista como resultado Playwright ejecutado.

### Validación Fase 5B

| Validación | Resultado |
|---|---|
| test rojo contractual | 11 PASS / 1 FAIL, reproducido |
| test verde contractual | 12/12 PASS |
| `npm run test` | PASS |
| `npm run test:adaptive-v3-bohr` | 42/42 PASS; 9 micros, Falcons 0, false mastery 0 |
| extracción directa `niels bohr.pdf` | PASS; 7,614 chars, 5 páginas, 9 micros |
| `npx tsc --noEmit` | PASS |
| Bohr capable Playwright | environment_blocked antes del caso: `listen EPERM :3102` |
| Bohr misconception-prone Playwright | environment_blocked antes del caso: `listen EPERM :3102` |
| real sessions 8 tests | environment_blocked antes del primer caso: `listen EPERM :3102` |
| real materials 10 tests | environment_blocked antes del primer caso: `listen EPERM :3101` |
| E2E original 33 tests | environment_blocked antes del primer caso: `listen EPERM :3100` |
| `git diff --check` | PASS |

Archivos modificados en Fase 5B:

- `app/api/e2e-real-materials/extract/route.ts`
- `app/e2e-real-sessions/page.tsx`
- `lib/adaptive/v3/engine/evidenceEngine.ts`
- `lib/adaptive/v3/engine/masteryContracts.ts`
- `scripts/tests/phase10-pedagogical-contracts.ts`
- `tests/e2e-real-sessions/real-sessions.spec.ts`
- `PHASE_5_REAL_SESSIONS_E2E_REPORT.md`

No hubo commit ni deploy. La fase no se declara exitosa mientras no puedan certificarse los 2/2 Bohr, 8/8 real sessions, 10/10 real materials y 33/33 originales en un entorno que permita localhost.

## 4. Bugs encontrados

| ID | Material | Perfil | Capa | Causa raíz | Test rojo | Fix | Test verde |
|---|---|---|---|---|---|---|---|
| P5-ENV-001 | todos | todos | ambiente | sandbox deniega apertura de puertos localhost | capaz Niels termina antes del primer caso con `listen EPERM :3102` | no corresponde modificar producto ni timeouts | no disponible |
| P5-ENV-002 | todos | todos | ambiente | `tsx` no puede crear su socket IPC | `npm run test` termina con `listen EPERM .../tsx-502/*.pipe` | diagnóstico equivalente con `node --import tsx` | suite equivalente PASS; comando exacto continúa bloqueado |
| P5-HAR-001 | todos | todos | harness | la primera versión calculaba el booleano final en el componente | inspección del contrato de salida detectó que no provenía del motor | el harness construye `SessionState` observable y consume `evaluateSessionCompletion().isProgramComplete` | TypeScript PASS; Playwright bloqueado |
| P5-HAR-002 | assistance dependent | matemático | harness | una reparación independiente podía repetir `factKey` sin declarar intención | revisión de la assertion anti-repetición | se conserva el fact y se marca `repetitionIntent`; el prompt y `questionId` siempre cambian | TypeScript PASS; Playwright bloqueado |

## 5. Validación final

| Validación | Resultado actual |
|---|---|
| `npx tsc --noEmit` | PASS después del bloque de implementación |
| `npm run test` | environment_blocked por socket IPC `tsx` |
| suite general con `node --import tsx` | PASS, incluyendo Product Flow 42/42 y contratos de fases 2–10 |
| `npm run test:adaptive-v3-bohr` | pendiente de la cadena final |
| `npm run simulate:v3:smoke` | pendiente de la cadena final |
| `npm run simulate:v3:deterministic` | pendiente de la cadena final |
| `npm run simulate:v3:mass -- 1000` | pendiente de la cadena final |
| `npm run test:e2e` | environment_blocked por `listen EPERM :3100` |
| `npm run test:e2e:real-materials` | pendiente de reintento final; baseline encadenado no lo alcanzó |
| `npx playwright test --config=playwright.real-sessions.config.ts --list` | PASS; 8 tests descubiertos |
| `npm run test:e2e:real-sessions -- --grep "niels bohr.pdf · capable"` | environment_blocked antes del test por `listen EPERM :3102` |
| `git diff --check` | PASS después del bloque de implementación |
| `npm run build` | pendiente de la cadena final |

## Artefactos y configuración

- Configuración: `playwright.real-sessions.config.ts`.
- Matriz: `tests/e2e-real-sessions/real-sessions.spec.ts`.
- Harness: `app/e2e-real-sessions/page.tsx`.
- `retries: 0`; sin `skip`, `fixme` ni `only`.
- Trace y video: `retain-on-failure`; screenshot automático: `only-on-failure`.
- Los tests solicitan screenshots estables de upload, libro, primera pregunta y cierre. Los archivos no existen todavía porque Chromium no llegó a ejecutar los casos.

## Condición de salida

Fase 5 no puede declararse completada: faltan ejecuciones visuales reales, screenshots y la cadena final exacta. El resultado conservado es `environment_blocked`; no se avanza a producción.

## Fase 5D — flujo completo de repair

### Causa raíz

`finish()` trataba el primer `summary` con `isProgramComplete=false` como un resultado terminal `valid_incomplete`. Ese resumen sólo cerraba la sesión actual: mientras existieran unresolved y el control `continue-repair`, el producto seguía ofreciendo oportunidades pedagógicas válidas. El helper confundía session summary con program summary y no ejercitaba el flujo de repair.

### Comportamiento incorrecto anterior

- `program_complete` se aceptaba correctamente sólo desde `data-is-program-complete=true`.
- Cualquier otro primer `summary` devolvía inmediatamente `valid_incomplete`.
- No se pulsaba `continue-repair`, no se abría el siguiente libro/sesión y no se verificaba persistencia entre sesiones.
- El límite local podía producir un resultado incompleto sin demostrar que la UI estaba cerrada en `summary`.
- La assertion final exigía que todos los IDs siguieran en `processed`, aunque `processed` describe la cola de la sesión actual y se reinicia para unresolved al abrir repair. Cobertura histórica (`studied`) y procesamiento de la sesión no son la misma métrica.

### Flujo final de `finish()`

1. Recorre una actividad completa mediante answering → feedback → collecting_confidence → avance; nunca retorna desde una fase activa.
2. Sólo evalúa una salida cuando `data-interaction-phase=summary`.
3. Si `data-is-program-complete=true`, devuelve `program_complete` sin fabricar dominio.
4. Si el programa sigue incompleto, comprueba el control `continue-repair`, la razón terminal y los tres presupuestos globales.
5. Si el repair sigue permitido, pulsa `continue-repair`, espera el libro canónico, comprueba que historial y conteos de evidencia no retrocedieron, pulsa `start-session` y continúa.
6. Devuelve `valid_incomplete` únicamente desde un `summary` cuando no hay repair válido, existe `global_budget_exhausted` o se agotó un presupuesto global.
7. Mastered y unresolved continúan proviniendo de `evaluateSessionCompletion`; el helper no escribe evidencia, mastery ni `isProgramComplete`.

### Presupuestos globales

| Presupuesto | Límite | Semántica |
|---|---:|---|
| Sesiones | 16 | Incluye la sesión inicial y las sesiones abiertas desde repair. |
| Interacciones | 80 | Cuenta actividades completas; coincide con el fusible global observable del harness. |
| Repairs | 15 | Cuenta transiciones efectivas mediante `continue-repair`. |

El agotamiento nunca retorna a mitad de answering, feedback o collecting_confidence. La salida incompleta se acepta únicamente después de que la UI haya cerrado limpiamente en `summary`.

### Tests rojos

1. Se añadieron assertions que exigían `finalPhase=summary`, persistencia de historial/evidencia y, para perfiles incompletos, al menos una segunda sesión y un repair. Con el helper anterior: Bohr capable y misconception-prone fallaron porque el resultado sólo contenía turns, summaries y outcome; la corrida se detuvo tras 2 FAIL y 6 no ejecutados.
2. Con el nuevo recorrido, random_guesser alcanzó correctamente el summary terminal global, pero la assertion antigua falló al exigir que todos los required permanecieran en `processed`. El rojo demostró la mezcla entre cobertura histórica y cola de la sesión actual.

### Tests verdes

- El resultado de `finish()` prueba `finalPhase=summary` en los siete recorridos de perfil.
- Historial previo permanece como prefijo exacto después de cada repair.
- Los conteos de evidencia por micro nunca disminuyen entre sesiones.
- Los perfiles incompletos abren repair y una nueva sesión antes del cierre terminal.
- Todos los IDs required fueron estudiados; en programa completo todos también están procesados en la sesión final. En programa incompleto, `processed` sólo se exige como subconjunto válido de required.
- La partición `mastered ∪ unresolved = required`, su intersección vacía y el cierre exclusivamente por `isProgramComplete` permanecen vigentes.

### Resultados por perfil

| Material / perfil | Estado final | Sesiones | Repairs entre sesiones | Resultado pedagógico |
|---|---|---:|---:|---|
| Niels Bohr / capable | `program_complete` | 1 | 0 | Completa 9/9 por evidencia independiente y mastery real. |
| Niels Bohr / misconception_prone | `program_complete` | 1 | 0 | Repara dentro de la sesión mediante estrategias `repair-*` y completa por mastery real. |
| Cálculo / capable | `program_complete` | 1 | 0 | Completa por mastery real. |
| Cálculo / assistance_dependent | `valid_incomplete` | 2 | 1 | Recorre repair; la ayuda revelada no produce independencia ni mastery. Cierra por presupuesto global con unresolved. |
| Cardiovascular / capable | `program_complete` | 1 | 0 | Completa por mastery real. |
| Cardiovascular / low_confidence | `program_complete` | 1 | 0 | Completa con evidencia correcta; la baja confianza no activa un repair artificial ni altera el contrato de mastery. |
| Cardiovascular / random_guesser | `valid_incomplete` | 3 | 2 | Recorre dos sesiones de repair y cierra por presupuesto global con unresolved y false mastery 0. |
| Niels Bohr / restore y salir-volver | sesión activa restaurada | 1 | 0 | Conserva identidad en answering, feedback y collecting_confidence; no es un test de cierre programático. |

### Estado final de suites

| Validación | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run test:e2e:real-sessions` | 8/8 PASS, 0 skipped, retries 0 |
| `npm run test:e2e:real-materials` | 10/10 PASS |
| `npm run test:e2e` | 33/33 PASS |
| `npm run test` | PASS |
| `git diff --check` | PASS |

No se modificó el motor pedagógico, los Mastery Contracts, `isProgramComplete` ni los fixtures. No hubo commit ni deploy.

## Fase 5E — identidad canónica del material

### Causa raíz

`generateProgramWithStyle()` elegía `baseMastery.materialId` antes que la identidad del material abierto. Cuando el mastery procedía de un upload anterior, `generate-program` cargaba el grafo viejo y copiaba sus microIds a `requiredMicroIds` y `assignedMicroIds`. Después `StudyALSessionV3` construía el grafo del upload actual y enviaba al tutor una combinación incompatible, correctamente rechazada como `MATERIAL_GRAPH_MISMATCH`.

### Variable incorrecta y objeto reutilizado

- Variable incorrecta: `materialId` dentro de `generateProgramWithStyle()`.
- Fuente incorrecta: `baseMastery?.materialId` con prioridad sobre `materiales[0]`.
- Objeto viejo reutilizado: `baseMastery.adaptiveProgram`, incluidas sus sesiones, sessionIds, graph identity y assignedMicroIds.

### Validación añadida

- La identidad canónica sale exclusivamente de `materiales[0].materialId`, con `materiales[0].id` como equivalente canónico de compatibilidad.
- `baseMastery` sólo se pasa a la generación cuando su `materialId` coincide exactamente con el actual.
- El programa generado incorpora `materialId` y `graphMicroIds` obtenidos del grafo guardado bajo el userId/materialId actuales.
- Antes de aceptar o restaurar un programa se exige coincidencia exacta de `materialId`, igualdad del conjunto de graphMicroIds y pertenencia al grafo de todos los required, assigned y retention IDs.

### Programa incompatible

Si falla la validación, se descarta únicamente `adaptiveProgram`; setup, estilo, blueprint y demás datos del material se conservan. La UI vuelve al flujo de generación segura. No se restaura ningún sessionId ni assignedMicroId incompatible, no se muestra programa completo y no se escribe mastery.

### Test rojo

El contrato nuevo falló antes del fix al intentar importar resolutores inexistentes de identidad. La primera importación directa del componente también demostró que la lógica debía aislarse de React/KaTeX para poder verificarse como contrato puro. Los casos cubren mastery viejo, materialId distinto, microIds ausentes, mismo material válido y re-upload con identidad nueva.

### Tests verdes

- Contratos Bohr de producto: 27 PASS / 0 FAIL, incluyendo nueve assertions nuevas de identidad.
- Regresión Bohr: 42/42 PASS. La corrupción Falcons → Bohr continúa detectándose; la protección `MATERIAL_GRAPH_MISMATCH` no fue modificada.
- Real sessions: 9/9 PASS, incluyendo el nuevo recorrido de re-upload.

### Re-upload del mismo PDF

El test sube `niels bohr.pdf`, inicia su programa, cierra y elimina su snapshot local, vuelve a subir el mismo archivo con un materialId nuevo, crea e inicia la primera sesión y verifica:

- materialId nuevo distinto del primero;
- cero `MATERIAL_GRAPH_MISMATCH` en el flujo válido;
- todos los assignedMicroIds pertenecen al grafo del segundo upload;
- ningún assignedMicroId del primer programa se reutiliza.

### Estado final

| Validación | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run test` | PASS |
| `npm run test:adaptive-v3-bohr` | 42/42 PASS |
| `npm run test:e2e` | 33/33 PASS |
| `npm run test:e2e:real-materials` | 10/10 PASS |
| `npm run test:e2e:real-sessions` | 9/9 PASS, incluido re-upload |
| `git diff --check` | PASS |

No se tocaron tutor, Mastery Contracts, `isProgramComplete`, reglas de cobertura/dominio ni fixtures. No hubo commit ni deploy.

## Fase 5F — contratos de interacción y loading

### Causa exacta del `fill_blank_bank` inválido

El fallo era una cadena A+B+C: el proveedor o un elemento legacy del banco podía entregar un `fill_blank_bank` parcial; `normalizeInteractionForPreference()` convertía `fill_blank` a `fill_blank_bank` cambiando el tipo, pero no construía un banco ausente; y el validador anterior agrupaba dos condiciones distintas bajo `incomplete fill_blank_bank` antes de lanzar una excepción que la ruta convertía en HTTP 500.

Los logs históricos no conservaron el payload crudo del proveedor y el reason code anterior era deliberadamente impreciso. Por ello no es posible afirmar honestamente cuál de sus dos ramas faltó en aquella ejecución: `data.bank` con menos de dos valores o `data.correctAnswers` vacío. La reproducción mínima confirmada conserva template y respuesta correcta, pero omite `bank`; antes producía exactamente el 500 observado y ahora se identifica como `FILL_BLANK_BANK_WORD_BANK_MIN_2`.

La actividad anterior `true_false` no contaminaba el estado siguiente. La corrupción ocurría en la nueva actividad: la conversión rapid conservaba el payload parcial al cambiar su formato a `fill_blank_bank`. `pendingNextPage` sólo exponía el resultado porque no existía una preparación contractual completa en ese límite.

### Pipeline de reparación y fallback

1. Normaliza aliases, identidad y campos equivalentes sin perder micro, objetivo ni evidencia objetivo.
2. Valida con reason codes específicos por formato y preferencia.
3. Intenta una reparación determinista segura: IDs, deduplicación, banco y respuesta incluida exactamente una vez.
4. Revalida.
5. Para contenido generado, permite una sola regeneración acotada con los reason codes y restricciones anti-repetición.
6. Revalida la regeneración.
7. Si aún falla, entrega un fallback local contractual: rapid usa un `fill_blank_bank` completo; transferencia/aplicación conserva una actividad de caso apropiada en vez de degradar siempre a opción múltiple.

El servidor registra `INVALID_GENERATED_INTERACTION`, `INTERACTION_REPAIRED`, `INTERACTION_REGENERATED` e `INTERACTION_SAFE_FALLBACK` con material/micro, objetivo, formatos y reason codes. Un fallo de contenido del proveedor deja de convertirse en 500 visible. La protección 409 `MATERIAL_GRAPH_MISMATCH` permanece intacta y ningún fallback escribe evidencia ni mastery.

El cliente aplica la misma preparación antes de aceptar una respuesta y sólo entonces escribe `pendingNextPage`; de ese modo nunca persiste ni renderiza una interacción parcial, incluso al restaurar respuestas legacy.

### Formatos cubiertos

La matriz contractual cubre los 24 formatos reales de `InteractionFormat`: `multiple_choice`, `multi_select`, `true_false`, `fill_blank`, `fill_blank_bank`, `matching`, `ordering`, `open_response`, `explain_why`, `teach_back`, `practical_case`, `prediction`, `step_by_step_solver`, `numeric_short`, `classify_groups`, `find_the_error`, `complete_procedure`, `complete_reaction_or_formula`, `calculator_check`, `choose_best_procedure`, `quick_check`, `formula_builder`, `concept_map` y `compare_contrast`. Rapid rechaza `open_response` y `step_by_step_solver`; su `fill_blank` siempre termina como banco completo.

Renderer y evaluator recibieron soporte explícito para `multi_select` y los aliases procedimentales, numéricos, de fórmula y selección de procedimiento. Los formatos semánticos conservan evaluación por criterios; restore mantiene tipo, payload e identidad.

### Test rojo y tests verdes

- Rojo inicial: el caso mínimo sin `wordBank` esperaba `FILL_BLANK_BANK_WORD_BANK_MIN_2`; el contrato anterior devolvió el genérico `incomplete fill_blank_bank` (27 PASS / 1 FAIL).
- Contratos Bohr finales: 61/61 PASS, incluyendo un válido por cada formato, reason codes precisos, reparación de banco/respuesta/duplicados, fallback, preservación de micro/objetivo e IDs nuevos.
- Regresión visual rapid: `true_false → continuar → fill_blank_bank` completo, renderizable y evaluable, sin `Algo salió mal`, `Error del tutor` ni `INVALID_INTERACTION`.
- Recorrido real Bohr equivalente: PASS; usa el PDF real, fuerza error/repair y comprueba banco visible y ausencia de 500.
- La regeneración está acotada a un intento y el fallback termina el pipeline, por lo que no existen loops de contenido.

### Loading perceptible

Durante la petición se oculta la actividad anterior y aparece dentro de la hoja un estado `aria-busy=true` con el texto “ALAI está preparando la siguiente actividad”, indicador animado y pulso discreto. Los controles anteriores dejan de existir como elementos interactivos, no hay doble click y la transición elimina el loading cuando llega exactamente una actividad. El error de red sigue siendo recuperable mediante el estado de error existente.

El Playwright de loading verifica aparición inmediata con respuesta demorada, ausencia de contenido anterior, `aria-busy`, animación CSS efectiva, desaparición al resolver y una sola actividad interactiva.

### Repair no repetitivo

Se añadieron fingerprints normalizados de prompt, explicación, ejemplo y key points. Una enseñanza demasiado similar para el mismo micro se rechaza y se sustituye por una intervención que cambia una dimensión real en un ciclo determinista: contraste/representación, pasos/estrategia o evidencia de fuente. Se conserva la repetición intencional y el máximo existente de dos teachings consecutivos.

Las pruebas detectan dos explicaciones casi iguales, repetición de ejemplo/estrategia y verifican que la reparación siguiente cambia representación. Smoke y mass mantienen `max teaching streak = 2`; mass obtiene 94% de cambio de estrategia y false mastery 0.

### Resultado del recorrido manual reproducido

El flujo `true_false → continuar → fill_blank_bank` entrega template con blank explícito, banco único de al menos dos opciones y respuesta correcta incluida una vez. La actividad renderiza, acepta respuesta, muestra feedback y no muestra error del tutor. El nuevo caso Playwright real pasa.

### Estado de validación

| Validación | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run test` | PASS; contratos Bohr 61/61 |
| `npm run test:adaptive-v3-bohr` | 42/42 PASS; false mastery 0 |
| `npm run simulate:v3:smoke` | PASS; 0 invariantes, loops, divergencias y false mastery |
| `npm run simulate:v3:deterministic` | 22/22 escenarios PASS; su muestra pequeña reporta 71% en la métrica agregada de cambio de estrategia |
| `npm run simulate:v3:mass -- 1000` | PASS; 1000 runs, 0 fallos, 94% strategy changed, false mastery 0 |
| `npm run test:e2e:real-materials` | 10/10 PASS |
| `npm run test:e2e:real-sessions` | 10/10 PASS; el perfil completo asistido requiere hasta 55,5 s sólo de recorrido, por lo que el presupuesto del runner es 120 s; retries 0 |
| `npm run test:e2e` | 33/33 PASS |
| `npm run build` | PASS; advertencia preexistente de configuración ESLint `next/typescript`, build exit 0 |
| `git diff --check` | PASS |

No se modificaron Mastery Contracts, `isProgramComplete`, cobertura/dominio ni la protección de corrupción del tutor. No hubo commit ni deploy.
