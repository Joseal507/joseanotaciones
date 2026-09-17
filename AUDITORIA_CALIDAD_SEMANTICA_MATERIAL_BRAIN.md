# Auditoría de calidad semántica de Material Brain

## Alcance y conclusión

Esta auditoría es estática y read-only. No ejecuta IA, no regenera materiales y no compara todavía un artifact real. Material Brain y Adaptive persiguen objetivos distintos y ninguno se toma como verdad absoluta.

Conclusión: Material Brain tiene un contrato fuerte para conocimiento atómico, tipado y grounded, pero actualmente no posee una certificación de completitud académica contra un inventario independiente de objetivos relevantes. Que todos los chunks terminen o que el Brain quede `ready` demuestra procesamiento operativo, no que se hayan conservado todos los conceptos, relaciones, fórmulas, procesos, excepciones o significados implícitos. Adaptive ofrece una referencia comparativa valiosa porque representa estructura temática y pedagogía, y añade auditoría/reparación; tampoco es un oracle, porque sus detectores y auditor usan muestras, retries reductivos y heurísticas.

El objetivo correcto no es reemplazar Adaptive ni comparar cantidades brutas. Es alinear ambos artifacts por la misma `SourceSelectionSnapshot`, normalizar sus afirmaciones académicas y presentar sus diferencias a revisión humana.

## 1. Contrato académico actual de Material Brain

### Modelo persistido

`MaterialBrain` persiste `scope`, `meta`, `units`, `relations`, `sourceCoverage`, cobertura visual, reporte de extracción y `mergeLog`. La identidad durable es `brain:<sourceSelectionFingerprint>` en `material_results`.

Cada unidad contiene identidad semántica, statement, importancia, provenance/evidence, tags, origen y rol académico. Los kinds son:

- `concept`, `fact`, `definition`, `formula`, `process`, `example`, `event_or_data`, `terminology`.
- Relaciones: `depends_on`, `causes`, `part_of`, `contrasts_with`, `example_of`, `defined_by`, `applies_formula`, `precedes`.
- Importancia: `critical`, `supporting`, `contextual`, combinada desde señales estructurales, repetición, prerequisitos, énfasis y sugerencia del modelo.

No existen tipos canónicos propios para topic/subtopic, assertion/opinion, exception, misconception, table, hierarchy o condition. Parte de ese significado puede aparecer dentro de statements, qualifiers, tags o relaciones, pero no queda garantizado ni consultable como categoría independiente.

### Matriz del contrato

| Categoría | Representación en Brain | Extracción y validación | Merge/persistencia | Pérdida posible |
|---|---|---|---|---|
| Temas principales | Sin entidad `topic`; puede emerger como `concept`, `domainTags` o `part_of` | Prompt pide conceptos/estructuras | Se persiste solo la unidad resultante | Jerarquía temática no explícita; Study Map debe reconstruirla |
| Subtemas | Sin schema específico | Igual que conceptos | Identidad por `canonicalSubject` + qualifiers | Puede fusionarse con tema o quedar como texto narrativo |
| Conceptos | `ConceptUnit` | Prompt exhaustivo; canonicalSubject, statement, quote/page | Merge semántico conservador | Omisión del modelo; concepto implícito sin cita literal |
| Definiciones | `DefinitionUnit.term` | Kind y campos requeridos generales; `term` puede faltar | `term` cae a `label` | Schema válido aunque la definición formal esté incompleta |
| Hechos/afirmaciones | `FactUnit`; concept/definition comparten grupo narrativo al deduplicar | Quote literal obligatoria en texto | Pueden fusionarse cross-kind si semanticKey y overlap coinciden | No distingue afirmación factual, opinión, hipótesis o regla modal |
| Procesos/pasos | `ProcessUnit.steps[]` | Prompt solicita pasos; normalizador acepta arrays parciales | Pasos se unen por número de orden | Pasos ausentes no invalidan la unidad; conflictos de orden pueden ocultarse |
| Causas/efectos | Relación `causes` | Relación exige endpoints, statement, quote/page | Se descarta si endpoints no resuelven o son ambiguos | Relación cross-page rara vez entra en un único chunk |
| Comparaciones | `contrasts_with` | Igual que relaciones | Persistida si ambos subjects resuelven | No hay tipo explícito para similitud; matices comparativos pueden perderse |
| Dependencias | `depends_on`, `part_of`, `precedes` | Extraídas localmente | Influyen en importancia | Dependencias globales entre capítulos pueden no observarse juntas |
| Fórmulas/variables | `FormulaUnit.expression`, `variables[]` | Prompt pide estructura y quote literal | Variables se unen por símbolo | Expresión puede quedar vacía; variable sin explicación no invalida; notación puede separarse del contexto |
| Ejemplos | `ExampleUnit.illustrates` | `illustratesSubject` opcional en raw | Cae a string vacío | Ejemplo puede sobrevivir sin vínculo al principio o confundirse con regla |
| Excepciones | Sin tipo específico | Solo si el modelo las expresa como fact/concept/qualifier | Sin indicador de excepción | Fácilmente invisibles para planners y validadores |
| Fechas/eventos/datos | `EventOrDataUnit.value` | Rescue controlado de qualifier desde quote | Contexto se conserva en qualifiers si existe | `value` es opcional; filas de tabla pueden perder estructura o escenario |
| Tablas | Sin tipo `table`; filas pueden ser `event_or_data`, fórmulas o visual evidence | Texto lineal o descripción visual | Se persisten unidades separadas | Encabezados, unidades, correspondencia fila-columna y tendencias pueden desacoplarse |
| Misconceptions | Sin campo canónico | No se solicitan explícitamente | No persisten como clase | Ausentes salvo que aparezcan casualmente como fact/concept |
| Importancia | `ImportanceSignal` | Modelo + señales estructurales deterministas | Se recomputa tras merge | Señales dependen del formato del chunk y relaciones extraídas; una omisión no puede ser importante |
| Provenance | Texto: `materialId`, page, quote, chunkId. Visual: `SourceEvidence` | Quote literal y page dentro del chunk; visual evidence externa | Se agregan evidencias al fusionar | Grounding estricto puede descartar conceptos implícitos legítimos; visual no usa quote textual |

### Extractor y validación

`extraction.ts::buildPrompt` pide “TODA unidad materialmente distinta”, ideas secundarias, tipos estructurados y ocho relaciones. Para texto exige quote literal de 10–30 palabras y página; para Vision depende de una descripción visual ya verificada y adjunta evidence externamente.

`normalizeRawUnit` rechaza kinds inválidos, campos requeridos ausentes, páginas fuera del chunk y quotes no verificables. Sin embargo, varios campos especializados son opcionales: una fórmula puede sobrevivir sin variables completas, un proceso con pasos incompletos y un ejemplo sin `illustratesSubject`. La validación comprueba forma y grounding, no exhaustividad ni coherencia académica del payload.

`normalizeRawRelation` exige endpoints nominales, statement, page y quote para texto. Luego `merge.ts::resolveRelations` necesita resolver ambos subjects a unidades canónicas; relaciones ambiguas se registran, pero las no resueltas sin ambigüedad se omiten sin contador específico.

### Deduplicación, merge e importancia

`identity.ts::decideMerge` exige mismo grupo de kind, mismo semanticKey, qualifiers compatibles y Jaccard de statements ≥0.10. `concept`, `fact` y `definition` comparten el grupo narrativo; esto repara variación de etiqueta entre chunks, pero puede borrar la distinción entre una definición formal y una afirmación narrativa cuando el canonicalSubject coincide.

`merge.ts::applyExtras` conserva el primer expression/value/illustrates, une variables por símbolo y pasos por número, y reemplaza el statement solo si el nuevo es >1.4 veces más largo. No existe resolución explícita de contradicciones entre dos valores, fórmulas, significados de variable o pasos con el mismo índice.

`importance.ts::combineImportance` impide que el modelo declare `critical` sin soporte estructural. Es prudente, pero una idea esencial expresada una sola vez, sin encabezado ni relación extraída, no puede ser `critical` solo por juicio semántico.

### Fallback y readiness

El fallback determinista conserva oraciones verificables como `fact`, sin relaciones, fórmulas tipadas, procesos, jerarquía, importancia rica ni semántica de ejemplo. Evita pérdida textual silenciosa, pero no preserva comprensión académica.

`sourceReadiness='ready'` acepta unidades rich, fallback o `complete_no_content`. `brainEnrichment='degraded'` puede ser terminal y operativamente usable. Por tanto, ready/degraded es una garantía de disponibilidad estable, no de equivalencia semántica con una extracción rich ni de completitud pedagógica.

## 2. Comparación neutral de schemas: Brain vs Adaptive

### Correspondencia de significado

| Adaptive | Material Brain | Equivalencia real |
|---|---|---|
| `topic` con title, description, pages, role | Conjunto de units + `part_of`/tags | Aproximada; Brain no conserva topic/subtopic canónico |
| `block` | `KnowledgeUnit` | Cercana como unidad aprendible, pero Adaptive agrega pedagogía |
| block `concept` | `concept` | Cercana si statements representan la misma proposición |
| block `definition` | `definition.term` | Cercana; comparar término + significado, no label solamente |
| block `formula` | `formula.expression/variables` | Cercana, con normalización de notación y condiciones |
| block `fact`/`entity` | `fact`, `event_or_data`, `terminology` | Uno-a-varios; requiere matching semántico |
| block `example` | `example.illustrates` | Cercana si ambos conservan principio y escenario |
| block `common_mistake` / `misconceptions[]` | Sin equivalente directo | Capacidad Adaptive que Brain no modela explícitamente |
| `dependsOn`, `relations` | `KnowledgeRelation` | Parcial; vocabularios y resolución difieren |
| `importance`, `examProbability` | `ImportanceSignal` | No equivalentes: Adaptive es pedagógico/evaluativo; Brain combina evidencia estructural |
| `difficulty`, `bloomLevel`, `examTypes`, `estimatedMinutes` | Sin equivalente | Pedagogía Adaptive; no debe forzarse dentro del Brain sin necesidad |
| `sourceSpans` con certainty | `provenance`/`evidence` | Brain es más estricto para texto; Adaptive acepta inferred/uncertain y deriva spans |
| `coverageCertified`, audit y repair | `sourceCoverage`, extraction telemetry | No equivalentes: Brain mide procesamiento/extracción, no cobertura semántica independiente |

### Capacidades Adaptive que deben preservarse

- Topic/subtopic y rol narrativo (`foundation`, `problem`, `mechanism`, `application`, `integration`, `context`).
- Bloques pedagógicos con importancia 0–100, dificultad, Bloom, probabilidad/tipo de examen y tiempo estimado.
- Misconceptions explícitas y modality de hechos frente a opiniones/argumentos.
- Dependencias usadas para unidades cognitivas, learning path, sesiones, criterios de salida y evaluación.
- Auditoría independiente, reparación de huecos y certificación que bloquea generación del plan cuando falla.
- Cobertura de objetivos de sesión y recuperación ligada a key points/fact keys.

Estas capacidades no prueban automáticamente mayor fidelidad factual. Adaptive también tiene riesgos: topics se detectan con 500–800 caracteres por página; el auditor revisa como máximo 12 páginas y 1,800 caracteres; retries simples piden 3–6 bloques y recortan texto; misconceptions y source spans se limitan; importance <25 se elimina.

## 3. Puntos de pérdida semántica

### Material Brain

| Riesgo | Evidencia | Consecuencia |
|---|---|---|
| Relaciones locales al chunk | Extracción independiente por hojas y relaciones solo entre subjects emitidos | Causas, dependencias y contrastes cross-page pueden no existir |
| Output token limitado | `extractChunk` usa `maxTokens: 4000` | Un chunk semánticamente denso puede truncar arrays; recovery descarta objetos incompletos y reintenta, pero fallback pierde estructura |
| Fallback plano | Toda oración pasa a `fact`; cero relaciones | “Cobertura” textual sin comprensión estructural |
| Strict provenance | Sin quote literal, unidad/relación textual se descarta | Conceptos implícitos, síntesis distribuida o tablas no lineales pueden desaparecer |
| Merge narrativo cross-kind | concept/fact/definition comparten grupo; piso Jaccard 0.10 | Posible fusión de proposiciones distintas con canonicalSubject común |
| Extras first-wins | Primer expression/value/illustrates; variables y pasos por clave | Conflictos y condiciones alternativas no son auditados |
| Relaciones descartadas | Endpoints ambiguos se cuentan; endpoints inexistentes solo se omiten | Grafo incompleto sin denominador de relaciones candidatas |
| Sin jerarquía | No hay topic/subtopic | Study Map infiere organización desde un corpus plano |
| Sin excepciones/misconceptions | No hay schema ni instrucción específica | Quiz/Flashcards no pueden saber que una afirmación es excepción o error común |
| Visual opcional para readiness | Gaps visuales no bloquean source readiness; fast base difiere Vision | Tablas, diagramas, fórmulas espaciales o gráficos pueden faltar en un Brain usable |
| `complete_no_content` heurístico | `isNonAcademicText` decide por longitud/puntuación/señales matemáticas | Fragmentos breves académicos no contemplados pueden clasificarse como vacíos |
| `degraded` estable | Fallback agotado puede cerrar enrichment | Herramientas reciben un universo estable pero semánticamente empobrecido |
| Schema-valid incompleto | Campos especializados no se exigen completos | Fórmula sin condiciones, proceso sin todos los pasos o ejemplo sin regla sigue siendo válido |
| Rol académico heurístico | Regex y señales estructurales | Metadata académicamente relevante puede clasificarse como documental, o viceversa |

No se encontró un `topK` o `slice` global que limite las units rich de Material Brain. El cap de 200 del fallback es una válvula patológica y reporta pérdida. El riesgo dominante no es un primer-N explícito, sino extracción local, validación estructural y degradación semántica del fallback.

### Adaptive como referencia, no como oracle

- Detección de topics usa muestras por página (`text.slice(0, charsPerPage)`).
- Retry 1 reduce el texto al 60%; retries 2/3 piden “key blocks” y usan `slice(0,5000)`/`slice(0,3000)`.
- Bloques con importancia <25 se eliminan.
- Misconceptions se recortan a 2 y luego 3; source spans a 3/4.
- Dedup local usa label normalizado; puede fusionar homónimos dentro de un topic.
- Auditoría examina una muestra de primeras páginas y lista máximo tres findings; reparación procesa máximo seis huecos.
- Topics faltantes reciben fallback por página con nombres genéricos, que preserva page assignment pero no comprensión.

## 4. Rúbrica neutral

Cada fila debe devolver `{status, brainIds, adaptiveIds, sourceRefs, evidence, notes}`. `status` es `complete | partial | missing | incorrect | not_applicable`. La unidad de evaluación es un objetivo académico humano o una proposición normalizada, nunca el número bruto de objetos.

| # | Dimensión | Criterio neutral |
|---|---|---|
| 1 | Fidelidad a la fuente | Proposición y modalidad coinciden con fuente; condiciones no se alteran |
| 2 | Conceptos importantes | Todos los imprescindibles del golden tienen representación equivalente |
| 3 | Hechos verificables | Fechas, cifras, entidades y afirmaciones esenciales correctas |
| 4 | Procesos | Pasos completos, orden correcto, prerequisitos y resultado |
| 5 | Fórmulas | Expresión, variables, unidades, condiciones y dominio de aplicación |
| 6 | Relaciones | Causa, dependencia, contraste, composición y secuencia necesarias |
| 7 | Jerarquía | Tema/subtema y pertenencia recuperables sin contradicción |
| 8 | Ejemplos | Escenario conservado y vinculado a la regla que ilustra |
| 9 | Excepciones/misconceptions | Excepciones y errores comunes explícitos no tratados como regla |
| 10 | Importancia | Imprescindibles priorizados; secundarios no desplazan lo esencial |
| 11 | Provenance | Cada claim tiene página y evidencia suficiente; synthesis multi-source declarada |
| 12 | Duplicación | Dos objetos no repiten la misma proposición sin aportar condición distinta |
| 13 | Alucinaciones | Ninguna afirmación crítica carece de respaldo; modalidad preservada |
| 14 | Flashcards | Permite preguntas atómicas, respuestas verificables y provenance |
| 15 | Quiz | Permite distractores seguros, formatos adecuados y objetivos evaluables |
| 16 | Repasar | Permite explicar tesis, conceptos y relaciones sin convertir omisión en error |
| 17 | Study Map | Permite jerarquía y conexiones completas, no solo una lista de nodos |

Reglas de scoring:

- `complete`: todos los componentes esenciales están correctos y grounded.
- `partial`: existe representación útil, pero falta al menos un componente no crítico o detalle esencial recuperable.
- `missing`: no existe representación semánticamente equivalente.
- `incorrect`: existe representación, pero contradice o distorsiona fuente/condiciones/modalidad.
- `not_applicable`: el material no contiene esa dimensión; requiere evidencia del golden, no ausencia en ambos artifacts.

## 5. Diseño del comparador read-only

### Entrada y resolución de identidad

Acepta `sessionId` o `sourceSelectionFingerprint`:

1. Con `sessionId`, lee `StudySession`, reconstruye `SourceSelectionSnapshot` y exige coincidencia exacta del fingerprint persistido.
2. Con fingerprint, localiza sesiones candidatas; no elige una si hay más de una identidad Adaptive incompatible.
3. Lee Material Brain desde `material_results` con key `brain:<fingerprint>`.
4. Lee `material_blueprint`/`blueprint` de una sesión Adaptive con el mismo fingerprint. Si no existe, reporta `adaptiveReference: unavailable`.
5. No llama endpoints de generación, OCR, Vision, extractores ni proveedores y no escribe sesiones.

Limitación actual: Brain está directamente indexado por fingerprint; Adaptive está indexado por sesión y conserva el fingerprint en la fila/artifact. La búsqueda por fingerprint puede requerir listar sesiones autorizadas del usuario. No debe comparar una sesión Free con otra selección ni elegir la “más reciente” sin match exacto.

### Normalización comparativa

Crear vistas efímeras, sin persistir:

- `SemanticClaim`: id de origen, tipo, canonical subject, proposición, qualifiers/conditions, source refs, evidence, importancia, artifact revision.
- Brain units se expanden a claims: fórmula + variables; proceso + pasos; ejemplo + illustrates; relation como claim binario.
- Adaptive blocks/concepts se expanden a claims: summary, misconception, dependsOn, relation, formula y topic membership.
- Matching en tres pasos: identidad exacta normalizada; equivalencia de notación/alias; candidato semántico con score y explicación. Ningún match aproximado se declara equivalente automáticamente.
- Estados: `equivalent`, `brain_only`, `adaptive_only`, `conflicting`, `possible_duplicate`, `unverifiable`.

### Salida

- Inventario por kind y por topic, sin usar conteos como veredicto.
- Conceptos equivalentes, solo Adaptive, solo Brain y conflictivos.
- Relaciones, fórmulas, procesos, ejemplos, excepciones/misconceptions presentes y ausentes.
- Units/blocks sin provenance suficiente.
- Diferencias de importancia como señal, no error automático.
- Huecos candidatos con IDs, páginas y razón para revisión humana.
- Resultado de las 17 dimensiones de la rúbrica.

El comparador nunca dirá “Adaptive correcto” por mera presencia. Una diferencia se resuelve contra fuente/golden o queda pendiente.

## 6. Plantilla de revisión humana

```yaml
reviewId: semantic-review-001
sourceSelectionFingerprint: "..."
sessionId: "..."
materialIds: ["..."]
selectedPages: { "material-id": [1, 2] }
reviewer: "product-owner"
items:
  - reviewItemId: "golden-001"
    canonicalLabel: "..."
    sourceRefs:
      - { materialId: "...", page: 1, quote: "..." }
    category: concept # concept|fact|process|formula|example|relation|exception|misconception
    importance: essential # essential|secondary
    brainIds: ["..."]
    adaptiveIds: ["..."]
    verdict: brain_correct # essential|secondary|brain_omitted|brain_correct|adaptive_correct|both_incomplete|hallucination|duplicate|misclassified
    expectedMeaning: "..."
    notes: "..."
rubric:
  - dimension: fidelity
    status: complete
    brainIds: ["..."]
    adaptiveIds: ["..."]
    evidence: ["golden-001"]
```

Para convertirlo en fixture golden: congelar fingerprint, hash o copia autorizada del fixture fuente, selección exacta, revisión versionada, aliases aprobados y expected claims. Nunca guardar material privado en un fixture público.

## 7. Definición medible de Brain apto

Un Brain es apto para las ocho herramientas solo si una evaluación golden demuestra:

- 100% de conceptos `essential` aprobados representados correctamente.
- 100% de hechos, fórmulas y procesos esenciales completos, incluidas condiciones y pasos.
- 100% de relaciones marcadas `required_for_understanding` representadas o visibles como gap.
- 100% de claims con grounding aceptable; cero alucinaciones críticas.
- Cero unidades `incorrect` esenciales.
- Duplicación semántica por debajo del umbral acordado; propuesta inicial ≤5% de claims no triviales, a validar con producto.
- Toda exclusión/rechazo semántico visible con reason e IDs.
- Cualquier gap crítico fuerza `semanticCoverage=partial`; nunca se declara 100%.
- Las dimensiones 14–17 son al menos `complete` o `partial` sin fallos críticos específicos de herramienta.

No se recomienda fijar umbrales de recall para contenido secundario hasta medir varios materiales reales. El 100% se reserva a objetivos académicos aplicables aprobados, no a todas las oraciones.

## 8. Primer experimento con material real

Elegir un solo material ya conocido por el Product Owner, sin datos sensibles, con 12–25 páginas seleccionadas y mezcla deliberada de:

- 8–15 conceptos esenciales;
- al menos una fórmula con variables/condiciones;
- un proceso de 3+ pasos;
- una tabla o gráfica;
- un ejemplo que dependa de una regla;
- una excepción o misconception;
- una relación que cruce páginas.

Protocolo:

1. Congelar `SourceSelectionSnapshot` y fingerprint exactos.
2. Usar únicamente Brain y blueprint Adaptive ya persistidos; si no existen ambos para esa selección, programar una generación controlada posterior, fuera de esta auditoría.
3. El Product Owner crea primero el inventario golden sin ver los conteos de los artifacts.
4. Ejecutar el futuro comparador read-only.
5. Revisar a ciegas 100% de esenciales y una muestra estratificada de secundarios/Brain-only/Adaptive-only.
6. Calcular recall esencial, precisión grounded, completitud de fórmulas/procesos/relaciones, duplicación y utilidad por herramienta.
7. Repetir en al menos tres dominios antes de cambiar extractor o merge.

## 9. Cambio mínimo recomendado después de medir

No cambiar prompts ni merge antes del experimento. El primer cambio mínimo debe responder al gap dominante observado:

- Si faltan relaciones cross-page: añadir una pasada de reconciliación relacional sobre units ya grounded, sin reextraer contenido.
- Si fallback domina: impedir claims de completitud semántica cuando existan units `fallback/mixed` esenciales, sin bloquear uso operativo.
- Si faltan misconceptions/excepciones: añadir campos aditivos grounded o una vista derivada, solo si el golden demuestra necesidad transversal.
- Si hay over-merge: endurecer `decideMerge` para el patrón demostrado y añadir fixture de no-fusión.
- Si se descartan conceptos válidos por provenance: soportar evidencia compuesta/multi-span verificable, no relajar grounding globalmente.

La recomendación inicial, antes de conocer el resultado, es introducir únicamente un `SemanticQualityAssessment` read-only separado de readiness. No debe modificar el Brain ni las herramientas; debe registrar la rúbrica y gaps contra un golden/referencia para decidir con evidencia el cambio posterior.

## Evidencias por archivo y símbolo

| Archivo | Símbolo | Evidencia relevante |
|---|---|---|
| `lib/materialBrain/types.ts` | `KnowledgeUnit`, `KnowledgeRelation`, `MaterialBrain` | Kinds, relaciones, importance, provenance y artifact persistido |
| `lib/materialBrain/extraction.ts` | `buildPrompt`, `normalizeRawUnit`, `normalizeRawRelation`, `extractChunk` | Exhaustividad declarada, grounding literal, validación y límite de 4000 tokens |
| `lib/materialBrain/identity.ts` | `decideMerge`, `mergeKindGroup` | Fusión narrative cross-kind y Jaccard 0.10 |
| `lib/materialBrain/merge.ts` | `mergeExtractions`, `applyExtras`, `resolveRelations` | Merge, first-wins, resolución y pérdida de relaciones |
| `lib/materialBrain/deterministicFallback.ts` | `buildDeterministicFallbackExtraction` | Oraciones como facts; sin relaciones/estructura; safety ceiling 200 |
| `lib/materialBrain/build.ts` | `checkpointForExtraction`, `buildMaterialBrain` | complete/no-content, fallback, degraded y readiness operativo |
| `lib/materialBrain/importance.ts` | `combineImportance` | Importancia multi-señal y límite del juicio del modelo |
| `lib/materialBrain/academicRole.ts` | `classifyAcademicRole` | Filtro heurístico de metadata |
| `lib/materialBrain/productionStore.ts` | `WorkerMaterialResultStore` | Persistencia `brain:<fingerprint>` |
| `app/api/adaptive/blueprint/route.ts` | `extractDocumentStructure` | Topics/roles desde muestra de 500–800 chars por página |
| `app/api/adaptive/blueprint/route.ts` | `analyzeTopic` | Blocks, misconceptions, Bloom, dificultad, relaciones, spans y retries reductivos |
| `app/api/adaptive/blueprint/route.ts` | `deduplicateBlocks`, `deduplicateConcepts`, `normalizeBlueprint` | Canonicalización del schema Adaptive |
| `app/api/adaptive/blueprint/route.ts` | `auditBlueprint`, `repairCoverageGaps`, `certifyBlueprint` | Auditoría muestral, reparación limitada y gate de planificación |
| `lib/adaptive/blueprintQuality.ts` | `evaluateBlueprintQuality` | Calidad estructural, no completitud semántica golden |
| `lib/adaptive/types.ts` | `CognitiveUnit`, `StudyPlan` | Pedagogía, dependencias, sesiones y coverage target |
| `lib/studySessions.ts` | `StudySession`, persist/restore helpers | Blueprint y fingerprint persistidos por sesión |
| `scripts/tests/material-brain-core-contracts.ts` | contratos core | Provenance, fórmulas, procesos, multi-material y merge |
| `scripts/tests/material-brain-p0-completeness-contracts.ts` | fallback/provenance contracts | Pérdida textual y notación, no equivalencia semántica end-to-end |
| `scripts/tests/material-brain-multimodal-contracts.ts` | multimodal contracts | Evidence visual y Vision opcional para readiness |

## Incertidumbres que requieren medición

- Recall real de conceptos imprescindibles por dominio.
- Frecuencia de Brain `rich`, `mixed` y `fallback` en producción.
- Cuántas relaciones importantes cruzan fronteras de chunk.
- Tasa real de over-merge y de relaciones con endpoints no resueltos.
- Calidad de fórmulas, procesos y tablas más allá de presencia de kind.
- Cuánto aporta Adaptive-only frente a errores propios de Adaptive.
- Umbral de duplicación pedagógicamente aceptable.
- Artifact real que el Product Owner considera representativo y su autorización para convertirlo en golden privado.
