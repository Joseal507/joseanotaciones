Lee AGENTS.md y BLOCKED_ADAPTIVE_REPORT.md completos.

No hagas commit ni deploy.
No uses git reset, git clean, git checkout, git restore ni stash.
Conserva todos los cambios actuales.
No debilites Mastery Contracts ni pruebas.

MISIÓN DE ESTA FASE

Eliminar los bloqueos documentados mediante pruebas reales de navegador y métricas pedagógicas estrictas.

PRIORIDAD 1 — PLAYWRIGHT

Configura Playwright con Chromium y crea recorridos end-to-end reales contra localhost.

Debes automatizar y validar:

1. La introducción aparece una sola vez.
2. Finalizando no reinicia la introducción.
3. El usuario llega al libro canónico.
4. Entendido, continuar avanza una sola vez.
5. Durante loading no se muestra el contenido viejo como contenido activo.
6. Respuesta → evaluación → feedback → confianza → Continuar.
7. Confianza no avanza ni cierra.
8. Última respuesta no cierra antes de Continuar.
9. No aparecen microIds.
10. El resumen tiene scroll y nombres legibles.
11. Ver mi progreso y Ver mi programa regresan al libro canónico.
12. No aparece ninguna vista adaptive legacy.
13. rapid no usa open_response, teach_back ni step_by_step_solver.
14. rapid fill_blank siempre ofrece word bank.
15. Matemáticas sin LaTeX crudo, duplicación ni preguntas ambiguas.
16. -3.4 y -3.4 eV se consideran equivalentes o mostly_correct.
17. Preguntas no revelan la respuesta en el enunciado previo.
18. El chat permite preguntar, repreguntar, scroll y cerrar.
19. Refresh conserva el estado.
20. Salir y volver conserva el progreso.
21. Sesión final no repite literalmente el banco anterior.
22. Sesión completada se persiste antes de navegar.

Usa fixtures aislados.
Añade data-testid donde sea necesario.
Guarda screenshot, video y trace en fallos.
No uses delays arbitrarios si puede esperarse un estado visible.

PRIORIDAD 2 — MÉTRICAS REALES

El harness actual no debe imprimir PASS si incumple los umbrales pedagógicos.

Convierte en gates reales:

- false mastery = 0
- invariant failures = 0
- restore divergences = 0
- infinite loops = 0
- perfiles capaces: promedio <= 12 turnos por micro
- repair success en perfiles recuperables >= 60%
- strategy change tras fallo repetido >= 80%
- program completion debe segmentarse por perfil
- perfiles adversariales no deben producir false mastery

No mezcles perfiles capaces, recuperables y adversariales en una única tasa global.

PRIORIDAD 3 — EFICIENCIA PEDAGÓGICA

Ataca las causas de 22 turnos por micro:

- máximo una explicación inicial antes de pedir evidencia;
- máximo dos turnos de enseñanza consecutivos;
- respuesta correcta avanza a evidencia distinta o consolida;
- no repetir introducción, explicación y cita del mismo hecho;
- un fallo debe cambiar estrategia, formato, ejemplo o dificultad;
- no más de dos preguntas sobre el mismo factKey salvo reparación intencional;
- sesión final usa integración y transferencia;
- no generar banco completo antes de empezar;
- generación de actividades on-demand con prefetch máximo 2.

REGLAS

- Escribe primero un test rojo para cada bug.
- Confirma que falla por el motivo correcto.
- Corrige el producto.
- Ejecuta nuevamente.
- No marques bloqueado como PASS.
- No declares terminado solo por TypeScript o build.

VALIDACIÓN FINAL

npx tsc --noEmit
npm run test
npm run test:adaptive-v3-bohr
npm run simulate:v3:smoke
npm run simulate:v3:deterministic
npm run simulate:v3:mass -- 1000
npm run test:e2e
npm run build
git diff --check

Escribe ADAPTIVE_BROWSER_PHASE_REPORT.md con:

- bugs reproducidos;
- causas;
- archivos modificados;
- resultados Playwright;
- screenshots/traces;
- métricas segmentadas;
- umbrales aprobados y fallidos;
- riesgos pendientes;
- pasos exactos de prueba manual.

Si una prueba depende de login, crea la infraestructura de storageState y documenta el único paso manual necesario para autenticar. No fabriques una sesión autenticada.
