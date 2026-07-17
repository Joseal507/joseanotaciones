Trabaja únicamente dentro de:

/Users/joseal/studyal

ESTADO CONFIRMADO

- TypeScript: PASS
- Playwright original: 33/33 PASS
- Playwright materiales reales: 9/10 PASS
- git diff --check: PASS
- TAREA CLUTCH 2.pdf ya fue corregido y pasa.
- OpenRouter no debe participar.
- Solo falla CLUTCH 1.pdf.

ERROR EXACTO

La ruta recibe una petición que falla en:

request.formData()

con:

Failed to parse body as FormData
no boundary found in multipart body

El test termina sin encontrar:

data-testid="ingestion-result"

MISIÓN ÚNICA

Corregir exclusivamente el último fallo de ingesta:

CLUTCH 1.pdf

hasta obtener:

- materiales reales: 10/10 PASS;
- Playwright original: 33/33 PASS;
- TypeScript PASS;
- git diff --check PASS.

No avances todavía a recorridos pedagógicos completos.
No modifiques el motor adaptativo.

RESTRICCIONES ABSOLUTAS

- No hagas commit.
- No hagas deploy.
- No uses git reset.
- No uses git clean.
- No uses git checkout.
- No uses git restore.
- No uses git stash.
- No reviertas cambios acumulados.
- No sustituyas CLUTCH 1.pdf.
- No cambies el contenido del fixture.
- No elimines assertions.
- No uses skip, fixme ni only.
- No aumentes timeouts para ocultar el fallo.
- No añadas retries.
- No hardcodees una excepción por nombre de archivo.
- No conviertas una extracción fallida en PASS.
- No uses OpenRouter.
- No llames servicios de pago.
- No cambies Mastery Contracts.
- No toques lógica pedagógica no relacionada.
- No aceptes que 9/10 sea suficiente.

LEE COMPLETO ANTES DE EDITAR

- AGENTS.md
- ADAPTIVE_ACCEPTANCE_CONTRACT.md
- PHASE_4_REAL_MATERIALS_E2E_REPORT.md
- playwright.real-materials.config.ts
- tests/e2e-real-materials/ingestion.spec.ts
- app/e2e-real-materials/
- app/api/e2e-real-materials/extract/route.ts
- helpers utilizados por la página y por la ruta
- cualquier middleware que afecte /api/e2e-real-materials/
- cualquier wrapper de fetch usado por esa página
- package.json

Inspecciona los artefactos:

reports/playwright-real-materials-artifacts/ingestion-ingesta-real-CLUTCH-1-pdf-chromium/

Incluyendo:

- error-context.md
- screenshot
- video
- trace.zip
- request y response de red
- console logs

ANTES DE EDITAR

Ejecuta:

git status --short
git diff --stat
git diff --check
npx tsc --noEmit

Después confirma el fallo aislado:

npx playwright test \
  --config=playwright.real-materials.config.ts \
  tests/e2e-real-materials/ingestion.spec.ts \
  --grep "CLUTCH 1.pdf"

DIAGNÓSTICO OBLIGATORIO

No asumas automáticamente que CLUTCH 1.pdf está dañado.

Primero determina:

1. Cuántas peticiones POST se producen al seleccionar el archivo.
2. Content-Type exacto de cada petición.
3. Si contiene boundary.
4. Content-Length o tamaño efectivo del body.
5. Nombre, MIME y bytes del archivo antes de fetch.
6. Si onChange se dispara más de una vez.
7. Si React Strict Mode causa doble efecto.
8. Si existe una petición inicial vacía.
9. Si el código reutiliza un FormData consumido.
10. Si un wrapper de fetch sobrescribe headers.
11. Si middleware elimina o modifica Content-Type.
12. Si el primer request de una suite se comporta distinto por warm-up.
13. Si el fallo depende del orden de los tests.
14. Si CLUTCH 1 pasa cuando se ejecuta solo.
15. Si otro material falla cuando se coloca primero.

PRUEBAS DE AISLAMIENTO OBLIGATORIAS

Ejecuta y documenta:

A. CLUTCH 1 solo.

B. La suite completa.

C. CLUTCH 1 después de otro archivo.

D. Otro archivo colocado temporalmente como primer caso, sin debilitar las assertions.

La finalidad es determinar si el bug es:

- específico del archivo;
- específico del primer upload;
- doble request;
- FormData consumido;
- header incorrecto;
- race de inicialización;
- bug de ruta;
- bug del test.

No dejes modificaciones temporales de orden sin justificación.

CONTRATO MULTIPART CORRECTO

En cliente:

const formData = new FormData()
formData.append('file', file)

await fetch('/api/e2e-real-materials/extract', {
  method: 'POST',
  body: formData,
})

No debe establecerse manualmente:

Content-Type: multipart/form-data

El navegador debe crear:

multipart/form-data; boundary=...

No reutilices el mismo FormData entre dos fetch.

No llames fetch con un FileList, evento React o body ya consumido.

CONTRATO DE LA RUTA

Antes de ejecutar request.formData():

- inspecciona Content-Type;
- si no contiene multipart/form-data y boundary válido, devuelve 400 JSON estructurado;
- no permitas que una excepción sin manejar derribe la respuesta;
- registra diagnóstico seguro sin volcar contenido del documento.

Ejemplo de respuesta válida ante request malformado:

{
  "ok": false,
  "code": "INVALID_MULTIPART_REQUEST",
  "message": "Missing multipart boundary"
}

Pero el objetivo no es esconder la petición mala: debes corregir por qué el cliente la genera.

No conviertas automáticamente un request inválido a otro formato.

ARCHIVO REAL

Inspecciona CLUTCH 1.pdf localmente:

- tamaño > 0;
- encabezado PDF válido;
- MIME;
- lectura de bytes;
- nombre con espacios;
- permisos.

Comandos posibles:

ls -lh "tests/fixtures/real-materials/CLUTCH 1.pdf"
file "tests/fixtures/real-materials/CLUTCH 1.pdf"
xxd -l 16 "tests/fixtures/real-materials/CLUTCH 1.pdf"

No modifiques el archivo.

TEST DE REGRESIÓN

Añade una prueba estable que demuestre la causa raíz, por ejemplo:

- el primer upload de una sesión produce exactamente un request válido;
- no se emite request vacío;
- Content-Type incluye boundary;
- dos uploads consecutivos tienen bodies independientes;
- CLUTCH 1 conserva nombre, bytes y MIME.

El test debe proteger el bug real, no solamente el nombre CLUTCH 1.

OPENROUTER

Confirma que el flujo utilizado por:

/api/e2e-real-materials/extract

no contiene ni alcanza:

- OpenRouter;
- openrouter.ai;
- fallback OpenRouter.

No necesitas eliminar referencias históricas no ejecutadas en otras partes del repositorio en esta misión, pero documenta cualquier referencia que pudiera alcanzar este flujo.

REPORTE

Actualiza:

PHASE_4_REAL_MATERIALS_E2E_REPORT.md

Añade:

## Fase 4C — último fallo multipart

Incluye:

- causa raíz confirmada;
- por qué solo fallaba CLUTCH 1 o el primer caso;
- requests observados;
- Content-Type antes y después;
- cambio aplicado;
- test rojo;
- test verde aislado;
- suite 10/10;
- regresión 33/33;
- confirmación de cero OpenRouter en el flujo;
- archivos modificados.

PROCESO

1. Confirma rojo aislado.
2. Identifica la causa con evidencia.
3. Añade o ajusta un test que represente la causa.
4. Aplica el cambio mínimo.
5. Ejecuta CLUTCH 1 aislado.
6. Ejecuta la suite real completa al menos dos veces consecutivas.
7. Ejecuta Playwright original.
8. Ejecuta TypeScript.
9. Ejecuta git diff --check.
10. Documenta.

La doble ejecución de la suite real es obligatoria para detectar dependencia del primer request u orden.

VALIDACIÓN FINAL EXACTA

npx tsc --noEmit

npm run test:e2e:real-materials

npm run test:e2e:real-materials

npm run test:e2e

git diff --check

CONDICIÓN DE SALIDA

Solo declara éxito si:

- TypeScript PASS;
- primera ejecución real: 10/10 PASS;
- segunda ejecución real: 10/10 PASS;
- Playwright original: 33/33 PASS;
- git diff --check PASS;
- cero skipped;
- cero retries;
- cero OpenRouter en el flujo;
- reporte actualizado;
- sin commit;
- sin deploy.

Si todavía falla:

- no declares éxito;
- deja causa y evidencia exactas;
- no avances a sesiones reales;
- detente sin commit ni deploy.

Detente al completar esta misión.
