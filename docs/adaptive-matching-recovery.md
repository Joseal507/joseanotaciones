# Matching y recuperación adaptativa

## Causas raíz

Matching conservaba únicamente la lista de pares correctos. El renderer usaba
esa misma lista como banco de respuestas, por lo que el índice del lado
izquierdo coincidía con el índice de su respuesta. No existía semántica
bijectiva/many-to-one ni orden visual persistible en el contrato.

La reenseñanza mantenía un array temporal de preguntas falladas. Además, una
reevaluación incorrecta se guardaba como check, pero no actualizaba la fuente
del diagnóstico: el siguiente reteach volvía a leer el fallo original. Cuando
fallaba la generación, frontend y backend podían alternar reenseñanza sin un
presupuesto de progreso separado.

## Contrato de matching

Una pregunta matching declara:

- `matchingSemantics`: `bijective` o `many_to_one`;
- `matchingOptionOrder`: IDs de respuestas en orden visual;
- `correctAnswer`: mapa de ID izquierdo a ID derecho.

El orden se genera mediante una permutación determinista sembrada por
`question.id`, se almacena con la pregunta y nunca se recalcula durante render.
Para dos o más candidatos se rechaza la identidad completa. En preguntas
bijectivas el listbox deshabilita IDs usados por otra fila; many-to-one permite
reutilizarlos. El scoring solo compara IDs.

## Contrato de recovery

Cada micro fallado crea o actualiza un `RecoveryItem` serializable. Dos fallos
del mismo micro se consolidan conservando preguntas, fact keys y resultados.
Micros distintos mantienen colas independientes.

Durante un bloque normal, el fallo se persiste inmediatamente con
`deferredUntilNormalBlockComplete`, pero no es elegible para reenseñanza.
`nextRecoveryItem` lo omite hasta que se hayan contestado todas las preguntas
del bloque. En el cierre, `releaseNormalBlockRecoveries` habilita la cola. Así,
un fallo no interrumpe preguntas normales ya generadas, pero sí bloquea el
siguiente paso pedagógico.

El ciclo es:

```text
pending_reteach
→ reteaching
→ pending_verification
→ verification_ready
→ verification_active
→ resolved | pending_reteach
```

Las preguntas de verificación se persisten antes de cambiar la vista. Cada una
guarda `recoveryId`, `roundId`, `generatedAt`, `persistedAt`, `presentedAt`,
`answeredAt` y `evidenceId`. `verification_ready` indica que existe una
pregunta persistida pendiente de presentación; generar o persistir preguntas no
avanza el índice de la cola ni crea evidencia.

Cada fallo válido añade `failureHistory` y actualiza atómicamente
`latestFailureEvidenceId`, pregunta, respuesta del estudiante, respuesta
esperada, tipo de error, fact keys y asistencia. El siguiente diagnóstico usa
esa evidencia reciente; el historial original permanece disponible para
detectar continuidad. `strategyHistory` y fingerprints del contenido impiden
repetir estrategia o explicación sin progreso.

Solo una pregunta válida, no repetida y contestada sin asistencia cuenta como
éxito independiente. Cada reenseñanza abre una `verificationRound` nueva que
reinicia el crédito de la ronda y exige dos checks nuevos. Dos correctas
resuelven; cualquier ronda de dos que incluya un fallo vuelve a
`pending_reteach`. El acierto parcial de esa ronda permanece en el historial,
pero no sirve como crédito para la siguiente. Preguntas inválidas,
IDs/fact keys repetidos, similitud semántica y respuestas asistidas no inflan el
contador y deben reemplazarse. Hay un presupuesto técnico escalonado de
generación remota (formato, reparación dirigida, simplificación, generación
individual y proveedor alternativo), pero no existe un fusible pedagógico. Las
rondas, fallos del estudiante y cambios de estrategia no tienen máximo. Los
campos legacy de límites se conservan solo para migrar snapshots antiguos y no
habilitan avance.

Una reevaluación solo cuenta si pertenece al `recoveryId` y `roundId` activos,
fue persistida, obtuvo `presentedAt` y después recibió una respuesta válida.
Restore convierte snapshots con preguntas pendientes a `verification_ready` y
consume exactamente esas preguntas antes de generar otras. La posición visible
se deriva del `recoveryId` persistido y solo cambia cuando el item actual queda
`resolved`. Un snapshot legacy `unresolved` se reabre como `pending_reteach`.

Las verificaciones inline de un único paso usan el mismo contrato. Si la
pregunta inline falla, el `RecoveryItem` se persiste y se libera inmediatamente
porque el bloque ya terminó. El botón de reenseñanza entra en
`verification_generation`; no llama al avance pedagógico. La comparación
semántica de recovery usa un umbral propio que bloquea paráfrasis equivalentes
sin rechazar dos operaciones distintas sobre el mismo microconcepto.

`advanceTeaching` consulta la cola antes de incrementar el paso y registra
`blocked_step_advance` si queda deuda. Tres fallos remotos no activan contenido
local: el pipeline continúa con transformaciones reales y generación
individual. `createDeterministicRecoveryFallback` queda exclusivamente detrás
de `NEXT_PUBLIC_ENABLE_EXTREME_RECOVERY_FALLBACK=true`, después del presupuesto
completo, y registra `extreme_fallback_used`. Una lista de preguntas vacía
nunca significa recuperación resuelta.

La cola se guarda tanto junto al contenido de sesión como en
`journey.resumeState.recoveryQueues`. La sesión no puede cerrarse con items
pendientes y el programa no puede completarse si un micro requerido permanece
pendiente. El restore migra de forma conservadora colas anteriores,
conserva contadores y vuelve los estados efímeros a una transición recuperable.

El tiempo de estudio activo se acumula únicamente mientras la pestaña está
visible. Cada nueva hora muestra una sugerencia de descanso. Tanto descansar
como continuar persisten la cola, la ronda y las preguntas; el aviso no cambia
evidencia, dominio ni posición pedagógica.
