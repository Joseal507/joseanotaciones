# GIT_WORKTREE_AUDIT.md

Auditoría de higiene Git — solo lectura. No se modificó, stageó, ni commiteó nada.
Herramientas usadas: `git status --porcelain -uall`, `git diff`, `git check-ignore`, `git log --all`, `graphify query`.

Snapshot: 72 archivos trackeados modificados, 2687 archivos untracked (2525 son `.flashcards-traces/*.json`).

---

## 1. Archivos fuente que NO podemos perder

### 1.1 Producción — trackeados, modificados (72 archivos)
Todo el árbol de rutas `app/api/**`, `components/materias/**`, `lib/**` (Material Brain, Flashcards V2, Quiz V2, Free state, adaptive, materials, Worker `cloudflare/studyal-api/src/index.ts`). Confirmado por `graphify query`: estos archivos son importados entre sí en cadena real (deckStore.ts → build.ts → route.ts → componentes), no código huérfano.
- **Grupo**: 3 (P0 Flashcards eval), 4 (Material Brain lifecycle), 5 (Flashcards V2), 6 (Quiz V2), 7 (Free), 8 (Ingestión/OCR/Vision) según archivo — ver detalle en sección 3.
- **Producer/consumer**: producers de lógica de negocio; consumidos por rutas API y componentes.
- **Importado por producción**: sí (confirmado por grafo).
- **Referenciado por tests**: sí, extensamente (`scripts/tests/*-contracts.ts`).
- **Generado**: no.
- **Datos privados**: no (código).
- **Entra en futuro commit**: sí — es el cuerpo principal del trabajo de la sesión.
- **Dependencias**: alta cohesión interna entre `lib/materialBrain/flashcards/*`, `lib/materialBrain/quiz/*`, y las rutas API correspondientes; no deben separarse en commits que rompan la compilación intermedia.

### 1.2 Producción — untracked, nuevos (162 archivos no-traza)
Ejemplos: `lib/materialBrain/deterministicFallback.ts`, `sourceObjectiveSatisfaction.ts`, `pedagogicalDedup.ts`, `tracePersistence.ts`, `capabilities.ts`, `readiness.ts`, `academicStability.ts`, `chatRetrieval.ts`, `groundedContext.ts`, `quiz/allocation.ts`, `quiz/coverageCache.ts`, `materials/webFetch.ts`, `materials/htmlSections.ts`, `app/api/materials/add-web/route.ts`, `app/api/quiz-reports/route.ts`, y ~60 `scripts/tests/*-contracts.ts` nuevos.
- **grupo**: 3/4/5/6/8 según dominio (ver sección 3).
- **Producer/consumer**: producers reales — confirmado con `graphify query` que `deckStore.ts`, `build.ts`, rutas API y decenas de tests los importan (`capabilities.ts` → consumido por `material-brain/route.ts`; `readiness.ts` → consumido por `build.ts`; `pedagogicalDedup.ts`, `sourceObjectiveSatisfaction.ts`, `tracePersistence.ts` → consumidos dentro de `flashcards/` y sus contract tests).
- **Importado por producción**: sí.
- **Referenciado por tests**: sí (archivos hermanos en `scripts/tests/`).
- **Generado**: no.
- **Datos privados**: no.
- **Entra en futuro commit**: sí, junto con sus consumidores trackeados (son parte del mismo feature, hoy "huérfanos" solo porque nunca se hizo `git add`).
- **Dependencias**: crítico — si se commitean los trackeados (1.1) sin estos, el build se rompe (imports a archivos inexistentes en el commit). Deben ir en el MISMO checkpoint.

### 1.3 Skill de Graphify (`.agents/skills/graphify/**`, 10 archivos untracked)
- **grupo**: 10 (Configuración Codex/RTK/Graphify).
- **Producer/consumer**: herramienta de tooling, no runtime de la app.
- **Importado por producción**: no.
- **Referenciado por tests**: no.
- **Generado**: no (contenido de skill instalado, editable).
- **Datos privados**: no.
- **Entra en futuro commit**: sí, en checkpoint separado de tooling.
- **Dependencias**: ninguna con código de producto.

---

## 2. Artefactos probablemente descartables

| Ruta | Cantidad/Tamaño | Motivo |
|---|---|---|
| `.flashcards-traces/*.json` | 2525 archivos, 67 MB | Trazas de depuración generadas por `lib/materialBrain/flashcards/tracePersistence.ts` (`TRACE_DIR = process.cwd()/.flashcards-traces`) en cada corrida de tests/dev. Confirmado: nunca estuvieron trackeados (`git log --all -- .flashcards-traces` → vacío). Contenido inspeccionado (`fp-a-mt9eoq48-*.json`): solo fixtures sintéticos de test (`fp-a`, `sk:concepto 3`), sin datos de usuario real detectados en la muestra. **Bug de higiene detectado**: el `.gitignore` modificado agrega `.debug/`, pero el directorio real que usa el código es `.flashcards-traces/` — el patrón no cubre el directorio real, por lo que estos 2525 archivos seguirían apareciendo como untracked indefinidamente. |
| `studyal_context.txt` | 6 271 974 líneas | Volcado masivo, no es código fuente real (excede por 1000x cualquier archivo del repo). Aparenta ser un dump de contexto de sesión anterior. No referenciado por ningún import ni test. |
| `modo_libre_codigo.txt` | 1438 líneas | Dump de texto plano con código de componentes Free (`StudyALProcess.tsx`, etc.) pegado como snapshot — no es la fuente de verdad (la fuente real ya está en `components/materias/StudyALProcess.tsx`, trackeado). Parece scratch de una sesión de auditoría. |
| `scripts/_check_owner2.ts` | 1 archivo | Script scratch de la sesión anterior para verificar ownership de un material vía Worker API — no forma parte del pipeline de tests (no sigue el patrón `*-contracts.ts`, no está en `package.json`). |
| `reports/playwright/*.png`, `index.html` | 41 archivos | Salida de una corrida de Playwright (capturas visuales). Regenerable con `npm run` correspondiente. |
| `reports/*.json` (adaptive-v3-simulation-*, free-nav-debug-*) | 4 archivos | Salidas de simulación/debug, regenerables. |
| `reports/playwright-artifacts/.last-run.json`, `test-results/.last-run.json` | 2 archivos (trackeados, modificados) | Metadata de última corrida de test runner — se regenera en cada ejecución, no debería estar trackeado en absoluto. |
| `AUDITORIA_*.md` (5 archivos raíz) | — | Informes de auditoría de esta sesión (grupo 9), no código. Descartable del código de producto, pero puede valer la pena conservar como documentación histórica — **decisión humana** (ver sección 5). |

**Nota**: ninguno de estos artefactos descartables es importado por código de producción ni referenciado por `package.json` o por ningún `scripts/tests/*-contracts.ts` (verificado por búsqueda directa, ninguno aparece como import).

---

## 3. Grupos de commits propuestos (checkpoints locales, orden sugerido)

1. **CP0 — Higiene de `.gitignore`** (aislado, sin código de producto)
   Corregir el patrón para que apunte a `.flashcards-traces/` (no `.debug/`), y evaluar excluir también `test-results/.last-run.json` y `reports/playwright-artifacts/.last-run.json` del tracking. *Solo se propone aquí — no se implementa.*

2. **CP1 — Material Brain lifecycle/enrichment (grupo 4)**
   `lib/materialBrain/build.ts`, `chunking.ts`, `extraction.ts`, `extractionTelemetry.ts`, `merge.ts`, `multimodal.ts`, `productionStore.ts`, `provenanceValidation.ts`, `types.ts`, `useMaterialBrainLifecycle.ts`, `identity.ts` (si aplica) + nuevos: `academicRole.ts`, `academicSegment.ts`, `academicStability.ts`, `analysisContext.ts`, `capabilities.ts`, `chatRetrieval.ts`, `checkpointMerge.ts`, `coverageMerge.ts`, `deterministicFallback.ts`, `examContext.ts`, `examGenerationStore.ts`, `groundedContext.ts`, `provenanceNotation.ts`, `readiness.ts`, `repasarSnapshot.ts`, `reviewContext.ts`, `studyMapContext.ts`, `toolPreparation.ts`, `truquitosContext.ts` + tests `material-brain-*-contracts.ts`, `academic-stability-contracts.ts`, `page-intelligence-contracts.ts`.

3. **CP2 — Ingestión/OCR/Vision (grupo 8)**
   `lib/materials/repository.ts`, `types.ts`, `pageContentSignals.ts`, `htmlSections.ts`, `sourceIndex.ts`, `webExtract.ts`, `webFetch.ts`, `app/api/materials/add-web/route.ts`. Depende de CP1 (Material Brain consume estos módulos de resolución de fuente).

4. **CP3 — Flashcards V2 + P0 hard invariant (grupos 3 y 5)**
   `lib/materialBrain/flashcards/*` (deckStore.ts, generator.ts, planner.ts, types.ts, validate.ts, index.ts, documentMetadata.ts, pedagogicalDedup.ts, pipelineTrace.ts, sourceObjectiveSatisfaction.ts, tracePersistence.ts), `lib/flashcards/evaluationClient.ts`, `app/api/flashcards-v2/route.ts`, `components/materias/ALAIStudyALCards.tsx` + todos los `scripts/tests/flashcards-*-contracts.ts` (nuevos y modificados) + `package.json` (script `test:target-freeze` y entrada en `pretest`). Depende de CP1/CP2.

5. **CP4 — Quiz V2 (grupo 6)**
   `lib/materialBrain/quiz/*` (artifactStore.ts, evaluator.ts, generator.ts, index.ts, planner.ts, presentation.ts, types.ts, validate.ts, allocation.ts, coverageCache.ts, help.ts), `app/api/quiz-reports/route.ts`, `scripts/tests/quiz-v2-contracts.ts`. Depende de CP1.

6. **CP5 — Herramientas Free y componentes compartidos (grupo 7)**
   `lib/freeAlaiState.ts`, `freeStudyMapState.ts`, `freeTruquitosState.ts`, `lib/alai.ts`, `lib/ai/generationPipeline.ts`, `lib/adaptive/sourceSelection.ts`, `lib/academic-content/validation.ts`, componentes `ALAIStudyAL*.tsx`, `AnalisisTeorico.tsx`, `MatchingCanvas.tsx`, `MaterialPreparationScreen.tsx`, `StudyALProcess.tsx`, `TemaView.tsx`, `ALAIStudyMap.tsx`, rutas `app/api/alai-studyal-*`, `app/api/analizar-teorico`, `app/api/adaptive/blueprint`, `app/api/mastery/extract-graph`, `app/api/evaluar`, `app/materias/page.tsx` + tests `free-alai-continuity-contracts.ts`. Depende de CP1–CP4 (consume Material Brain, Flashcards y Quiz).

7. **CP6 — Worker (Cloudflare)**
   `cloudflare/studyal-api/src/index.ts` — aislado por ser otro runtime/deploy target; revisar si sus cambios son consistentes con lo que CP1–CP5 esperan del backend (mismos endpoints).

8. **CP7 — Tooling (grupo 10)**
   `.agents/skills/graphify/**`. Sin dependencia con código de producto — puede ir en cualquier momento, incluso antes de CP1.

9. **CP8 — Informes de auditoría (grupo 9)**
   `AUDITORIA_*.md`, este mismo `GIT_WORKTREE_AUDIT.md`. Opcional, requiere decisión humana (ver sección 5).

**Fuera de todo checkpoint** (grupo 11/12, no debe entrar en ningún commit): `.flashcards-traces/**`, `studyal_context.txt`, `modo_libre_codigo.txt`, `scripts/_check_owner2.ts`, `reports/playwright/**`, `reports/*.json` sueltos, `reports/playwright-artifacts/.last-run.json`, `test-results/.last-run.json`.

---

## 4. Dependencias entre grupos

```
CP7 (tooling)        — independiente
CP0 (.gitignore)     — independiente, pero debería ir ANTES de cualquier futuro `git add -A`

CP1 (Material Brain) ─┬─> CP2 (Ingestión/OCR/Vision)
                       ├─> CP3 (Flashcards V2 + P0)
                       └─> CP4 (Quiz V2)

CP2, CP3, CP4 ────────> CP5 (Free + componentes compartidos)

CP6 (Worker)          — verificar compatibilidad con CP1–CP5, no depende de orden estricto de compilación local
CP8 (auditorías)      — independiente, documentación
```

Si se compila TypeScript en cada checkpoint (recomendado por AGENTS.md: `npx tsc --noEmit` proporcional al cambio), el orden CP1→CP2→CP3→CP4→CP5 es el único que garantiza que cada checkpoint compile de forma autocontenida, porque CP3/CP4/CP5 importan símbolos definidos en CP1 (`MaterialBrain`, `KnowledgeUnit`, `capabilities.ts`, `readiness.ts`).

---

## 5. Archivos que requieren decisión humana

1. **`AUDITORIA_*.md` (5 archivos) + `RTK.md` (raíz) + `GIT_WORKTREE_AUDIT.md`** — ¿se commitean como documentación del proceso, o quedan fuera del repo (p. ej. en una carpeta local no trackeada)? No son código de producto pero tampoco son basura.
2. **`.flashcards-traces/` — el propio directorio, no solo su contenido actual**: ¿debe existir como feature permanente (trazas de diagnóstico en dev) con su propio patrón correcto en `.gitignore`, o `tracePersistence.ts` debería escribir a una ruta ya cubierta por `.gitignore` (ej. dentro de `.debug/` como sugiere el diff actual)? Esto determina si CP0 es un simple ajuste de patrón o requiere tocar `tracePersistence.ts` (código de producción, fuera del alcance de esta auditoría de solo lectura).
3. **`studyal_context.txt` (6.27M líneas)** — antes de decidir borrarlo, confirmar que no es una copia de respaldo intencional de otra sesión distinta al "respaldo físico verificado" ya mencionado por el usuario. Podría contener rutas, fragmentos de material del usuario o contexto de conversación — **revisar contenido sensible antes de cualquier acción**, ya que su tamaño sugiere una concatenación amplia de fuentes/­contexto.
4. **`modo_libre_codigo.txt`** — mismo criterio: parece un scratch, pero podría ser una referencia de trabajo en curso del usuario para Free Mode; confirmar antes de excluir.
5. **`scripts/_check_owner2.ts`** — script de diagnóstico de la sesión anterior que consulta el Worker API por ownership de materiales; si aún se necesita para la investigación pendiente de `mat_51698c0cfba451ccfe67ae4f`, no debe borrarse todavía aunque no vaya a ningún commit.
6. **`reports/playwright-artifacts/.last-run.json` y `test-results/.last-run.json`** (trackeados y modificados) — parecen metadata de ejecución que cambia en cada corrida; decidir si deben excluirse de git por completo vía `.gitignore` (probable) en vez de seguir apareciendo como diffs ruidosos en cada commit futuro.
