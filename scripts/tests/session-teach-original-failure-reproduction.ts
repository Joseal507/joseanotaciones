// Trampolín: igual patrón que session-persistence-server-restart-contracts.ts —
// la implementación real usa node:test + mock.module (para mockear ÚNICAMENTE
// lib/alai.ts, nunca la lógica de producción bajo prueba) y necesita el flag
// --experimental-test-module-mocks. Este wrapper preserva la convención de
// invocación uniforme (`node --import tsx <archivo>`) del resto de scripts/tests.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const implPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'session-teach-original-failure-reproduction.impl.mts')
const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', '--test', implPath], {
  stdio: 'inherit',
  env: process.env,
})
process.exitCode = result.status ?? 1
