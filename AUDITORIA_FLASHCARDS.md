# Auditoría profunda de Flashcards — modo libre

## Resumen ejecutivo

El flujo Free de producción usa `ALAIStudyALCards` → `/api/flashcards-v2` → Material Brain persistido → planner → generación por lotes → validación → deduplicación pedagógica → cobertura → mazo persistido. No reextrae el documento ni activa Vision directamente.

La causa arquitectónica principal de los problemas no es un único prompt: existen dos representaciones con autoridad parcial. El servidor guarda el mazo generado e inmutable por fingerprint/versiones; la sesión guarda una copia editable junto con favoritos, posición y ronda. Crear, editar o eliminar manualmente cambia sólo la copia de sesión. Regenerar reemplaza el artefacto servidor y reinicia silenciosamente parte del trabajo local después del éxito. Además, errores de `/api/evaluar` se convierten en `medio_correcta` (50), mezclando indisponibilidad del proveedor con evidencia de aprendizaje.

## Flujo real

```text
TemaView / sesión Free
  → SourceSelectionSnapshot(materialIds, selectedPages, fingerprint)
  → ALAIStudyALCards restaura envelope exacto
  → POST /api/flashcards-v2
      → autentica y verifica propiedad (1–5 materiales)
      → reconstruye/valida SourceSelectionSnapshot
      → restore-first de flashcards_deck:<fingerprint>
      → si no existe: lookup-only Material Brain READY
      → resolveMaterialCapabilities(...).flashcardsReady
      → planFlashcards(brain)
      → generateFlashcardBatch (15 objetivos/lote)
      → validación determinista + satisfacción del objetivo fuente
      → deduplicación pedagógica LLM acotada
      → reparación por objetivos faltantes (máx. 8 intentos/objetivo)
      → reconcileFinalCoverage / estado ready|partial|failed
      → persistencia material_results
  → cliente acepta sólo cards validated
  → copia cards + UI/ronda en StudySession.notes.freeTools.flashcards
  → StudyRápido o StudyRepite
      → respuesta libre → /api/evaluar
      → progreso/ronda/mastery event según submodo
      → persistencia debounced + flush al desmontar
```

## A. Autoridad

### Fuente de verdad observada

- Autoridad de generación: `FlashcardDeck` del servidor, clave sintética `flashcards_deck:<sourceSelectionFingerprint>` en `material_results`, invalidada por versiones de planner/generator/validator.
- Autoridad de continuidad del estudiante: envelope `StudySession.notes.freeTools.flashcards`, aislado por sesión y fingerprint; contiene copia de tarjetas y estado de UI/estudio.
- Material Brain: autoridad de contenido académico de entrada, no store de tarjetas.
- Estado React: proyección activa del envelope, con persistencia diferida y flush en desmontaje.

Por tanto no hay autoridad única de “las tarjetas”: el mazo base y la colección que el usuario ve pueden divergir por edición, creación o borrado manual.

### Refresh, navegación y cambio de selección

- Refresh/cerrar/volver: restaura primero el envelope exacto; si falta, existe migración de `StudySession.flashcards/materialText` sólo con fingerprint compatible.
- Cambio de herramienta: desmontaje hace flush del último payload; al volver restaura la sesión.
- Cambio de páginas: cambia el fingerprint y debe seleccionar/crear otra sesión Free; `readFreeToolState` rechaza contaminación cruzada.
- No se encontró un camino canónico que permita restaurar deliberadamente tarjetas de otra selección. El riesgo restante está en callers legacy, datos antiguos mal migrados o una creación de sesión incorrecta aguas arriba, no en `validOwner`.
- Cross-device depende de que el POST debounced de `/api/study-sessions` haya concluido; la UI no expone confirmación de sincronización.

## B. Generación

### Generadores existentes y uso real

1. V2 de Free: `planFlashcards` + `generateFlashcardBatch`/`generateFlashcard` + fallback determinista, llamado por `/api/flashcards-v2` desde `ALAIStudyALCards`.
2. Legacy: `/api/alai-studyal-cards`, todavía llamado por `DocumentoView`.
3. Componentes manuales/presentacionales (`ManualFlashcards`, `TabFlashcards`, dos `FlashCards`) no prueban otro generador Free sin caller.

El journey principal de Free usa V2. La ruta legacy sigue siendo producción alcanzable en la vista de documento, por lo que dos generadores pueden producir tarjetas dentro del producto, aunque no desde el mismo botón.

### Entrada y proveedor

V2 recibe IDs, páginas, idioma y bandera explícita `regenerate`; el servidor restaura el Brain por el fingerprint exacto. El prompt recibe unidades/relaciones y provenance del Brain, no PDF, texto crudo, chunks o imágenes. La ruta no construye el Brain ni reextrae documentos.

Generación por `alaiJson` con política ALAI; proveedor canónico OpenRouter/Gemini 2.5 Flash y Groq sólo para error confirmado de créditos. El fallback determinista no tiene idéntica capacidad lingüística/pedagógica al LLM, pero sí debe satisfacer el mismo tipo TypeScript y los mismos validadores antes de entrar al mazo.

## C. Cantidad y cobertura

- El usuario no elige cantidad. El planner crea objetivos según unidades y relaciones elegibles del Brain: conceptos/hechos, fórmulas, procesos, ejemplos, eventos/datos y ciertas relaciones.
- Fórmulas y procesos pueden producir más de una tarjeta; metadata y unidades contextuales se omiten; ejemplos/artefactos se consolidan.
- No se encontró un límite duro global del tamaño del mazo. Sí hay lote de generación de 15, máximo 8 intentos por objetivo y límites de dedup (500 pares ambiguos).
- La cantidad final puede ser menor que la planificada si objetivos fallan validación/representabilidad. El servidor no declara `ready` si queda un fallo no representable bajo su hard invariant.
- “100%” en UI usa métricas server-authoritative. El modelo calcula unidades, relaciones y clusters semánticos cubiertos; sin embargo el estado `complete` observado se decide por unidades/relaciones target, mientras la UI enfatiza concepto/cluster. Son denominadores relacionados pero no idénticos.
- La cobertura es cobertura de objetivos del planner, no prueba de que todo el documento sea pedagógicamente importante. Si el Brain omitió un concepto, no entra al denominador. Si descompuso excesivamente un tema, puede inflar objetivos y tarjetas.

## D. Calidad

### Garantías implementadas

- Prompt de una tarjeta por objetivo, sin mezclar objetivos ni añadir extras.
- Contratos cognitivos por tipo: recall, comprensión, aplicación, orden/procedimiento.
- Idioma de la fuente, notación matemática y provenance desde el Brain.
- Validaciones de vacío/corrupción, duplicado de objetivo/pregunta, circularidad o answer leakage, hechos sin contexto, metadata, self-containedness, worthiness, matemática/notación y satisfacción contra la evidencia fuente.
- Deduplicación determinista y juez pedagógico para pares ambiguos; reparación posterior de huecos.

### Límites demostrables

- Atomicidad y respuesta única dependen de reglas heurísticas/LLM; no existe prueba formal.
- Provenance se reduce en el cliente a la primera evidencia al mapear la tarjeta.
- Preservar fórmula/símbolo depende de que el Brain ya los contenga correctamente.
- “No inventar” está protegido por satisfacción de objetivo/evidencia, pero no elimina alucinación semántica en todos los dominios.
- No hay adaptación explícita del planner por asignatura más allá del tipo de unidad/relación del Brain.
- El mazo mezcla reconocimiento/recuerdo/aplicación según objetivos, pero la interacción de respuesta libre no valida necesariamente el mismo criterio con comportamiento estable ante fallos.

## E. Interacción

- `StudyRepite`: tras mostrar respuesta, evalúa texto libre. En loop, mastery local requiere dos aciertos consecutivos; errores reinsertan la tarjeta a una distancia de índice (1–8). Es espaciado dentro de una ronda, no repetición espaciada temporal durable.
- `StudyRapido`: recorre una vez las tarjetas. No se observó el mismo envío de evento de mastery que en el modo de repetición.
- “No sé” registra 0; revelar y continuar cuenta como incorrecta.
- Correcta/incorrecta/fácil/difícil no son cuatro autoridades estables: la evaluación retorna clasificación/score y la UI deriva avance y dificultad.
- Si `/api/evaluar` falla, el cliente fabrica `medio_correcta`, score 50. Esto puede avanzar/reprogramar una tarjeta sin evidencia académica.
- Finalizar significa agotar el orden lineal o dominar el conjunto dentro de la ronda; no significa retención a largo plazo.
- Crear/editar/borrar manualmente puede cambiar la copia local sin actualizar el deck servidor. Una regeneración exitosa reemplaza tarjetas y reinicia favoritos, índice, flip y ronda; no versiona ni archiva el trabajo anterior.
- Si todos los objetivos quedan no representables, la ruta falla cerrada; evita falso 100%, pero el usuario puede quedar sin mazo hasta corregir Brain/generación.

## F. Costo y rendimiento

- Primera generación: aproximadamente `ceil(objetivos/15)` llamadas de generación, con concurrencia 3.
- Reparaciones pueden multiplicar llamadas por los objetivos que fallan, con presupuesto máximo de 8 intentos por target.
- Dedup pedagógico añade llamadas para pares ambiguos, acotadas por 500 pares y el tamaño de lote del juez; luego hay dedup de deltas de reparación.
- Restore exacto evita generación si existe deck `ready` o `partial` utilizable y no se pidió regenerar.
- El request no manda el documento completo ni contenido repetido; manda identidad/configuración. El generador recibe contextos Brain por objetivos/lotes.
- Flashcards no activa Vision. Puede beneficiarse o sufrir Vision sólo porque el Brain fue construido previamente.
- Cambiar versiones invalida caché aunque el fingerprint sea igual; `regenerate` omite restore de forma explícita.

## G. Tests

### Suites localizadas

`flashcards-v2-contracts`, `explicit-regenerate`, `final/gap/completion/coverage closure`, `coverage denominator/reconciliation/hard invariant/quality`, `pedagogical-dedup`, `single-dedup-authority`, `repair scope/no-progress/monotonicity/escalation`, `adaptive-retry-budget`, `strategy-ladder`, `retrieval-unit`, `metadata-context`, `notation-context`, `self-contained-worthiness`, `source-objective-satisfaction`, `qualifier-display-safety`, `artifact-cluster-identity`, `semantic-architecture`, `correctness-fase3`, `real-acceptance`, `realrun-quality`, `real-ai`, `material-brain-lifecycle`, `free-tool-continuity`, `free-flashcards-repasar-continuity`, `free-mode-source-authority` y E2E de continuidad/estabilidad/identidad/cuota localStorage.

Estas suites cubren fuertemente contratos internos, cierre de cobertura, dedup, retry y varios restores simulados. No se ejecutaron en esta auditoría y no deben declararse PASS.

### Huecos que requieren evidencia explícita

| Caso | Evidencia encontrada | Falta obligatoria |
|---|---|---|
| PDF nativo / escaneado | contratos de Brain separados | aceptación Flashcards end-to-end por ambos tipos |
| páginas parciales | autoridad/fingerprint y algunos E2E | demostrar cero leakage en preguntas y provenance |
| varias fuentes | límite 1–5 y scope | mezcla real, provenance y dedup cross-documento |
| fórmulas/tablas | validadores de notación/contexto | corpus real con equivalencia visual/textual |
| duplicados | suite extensa | umbral de aceptación semántica con revisión humana |
| refresh/navegación | continuidad/E2E | cross-device real y sync interrumpida |
| cambio de selección | guards de fingerprint | race durante generación + cambio inmediato |
| error/fallback | caminos implementados | equivalencia contractual y calidad de ambos proveedores |
| regeneración | contrato explícito | conservación/versionado de trabajo y confirmación UX |
| cantidad/cobertura | contratos internos | verdad contra rúbrica humana del material completo |
| calidad pedagógica | real acceptance/quality | set estable aprobado por Product Owner por asignatura |

## H. Diagnóstico P0–P3

| Prioridad | Área | Hallazgo | Evidencia |
|---|---|---|---|
| P0 | Interacción/mastery | Error de red/proveedor al evaluar se convierte en `medio_correcta`/50: indisponibilidad puede parecer aprendizaje | `ALAIStudyALCards.tsx`, evaluadores de `StudyRepite`/`StudyRapido`, alrededor de 1478 y 1867 |
| P1 | Persistencia | Deck servidor y colección editable de sesión pueden divergir; no hay merge/versionado canónico | `deckStore.ts` store por fingerprint; `ALAIStudyALCards.tsx` estado `cards` y acciones manuales |
| P1 | Regeneración/UX | Regeneración exitosa sustituye el mazo y reinicia favoritos/posición/ronda sin snapshot recuperable | `ALAIStudyALCards.tsx`, request 2722 y mapping/reset posterior |
| P1 | Cobertura | “100%” sólo cubre targets conocidos por el planner/Brain; no prueba cobertura del material y mezcla denominadores de clusters vs unidades/relaciones | `planner.ts::planFlashcards`; `validate.ts::computeDeckCoverage`; UI 2411 |
| P1 | Arquitectura | Generador legacy sigue alcanzable por `DocumentoView`, dificultando autoridad y soporte de calidad | `DocumentoView.tsx` 113–172; `/api/alai-studyal-cards`; `/api/flashcards-v2` |
| P2 | Persistencia | Cross-device depende de sync asíncrona debounced sin confirmación visible | `studySessions.ts::postSessionSnapshot`; persistencia 250 ms del componente |
| P2 | Interacción | Espaciado es por posición dentro de ronda, no scheduler temporal; “terminar” no prueba retención | `ALAIStudyALCards.tsx::StudyRepite` |
| P2 | Mastery | Los submodos no emiten evidencia equivalente y el fallback de concepto puede ser el texto de la pregunta | mapping de cards y callbacks de `StudyRepite`/`StudyRapido` |
| P2 | Costo | Hasta 8 intentos por target más dedup LLM; falta presupuesto global visible por deck | `deckStore.ts`, constantes 168 y 183; `pedagogicalDedup.ts`, 51–71 |
| P3 | UX/legacy | Migraciones y múltiples componentes homónimos elevan complejidad diagnóstica | componentes/routes listados arriba |

No se atribuye un fallo pedagógico al Material Brain sin material real. Si OCR, fórmulas, tablas o visuales faltan en el Brain, el problema es ingestión anterior a Flashcards.

## I. Propuesta incremental

### 1. Contrato de entrada

`FlashcardGenerationRequest { sessionId, SourceSelectionSnapshot exacto, brainFingerprint, language, regenerateIntent }`. El servidor debe rechazar diferencias entre fingerprint, IDs y páginas. Sin texto/imágenes del cliente.

### 2. Contrato de salida

`FlashcardDeckArtifact { deckId, revision, sourceFingerprint, brainRevision, generatorVersions, cards[], coverage, status }`; cada tarjeta con ID estable, objetivo, pregunta, respuesta, evidencias completas, idioma, tipo cognitivo y validación.

### 3. Autoridad única

El artifact versionado del servidor es autoridad del contenido generado. El estado de sesión referencia `deckId/revision` y guarda sólo progreso, orden, favoritos y overlays manuales explícitos. Las ediciones no deben mutar implícitamente la identidad del artifact.

### 4. Pipeline

Restore exacto → Brain readiness → plan determinista → generación por lotes → validación grounded → dedup → reparación acotada → cobertura reconciliada → persistencia atómica → entrega.

### 5. Validación

Conservar validadores actuales. Añadir invariantes de schema idénticos para proveedor/fallback, fail-closed de evaluación y tests por materia real.

### 6. Cobertura

Mostrar por separado: cobertura del planner, cobertura de conceptos Brain y límites de representatividad. No llamar “material 100% cubierto” sin denominador verificable.

### 7–8. Persistencia y restauración

Guardar artifact versionado y progreso por `sessionId + fingerprint + deckRevision`. Restore-first de ambos; si divergen, presentar política explícita, nunca reset silencioso. Confirmar sync servidor antes de afirmar continuidad cross-device.

### 9. Regeneración segura

Crear nueva revisión, conservar anterior y progreso, mostrar diff/resumen y pedir confirmación para cambiar el deck activo. Fallo deja intacto el deck anterior.

### 10. Pruebas de aceptación

Corpus aprobado por PO: PDF nativo, escaneado, selección parcial, 1–5 fuentes, fórmulas, tabla/diagrama, idiomas y asignaturas. Medir leakage, fidelidad, atomicidad, duplicados, coverage contra rúbrica, costo, refresh/cross-device, race de selección, proveedor/fallback y regeneración reversible.

### Conservar / corregir / consolidar / retirar

- Conservar: snapshot/fingerprint, lookup-only Brain, restore-first, planner tipado, lotes, validadores, dedup y hard invariant de cobertura.
- Corregir primero: fallo de evaluación no debe producir score; después hacer explícita la relación artifact/progreso y proteger regeneración.
- Consolidar: identidad del deck, revisiones y política de restore entre store servidor y envelope.
- Retirar eventualmente: ruta legacy y componentes duplicados sólo tras confirmar callers, migrar journeys y medir equivalencia.
- No tocar todavía: ingestión/Material Brain, planner o heurísticas de calidad sin corpus real y pruebas de equivalencia.

## Primer arreglo mínimo recomendado

El cambio más pequeño, reversible y de menor riesgo es impedir que un error de `/api/evaluar` se convierta en `medio_correcta`: conservar la tarjeta pendiente, mostrar error recuperable y permitir reintento, sin alterar deck, planner, Brain ni progreso. En una segunda entrega independiente, bloquear regeneración cuando exista progreso salvo confirmación y snapshot de la revisión anterior.

## Evidencias por archivo y símbolo

| Archivo | Símbolo / líneas | Evidencia |
|---|---|---|
| `app/api/flashcards-v2/route.ts` | `POST`, 35–145 | auth, selección, restore-first, lookup-only Brain, capability y hard invariant |
| `lib/materialBrain/flashcards/deckStore.ts` | lookup/store; 121–183; `getOrBuildFlashcardDeck` 239+ | clave/versiones, lote 15, 8 intentos y orchestration |
| `lib/materialBrain/flashcards/planner.ts` | `planFlashcards` | objetivos por unidad/relación y cantidad emergente |
| `lib/materialBrain/flashcards/generator.ts` | `generateFlashcardBatch`, fallback | prompt, proveedor, idioma, provenance y generación determinista |
| `lib/materialBrain/flashcards/validate.ts` | `validateDeck`, `computeDeckCoverage`, `reconcileFinalCoverage` | gates de calidad y denominadores |
| `lib/materialBrain/flashcards/pedagogicalDedup.ts` | límites 51–71; judge/dedup | pares ambiguos y costo acotado |
| `lib/materialBrain/flashcards/types.ts` | `GeneratedFlashcard`, `DeckCoverage`, `FlashcardDeck` | contratos de artifact |
| `components/materias/ALAIStudyALCards.tsx` | componente 2214+; request 2722+; `StudyRepite`, `StudyRapido` | restore, copia local, interacción, evaluación y regeneración |
| `lib/freeToolState.ts` | `readFreeToolState`, `writeFreeToolState` | aislamiento de sesión/fingerprint |
| `components/materias/DocumentoView.tsx` | 113–172 | caller real legacy |

## Incertidumbres para verificación

- Qué problema concreto observa el Product Owner: calidad, pérdida de progreso, cantidad, latencia, duplicados o fuente incorrecta.
- Si las tarjetas manuales deben sobrevivir regeneración y sincronizar cross-device como parte del mazo o como overlay personal.
- Definición de producto de “100% cobertura” y rúbrica humana aceptable por asignatura.
- Si Study Rápido debe afectar mastery y qué evidencia debe producir.
- Si `DocumentoView`/ruta legacy sigue siendo una experiencia soportada.
- Presupuesto máximo aceptable de latencia/calls/costo y conducta deseada ante mazo parcial.
- No se ejecutaron tests ni generación real en esta fase; el comportamiento dinámico de producción requiere aceptación controlada.
