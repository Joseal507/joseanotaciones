Trabaja únicamente dentro de:

/Users/joseal/studyal

# STUDYAL ADAPTIVE V3 — FASE 5B
# CORRECCIÓN DE LOS DOS RECORRIDOS NIELS BOHR

## Estado confirmado

Todas estas validaciones están verdes:

- npx tsc --noEmit: PASS
- npm run test: PASS
- npm run test:adaptive-v3-bohr: 42/42 PASS
- npm run simulate:v3:smoke: PASS
- npm run simulate:v3:deterministic: 22/22 escenarios
- npm run simulate:v3:mass -- 1000: PASS
- npm run test:e2e: 33/33 PASS
- npm run test:e2e:real-materials: 10/10 PASS
- git diff --check: PASS
- false mastery: 0

La nueva matriz de sesiones reales quedó:

- 8 tests
- 6 PASS
- 2 FAIL

Fallan únicamente:

1. niels bohr.pdf · capable
2. niels bohr.pdf · misconception_prone

Estado observado en ambos:

- data-required-count="3"
- data-studied-count="3"
- data-mastered-count="0"
- data-unresolved-count="3"
- data-coverage-percent="100"
- data-mastery-percent="0"
- data-is-session-complete="true"
- data-is-program-complete="false"
- interaction phase="summary"

El test esperaba programComplete=true.

## Misión única

Determinar con evidencia por qué los recorridos Niels Bohr llegan a:

coverage 100%
mastery 0%
programComplete false

y corregir la causa mínima correcta.

La salida válida puede ser una de estas:

A. El perfil capable satisface los Mastery Contracts y termina program_complete.

B. El perfil misconception_prone se recupera mediante repair y termina program_complete.

C. Si un perfil no satisface realmente los contratos, el test debe esperar valid_incomplete, pero únicamente si el recorrido fue diseñado honestamente para no reunir evidencia suficiente.

No fabriques program_complete.
No cambies Mastery Contracts.
No conviertas coverage en mastery.

## Restricciones absolutas

- No hagas commit.
- No hagas deploy.
- No uses git reset.
- No uses git clean.
- No uses git checkout.
- No uses git restore.
- No uses git stash.
- No reviertas cambios acumulados.
- No reduzcas requisitos de mastery.
- No añadas mastery manual.
- No marques micros mastered por perfil.
- No hardcodees un resultado final por nombre de material.
- No hardcodees masteredMicroIds.
- No cambies isProgramComplete.
- No conviertas sessionComplete en programComplete.
- No uses skip, fixme, only ni retries.
- No elimines assertions fuertes.
- No aumentes límites solo para forzar complete.
- No cambies el documento niels bohr.pdf.
- No uses OpenRouter.
- No modifiques suites verdes no relacionadas.
- Distingue bug del producto y bug del arnés.

## Lee completo antes de editar

- AGENTS.md
- ADAPTIVE_ACCEPTANCE_CONTRACT.md
- PHASE_3_PEDAGOGICAL_ENGINE_REPORT.md
- PHASE_4_REAL_MATERIALS_E2E_REPORT.md
- PHASE_5_REAL_SESSIONS_E2E_REPORT.md
- tests/e2e-real-sessions/real-sessions.spec.ts
- playwright.real-sessions.config.ts
- app/e2e-real-sessions/
- app/api/e2e-real-sessions/
- app/e2e-adaptive/
- components/materias/StudyALProcess.tsx
- components/materias/adaptive/v3/StudyALSessionV3.tsx
- lib/adaptive/v3/engine/evidenceEngine.ts
- lib/adaptive/v3/engine/masteryContracts.ts
- lib/adaptive/v3/engine/objectiveSelector.ts
- lib/adaptive/v3/engine/stateMachine.ts
- lib/adaptive/v3/graph/orchestrator.ts
- lib/adaptive/v3/types.ts
- scripts/tests/adaptive-v3-bohr-regression.ts

Inspecciona los artefactos de ambos fallos:

- reports/playwright-real-sessions-artifacts/real-sessions-niels-bohr-pdf-·-capable-chromium/
- reports/playwright-real-sessions-artifacts/real-sessions-niels-bohr-pdf-·-misconception-prone-chromium/

Revisa:

- error-context.md
- screenshots
- video
- trace.zip
- secuencia de requests
- metadata de cada interacción
- evidencia creada por micro
- cambios de estrategia
- repairs
- cierre de sesiones

## Preguntas obligatorias que debes responder antes de editar

1. ¿Por qué el harness usa required-count=3 si la regresión canónica de Bohr contiene 9 micros?
2. ¿Esos 3 micros son:
   - una selección real;
   - un grafo reducido para E2E;
   - un truncamiento accidental;
   - un fallback?
3. ¿Qué cognitiveType tiene cada micro?
4. ¿Qué exige el MasteryContract de cada uno?
5. ¿Qué evidencias exactas se registraron?
6. ¿Cuántos éxitos independientes hubo por tipo?
7. ¿Qué assistanceLevel tuvo cada evidencia?
8. ¿Por qué mastered-count permanece 0?
9. ¿El recorrido terminó por:
   - fusible;
   - límite de sesión;
   - falta de repair;
   - resumen prematuro;
   - evidencia incorrecta;
   - estrategia que nunca produce el tipo requerido?
10. ¿El test espera program_complete sin haber conducido suficiente evidencia?
11. ¿El perfil misconception_prone recibe reparación real o solo una vuelta superficial?
12. ¿El final review produce evidencia contractual o solo contenido visual?

Documenta las respuestas en el reporte antes del fix.

## Clasificación obligatoria

Clasifica cada fallo como:

A. Bug del arnés:
- el perfil automatizado no ejecuta las interacciones necesarias;
- el test espera complete sin reunir evidencia;
- el harness usa un grafo artificial mal definido;
- el resumen se fuerza desde el test.

B. Bug real del producto:
- evidencia válida no se registra;
- tipos requeridos nunca pueden generarse;
- repair no se abre;
- la sesión se cierra antes de tiempo;
- el selector queda atrapado;
- restore pierde evidencia;
- isMicroMastered recibe un perfil incorrecto.

C. Contrato ambiguo:
- no está definido si el E2E debe usar 3 o 9 micros;
- no está definido qué significa complete en un benchmark reducido.

## Contrato del grafo Bohr

La regresión existente afirma:

- niels bohr.pdf tiene 9 micros canónicos;
- no hay contaminación con Falcons.

No asumas que el harness real debe usar necesariamente los 9, pero debes justificarlo.

Regla:

- Si el recorrido se llama “material real completo”, debe usar todos los required micros del grafo real.
- Si usa una muestra de 3, el test y reporte deben llamarla explícitamente “subset benchmark”, no “programa completo del material”.
- Nunca presentes 3/3 como 100% del material si el grafo real tiene 9 required micros.

Preferencia:

Usar el grafo real completo de Bohr si el tiempo de ejecución sigue siendo razonable.

Si el grafo reducido existe únicamente para mantener la prueba corta:
- conserva una prueba subset separada;
- añade al menos una prueba de cobertura de los 9 micros;
- documenta qué valida cada una.

## Contrato del perfil capable

El recorrido capable debe:

- usar asistencia independent;
- responder correctamente;
- producir los tipos de evidencia exigidos;
- no repetir la misma evidencia;
- pasar por integración/transferencia cuando el contrato lo requiere;
- continuar a repair si queda unresolved;
- terminar program_complete únicamente si todos los required micros pasan isMicroMastered.

No basta con una respuesta correcta por micro.

La automatización debe consultar metadata de la actividad y responder correctamente según el formato, sin hardcodear questionIds.

Puede usar una respuesta canónica provista por el tutor determinista, pero:
- no debe escribir mastery directamente;
- no debe saltarse evaluación;
- no debe alterar evidenceProfile manualmente.

## Contrato misconception_prone

El recorrido debe:

1. cometer al menos un error con confianza alta;
2. registrar ilusión de conocimiento;
3. recibir cambio real de estrategia;
4. entrar en repair;
5. recibir una nueva actividad;
6. responder correctamente sin ayuda suficiente para producir evidencia válida;
7. completar únicamente si satisface Mastery Contracts.

Si el recorrido solo falla y luego llega a summary con unresolved, el resultado correcto es valid_incomplete, no program_complete.

Pero si la misión original exige recuperación, el arnés debe ejecutar la reparación necesaria.

## Investiga resumen prematuro

El estado final muestra:

interaction-phase="summary"
isSessionComplete=true
isProgramComplete=false

Eso puede ser correcto si hay unresolved.

Comprueba si el harness:

- termina la prueba al primer summary;
- no pulsa “Continuar con repair”;
- no vuelve al libro;
- no inicia la sesión de repair;
- no recorre sesiones posteriores;
- confunde session summary con program summary.

El recorrido completo debe seguir hasta:

- program_complete;
- o presupuesto máximo agotado y valid_incomplete.

No debe detenerse simplemente porque apareció un summary de sesión.

## Reparación probable

Si la causa es que el harness se detiene en el primer summary:

- añade un runner que lea:
  - isSessionComplete;
  - isProgramComplete;
  - unresolved count;
  - repair availability;
- si programComplete=false y hay unresolved:
  - vuelve al libro;
  - abre la siguiente sesión o repair;
  - continúa;
- detente solo cuando:
  - isProgramComplete=true;
  - no exista sesión/repair válida;
  - se alcance presupuesto explícito.

No hagas un loop infinito.
Usa límites claros.

## Telemetría obligatoria del recorrido

Expón y registra por micro:

- evidence types;
- strengths;
- assistance levels;
- independent successes;
- mastery score;
- mastery contract;
- missing evidences;
- resolution status;
- total interactions;
- fuse reason.

No es necesario mostrarlo al usuario.
Puede estar en atributos test-only o endpoint de diagnóstico.

## Tests rojos y verdes

Antes de corregir, crea o ajusta tests para demostrar:

1. Bohr capable no termina al primer session summary.
2. Si quedan unresolved, se abre repair o siguiente sesión.
3. Capable puede reunir evidencia suficiente por micro.
4. Misconception prone cambia estrategia después del error.
5. Misconception prone entra en repair.
6. No se marca complete con mastery 0.
7. El recorrido termina solo por:
   - program_complete;
   - valid_incomplete con presupuesto agotado.
8. Si el benchmark usa 9 micros, required-count=9.
9. Si usa subset, su nombre y assertions no afirman material completo.

No cambies el test para esperar true sin demostrar mastery.

## Proceso obligatorio

1. Ejecuta únicamente los dos tests Bohr y confirma rojo.
2. Inspecciona evidencia y flujo.
3. Escribe diagnóstico en PHASE_5_REAL_SESSIONS_E2E_REPORT.md.
4. Añade test rojo de la causa raíz.
5. Aplica fix mínimo.
6. Ejecuta Bohr capable.
7. Ejecuta Bohr misconception_prone.
8. Ejecuta los 8 real-session tests.
9. Ejecuta 10 real-material tests.
10. Ejecuta 33 E2E originales.
11. Ejecuta TypeScript.
12. Ejecuta git diff --check.
13. Documenta resultados.

## Reporte

Actualiza:

PHASE_5_REAL_SESSIONS_E2E_REPORT.md

Añade:

## Fase 5B — Niels Bohr

Incluye:

- clasificación de cada fallo;
- grafo real vs subset;
- required micros usados;
- MasteryContract por micro;
- evidencias antes del fix;
- causa de mastered=0;
- número de sesiones;
- número de repairs;
- cambios de estrategia;
- evidencia después del fix;
- estado final capable;
- estado final misconception_prone;
- por qué programComplete es verdadero o falso;
- test rojo;
- test verde;
- archivos modificados.

## Validación final exacta

npx tsc --noEmit

npx playwright test \
  --config=playwright.real-sessions.config.ts \
  tests/e2e-real-sessions/real-sessions.spec.ts \
  --grep "niels bohr.pdf · capable"

npx playwright test \
  --config=playwright.real-sessions.config.ts \
  tests/e2e-real-sessions/real-sessions.spec.ts \
  --grep "niels bohr.pdf · misconception_prone"

npm run test:e2e:real-sessions
npm run test:e2e:real-materials
npm run test:e2e
git diff --check

## Condición de salida

Solo declara éxito si:

- TypeScript PASS;
- Bohr capable PASS;
- Bohr misconception_prone PASS;
- real sessions 8/8 PASS;
- real materials 10/10 PASS;
- original E2E 33/33 PASS;
- git diff --check PASS;
- cero false mastery;
- cero skipped;
- cero retries;
- no se cierra con mastery 0;
- unresolved inicia repair cuando corresponde;
- program_complete solo ocurre por mastery contractual;
- sin commit;
- sin deploy.

Si uno de los perfiles termina honestamente valid_incomplete:
- el test debe demostrar por qué;
- no puede contradecir la misión original sin documentarlo;
- no fabriques complete;
- no avances a producción.

Detente al finalizar.
