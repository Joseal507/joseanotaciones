Trabaja únicamente dentro de:

/Users/joseal/studyal

# STUDYAL ADAPTIVE V3 — FASE 5
# RECORRIDOS VISUALES COMPLETOS CON MATERIALES REALES

## Estado validado de entrada

Está confirmado:

- npx tsc --noEmit: PASS
- npm run test:e2e: 33/33 PASS
- npm run test:e2e:real-materials: 10/10 PASS
- git diff --check: PASS
- ingesta real local: estable
- aislamiento entre materiales: PASS
- OpenRouter no participa en el flujo E2E real
- false mastery en simulación: 0
- invariant failures: 0
- infinite loops: 0
- restore divergences: 0
- required coverage en programas completos: 100%
- sin commit
- sin deploy

No rompas ningún resultado anterior.

## Misión única

Construir y ejecutar recorridos visuales completos con Playwright usando materiales reales:

1. niels bohr.pdf
2. Documento_Matematico_Calculo.docx
3. Documento_Medico_Cardiovascular.docx

La fase debe demostrar, mediante UI real y estado pedagógico canónico, que StudyAL puede:

- ingerir el documento;
- construir el programa;
- abrir el libro canónico;
- ejecutar sesiones;
- responder actividades;
- adaptarse a respuestas correctas e incorrectas;
- entrar en repair;
- persistir refresh;
- persistir salir y volver;
- cubrir todos los micros requeridos;
- dominar únicamente con Mastery Contracts;
- mantener unresolved cuando corresponda;
- finalizar únicamente con isProgramComplete === true.

No pruebes únicamente rutas API.
No pruebes únicamente simulación engine-only.
Debe existir recorrido visual Playwright real.

## Materiales obligatorios

Los fixtures existen en:

tests/fixtures/real-materials/

Usa exactamente:

- tests/fixtures/real-materials/niels bohr.pdf
- tests/fixtures/real-materials/Documento_Matematico_Calculo.docx
- tests/fixtures/real-materials/Documento_Medico_Cardiovascular.docx

No modifiques esos archivos.

## Restricciones absolutas

- No hagas commit.
- No hagas deploy.
- No uses git reset.
- No uses git clean.
- No uses git checkout.
- No uses git restore.
- No uses git stash.
- No reviertas cambios acumulados.
- No borres fixtures.
- No cambies los documentos.
- No debilites Mastery Contracts.
- No reduzcas mínimos de evidencia.
- No conviertas coverage en mastery.
- No conviertas fuse en mastery.
- No conviertas sessionComplete en programComplete.
- No marques tests como skip, fixme u only.
- No elimines assertions.
- No uses retries para esconder inestabilidad.
- No aumentes timeouts sin demostrar que el trabajo real necesita más tiempo.
- No hardcodees resultado final por nombre de archivo.
- No hardcodees mastery por microId.
- No hardcodees respuestas correctas por questionId.
- No fabriques program_complete.
- No uses OpenRouter.
- No uses servicios de pago.
- No hagas llamadas LLM externas no deterministas dentro de la matriz.
- No avances a producción.
- No cambies diseño visual salvo que un test rojo pruebe un bug real.
- Distingue bugs del producto de bugs del arnés.

## Qué capa debe ser real

Debe ser real:

- archivo fixture;
- upload;
- bytes;
- extracción;
- identidad del material;
- contenido extraído;
- grafo usado por el recorrido;
- requiredMicroIds;
- libro canónico;
- componentes reales de sesión;
- interacción UI;
- persistencia local;
- evaluación y evidencia;
- mastery;
- repair;
- cierre.

Puede ser determinista:

- respuestas del tutor;
- banco de actividades;
- perfil automatizado del estudiante;
- latencia;
- orden reproducible de las respuestas.

Si una respuesta del tutor está mocked:

- debe estar basada en el contenido y grafo extraído del material real;
- no puede reemplazar el documento por un tema inventado;
- debe documentarse;
- no puede marcar mastery directamente;
- debe pasar por el motor pedagógico real.

## Lee completo antes de editar

- AGENTS.md
- ADAPTIVE_ACCEPTANCE_CONTRACT.md
- PHASE_2_E2E_FIXES_REPORT.md
- PHASE_3_PEDAGOGICAL_ENGINE_REPORT.md
- PHASE_4_REAL_MATERIALS_E2E_REPORT.md
- playwright.config.ts
- playwright.real-materials.config.ts
- tests/e2e/
- tests/e2e-real-materials/
- app/e2e-adaptive/
- app/e2e-real-materials/
- app/api/e2e-real-materials/
- components/materias/StudyALProcess.tsx
- components/materias/adaptive/IntroSession.tsx
- components/materias/adaptive/v3/StudyALSessionV3.tsx
- components/materias/adaptive/v3/PaginatedBookPage.tsx
- components/materias/adaptive/AdaptiveSessionComplete.tsx
- app/api/adaptive/generate-program/route.ts
- app/api/adaptive/v3/tutor/route.ts
- lib/adaptive/v3/
- scripts/simulation/
- scripts/tests/
- package.json

## Inspección inicial obligatoria

Antes de editar ejecuta:

git status --short
git diff --stat
git diff --check
npx tsc --noEmit
npm run test:e2e
npm run test:e2e:real-materials

Documenta baseline en:

PHASE_5_REAL_SESSIONS_E2E_REPORT.md

## Nueva matriz

Crea una matriz separada:

tests/e2e-real-sessions/

Crea una configuración separada:

playwright.real-sessions.config.ts

Añade un script:

test:e2e:real-sessions

No mezcles inicialmente estos tests con los 33 originales.
No cambies el significado de test:e2e.
No cambies test:e2e:real-materials.

## Ruta o harness

Crea o reutiliza un harness E2E que monte el producto real con:

- material real ya extraído;
- grafo real o derivado determinísticamente del texto real;
- programa adaptativo real;
- sesión real;
- tutor determinista;
- estado observable únicamente para pruebas.

No dupliques la lógica del producto.

El harness puede exponer atributos test-only como:

- data-material-id
- data-session-id
- data-required-count
- data-studied-count
- data-mastered-count
- data-unresolved-count
- data-is-session-complete
- data-is-program-complete
- data-close-reason
- data-interaction-id
- data-question-id
- data-fact-key
- data-objective
- data-strategy
- data-format
- data-assistance-level
- data-interaction-phase

No muestres IDs técnicos al usuario visual.
Los atributos test-only son aceptables.

## Perfiles visuales obligatorios

### 1. Capable

Comportamiento:

- responde correctamente;
- usa poca o ninguna ayuda;
- confianza razonable;
- debe progresar eficientemente;
- debe alcanzar program_complete cuando satisface contratos.

### 2. Misconception prone

Comportamiento:

- comete errores consistentes;
- reporta confianza alta en al menos un error;
- debe detectar ilusión;
- debe cambiar estrategia;
- debe entrar en repair;
- posteriormente responde correctamente con evidencia nueva;
- debe poder alcanzar mastery si cumple contratos.

### 3. Assistance dependent

Comportamiento:

- pide pistas;
- usa respuesta revelada al menos una vez;
- puede responder correctamente después;
- no debe dominar mientras la evidencia requerida siga asistida;
- debe requerir evidencia independiente posterior;
- puede terminar valid_incomplete si no la obtiene.

### 4. Low confidence

Comportamiento:

- responde correctamente;
- reporta confianza baja;
- no debe ser castigado como error;
- debe recibir consolidación o verificación apropiada;
- no debe entrar en repair innecesario.

### 5. Random guesser

Comportamiento:

- responde al azar o incorrectamente;
- puede acertar accidentalmente;
- false mastery debe permanecer en 0;
- debe terminar valid_incomplete si no satisface contratos.

## Recorridos obligatorios

# A. NIELS BOHR

## A1 — capable completo

Debe:

- cargar niels bohr.pdf;
- generar grafo del material correcto;
- completar introducción una sola vez;
- entrar al libro canónico;
- iniciar sesiones reales;
- responder hasta cubrir todos los requiredMicroIds;
- usar final review;
- no repetir questionId;
- no repetir factKey sin intención;
- terminar con:
  - isProgramComplete = true
  - masteryPercent = 100
  - coveragePercent = 100
  - unresolvedMicroIds = []
- todos los micros dominados deben pasar isMicroMastered.

## A2 — misconception prone

Debe:

- fallar con alta confianza;
- mostrar feedback;
- detectar repair;
- cambiar estrategia;
- no repetir actividad literalmente;
- conseguir evidencia independiente posterior;
- alcanzar program_complete o valid_incomplete honesto.

## A3 — refresh y salir/volver

Durante Niels Bohr:

- refresh en answering;
- refresh en feedback;
- refresh en collecting_confidence;
- salir al libro;
- volver a estudiar;
- conservar:
  - interactionId;
  - questionId;
  - fase;
  - respuesta;
  - feedback;
  - confianza;
  - sesión;
  - material.

# B. DOCUMENTO MATEMÁTICO

## B1 — capable completo

Debe:

- cargar Documento_Matematico_Calculo.docx;
- extraer contenido;
- generar actividades matemáticas;
- renderizar fórmulas;
- no mostrar LaTeX crudo;
- no duplicar fórmulas;
- aceptar equivalencia numérica;
- aceptar unidades compatibles cuando corresponda;
- no revelar la respuesta en la pregunta;
- usar evidencia procedural/applied/transfer cuando el contrato lo exige;
- terminar program_complete solo si satisface mastery.

## B2 — assistance dependent

Debe:

- usar pista;
- usar asistencia;
- recibir correcta asistida;
- no obtener mastery por esa evidencia;
- luego recibir actividad nueva;
- requerir acierto independiente;
- terminar:
  - program_complete si logra independencia;
  - valid_incomplete si no la logra.

# C. DOCUMENTO MÉDICO

## C1 — capable completo

Debe:

- cargar Documento_Medico_Cardiovascular.docx;
- mantener contenido limitado al documento;
- generar preguntas conceptuales;
- generar aplicación clínica basada únicamente en el texto;
- no inventar diagnósticos o datos externos;
- incluir integración o aplicación;
- completar programa con mastery real.

## C2 — low confidence

Debe:

- responder correctamente con confianza baja;
- conservar evidencia correcta;
- no detectar ilusión;
- no entrar en repair únicamente por baja confianza;
- ajustar el siguiente paso de forma apropiada.

## C3 — random guesser

Debe:

- cometer errores;
- no alcanzar false mastery;
- no cerrar programa;
- terminar valid_incomplete con unresolved;
- coverage puede llegar a 100, pero programComplete debe seguir false.

## Contrato de cobertura completa

Para cada recorrido:

captura:

- requiredMicroIds;
- introducedMicroIds;
- studiedMicroIds;
- masteredMicroIds;
- unresolvedMicroIds;
- processedMicroIds;
- repairMicroIds.

Assertions obligatorias:

1. Ningún requiredMicroId desaparece.
2. Todos los requiredMicroIds terminan en mastered o unresolved.
3. mastered y unresolved son disjuntos.
4. Cada mastered pasa isMicroMastered.
5. Un unresolved nunca aparece como mastered.
6. coveragePercent = 100 no implica programComplete.
7. programComplete implica:
   - masteryPercent = 100;
   - unresolved vacío;
   - todos required mastered.
8. sessionComplete no implica programComplete.
9. fuse no implica mastery.
10. repair conserva evidencia histórica.

## Contrato de adaptación visible

Después de respuesta correcta:

debe cambiar al menos una dimensión válida cuando corresponde:

- objetivo;
- formato;
- dificultad;
- contexto;
- evidencia;
- micro;
- integración;
- transferencia.

Después de respuesta incorrecta:

debe cambiar:

- estrategia;
- representación;
- ejemplo;
- formato;
- dificultad;
- ayuda;
- evidencia objetivo.

No basta cambiar questionId.

Playwright debe comprobar data-strategy, data-format, data-objective o metadata equivalente.

## Contrato de anti-repetición

Durante cada recorrido:

- questionId no se repite;
- prompt normalizado no se repite;
- factKey no se repite salvo repetitionIntent explícito;
- final review no repite literalmente;
- repair no reutiliza actividad exacta.

Registra el historial de cada recorrido.

## Contrato de sesiones

Comprueba:

- número de sesiones coherente con micros y setup;
- ninguna sesión vacía;
- no aparecen sesiones 8/2/1 por corrupción de restore;
- una sesión puede variar en tamaño por razón pedagógica;
- restore no modifica assignedMicroIds;
- cada sesión usa únicamente micros del material activo;
- no hay contaminación Bohr/Matemático/Médico.

## Límites

Para evitar loops:

- máximo de sesiones por recorrido;
- máximo de interacciones por micro;
- máximo de turnos totales;
- máximo de repairs;
- si se agota el presupuesto:
  - resultado valid_incomplete;
  - unresolved preservados;
  - nunca fabricar mastery.

No aumentes límites para forzar program_complete.

## Screenshots y artefactos

Guarda screenshots estables por recorrido:

- upload;
- libro inicial;
- primera sesión;
- primera pregunta;
- feedback;
- confianza;
- repair;
- resumen;
- libro actualizado;
- cierre final o valid_incomplete.

Configura:

- trace on-first-retry o retain-on-failure;
- video retain-on-failure;
- screenshot only-on-failure.

No uses retries como condición de éxito.
Retries debe permanecer 0.

## Reporte obligatorio

Crea:

PHASE_5_REAL_SESSIONS_E2E_REPORT.md

Incluye:

## 1. Arquitectura de prueba

- capa real;
- capa determinista;
- qué está mocked;
- qué no está mocked.

## 2. Materiales

Por cada material:

- nombre;
- formato;
- bytes;
- extracción;
- chars;
- microconceptos;
- required count;
- sesiones;
- páginas cuando aplique.

## 3. Recorridos

Por cada material/perfil:

- estado final;
- turnos;
- sesiones;
- repairs;
- strategy changes;
- assistance max;
- independent successes;
- coverage;
- mastery;
- unresolved;
- isProgramComplete;
- false mastery;
- repeated questionIds;
- repeated factKeys;
- repeated prompts.

## 4. Bugs encontrados

- ID;
- material;
- perfil;
- capa;
- causa raíz;
- test rojo;
- fix;
- test verde.

## 5. Validación final

- TypeScript;
- unit;
- Bohr;
- smoke;
- deterministic;
- mass 1000;
- original E2E;
- real-material ingestion;
- real-session E2E;
- diff check.

## Clasificación de resultados

Cada recorrido debe terminar como uno de:

- program_complete
- valid_incomplete
- product_bug
- harness_bug
- extraction_failure
- environment_blocked

No fabriques PASS.

## Proceso obligatorio

1. Diseña la matriz.
2. Escribe tests rojos.
3. Ejecuta tests específicos.
4. Diagnostica causa raíz.
5. Aplica fix mínimo.
6. Ejecuta test específico verde.
7. Ejecuta grupo relacionado.
8. Ejecuta matriz completa.
9. Ejecuta regresiones anteriores.
10. Documenta.

No hagas un refactor grande antes de tener tests rojos.

## Validaciones finales obligatorias

Ejecuta exactamente:

npx tsc --noEmit
npm run test
npm run test:adaptive-v3-bohr
npm run simulate:v3:smoke
npm run simulate:v3:deterministic
npm run simulate:v3:mass -- 1000
npm run test:e2e
npm run test:e2e:real-materials
npm run test:e2e:real-sessions
git diff --check

Ejecuta build si el entorno lo permite:

npm run build

Si build falla solo por Google Fonts/red:

- documenta el error;
- no lo clasifiques como bug adaptativo;
- no cambies fuentes en esta fase.

## Condición de salida

Solo declara Fase 5 completada si:

- TypeScript PASS;
- suite general PASS;
- Bohr PASS;
- smoke PASS;
- deterministic PASS;
- mass 1000 PASS;
- original E2E 33/33 PASS;
- ingesta real 10/10 PASS;
- real sessions PASS;
- cero false mastery;
- cero loops;
- cero restore divergences;
- cero cierres sin engine;
- cero required micros perdidos;
- Niels capable program_complete;
- Matemático capable program_complete;
- Médico capable program_complete;
- random guesser no domina falsamente;
- assistance dependent no domina solo por ayuda;
- refresh y salir/volver funcionan;
- final review no repite;
- reporte completo;
- git diff --check PASS;
- sin commit;
- sin deploy.

Si no alcanza algún recorrido:

- no declares éxito;
- conserva resultado real;
- documenta causa;
- no avances a producción;
- no hagas commit;
- no hagas deploy.

Detente al finalizar esta misión.
