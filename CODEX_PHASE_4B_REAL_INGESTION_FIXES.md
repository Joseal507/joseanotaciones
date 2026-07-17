Trabaja únicamente dentro de:

/Users/joseal/studyal

ESTADO CONFIRMADO

La matriz original sigue verde:

- TypeScript: PASS
- npm run test: PASS
- Bohr: PASS
- smoke: PASS
- deterministic: PASS
- mass 1000: PASS
- Playwright original: 33/33 PASS
- git diff --check: PASS

La matriz de materiales reales quedó:

- 10 tests
- 8 PASS
- 2 FAIL

Fallos:

1. CLUTCH 1.pdf:
   Failed to parse body as FormData
   no boundary found in multipart body

2. TAREA CLUTCH 2.pdf:
   la extracción cayó en OpenRouter y recibió 402.

MISIÓN ÚNICA

Corregir únicamente la ingesta/extracción real hasta obtener:

- test:e2e:real-materials: 10/10 PASS
- Playwright original: 33/33 PASS
- TypeScript PASS
- git diff --check PASS

No construyas todavía recorridos pedagógicos completos.
No avances a sesiones reales hasta cerrar ingesta 10/10.

RESTRICCIONES ABSOLUTAS

- No hagas commit.
- No hagas deploy.
- No uses git reset.
- No uses git clean.
- No uses git checkout.
- No uses git restore.
- No uses git stash.
- No reviertas cambios acumulados.
- No elimines assertions.
- No uses skip, fixme ni only.
- No aumentes timeouts para esconder errores.
- No añadas retries.
- No sustituyas los documentos fixture.
- No reduzcas el mínimo de caracteres para fabricar PASS.
- No hardcodees contenido por nombre de archivo.
- No uses OpenRouter.
- No llames OpenRouter directa ni indirectamente.
- No añadas ninguna API de pago.
- Proveedores permitidos por el proyecto:
  - extracción local;
  - Gemini free, si ya existe una integración autorizada;
  - Cloudflare AI, si ya existe una integración autorizada.
- Para esta matriz determinista, prefiere extracción local.
- No debilites Mastery Contracts ni toques el motor pedagógico.

LEE COMPLETO

- AGENTS.md
- ADAPTIVE_ACCEPTANCE_CONTRACT.md
- PHASE_4_REAL_MATERIALS_E2E_REPORT.md
- playwright.real-materials.config.ts
- tests/e2e-real-materials/
- app/e2e-real-materials/
- app/api/e2e-real-materials/
- toda función de extracción que esas rutas reutilicen
- package.json
- logs y artefactos de los dos fallos

Artefactos:

- reports/playwright-real-materials-artifacts/ingestion-ingesta-real-CLUTCH-1-pdf-chromium/
- reports/playwright-real-materials-artifacts/ingestion-ingesta-real-TAREA-CLUTCH-2-pdf-chromium/

Revisa:

- error-context.md
- screenshots
- videos
- traces
- requests y responses

ANTES DE EDITAR

Ejecuta:

git status --short
git diff --stat
git diff --check
npx tsc --noEmit

Confirma cada fallo individualmente.

CLUTCH 1 — MULTIPART SIN BOUNDARY

Investiga la cadena exacta:

input file
→ navegador
→ página E2E
→ fetch
→ ruta extract
→ request.formData()

Regla:

Cuando se envía un objeto FormData con fetch, no se debe fijar manualmente:

Content-Type: multipart/form-data

El navegador debe generar automáticamente:

multipart/form-data; boundary=...

Busca cualquier:

headers: {
  'Content-Type': 'multipart/form-data'
}

o forwarding que copie un Content-Type inválido.

Corrige la causa mínima.

Añade una assertion o test determinista que confirme:

- request.formData() funciona;
- nombre del archivo conservado;
- bytes > 0;
- MIME coherente;
- no depende del orden de ejecución.

No conviertas el upload a JSON/base64 únicamente para evitar multipart, salvo que esa sea ya la arquitectura canónica de StudyAL.

TAREA CLUTCH 2 — OPENROUTER PROHIBIDO

Busca todas las rutas utilizadas por esta prueba y detecta cualquier llamada a:

- OpenRouter
- openrouter.ai
- proveedor llamado openrouter
- fallback que termina en OpenRouter

Para la ruta E2E de extracción real:

- elimina OpenRouter del flujo;
- no permitas fallback silencioso a OpenRouter;
- usa extracción local del PDF;
- si el PDF no contiene una capa de texto suficiente, devuelve una clasificación explícita:
  - text_pdf
  - scanned_pdf
  - extraction_failure
- no inventes texto;
- no uses OCR repetitivo;
- no fabriques más de 50 caracteres;
- no cambies el fixture.

Investiga si TAREA CLUTCH 2.pdf:

- tiene texto extraíble;
- está escaneado;
- tiene fuentes/encoding especiales;
- contiene páginas vacías;
- requiere el extractor PDF ya usado por StudyAL.

Si existe un extractor local canónico en producto, reutilízalo.
No crees un extractor paralelo inferior.

Si es un PDF escaneado y el producto todavía no soporta OCR:

- clasifícalo honestamente;
- crea un test que espere una respuesta estructurada de scanned_pdf;
- pero la matriz obligatoria debe distinguir soporte válido de fallo;
- no marques una extracción vacía como PASS;
- documenta que falta soporte de OCR.

Sin embargo, antes de concluir que es escaneado, inspecciona realmente el archivo con herramientas locales seguras como:

- pdfinfo
- pdftotext
- extracción Node ya instalada

No uses servicios externos.

ARREGLA EL CÓDIGO DE SALIDA

El script anterior mostró:

Playwright real materials: 0

aunque hubo 2 fallos.

Eso es un bug del wrapper de shell, probablemente porque $? se tomó después de tee en zsh.

No dependas del wrapper para certificar.

El estado real debe derivarse de:

npm run test:e2e:real-materials

y su exit code directo.

No cambies Playwright para adaptarse al wrapper.

REPORTE

Actualiza:

PHASE_4_REAL_MATERIALS_E2E_REPORT.md

Añade:

## Fase 4B — corrección de ingesta

Para cada fallo:

- clasificación:
  - producto;
  - arnés;
  - extracción;
  - ambiente;
- causa raíz;
- evidencia;
- cambio;
- prueba roja;
- prueba verde;
- soporte real del formato;
- proveedor utilizado;
- confirmación de que OpenRouter no participa.

Añade una búsqueda documentada de referencias a OpenRouter en el flujo modificado.

VALIDACIÓN OBLIGATORIA

Ejecuta:

npx tsc --noEmit
npm run test:e2e:real-materials
npm run test:e2e
git diff --check

CONDICIÓN DE SALIDA

Solo declara éxito si:

- TypeScript PASS;
- materiales reales 10/10 PASS;
- originales 33/33 PASS;
- git diff --check PASS;
- cero skipped;
- cero retries;
- ninguna llamada a OpenRouter en esta matriz;
- reporte actualizado;
- sin commit;
- sin deploy.

Si TAREA CLUTCH 2 es realmente escaneado y no existe OCR local:

- no inventes PASS;
- deja la clasificación exacta;
- no llames OpenRouter;
- documenta el bloqueo;
- detente sin avanzar a recorridos pedagógicos.

Detente al cerrar esta misión.
