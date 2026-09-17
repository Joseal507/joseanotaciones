# Auditoría de herramientas del modo libre

## Alcance y método

Auditoría estática, sin modificar código ni ejecutar generaciones reales. Se usó el grafo existente para localizar componentes, rutas y stores; luego se verificaron callers y contratos en fragmentos dirigidos con RTK. El estado indica confianza arquitectónica, no una certificación funcional end-to-end.

## Entrada común y navegación

`TemaView` crea o restaura la sesión Free y entrega a `StudyALProcess` el `SourceSelectionSnapshot` canónico. `StudyALProcess` presenta las ocho herramientas y deriva su progreso de los mismos envelopes durables que restauran cada herramienta. Study Map y Truquitos se montan directamente desde `TemaView`; las otras seis se seleccionan desde `StudyALProcess` y se montan desde `app/materias/page.tsx`. La identidad común es:

`sesión Free + materialIds (1–5) + selectedPages + sourceSelectionFingerprint + tool`.

`readFreeToolState` rechaza una sesión que no sea Free o cuyo `sessionId`/fingerprint no coincida. `writeFreeToolState` guarda en `StudySession.notes.freeTools`, primero en memoria/localStorage y después mediante la sincronización de `/api/study-sessions`.

## Tabla comparativa compacta

| Herramienta | Componente / entrada | API y generación | Entrada académica efectiva | Salida y consumo | Persistencia / restore | Estado |
|---|---|---|---|---|---|---|
| Repasar | `ALAIStudyALRepasar`; `StudyALProcess.onOpenRepasar` | `/api/alai-studyal-repasar`; `generateValidatedLegacyJson`/ALAI | Material Brain exacto; contexto de repaso. Texto autorizado queda en cliente para lectura | lectura guiada, conceptos, explicación y evaluación | envelope `repasar`; migración legacy acotada | Funciona con riesgos |
| Análisis | `AnalisisTeorico`; `onOpenAnalisis` | `/api/analizar-teorico`; `alaiJson`; chat por `/api/alai-studyal-chat` | Material Brain para el análisis; texto autorizado sólo para dudas | análisis por nivel/tipo, relaciones y chat; UI/notas | resultados por tipo en envelope `analysis`; resultado académico también en `material_results` | Parcialmente duplicada |
| Study Map | `ALAIStudyMap`; `onOpenStudyMap` (montaje directo en `TemaView`) | `/api/alai-studyal-map`; explicación de hojas por la misma ruta; chat como fallback para nodos no grounded | Material Brain/contexto de mapa; fingerprint exacto | mapa, tarjetas, outline, explicación de nodos | envelope `studymap` | Funciona con riesgos |
| Truquitos | `ALAIStudyALCheatCodes`; `onOpenCheatCodes` (montaje directo) | `/api/alai-studyal-cheat-codes`; generador y variante | Material Brain; no envía texto crudo | tarjetas mnemónicas, filtros, favoritos, conocidas/difíciles | envelope `truquitos` + migración localStorage | Funciona con riesgos |
| Flashcards | `ALAIStudyALCards`; `onOpenFlashcards` | `/api/flashcards-v2`; planner/generator/validator/dedup; respuestas por `/api/evaluar` | exclusivamente Material Brain READY para generar; `useAuthorizedSource` sólo apoya idioma/visor | mazo validado, estudio rápido/repaso, edición manual y progreso | mazo servidor en `material_results`; copia y progreso en envelope `flashcards` | Arquitectura contradictoria |
| Quiz | `ALAIStudyALQuizzes`; `onOpenQuiz` | `/api/alai-studyal-quizzes` (`coverage`, `lookup`, generación, `advance`, `evaluate`); reportes `/api/quiz-reports` | Material Brain y artefacto de quiz por fingerprint/configuración | preguntas multiformato, ayudas, evaluación, cobertura y reportes | artifact/store servidor + envelope `quiz`; lookup explícito | Funciona con riesgos |
| Examen ALAI | `ALAIStudyALExams`; `onOpenExam` | `/api/alai-studyal-exam` (`generate`, `advance`, `adapt`, `evaluate`) | Material Brain/contexto de examen | examen con slots, temporizador, adaptación y evaluación | generation store servidor + envelope `exam` + caché local legacy | Funciona con riesgos |
| ALAI | `ALAIStudyALChat`; `onOpenAlai` | `/api/alai-studyal-chat`; `generateValidatedLegacyJson`/ALAI | combinación controlada de Material Brain y texto persistido autorizado | conversación grounded con fuentes | mensajes en envelope `alai` | Funciona con riesgos |

## Dependencia de Material Brain y reanálisis

- Flashcards V2 no acepta texto ni documentos del cliente y nunca construye el Brain: hace lookup-only y devuelve preparación si no está listo.
- Quiz y Examen consumen el Brain pero añaden planificación/generación/evaluación específicas; sus artefactos no son equivalentes al Brain.
- Repasar, Análisis, Study Map y Truquitos vuelven a sintetizar una experiencia desde contextos derivados del Brain. Esto es análisis de herramienta, no reextracción del documento.
- ALAI combina el Brain con texto persistido para responder preguntas. Es la excepción deliberada a “Brain solamente”.
- Ninguna de las ocho rutas V2 auditadas necesita que el cliente envíe imágenes o active Vision directamente. La calidad visual que reciben depende de la ingestión previa del Material Brain.

## Validaciones, proveedores y modelos

Las rutas legacy modernas usan la política central ALAI: OpenRouter/Gemini 2.5 Flash como proveedor canónico y fallback Groq sólo ante errores confirmados de créditos. Flashcards utiliza `alaiJson` por lotes y validadores propios; `/api/evaluar` usa Groq `llama-3.3-70b-versatile`. Quiz y Examen tienen contratos y stores especializados además de la validación del proveedor.

No se considera equivalencia contractual que dos fallbacks devuelvan JSON: cada herramienta debe validar su schema y sus invariantes. Flashcards sí valida cada tarjeta después del proveedor y falla cerrado cuando un objetivo no puede representarse; la evaluación de respuestas, en cambio, degrada errores de red a una calificación parcial en el cliente.

## Estado, regeneración y continuidad

- La restauración de UI está aislada por sesión y fingerprint en las ocho herramientas.
- El servidor persiste artefactos reutilizables de Flashcards, Quiz, Examen y Análisis. Los envelopes conservan la experiencia concreta del estudiante.
- Los estados legacy de localStorage todavía aparecen en Repasar, Truquitos, Flashcards y Examen. Las migraciones observadas están condicionadas por identidad, pero amplían la superficie de restore.
- Regenerar no significa lo mismo en todas las herramientas. Flashcards reemplaza el artefacto del mismo fingerprint y, tras éxito, reinicia favoritos/posición/ronda en la copia de sesión. Truquitos conserva la versión anterior si falla la regeneración. Quiz y Examen administran generation IDs/stores.
- El progreso circular de `StudyALProcess` significa “herramienta usada con contenido”, no dominio ni finalización pedagógica.

## Consumers

- Estudiante: render e interacción en los ocho componentes.
- `StudyALProcess`: presencia de contenido en cada envelope para el porcentaje Free.
- Motor de mastery: eventos emitidos por varias experiencias; no todos los modos internos emiten evidencia equivalente.
- Notas/chat/visores: Análisis y mapas permiten profundización; varias herramientas abren evidencia/páginas.
- Stores de artifacts: restauran generaciones de Quiz, Examen y Flashcards independientemente del estado de interacción local.

## Tests localizados

Hay contratos transversales para autoridad de fuente, readiness del Brain, navegación/progreso Free, continuidad, identidad de sesión, cuota de localStorage y flujos reales de materias. Quiz y Flashcards tienen suites especializadas amplias; Examen posee contratos de generación/adaptación en su arquitectura. La existencia de tests de contrato no prueba por sí sola el camino desplegado ni materiales reales.

Huecos transversales: matriz completa de las ocho herramientas con PDF nativo/escaneado, selección parcial, 1–5 fuentes, refresh/cross-device, cambio de páginas, error/fallback de proveedor y navegación interherramienta usando el backend real.

## Código legacy o paralelo

- `/api/alai-studyal-cards` sigue teniendo callers reales desde `DocumentoView`; no es el generador del flujo Free actual de `ALAIStudyALCards`, pero sigue siendo alcanzable en producto.
- Existen `components/Flashcards.tsx`, `components/flashcards/FlashCards.tsx`, `ManualFlashcards`, `TabFlashcards` y pantallas home. No deben confundirse con el pipeline Free V2 sin verificar su caller concreto.
- Persisten migraciones desde formatos anteriores de sesión/localStorage.
- Análisis guarda tanto su resultado reutilizable como el estado por tipo de la experiencia: son responsabilidades distintas, aunque generan duplicación de representación.

## Riesgos principales

1. La fiabilidad de todas las herramientas depende de que el Brain represente correctamente páginas, OCR, fórmulas y visuales antes de que ellas se ejecuten.
2. No existe un único contrato de artifact/restore/regenerate entre herramientas; cada una resuelve continuidad de manera diferente.
3. Flashcards tiene una autoridad servidor y otra editable por sesión, con semánticas diferentes al regenerar.
4. Rutas/componentes de tarjetas antiguos siguen alcanzables fuera del flujo Free V2 y dificultan diagnosticar qué generador produjo un resultado.
5. Los fallbacks de evaluación o generación deben comprobar invariantes pedagógicos, no sólo forma JSON.

## Evidencias por archivo y símbolo

| Archivo | Símbolo / líneas relevantes | Evidencia |
|---|---|---|
| `components/materias/StudyALProcess.tsx` | `StudyALProcess`, 26–47, 95–145, 147–242 | ocho entradas, selección canónica y progreso derivado de envelopes |
| `components/materias/TemaView.tsx` | 1156–1161, 2417, 2442, 2610 | navegación y montajes principales |
| `lib/freeToolState.ts` | `readFreeToolState`, `writeFreeToolState`, 1–177 | autoridad `(sessionId,fingerprint,tool)` |
| `lib/studySessions.ts` | `persistableSnapshot`, `getSessionById`, `postSessionSnapshot` | caché local y sincronización servidor |
| `components/materias/AnalisisTeorico.tsx` | 207–238, 311–325, 470 | Brain para análisis; texto para chat; restore por tipo |
| `components/materias/ALAIStudyMap.tsx` | 1692–1714, 1995–2021 | mapa grounded y fallback de explicación |
| `components/materias/ALAIStudyALCheatCodes.tsx` | 789–806, 952–1055, 1214–1236 | Brain-only, regeneración conservadora y migración |
| `components/materias/ALAIStudyALQuizzes.tsx` | 393–430, 497–540, 943–1020, 1080–1088 | coverage/lookup/generate/advance y persistencia |
| `components/materias/ALAIStudyALExams.tsx` | 541–607, 640–666, 725–860 | generación, avance, adaptación, evaluación y restore |
| `components/materias/DocumentoView.tsx` | 113–172 | caller real de la ruta legacy de tarjetas |

## Incertidumbres

- No se ejecutó una matriz E2E real de las ocho herramientas ni se verificó telemetría de producción.
- No se midió calidad sobre materiales privados ni costos reales por proveedor.
- Debe confirmarse con Product Owner si `DocumentoView` y las pantallas de tarjetas no V2 forman parte de journeys soportados o son deuda de retirada.
- Debe verificarse qué eventos de mastery son producto esperado en cada submodo y cuáles sólo representan interacción.
