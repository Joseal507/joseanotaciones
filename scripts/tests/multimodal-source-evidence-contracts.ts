import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  dedupeSourceEvidence,
  mergeSourceEvidence,
  normalizeSourceEvidence,
  sourceEvidenceId,
  validateSourceEvidence,
  visualAnalysisResultToEvidence,
  type NativeTextEvidence,
  type OcrTextEvidence,
  type SourceEvidence,
  type VisualEvidence,
} from '../../lib/materials/sourceEvidence'
import type { VisualPageAnalysisResult } from '../../lib/materials/visualPageAnalysisTypes'

const native: NativeTextEvidence = {
  materialId: 'material-1',
  page: 8,
  derivation: 'native_text',
  quote: 'La válvula mitral conecta la aurícula izquierda con el ventrículo izquierdo.',
  chunkId: 'chunk-8',
}

const ocr: OcrTextEvidence = {
  materialId: 'material-1',
  page: 9,
  derivation: 'ocr',
  quote: 'Presión arterial sistólica representada en la tabla.',
  extractorVersion: 'gemini-pdf-ocr-v1',
  provider: 'openrouter',
  model: 'google/gemini-2.5-flash',
}

const visual: VisualEvidence = {
  materialId: 'material-1',
  page: 7,
  derivation: 'vision',
  pageFingerprint: 'page-fingerprint-7',
  assetRef: {
    kind: 'pdf_page',
    materialId: 'material-1',
    page: 7,
    pageFingerprint: 'page-fingerprint-7',
  },
  description: 'Diagrama anatómico con la válvula mitral señalada entre ambas cámaras.',
  analyzerVersion: '1.0.0',
  promptVersion: '1.0.0',
  provider: 'openrouter',
  model: 'google/gemini-2.5-flash',
}

function visualResult(status: VisualPageAnalysisResult['status']): VisualPageAnalysisResult {
  return {
    materialId: 'material-1',
    page: 7,
    status,
    text: status === 'success' ? visual.description || '' : '',
    visualDescription: status === 'success' ? visual.description || '' : '',
    derivation: 'vision',
    provider: 'openrouter',
    model: 'google/gemini-2.5-flash',
    attempts: status === 'no_api_key' ? 0 : 1,
    analyzerVersion: '1.0.0',
    promptVersion: '1.0.0',
    pageFingerprint: 'page-fingerprint-7',
  }
}

function testValidation() {
  assert.equal(validateSourceEvidence(native), true)
  assert.equal(validateSourceEvidence(ocr), true)
  assert.equal(validateSourceEvidence(visual), true)
  assert.equal('quote' in visual, false, 'visual evidence no debe fabricar quote')
  assert.equal(validateSourceEvidence({ ...native, quote: '' }), false)
  assert.equal(validateSourceEvidence({ ...visual, pageFingerprint: '' }), false)
  assert.equal(validateSourceEvidence({ ...visual, page: 0 }), false)
  assert.equal(validateSourceEvidence({ ...visual, materialId: '' }), false)
  assert.equal(validateSourceEvidence({ ...visual, derivation: 'unknown' }), false)
  assert.equal(validateSourceEvidence({ ...visual, quote: 'inventada' }), false)
  assert.equal(validateSourceEvidence({ ...visual, region: { x: 0, y: 0, width: -1, height: 1 } }), false)
  assert.equal(validateSourceEvidence({ ...native, unsafe: () => undefined }), false)
}

function testIdentityAndMerge() {
  assert.equal(sourceEvidenceId(native), sourceEvidenceId({ ...native }))
  assert.notEqual(sourceEvidenceId(native), sourceEvidenceId({ ...native, page: 9 }))
  assert.notEqual(sourceEvidenceId(native), sourceEvidenceId(visual))
  assert.notEqual(
    sourceEvidenceId({ ...visual, region: { x: 0, y: 0, width: 10, height: 10 } }),
    sourceEvidenceId({ ...visual, region: { x: 1, y: 0, width: 10, height: 10 } }),
  )
  assert.notEqual(sourceEvidenceId(visual), sourceEvidenceId({
    ...visual,
    pageFingerprint: 'changed',
    assetRef: { ...visual.assetRef!, pageFingerprint: 'changed' },
  }))
  assert.equal(dedupeSourceEvidence([native, { ...native }]).length, 1)
  const merged = mergeSourceEvidence([native], [visual])
  assert.equal(merged.length, 2)
  assert.deepEqual(new Set(merged.map(item => item.derivation)), new Set(['native_text', 'vision']))
  assert.deepEqual(mergeSourceEvidence([visual], [native]), merged, 'merge debe ser determinístico')
  assert.equal(dedupeSourceEvidence([
    { ...native, quote: 'Primera cita distinta.' },
    { ...native, quote: 'Segunda cita distinta.' },
  ]).length, 2)
  assert.equal(dedupeSourceEvidence([
    { ...visual, region: { x: 0, y: 0, width: 10, height: 10 } },
    { ...visual, region: { x: 20, y: 0, width: 10, height: 10 } },
  ]).length, 2)
}

function testVisualAdapter() {
  const evidence = visualAnalysisResultToEvidence(visualResult('success'))
  assert.ok(evidence)
  assert.equal(evidence.derivation, 'vision')
  assert.equal('quote' in evidence, false)
  assert.equal(evidence.assetRef?.kind, 'pdf_page')
  assert.equal(evidence.assetRef?.pageFingerprint, 'page-fingerprint-7')
  assert.equal(evidence.analyzerVersion, '1.0.0')
  assert.equal(evidence.promptVersion, '1.0.0')
  assert.equal(visualAnalysisResultToEvidence(visualResult('no_content')), null)
  assert.equal(visualAnalysisResultToEvidence(visualResult('failed')), null)
  assert.equal(visualAnalysisResultToEvidence(visualResult('no_api_key')), null)
  assert.throws(
    () => visualAnalysisResultToEvidence({ ...visualResult('success'), pageFingerprint: undefined }),
    /VISUAL_EVIDENCE_INCOMPLETE/,
  )
}

function testJsonAndArchitecture() {
  const evidence: SourceEvidence[] = [native, ocr, visual].map(normalizeSourceEvidence)
  assert.deepEqual(JSON.parse(JSON.stringify(evidence)), evidence)
  const source = readFileSync('lib/materials/sourceEvidence.ts', 'utf8')
  assert.doesNotMatch(source, /app\/api\/adaptive|lib\/adaptive|\.\.\/adaptive/)
  const futureMaterialBrainImport: SourceEvidence = native
  assert.equal(futureMaterialBrainImport.derivation, 'native_text')
}

function run() {
  testValidation()
  testIdentityAndMerge()
  testVisualAdapter()
  testJsonAndArchitecture()
  console.log('multimodal-source-evidence-contracts: PASS (providerCalls=0)')
}

run()
