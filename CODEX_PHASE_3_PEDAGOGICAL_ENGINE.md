Trabaja únicamente dentro de:

/Users/joseal/studyal

ESTADO VALIDADO DE ENTRADA

La Fase 2 está cerrada y comprobada manualmente:

- npx tsc --noEmit: PASS
- npm run test:e2e: 33/33 PASS
- Playwright failed: 0
- Playwright skipped: 0
- git diff --check: PASS

No rompas esos 33 tests.

MISIÓN ÚNICA

Validar y corregir el comportamiento pedagógico del modo adaptativo mediante:

test determinista rojo
→ diagnóstico de causa raíz
→ cambio mínimo correcto
→ test determinista verde
→ simulación por perfiles
→ regresión completa

No hagas commit ni deploy.

OBJETIVOS PEDAGÓGICOS OBLIGATORIOS

La fase solo está completa cuando se demuestre:

1. Perfiles capable:
   avgTurnsPerMicro <= 12

2. Perfiles recoverable:
   repairSuccessRate >= 60%

3. Fallos repetidos:
   strategyChangeAfterRepeatedFailure >= 80%

4. Perfiles adversarial:
   false mastery = 0

5. Cobertura:
   required coverage = 100% para programas terminados

6. Cierre:
   ningún programa termina sin isProgramComplete === true

7. Dominio:
   ningún fusible, cobertura, cantidad de turnos ni sesión completada fabrica mastery

RESTRICCIONES ABSOLUTAS

- No hagas commit.
- No hagas deploy.
- No uses git reset.
- No uses git clean.
- No uses git checkout.
- No uses git restore.
- No uses git stash.
- No reviertas cambios acumulados.
- No borres trabajo existente.
- No debilites Mastery Contracts.
- No reduzcas mínimos de evidencia solo para mejorar métricas.
- No cambies thresholds canónicos sin evidencia pedagógica explícita.
- No hagas que coveragePercent implique mastery.
- No hagas que fused implique mastery.
- No hagas que completed implique mastery.
- No cambies tests para esconder bugs.
- No elimines assertions.
- No uses skip, fixme ni only.
- No aumentes límites de turnos para ocultar loops.
- No cambies perfiles simulados para facilitar resultados.
- No hardcodees respuestas por perfil.
- No hardcodees resultados esperados por questionId.
- No hagas que el simulador mienta sobre la salida del producto.
- Distingue bugs del producto de bugs del arnés.
- Conserva 33/33 Playwright.

LEE COMPLETO ANTES DE EDITAR

- AGENTS.md
- ADAPTIVE_ACCEPTANCE_CONTRACT.md
- PHASE_1_E2E_MATRIX_REPORT.md
- PHASE_2_E2E_FIXES_REPORT.md
- CODEX_PHASE_3_PEDAGOGICAL_ENGINE.md si ya existía antes de esta misión
- package.json
- scripts/simulation/
- scripts/tests/
- todos los tests adaptativos existentes
- todos los archivos lib/adaptive/v3/engine/
- lib/adaptive/v3/types.ts
- lib/adaptive/v3/graph/questionBank.ts
- lib/adaptive/v3/graph/orchestrator.ts
- app/api/adaptive/v3/tutor/route.ts
- components/materias/adaptive/v3/StudyALSessionV3.tsx
- components/materias/StudyALProcess.tsx

MOTORES CANÓNICOS QUE DEBES RESPETAR

- evidenceEngine.ts
- masteryContracts.ts
- confidenceTracker.ts
- memoryEngine.ts
- hypothesisEngine.ts
- misconceptionTracker.ts
- strategyRegistry.ts
- pedagogicalDecision.ts
- objectiveSelector.ts
- stateMachine.ts
- interactionContract.ts
- interactionMachine.ts

ANTES DE EDITAR

Ejecuta y registra:

git status --short
git diff --stat
git diff --check
npx tsc --noEmit
npm run test:e2e
npm run test:adaptive-v3-bohr
npm run simulate:v3:smoke
npm run simulate:v3:deterministic

Después identifica los comandos reales disponibles en package.json para:

- tests adaptativos;
- simulación smoke;
- simulación determinista;
- simulación masiva.

No inventes scripts que no existan sin antes inspeccionar la estructura actual.

CREA EL REPORTE

Crea o reemplaza únicamente el reporte de esta fase:

PHASE_3_PEDAGOGICAL_ENGINE_REPORT.md

Debe contener:

1. Baseline inicial.
2. Métricas por perfil.
3. Tests rojos creados.
4. Causas raíz.
5. Cambios aplicados.
6. Tests verdes.
7. Métricas finales.
8. Regresiones ejecutadas.
9. Limitaciones reales pendientes.

SEGMENTACIÓN OBLIGATORIA

CAPABLE

- expert
- deep_understanding
- strong_beginner

RECOVERABLE

- misconception_prone
- low_confidence
- inconsistent
- assistance_dependent recuperable

ADVERSARIAL

- random_guesser
- answer_repeater
- reveal_dependent
- memorizer_without_transfer

No mezcles resultados de estos grupos para ocultar un segmento malo.

MÉTRICAS OBLIGATORIAS

Mide como mínimo:

- runs por perfil;
- completion por perfil;
- program_complete por perfil;
- false mastery;
- avgTurnsPerMicro;
- máximo de turns por micro;
- teaching turns consecutivos;
- repeated questionIds;
- repeated factKeys;
- repeated normalized prompts;
- evidence diversity;
- strategy change after repeated failure;
- repair attempts;
- repair resolution;
- repairSuccessRate;
- premature fuse;
- unresolved micros;
- required coverage;
- retained mastery;
- restore divergences;
- infinite loops;
- cierre sin isProgramComplete;
- asistencia máxima usada;
- éxitos independientes;
- cambio de actividad después de respuesta correcta;
- cambio de actividad después de respuesta incorrecta.

DEFINICIONES CANÓNICAS

false mastery:

Un micro o programa marcado dominado/completo sin satisfacer Mastery Contracts mediante evidencia válida.

repair success:

Un micro entra a repair como unresolved y posteriormente alcanza mastery contractual mediante evidencia nueva válida.

strategy change after repeated failure:

Tras fallos repetidos sobre el mismo micro, cambia una dimensión pedagógica real:

- estrategia;
- representación;
- formato;
- dificultad;
- ejemplo;
- evidencia objetivo.

Cambiar solo questionId o palabras superficiales no cuenta.

evidence diversity:

La evidencia usada para mastery debe incluir los tipos requeridos por el MasteryContract correspondiente. Repetir la misma pregunta o el mismo tipo no cuenta como diversidad nueva.

premature fuse:

El fusible procesa o abandona un micro antes de ejecutar reparaciones razonables, o lo convierte directa o indirectamente en mastery.

CONTRATOS PEDAGÓGICOS A PROBAR

1. Máximo dos turnos consecutivos de enseñanza.

Después de dos actividades teaching consecutivas debe ocurrir una de estas:

- práctica;
- recuperación;
- discriminación;
- aplicación;
- transferencia;
- evaluación.

No una tercera explicación equivalente.

2. Respuesta correcta cambia el siguiente paso.

Una respuesta correcta no debe generar inmediatamente:

- la misma pregunta;
- el mismo prompt;
- el mismo factKey sin intención;
- la misma evidencia sin necesidad.

Debe:

- aumentar dificultad;
- cambiar evidencia;
- consolidar;
- integrar;
- transferir;
- o avanzar cuando el contrato lo permite.

3. Respuesta incorrecta cambia estrategia.

Tras un fallo, y especialmente tras fallos repetidos, debe cambiar al menos una dimensión real:

- explicación;
- representación;
- ejemplo;
- formato;
- dificultad;
- nivel de ayuda;
- evidencia objetivo.

No basta parafrasear la misma pregunta.

4. Asistencia no fabrica mastery.

- assisted-only bloquea mastery;
- revealed bloquea mastery;
- reveal + retry no equivale a éxito independiente;
- minimal_hint se pondera correctamente;
- debe existir éxito independiente requerido por contrato;
- maxAssistanceLevelUsed se respeta.

5. Ilusión de conocimiento.

Una respuesta incorrecta con confianza alta debe:

- registrar ilusión;
- priorizar reparación;
- cambiar estrategia;
- no aumentar mastery;
- no avanzar como si fuera correcta.

6. Rapid.

En setup rapid:

- no open_response largo;
- no step_by_step largo;
- fill_blank incluye word bank;
- interacciones breves;
- feedback breve;
- formatos compatibles con ritmo rápido;
- no debilitar dominio final.

7. Repair.

- no repetir questionId;
- no repetir prompt normalizado;
- no repetir factKey sin repetitionIntent explícito;
- no repetir exactamente la misma estrategia;
- resolver misconception cuando sea recuperable;
- no eternizar perfiles adversariales;
- no declarar mastery falso.

8. Final review.

Debe usar:

- integración;
- transferencia;
- discriminación;
- comparación;
- aplicación;
- teach-back;
- mixed retrieval;
- caso nuevo.

No repetir literalmente preguntas previas.

9. Fusible.

MAX_INTERACTIONS_PER_MICRO puede marcar unresolved o processedForCurrentSession, pero nunca mastered por sí solo.

10. Cierre de programa.

Solo:

isProgramComplete === true

proveniente del motor pedagógico puede cerrar el programa.

PROCESO TEST ROJO → FIX → VERDE

Antes de optimizar métricas, crea tests deterministas que fallen por los comportamientos reales actuales.

Como mínimo deben existir tests deterministas para:

- máximo dos teaching consecutivos;
- respuesta correcta cambia evidencia o consolida;
- fallo cambia estrategia;
- dos fallos consecutivos fuerzan cambio de estrategia;
- assisted-only no domina;
- reveal no domina;
- false mastery adversarial = 0;
- repair recuperable alcanza mastery;
- questionId no se repite;
- factKey no se repite sin intención;
- final review no es literal;
- rapid respeta formatos;
- fuse no domina;
- cierre requiere isProgramComplete;
- required coverage completa;
- restore no altera decisión;
- no loop infinito.

Para cada contrato:

1. confirma test rojo;
2. identifica causa raíz;
3. aplica fix mínimo;
4. confirma test verde;
5. ejecuta tests relacionados;
6. documenta.

No escribas primero una reestructuración amplia.

SIMULACIÓN

Primero usa pocas corridas deterministas para depurar.

Después usa una cantidad suficiente para que las métricas sean representativas.

Como mínimo:

- smoke para todos los perfiles;
- deterministic para todos los contratos;
- mass simulation final con 1000 runs si el script actual lo soporta.

La simulación debe ser reproducible:

- seeds registradas;
- perfiles explícitos;
- métricas calculadas desde eventos reales;
- sin Math.random no controlado en pruebas deterministas.

No declares éxito con una sola seed favorable.

REGLA SOBRE EL ARNÉS

Si detectas un bug del simulador:

- demuéstralo con test;
- corrige el arnés sin cambiar la conducta esperada;
- documenta por qué era bug del arnés;
- vuelve a ejecutar baseline antes de atribuir mejora al producto.

El arnés no puede:

- marcar repair success sin mastery contractual;
- inferir strategy change solo por questionId;
- contar coverage como mastery;
- omitir perfiles fallidos;
- descartar runs incompletos;
- cambiar respuestas del perfil para favorecer el motor.

PRIORIDAD DE CORRECCIÓN

1. false mastery e invariantes.
2. loops y cierre incorrecto.
3. respuesta del estudiante influye próxima actividad.
4. strategy change after failure.
5. repair resolution.
6. teaching consecutivo.
7. eficiencia capable.
8. rapid.
9. métricas y reporte.

No sacrifiques seguridad pedagógica por bajar turnos.

CONDICIONES FINALES

Objetivos duros:

- Playwright: 33/33 PASS
- TypeScript: PASS
- false mastery: 0
- invariant failures: 0
- restore divergences: 0
- infinite loops: 0
- cierre sin isProgramComplete: 0
- required coverage de programas completos: 100%
- capable avgTurnsPerMicro <= 12
- recoverable repairSuccessRate >= 60%
- strategyChangeAfterRepeatedFailure >= 80%

Si los objetivos de eficiencia o repair no se alcanzan sin debilitar contratos:

- no debilites contratos;
- no afirmes éxito;
- deja métricas reales;
- documenta la causa;
- detente sin commit ni deploy.

VALIDACIÓN FINAL OBLIGATORIA

Ejecuta al final, usando los scripts reales existentes:

npx tsc --noEmit
npm run test
npm run test:adaptive-v3-bohr
npm run simulate:v3:smoke
npm run simulate:v3:deterministic
npm run simulate:v3:mass -- 1000
npm run test:e2e
git diff --check

Si algún script no existe exactamente:

- inspecciona package.json;
- usa el comando equivalente real;
- documenta la sustitución;
- no omitas esa categoría de validación.

CONDICIÓN DE SALIDA

Solo declara la Fase 3 completada si:

- todas las validaciones obligatorias pasan;
- Playwright sigue 33/33;
- objetivos pedagógicos duros alcanzados;
- cero false mastery;
- reporte completo;
- ningún test debilitado;
- ningún commit;
- ningún deploy.

Si no se alcanza:

- declara estado incompleto;
- deja los números reales;
- enumera contratos pendientes;
- no avances a materiales reales ni producción;
- no hagas commit ni deploy.

Detente al terminar esta fase.
