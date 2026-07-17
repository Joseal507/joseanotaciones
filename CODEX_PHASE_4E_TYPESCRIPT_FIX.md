Trabaja únicamente dentro de:

/Users/joseal/studyal

ESTADO CONFIRMADO

- CLUTCH 1 aislado: PASS 3 veces.
- Materiales reales run 1: 10/10 PASS.
- Materiales reales run 2: 10/10 PASS.
- Playwright original: 33/33 PASS.
- git diff --check: PASS.
- Solo falla TypeScript.

ERROR EXACTO

app/api/e2e-real-materials/extract/route.ts(13,7):

Type '{ pdf: string; docx: string; }' is missing the following properties from type 'Record<MaterialKind, string>':
pptx, txt, image, audio

MISIÓN ÚNICA

Corregir exclusivamente este error TypeScript sin romper:

- materiales reales 10/10;
- Playwright original 33/33;
- extracción local;
- cero OpenRouter;
- metadata server-side;
- contrato multipart.

RESTRICCIONES

- No hagas commit.
- No hagas deploy.
- No uses git reset, clean, checkout, restore ni stash.
- No reviertas cambios acumulados.
- No cambies el motor pedagógico.
- No debilites tests.
- No uses skip, fixme, only ni retries.
- No elimines tipos para silenciar el error.
- No uses any.
- No conviertas el mapa a Record<string, string> sin justificarlo.
- No añadas soporte falso para formatos que la ruta no procesa.
- No llames OpenRouter.

DIAGNÓSTICO

Lee completos:

- app/api/e2e-real-materials/extract/route.ts
- definición de MaterialKind
- helpers de detección de formato
- tests/e2e-real-materials/ingestion.spec.ts
- PHASE_4_REAL_MATERIALS_E2E_REPORT.md

Determina cuál corrección es semánticamente correcta:

A. Si el mapa solo aplica a formatos soportados por esta ruta:
   tiparlo como:

   Partial<Record<MaterialKind, string>>

   o como:

   Record<Extract<MaterialKind, 'pdf' | 'docx'>, string>

   según el uso real.

B. Si la ruta debe manejar todos los MaterialKind:
   añadir valores reales y correctos para pptx, txt, image y audio,
   únicamente si existe soporte verdadero.

No añadas entradas ficticias.

Preferencia:

- usa un tipo restringido al subconjunto realmente soportado;
- valida formatos no soportados explícitamente;
- devuelve error estructurado para tipos no soportados;
- conserva pdf y docx funcionando.

No uses cast:

as Record<MaterialKind, string>

para esconder el error.

PROCESO

1. Ejecuta npx tsc --noEmit y confirma rojo.
2. Corrige el tipo de manera semántica.
3. Ejecuta npx tsc --noEmit hasta verde.
4. Ejecuta test de materiales reales.
5. Ejecuta Playwright original.
6. Ejecuta git diff --check.
7. Actualiza PHASE_4_REAL_MATERIALS_E2E_REPORT.md con una sección:

## Fase 4E — cierre TypeScript

Incluye:

- causa raíz;
- tipo anterior;
- tipo final;
- por qué no se añadió soporte falso;
- TypeScript PASS;
- real materials 10/10;
- original 33/33;
- cero OpenRouter.

VALIDACIÓN FINAL

npx tsc --noEmit
npm run test:e2e:real-materials
npm run test:e2e
git diff --check

CONDICIÓN DE SALIDA

Solo declara éxito si:

- TypeScript PASS;
- real materials 10/10 PASS;
- original 33/33 PASS;
- git diff --check PASS;
- cero skipped;
- cero retries;
- sin OpenRouter;
- sin commit;
- sin deploy.

Detente al cerrar esta misión.
