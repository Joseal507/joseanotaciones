Trabaja únicamente dentro de:

/Users/joseal/studyal

ESTADO CONFIRMADO

- TypeScript: PASS.
- Playwright original: 33/33 PASS.
- git diff --check: PASS.
- La matriz real tenía previamente 9/10 PASS.
- Después de añadir instrumentación incorrecta quedó 1/10.
- Los nueve fallos actuales no demuestran nueve uploads rotos.
- Ocho fallos, y CLUTCH 1 en la segunda corrida, llegan hasta esta assertion:

expect(uploadRequests[0].bodyBytes).toBeGreaterThan(fileSize)

pero bodyBytes recibido es 0.

- Content-Type sí coincide con:
  multipart/form-data; boundary=...

- El test de dos materiales consecutivos pasa.
- OpenRouter no debe participar.

MISIÓN ÚNICA

Corregir el bug del arnés Playwright introducido en Fase 4C y verificar de forma válida que cada archivo:

1. fue enviado una sola vez;
2. conservó nombre, MIME y tamaño;
3. llegó completo al servidor;
4. fue extraído localmente;
5. produjo contenido no vacío;
6. no llamó OpenRouter.

Después obtener:

- real materials: 10/10 PASS dos veces consecutivas;
- original E2E: 33/33 PASS;
- TypeScript PASS;
- git diff --check PASS.

No avances todavía a recorridos pedagógicos completos.

RESTRICCIONES

- No hagas commit.
- No hagas deploy.
- No uses git reset, clean, checkout, restore ni stash.
- No reviertas cambios acumulados.
- No debilites assertions válidas.
- No uses skip, fixme, only ni retries.
- No aumentes timeouts para ocultar problemas.
- No cambies los fixtures.
- No hardcodees nombres concretos.
- No uses OpenRouter.
- No toques Mastery Contracts.
- No cambies el motor pedagógico.
- No conserves una assertion basada en una API de Playwright que no expone de forma fiable el body multipart.

LEE COMPLETO

- AGENTS.md
- ADAPTIVE_ACCEPTANCE_CONTRACT.md
- PHASE_4_REAL_MATERIALS_E2E_REPORT.md
- tests/e2e-real-materials/ingestion.spec.ts
- app/e2e-real-materials/page.tsx
- app/api/e2e-real-materials/extract/route.ts
- playwright.real-materials.config.ts
- artefactos de la última ejecución
- documentación/tipos instalados de Playwright para Request.postDataBuffer, postData y multipart

DIAGNÓSTICO OBLIGATORIO

Clasifica estos hechos:

A. Producto:
- el servidor recibe y procesa correctamente la mayoría de uploads;
- la UI muestra ingestion-result;
- extracción y nombre están disponibles.

B. Arnés:
- bodyBytes se registra como 0 para todos los multipart;
- esa cifra proviene de observación de red del navegador;
- no necesariamente representa un cuerpo vacío;
- no debe usarse como prueba del tamaño transmitido sin demostrar que Playwright lo soporta.

C. Posible arranque intermitente:
- CLUTCH 1 no mostró resultado en la primera corrida;
- en la segunda sí avanzó hasta la assertion bodyBytes;
- investiga si la primera request ocurre antes de que el servidor/ruta esté listo.

CORRECCIÓN CORRECTA DEL ARNÉS

Elimina únicamente la assertion inválida que compara:

uploadRequests[0].bodyBytes

contra el tamaño del archivo, si confirmas que la API usada no expone multipart correctamente.

No la reemplaces por una assertion débil.

La prueba fuerte debe obtener los datos desde el servidor después de parsear FormData.

En app/api/e2e-real-materials/extract/route.ts, tras:

const formData = await request.formData()
const file = formData.get('file')

valida y devuelve metadata real:

- receivedName
- receivedType
- receivedSize
- bytesRead o bufferLength
- extractionChars
- extractionKind
- sourceName
- provider: local
- openRouterUsed: false

Lee los bytes realmente en el servidor:

const bytes = Buffer.from(await file.arrayBuffer())

y verifica:

- bytes.length > 0;
- bytes.length === file.size;
- nombre coincide;
- tipo permitido;
- encabezado PDF o ZIP/DOCX coherente cuando aplique.

La UI E2E debe exponer esta metadata mediante testids o atributos estables, por ejemplo:

- server-received-size
- server-buffer-length
- extraction-provider
- extraction-kind
- upload-request-count

El test debe comprobar:

- serverReceivedSize === tamaño local esperado;
- serverBufferLength === tamaño local esperado;
- ambos > 0;
- Content-Type contiene multipart boundary;
- exactamente una petición POST;
- sourceName coincide;
- extractionChars > 50 o clasificación explícita válida;
- provider === local;
- openRouterUsed === false.

No dependas de postDataBuffer del navegador para comprobar bytes multipart.

CLUTCH 1 / PRIMERA REQUEST

Después de arreglar el arnés, ejecuta CLUTCH 1 aislado al menos tres veces.

Si la primera ejecución aún falla antes de mostrar ingestion-result:

- inspecciona respuesta HTTP;
- captura JSON de error;
- confirma si el servidor estaba listo;
- revisa si la página procesa un evento change antes de hidratarse;
- revisa doble montaje o abort controller;
- revisa si la ruta todavía está compilándose;
- no aumentes timeout sin diagnóstico.

Puedes añadir una espera determinista de readiness del producto, no una pausa fija:

- data-testid="real-materials-ready";
- endpoint health listo;
- página hidratada;
- input habilitado.

El test debe esperar readiness antes de setInputFiles.

No uses waitForTimeout.

OPENROUTER

Busca en el flujo exacto:

app/e2e-real-materials
app/api/e2e-real-materials

y confirma que no puede alcanzar OpenRouter.

El test puede registrar requests externas y exigir:

openRouterRequests.length === 0

Eso sí es una assertion válida.

REPORTE

Actualiza:

PHASE_4_REAL_MATERIALS_E2E_REPORT.md

Añade:

## Fase 4D — corrección del arnés multipart

Documenta:

- por qué bodyBytes=0 no significaba cuerpo vacío;
- API de Playwright utilizada;
- causa raíz del 1/10 artificial;
- metadata server-side añadida;
- verificación real de bytes;
- estado de CLUTCH 1 aislado;
- corrida real 1;
- corrida real 2;
- E2E original;
- cero OpenRouter;
- archivos modificados.

PROCESO

1. Confirma el fallo actual.
2. Demuestra que el servidor recibe bytes aunque Playwright reporte bodyBytes=0.
3. Corrige el arnés, no el producto, salvo bug real probado.
4. Ejecuta CLUTCH 1 aislado tres veces.
5. Ejecuta suite real completa.
6. Ejecuta suite real completa por segunda vez.
7. Ejecuta originales 33.
8. Ejecuta TypeScript.
9. Ejecuta git diff --check.
10. Documenta.

VALIDACIÓN FINAL

npx tsc --noEmit

for i in 1 2 3; do
  npx playwright test \
    --config=playwright.real-materials.config.ts \
    tests/e2e-real-materials/ingestion.spec.ts \
    --grep "CLUTCH 1.pdf"
done

npm run test:e2e:real-materials
npm run test:e2e:real-materials
npm run test:e2e
git diff --check

CONDICIÓN DE SALIDA

Solo declara éxito si:

- TypeScript PASS;
- CLUTCH 1 aislado PASS tres veces;
- suite real 10/10 PASS dos veces;
- original 33/33 PASS;
- git diff --check PASS;
- metadata del servidor confirma bytes completos;
- una sola request por upload;
- cero OpenRouter;
- cero skipped;
- cero retries;
- sin commit;
- sin deploy.

Detente al finalizar.
