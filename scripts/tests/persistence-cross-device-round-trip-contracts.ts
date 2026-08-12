// Trampolín: igual patrón que session-teach-original-failure-reproduction.ts
// — la implementación real usa node:test + mock.module (para mockear
// ÚNICAMENTE next-auth, nunca código de producción) y necesita el flag
// --experimental-test-module-mocks.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const implPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'persistence-cross-device-round-trip-contracts.impl.mts')
const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', '--test', implPath], {
  stdio: 'inherit',
  env: process.env,
})
process.exitCode = result.status ?? 1
