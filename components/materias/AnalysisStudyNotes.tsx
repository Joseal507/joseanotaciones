'use client'

import { AcademicContent } from '../academic/AcademicContent'
import type { AnalysisStudyNotes as StudyNotes } from '../../lib/materialBrain/analysisStudyNotes'

interface Props {
  notes: StudyNotes
  materials: Array<{ id?: string; nombre?: string; name?: string }>
  onClose: () => void
  readSections: Set<string>
  onToggleRead: (id: string) => void
  onSave?: (title: string, content: string) => void
}

function pageRanges(pages: number[]) {
  const ranges: string[] = []
  let start = pages[0], end = start
  for (const page of pages.slice(1)) {
    if (page === end + 1) end = page
    else { ranges.push(start === end ? `${start}` : `${start}–${end}`); start = end = page }
  }
  if (start !== undefined) ranges.push(start === end ? `${start}` : `${start}–${end}`)
  return ranges.join(', ')
}

export function AnalysisStudyNotes({ notes, materials, onClose, readSections, onToggleRead, onSave }: Props) {
  const materialName = (id: string) => materials.find(material => material.id === id)?.nombre || materials.find(material => material.id === id)?.name || id
  const goTo = (id: string) => document.getElementById(`analysis-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const save = () => onSave?.(notes.titulo, [notes.overview, ...notes.topics.map(topic => `## ${topic.title}\n\n${topic.points.map(point => point.content).join('\n\n')}\n\n${topic.sources.map(source => `${materialName(source.materialId)} · pp. ${pageRanges(source.pages)}`).join('\n')}`)].join('\n\n'))
  return <div className="study-notes" role="dialog" aria-modal="true" aria-label="Análisis del material">
    <header className="notes-toolbar">
      <button onClick={onClose}>← Volver</button>
      <strong>Análisis del material</strong>
      <span>{notes.topics.length} temas · {notes.grounding.coveragePercent}% del contenido representado</span>
      {onSave && <button onClick={save}>Guardar apunte</button>}
    </header>
    <div className="notes-layout">
      <nav className="notes-index" aria-label="Temas del material">
        <p className="notes-eyebrow">Índice</p>
        <button onClick={() => goTo('overview')}>Resumen general</button>
        {notes.topics.map((topic, i) => <button key={topic.id} onClick={() => goTo(topic.id)}>
          <span className="notes-number">{readSections.has(topic.id) ? '✓' : i + 1}</span><span>{topic.title}</span>
        </button>)}
        <button onClick={() => goTo('exam')}>Para examen</button>
      </nav>
      <main className="notes-main" lang={notes.materialLanguage === 'und' ? undefined : notes.materialLanguage}>
        <section id="analysis-overview" className="notes-overview">
          <p className="notes-eyebrow">Resumen general</p>
          <h1><AcademicContent content={notes.titulo} inline /></h1>
          <AcademicContent content={notes.overview} />
        </section>
        {notes.topics.map((topic, i) => <section key={topic.id} id={`analysis-${topic.id}`} className="notes-topic" data-testid="analysis-note-topic">
          <div className="notes-topic-heading"><span className="notes-number">{i + 1}</span><h2><AcademicContent content={topic.title} inline /></h2></div>
          <div className="notes-pages">{topic.sources.map(source => <span key={source.materialId}>{materialName(source.materialId)} · pp. {pageRanges(source.pages)}</span>)}</div>
          {topic.points.map(point => <div key={point.id} className={`notes-point notes-${point.representation}`} data-representation={point.representation}>
            <AcademicContent content={point.content} />
          </div>)}
          <div className="notes-topic-footer">
            <details className="notes-sources">
              <summary>Consultar fuentes</summary>
              {topic.sources.map(source => <div key={source.materialId} data-material-id={source.materialId}>
                <strong>{materialName(source.materialId)} · pp. {pageRanges(source.pages)}</strong>
                {source.sourceSpans.map((span, si) => <blockquote key={si}><small>p. {span.page}</small><p>{span.quote}</p></blockquote>)}
              </div>)}
            </details>
            <button aria-pressed={readSections.has(topic.id)} onClick={() => onToggleRead(topic.id)}>{readSections.has(topic.id) ? '✓ Leído' : 'Marcar leído'}</button>
          </div>
        </section>)}
        <section id="analysis-exam" className="notes-exam">
          <p className="notes-eyebrow">Para examen</p>
          <p>Prioriza estos temas según su importancia en el material. Vuelve al apunte para revisar las relaciones, fórmulas y diferencias.</p>
          <div>{notes.examTopicIds.map(id => <button key={id} onClick={() => goTo(id)}>{notes.topics.find(topic => topic.id === id)?.title} ↗</button>)}</div>
        </section>
      </main>
    </div>
    <style jsx>{`
      .study-notes { position:fixed; inset:0; z-index:1000; background:var(--bg-primary); color:var(--text-primary); font-family:var(--font-body); display:flex; flex-direction:column; }
      .notes-toolbar { display:flex; align-items:center; gap:16px; padding:14px 24px; border-bottom:1px solid var(--border-color, #8884); }
      .notes-toolbar span { flex:1; color:var(--text-muted); font-size:12px; }
      button { color:inherit; background:transparent; border:1px solid var(--border-color, #8884); border-radius:8px; padding:8px 12px; cursor:pointer; font:inherit; }
      button:hover { background:color-mix(in srgb, var(--gold) 12%, transparent); }
      button:focus-visible, summary:focus-visible { outline:2px solid var(--gold); outline-offset:3px; }
      .notes-layout { flex:1; min-height:0; display:flex; }
      .notes-index { width:260px; flex-shrink:0; padding:24px 16px; overflow-y:auto; border-right:1px solid var(--border-color, #8884); }
      .notes-index button { display:flex; align-items:baseline; gap:10px; width:100%; text-align:left; border:0; margin:4px 0; font-size:13px; line-height:1.5; }
      .notes-number { font-size:12px; font-variant-numeric:tabular-nums; color:var(--text-muted); min-width:18px; }
      .notes-main { flex:1; min-width:0; overflow-y:auto; padding:40px max(24px, calc((100% - 1140px) / 2)) 80px; line-height:1.75; }
      .notes-eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:var(--text-muted); font-weight:700; }
      h1 { font-size:32px; line-height:1.25; margin:12px 0 20px; }
      h2 { font-size:23px; line-height:1.35; margin:0; }
      .notes-overview { margin-bottom:44px; max-width:900px; }
      .notes-topic { padding:28px 0 32px; border-top:1px solid var(--border-color, #8884); scroll-margin-top:20px; max-width:900px; }
      .notes-topic-heading { display:flex; align-items:baseline; gap:14px; }
      .notes-pages { display:flex; flex-wrap:wrap; gap:6px 16px; font-size:11px; color:var(--text-muted); margin:8px 0 20px 32px; }
      .notes-point { margin:18px 0; font-size:15px; }
      .notes-connection { border-left:3px solid var(--gold); padding:4px 0 4px 18px; }
      .notes-topic-footer { display:flex; gap:20px; align-items:start; margin-top:22px; font-size:12px; color:var(--text-muted); }
      .notes-sources { flex:1; }
      summary { cursor:pointer; padding:8px 0; }
      blockquote { margin:14px 0; padding-left:14px; border-left:2px solid var(--border-color, #8884); white-space:pre-wrap; }
      blockquote p { margin:0; }
      .notes-exam { max-width:900px; background:var(--bg-card); border-radius:12px; padding:20px 24px; margin-top:30px; font-size:13px; }
      .notes-exam div { display:flex; gap:8px; flex-wrap:wrap; }
      .study-notes :global(table) { width:100%; border-collapse:collapse; font-size:14px; margin:12px 0; }
      .study-notes :global(th), .study-notes :global(td) { text-align:left; vertical-align:top; border-bottom:1px solid var(--border-color, #8884); padding:10px 14px; }
      .study-notes :global(th) { background:var(--bg-card); font-weight:700; }
      .study-notes :global(p) { margin-top:0; margin-bottom:12px; }
      .study-notes :global(li) { margin:5px 0; }
      @media(max-width:800px) { .notes-index { display:none; } .notes-main { padding:24px 18px 64px; } .notes-toolbar { flex-wrap:wrap; gap:10px; padding:12px 16px; } .notes-toolbar span { flex-basis:100%; order:2; } h1 { font-size:27px; } h2 { font-size:21px; } }
    `}</style>
  </div>
}
