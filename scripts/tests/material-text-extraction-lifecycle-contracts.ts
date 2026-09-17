import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import {
  ensureMaterialTextExtraction,
  TEXT_EXTRACTION_PROCESSING_STALE_MS,
} from '../../lib/materials/textExtraction'
import type { Material, TextStatus } from '../../lib/materials/types'
import { POST, __routeDeps } from '../../app/api/material-brain/route'

function material(id: string, textStatus: TextStatus = 'pending'): Material {
  return {
    id, user_id: 'user-1', tema_id: 'tema-1', materia_id: 'materia-1', nombre: 'source.pdf',
    extension: 'pdf', mime_type: 'application/pdf', size_bytes: 100, storage_key: `${id}/source.pdf`,
    kind: 'pdf', upload_status: 'uploaded', text_status: textStatus, extracted_chars: 0,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  }
}

async function testPendingExtractionLifecycle() {
  const transitions: TextStatus[] = []
  let downloads = 0
  let extractions = 0
  let saves = 0
  const source = material('pending-lifecycle')
  const result = await ensureMaterialTextExtraction(source, 'user-1', {
    getMaterialText: async () => null,
    downloadFromR2: async key => { downloads++; assert.equal(key, source.storage_key); return Buffer.from('pdf') },
    extractText: async () => {
      extractions++
      return { text: '[Pagina 1]\nTexto listo', pages: 1, method: 'pdf-parse', chars: 22, isImageBased: false, hasText: true }
    },
    saveMaterialText: async (id, text) => { saves++; assert.equal(id, source.id); assert.ok(text.includes('Texto listo')) },
    updateMaterialTextStatus: async (id, userId, status) => {
      assert.equal(id, source.id)
      assert.equal(userId, 'user-1')
      transitions.push(status)
    },
  })
  assert.equal(result.status, 'ready')
  assert.deepEqual(transitions, ['processing', 'ready'])
  assert.equal(downloads, 1)
  assert.equal(extractions, 1)
  assert.equal(saves, 1)
}

async function testConcurrentDedupe() {
  const source = material('concurrent')
  let downloads = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const deps = {
    getMaterialText: async () => null,
    downloadFromR2: async () => { downloads++; await gate; return Buffer.from('pdf') },
    extractText: async () => ({ text: 'Texto suficiente', method: 'pdf-parse', chars: 16, isImageBased: false, hasText: true }),
    saveMaterialText: async () => undefined,
    updateMaterialTextStatus: async () => undefined,
  }
  const first = ensureMaterialTextExtraction(source, 'user-1', deps)
  const second = ensureMaterialTextExtraction(source, 'user-1', deps)
  release()
  assert.equal((await first).status, 'ready')
  assert.equal((await second).status, 'ready')
  assert.equal(downloads, 1)
}

async function testExistingTextRepairsStaleStatus() {
  const source = material('stale-pending')
  const transitions: TextStatus[] = []
  const result = await ensureMaterialTextExtraction(source, 'user-1', {
    getMaterialText: async () => ({ material_id: source.id, raw_text: 'Texto persistido', chunks: null, created_at: '', updated_at: '' }),
    downloadFromR2: async () => { throw new Error('must not download') },
    updateMaterialTextStatus: async (_id, _userId, status) => { transitions.push(status) },
  })
  assert.equal(result.status, 'ready')
  assert.deepEqual(transitions, ['ready'])
}

async function testAbandonedProcessingIsRecovered() {
  const source = {
    ...material('abandoned-processing', 'processing'),
    updated_at: new Date(Date.now() - TEXT_EXTRACTION_PROCESSING_STALE_MS - 1_000).toISOString(),
  }
  let downloads = 0
  const transitions: TextStatus[] = []
  const result = await ensureMaterialTextExtraction(source, 'user-1', {
    getMaterialText: async () => null,
    downloadFromR2: async () => { downloads++; return Buffer.from('pdf') },
    extractText: async () => ({ text: 'Texto recuperado', method: 'pdf-parse', chars: 16, isImageBased: false, hasText: true }),
    saveMaterialText: async () => undefined,
    updateMaterialTextStatus: async (_id, _userId, status) => { transitions.push(status) },
  })
  assert.equal(result.status, 'ready')
  assert.equal(downloads, 1)
  assert.deepEqual(transitions, ['processing', 'ready'])
}

async function testFailureIsVisibleAndSanitized() {
  const source = material('failed-extraction')
  const updates: Array<{ status: TextStatus; error?: string }> = []
  const result = await ensureMaterialTextExtraction(source, 'user-1', {
    getMaterialText: async () => null,
    downloadFromR2: async () => { throw new Error('GET https://signed.example/file?token=secret api_key=private') },
    updateMaterialTextStatus: async (_id, _userId, status, extra) => updates.push({ status, error: extra?.last_error }),
  })
  assert.equal(result.status, 'error')
  assert.deepEqual(updates.map(update => update.status), ['processing', 'error'])
  assert.ok(!JSON.stringify(result).includes('signed.example'))
  assert.ok(!JSON.stringify(result).includes('private'))
}

async function testBrainPostRecoversPendingBeforeResolve() {
  const originals = { ...__routeDeps }
  const source = material('brain-recovery')
  let text = ''
  let ensureCalls = 0
  try {
    __routeDeps.getServerSession = async () => ({ user: { id: 'user-1' } }) as any
    __routeDeps.getMaterial = async (id, userId) => {
      assert.equal(userId, 'user-1')
      return { ...source, id, text_status: text ? 'ready' : 'pending' }
    }
    __routeDeps.getMaterialText = async () => text
      ? { material_id: source.id, raw_text: text, chunks: null, created_at: '', updated_at: '' }
      : null
    __routeDeps.ensureMaterialTextExtraction = async (_material, userId) => {
      assert.equal(userId, 'user-1')
      ensureCalls++
      text = '[Pagina 1]\nTexto recuperado automáticamente.'
      return { status: 'ready', text }
    }
    __routeDeps.resolveStudyKind = () => 'pdf'
    __routeDeps.getOrBuildProductionBrain = async () => ({ status: 'ready' })
    const response = await POST(new NextRequest('http://localhost/api/material-brain', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ materialIds: [source.id], selectedPages: { [source.id]: [1] } }),
    }))
    assert.equal(response.status, 200)
    assert.equal((await response.json()).status, 'ready')
    assert.equal(ensureCalls, 1)
  } finally {
    Object.assign(__routeDeps, originals)
  }
}

async function main() {
  await testPendingExtractionLifecycle()
  await testConcurrentDedupe()
  await testExistingTextRepairsStaleStatus()
  await testAbandonedProcessingIsRecovered()
  await testFailureIsVisibleAndSanitized()
  await testBrainPostRecoversPendingBeforeResolve()
  assert.match(
    readFileSync('next.config.js', 'utf8'),
    /externals\.push\('pdfjs-dist\/legacy\/build\/pdf\.js'\)/,
    'Page Intelligence pdfjs subpath must stay external in the Next server bundle',
  )
  console.log('material-text-extraction-lifecycle-contracts: PASS (duplicateExtractions=0)')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
