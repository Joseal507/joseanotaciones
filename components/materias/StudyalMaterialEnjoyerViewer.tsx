'use client'

import { useEffect, useState } from 'react'
import type { SourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'

// ============================================================
// StudyalMaterialEnjoyer Debug Viewer — Phase 1.
//
// Read-only. Opens a GET request to /api/adaptive/blueprint (the same
// route Adaptive's blueprint generation already uses) which NEVER
// generates — it only restores a persisted analysis for the EXACT
// current source selection fingerprint, or reports 'missing'. Opening
// this viewer causes ZERO provider/AI calls.
//
// Purpose (Phase 1 only): prove that the analysis Adaptive already
// generated for this exact material/page selection is the SAME
// analysis Free Mode can read — not to replace Flashcards/Quiz yet.
// ============================================================

interface Props {
  materialNames: Record<string, string>
  sourceSelection: SourceSelectionSnapshot
  onClose: () => void
}

type EnjoyerResponse = {
  status: 'missing' | 'ready'
  fingerprint: string
  blueprint?: {
    sourceSelectionFingerprint: string
    globalOrderedAnalysis?: unknown[]
    blocks?: any[]
    uniqueConceptsIndex?: any[]
    topicsIndex?: any[]
    coverageSummary?: unknown
    materials?: { materialId: string; materialName: string; selectedPages: number[] }[]
  }
  quality?: { status?: string; coverageCertified?: boolean; spanCoverage?: number }
  error?: string
}

function refs(pages: number[] | undefined, materialId: string, names: Record<string, string>): string {
  if (!pages || !pages.length) return '—'
  return pages.map(p => `${names[materialId] || materialId}:p.${p}`).join(', ')
}

export default function StudyalMaterialEnjoyerViewer({ materialNames, sourceSelection, onClose }: Props) {
  const [response, setResponse] = useState<EnjoyerResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({
      materialIds: JSON.stringify(sourceSelection.materialIds),
      selectedPages: JSON.stringify(sourceSelection.selectedPages),
      fingerprint: sourceSelection.fingerprint,
    })
    fetch(`/api/adaptive/blueprint?${params.toString()}`, {
      method: 'GET', credentials: 'same-origin', signal: controller.signal,
    }).then(async result => {
      const data = await result.json() as EnjoyerResponse
      if (!result.ok) throw new Error(data.error || `HTTP_${result.status}`)
      if (data.fingerprint !== sourceSelection.fingerprint
        || (data.blueprint && data.blueprint.sourceSelectionFingerprint !== sourceSelection.fingerprint)) {
        throw new Error('FINGERPRINT_MISMATCH')
      }
      setResponse(data)
    }).catch(caught => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught))
    })
    return () => controller.abort()
  }, [sourceSelection])

  const blueprint = response?.blueprint
  const blocks = blueprint?.blocks || (blueprint?.globalOrderedAnalysis as any[]) || []
  const concepts = blueprint?.uniqueConceptsIndex || []
  const topics = blueprint?.topicsIndex || []
  const rawJson = blueprint ? JSON.stringify(blueprint, null, 2) : ''

  return (
    <div className="sme-overlay" role="dialog" aria-modal="true" aria-label="Studyal Material Enjoyer Debug">
      <header className="sme-topbar">
        <button onClick={onClose} className="sme-close">← Volver al proceso</button>
        <div className="sme-title"><b>🧠 Studyal Material Enjoyer</b><span>DEV · read-only</span></div>
        <span className={`sme-status sme-status-${response?.status || 'loading'}`}>{response?.status || 'loading'}</span>
      </header>

      <main className="sme-main">
        <section className="sme-identity">
          <div><b>materialIds</b><code>{sourceSelection.materialIds.join(', ')}</code></div>
          <div><b>selectedPages</b><code>{JSON.stringify(sourceSelection.selectedPages)}</code></div>
          <div><b>sourceSelectionFingerprint</b><code>{sourceSelection.fingerprint}</code></div>
          <div><b>quality</b><code>{response?.quality?.status || '—'} · coverage {response?.quality?.spanCoverage ?? '—'}%</code></div>
        </section>

        {!response && !error && <div className="sme-state">Leyendo StudyalMaterialEnjoyer persistido…</div>}
        {error && <div className="sme-state sme-error">No se pudo leer el análisis: {error}</div>}
        {response?.status === 'missing' && (
          <div className="sme-state">
            No existe un análisis persistido para esta selección todavía.
            Abre Adaptive con esta misma selección de materiales/páginas para generarlo una vez —
            Free Mode nunca dispara la generación por sí mismo.
          </div>
        )}

        {blueprint && (
          <>
            <section className="sme-stats">
              {[
                ['Topics', topics.length], ['Bloques', blocks.length],
                ['Conceptos únicos', concepts.length],
                ['Materiales', blueprint.materials?.length || 0],
              ].map(([label, value]) => <div className="sme-stat" key={label as string}><strong>{value as number}</strong><span>{label}</span></div>)}
            </section>

            {topics.length > 0 && (
              <section className="sme-section">
                <h2>📌 Topics</h2>
                {topics.map((topic: any, i: number) => (
                  <div className="sme-topic" key={topic.id || i}>
                    <b>{topic.title || topic.id}</b>
                    <span>{topic.description}</span>
                    <small>pages: {(topic.pages || []).join(', ') || '—'} {topic.role ? `· ${topic.role}` : ''}</small>
                  </div>
                ))}
              </section>
            )}

            {blocks.length > 0 && (
              <section className="sme-section">
                <h2>🧩 Análisis ordenado (bloques)</h2>
                <div className="sme-units">
                  {blocks.map((block: any, i: number) => (
                    <article className="sme-unit" key={block.id || i}>
                      <div className="sme-unit-head">
                        <span className={`sme-kind sme-kind-${block.kind || 'concept'}`}>{block.kind || 'concept'}</span>
                        {block.importance && <span className="sme-chip">{block.importance}</span>}
                        {block.examRelevant && <span className="sme-chip">exam-relevant</span>}
                      </div>
                      <h4>{block.title || block.label || block.term}</h4>
                      <p>{block.description || block.statement || block.text}</p>
                      {block.expression && <code className="sme-formula">{block.expression}</code>}
                      <div className="sme-unit-meta">
                        <span>{(block.sourceSpans || []).map((s: any) => `${materialNames[s.materialId] || s.materialId}:p.${s.page}`).join(' · ') || refs(block.pages, blueprint.materials?.[0]?.materialId || '', materialNames)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {concepts.length > 0 && (
              <section className="sme-section">
                <h2>🔑 Índice de conceptos únicos</h2>
                <ul>{concepts.map((c: any, i: number) => <li key={c.id || i}>{c.title || c.label || c.term || JSON.stringify(c)}</li>)}</ul>
              </section>
            )}

            <details className="sme-raw">
              <summary>&lt;&gt; Raw StudyalMaterialEnjoyer JSON</summary>
              <pre>{rawJson}</pre>
            </details>
          </>
        )}
      </main>

      <style>{`
        .sme-overlay{position:fixed;inset:0;z-index:10000;background:var(--bg-primary);color:var(--text-primary);font-family:Inter,system-ui,sans-serif;overflow:auto}
        .sme-topbar{height:72px;padding:0 20px;display:flex;align-items:center;gap:18px;border-bottom:1.5px solid var(--border-color2);position:sticky;top:0;background:color-mix(in srgb,var(--bg-primary) 92%,transparent);backdrop-filter:blur(12px)}
        .sme-close{border:1.5px solid var(--text-primary);background:var(--bg-card);color:var(--text-primary);border-radius:10px;padding:8px 14px;font-weight:800;cursor:pointer}
        .sme-title{flex:1;display:flex;align-items:center;gap:10px}.sme-title b{font-size:22px}.sme-title span{font-size:10px;font-weight:900;letter-spacing:.08em;border:1px solid var(--gold);color:var(--gold);border-radius:999px;padding:3px 7px}
        .sme-status{font-weight:900;padding:6px 10px;border-radius:999px;background:var(--bg-card);border:1px solid var(--border-color2)}.sme-status-ready{color:#22c55e}.sme-status-missing{color:#f59e0b}
        .sme-main{max-width:1100px;margin:0 auto;padding:22px 24px 80px}
        .sme-identity{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-bottom:18px}.sme-identity div{display:flex;gap:8px;min-width:0;font-size:12px}.sme-identity code{overflow:hidden;text-overflow:ellipsis;color:var(--text-muted)}
        .sme-state{max-width:800px;margin:30px auto;padding:20px;border:1.5px dashed var(--gold);border-radius:12px;background:color-mix(in srgb,var(--gold) 8%,var(--bg-card));text-align:center}.sme-error{border-color:#ef4444}
        .sme-stats{display:grid;grid-template-columns:repeat(4,minmax(110px,1fr));gap:10px;margin-bottom:22px}.sme-stat{background:var(--bg-card);border:1.5px solid var(--border-color2);border-radius:12px;padding:12px}.sme-stat strong{display:block;font-size:23px;color:var(--gold)}.sme-stat span{font-size:11px;color:var(--text-muted)}
        .sme-section{padding:18px 0;border-top:1px solid var(--border-color2)}.sme-section h2{margin:0 0 12px;font-size:20px}
        .sme-topic{background:var(--bg-card);border:1px solid var(--border-color2);border-radius:10px;padding:10px 12px;margin-bottom:8px;display:flex;flex-direction:column;gap:3px}.sme-topic small{color:var(--text-faint)}.sme-topic span{color:var(--text-muted);font-size:12px}
        .sme-units{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.sme-unit{background:var(--bg-card);border:1.5px solid var(--border-color2);border-radius:13px;padding:14px}.sme-unit-head{display:flex;gap:6px;flex-wrap:wrap}.sme-kind,.sme-chip{font-size:10px;font-weight:900;padding:3px 7px;border-radius:999px;border:1px solid var(--blue);color:var(--blue)}.sme-unit h4{font-size:16px;margin:8px 0 4px}.sme-unit p{font-size:13px;color:var(--text-muted);line-height:1.4}.sme-formula{display:block;margin-top:8px;padding:8px;background:var(--bg-secondary);border-radius:8px}.sme-unit-meta{margin-top:8px;font-size:10px;color:var(--text-faint)}
        .sme-raw{border:1.5px solid var(--border-color2);border-radius:12px;padding:14px;margin-top:20px}.sme-raw summary{font-weight:900;cursor:pointer}.sme-raw pre{max-height:500px;overflow:auto;background:#07090d;color:#d1fae5;padding:14px;border-radius:8px;font-size:11px;white-space:pre-wrap;word-break:break-word;margin-top:10px}
        @media(max-width:900px){.sme-units,.sme-stats{grid-template-columns:1fr}.sme-identity{grid-template-columns:1fr}}
      `}</style>
    </div>
  )
}
