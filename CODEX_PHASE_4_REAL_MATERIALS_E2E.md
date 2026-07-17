# StudyAL Adaptive V3 — Fase 4: materiales reales y recorridos visuales

Trabaja únicamente dentro de:

/Users/joseal/studyal

## Estado validado de entrada

La fase anterior quedó validada con:

- TypeScript: PASS
- Suite general: PASS
- Bohr regression: 42/42 PASS
- Playwright: 33/33 PASS
- Simulación masiva: 1000 corridas
- false mastery: 0
- invariant failures: 0
- restore divergences: 0
- infinite loops: 0
- capable avgTurnsPerMicro: 11.9
- recoverable repairSuccessRate: 69%
- strategyChangeAfterRepeatedFailure: 94%
- required coverage en programas completos: 100%
- git diff --check: PASS

No rompas estos resultados.

## Restricciones absolutas

- No hagas commit.
- No hagas deploy.
- No uses git reset.
- No uses git clean.
- No uses git checkout.
- No uses git restore.
- No uses git stash.
- No reviertas cambios acumulados.
- No borres documentos originales.
- No modifiques los materiales fixture.
- No debilites Mastery Contracts.
- No reduzcas mínimos de evidencia.
- No conviertas coverage en mastery.
- No conviertas fuse en mastery.
- No marques tests como skip, fixme u only.
- No elimines assertions para conseguir PASS.
- No aumentes timeouts para ocultar fallos.
- No añadas retries para ocultar inestabilidad.
- No simules visualmente un final que el motor no confirmó.
- No declares aprendizaje del 100% solo porque se llegó a la última sesión.
- No hardcodees resultados por nombre de archivo.
- No hardcodees respuestas correctas por questionId.
- Distingue bugs del producto, bugs del arnés, problemas de extracción y limitaciones del material.

## Materiales reales obligatorios

Están en:

tests/fixtures/real-materials/

Debes utilizar:

1. CLUTCH 1.pdf
2. CLUTCH 2.pdf
3. TAREA CLUTCH 2.pdf
4. TAREA QUIMICA CLUTCH.pdf
5. niels bohr.pdf
6. falcons.pdf
7. Documento_Juridico_Constitucional.docx
8. Documento_Matematico_Calculo.docx
9. Documento_Medico_Cardiovascular.docx

## Objetivo real

Construir y ejecutar una matriz Playwright separada que pruebe el modo adaptativo con materiales reales, desde la carga del documento hasta el cierre o estado incompleto válido.

Debe demostrar visualmente y mediante estado canónico que:

1. El material se carga correctamente.
2. El texto y las fórmulas se extraen.
3. Se genera un grafo correspondiente al material correcto.
4. No hay contaminación entre materiales.
5. Se crea un programa con sesiones coherentes.
6. Todos los microconceptos requeridos entran en cobertura.
7. Las respuestas del estudiante influyen en la siguiente actividad.
8. Los fallos producen reparación real.
9. Refresh conserva la interacción exacta.
10. Salir y volver conserva la sesión más reciente.
11. No se repiten preguntas accidentalmente.
12. Rapid respeta sus formatos.
13. Las fórmulas se renderizan sin LaTeX crudo.
14. Los resúmenes usan nombres humanos.
15. Las sesiones incompletas generan repair.
16. El programa solo termina con isProgramComplete === true.
17. Todos los micros dominados satisfacen Mastery Contracts.
18. Los micros no dominados quedan unresolved, nunca dominados artificialmente.
19. El libro canónico refleja correctamente sesiones completas e incompletas.
20. No aparece ninguna vista adaptive legacy.

## Qué significa estudiar el 100% del material

No significa obligatoriamente que todos los perfiles completen el programa.

Debe distinguirse:

### Cobertura requerida

Todos los requiredMicroIds fueron:

- introducidos;
- enseñados o practicados;
- evaluados;
- dominados o enviados a repair.

### Dominio real

Un micro está dominado únicamente cuando:

isMicroMastered(evidenceProfile, micro) === true

### Programa completo

Únicamente cuando:

isProgramComplete === true

proveniente del motor pedagógico.

Un perfil adversarial puede terminar como valid_incomplete. Eso es correcto si no obtuvo dominio falso.

## Primera etapa: inspección y arquitectura

Antes de editar, lee completos:

- AGENTS.md
- ADAPTIVE_ACCEPTANCE_CONTRACT.md
- PHASE_1_E2E_MATRIX_REPORT.md
- PHASE_2_E2E_FIXES_REPORT.md
- PHASE_3_PEDAGOGICAL_ENGINE_REPORT.md
- playwright.config.ts
- tests/e2e/
- app/e2e-adaptive/
- components/materias/StudyALProcess.tsx
- components/materias/adaptive/v3/StudyALSessionV3.tsx
- components/materias/adaptive/v3/PaginatedBookPage.tsx
- components/materias/adaptive/IntroSession.tsx
- app/api/adaptive/generate-program/route.ts
- app/api/adaptive/v3/tutor/route.ts
- lib/adaptive/v3/
- lógica de upload, extracción y materiales
- package.json

Ejecuta:

git status --short
git diff --stat
git diff --check
npx tsc --noEmit
npm run test:e2e

## No uses servicios externos innecesarios

La matriz debe ser determinista y reproducible.

Si la generación real depende de un LLM externo:

- separa claramente pruebas de extracción real y UI real;
- crea respuestas del tutor deterministas basadas en el grafo realmente extraído;
- no reemplaces el contenido del documento por contenido inventado;
- no llames a una API de pago;
- no uses OpenRouter;
- no ocultes que una parte está mocked;
- documenta exactamente qué capa es real y cuál es determinista.

El documento subido, su extracción, su identidad, su selección de páginas, su persistencia y su navegación sí deben ser reales.

## Directorio de pruebas

Crea una matriz separada, por ejemplo:

tests/e2e-real-materials/

No mezcles estas pruebas con las 33 existentes hasta que sean estables.

Añade un script claro en package.json, por ejemplo:

test:e2e:real-materials

No cambies test:e2e de forma que las 33 pruebas originales dejen de ejecutarse.

## Matriz mínima obligatoria

### Grupo A — Ingesta

Por cada uno de los nueve materiales:

1. El archivo existe.
2. El upload acepta el formato.
3. Se conserva nombre y tipo.
4. La extracción produce contenido no vacío.
5. La extracción no mezcla otro documento.
6. El grafo pertenece al material correcto.
7. Los microconceptos tienen nombres humanos.
8. No aparecen IDs técnicos en la UI.

### Grupo B — Material teórico

Usa:

- niels bohr.pdf
- falcons.pdf
- Documento_Juridico_Constitucional.docx
- Documento_Medico_Cardiovascular.docx

Comprueba:

- introducción única;
- sesiones coherentes;
- preguntas conceptuales;
- explicación y práctica;
- error con alta confianza;
- reparación;
- final review distinto;
- cobertura requerida;
- cierre canónico.

### Grupo C — Material matemático y químico

Usa:

- CLUTCH 1.pdf
- CLUTCH 2.pdf
- TAREA CLUTCH 2.pdf
- TAREA QUIMICA CLUTCH.pdf
- Documento_Matematico_Calculo.docx

Comprueba:

- fórmulas visibles;
- no LaTeX crudo;
- fórmulas no duplicadas;
- valores numéricos;
- unidades opcionales compatibles;
- cuadráticas y ejercicios no revelan la respuesta;
- contexto suficiente;
- rapid no usa respuestas abiertas largas;
- fill blank rapid tiene word bank.

### Grupo D — Persistencia real

Al menos con Niels Bohr y un material matemático:

- refresh durante answering;
- refresh durante feedback;
- refresh durante collecting_confidence;
- salir y volver;
- persistencia antes de navegar;
- misma interactionId;
- misma questionId;
- misma fase;
- misma respuesta;
- mismo feedback;
- misma confianza.

### Grupo E — Cobertura y mastery

Para cada material seleccionado:

- captura requiredMicroIds;
- captura studiedMicroIds;
- captura masteredMicroIds;
- captura unresolvedMicroIds;
- captura repair sessions;
- comprueba que no haya requiredMicroIds desaparecidos;
- comprueba que masteredMicroIds satisfagan isMicroMastered;
- comprueba que unresolved no figure como mastered;
- comprueba que coverage 100 no cierre el programa por sí solo;
- comprueba cierre solo con isProgramComplete.

### Grupo F — Perfiles visuales

Como mínimo:

1. capable:
   - responde correctamente;
   - debe progresar eficientemente;
   - debe llegar a program_complete cuando satisface contratos.

2. misconception_prone:
   - comete errores consistentes;
   - debe recibir cambio de estrategia;
   - debe entrar en repair;
   - debe poder recuperarse.

3. low_confidence:
   - responde bien con confianza baja;
   - no debe recibir repair innecesario;
   - debe recibir confirmación o consolidación apropiada.

4. assistance_dependent:
   - usa pistas y ayudas;
   - no debe dominar solo con asistencia;
   - debe requerir evidencia independiente.

5. random_guesser:
   - no debe alcanzar false mastery;
   - puede quedar valid_incomplete.

6. memorizer_without_transfer:
   - puede dominar hechos definicionales;
   - no debe dominar micros que requieren transferencia sin transferir.

## Recorridos completos obligatorios

No intentes completar los nueve materiales con los seis perfiles; sería demasiado costoso y redundante.

Haz esta matriz:

### Niels Bohr

- capable completo;
- misconception_prone completo o repair válido;
- refresh;
- salir/volver;
- final review;
- cierre canónico.

### Falcons

- capable;
- random_guesser;
- verificar que no reaparezca la inconsistencia histórica de sesiones 8/2/1 sin una razón pedagógica.

### Documento jurídico

- capable;
- misconception_prone;
- preguntas conceptuales y aplicación a casos.

### Documento médico

- capable;
- low_confidence;
- integración y aplicación clínica sin inventar información fuera del documento.

### Documento matemático

- capable;
- assistance_dependent;
- fórmulas, resolución y evidencia independiente.

### CLUTCH 1 y CLUTCH 2

- rapid;
- matemático/químico;
- fórmulas;
- unidades;
- ejercicios;
- no answer leakage.

### Tareas CLUTCH

- extracción;
- selección de páginas;
- ejercicios;
- no es obligatorio completar ambos programas enteros si duplican contenido;
- sí deben probar identidad, cobertura y actividad correcta.

## Límite de tiempo y turnos

Los recorridos automatizados deben tener límites explícitos.

Por material/perfil:

- máximo de sesiones definido;
- máximo de interacciones definido;
- si no alcanza mastery, termina como valid_incomplete con unresolved;
- nunca loops infinitos;
- nunca elevar límites únicamente para forzar complete.

## Screenshots, videos y traces

Configura artefactos para fallos y puntos de control.

Guarda por recorrido:

- pantalla inicial;
- libro generado;
- primera sesión;
- feedback;
- repair;
- resumen;
- libro actualizado;
- cierre o estado incompleto.

Usa nombres estables por material y perfil.

## Reporte obligatorio

Crea:

PHASE_4_REAL_MATERIALS_E2E_REPORT.md

Debe incluir por material:

- archivo;
- formato;
- tamaño;
- páginas cuando sea posible;
- longitud de texto extraído;
- microconceptos generados;
- requiredMicroIds count;
- sesiones creadas;
- sesiones completadas;
- repairs;
- turnos;
- cobertura;
- mastery;
- unresolved;
- isProgramComplete;
- resultado:
  - program_complete;
  - valid_incomplete;
  - extraction_failure;
  - product_bug;
  - harness_bug.

Debe incluir por perfil:

- completion;
- turns/micro;
- repair;
- strategy changes;
- asistencia;
- false mastery.

Debe incluir una tabla de bugs encontrados:

- ID;
- material;
- perfil;
- capa;
- causa raíz;
- fix;
- prueba roja;
- prueba verde.

## Proceso test rojo → fix → verde

Por cada bug real:

1. Confirma el fallo con un test específico.
2. Guarda artefactos.
3. Clasifica:
   - producto;
   - arnés;
   - extracción;
   - fixture;
   - ambiente.
4. Aplica el cambio mínimo.
5. Ejecuta el test específico.
6. Ejecuta el grupo relacionado.
7. Ejecuta las 33 pruebas originales.
8. Documenta.

No hagas refactors amplios sin un test rojo que los justifique.

## Validaciones obligatorias finales

Ejecuta:

npx tsc --noEmit
npm run test
npm run test:adaptive-v3-bohr
npm run simulate:v3:smoke
npm run simulate:v3:deterministic
npm run simulate:v3:mass -- 1000
npm run test:e2e
npm run test:e2e:real-materials
git diff --check

También ejecuta build si el entorno permite resolver las fuentes:

npm run build

Si build falla únicamente por red o Google Fonts:

- documenta el error exacto;
- no lo presentes como bug del modo adaptativo;
- no cambies fuentes en esta fase sin necesidad.

## Condición de salida

Solo declara la Fase 4 completada si:

- las 33 pruebas originales siguen pasando;
- la matriz de materiales reales pasa;
- todos los uploads y extracciones obligatorios funcionan;
- no hay contaminación entre materiales;
- required coverage no pierde micros;
- false mastery = 0;
- ningún programa cierra por cobertura;
- ningún perfil adversarial domina falsamente;
- refresh y salir/volver funcionan con material real;
- fórmulas reales se renderizan correctamente;
- reporte completo;
- TypeScript PASS;
- git diff --check PASS;
- sin commit;
- sin deploy.

Si uno o más materiales no pueden completarse:

- no fabriques PASS;
- clasifica la causa;
- conserva el programa como valid_incomplete si es pedagógicamente correcto;
- corrige bugs reales;
- deja limitaciones honestas;
- no avances a producción.

Detente sin commit ni deploy.
