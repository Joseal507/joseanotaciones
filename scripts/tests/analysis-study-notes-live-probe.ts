/** Opt-in, one bounded compilation from an existing Enjoyer. No production writes. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { alai, safeParseJson } from '../../lib/alai'
import { buildAnalysisEnjoyerContext } from '../../lib/materialBrain/analysisEnjoyerContext'
import { compileStudyNotes } from '../../lib/materialBrain/analysisStudyNotes'
import { prepareAcademicContentForDelivery } from '../../lib/academic-content/validation'

async function main() {
  const input = process.argv[2]
  if (!input) throw new Error('Pass a JSON path containing {selection,payload}; this probe never rebuilds Enjoyer.')
  const { selection, payload } = JSON.parse(fs.readFileSync(input, 'utf8'))
  const context = buildAnalysisEnjoyerContext(payload, selection)
  const calls: unknown[] = []
  const started = Date.now()
  const notes = await compileStudyNotes(context, 'universidad', async request => {
    const result = await alai({ messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.prompt }],
      json: true, temperature: 0.2, maxTokens: request.maxTokens, taskType: 'summary', maxProviderAttempts: 1, transportRetries: 0, timeoutMs: 55_000 })
    calls.push({ repair: request.repair, review: request.review === true, completion: result.completion })
    fs.writeFileSync(`/tmp/analysis-notes-live-response-${calls.length}.json`, result.text)
    return safeParseJson(result.text)
  })
  const content = notes.topics.flatMap(topic => topic.points.map(point => point.content)).join('\n\n')
  const blueprint = payload.blueprint || payload
  const metrics = { originalConcepts: blueprint.uniqueConceptsIndex?.length, originalBlocks: blueprint.globalOrderedAnalysis?.length,
    eligibleTargets: context.targets.length, finalTopics: notes.topics.length, finalPoints: notes.topics.reduce((sum, t) => sum + t.points.length, 0),
    coverage: notes.grounding.coveragePercent, coveredConceptIds: notes.grounding.coveredConceptIds.length, coveredBlockIds: notes.grounding.coveredBlockIds.length,
    academicCharacters: content.length, generation: notes.generation, calls, elapsedMs: Date.now() - started,
    outline: notes.topics.map(topic => ({ title: topic.title, representations: topic.points.map(point => point.representation), pages: topic.sources.map(s => ({ materialId: s.materialId, pages: s.pages })) })),
    duplicateTargetAssignments: notes.topics.flatMap(t => t.points.flatMap(p => p.targetIds)).length - context.targets.length,
  }
  fs.writeFileSync('/tmp/studyal-analysis-notes-live.json', JSON.stringify({ metrics, notes }, null, 2))
  assert.equal(notes.grounding.coveragePercent, 100)
  for (const topic of notes.topics) for (const point of topic.points) assert.equal(prepareAcademicContentForDelivery(point.content).degraded, false, `Rendering degraded: ${topic.title}`)
  assert.doesNotMatch(content, /radiom[eé]tric|radiocarbon|dataci[oó]n/i, 'No unsupported dating example')
  console.log(JSON.stringify(metrics, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
