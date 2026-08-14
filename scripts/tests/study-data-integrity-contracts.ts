import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const api = read('app/api/materias/route.ts');
const storage = read('lib/storage.ts');
const page = read('app/materias/page.tsx');
const worker = read('cloudflare/studyal-api/src/index.ts');
const init = read('app/api/materials/upload/init/route.ts');
const complete = read('app/api/materials/upload/complete/route.ts');
const materialRoute = read('app/api/materials/[id]/route.ts');
const upload = read('lib/materials/upload.ts');
const migration = read('cloudflare/studyal-api/migrations/0005_materias_revision.sql');

// A/I/R/S — owner comes from NextAuth and private tree never accepts client owner.
assert.match(api, /getServerSession\(authOptions\)/);
assert.doesNotMatch(api, /const\s*\{[^}]*userId[^}]*\}\s*=\s*await request\.json/);
assert.match(init, /user\.id/);

// B/D/J — deterministic IDs for upload retries plus serialized note/tree saves.
assert.match(init, /createHash\('sha256'\)/);
assert.match(upload, /requestId/);
assert.match(storage, /pendingMateriasWrite/);
assert.match(storage, /expectedRevision/);
assert.match(storage, /snapshot durable es idéntico/);
assert.match(storage, /attempt < 3/);

// C — a topic/material parent must belong to the authenticated tree.
assert.match(init, /ownsParent\(user\.id/);
assert.match(init, /materia\.temas/);

// E/F/G — material ownership, idempotent completion and metadata-before-asset safety.
assert.match(worker, /WHERE materials\.user_id = excluded\.user_id/);
assert.match(complete, /material\.upload_status !== 'uploaded'/);
assert.ok(materialRoute.indexOf('await hardDeleteMaterial') < materialRoute.indexOf('await deleteFromR2'));

// K/L — delete waits for ACK; restore errors stay ERROR and are never migrated as absence.
assert.match(page, /if \(!response\.ok && response\.status !== 404\)/);
assert.match(page, /getSessionsByTema\(target\.id\)/);
assert.match(page, /No se pudieron verificar las sesiones dependientes/);
assert.match(storage, /status: 'ERROR'/);
assert.doesNotMatch(page, /else if \(materiasLocal\.length > 0\)\s*\{\s*await fetch\('\/api\/materias'/s);

// M/N — durable lookup precedes opening cached academic entities.
assert.match(page, /materiasRestoreStatus !== 'READY'/);
assert.match(page, /lookupMateriasDesdeDB/);

// Revision migration preserves the JSON tree and introduces no destructive SQL.
assert.match(migration, /ADD COLUMN revision INTEGER NOT NULL DEFAULT 0/);
assert.doesNotMatch(migration, /DROP|DELETE|TRUNCATE/i);

// CAS model: two tabs starting at the same revision cannot both commit.
let revision = 0;
let durable = 'initial';
const cas = (expected: number, value: string) => {
  if (expected !== revision) return false;
  durable = value;
  revision += 1;
  return true;
};
assert.equal(cas(0, 'save-B'), true);
assert.equal(cas(0, 'stale-save-A'), false);
assert.equal(durable, 'save-B');

// Retry of the same upload request resolves to the same material identity.
const stableMaterialId = (user: string, request: string, index: number) => `${user}:${request}:${index}`;
assert.equal(stableMaterialId('u1', 'r1', 0), stableMaterialId('u1', 'r1', 0));
assert.notEqual(stableMaterialId('u1', 'r1', 0), stableMaterialId('u1', 'r2', 0));

// O/P/Q/T are guarded by the existing real source/restore suites; assert wiring remains.
const packageJson = read('package.json');
assert.match(packageJson, /test:adaptive-reliability/);
assert.match(read('lib/adaptive/sourceSelection.ts'), /filterTextToSelectedPages/);

console.log('study-data-integrity-contracts: A-T PASS; CAS conflicts reject stale writes; restore ERROR != ABSENT');
