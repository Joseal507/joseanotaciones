Trabaja únicamente dentro de:

/Users/joseal/studyal

ESTADO ACTUAL CONFIRMADO

La ejecución manual real de Playwright quedó en:

- 33 pruebas
- 29 PASS
- 4 FAIL
- 0 skipped
- retries: 0

Los cuatro fallos restantes son:

1. Test 09: Continuar es el único avance.
2. Test 11: nueva pregunta limpia confianza anterior.
3. Test 23: no aparece LaTeX crudo.
4. Test 28: salir y volver conserva la sesión.

MISIÓN ÚNICA

Corregir exclusivamente estos cuatro fallos y llevar Playwright a:

- 33/33 PASS
- 0 FAIL
- 0 skipped
- sin retries usados para esconder inestabilidad

No avances a simulación pedagógica ni a ninguna fase posterior.

RESTRICCIONES ABSOLUTAS

- No hagas commit.
- No hagas deploy.
- No uses git reset.
- No uses git clean.
- No uses git checkout.
- No uses git restore.
- No uses git stash.
- No borres ni reviertas cambios acumulados.
- No sobrescribas archivos completos innecesariamente.
- No debilites Mastery Contracts.
- No cambies isProgramComplete como condición canónica.
- No marques tests como skip, fixme u only.
- No elimines assertions.
- No aumentes timeouts para ocultar fallos.
- No añadas retries.
- No cambies fixtures para evitar probar el comportamiento real.
- No cambies el producto únicamente para complacer un selector incorrecto.
- Conserva todos los cambios anteriores que ya lograron 29 PASS.

ANTES DE EDITAR

Lee completos:

- AGENTS.md
- ADAPTIVE_ACCEPTANCE_CONTRACT.md
- PHASE_1_E2E_MATRIX_REPORT.md
- PHASE_2_E2E_FIXES_REPORT.md
- playwright.config.ts
- tests/e2e/adaptive-interaction.spec.ts
- tests/e2e/adaptive-math.spec.ts
- tests/e2e/adaptive-v3.spec.ts
- tests/e2e/helpers.ts o los helpers relevantes existentes
- app/e2e-adaptive/page.tsx
- components/materias/adaptive/v3/StudyALSessionV3.tsx
- components/materias/adaptive/v3/PaginatedBookPage.tsx
- lib/adaptive/v3/ui/interactionMachine.ts
- lib/adaptive/v3/engine/interactionContract.ts

Inspecciona para los cuatro fallos:

- error-context.md
- screenshots
- videos
- trace.zip

Ubicaciones de artefactos:

- reports/playwright-artifacts/adaptive-interaction-09-Continuar-es-el-único-avance-chromium/
- reports/playwright-artifacts/adaptive-interaction-11-nu-94de1-a-limpia-confianza-anterior-chromium/
- reports/playwright-artifacts/adaptive-math-23-no-aparece-LaTeX-crudo-chromium/
- reports/playwright-artifacts/adaptive-v3-28-salir-y-volver-conserva-la-sesión-chromium/

Ejecuta antes de editar:

git status --short
git diff --stat
git diff --check

Luego confirma los fallos con pruebas específicas.

PROCESO OBLIGATORIO

Para cada causa raíz:

1. Ejecuta el test específico y confirma rojo.
2. Inspecciona trace, screenshot, requests y estado de UI.
3. Explica la causa raíz en el reporte.
4. Aplica el cambio mínimo correcto.
5. Ejecuta el test específico hasta verde.
6. Ejecuta los tests relacionados.
7. Solo después continúa.

No hagas cambios especulativos.

ACTUALIZA EL REPORTE

Actualiza:

PHASE_2_E2E_FIXES_REPORT.md

Añade una sección:

## Fase 2B — cuatro fallos restantes

Para cada fallo documenta:

- causa raíz confirmada;
- evidencia;
- test rojo;
- cambio aplicado;
- archivos modificados;
- test verde;
- posibles regresiones verificadas.

FALLOS 09 Y 11 — CONTINUAR NO MUESTRA Q2

Síntoma confirmado:

Después de pulsar:

data-testid="adaptive-continue"

la UI continúa mostrando:

data-interaction-id="q1"

cuando debe mostrar:

data-interaction-id="q2"

Esto causa directamente:

- fallo 09: no avanza a q2;
- fallo 11: no aparece q2 y por eso tampoco se limpia correctamente la confianza.

Investiga exactamente:

- cómo se construye pendingNextPage;
- cuándo se asigna currentPage;
- si la nueva lógica anti-repetición rechaza q2 por error;
- si usedQuestionIdsRef registra el candidato demasiado pronto;
- si el currentPage inicial se añade dos veces al historial;
- si pendingNextPage queda null;
- si handleContinue llama al tutor cuando ya existe pendingNextPage;
- si handleContinue usa un closure antiguo;
- si una escritura de persistencia vuelve a colocar q1;
- si interactionIdentity se actualiza junto con currentPage;
- si setState ocurre pero un efecto lo sobrescribe;
- si normalizePrompt interpreta dos prompts distintos como iguales;
- si la respuesta de evaluación incluye q2 en un campo diferente;
- si el rechazo anti-repetición deja la interacción actual sin siguiente actividad.

CONTRATO CORRECTO DE CONTINUAR

Antes de pulsar Continuar:

- la evaluación y el feedback permanecen visibles;
- seleccionar confianza no avanza;
- currentPage sigue siendo q1;
- pendingNextPage puede contener q2.

Al pulsar Continuar una sola vez:

1. bloquear doble avance;
2. tomar pendingNextPage válida;
3. establecer currentPage en q2;
4. actualizar interactionIdentity con q2;
5. establecer interactionPhase en answering;
6. limpiar:
   - lastEvaluation, cuando corresponda;
   - showEvaluation;
   - submittedAnswer;
   - selfReportedConfidence;
   - estado visual de confianza;
7. limpiar pendingNextPage;
8. iniciar el timer de la nueva actividad;
9. persistir el snapshot de q2;
10. no volver a q1 por un efecto tardío.

No solicites otra actividad al tutor si q2 ya fue entregada como pendingNextPage válida.

ANTI-REPETICIÓN

No elimines el contrato anti-repetición que hizo pasar 29, 30 y 31.

Corrige su ciclo de vida si es la causa:

- una actividad debe registrarse como usada cuando realmente se acepta/entra al flujo;
- no debe rechazarse a sí misma por haber sido registrada anticipadamente;
- distingue currentPage de nextPage;
- evita insertar dos veces el mismo questionId por llamadas repetidas;
- conserva historial entre sesiones;
- repetitionIntent sigue siendo obligatorio para factKey repetido.

Los tests 29, 30 y 31 deben continuar pasando.

FALLO 28 — SALIR Y VOLVER

Síntoma confirmado:

Antes de salir, después de Continuar, la UI todavía muestra:

q-before-exit

en lugar de:

q-after-continue

Primero corrige el avance q1 → q2. Luego verifica persistencia.

Contrato:

- después de pulsar Continuar, la UI debe mostrar q-after-continue;
- ese snapshot debe persistirse;
- antes de ejecutar la navegación de VOLVER AL LIBRO debe haberse guardado el snapshot más reciente;
- al pulsar Volver a estudiar debe rehidratar q-after-continue;
- no debe llamar al tutor para sustituir la interacción restaurada;
- una escritura antigua de q-before-exit no puede sobrescribir q-after-continue.

Investiga carreras entre:

- useEffect de persistencia;
- cambio de currentPage;
- navegación al libro;
- desmontaje del componente;
- callbacks pendientes;
- persistencia síncrona en localStorage;
- estados React todavía no confirmados al navegar.

Si el guardado mediante useEffect no garantiza orden antes de navegar, crea una función explícita de snapshot que reciba el estado siguiente y persista ese estado antes de ejecutar la navegación. No dependas de esperar que React renderice.

FALLO 23 — LATEX CRUDO

Síntoma:

El DOM visible contiene:

\frac

La actividad mock contiene un bloque:

{
  type: 'formula',
  latex: 'E_n=-\\frac{13.6}{n^2}',
  plain: 'E_n = -13.6/n^2'
}

Contrato correcto:

- nunca mostrar al estudiante comandos crudos como:
  - \frac
  - \sqrt
  - \begin
  - \end
  - $$
- si existe renderer matemático funcional, renderizar la fórmula visualmente;
- si el renderer no está disponible o falla, mostrar únicamente el fallback plain;
- no renderizar a la vez latex y plain;
- no esconder el LaTeX mediante CSS mientras permanece como texto visible/accesible;
- mantener pasando el test 24 de fórmula no duplicada.

Investiga:

- PaginatedBookPage;
- renderer de bloques formula;
- cualquier fallback;
- atributos alt, title, aria-label o texto invisible que Playwright pueda detectar;
- renderizado simultáneo del source LaTeX y del fallback plain.

Aplica el cambio mínimo y correcto.

ORDEN RECOMENDADO

1. Corregir la transición q1 → q2.
2. Ejecutar tests 09 y 11.
3. Ejecutar tests 27–31 para evitar regresiones de persistencia y anti-repetición.
4. Corregir salir/volver.
5. Ejecutar test 28 y test 32.
6. Corregir LaTeX crudo.
7. Ejecutar tests 23–25.
8. Ejecutar toda la matriz.

COMANDOS DE TEST ESPECÍFICOS

Usa comandos equivalentes a:

npx playwright test tests/e2e/adaptive-interaction.spec.ts --project=chromium
npx playwright test tests/e2e/adaptive-v3.spec.ts --project=chromium
npx playwright test tests/e2e/adaptive-math.spec.ts --project=chromium

No uses retries.

VALIDACIÓN FINAL OBLIGATORIA

Cuando los cuatro fallos estén corregidos, ejecuta exactamente:

npx tsc --noEmit
npm run test:e2e
git diff --check

CONDICIÓN DE SALIDA

Solo declara éxito si:

- TypeScript PASS;
- Playwright indica exactamente 33 passed;
- 0 failed;
- 0 skipped;
- retries 0;
- git diff --check PASS;
- tests 29, 30 y 31 continúan pasando;
- PHASE_2_E2E_FIXES_REPORT.md está actualizado.

Si queda aunque sea un fallo:

- no afirmes que terminaste;
- no avances a otra fase;
- documenta el error exacto;
- no hagas commit;
- no hagas deploy.

Detente al terminar.
