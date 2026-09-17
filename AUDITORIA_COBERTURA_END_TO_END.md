# Auditoría de cobertura end-to-end de StudyAL

## Alcance y criterio

Auditoría estática read-only. Se consultó primero el grafo existente y después se verificaron símbolos concretos con RTK. No se ejecutaron IA, regeneraciones ni materiales privados. “Confiable” significa que numerador, denominador e IDs son deterministas respecto del artefacto que reciben; no significa que ese artefacto represente el 100% de la fuente.

La conclusión central es que StudyAL ya tiene buena trazabilidad desde un Material Brain existente hacia varias herramientas, pero no tiene todavía una cadena de certificación que pruebe que el Brain comenzó desde todas las páginas seleccionadas. El primer denominador de `sourceCoverage` se forma demasiado tarde: desde `textChunks`, no desde `SourceSelectionSnapshot.selectedPages`.

## 1. Funnel actual

| Etapa | Autoridad/IDs actuales | Cantidades disponibles | Pérdida o incertidumbre |
|---|---|---|---|
| 1. Materiales seleccionados | `SourceSelectionSnapshot.materialIds/materials` | 1–5 IDs y fingerprint | Confiable si el snapshot fue construido correctamente |
| 2. Páginas seleccionadas | `scope.selectedPages` y `scope.materials[].selectedPages` | IDs `(materialId,page)` | Es el denominador correcto, pero `computeSourceCoverage` no lo usa directamente |
| 3. Extracción nativa | `material_texts.raw_text`, `Material.extracted_chars/pages_count` | chars y conteo global de páginas | No persiste status/derivación por página; marcadores ausentes o páginas vacías desaparecen de `splitIntoPages` |
| 4. OCR | `SourceEvidence.derivation='ocr'` cuando llega a unidades | Sólo páginas que produjeron evidencia | No existe inventario persistido de páginas enviadas a OCR, fallidas o sin contenido |
| 5. Visual justificado | `PageContentSignals.mode/reasons`; `VisualCoverage`; cache `visual_page_analysis` | requested/analyzed/failed/noContent | Las decisiones `PageContentSignals` no forman un certificado durable completo; errores de preparación pueden no enumerar todas las páginas afectadas |
| 6. Vacías/fallidas/no representadas | `sourceCoverage.missing/suspiciouslyEmpty`, `visualCoverage.failed/noContent`, warnings | Parcial | Una página sin `textChunk` nunca entra en `sourceCoverage.requested`; `suspiciouslyEmpty` sólo examina páginas ya procesadas |
| 7. Chunks/segmentos | `PageChunk.id`, páginas; checkpoints outer/subchunk | chunkCount, IDs, status, pérdidas de extracción | Trazable para texto que llegó a chunking; no prueba que todas las páginas seleccionadas llegaron |
| 8. Unidades Brain | `KnowledgeUnit.id`, `provenance/evidence`, `supersededBy` | raw/accepted/rejected, unidades finales | Un leaf puede ser `complete_no_content` o fallback; `ready` se basa en resolución del chunk, no exhaustividad semántica demostrada |
| 9. Relaciones Brain | `KnowledgeRelation.id` | raw/accepted/rejected, finales y ambiguas descartadas | Las relaciones omitidas por el extractor son incognoscibles; las descartadas conocidas sí tienen contadores/warnings |
| 10. Conceptos únicos | `identity.semanticKey/canonicalSubject/qualifiers`; unidades vivas | No hay campo canónico global de “conceptos candidatos” | Cada planner agrupa/deduplica de manera distinta; no existe denominador Brain de conceptos únicos certificado |
| 11. Unidades excluidas | `supersededBy`; logs/telemetría; planners `skipped` | Parcial | Flashcards calcula razones pero no las persiste en `FlashcardDeck`; Quiz/Exam/Truquitos no registran todas las exclusiones como lista de IDs+razón |
| 12. Objetivos por planner | targets/slots/plans específicos | Repasar/Análisis/Map completos; otros elegibles | No hay tipo compartido que permita comparar objetivos entre herramientas |
| 13. Representables | validadores/candidate pools | Flashcards y Quiz tienen señales; Exam comprime targets | “No representable” no es una categoría durable común y a veces queda fuera del denominador |
| 14. Generados | cards/questions/narrativa persistida | IDs por artefacto | Análisis/Truquitos dependen del proveedor; ALAI es por turno, no corpus completo |
| 15. Validados | `validated`, grounding IDs, artifact validators | Fuerte en Flashcards/Quiz | No existe certificación común que encadene validez de herramienta con Source/Brain complete |
| 16. No cubiertos | missing IDs en varias herramientas | Repasar, Análisis, Truquitos, Flashcards y Quiz parcialmente | Falta razón uniforme, página y vínculo con huecos anteriores al planner |

### Punto exacto donde nace el falso denominador fuente

`buildMaterialBrain` hace:

1. `chunkMaterials(materials)` sobre el texto autorizado.
2. `computeSourceCoverage(textChunks, failedRequiredChunkIds, units)`.
3. `computeSourceCoverage` deriva `requested = uniqueRefs(allChunks)`.

Por tanto, el conjunto “requested” significa “páginas que aparecieron en algún chunk de texto”, no “páginas seleccionadas”. `splitIntoPages` elimina segmentos vacíos y un texto sin marcadores cae en una única página fallback. Un PDF de 43 páginas con 40 páginas marcadas y tres páginas vacías/ilegibles puede declarar `40/40 complete`, aunque el snapshot autorice 43.

### OCR y Vision

La clasificación visual sí usa las páginas seleccionadas y señales por página para PDFs con `storageKey`. Vision se solicita sólo para decisiones `vision|text_and_vision`; registra analyzed/failed/noContent. Sin embargo:

- esto no sustituye un inventario de extracción por página;
- OCR no tiene una bitácora equivalente persistida;
- una falla al descargar/cargar/analizar señales agrega `preparationErrors`, pero no necesariamente un `SourceRef` fallido por cada página;
- la preparación visual es opcional para readiness: `optionalGaps.visual` no impide por sí mismo `sourceReadiness='ready'`.

### Chunks, fallback y contenido académico

El chunking no tiene cap global: usa chunks de ~3500 chars y leaves de ~1200 chars, preservando página. La extracción rich exige quote+page y descarta unidades sin provenance. Tras retries, el fallback determinista convierte oraciones académicas exactas en facts; tiene safety ceiling 200 por leaf y reporta la pérdida si se alcanza. Aun así:

- una unidad rich válida no prueba que el modelo extrajo todas las ideas del leaf;
- `complete_no_content` depende de clasificación determinista de contenido no académico;
- fallback no crea relaciones y puede degradar estructura aunque la página cuente como procesada;
- `sourceCoverage.status` sólo comprueba resolución de chunks de texto, no `knowledgeExtraction`, `contentLoss`, riqueza, OCR ni visualCoverage.

## 2. Denominadores actuales

| Capa/herramienta | Numerador | Denominador | Excluido antes | ¿Falso 100%? | Símbolo |
|---|---|---|---|---|---|
| Material Brain source | páginas de `textChunks` cuyos chunks no fallaron | páginas únicas presentes en `textChunks` | páginas seleccionadas sin chunk/texto; OCR desconocido; visual opcional | **Sí, crítico** | `coverage.ts::computeSourceCoverage` |
| Material Brain quality | leaves rich/fallback/noContent | `textSubchunks.length` | páginas sin subchunk; visión | Sí si se interpreta como cobertura fuente | `build.ts::extractionQuality` |
| Material Brain required progress | outer text chunks completados | `textChunks.length` | páginas no chunked; visual en opcional | Sí | `build.ts::requiredProgress` |
| Repasar coverage | targets que el estudiante cubrió | todas las unidades vivas del Brain | `supersededBy`; todo lo omitido por Brain | Relativamente confiable; falso respecto de fuente si Brain incompleto | `reviewContext.ts::computeRepasarCoverage/computeRepasarDomainMap` |
| Análisis | target IDs citados por narrativa válida | una target por unidad viva | `supersededBy`; targets recortados del prompt pueden quedar missing | Denominador Brain confiable; puede ser 100 sobre Brain incompleto | `analysisContext.ts::computeAnalysisCoverage` |
| Study Map nodos | todos los nodos construidos | una node por unidad viva | `supersededBy` | Siempre tiende a 100 por construcción; no certifica fuente/Brain | `studyMapContext.ts::buildStudyMapGroundedContext` |
| Study Map relaciones | `edges.length` | `brain.relations.length` | self, dangling, duplicadas | No calcula porcentaje ni missing IDs; conteos no son conjuntos exactamente equivalentes | `computeStudyMapCoverage` |
| Truquitos | IDs presentes en cards | targets con oportunidad mnemónica elegible | unidades sin estrategia; relaciones no soportadas; luego sólo first 24 | Coverage honesta sobre elegibles, normalmente parcial; no sobre Brain completo | `truquitosContext.ts::computeTruquitosCoverage` |
| Flashcards status | unidades/relaciones targeteadas presentes en cards válidas | `plan.targetedUnitIds/targetedRelationIds` | contextual, metadata, superseded, consolidaciones, `example_of`, dedup semántico | **Sí**: excluidos desaparecen del denominador de complete | `flashcards/validate.ts::computeDeckCoverage` |
| Flashcards concepto mostrado | concept clusters cubiertos | concept clusters de `plannedCards` sobrevivientes | todo lo saltado/merged antes del plan final | **Sí** | `reconcileFinalCoverage`, `pipelineTrace.ts` |
| Quiz coverage estimada | targets cubiertos por primeras `questionCount` candidates | `allTargets` derivado del candidate pool | sin evidence, fuera de páginas, semantic dedupe, no compatible con tipos, no assessable | **Sí** respecto de Brain; honesta sólo sobre assessable pool | `quiz/planner.ts::analyzeQuizCoverage` |
| Quiz max single | targets cubiertos por primeras 100 candidates | mismo `allTargets` assessable | mismas exclusiones; cap 100 | Honesto respecto del pool, no del Brain | `analyzeQuizCoverage` |
| Examen ALAI | target IDs representados en slots | unidades vivas elegibles | procesos y statements <10 chars; superseded | **Sí** si UI dice material completo; full sobre ExamTargets es correcto | `examContext.ts::buildExamTargets/composeExamBlueprint` |
| ALAI | no existe porcentaje global | por turno: hasta 8 units, 12 relations, 6 source blocks por defecto | resto del Brain/corpus no relevante al query | No debe declarar 100%; es retrieval, no cobertura | `chatRetrieval.ts::retrieveForChat` |

### Porcentajes adicionales que pueden confundirse

- `StudyALProcess` suma herramientas usadas; su 100% significa uso del ecosistema Free, no contenido cubierto.
- Repasar muestra “Para dominar el 100%” sobre todas las unidades vivas pendientes: consistente respecto del Brain, no certificado respecto de páginas.
- UI de Study Map conserva textos “100% del material/contenido” aunque su grounding sólo demuestra `nodes/nodes` del Brain.
- Rutas legacy todavía contienen prompts que dicen “muestra” y “100%”; deben distinguirse del grounded handler y no usarse como evidencia de cobertura.

## 3. Puntos de pérdida silenciosa

### Antes del Brain

1. `splitIntoPages` filtra páginas/segmentos vacíos; no conserva placeholders por página seleccionada.
2. `material_texts` persiste sólo `raw_text`; `Material.pages_count` es global. No hay `pageStatus` durable con native/OCR/empty/failed.
3. Si el texto carece de marcadores, `chunkMaterial` puede representarlo como una sola página fallback aunque el material tenga varias.
4. OCR carece de inventario auditable de intentos/resultados por página en los artefactos revisados.
5. `resolveSourceMaterials` permite PDF sin texto si puede resolverse visualmente, pero source coverage posterior sigue basado en textChunks.
6. Falla de preparación visual puede marcar visualCoverage unavailable sin impedir readiness textual.

### Dentro del Brain

1. Un output rich estructuralmente válido puede ser una muestra semántica del leaf; no existe source-concept candidate list independiente para probar exhaustividad.
2. Unidades sin quote+page verificable se descartan; hay conteos/razones, pero no siempre identidad recuperable del concepto descartado.
3. Relaciones ambiguas/estructuralmente inválidas se eliminan; sólo las pérdidas observadas pueden auditarse.
4. Merge/supersession puede fusionar unidades. `mergeLog` ayuda, pero no existe certificado que pruebe equivalencia de cada concepto candidato.
5. Fallback exacto preserva oraciones, pero pierde relaciones y tipado profundo; `ready` puede coexistir con `brainEnrichment='degraded'`.
6. `contentLoss.hasLoss` y `knowledgeExtraction` no bloquean necesariamente `sourceReadiness='ready'`.

### Contextos y planners

- Repasar: `renderRepasarGroundedContext` recorta a 60k; la evaluación de cobertura compensa con batches sobre el universo completo.
- Análisis: contexto recortado a 90k. Los IDs ausentes quedan missing, pero una sola generación puede no representar todo.
- Study Map: no usa proveedor para crear nodos; visibilidad inicial filtra a critical cuando >20, aunque todos siguen disponibles.
- Truquitos: sólo las oportunidades elegibles; generación usa first 24 y después rank/dedup limita cards a ~70% de elegibles.
- Flashcards: filtra metadata/contextual, consolida ejemplos/artefactos, omite `example_of`, fusiona por Jaccard >=0.62 y registra `skipped`; estos IDs no llegan al denominador final.
- Quiz: filtra por evidence, páginas autorizadas, semantic dedupe, compatibilidad de tipo y capacidad; `questionCount` y cap 100 limitan cobertura de una ronda.
- Examen: excluye todos los `process` y statements cortos; dentro del pool elegible comprime sin perder targets.
- ALAI: top‑K deliberado (8/12/6) y hasta 10 mensajes ×1200 chars de historia; adecuado por pregunta, inválido como afirmación de cobertura total.

### Persistencia que impide auditoría retrospectiva completa

- El Brain persistido sí contiene scope, units, relations, source/visual coverage, checkpoints, warnings, mergeLog y parte de telemetría.
- El deck persistido contiene cards y coverage, pero no el `FlashcardPlan.skipped`, merge diagnostics ni failures detallados; esos datos sólo se escriben a `.flashcards-traces` en desarrollo.
- Quiz artifact conserva plan/grounding de su generación, pero el análisis de exclusiones previas no es un certificado común de IDs+razón.
- Visual page results son recuperables por cache identity, pero no hay índice directo por fingerprint de selección que enumere todas las decisiones de página.
- El Brain se actualiza en la misma fila por fingerprint. Un deck congela `enrichmentRevision`, pero no existe necesariamente una revisión histórica del Brain que permita reconstruir exactamente su universo si el Brain actual avanzó.

## 4. Riesgos de falso 100%

### P0

`sourceCoverage.complete` puede ser verdadero con páginas seleccionadas ausentes porque su denominador nace de chunks. Todos los 100% posteriores heredan esa ceguera.

### P1

- Flashcards `complete` significa todos los targets sobrevivientes del planner, no todos los objetivos académicos aplicables del Brain.
- Study Map siempre representa todos los nodos que él mismo construye y la UI afirma 100% del contenido sin encadenar Source/Brain completeness.
- Examen cubre todos sus ExamTargets pero excluye procesos antes de medir.
- Quiz puede cubrir 100% de su candidate pool aunque unidades sin evidence/tipo compatible hayan quedado fuera.

### P2

- Repasar y Análisis usan denominadores completos respecto de unidades vivas, pero aún dependen de un Brain no certificado.
- Truquitos es honesto al reportar parcial sobre elegibles, pero “elegible” no equivale a material completo.
- ALAI no debe presentar métricas globales a partir de top‑K.

## 5. Contrato de tres certificados

### A. SourceCoverageCertificate

```ts
interface SourceCoverageCertificate {
  schemaVersion: string
  sourceSelectionFingerprint: string
  materialIds: string[]
  totalSelectedPages: number
  processedPages: number
  nativeTextPages: number
  ocrPages: number
  visualPages: number
  emptyPages: number
  failedPages: number
  pageStatus: Array<{
    materialId: string
    page: number
    extraction: 'native_text' | 'ocr' | 'none'
    visual: 'not_required' | 'analyzed' | 'no_content' | 'failed' | 'unavailable'
    status: 'processed' | 'empty' | 'failed'
    reasons: string[]
    textChars?: number
    chunkIds: string[]
  }>
  complete: boolean
}
```

Reglas: el denominador se crea directamente del snapshot; cada página aparece exactamente una vez; `processedPages + emptyPages + failedPages = totalSelectedPages`; empty sólo es complete si se demostró determinísticamente que no contiene contenido académico/visual, no por ausencia de texto.

### B. BrainCoverageCertificate

```ts
interface BrainCoverageCertificate {
  schemaVersion: string
  sourceSelectionFingerprint: string
  brainRevision: string
  sourceCandidateConceptIds: string[]
  representedUnitIds: string[]
  representedRelationIds: string[]
  excludedConcepts: Array<{ candidateId: string; pageRefs: SourceRef[]; reason: string }>
  pagesWithProvenance: SourceRef[]
  pagesWithoutProvenance: SourceRef[]
  knownGaps: Array<{ id: string; pageRefs: SourceRef[]; stage: string; reason: string }>
  complete: boolean
}
```

No debe equiparar conceptos con oraciones. Los candidates pueden ser segmentos/proposiciones académicas deterministas con IDs estables; merge/exclusion debe conservar lineage. `complete` requiere Source certificate completo, cero pérdida estructural/provenance no resuelta y toda candidate representada o excluida con una razón aceptada.

### C. ToolCoverageCertificate

```ts
interface ToolCoverageCertificate {
  schemaVersion: string
  tool: 'repasar' | 'analysis' | 'studymap' | 'truquitos' | 'flashcards' | 'quiz' | 'exam' | 'alai'
  sourceSelectionFingerprint: string
  brainRevision: string
  eligibleObjectiveIds: string[]
  representedObjectiveIds: string[]
  missingObjectiveIds: string[]
  nonRepresentableObjectives: Array<{ objectiveId: string; pageRefs: SourceRef[]; reason: string }>
  coveragePercent: number
  status: 'ready' | 'partial' | 'failed'
}
```

Reglas comunes:

1. `eligible = represented ∪ missing ∪ nonRepresentable`, sin desapariciones.
2. Non-representable permanece en el denominador; una herramienta puede mostrar por separado cobertura representable y cobertura total, pero no llamarlas igual.
3. `coveragePercent = represented / eligible`.
4. Status nunca puede ser `ready` al 100% si Source o Brain certificate no están complete.
5. Para ALAI, el certificado debe ser de grounding por respuesta, no de cobertura corpus; tool coverage global queda `partial/not_applicable` salvo un proceso explícito de recorrido acumulado.
6. Rondas/módulos conservan un union acumulado de represented IDs sobre el mismo brainRevision.

## 6. Diseño del trazador read-only

### Interfaz mínima

Un script interno o endpoint administrativo read-only:

```text
coverage-trace --session <sessionId>
coverage-trace --fingerprint <sourceSelectionFingerprint>
```

Salida JSON y Markdown breve, sin IA:

```text
Páginas: 40/43 verificadas; 2 vacías no certificadas; 1 fallida
Brain: 127 unidades, 12 relaciones, 4 huecos conocidos
Flashcards: 78/96 objetivos representados; 18 faltantes
Quiz: 61/96 objetivos representados en esta generación
Faltantes: objectiveId, materialId, page, etapa, razón
```

### Resolución por sessionId

1. GET/read de StudySession.
2. Validar `processMode`, materialIds, selectedPages y fingerprint.
3. Resolver el mismo flujo que `sourceSelectionFingerprint`; no reconstruir páginas por heurística.
4. Continuar como lookup por fingerprint.

### Resolución por fingerprint

1. `WorkerMaterialResultStore.get(fingerprint)` para Brain.
2. Materiales/material_texts sólo para metadatos y marcadores persistidos; nunca ejecutar `ensureMaterialTextExtraction`.
3. `WorkerFlashcardDeckStore.get(fingerprint)`.
4. Quiz artifacts requieren session/config/generation identity: enumerarlos desde el envelope de sesión o añadir lookup/index read-only; no adivinar config.
5. Exam artifacts requieren sessionId+fingerprint+examId.
6. Envelopes `freeTools` aportan generation IDs y estado consumido.

### Cálculo sin efectos

- Source provisional: comparar snapshot seleccionado contra Brain `sourceCoverage`, visualCoverage y checkpoints. Marcar `unknown`, no “empty”, cuando falta evidencia persistida.
- Brain: contar unidades vivas, superseded, relaciones, provenance por página, telemetry, warnings, contentLoss y mergeLog.
- Flashcards: usar deck persistido para represented/missing dentro del plan persistido. Para reconstruir exclusiones sólo puede ejecutarse `planFlashcards(brain)` de forma pura si `brainRevision` coincide; si no, reportar `historical_brain_revision_unavailable`.
- Quiz: leer artifact y grounding; recalcular cobertura pura con su configuración únicamente cuando Brain/config versions coincidan.
- Repasar/Análisis/Map/Truquitos/Exam: construir targets con funciones puras y comparar con IDs persistidos. No invocar rutas POST.
- ALAI: reportar cobertura por mensaje usando `usedUnitIds/usedSourceBlockIds`; no sumar como “material completo” sin identidad acumulativa.

### Restricciones del trazador

- Cero llamadas a `buildMaterialBrain`, extractors, OCR, Vision, generators o providers.
- Cero escrituras a sessions, caches o material_results.
- Si un artefacto falta, mostrar `artifact_missing`; no generarlo.
- Si una revisión/version no coincide, mostrar `incomparable_revision`; no mezclar denominadores.
- Toda cifra debe incluir la lista de IDs que la produce o un hash+archivo exportable cuando sea grande.

### Datos que hoy no puede reconstruir con certeza

1. Derivación native/OCR y fallo por cada página seleccionada.
2. Páginas vacías probadas frente a páginas simplemente ausentes.
3. Lista completa de candidatos académicos antes de extracción Brain.
4. Identidad/razón de toda unidad rechazada cuando el proveedor nunca emitió un objeto recuperable.
5. `FlashcardPlan.skipped` del deck histórico en producción.
6. Revisión histórica exacta del Brain congelada por artifacts antiguos.
7. Enumeración de todos los quiz/exam artifacts desde fingerprint sin session/config IDs.

## 7. Cambio mínimo recomendado

Sin modificar planners ni aumentar cantidades, el primer cambio debe ser corregir la verdad de `SourceCoverage`:

1. Pasar el conjunto completo de `(materialId,page)` del `SourceSelectionSnapshot` a `computeSourceCoverage` como `requested` autoritativo.
2. Clasificar toda página seleccionada en processed, empty, failed o unknown.
3. Impedir `complete` si existe `unknown/failed`, si visual requerido falló o si una página sin texto no fue explicada por OCR/noContent.
4. Conservar el `sourceCoverage` actual como dato migrable, pero no usar su `complete` legacy para habilitar afirmaciones 100%.
5. Suprimir/condicionar únicamente los claims de UI “100%” hasta que Source y Brain certificates sean completos; no cambiar generación.

Este cambio revela pérdida aguas arriba sin alterar Material Brain semántico, planners, prompts, número de tarjetas o pedagogía.

Segundo paso independiente: persistir en `FlashcardDeck` y artifacts equivalentes el `ToolCoverageCertificate`, incluyendo `skipped/nonRepresentable` con razón. No debe mezclarse con el primer cambio.

## 8. Pruebas necesarias

### Source

- PDF nativo 43/43 con marcadores completos.
- PDF con una página seleccionada vacía, una ilegible y una sin marcador.
- PDF escaneado: OCR success/failure/noContent por página.
- Página con texto y visual requerido; Vision success/failure/unavailable.
- DOCX/PPTX/imagen y selección parcial.
- 1–5 materiales con números de página repetidos entre documentos.
- Invariante exacto: cada selected ref aparece una vez en pageStatus.

### Brain

- Rich completo, fallback, complete_no_content, rejected provenance, structural loss y terminal degraded.
- Merge legítimo conserva lineage; conceptos distintos no se fusionan.
- `ready` no implica certificate complete cuando hay contentLoss/visual requerido fallido.
- Cada unidad/relación tiene provenance dentro del snapshot.

### Tools

- Repasar/Análisis/Map: denominador igual a todas las unidades vivas.
- Truquitos: inelegibles visibles con razón y batch 24 no altera denominador.
- Flashcards: contextual/metadata/consolidated/dedup/nonrepresentable permanecen auditables.
- Quiz: evidence/type/dedup/cap 100 visibles como exclusiones o missing.
- Exam: procesos excluidos permanecen en nonRepresentable.
- ALAI: top‑K nunca produce claim de cobertura global.
- Ninguna herramienta retorna 100 si Source o Brain certificate están incompletos.
- Cobertura acumulada multi-ronda conserva IDs y brainRevision.

### Trazador

- Lookup por sessionId y fingerprint produce el mismo reporte.
- Artifact missing/corrupt/version mismatch no genera ni escribe nada.
- Spy/assert: cero llamadas a IA, extracción, OCR, Vision, generación y endpoints POST.
- Snapshot de reporte con IDs, páginas y razones deterministas.
- Brain enriquecido después de crear deck se marca incomparable si falta revisión histórica.

## Evidencias por archivo y símbolo

| Archivo | Símbolo/líneas relevantes | Evidencia |
|---|---|---|
| `lib/adaptive/sourceSelection.ts` | `SourceSelectionSnapshot`, `sourceSelectionFingerprint` | autoridad de materiales/páginas |
| `lib/materialBrain/coverage.ts` | `computeSourceCoverage` 39–96 | requested derivado de chunks; suspiciouslyEmpty |
| `lib/materialBrain/chunking.ts` | `splitIntoPages`, `chunkMaterial`, `splitExtractionSubchunks` | páginas vacías filtradas; chunks sin cap global |
| `lib/materialBrain/build.ts` | `buildMaterialBrain` 265+; coverage/readiness 600+ | funnel Brain y readiness textual |
| `lib/materialBrain/multimodal.ts` | `prepareMaterialBrainMultimodalSources` 90+ | requested/analyzed/failed/noContent visual |
| `lib/materials/pageContentSignals.ts` | `decidePageAnalysisMode` | justificación text/vision/text_and_vision |
| `lib/materials/types.ts` | `Material`, `MaterialText` | falta de status por página en persistencia textual |
| `lib/materialBrain/types.ts` | `SourceCoverage`, `VisualCoverage`, `KnowledgeExtractionReport`, `MaterialBrain` | contratos actuales |
| `lib/materialBrain/reviewContext.ts` | `buildRepasarReviewTargets`, `computeRepasarDomainMap` | todas las unidades vivas |
| `lib/materialBrain/analysisContext.ts` | `buildAnalysisTargets`, `renderAnalysisGroundedContext`, `computeAnalysisCoverage` | universo completo Brain, prompt 90k |
| `lib/materialBrain/studyMapContext.ts` | `buildStudyMapNodes`, `computeStudyMapCoverage` | nodes/nodes por construcción |
| `lib/materialBrain/truquitosContext.ts` | `buildTruquitoTargets`, `selectTruquitoTargetsForBatch`, `computeTruquitosCoverage` | elegibilidad y batch 24 |
| `lib/materialBrain/flashcards/planner.ts` | `planFlashcards` | skipped, filtros y merges pre-denominador |
| `lib/materialBrain/flashcards/validate.ts` | `computeDeckCoverage` 603+ | complete sobre targeted IDs |
| `lib/materialBrain/quiz/planner.ts` | `buildAllocCandidates`, `analyzeQuizCoverage` 1196+ | universo assessable, config y cap 100 |
| `lib/materialBrain/examContext.ts` | `buildExamTargets`, `composeExamBlueprint` | procesos excluidos, full eligible coverage |
| `lib/materialBrain/chatRetrieval.ts` | `retrieveForChat` | top‑K por turno, no cobertura global |
| `lib/materialBrain/productionStore.ts` | `WorkerMaterialResultStore` | Brain persistido por fingerprint |
| `lib/materialBrain/flashcards/deckStore.ts` | `WorkerFlashcardDeckStore` | deck persistido sin plan.skipped |
| `lib/materialBrain/quiz/artifactStore.ts` | `WorkerQuizArtifactStore` | artifact por session/fingerprint/config |
| `lib/materialBrain/examGenerationStore.ts` | `examGenerationIdentity` | artifact por session/fingerprint/exam |

## Incertidumbres que requieren material real

- Si los extractores actuales preservan marcadores de todas las páginas en cada formato.
- Cuántas páginas reales usan OCR y si su derivación llega a SourceEvidence.
- Cuántos leaves quedan fallback/degraded y cuántas ideas humanas faltan aun con telemetría “sin pérdida estructural”.
- Tasa real de metadata/contextual/dedup exclusions por asignatura.
- Diferencia entre unidades Brain y una rúbrica humana de conceptos académicos únicos.
- Artifacts desplegados y versiones exactas para una sesión concreta.
