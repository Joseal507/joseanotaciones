import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnalysisStudyNotes } from '../../components/materias/AnalysisStudyNotes'
import { buildAnalysisEnjoyerContext } from '../../lib/materialBrain/analysisEnjoyerContext'
import { validateStudyNotes } from '../../lib/materialBrain/analysisStudyNotes'
import { buildPayload } from './five-material-fixture'

Object.assign(globalThis, { React })
const { payload, selection } = buildPayload(['E'])
const context = buildAnalysisEnjoyerContext(payload, selection)
const content = '| Quantity | Formula |\n| --- | --- |\n| Force 力 | $F=ma$ |'
const notes = validateStudyNotes({ title: 'Force 力', overview: 'Relations between force, mass and acceleration.', topics: [{ title: 'Force 力', sourceTopicIds: [context.topics[0].id],
  points: [{ representation: 'comparison', content, targetIds: context.targets.map(t => t.id) }],
}] }, context).notes!
const html = renderToStaticMarkup(<AnalysisStudyNotes notes={notes} materials={[{ id: 'mat-E', nombre: 'Physics.pdf' }]} readSections={new Set()} onToggleRead={() => {}} onClose={() => {}} />)
assert.match(html, /<table>/)
assert.match(html, /class="katex"/)
assert.match(html, /Force 力/)
assert.match(html, /data-material-id="mat-E"/)
assert.match(html, /pp\. 1–3/)
assert.match(html, /<details/)
assert.match(html, /lang="en"/)
assert.doesNotMatch(html, /Todo lo importante|Clase completa|Probabilidad examen|preguntale/)
assert.equal((html.match(/data-testid="analysis-note-topic"/g) || []).length, 1)
assert.doesNotMatch(html, /data-academic-degraded="true"/)
console.log('PASS analysis-study-notes-render: table, KaTeX, Unicode, source details, language, topic hierarchy, no duplicate major sections')
