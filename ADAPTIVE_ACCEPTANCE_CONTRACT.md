# Contrato de aceptación — StudyAL Adaptive V3

## Objetivo

Al completar el programa adaptativo, el estudiante debe haber trabajado el 100% de los microconceptos requeridos del material seleccionado y haber producido evidencia suficiente para que el motor confirme:

isProgramComplete === true

## Programa completo

Solo puede ser verdadero cuando:

1. todos los requiredMicroIds fueron estudiados;
2. todos cumplen dominio provisional;
3. unresolvedMicroIds está vacío;
4. no existe sesión de reparación pendiente;
5. el motor retorna isProgramComplete === true;
6. el estado fue persistido antes de mostrar el cierre final.

Nunca cerrar por cobertura visual, número de sesiones, porcentaje local, cantidad de turnos, fusible ni finalización del libro.

## Experiencia obligatoria

1. La introducción aparece una sola vez.
2. Solo existe un libro de sesiones canónico.
3. No se navega a vistas adaptive legacy.
4. Loading no mezcla contenido anterior con el nuevo.
5. Responder no avanza automáticamente.
6. Seleccionar confianza no avanza.
7. Solo Continuar avanza o cierra.
8. Feedback y confianza pertenecen al mismo interactionId y questionId.
9. Nunca se muestran microIds.
10. El resumen separa trabajados, dominados provisionalmente y refuerzo.
11. La sesión final evalúa integración y transferencia.
12. La sesión final no repite literalmente preguntas anteriores.
13. rapid utiliza formatos rápidos compatibles.
14. fill_blank en rapid muestra word bank.
15. Respuestas equivalentes y unidades compatibles se aceptan correctamente.
16. Las matemáticas se renderizan correctamente.
17. Ninguna pregunta revela su respuesta.
18. El chat permite repreguntas y scroll.
19. Refresh y salir/volver conservan el estado.
20. La sesión se persiste antes de navegar.

## Puertas pedagógicas

- false mastery = 0
- invariant failures = 0
- restore divergences = 0
- infinite loops = 0
- capable avgTurnsPerMicro <= 12
- recoverable repairSuccessRate >= 60%
- strategyChangeAfterRepeatedFailure >= 80%
- adversarial false mastery = 0
- required material coverage = 100%

## Regla final

No declarar terminado hasta que pasen:

- pruebas unitarias;
- simulaciones;
- matriz Playwright;
- PDF teórico real;
- PDF matemático real;
- prueba manual final;
- FINAL_ADAPTIVE_REPORT.md.
