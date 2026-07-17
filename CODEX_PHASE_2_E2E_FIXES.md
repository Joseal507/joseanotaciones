Trabaja únicamente dentro de:

/Users/joseal/studyal

Lee completos antes de editar:

- AGENTS.md
- ADAPTIVE_ACCEPTANCE_CONTRACT.md
- PHASE_1_E2E_MATRIX_REPORT.md
- reports/phase-1-playwright-manual.log
- playwright.config.ts
- todos los archivos de tests/e2e/
- todos los artefactos relevantes de reports/playwright-artifacts/
- todos los artefactos relevantes de reports/playwright/
- app/e2e-adaptive/page.tsx
- components/materias/StudyALProcess.tsx
- components/materias/adaptive/v3/StudyALSessionV3.tsx
- components/materias/adaptive/v3/PaginatedBookPage.tsx
- components/materias/adaptive/AdaptiveSessionComplete.tsx
- lib/adaptive/v3/types.ts
- lib/adaptive/v3/ui/interactionMachine.ts
- lib/adaptive/v3/engine/interactionContract.ts
- lib/adaptive/v3/storage/materialMasteryStorage.ts
- app/api/adaptive/v3/tutor/route.ts

RESTRICCIONES ABSOLUTAS

- No hagas commit.
- No hagas deploy.
- No uses git reset.
- No uses git clean.
- No uses git checkout.
- No uses git restore.
- No uses git stash.
- No borres ni reviertas cambios acumulados.
- No debilites Mastery Contracts.
- No cambies isProgramComplete como condición canónica.
- No cambies tests solo para esconder bugs.
- No uses skip, fixme ni only.
- No aumentes timeouts para esconder fallos.
- No añadas retries para ocultar inestabilidad.
- No cambies el producto únicamente para satisfacer un selector malo.
- Distingue bugs del producto de bugs del arnés.
- No avances a simulación pedagógica.
- No hagas refactors amplios no relacionados.

MISIÓN ÚNICA

Llevar la matriz Playwright actual de:

- 33 pruebas
- 24 PASS
- 9 FAIL

a:

- 33/33 PASS
- 0 FAIL
- 0 skipped
- sin retries usados para ocultar inestabilidad

LOS NUEVE FALLOS

1. Introducción aparece una sola vez.
2. Finalizando no reinicia introducción.
3. Llegada al libro canónico.
4. Categorías del resumen no se mezclan.
5. Refresh conserva interactionId, questionId y fase.
6. Salir y volver conserva la sesión.
7. Repair no repite questionId.
8. Repair no repite factKey sin intención.
9. Final review no repite literalmente.

CLASIFICACIÓN INICIAL QUE DEBES VERIFICAR CON EVIDENCIA

A. Probable bug del test o selector:

- 1. Introducción aparece una sola vez.
- 2. Finalizando no reinicia introducción.
- 3. Llegada al libro canónico.
- 4. Categorías del resumen.

Los tests 1–3 pueden estar esperando un botón llamado Continuar aunque la UI real use:

- Siguiente →
- Entrar a mi programa

No cambies la UI a ciegas. Revisa screenshots y traces.

El test 4 usa un selector ambiguo con texto y locator('..'). Usa testids estables manteniendo assertions fuertes.

B. Probable bug real del producto:

- 5. Refresh no conserva la interacción exacta.
- 6. Salir y volver restaura un snapshot anterior.

C. Contrato que necesita una regla explícita y aplicación real:

- 7. Anti-repetición de questionId.
- 8. Anti-repetición de factKey.
- 9. Novedad real del final review.

ANTES DE EDITAR

Ejecuta:

git status --short
git diff --stat
git diff --check
npm run test:e2e

Inspecciona para cada fallo:

- error-context.md
- screenshot
- video
- trace.zip
- test correspondiente
- implementación del producto correspondiente

Crea y mantén actualizado:

PHASE_2_E2E_FIXES_REPORT.md

Para cada uno de los nueve fallos documenta:

- clasificación final:
  - A: bug del test/selector
  - B: bug real del producto
  - C: contrato ambiguo
- evidencia
- causa raíz
- test rojo
- corrección
- archivos modificados
- test verde

PROCESO OBLIGATORIO

Para cada fallo:

1. Ejecuta el test específico y confirma rojo.
2. Revisa artefactos y causa raíz.
3. Aplica el cambio mínimo correcto.
4. Ejecuta el mismo test hasta verde.
5. Ejecuta tests relacionados.
6. Documenta el resultado.
7. Continúa con el fallo siguiente.

No acumules los nueve cambios sin validación intermedia.

INTRODUCCIÓN Y LIBRO

- No asumas que el botón debe llamarse Continuar.
- Usa data-testid estable cuando corresponda.
- La introducción aparece exactamente una vez.
- Finalizando no remonta ni reinicia la introducción.
- El flujo llega al libro canónico.
- No aparece la vista adaptive legacy.
- No cambies etiquetas visuales solo para satisfacer el selector.

RESUMEN

Usa o añade:

- data-testid="summary-studied"
- data-testid="summary-mastered"
- data-testid="summary-reinforcement"

Verifica pertenencia y exclusión:

- cada concepto aparece únicamente en su categoría correcta;
- un concepto dominado no aparece como refuerzo;
- un concepto de refuerzo no aparece como dominado;
- no aparecen microIds técnicos.

No uses selectores ambiguos como:

getByText(...).locator('..')

REFRESH

Debe persistirse y restaurarse exactamente:

- interactionId
- questionId
- interactionPhase
- current activity
- response
- evaluation
- feedback
- selected confidence
- assistance state relevante
- timestamps necesarios

Al refrescar:

- no llamar al tutor para avanzar si existe una interacción activa válida;
- no generar IDs nuevos;
- no retroceder de fase;
- no avanzar automáticamente;
- no borrar respuesta, evaluación, feedback ni confianza.

SALIR Y VOLVER

Después de Continuar:

- persiste la interacción nueva antes de navegar;
- no permitas que una escritura vieja sobrescriba una nueva;
- al volver abre el snapshot más reciente;
- investiga closures viejos, efectos tardíos, orden de promesas y claves distintas de storage.

REPAIR

Distingue:

- mismo micro
- mismo factKey
- mismo questionId
- mismo texto normalizado
- mismo formato
- misma estrategia

Persistir entre sesiones:

- usedQuestionIds
- usedFactKeys
- historial o fingerprints normalizados

Reglas:

- un questionId usado no puede volver a emitirse;
- repetir el mismo micro sí puede ser válido;
- repetir factKey solo con repetitionIntent explícito;
- repetitionIntent permitido:
  - spaced_retrieval
  - misconception_retest
  - delayed_recall
- un fallo debe cambiar estrategia, formato, representación, ejemplo, dificultad o evidencia objetivo;
- no fabricar dominio;
- no crear loops infinitos;
- no reutilizar silenciosamente la misma actividad.

FINAL REVIEW

No reutilices:

- mismo questionId;
- mismo texto normalizado;
- misma plantilla con cambios cosméticos;
- mismo fill blank literal.

La revisión final debe usar una representación diferente:

- integración;
- transferencia;
- comparación;
- discriminación;
- aplicación;
- teach-back;
- mixed retrieval;
- caso nuevo.

Puede evaluar el mismo conocimiento, pero la actividad debe ser genuinamente nueva.

LÍMITE DE ESTA FASE

No trabajes todavía en:

- avgTurnsPerMicro;
- repairSuccessRate;
- mass simulation;
- optimización pedagógica general;
- prefetch;
- banco completo;
- estilos visuales no relacionados;
- deploy.

VALIDACIÓN FINAL OBLIGATORIA

Ejecuta exactamente:

npx tsc --noEmit
npm run test:e2e
git diff --check

Condición obligatoria de salida:

- TypeScript PASS
- Playwright 33/33 PASS
- 0 skipped
- ningún retry ocultando inestabilidad
- git diff --check PASS
- PHASE_2_E2E_FIXES_REPORT.md completo

Si no consigues 33/33:

- no afirmes que terminaste;
- deja el estado real en el reporte;
- identifica cada fallo pendiente;
- no avances a otra fase;
- no hagas commit;
- no hagas deploy.

Detente al terminar esta misión.
