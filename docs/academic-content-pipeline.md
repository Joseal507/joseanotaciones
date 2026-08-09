# Pipeline universal de contenido académico

## Propósito

Toda superficie académica usa una representación intermedia tipada antes de
crear DOM. El sistema clasifica sintaxis, no asignaturas ni fórmulas concretas.
Cuando una secuencia es ambigua se conserva como Unicode/texto; nunca se
convierte mediante una conjetura destructiva.

## Flujo

```text
fuente generada
  → canonicalización de escapes y unidades inequívocas
  → parseAcademicContent
  → AcademicDocument v2 / AcademicNode[]
  → validateAcademicDocument
  → repairAcademicDocument (solo reparaciones semánticamente neutras)
  → regeneración aislada del fragmento, máximo 2
  → invalidación de actividad si persiste
  → renderer especializado
  → persistencia JSON del AST validado
```

Las preguntas mantienen además su contrato pedagógico. La validación académica
ocurre antes de que `validateQuestion` permita mostrar la actividad, por lo que
un fragmento inválido no llega al scoring, evidencia o mastery.

## Nodos canónicos

- `document`, `paragraph`, `heading`: estructura del documento.
- `text`: prosa Unicode; no conserva sintaxis de presentación.
- `strong`, `emphasis`, `strike`: presentación consumida estructuralmente.
- `link`: enlace con esquema permitido.
- `symbol`: símbolos Unicode que no requieren transformación.
- `math`: LaTeX o MathML, inline o block.
- `chemistry`: notación química explícita (`\ce{...}`) o ecuaciones inequívocas.
- `quantity`: número y unidad como una unidad semántica no separable.
- `unit`: unidad aislada cuando el contenido no incluye una magnitud.
- `code`: inline o block con lenguaje opcional.
- `blank`: interacción sin exponer su ID.
- `line_break`, `list`, `table`, `callout`: estructura documental.
- `error_fallback`: estado interno cuya razón nunca se presenta.

Matching, ordering, opciones y demás interacciones conservan su contrato
discriminado; cada uno de sus fragmentos visibles atraviesa este mismo parser.
Los controles de selección académica son listboxes ARIA: guardan IDs estables,
pero renderizan el contenido del nodo. No se introduce HTML de KaTeX dentro de
`<option>`.

## Renderizado

- LaTeX: KaTeX con salida HTML + MathML, `trust=false` y validación estricta.
- MathML: solo nodos `<math>...</math>` sin scripts ni event handlers.
- Química: extensión `mhchem` incluida en KaTeX.
- Código: contenido escapado, nunca interpretado como HTML.
- Markdown: el parser estructural consume delimitadores antes del render. Cada
  región fuente pertenece a un solo nodo; no se vuelve a pasar por un segundo
  parser Markdown.
- HTML: el modelo y el PDF no se interpretan como HTML. Solo KaTeX/MathML
  validados llegan al punto controlado de inserción HTML.
- Cantidades: el compositor conserva los separadores internos del número,
  inserta una frontera lingüística cuando falta y usa espacio no separable
  entre magnitud y unidad, sin añadirlo antes de puntuación.
- Unidades LaTeX fuera de fórmulas: `\text{...}` y `\mathrm{...}` adyacentes
  a una magnitud se convierten antes del AST en `quantity`. La notación
  científica y exponentes de unidad se conservan estructuralmente. Dentro de
  `$...$` los comandos válidos permanecen como matemáticas KaTeX.
- Escapes dañados: únicamente se repara `TAB + ext{...}` o una familia de
  comando parcial cuando aparece junto a una cantidad y su intención es
  inequívoca. Tabs ordinarios y palabras que contienen `ext` no se alteran.
  Tokens parciales ambiguos se invalidan antes del render.
- Blanks: solo se muestra `___`; los IDs permanecen en el AST.
- El stylesheet oficial de KaTeX se carga en el layout raíz. Su MathML queda
  disponible para accesibilidad y la capa HTML es la única representación
  visual.

## Recuperación y telemetría

Los teaching steps y el repaso ejecutan validación, reparación segura y hasta
dos regeneraciones aisladas. Si el fragmento sigue inválido, se sustituye solo
ese fragmento por contenido mínimo válido; la sesión conserva navegación,
persistencia y restore. El evento técnico se registra únicamente en servidor
con `surface`, `sessionId`, `stepId`, `phase`, `nodePath`, `nodeType`,
`validationReason` y `repairAttempts`.

Las actividades evaluables siguen una política más estricta: si falla un nodo,
la actividad completa obtiene `outcome: invalid` y no entra en scoring,
evidence, mastery ni remediation.

## Garantías

1. Un AST serializado/restaurado produce el mismo render determinista.
2. Objetos desconocidos no se convierten con `String(object)`.
3. Unicode válido se conserva.
4. Ningún token `internal`, `answer`, ID de blank u `[object Object]` se renderiza.
5. Delimitadores desbalanceados y comandos LaTeX desconocidos fallan cerrados.
6. Las reparaciones no contienen reglas por tema, materia o fórmula.
7. La regeneración recibe solo el fragmento fallido y tiene límite.
8. Un fragmento todavía inválido invalida la actividad completa; en contenido
   docente no evaluable activa un fallback local y telemetría estructurada.
9. Feedback y reexplicación resuelven IDs contra labels académicos; nunca
   serializan IDs internos como texto para el estudiante.
10. La fuente reparada se canonicaliza antes de cache o persistencia; el AST
    validado conserva el mismo render después de JSON y restore.
11. Persistencia usa un envelope versionado con `schemaVersion`,
    `parserVersion`, `originalHash` y AST; los snapshots v1 se migran y vuelven
    a validarse.
12. `prepareAcademicContentForDelivery` es la barrera final de todas las
    superficies React académicas y nunca devuelve source inválido.

## Límites conocidos

- La notación especializada ambigua sin delimitadores explícitos se conserva
  como texto. El sistema no intenta inferir si, por ejemplo, una palabra corta
  es una variable, una sigla o una fórmula molecular.
- MathML se valida con una política estructural conservadora, no con un esquema
  XML completo.
- Las tablas soportan el subconjunto GFM rectangular; tablas con celdas
  combinadas requieren una futura extensión del AST.
- La regeneración aislada depende del proveedor en producción; tests usan
  callbacks deterministas y nunca llamadas reales.
