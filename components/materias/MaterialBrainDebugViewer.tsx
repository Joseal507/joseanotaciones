'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { deriveMaterialBrainDebugSummary, MATERIAL_BRAIN_KIND_LABELS, type MaterialBrainDebugSummary } from '../../lib/materialBrain/debugView'
import type { KnowledgeUnit, KnowledgeUnitKind, MaterialBrain } from '../../lib/materialBrain/types'
import { classifyUnitEligibility } from '../../lib/materialBrain/eligibility'

const IS_DEV = process.env.NODE_ENV !== 'production'

interface Props {
  temaId?: string
  sessionId: string
  materialNames: Record<string, string>
  sourceSelection: SourceSelectionSnapshot
  onClose: () => void
}

type DebugResponse = {
  status: 'missing' | 'building' | 'ready' | 'partial' | 'failed'
  fingerprint: string
  brainKey: string
  brain?: MaterialBrain
  error?: string
}

const KIND_ORDER: KnowledgeUnitKind[] = [
  'concept', 'definition', 'formula', 'example', 'fact', 'process', 'event_or_data', 'terminology',
]

function refs(items: Array<{ materialId: string, page: number }>): string {
  return items.length ? items.map(item => `${item.materialId}:p.${item.page}`).join(', ') : '—'
}

function UnitCard({ unit, names }: { unit: KnowledgeUnit, names: Record<string, string> }) {
  const [expanded, setExpanded] = useState(false)
  const pages = [...new Set([
    ...unit.provenance.map(item => `${names[item.materialId] || item.materialId} · p.${item.page}`),
    ...(unit.evidence || []).map(item => `${names[item.materialId] || item.materialId} · p.${item.page}`),
  ])]
  return (
    <article className="mbd-unit" id={`mbd-unit-${unit.id}`}>
      <div className="mbd-unit-head">
        <span className={`mbd-kind mbd-kind-${unit.kind}`}>{unit.kind}</span>
        <span className={`mbd-tier mbd-tier-${unit.importance.tier}`}>{unit.importance.tier}</span>
        {unit.academicRole && <span className="mbd-chip">{unit.academicRole}</span>}
        <span className="mbd-chip" title="downstream eligibility">{classifyUnitEligibility(unit)}</span>
      </div>
      <h4>{unit.label}</h4>
      <p>{unit.statement}</p>
      <div className="mbd-unit-meta">
        <span>confidence {Math.round(unit.importance.confidence * 100)}%</span>
        <span>{pages.join(' · ') || 'sin provenance'}</span>
        {unit.origin && <span>origin: {unit.origin}</span>}
      </div>
      {unit.kind === 'formula' && <code className="mbd-formula">{unit.expression}</code>}
      {unit.kind === 'process' && <ol>{unit.steps.map(step => <li key={step.order}>{step.text}</li>)}</ol>}
      <button className="mbd-details-btn" onClick={() => setExpanded(value => !value)}>
        {expanded ? 'Ocultar detalles técnicos' : 'Ver provenance y detalles'}
      </button>
      {expanded && (
        <div className="mbd-details">
          <div><b>ID:</b> {unit.id}</div>
          <div><b>Semantic key:</b> {unit.identity.semanticKey}</div>
          <div><b>Canonical subject:</b> {unit.identity.canonicalSubject}</div>
          <div><b>Qualifiers:</b> {unit.identity.qualifiers.join(', ') || '—'}</div>
          <div><b>Display qualifiers:</b> {unit.displayQualifiers?.join(', ') || '—'}</div>
          <div><b>Domain tags:</b> {unit.domainTags.join(', ') || '—'}</div>
          <div><b>Importance signals:</b> {unit.importance.signals.join(', ') || '—'}</div>
          {unit.provenance.map((item, index) => (
            <div className="mbd-source" key={`p-${index}`}>
              <b>Text provenance:</b> {names[item.materialId] || item.materialId}, p.{item.page}, chunk {item.chunkId}
              <blockquote>{item.quote}</blockquote>
            </div>
          ))}
          {(unit.evidence || []).map((item, index) => (
            <div className="mbd-source" key={`e-${index}`}>
              <b>Evidence:</b> {names[item.materialId] || item.materialId}, p.{item.page}, {item.derivation}
              {'provider' in item && item.provider ? ` · ${item.provider}` : ''}
              {'model' in item && item.model ? ` · ${item.model}` : ''}
              {'quote' in item && item.quote ? <blockquote>{item.quote}</blockquote> : null}
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

async function fetchDebugStatus(sourceSelection: SourceSelectionSnapshot, signal?: AbortSignal): Promise<DebugResponse> {
  const params = new URLSearchParams({
    materialIds: JSON.stringify(sourceSelection.materialIds),
    selectedPages: JSON.stringify(sourceSelection.selectedPages),
    fingerprint: sourceSelection.fingerprint,
  })
  const result = await fetch(`/api/material-brain/debug?${params.toString()}`, {
    method: 'GET', credentials: 'same-origin', signal,
  })
  const data = await result.json() as DebugResponse
  if (!result.ok) throw new Error(data.error || `HTTP_${result.status}`)
  if (data.fingerprint !== sourceSelection.fingerprint
    || (data.brain && data.brain.scope.fingerprint !== sourceSelection.fingerprint)) {
    throw new Error('FINGERPRINT_MISMATCH')
  }
  return data
}

const REGENERATE_POLL_MS = 4000

export default function MaterialBrainDebugViewer({ temaId, sessionId, materialNames, sourceSelection, onClose }: Props) {
  const [response, setResponse] = useState<DebugResponse | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [regenerateError, setRegenerateError] = useState('')
  const [regenerateNotice, setRegenerateNotice] = useState('')
  const [previousSummary, setPreviousSummary] = useState<MaterialBrainDebugSummary | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchDebugStatus(sourceSelection, controller.signal)
      .then(setResponse)
      .catch(caught => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => controller.abort()
  }, [sourceSelection])

  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current) }, [])

  const brain = response?.brain
  const summary = useMemo(() => brain ? deriveMaterialBrainDebugSummary(brain) : null, [brain])

  const pollUntilSettled = () => {
    pollTimer.current = setTimeout(async () => {
      try {
        const data = await fetchDebugStatus(sourceSelection)
        setResponse(data)
        if (data.status === 'building') { pollUntilSettled(); return }
        setRegenerateNotice('')
      } catch (caught) {
        setRegenerateError(caught instanceof Error ? caught.message : String(caught))
      }
      setRegenerating(false)
    }, REGENERATE_POLL_MS)
  }

  const runRegenerate = async () => {
    // Re-verify the selection right before executing — the fingerprint
    // this Debug is currently showing must still match the live source
    // selection, or we could rebuild the wrong scope.
    if (response && response.fingerprint !== sourceSelection.fingerprint) {
      setRegenerateError('La selección cambió desde que abriste este Debug.\nCierra y vuelve a abrir Material Brain Debug.')
      setConfirmOpen(false)
      return
    }
    setConfirmOpen(false)
    setRegenerateError('')
    setRegenerateNotice('')
    setRegenerating(true)
    if (summary) setPreviousSummary(summary)
    try {
      const result = await fetch('/api/material-brain/debug/regenerate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialIds: sourceSelection.materialIds,
          selectedPages: sourceSelection.selectedPages,
          sourceSelectionFingerprint: sourceSelection.fingerprint,
        }),
      })
      const data = await result.json() as DebugResponse
      if (!result.ok) {
        if (data.error === 'FINGERPRINT_MISMATCH') {
          setRegenerateError('La selección cambió desde que abriste este Debug.\nCierra y vuelve a abrir Material Brain Debug.')
        } else {
          setRegenerateError(data.error || `HTTP_${result.status}`)
        }
        setRegenerating(false)
        return
      }
      setResponse(data)
      if (data.status === 'building') {
        setRegenerateNotice('Ya existe una regeneración en progreso.')
        pollUntilSettled()
        return
      }
      setRegenerating(false)
    } catch (caught) {
      setRegenerateError(caught instanceof Error ? caught.message : String(caught))
      setRegenerating(false)
    }
  }
  const grouped = useMemo(() => brain ? KIND_ORDER.map(kind => ({
    kind, units: brain.units.filter(unit => unit.kind === kind),
  })).filter(group => group.units.length) : [], [brain])
  const rawJson = brain ? JSON.stringify(brain, null, 2) : ''

  const copyJson = async () => {
    if (!rawJson) return
    await navigator.clipboard.writeText(rawJson)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="mbd-overlay" role="dialog" aria-modal="true" aria-label="Material Brain Debug">
      <header className="mbd-topbar">
        <button onClick={onClose} className="mbd-close">← Volver al proceso</button>
        <div className="mbd-title"><b>🧠 Material Brain Debug</b><span>DEV</span></div>
        <span className={`mbd-status mbd-status-${response?.status || 'loading'}`}>{response?.status || 'loading'}</span>
        {IS_DEV && (
          <button
            className="mbd-regen-btn"
            disabled={regenerating || response?.status === 'building'}
            onClick={() => setConfirmOpen(true)}
          >
            {regenerating || response?.status === 'building'
              ? 'Regenerando…'
              : response?.status === 'missing'
                ? 'Generar Material Brain'
                : '↻ Regenerar Material Brain'}
          </button>
        )}
      </header>

      {confirmOpen && (
        <div className="mbd-confirm-overlay" role="alertdialog" aria-modal="true">
          <div className="mbd-confirm">
            <h3>Regenerar Material Brain</h3>
            <p>Esto eliminará el Brain actual para esta selección y volverá a analizar los materiales seleccionados.</p>
            <p>Puede ejecutar llamadas de IA y Vision.</p>
            <div className="mbd-confirm-facts">
              <div><b>Materiales</b><span>{sourceSelection.materialIds.length}</span></div>
              <div><b>Páginas</b><span>{Object.values(sourceSelection.selectedPages).reduce((sum, pages) => sum + pages.length, 0)}</span></div>
              <div><b>Fingerprint</b><span>{sourceSelection.fingerprint}</span></div>
            </div>
            <div className="mbd-confirm-actions">
              <button className="mbd-confirm-cancel" onClick={() => setConfirmOpen(false)}>Cancelar</button>
              <button className="mbd-confirm-go" onClick={runRegenerate}>Regenerar</button>
            </div>
          </div>
        </div>
      )}

      <div className="mbd-layout">
        <aside className="mbd-nav">
          <div className="mbd-note">
            <b>Índice técnico</b>
            <a href="#mbd-source">Source / Coverage</a>
            <a href="#mbd-warnings">Warnings</a>
            {grouped.map(group => <a key={group.kind} href={`#mbd-${group.kind}`}>{MATERIAL_BRAIN_KIND_LABELS[group.kind]} ({group.units.length})</a>)}
            <a href="#mbd-relations">Relations</a>
            <a href="#mbd-raw">Raw JSON</a>
          </div>
        </aside>

        <main className="mbd-main">
          <section className="mbd-identity">
            <div><b>temaId</b><code>{temaId || '—'}</code></div>
            <div><b>sessionId</b><code>{sessionId || '—'}</code></div>
            <div><b>materialIds</b><code>{sourceSelection.materialIds.join(', ')}</code></div>
            <div><b>selectedPages</b><code>{JSON.stringify(sourceSelection.selectedPages)}</code></div>
            <div><b>sourceSelectionFingerprint</b><code>{sourceSelection.fingerprint}</code></div>
            <div><b>brain key/store key</b><code>{response?.brainKey || '—'}</code></div>
            <div><b>brain version</b><code>{brain?.meta.version || '—'} / {brain?.meta.builderVersion || '—'}</code></div>
            <div><b>built at</b><code>{brain?.meta.generatedAt || '—'}</code></div>
          </section>

          {regenerateNotice && <div className="mbd-state">{regenerateNotice}</div>}
          {regenerateError && <div className="mbd-state mbd-error" style={{ whiteSpace: 'pre-line' }}>{regenerateError}</div>}
          {previousSummary && summary && !regenerating && (
            <section className="mbd-diff">
              <h3>Regeneration diff</h3>
              {([
                ['Knowledge units', previousSummary.units, summary.units],
                ['Facts', previousSummary.byKind.fact || 0, summary.byKind.fact || 0],
                ['Formulas', previousSummary.byKind.formula || 0, summary.byKind.formula || 0],
                ['Relations', previousSummary.relations, summary.relations],
                ['Warnings', previousSummary.warnings.length, summary.warnings.length],
                ['Coverage', `${previousSummary.coveragePercent}%`, `${summary.coveragePercent}%`],
                ['Visual enrichments', previousSummary.visionPages.length, summary.visionPages.length],
              ] as const).map(([label, before, after]) => (
                <div className="mbd-diff-row" key={label}>
                  <span>{label}</span><b>{before} → {after}</b>
                </div>
              ))}
            </section>
          )}

          {!response && !error && <div className="mbd-state">Leyendo Material Brain persistido…</div>}
          {error && <div className="mbd-state mbd-error">No se pudo leer el Material Brain: {error}</div>}
          {response?.status === 'missing' && <div className="mbd-state">No existe Material Brain para este fingerprint.</div>}
          {response?.status === 'building' && <div className="mbd-state">Material Brain se está preparando… Este viewer no inicia ni reintenta la preparación.</div>}
          {response?.status === 'failed' && !brain && <div className="mbd-state mbd-error">Material Brain failed. No se ejecutó ningún retry.</div>}

          {brain && summary && <>
            {brain.meta.status === 'partial' && <div className="mbd-partial">⚠ Brain partial: mostrando únicamente la autoridad persistida disponible.</div>}
            <section className="mbd-stats">
              {[
                ['Knowledge units', summary.units], ['Concepts', summary.byKind.concept || 0],
                ['Definitions', summary.byKind.definition || 0], ['Formulas', summary.byKind.formula || 0],
                ['Examples', summary.byKind.example || 0], ['Relations', summary.relations],
                ['Pages covered', summary.coveredPages.length], ['Pages selected', summary.selectedPages.length],
                ['Coverage', `${summary.coveragePercent}%`], ['Visual enrichments', summary.visionPages.length],
                ['Grounded units', `${summary.groundedUnits}/${summary.units}`], ['Warnings', summary.warnings.length],
              ].map(([label, value]) => <div className="mbd-stat" key={label}><strong>{value}</strong><span>{label}</span></div>)}
            </section>

            <section className="mbd-section" id="mbd-source">
              <h2>📌 Source / Coverage</h2>
              <div className="mbd-coverage-grid">
                <div><b>Selected pages</b><span>{refs(summary.selectedPages)}</span></div>
                <div><b>Covered pages</b><span>{refs(summary.coveredPages)}</span></div>
                <div><b>Missing pages</b><span>{refs(summary.missingPages)}</span></div>
                <div><b>Excluded/minimal pages</b><span>{refs(summary.minimalPages)}</span></div>
                <div><b>Vision-enriched pages</b><span>{refs(summary.visionPages)}</span></div>
                <div><b>Source provenance coverage</b><span>{summary.groundedUnits}/{summary.units} units grounded</span></div>
              </div>
            </section>

            <section className="mbd-section" id="mbd-warnings">
              <h2>⚠ Deterministic warnings</h2>
              {summary.warnings.length ? <ul>{summary.warnings.map(item => <li key={item}>{item}</li>)}</ul> : <p>Sin warnings derivados.</p>}
            </section>

            {grouped.map(group => <section className="mbd-section" id={`mbd-${group.kind}`} key={group.kind}>
              <h2>{MATERIAL_BRAIN_KIND_LABELS[group.kind]}</h2>
              <div className="mbd-units">{group.units.map(unit => <UnitCard key={unit.id} unit={unit} names={materialNames} />)}</div>
            </section>)}

            <section className="mbd-section" id="mbd-relations">
              <h2>🔗 Relations</h2>
              {brain.relations.length ? brain.relations.map(relation => {
                const from = brain.units.find(unit => unit.id === relation.fromUnitId)?.label || relation.fromUnitId
                const to = brain.units.find(unit => unit.id === relation.toUnitId)?.label || relation.toUnitId
                return <div className="mbd-relation" key={relation.id}><b>{from}</b><code>→ {relation.type} →</code><b>{to}</b><span>{relation.statement}</span><small>{refs(relation.provenance)}</small></div>
              }) : <p>No hay relations persistidas.</p>}
            </section>

            <details className="mbd-raw" id="mbd-raw">
              <summary>&lt;&gt; Raw Brain JSON</summary>
              <button onClick={copyJson}>{copied ? 'Copiado' : 'Copy JSON'}</button>
              <pre>{rawJson}</pre>
            </details>
          </>}
        </main>
      </div>
      <style>{`
        .mbd-overlay{position:fixed;inset:0;z-index:10000;background:var(--bg-primary);color:var(--text-primary);font-family:Inter,system-ui,sans-serif}
        .mbd-topbar{height:72px;padding:0 20px;display:flex;align-items:center;gap:18px;border-bottom:1.5px solid var(--border-color2);background:color-mix(in srgb,var(--bg-primary) 92%,transparent);backdrop-filter:blur(12px)}
        .mbd-close{border:1.5px solid var(--text-primary);background:var(--bg-card);color:var(--text-primary);border-radius:10px;padding:8px 14px;font-weight:800;cursor:pointer;box-shadow:2px 3px 0 var(--text-primary)}
        .mbd-title{flex:1;display:flex;align-items:center;gap:10px}.mbd-title b{font-size:24px}.mbd-title span,.mbd-chip{font-size:10px;font-weight:900;letter-spacing:.08em;border:1px solid var(--gold);color:var(--gold);border-radius:999px;padding:3px 7px}
        .mbd-status{font-weight:900;padding:6px 10px;border-radius:999px;background:var(--bg-card);border:1px solid var(--border-color2)}.mbd-status-ready{color:#22c55e}.mbd-status-partial,.mbd-status-building{color:#f59e0b}.mbd-status-failed{color:#ef4444}
        .mbd-layout{height:calc(100vh - 72px);display:flex}.mbd-nav{width:230px;flex:none;padding:20px 14px;overflow:auto}.mbd-note{background:#fde047;color:#422006;padding:26px 14px 16px;border:1.5px solid #78350f;box-shadow:4px 6px 0 #78350f;transform:rotate(-.6deg);display:flex;flex-direction:column;gap:7px}.mbd-note a{color:#422006;text-decoration:none;font-size:13px}.mbd-note a:hover{text-decoration:underline}
        .mbd-main{flex:1;overflow:auto;padding:22px 30px 80px}.mbd-main>section,.mbd-main>details{max-width:1180px;margin-left:auto;margin-right:auto}.mbd-identity{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-bottom:18px}.mbd-identity div{display:flex;gap:8px;min-width:0;font-size:12px}.mbd-identity code{overflow:hidden;text-overflow:ellipsis;color:var(--text-muted)}
        .mbd-state,.mbd-partial{max-width:900px;margin:40px auto;padding:22px;border:1.5px dashed var(--gold);border-radius:12px;background:color-mix(in srgb,var(--gold) 8%,var(--bg-card));text-align:center}.mbd-error{border-color:#ef4444}.mbd-partial{text-align:left;margin:0 auto 18px}
        .mbd-regen-btn{border:1.5px solid var(--gold);background:var(--bg-card);color:var(--gold);border-radius:10px;padding:8px 14px;font-weight:800;cursor:pointer}.mbd-regen-btn:disabled{opacity:.55;cursor:not-allowed}
        .mbd-confirm-overlay{position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}
        .mbd-confirm{max-width:440px;width:90%;background:var(--bg-card);border:1.5px solid var(--border-color2);border-radius:14px;padding:24px;box-shadow:6px 8px 0 rgba(0,0,0,.25)}.mbd-confirm h3{margin:0 0 12px}.mbd-confirm p{font-size:13px;color:var(--text-muted);margin:0 0 10px}
        .mbd-confirm-facts{display:flex;flex-direction:column;gap:6px;margin:14px 0;padding:12px;background:var(--bg-secondary);border-radius:10px}.mbd-confirm-facts div{display:flex;justify-content:space-between;font-size:12px}.mbd-confirm-facts span{color:var(--text-muted);word-break:break-all;text-align:right}
        .mbd-confirm-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}.mbd-confirm-cancel{background:transparent;border:1px solid var(--border-color2);color:var(--text-primary);border-radius:8px;padding:8px 14px;cursor:pointer}.mbd-confirm-go{background:var(--gold);border:1px solid var(--gold);color:#1a1a1a;border-radius:8px;padding:8px 14px;font-weight:800;cursor:pointer}
        .mbd-diff{max-width:900px;margin:0 auto 18px;padding:16px 20px;border:1.5px solid var(--border-color2);border-radius:12px;background:var(--bg-card)}.mbd-diff h3{margin:0 0 10px}.mbd-diff-row{display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-top:1px dashed var(--border-color2)}.mbd-diff-row:first-of-type{border-top:none}
        .mbd-stats{display:grid;grid-template-columns:repeat(6,minmax(110px,1fr));gap:10px;margin-bottom:22px}.mbd-stat{background:var(--bg-card);border:1.5px solid var(--border-color2);border-radius:12px;padding:12px}.mbd-stat strong{display:block;font-size:25px;color:var(--gold)}.mbd-stat span{font-size:11px;color:var(--text-muted)}
        .mbd-section{padding:20px 0;border-top:1px solid var(--border-color2)}.mbd-section h2{margin:0 0 14px;font-size:23px}.mbd-coverage-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.mbd-coverage-grid div{background:var(--bg-card);padding:12px;border-radius:10px;border:1px solid var(--border-color2)}.mbd-coverage-grid b,.mbd-coverage-grid span{display:block}.mbd-coverage-grid span{font-size:12px;color:var(--text-muted);margin-top:5px;word-break:break-word}
        .mbd-units{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.mbd-unit{background:var(--bg-card);border:1.5px solid var(--border-color2);border-radius:13px;padding:15px;box-shadow:3px 4px 0 color-mix(in srgb,var(--text-primary) 18%,transparent)}.mbd-unit-head{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.mbd-kind,.mbd-tier{font-size:10px;font-weight:900;padding:3px 7px;border-radius:999px;border:1px solid var(--blue);color:var(--blue)}.mbd-tier-critical{border-color:#ef4444;color:#ef4444}.mbd-tier-supporting{border-color:var(--gold);color:var(--gold)}.mbd-unit h4{font-size:18px;margin:10px 0 6px}.mbd-unit p{font-size:13px;line-height:1.5;color:var(--text-muted)}.mbd-unit-meta{display:flex;gap:8px;flex-wrap:wrap;font-size:10px;color:var(--text-faint)}.mbd-formula{display:block;margin-top:10px;padding:9px;background:var(--bg-secondary);border-radius:8px}.mbd-details-btn{margin-top:12px;background:transparent;color:var(--blue);border:0;padding:0;cursor:pointer}.mbd-details{margin-top:10px;padding-top:10px;border-top:1px dashed var(--border-color2);font-size:11px;display:flex;flex-direction:column;gap:5px}.mbd-source{margin-top:5px;padding:8px;background:var(--bg-secondary);border-radius:7px}.mbd-source blockquote{margin:6px 0 0;padding-left:8px;border-left:2px solid var(--gold);color:var(--text-muted)}
        .mbd-relation{display:grid;grid-template-columns:auto auto auto 1fr;gap:9px;align-items:center;background:var(--bg-card);border:1px solid var(--border-color2);border-radius:10px;padding:10px;margin-bottom:8px}.mbd-relation code{color:var(--gold)}.mbd-relation span,.mbd-relation small{color:var(--text-muted)}.mbd-relation small{grid-column:1/-1}.mbd-raw{border:1.5px solid var(--border-color2);border-radius:12px;padding:14px}.mbd-raw summary{font-weight:900;cursor:pointer}.mbd-raw button{margin:10px 0}.mbd-raw pre{max-height:600px;overflow:auto;background:#07090d;color:#d1fae5;padding:14px;border-radius:8px;font-size:11px;white-space:pre-wrap;word-break:break-word}
        @media(max-width:900px){.mbd-nav{display:none}.mbd-stats{grid-template-columns:repeat(3,1fr)}.mbd-units,.mbd-coverage-grid{grid-template-columns:1fr}.mbd-identity{grid-template-columns:1fr}}
        @media(max-width:560px){.mbd-title span{display:none}.mbd-title b{font-size:17px}.mbd-main{padding:16px}.mbd-stats{grid-template-columns:repeat(2,1fr)}}
      `}</style>
    </div>
  )
}
