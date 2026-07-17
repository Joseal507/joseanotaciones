# StudyAL — instrucciones para Codex

## Objetivo principal

Terminar y estabilizar el modo adaptativo v3 para que un usuario pueda:

1. subir o seleccionar un material;
2. completar el setup;
3. recibir sesiones coherentes;
4. estudiar el 100% de los microconceptos;
5. recibir feedback antes de avanzar;
6. reparar errores sin repetición infinita;
7. restaurar su progreso;
8. completar el programa solo cuando el motor lo confirme.

## Reglas absolutas

- No usar git reset.
- No usar git clean.
- No usar git checkout.
- No usar git restore.
- No usar stash.
- No hacer force push.
- No borrar trabajo existente.
- No debilitar Mastery Contracts solo para hacer pasar tests.
- No crear más motores pedagógicos salvo necesidad demostrada.
- No hacer commit ni deploy sin permiso explícito.
- No usar OpenRouter.
- No ocultar errores con `as any`.
- No sustituir el motor real por lógica paralela en frontend.
- Leer completos los archivos relacionados antes de editarlos.
- Ejecutar tests después de cada bloque lógico.
- Mantener false mastery = 0.
- Mantener cobertura y dominio como métricas distintas.

## Flujo canónico

material
→ graph
→ program
→ session
→ tutor
→ evidence
→ mastery
→ persistence
→ session completion
→ program completion

## Condición de programa completo

Solo `isProgramComplete === true` proveniente del motor puede cerrar el programa.

Nunca cerrar únicamente por:

- coverage visual;
- sesiones marcadas completed;
- cantidad de turnos;
- porcentaje local;
- fusible.

## Validaciones obligatorias

Antes de declarar terminado:

- npx tsc --noEmit
- npm run test
- npm run test:adaptive-v3-bohr
- npm run simulate:v3:smoke
- npm run simulate:v3:deterministic
- npm run build
- git diff --check

## Estado actual conocido

Ya pasan:

- TypeScript
- Build
- Product Flow 35/35
- Bohr Regression 42/42
- Smoke
- Deterministic

Persisten problemas de producto:

- feedback puede desaparecer;
- confianza puede quedar asociada a otra pregunta;
- la sesión puede cerrar antes de que el usuario pulse Continuar;
- resumen de sesión puede confundir estudiado con dominado;
- explicaciones repetitivas;
- grounding inválido;
- mismatch entre formato solicitado y pregunta entregada;
- preguntas repetidas en repairs;
- coverage_repair mezcla modos incompatibles.

La prioridad actual es corregir el flujo visible real, no construir más arquitectura.

## AUTORIZACIÓN PLAYWRIGHT

Está autorizado instalar y usar como dependencia de desarrollo:

- @playwright/test
- Chromium administrado por Playwright

Está autorizado:

- crear playwright.config.ts;
- crear tests/e2e/;
- ejecutar localhost;
- automatizar Chromium;
- generar screenshots, videos y traces;
- añadir data-testid necesarios;
- instalar únicamente las dependencias mínimas requeridas para estas pruebas.

No está autorizado:

- hacer commit;
- hacer deploy;
- borrar cambios acumulados;
- usar git reset, clean, checkout, restore o stash;
- debilitar Mastery Contracts;
- fabricar resultados o marcar pruebas bloqueadas como PASS.
