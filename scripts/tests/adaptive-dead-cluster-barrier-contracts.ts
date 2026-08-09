import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'

// Barrera estática. Dos rondas de auditoría eliminaron por estar completamente
// desconectadas del motor vivo (cero referencias reales, capacidades duplicadas o
// sin evidencia de necesidad):
//   ronda 1: lib/adaptive/{engines,planner,activitySelection,assessmentPreferences,
//            feasibility,planRevision}/
//   ronda 2: lib/adaptive/program.ts, lib/adaptive/readiness/, lib/adaptive/scheduling/,
//            lib/adaptive/userProfile.ts, y todo lib/adaptive/v2/ EXCEPTO
//            lib/adaptive/v2/agents/chunker.ts (única pieza de v2/ realmente viva:
//            la usa lib/adaptive/v3/graph/{orchestrator,microExtractor}.ts, parte del
//            pipeline validado por npm test). No prohibir chunker.ts.
//
// Este test resuelve cada import a una ruta real (no solo busca substrings) porque el
// bug que motivó esto era precisamente invisible a un grep ingenuo: program.ts,
// readiness/ y scheduling/ importaban '../planner/types' — un import RELATIVO CORTO
// que nunca contiene el texto "lib/adaptive" — y solo se detectó porque tsc rompió al
// borrar planner/types.ts. Resolver la ruta real evita repetir ese punto ciego.

const BANNED_DIRS = [
  'lib/adaptive/engines',
  'lib/adaptive/planner',
  'lib/adaptive/activitySelection',
  'lib/adaptive/assessmentPreferences',
  'lib/adaptive/feasibility',
  'lib/adaptive/planRevision',
  'lib/adaptive/readiness',
  'lib/adaptive/scheduling',
  'lib/adaptive/v2/storage',
  'lib/adaptive/v2/adapters',
]
const BANNED_FILES = [
  'lib/adaptive/program.ts',
  'lib/adaptive/userProfile.ts',
  'lib/adaptive/v2/types.ts',
  'lib/adaptive/v2/contracts.ts',
  'lib/adaptive/v2/index.ts',
  'lib/adaptive/v2/agents/orchestrator.ts',
  'lib/adaptive/v2/agents/teacherBrain.ts',
  'lib/adaptive/v2/agents/contentGenerator.ts',
  'lib/adaptive/v2/agents/analyzer.ts',
  'lib/adaptive/v2/agents/planner.ts',
  'lib/adaptive/v2/agents/consolidator.ts',
]
// lib/adaptive/v2/agents/chunker.ts es explícitamente PERMITIDO — no está en ninguna lista.

function isBannedRepoPath(repoRelativePosix: string): boolean {
  const withoutExt = repoRelativePosix.replace(/\.(ts|tsx)$/, '')
  if (BANNED_DIRS.some(dir => repoRelativePosix === dir || repoRelativePosix.startsWith(`${dir}/`))) return true
  if (BANNED_FILES.some(file => withoutExt === file.replace(/\.ts$/, ''))) return true
  return false
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue
      walk(full, files)
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full)
    }
  }
  return files
}

const IMPORT_SPECIFIER = /(?:from|import)\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g

function resolveSpecifierToRepoPath(file: string, specifier: string): string | null {
  let target: string
  if (specifier.startsWith('.')) {
    target = resolve(dirname(file), specifier)
  } else if (specifier.startsWith('@/')) {
    target = resolve('.', specifier.slice(2))
  } else {
    return null // paquete npm, no nos concierne
  }
  const repoRelative = relative('.', target).split(require('node:path').sep).join('/')
  // El specifier puede omitir la extensión; probar variantes reales en disco.
  for (const candidate of [repoRelative, `${repoRelative}.ts`, `${repoRelative}.tsx`, `${repoRelative}/index.ts`]) {
    if (existsSync(candidate) || candidate === repoRelative) return candidate
  }
  return repoRelative
}

function findOffenders(files: string[]): string[] {
  const offenders: string[] = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    let match: RegExpExecArray | null
    IMPORT_SPECIFIER.lastIndex = 0
    while ((match = IMPORT_SPECIFIER.exec(source))) {
      const specifier = match[1] || match[2]
      const resolved = resolveSpecifierToRepoPath(file, specifier)
      if (resolved && isBannedRepoPath(resolved)) {
        offenders.push(`${file} -> ${specifier}`)
        break
      }
    }
  }
  return offenders
}

const offendingImports = findOffenders([...walk('app'), ...walk('components')])
assert.deepEqual(
  offendingImports,
  [],
  `app/ o components/ importan rutas del cluster muerto eliminado: ${offendingImports.join(', ')}`,
)

const offendingApiImports = findOffenders(walk(join('app', 'api', 'adaptive')))
assert.deepEqual(
  offendingApiImports,
  [],
  `rutas API vivas de adaptive/ importan el cluster muerto eliminado: ${offendingApiImports.join(', ')}`,
)

const offendingLibImports = findOffenders(walk('lib/adaptive'))
assert.deepEqual(
  offendingLibImports,
  [],
  `código dentro de lib/adaptive/ vuelve a importar el cluster muerto eliminado: ${offendingLibImports.join(', ')}`,
)

const CANONICAL_EVIDENCE_ENGINE = join('lib', 'adaptive', 'v3', 'engine', 'evidenceEngine.ts')
const duplicateEvidenceEngines = walk('lib/adaptive').filter(file =>
  file.toLowerCase().endsWith('evidenceengine.ts') && file !== CANONICAL_EVIDENCE_ENGINE
)
assert.deepEqual(
  duplicateEvidenceEngines,
  [],
  `existe un evidenceEngine paralelo fuera del canónico ${CANONICAL_EVIDENCE_ENGINE}: ${duplicateEvidenceEngines.join(', ')} — no crear un segundo motor de mastery/evidencia sin decisión explícita`,
)

console.log('adaptive-dead-cluster-barrier-contracts: 4 contracts PASS (no dead-cluster imports in app/components/api/lib-adaptive, no duplicate evidenceEngine)')
