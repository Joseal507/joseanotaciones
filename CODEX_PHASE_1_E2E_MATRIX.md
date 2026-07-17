Lee completos antes de editar:

- AGENTS.md
- ADAPTIVE_ACCEPTANCE_CONTRACT.md
- ADAPTIVE_BROWSER_PHASE_REPORT.md
- playwright.config.ts
- tests/e2e/adaptive-v3.spec.ts
- components/materias/adaptive/v3/StudyALSessionV3.tsx
- components/materias/StudyALProcess.tsx

No hagas commit ni deploy.
No elimines ni reviertas cambios existentes.
No uses git reset, git clean, git checkout, git restore ni stash.
No debilites Mastery Contracts.
No marques pruebas como skip para ocultar fallos.
No fabriques resultados.

MISIÓN ÚNICA

Completar la matriz Playwright que reproduce los bugs visibles del modo adaptativo.

No intentes arreglar todavía toda la pedagogía.
Primero crea pruebas deterministas y clasifica cuáles pasan y cuáles fallan.

Crea pruebas para:

1. introducción aparece una sola vez;
2. Finalizando no reinicia la introducción;
3. llegada al libro canónico;
4. Entendido avanza una sola vez;
5. doble clic produce una sola evaluación;
6. loading oculta el contenido anterior;
7. evaluar muestra feedback completo;
8. confianza no avanza;
9. Continuar es el único avance;
10. última respuesta no cierra antes de Continuar;
11. nueva pregunta limpia confianza anterior;
12. no aparecen microIds;
13. resumen tiene scroll;
14. resumen usa nombres humanos;
15. trabajado, dominado y refuerzo no se mezclan;
16. Ver mi progreso vuelve al libro canónico;
17. Ver mi programa vuelve al libro canónico;
18. no aparece ninguna vista legacy;
19. rapid rechaza open_response y step_by_step;
20. rapid fill_blank incluye word bank;
21. respuesta numérica acepta unidad opcional compatible;
22. respuesta semánticamente equivalente no exige texto exacto;
23. no aparece LaTeX crudo;
24. no se duplica una fórmula;
25. una pregunta no contiene su propia respuesta;
26. chat permite pregunta, respuesta, repregunta y scroll;
27. refresh conserva interactionId, questionId y fase;
28. salir y volver conserva la sesión;
29. repair no repite questionId;
30. repair no repite factKey sin intención explícita;
31. final review no repite literalmente preguntas anteriores;
32. persistencia ocurre antes de navegar;
33. programa completo exige isProgramComplete true.

REGLAS DE PRUEBA

- Usa fixtures deterministas.
- Usa data-testid estables.
- Mockea APIs solo para pruebas puramente visuales.
- Usa el fixture integrado para flujo completo.
- Cada prueba debe fallar por una causa específica.
- No uses esperas largas arbitrarias.
- Mantén screenshots, video y trace en fallos.
- No realices refactors grandes del motor en esta fase.

AL TERMINAR

Ejecuta:

npx tsc --noEmit
npm run test:e2e
git diff --check

Escribe PHASE_1_E2E_MATRIX_REPORT.md con:

- pruebas creadas;
- cantidad total;
- pruebas verdes;
- pruebas rojas;
- causa de cada roja;
- archivos modificados;
- siguiente orden recomendado de corrección.

Detente sin commit ni deploy.
