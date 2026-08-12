import assert from 'node:assert/strict'
import fs from 'node:fs'

const renderer=fs.readFileSync('components/visual/VisualRenderer.tsx','utf8')+fs.readFileSync('components/visual/UniversalVisualViews.tsx','utf8')
assert.match(renderer,/width:\s*"100%"/)
assert.match(renderer,/minHeight:\s*44/)
assert.match(renderer,/aria-label/)
assert.match(renderer,/aria-pressed/)
assert.match(renderer,/describeVisualSpec/)
assert.match(renderer,/VisualErrorBoundary/)
console.log('Visual responsive/accessibility contracts: PASS')
