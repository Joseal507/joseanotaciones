import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const roots = ['app/api/adaptive', 'components/materias', 'lib/adaptive']
const forbidden = /Falcons|Bohr|CLUTCH|step_12|evaluation:3|1965|Julio Jones|Matt Ryan|Michael Vick/i
const violations: string[] = []

function visit(path: string): void {
  for (const entry of readdirSync(path)) {
    const target = join(path, entry)
    const stat = statSync(target)
    if (stat.isDirectory()) visit(target)
    else if (/\.(?:ts|tsx)$/.test(entry) && !/\.bak(?:\.|_|$)/.test(entry)) {
      if (forbidden.test(readFileSync(target, 'utf8'))) violations.push(relative(process.cwd(), target))
    }
  }
}
roots.forEach(visit)
assert.deepEqual(violations, [], `Fixture-specific product rules found in: ${violations.join(', ')}`)
console.log('adaptive-generality-static-contracts: product sources contain no fixture-specific rules PASS')
