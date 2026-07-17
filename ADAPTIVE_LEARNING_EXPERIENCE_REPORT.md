# StudyAL — experiencia adaptativa visible

## Arquitectura encontrada

El flujo real conserva la cadena `material → graph → program → session → tutor → evidence → mastery → persistence → completion`. `StudyALSessionV3` coordina la máquina visible y el snapshot; `/api/adaptive/v3/tutor` evalúa, selecciona objetivo/formato, valida la actividad y persiste; `evidenceEngine` y los Mastery Contracts siguen siendo la única fuente de dominio. Cobertura, trabajo realizado y dominio permanecen separados.

## Problemas verificados y clasificación

| Hallazgo | Clasificación | Evidencia |
|---|---|---|
| No había ayuda visible durante preguntas | C calidad pedagógica + E UX | Existía `currentAssistanceLevelRef`, pero ningún componente llamaba `registerHintUsed`. |
| Ayuda no persistía ni informaba la siguiente decisión | A producto | El snapshot omitía asistencia e historial. |
| `questionId` se reemplazaba por `interactionId` | A producto | Dos rutas de avance construían ambas identidades desde `interaction.id`. |
| Prompt repetido solo se rechazaba en final review | A producto | `requiresUniquePrompt` limitaba el fingerprint. |
| Avance tenía una espera artificial | A producto/UX | `Promise.all` añadía 700 ms aunque el tutor hubiera respondido. |
| Selector intro `getByText('Bohr')` era ambiguo | B arnés | La UI presenta correctamente el nombre en más de una zona. |
| Rapid esperaba un ID fijo y suministraba bank inválido | B arnés + D contrato | El bank tenía dos opciones aunque el contrato exige tres; un fallback rapid válido era aceptable. |

## Sistema de pistas

Se añadió un botón visible `Necesito ayuda` con pista, explicación simple, ejemplo paralelo, recordatorio del material, descarte de opción, división en pasos y `No sé cómo empezar`. La ayuda escala `minimal_hint → guided → assisted → revealed`, nunca retrocede dentro de una interacción, se adapta al formato, registra el tipo usado y persiste tras refresh. El descarte elimina determinísticamente una opción incorrecta; la primera pista oculta la respuesta conocida. El tutor recibe los tipos de ayuda y exige una actividad nueva de demostración independiente. Una correcta asistida continúa sin contar como éxito independiente por los contratos existentes.

## Calidad de preguntas, distractores y repair

La entrega aplica primero `InteractionContract` y después una evaluación pedagógica con `qualityScore`, `reasonCodes` y `rejectedReasons`. Evalúa grounding, grosor del prompt, profundidad cognitiva, trivialidad, similitud con enseñanza, placeholders, plausibilidad léxica, categoría comparable y leakage. Bajo el mínimo se intenta reparación y, si continúa inválida, regeneración de servidor o fallback estructural seguro. Los placeholders prohibidos siguen rechazados. Repair conserva estrategias alternativas y detección de contenido casi duplicado; no se cambió ningún Mastery Contract.

## Repetición, bloqueo y progreso

`questionId` vuelve a proceder de `interaction.questionId`; los fingerprints de prompt se aplican a toda actividad; la ayuda, confianza y respuesta se limpian al aceptar una interacción nueva; el snapshot conserva ayuda y fase; el lock de avance consume `pendingNextPage` una vez y ya no espera 700 ms. La UI mantiene separados concepto actual, trabajados, dominados y material cubierto.

## Revisión centrada en el estudiante

Una segunda revisión del recorrido visible eliminó fricción que no aparecía como error técnico:

- el error ya no se presenta como sentencia punitiva (`✗ Incorrecto`), sino como una dificultad reparable con explicación concreta;
- el CTA anuncia qué ocurrirá después: nuevo reto si acertó y otro intento con estrategia distinta si aún no quedó claro;
- cada objetivo pedagógico relevante muestra una explicación humana breve de por qué el tutor enseña, contrasta, ejemplifica, repara, aplica o transfiere;
- la ayuda explica que la primera orientación no revela la respuesta y se cierra al elegir una opción, reduciendo carga visual;
- la pregunta respondida permanece suficientemente legible para compararla con el feedback;
- se eliminó el botón flotante tenue `Terminar`, que competía con la tarea principal; pausa y regreso siguen disponibles;
- el desplazamiento al feedback usa el siguiente frame de render, sin demora artificial;
- el encabezado prioriza concepto y estado de aprendizaje, dejando trabajados, dominados y cobertura como contexto secundario.

## Benchmark Bohr y otros dominios

- Bohr contractual: 42/42, 9 micros aislados, false mastery 0.
- Smoke multidominio: criterios agregados PASS, false mastery 0, loops 0 e invariantes 0.
- Mass 1000: false mastery 0, invariantes 0, loops 0, restore divergences 0.
- Planner multidominio: 9/9, micros lost 0, false mastery 0.
- La inspección visual real de Bohr, matemática, medicina y derecho queda pendiente porque Chromium no puede iniciarse sin que `next dev` abra localhost en este sandbox.

## Métricas observables

| Métrica | Estado comprobable |
|---|---|
| hintAvailabilityRate | 100% en el componente real para toda interacción renderizada |
| placeholderDistractorRate | 0 permitido por contrato |
| independentRetryAfterHelpRate | exigido por payload/selector; E2E creado, pendiente de entorno |
| repeatedActivityRate | IDs, factKeys y prompts repetidos se rechazan |
| blockedInteractionRate | contrato y E2E creados; inspección Chromium pendiente |
| repairStrategyChangeRate | deterministic 90% global; mass 1000 90% |
| falseMastery | 0 en smoke, deterministic y mass 1000 |
| microsLost | 0 en planner |

## Pruebas añadidas

- `scripts/tests/adaptive-learning-experience-contracts.ts`: progresión, no revelado inicial, descarte seguro, pasos, monotonicidad y rechazo pedagógico de placeholders.
- `tests/e2e/adaptive-learning-experience.spec.ts`: ayuda visible, persistencia tras refresh, telemetría asistida, retry independiente, identidad nueva, doble avance y botones interactivos.
- El selector de intro usa `intro-material-title`; rapid valida compatibilidad en vez de un ID artificial y mantiene un caso separado para `fill_blank_bank` válido.

## Validación ejecutada el 16 de julio de 2026

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run test` | PASS, incluido el contrato nuevo |
| `npm run test:adaptive-v3-bohr` | 42/42 PASS; false mastery 0 |
| `npm run simulate:v3:smoke` | PASS |
| `npm run simulate:v3:deterministic` | 22/22 escenarios; 90% global; alerta segmentada `capable` 7/9 |
| `npm run simulate:v3:mass -- 1000` | PASS; 1000 runs; false mastery 0 |
| `npm run simulate:adaptive-planner` | 9/9 PASS; micros lost 0 |
| `git diff --check` | PASS |
| `npm run test:e2e:adaptive-learning-experience` | BLOQUEADO antes de los casos: `listen EPERM 127.0.0.1:3100` |
| `npm run build` | BLOQUEADO: DNS `ENOTFOUND fonts.googleapis.com` al resolver `next/font` |

## Limitaciones reales y cierre pendiente

No se revisaron screenshots/videos/traces nuevos porque Playwright no alcanzó a iniciar el servidor. No se cambió producto para sortear permisos, ni fuentes/configuración para ocultar la falta de red. Fuera del sandbox se deben ejecutar:

```bash
npm run test:e2e
npm run test:e2e:real-materials
npm run test:e2e:real-sessions
npm run test:e2e:adaptive-planner
npm run test:e2e:adaptive-product-real
npm run test:e2e:adaptive-manual-journey
npm run test:e2e:adaptive-learning-experience
npm run build
git diff --check
```

Solo podrá declararse COMPLETADO si esos comandos terminan con exit code 0, la inspección de artefactos confirma Bohr coherente y sin bloqueos/repeticiones, y las matrices matemática, médica y jurídica confirman pistas específicas y grounding. No hubo commit ni deploy.
