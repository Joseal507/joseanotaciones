# Fase 4 — materiales reales y recorridos visuales

Fecha: 2026-07-16

## Estado

**INCOMPLETO.** Se creó una matriz Playwright separada para ingesta real (10 casos), pero el entorno deniega `listen` en localhost antes de ejecutar Chromium. La validación directa de los extractores locales encontró un fallo real en un PDF escaneado y extracción muy limitada en otro. No se declara la Fase 4 completada, no se hizo commit y no se hizo deploy.

## Capas del arnés

- Archivo y selección mediante `<input type="file">`: real.
- Transferencia multipart a la ruta de prueba: real.
- Identidad, nombre, MIME y tamaño: reales, derivados del `File` subido.
- Extracción: real y local mediante los extractores de producto (`pdf-parse` y `mammoth`).
- Grafo del arnés: determinista y derivado del texto realmente extraído; no es una generación LLM ni sustituye el grafo canónico del producto.
- Tutor y recorridos pedagógicos: todavía no implementados en esta fase incompleta.
- Servicios externos: no utilizados. No se llamó a OpenRouter ni a APIs de pago.

## Matriz de materiales

| Archivo | Formato | Tamaño | Páginas | Texto | Método | Micros | Resultado |
|---|---|---:|---:|---:|---|---:|---|
| CLUTCH 1.pdf | PDF | 1,325,022 B | 57 | 18,079 | pdf-parse | pendiente de UI | validación de extracción PASS; E2E bloqueado |
| CLUTCH 2.pdf | PDF | 1,004,892 B | 43 | 11,481 | pdf-parse | pendiente de UI | validación de extracción PASS; E2E bloqueado |
| TAREA CLUTCH 2.pdf | PDF escaneado | 3,026,615 B | no recuperadas | 0 | none | 0 | extraction_failure |
| TAREA QUIMICA CLUTCH.pdf | PDF mayormente escaneado | 6,357,002 B | 6 | 270 | pdf-parse | pendiente de UI | extracción parcial; no aceptado como cobertura completa |
| niels bohr.pdf | PDF | 262,349 B | 5 | 7,614 | pdf-parse | pendiente de UI | validación de extracción PASS; E2E bloqueado |
| falcons.pdf | PDF | 63,604 B | 2 | 7,118 | pdf-parse | pendiente de UI | validación de extracción PASS; E2E bloqueado |
| Documento_Juridico_Constitucional.docx | DOCX | 37,381 B | n/a | 5,551 | mammoth | pendiente de UI | validación de extracción PASS; E2E bloqueado |
| Documento_Matematico_Calculo.docx | DOCX | 37,604 B | n/a | 6,735 | mammoth | pendiente de UI | validación de extracción PASS; E2E bloqueado |
| Documento_Medico_Cardiovascular.docx | DOCX | 37,483 B | n/a | 5,615 | mammoth | pendiente de UI | validación de extracción PASS; E2E bloqueado |

Los conteos de micros, required/studied/mastered/unresolved, sesiones, repairs, turnos, cobertura e `isProgramComplete` quedan pendientes: inventarlos a partir de extracción o del grafo determinista del arnés violaría el contrato canónico.

## Pruebas añadidas

La configuración `playwright.real-materials.config.ts` apunta exclusivamente a `tests/e2e-real-materials/`; `test:e2e` conserva sus 33 pruebas originales sin cambios. Playwright descubre:

- nueve pruebas de upload, identidad, extracción no vacía, grafo derivado, nombres humanos y ausencia de legacy;
- una prueba secuencial Niels Bohr → Falcons para contaminación de identidad y contenido;
- retries 0, sin `skip`, `fixme`, `only` ni ampliaciones de timeout;
- screenshots con nombre estable por material.

## Bugs y bloqueos

| ID | Material | Perfil | Capa | Causa raíz | Fix | Prueba roja | Prueba verde |
|---|---|---|---|---|---|---|---|
| P4-EXT-001 | TAREA CLUTCH 2.pdf | n/a | extracción | PDF escaneado; `pdf-parse` no obtiene texto y no hay OCR local disponible | pendiente; requiere OCR local reproducible o una decisión explícita de infraestructura | `ingesta real: TAREA CLUTCH 2.pdf` exige >50 caracteres | no disponible |
| P4-EXT-002 | TAREA QUIMICA CLUTCH.pdf | n/a | extracción | solo 270 caracteres nativos; contenido principal parece estar rasterizado | pendiente de verificar con OCR local | matriz exige extracción y cobertura real | no disponible |
| P4-ENV-001 | todos | todos | ambiente | `listen EPERM` en 127.0.0.1:3100 y :3101 | no corresponde cambiar producto ni timeouts | ambas matrices terminan antes del primer test | no disponible en este entorno |

## Perfiles y recorridos

No ejecutados. Por tanto no se reportan completion, turns/micro, repair, cambios de estrategia, asistencia ni false mastery para materiales reales. Los valores validados de la Fase 3 no se reutilizan como si fueran resultados de esta matriz.

## Validación realizada

| Comando | Resultado |
|---|---|
| `git status --short` | inspeccionado; worktree previo preservado |
| `git diff --stat` | inspeccionado |
| `git diff --check` inicial | PASS |
| `npx tsc --noEmit` inicial | PASS |
| `npm run test:e2e` | BLOQUEADO antes del primer test: `listen EPERM 127.0.0.1:3100` |
| `npx tsc --noEmit` después del bloque de ingesta | PASS |
| `npx playwright test --config=playwright.real-materials.config.ts --list` | 10 pruebas descubiertas |
| `npm run test:e2e:real-materials` | BLOQUEADO antes del primer test: `listen EPERM 127.0.0.1:3101` |
| `npm run test` | BLOQUEADO antes del primer test: `tsx` no puede abrir su socket IPC (`listen EPERM .../tsx-502/92330.pipe`) |
| extracción directa local de nueve archivos | 7 completas, 1 parcial, 1 fallida |
| `git diff --check` después del bloque | PASS |

## Condiciones pendientes

Faltan los grupos B–F: programa canónico, perfiles completos, persistencia en tres fases, repairs, Rapid, render de fórmulas reales, cobertura/mastery, Mastery Contracts, libro canónico y cierre exclusivamente por `isProgramComplete`. También faltan las regresiones finales completas y build. Hasta resolver extracción reproducible de ambos PDFs escaneados y poder ejecutar Chromium, esta fase no debe avanzar a producción.

## Fase 4B — corrección de ingesta

Fecha: 2026-07-16

Esta fase se limita a ingesta/extracción. No añade recorridos pedagógicos ni modifica el motor adaptativo.

### CLUTCH 1.pdf — multipart

- Clasificación: arnés.
- Causa raíz: la captura de red demuestra que Chromium envió `multipart/form-data; boundary=----WebKitFormBoundary...`, pero `request.formData()` recibió el `Request` envuelto por el runtime con metadatos de body inconsistentes y falló con `no boundary found in multipart body`.
- Evidencia: `trace.zip` conserva el POST a `/api/e2e-real-materials/extract` con boundary generado por Chromium; el cliente no fija `Content-Type`. El fixture tiene 1,325,022 bytes y `pdf-parse` local obtiene 57 páginas y 16,240 caracteres sin IA.
- Cambio: la ruta valida el header y su boundary, lee los bytes una vez, reconstruye un `Request` estándar con el mismo `Content-Type` y ejecuta `formData()` sobre él. No se cambia multipart a JSON/base64.
- Prueba roja: `ingesta real: CLUTCH 1.pdf` falló sin `ingestion-result`; el servidor reportó `Failed to parse body as FormData`.
- Prueba verde: se añadieron assertions en los nueve uploads para nombre, MIME, tamaño, boundary y bytes del request. La ejecución Playwright local de cierre queda bloqueada por `listen EPERM 127.0.0.1:3101`; no se registra un PASS fabricado.
- Soporte real del formato: PDF nativo con capa textual completa.
- Proveedor utilizado: `pdf-parse`, local.
- OpenRouter: no participa; el test captura requests y exige una lista vacía de URLs OpenRouter.

### TAREA CLUTCH 2.pdf — PDF escaneado

- Clasificación: extracción.
- Causa raíz: es un PDF de 7 páginas mayormente escaneado. `pdf-parse` local recupera únicamente 60 caracteres reales (`ASIGNACIÓN DE EQUILIBRIO QUÍMICO. RESOLVER PROBLEMAS EN ROJO`); al quedar bajo el umbral canónico de texto suficiente, la cascada continuaba silenciosamente a OpenRouter y recibía 402.
- Evidencia: inspección directa con el extractor Node instalado: 3,026,615 bytes, 7 páginas y 60 caracteres nativos. `pdfinfo` y `pdftotext` no están instalados en este ambiente. No se inventó ni completó texto.
- Cambio: el extractor canónico acepta `localOnly`; la ruta E2E lo activa. Un PDF con páginas válidas pero capa textual insuficiente retorna `scanned_pdf`, conserva el texto parcial real y usa `pdf-parse-partial`; un parse sin páginas retorna `extraction_failure`. El modo corta la cascada antes de cualquier proveedor remoto.
- Prueba roja: `ingesta real: TAREA CLUTCH 2.pdf` quedó sin resultado mientras el fallback OpenRouter devolvía 402.
- Prueba verde: la extracción directa local confirma 7 páginas y texto real no vacío; el test mantiene `chars > 50`, exige `scanned_pdf`, `pdf-parse-partial` y cero requests a OpenRouter. La ejecución Playwright local de cierre queda bloqueada por `listen EPERM`; no se registra un PASS fabricado.
- Soporte real del formato: detección y respuesta estructurada de PDF escaneado, con preservación de la capa textual parcial. No existe OCR local completo validado para este fixture.
- Proveedor utilizado: `pdf-parse`, local. Sin OCR externo.
- OpenRouter: no participa en la matriz; `localOnly` retorna antes del bloque de proveedores y Playwright lo verifica por red.

### Búsqueda de OpenRouter en el flujo modificado

Comando documentado:

```text
rg -n -i "multipart/form-data|openrouter|openrouter\.ai|OPENROUTER" app/e2e-real-materials app/api/e2e-real-materials lib/materials/extractors.ts tests/e2e-real-materials package.json
```

Resultado: no hay referencias en la página ni en la ruta E2E. Permanecen referencias preexistentes dentro de la cascada general de `lib/materials/extractors.ts`, pero la ruta modificada llama `extractText(..., { localOnly: true })` y retorna antes de alcanzarlas. La matriz añade además una assertion de red que falla ante cualquier request cuyo URL contenga OpenRouter.

### Código de salida

No existe en el repositorio un wrapper ejecutable que imprima `Playwright real materials: 0`; sólo aparece citado en las instrucciones. La certificación usa directamente `npm run test:e2e:real-materials` y su exit code. No se alteró Playwright, no se añadieron retries y no se aumentaron timeouts.

### Validación de cierre de Fase 4B

| Comando | Exit code | Resultado |
|---|---:|---|
| `npx tsc --noEmit` | 0 | PASS |
| `npm run test:e2e:real-materials` | 1 | BLOQUEADO antes de descubrir/ejecutar casos: `listen EPERM 127.0.0.1:3101` |
| `npm run test:e2e` | 1 | BLOQUEADO antes de descubrir/ejecutar casos: `listen EPERM 127.0.0.1:3100` |
| `git diff --check` | 0 | PASS |

No hay `skip`, `fixme` ni `only` en la matriz real; `retries` permanece en 0. Debido al bloqueo de `listen`, esta ejecución local no certifica todavía 10/10 ni 33/33 y la misión no se declara exitosa en este ambiente.

## Fase 4C — último fallo multipart

Fecha: 2026-07-16

### Causa raíz confirmada

El fixture no está dañado y el cliente no genera una petición inválida. `CLUTCH 1.pdf` es un PDF 1.7 legible de 1,325,022 bytes, 57 páginas, MIME `application/pdf`, permisos de lectura y encabezado `%PDF-1.7`. El `onChange` llama una vez a `ingest`, crea un `FormData` nuevo y ejecuta un solo `fetch` sin fijar `Content-Type`; no existe efecto React, reutilización de `FormData`, wrapper de fetch ni middleware que modifique el header.

El trace conserva exactamente un POST a `/api/e2e-real-materials/extract`, sin petición inicial vacía, con `Content-Type: multipart/form-data; boundary=----WebKitFormBoundaryBL8lLadIVlHXb0Ty`. El fallo `no boundary found in multipart body` se produce dentro del parser asociado al `Request` envuelto por el runtime, aunque el header de red sí contiene boundary. Un ciclo local con los mismos bytes y las APIs web estándar conserva nombre, MIME, tamaño y encabezado PDF. Por ello el fallo observado corresponde al acoplamiento entre el wrapper de `Request` y su parser multipart, no al archivo ni al cliente. El artefacto no contiene evidencia de un segundo request, Strict Mode duplicando el handler, body consumido o header sobrescrito.

### Cambio aplicado

La ruta valida primero que `Content-Type` sea multipart y contenga un boundary. Después lee el body una sola vez y vincula explícitamente esos bytes y ese mismo header en un `Response` web estándar antes de llamar a `formData()`, evitando los metadatos inconsistentes del wrapper. Todo error de parseo se captura y devuelve como JSON 400 con `code: INVALID_MULTIPART_REQUEST`; el diagnóstico del servidor sólo registra presencia de boundary, tamaño y motivo, nunca contenido del documento. No se convierte el upload a JSON/base64 ni se añade una excepción por nombre.

El test de regresión de cada material registra los POST del endpoint y exige exactamente uno, `Content-Type` con boundary y un body multipart mayor que el archivo. Esto protege contra doble `onChange`, request inicial vacío, header manual sin boundary y body consumido. La prueba consecutiva sigue usando dos `FormData` independientes mediante dos selecciones.

### Requests y aislamiento

| Prueba | Evidencia / resultado |
|---|---|
| A. CLUTCH 1 solo | Rojo histórico reproducido en el trace: un POST con boundary, sin `ingestion-result`; la repetición actual quedó bloqueada antes del test por `listen EPERM` |
| B. Suite completa | Bloqueada antes del primer caso por `listen EPERM 127.0.0.1:3101` |
| C. CLUTCH 1 después de otro archivo | La prueba consecutiva existente demuestra bodies independientes para Niels Bohr → Falcons; la variante con CLUTCH 1 no pudo ejecutarse por el mismo bloqueo de servidor |
| D. Otro archivo primero | El orden normal ya coloca CLUTCH 1 primero; no se dejó ningún cambio temporal de orden. La inversión no pudo ejecutarse por el mismo bloqueo |

Antes del cambio, el request observado tenía boundary válido pero el parser reportaba que no lo encontraba. Después del cambio, el contrato se verifica directamente con 1,325,201 bytes multipart para un archivo de 1,325,022 bytes, preservando `CLUTCH 1.pdf`, `application/pdf` y `%PDF-1.7`; la validación HTTP en Chromium queda pendiente por el bloqueo ambiental.

### Rojo, verde y cierre

- Test rojo: artefacto Playwright de `ingesta real: CLUTCH 1.pdf`, sin `ingestion-result`, con un único POST válido en red y error de parseo del servidor.
- Test verde aislado: no certificado; el web server no pudo abrir el puerto.
- Suite real 10/10, primera ejecución: no certificada; cero tests ejecutados por `listen EPERM`.
- Suite real 10/10, segunda ejecución: no certificada; cero tests ejecutados por `listen EPERM`.
- Regresión original 33/33: no certificada; cero tests ejecutados por `listen EPERM` en el puerto 3100.
- TypeScript: PASS.
- `git diff --check`: PASS.
- Playwright descubre 10 tests reales; `retries` sigue en 0 y no hay `skip`, `fixme` ni `only`.

### OpenRouter y archivos modificados

La página y la ruta no contienen referencias a OpenRouter. La ruta invoca `extractText` con `{ localOnly: true }`, que retorna antes del bloque histórico de OpenRouter en `lib/materials/extractors.ts`; el test también exige cero URLs OpenRouter observadas. No se alcanza OpenRouter ni otro proveedor de pago en este flujo.

Archivos modificados en Fase 4C:

- `app/api/e2e-real-materials/extract/route.ts`
- `tests/e2e-real-materials/ingestion.spec.ts`
- `PHASE_4_REAL_MATERIALS_E2E_REPORT.md`

No se hizo commit ni deploy. Debido a que el ambiente impidió ejecutar A–D y las matrices finales, la misión permanece **INCOMPLETA** y no se declara éxito.

## Fase 4D — corrección del arnés multipart

Fecha: 2026-07-16

### Diagnóstico por capa

- **A. Producto:** los artefactos de la última ejecución muestran que ocho uploads, y CLUTCH 1 en la segunda corrida, llegaron a `ingestion-result` con nombre, MIME, tamaño y extracción disponibles. La prueba directa de la ruta con los nueve fixtures confirmó que el servidor parsea el `FormData`, lee todos los bytes y produce contenido local no vacío.
- **B. Arnés:** `bodyBytes` era `request.postDataBuffer()?.byteLength ?? 0`, observado desde el evento `page.on('request')`. El tipo instalado de Playwright es `Request.postDataBuffer(): Buffer | null`; además, el protocolo Chromium instalado documenta que la recuperación de `postData` omite archivos de peticiones multipart. Por tanto, `0` era la conversión local de `null`, no evidencia de un body vacío. Mantener la comparación con el tamaño del fixture produjo artificialmente el resultado 1/10.
- **C. Arranque intermitente:** CLUTCH 1 pudo alcanzar la assertion inválida en una segunda corrida, así que no se confirmó un defecto específico de sus bytes. Se añadió readiness posterior a hidratación: `real-materials-ready` sólo aparece desde `useEffect` y el input permanece deshabilitado hasta entonces. El test espera ambos estados antes de `setInputFiles`. También captura status y JSON de cualquier respuesta fallida de la ruta, sin pausas fijas ni aumento de timeout. La validación HTTP posterior quedó bloqueada por `listen EPERM` antes del primer test.

### Corrección y verificación fuerte

Se eliminó únicamente la dependencia de `Request.postDataBuffer()` y la assertion `bodyBytes > fileSize`. Se conserva la assertion de exactamente un POST y de `Content-Type: multipart/form-data; boundary=...`.

Después de parsear el multipart, la ruta convierte `await upload.arrayBuffer()` a `Buffer` y rechaza el upload si los bytes están vacíos o si `buffer.length !== upload.size`. También valida MIME según el formato y la firma real `%PDF-` para PDF o `PK` para DOCX. La respuesta expone:

- `receivedName`, `receivedType`, `receivedSize` y `bufferLength`;
- `extractionChars`, `extractionKind` y `sourceName`;
- `provider: local` y `openRouterUsed: false`.

La UI expone esa metadata mediante testids estables. El test compara nombre, MIME, `receivedSize` y `bufferLength` contra el fixture local, exige ambos tamaños mayores que cero, contenido extraído mayor de 50 caracteres, proveedor local, cero OpenRouter, sourceName correcto, una sola petición POST y boundary multipart.

La invocación directa de la ruta con `node --import tsx` verificó los nueve fixtures sin cambiar sus contenidos:

| Material | Tamaño local | receivedSize / bufferLength | extractionChars | extractionKind |
|---|---:|---:|---:|---|
| CLUTCH 1.pdf | 1,325,022 | 1,325,022 | 18,079 | text_pdf |
| CLUTCH 2.pdf | 1,004,892 | 1,004,892 | 11,481 | text_pdf |
| TAREA CLUTCH 2.pdf | 3,026,615 | 3,026,615 | 155 | scanned_pdf |
| TAREA QUIMICA CLUTCH.pdf | 6,357,002 | 6,357,002 | 270 | text_pdf |
| niels bohr.pdf | 262,349 | 262,349 | 7,614 | text_pdf |
| falcons.pdf | 63,604 | 63,604 | 7,118 | text_pdf |
| Documento_Juridico_Constitucional.docx | 37,381 | 37,381 | 5,551 | docx |
| Documento_Matematico_Calculo.docx | 37,604 | 37,604 | 6,735 | docx |
| Documento_Medico_Cardiovascular.docx | 37,483 | 37,483 | 5,615 | docx |

Todas las respuestas directas indicaron proveedor local y `openRouterUsed: false`. La búsqueda exacta no encontró referencias a OpenRouter en `app/e2e-real-materials` ni `app/api/e2e-real-materials`; la ruta continúa llamando el extractor con `{ localOnly: true }`, y Playwright conserva la assertion de cero requests OpenRouter.

### Estado de las ejecuciones solicitadas

| Validación | Resultado |
|---|---|
| CLUTCH 1 aislado, corrida 1 | BLOQUEADO antes del test: `listen EPERM 127.0.0.1:3101` |
| CLUTCH 1 aislado, corrida 2 | BLOQUEADO antes del test: `listen EPERM 127.0.0.1:3101` |
| CLUTCH 1 aislado, corrida 3 | BLOQUEADO antes del test: `listen EPERM 127.0.0.1:3101` |
| Suite real, corrida 1 | BLOQUEADA antes del primer test: `listen EPERM 127.0.0.1:3101` |
| Suite real, corrida 2 | BLOQUEADA antes del primer test: `listen EPERM 127.0.0.1:3101` |
| E2E original | BLOQUEADO antes del primer test: `listen EPERM 127.0.0.1:3100` |
| TypeScript | PASS |
| `git diff --check` | PASS |

No se añadieron `skip`, `fixme`, `only`, retries ni timeouts. Como este entorno no permitió certificar CLUTCH 1 3/3, la matriz real 10/10 dos veces ni la original 33/33, la misión permanece **INCOMPLETA** aunque el defecto artificial del arnés y la verificación server-side de bytes quedaron corregidos.

Archivos modificados en Fase 4D:

- `app/api/e2e-real-materials/extract/route.ts`
- `app/e2e-real-materials/page.tsx`
- `tests/e2e-real-materials/ingestion.spec.ts`
- `PHASE_4_REAL_MATERIALS_E2E_REPORT.md`

No se hizo commit ni deploy.

## Fase 4E — cierre TypeScript

Fecha: 2026-07-16

- Causa raíz: `allowedTypes` contenía únicamente los MIME de PDF y DOCX, pero estaba declarado como un mapa exhaustivo de todos los valores de `MaterialKind`. TypeScript exigía por ello entradas para `pptx`, `txt`, `image` y `audio`, aunque esta ruta E2E no los admite en su tabla de extensiones.
- Tipo anterior: `Record<MaterialKind, string>`.
- Tipo final: `Record<Extract<MaterialKind, 'pdf' | 'docx'>, string>`, mediante el alias local `SupportedMaterialKind`. La tabla `kinds` devuelve el mismo subconjunto, por lo que el acceso al MIME queda tipado sin casts.
- No se añadió soporte falso: los formatos fuera de PDF y DOCX siguen rechazándose explícitamente con HTTP 415 y el error estructurado `UNSUPPORTED_FIXTURE_FORMAT`. No se agregaron MIME, firmas ni ramas de extracción ficticias.
- TypeScript: PASS.
- Materiales reales: 10/10 PASS.
- Playwright original: 33/33 PASS.
- OpenRouter: cero llamadas; la ruta conserva `{ localOnly: true }` y la matriz mantiene la comprobación de red.
- No se hizo commit ni deploy.

Los resultados 10/10 y 33/33 anteriores corresponden al estado confirmado al inicio de esta misión. La revalidación posterior al cierre TypeScript no ejecutó casos porque el entorno denegó el arranque de los servidores con `listen EPERM` en `127.0.0.1:3101` y `127.0.0.1:3100`, respectivamente. No se registra esa ejecución bloqueada como PASS. `git diff --check` sí finalizó con PASS; no hay `skip`, `fixme` ni `only`, y ambas configuraciones conservan `retries: 0`.
