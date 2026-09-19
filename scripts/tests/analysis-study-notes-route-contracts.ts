import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST, __routeDeps } from '../../app/api/analizar-teorico/route'
import { buildPayload, KEYS } from './five-material-fixture'
import { buildAnalysisEnjoyerContext, ANALYSIS_ENJOYER_ADAPTER_VERSION } from '../../lib/materialBrain/analysisEnjoyerContext'
import { ANALYSIS_STUDY_NOTES_VERSION, planStudyNoteTopics } from '../../lib/materialBrain/analysisStudyNotes'
import { analysisArtifactIdentity, type AnalysisArtifact } from '../../lib/materialBrain/analysisArtifactStore'

async function main() {
  const { payload, selection } = buildPayload(KEYS)
  const context = buildAnalysisEnjoyerContext(payload, selection)
  const response = { title: 'Selected study notes', overview: 'The selected chapters and their key ideas.', topics: planStudyNoteTopics(context).map(topic => ({
    title: topic.title, sourceTopicIds: [topic.id], points: [{ representation: 'explanation', content: topic.targets.map(t => t.content).join('\n\n'),
      targetIds: topic.targets.map(t => t.id), evidence: topic.targets.map(t => ({ targetId: t.id, quote: t.content, summaryAnchor: t.content })),
    }],
  })) }
  const artifacts = new Map<string, AnalysisArtifact>()
  const original = { ...__routeDeps }
  let calls = 0, offline = false, storeOffline = false
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'owner' } }),
    getAuthoritativeFreeSession: async (id: string) => id === 'session' ? { id, userId: 'owner', processMode: 'free', sourceSelection: selection } : null,
    getMaterial: async (id: string) => ({ id }), lookupStudyalMaterialEnjoyer: async () => payload,
    alaiJson: async (input: { messages: Array<{ content: string }> }) => { calls++; if (offline) throw new Error('offline'); return input.messages.some(m => m.content.includes('SOURCE-FIDELITY REVIEW')) ? { approved: true, issues: [], scopeCheck: 'No ambiguous diagram labels in this fixture', contradictionCheck: 'No contradictory source claims in this fixture' } : response },
    analysisArtifactStore: { get: async (id: string) => { if (storeOffline) throw new Error('store offline'); return artifacts.get(id) || null },
      set: async (id: string, artifact: AnalysisArtifact) => { artifacts.set(id, artifact) } },
  })
  const post = async (extra: Record<string, unknown> = {}) => {
    const res = await POST(new NextRequest('http://localhost/api/analizar-teorico', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session', nivel: 'universidad', format: ANALYSIS_STUDY_NOTES_VERSION, ...extra }) }))
    return { status: res.status, body: await res.json() }
  }
  try {
    const id = analysisArtifactIdentity('owner', selection.fingerprint, 'universidad', ANALYSIS_STUDY_NOTES_VERSION)
    const legacyId = analysisArtifactIdentity('owner', selection.fingerprint, 'universidad')
    const legacy: AnalysisArtifact = { schemaVersion: 1, generatorVersion: ANALYSIS_ENJOYER_ADAPTER_VERSION, userId: 'owner', sourceSelectionFingerprint: selection.fingerprint,
      nivel: 'universidad', analisis: { titulo: 'Saved legacy analysis' }, createdAt: 'before', updatedAt: 'before' }
    artifacts.set(legacyId, legacy)
    assert.equal((await post()).body.analisis.titulo, 'Saved legacy analysis')
    assert.equal(calls, 0, 'legacy restore is not permission to regenerate')
    offline = true
    assert.equal((await post({ upgrade: true })).status, 502)
    assert.equal(calls, 2); assert.deepEqual(artifacts.get(legacyId), legacy); assert.ok(!artifacts.has(id))
    offline = false
    const generated = await post({ upgrade: true })
    assert.equal(generated.status, 200)
    assert.equal(generated.body.analisis.grounding.coveragePercent, 100)
    assert.equal(generated.body.analisis.materialLanguage, 'en')
    assert.equal(calls, 4); assert.ok(artifacts.has(id)); assert.deepEqual(artifacts.get(legacyId), legacy)
    const restored = await post()
    assert.deepEqual(restored.body.analisis, generated.body.analisis)
    assert.equal(calls, 4)
    assert.equal((await post({ sessionId: 'unowned' })).status, 404)
    assert.equal((await post({ documentos: ['untrusted sixth material'] })).status, 400)
    assert.equal(calls, 4)
    storeOffline = true
    assert.equal((await post()).status, 500); assert.equal(calls, 4)
    storeOffline = false
    artifacts.set(id, { ...artifacts.get(id)!, analisis: {} })
    assert.equal((await post()).status, 409); assert.equal(calls, 4)
    artifacts.clear(); calls = 0
    const concurrent = await Promise.all([post(), post()])
    assert.ok(concurrent.every(row => row.status === 200)); assert.equal(calls, 2)
    console.log('PASS analysis-study-notes-route: five-material authority, legacy restore/explicit upgrade, failed upgrade preserves work, V2 persistence/restore, malformed/network fail closed, concurrency and raw-source rejection')
  } finally { Object.assign(__routeDeps, original) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
