# Pipeline canónico de generación IA

`lib/ai/generationPipeline.ts` separa los intentos técnicos de las rondas
pedagógicas. Una operación recorre, con límite temporal:

```text
normal
→ format_repair
→ targeted_repair
→ simplified
→ split_individual
→ alternate_provider
→ final validation
```

Cada intento recibe el fallo y los errores estructurados del anterior. El
consumer transforma el prompt según la etapa; no se repite una llamada ciega.
El resultado solo se entrega cuando sus validadores lo aprueban.

El clasificador distingue JSON inválido, fragmentos académicos inválidos,
duplicación semántica, incompatibilidad de modo, reenseñanza pobre, diversidad
insuficiente y fallos de proveedor. `session-eval`, `session-reteach` y
`session-teach` usan actualmente esta infraestructura.

ALAI acepta `excludeProviders` y `excludeModels`. La etapa final puede excluir
el proveedor/modelo rechazado, mientras la rotación interna sigue probando las
credenciales disponibles.

El presupuesto técnico agotado devuelve un estado recuperable y nunca modifica
evidencia, mastery, recoveryId, roundId ni el paso pedagógico. El fallback local
de recovery está desactivado por defecto y solo existe como contingencia
explícita mediante `NEXT_PUBLIC_ENABLE_EXTREME_RECOVERY_FALLBACK=true`.

## Rutas legacy visibles

`generateValidatedLegacyJson` adapta los payloads JSON existentes sin modificar
sus contratos HTTP. Lo usan flashcards, mapas, explicación de nodos, quizzes,
examen y Repasar. Los validadores permanecen junto a cada dominio; la política
de retry, clasificación, telemetría y rotación vive en el pipeline común.

## Análisis chunked

El análisis de materiales conserva por ahora su implementación especializada.
Su secuencia es funcionalmente equivalente:

```text
chunk → JSON repair → simplified retry → split halves
→ individual generation → validation → assembly
```

No se migró para evitar cambiar cobertura, identidad de bloques o ensamblado del
grafo. La futura migración puede usar `generateValidatedLegacyJson` por chunk y
mantener el ensamblador actual como `mergeParts`; esa interfaz ya está
preparada.
