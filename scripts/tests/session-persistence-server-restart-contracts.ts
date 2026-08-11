// Trampolín: la implementación real (session-persistence-server-restart-contracts.impl.mts)
// usa node:test + mock.module (para mockear ÚNICAMENTE next-auth, nunca código de
// producción) y necesita el flag --experimental-test-module-mocks. Este wrapper
// existe para que el archivo se invoque exactamente igual que el resto de
// scripts/tests/*.ts (`node --import tsx <archivo>`), preservando el patrón de
// pretest sin tocar la cadena de invocación de los demás ~65 scripts.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const implPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'session-persistence-server-restart-contracts.impl.mts')
const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', '--test', implPath], {
  stdio: 'inherit',
  env: process.env,
})
process.exitCode = result.status ?? 1
