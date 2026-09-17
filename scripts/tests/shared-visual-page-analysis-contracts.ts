import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  analyzePdfPageVisual,
  selectPagesNeedingVisualAnalysis,
  VISUAL_PAGE_ANALYZER_VERSION,
  VISUAL_PAGE_MAX_ATTEMPTS,
  VISUAL_PAGE_MAX_TEXT_CHARS,
  VISUAL_PAGE_MODEL,
} from '../../lib/materials/visualPageAnalysis'
import type { VisualPageProvider } from '../../lib/materials/visualPageAnalysisTypes'

const pdfBuffer = Buffer.from('deterministic-fake-pdf')
const validDescription = 'El diagrama etiqueta 4 cámaras del corazón: aurícula y ventrículo; las flechas muestran aurícula → ventrículo y el flujo de sangre entre ambas estructuras.'

function testLegacySelectionAndAuthorization() {
  const pages = new Map<number, string>([
    [1, ''],
    [2, 'x'.repeat(VISUAL_PAGE_MAX_TEXT_CHARS)],
    [3, 'x'.repeat(VISUAL_PAGE_MAX_TEXT_CHARS + 1)],
    [4, '(página vacía)'],
  ])
  assert.deepEqual(selectPagesNeedingVisualAnalysis(pages, [1, 3]), [1])
  assert.deepEqual(selectPagesNeedingVisualAnalysis(pages, [2, 3, 4]), [4, 2])
  assert.ok(!selectPagesNeedingVisualAnalysis(pages, [3]).includes(3))
}

async function testSuccessAndProvenance() {
  let calls = 0
  const provider: VisualPageProvider = async request => {
    calls += 1
    assert.equal(request.page, 7)
    return validDescription
  }
  const result = await analyzePdfPageVisual({
    pdfBuffer,
    page: 7,
    materialId: 'material-1',
    apiKey: 'test-key',
    provider,
    contentFingerprint: 'content-fingerprint',
    pageFingerprint: 'page-fingerprint',
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 'success')
  assert.equal(result.text, validDescription)
  assert.equal(result.visualDescription, validDescription)
  assert.equal(result.derivation, 'vision')
  assert.equal(result.provider, 'openrouter')
  assert.equal(result.model, VISUAL_PAGE_MODEL)
  assert.equal(result.analyzerVersion, VISUAL_PAGE_ANALYZER_VERSION)
  assert.equal(result.attempts, 1)
  assert.equal(result.page, 7)
}

async function testNoContentDoesNotRetry() {
  let calls = 0
  const provider: VisualPageProvider = async () => {
    calls += 1
    return 'contenido corto'
  }
  const result = await analyzePdfPageVisual({ pdfBuffer, page: 2, apiKey: 'test-key', provider })
  assert.equal(result.status, 'no_content')
  assert.equal(result.attempts, 1)
  assert.equal(calls, 1)
}

async function testTransientFailureRetriesOnce() {
  let calls = 0
  const provider: VisualPageProvider = async () => {
    calls += 1
    if (calls === 1) throw new Error('transient')
    return validDescription
  }
  const result = await analyzePdfPageVisual({ pdfBuffer, page: 3, apiKey: 'test-key', provider })
  assert.equal(result.status, 'success')
  assert.equal(result.attempts, 2)
  assert.equal(calls, VISUAL_PAGE_MAX_ATTEMPTS)
}

async function testExhaustedFailure() {
  let calls = 0
  const provider: VisualPageProvider = async () => {
    calls += 1
    throw new Error('persistent')
  }
  const result = await analyzePdfPageVisual({ pdfBuffer, page: 4, apiKey: 'test-key', provider })
  assert.equal(result.status, 'failed')
  assert.equal(result.attempts, VISUAL_PAGE_MAX_ATTEMPTS)
  assert.equal(result.error, 'persistent')
  assert.equal(calls, VISUAL_PAGE_MAX_ATTEMPTS)
}

async function testNoApiKeyDoesNotCallProvider() {
  let calls = 0
  const provider: VisualPageProvider = async () => {
    calls += 1
    return validDescription
  }
  const result = await analyzePdfPageVisual({ pdfBuffer, page: 5, apiKey: null, provider })
  assert.equal(result.status, 'no_api_key')
  assert.equal(result.attempts, 0)
  assert.equal(calls, 0)
}

function testDependencyDirectionAndSingleImplementation() {
  const sharedSource = readFileSync('lib/materials/visualPageAnalysis.ts', 'utf8')
  const adaptiveSource = readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
  assert.doesNotMatch(sharedSource, /app\/api\/adaptive|lib\/adaptive|\.\.\/adaptive/)
  assert.match(adaptiveSource, /lib\/materials\/visualPageAnalysis/)
  assert.match(adaptiveSource, /analyzePdfPageVisual\(/)
  assert.doesNotMatch(adaptiveSource, /openrouter\.ai\/api\/v1\/chat\/completions/)
  assert.doesNotMatch(adaptiveSource, /Focus ONLY on page/)
}

async function run() {
  testLegacySelectionAndAuthorization()
  await testSuccessAndProvenance()
  await testNoContentDoesNotRetry()
  await testTransientFailureRetriesOnce()
  await testExhaustedFailure()
  await testNoApiKeyDoesNotCallProvider()
  testDependencyDirectionAndSingleImplementation()
  console.log('shared-visual-page-analysis-contracts: PASS (providerCalls=0)')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
