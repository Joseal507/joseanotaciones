# MISIÓN FINAL — MODO ADAPTATIVO STUDYAL

Trabaja autónomamente hasta satisfacer todas las puertas de aceptación descritas aquí.

## Restricciones absolutas

- Lee AGENTS.md completo antes de trabajar.
- Conserva todos los cambios actuales.
- No uses git reset, git clean, git checkout, git restore ni stash.
- No hagas commit.
- No hagas deploy.
- No cambies Mastery Contracts para fabricar resultados.
- No debilites, elimines ni saltes pruebas.
- No declares éxito solo porque TypeScript, build o pruebas unitarias pasan.
- No uses porcentajes visuales para declarar programa completo.
- Solo isProgramComplete === true del motor puede completar el programa.

## Objetivo de producto

Al subir un material y terminar todas las sesiones, el estudiante debe haber trabajado el 100% del material seleccionado mediante una secuencia pedagógicamente válida, personalizada según sus respuestas, sin falsa maestría, loops, repeticiones inútiles, formatos incompatibles ni pérdida de progreso.

## Proceso obligatorio

1. Audita el flujo completo:
   material → graph → program → session → tutor → interaction
   → evaluation → evidence → mastery → persistence
   → session completion → program completion.

2. Construye o mejora pruebas antes de corregir cada fallo.

3. Ejecuta ciclos autónomos:
   - reproducir;
   - crear test rojo;
   - corregir;
   - ejecutar validaciones;
   - analizar resultado;
   - repetir.

4. No te detengas al resolver un solo bug. Continúa hasta que todas las puertas pasen o exista un bloqueo externo verdaderamente imposible de resolver sin el usuario.

## Puertas obligatorias

### Funcionales
- 0 false mastery.
- 0 invariant failures.
- 0 restore divergences.
- 0 infinite loops.
- 0 sesiones completadas visualmente sin persistencia confirmada.
- 0 avances antes de que el usuario pulse Continuar.
- 0 confidence asociada a otra interacción.
- 0 microIds visibles.
- 0 navegación hacia vistas legacy.
- 0 preguntas con answer leakage.
- 0 preguntas incompletas.
- 0 LaTeX crudo o matemáticas duplicadas.

### Cobertura
- 100% de micros requeridos trazables al material.
- 100% de micros trabajados antes de program complete.
- Cada micro conserva source pages/chunks.
- Coverage no equivale a mastery.
- Fused no equivale a mastery.
- Ningún micro desaparece entre sesiones o restore.

### Preferencias
- rapid jamás usa open_response, teach_back, step_by_step_solver ni practical_case abierto.
- rapid fill_blank siempre usa word bank.
- write_explain y mix_everything funcionan según contrato.
- La preferencia se conserva en sesiones normales, repair y final review.

### Evaluación
- Evaluación numérica tolera unidades omitidas como mostly_correct.
- Evalúa equivalencias numéricas, semánticas y simbólicas.
- Respuestas abiertas producen correct, mostly_correct, partial o incorrect.
- No exige coincidencia literal cuando el significado es equivalente.
- Errores de unidad no se clasifican como desconocimiento conceptual.
- Preguntas matemáticas especifican exactamente qué debe introducirse.
- Los problemas matemáticos deben ser física y matemáticamente válidos.

### Pedagogía
- Máximo una explicación breve antes de pedir evidencia.
- No más de dos turnos consecutivos de enseñanza sin interacción.
- Cada fallo cambia la intervención.
- Tres fallos consecutivos usan al menos tres estrategias distintas.
- Una respuesta correcta no dispara explicación redundante.
- Alta confianza + error activa reparación de ilusión/misconception.
- Reveal no puede producir dominio sin recuperación independiente posterior.
- Sesión final no reutiliza questionId ni factKey de sesiones anteriores.
- Sesión final evalúa integración y transferencia, no solo recuerdo literal.
- No se genera contenido externo no marcado como tal.
- Ninguna sesión completa lista conceptos estudiados como dominados.

### Eficiencia
- El libro aparece sin esperar un banco completo.
- Primera actividad generada on-demand.
- Prefetch máximo de dos actividades.
- Medir graphMs, programMs, firstRenderMs y interactionLatencyMs.
- Eliminar esperas evitables.
- Objetivo capable profiles: promedio <= 12 turnos por micro.
- No generar preguntas que probablemente no serán usadas.

### Pruebas reales
Añade pruebas de navegador automatizadas, usando la herramienta disponible en el proyecto o instalando una dependencia solo si ya existe autorización en AGENTS.md.

Recorridos:
1. PDF teórico corto.
2. PDF matemático.
3. Material de Niels Bohr.
4. rapid.
5. mix_everything.
6. error con alta confianza.
7. respuesta abierta semánticamente equivalente.
8. refresh durante sesión.
9. salir y volver.
10. programa completo.
11. sesión incompleta y repair.
12. chat con repreguntas y scroll.

Cada recorrido debe validar estado visual, persistencia, navegación y contrato pedagógico.

## Validaciones mínimas en cada ciclo relevante

- npx tsc --noEmit
- npm run test
- npm run test:adaptive-v3-bohr
- npm run simulate:v3:smoke
- npm run simulate:v3:deterministic
- npm run build
- git diff --check

Ejecuta también mass simulation y las pruebas de navegador antes del cierre final.

## Regla de parada

Solo detente cuando:

A. Todas las puertas anteriores estén verificadas mediante tests y reportes;
B. no existan fallos críticos o P0/P1 abiertos;
C. las pruebas reales completas pasen;
D. hayas realizado una auditoría final buscando falsos positivos de los tests;
E. hayas escrito FINAL_ADAPTIVE_REPORT.md con:
   - cambios;
   - causas;
   - pruebas;
   - métricas;
   - riesgos restantes;
   - pasos exactos de prueba manual;
   - afirmaciones que todavía no estén demostradas.

Si existe un bloqueo externo, no digas simplemente que no puedes continuar:
- documenta el bloqueo;
- termina todo lo que no dependa de él;
- deja comandos y evidencia exacta;
- escribe BLOCKED_ADAPTIVE_REPORT.md.

No hagas commit ni deploy.
