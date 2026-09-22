'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AcademicContent } from '../academic/AcademicContent'
import type { SourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import type { PageStudyView } from '../../lib/pageStudy/view'
import {
  PAGE_STUDY_DEFAULT_BLOCK_SIZE,
  adaptiveBlockSizeOptions,
  compactPageList,
  normalizePublicTurns,
  safePageStudyMessage,
  validatePageStudyBlockSize,
  type PageStudyPublicTurn,
} from '../../lib/pageStudy/ui'

interface MaterialOption {
  id?: string
  materialId?: string
  nombre?: string
  name?: string
  text_status?: string
  pages_count?: number
}

interface PreparationGroup {
  sourceSelection: SourceSelectionSnapshot
  materials: Array<{ materialId: string; materialName: string; selectedPages: number[] }>
}

interface StateResponse {
  success?: boolean
  view?: PageStudyView
  turns?: unknown
  userMessage?: string
}

interface TurnRequest {
  planId: string
  slot: string
  message: string
  expectedSeq: number
}

interface Props {
  temaId: string
  materiales: MaterialOption[]
  initialSelectedIds?: string[]
  initialPlanId?: string | null
  onPlanIdChange?: (planId: string | null) => void
  onClose: () => void
}

const restoreFlights = new Map<string, Promise<StateResponse>>()

function readState(planId: string): Promise<StateResponse> {
  const existing = restoreFlights.get(planId)
  if (existing) return existing
  const request = fetch(`/api/page-study/state?planId=${encodeURIComponent(planId)}`, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  }).then(async response => {
    const payload = await response.json().catch(() => ({})) as StateResponse
    if (!response.ok || payload.success !== true || !payload.view) throw new Error(safePageStudyMessage(payload, 'No pude recuperar tu estudio. Inténtalo de nuevo.'))
    return payload
  }).finally(() => restoreFlights.delete(planId))
  restoreFlights.set(planId, request)
  return request
}

const materialIdOf = (material: MaterialOption): string => String(material.materialId || material.id || '').trim()
const materialNameOf = (material: MaterialOption): string => String(material.nombre || material.name || materialIdOf(material) || 'Material')

function updatePlanUrl(temaId: string, planId: string | null) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (planId) {
    url.searchParams.set('temaId', temaId)
    url.searchParams.set('pageStudyPlanId', planId)
  } else {
    url.searchParams.delete('pageStudyPlanId')
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

async function prepareMaterialGroups(groups: PreparationGroup[]): Promise<void> {
  for (const group of groups) {
    const selection = group.sourceSelection
    const params = new URLSearchParams({
      materialIds: JSON.stringify(selection.materialIds),
      selectedPages: JSON.stringify(selection.selectedPages),
      fingerprint: selection.fingerprint,
    })
    const lookup = await fetch(`/api/adaptive/blueprint?${params.toString()}`, { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
    const restored = await lookup.json().catch(() => ({}))
    if (lookup.ok && restored?.status === 'ready' && restored?.blueprint?.sourceSelectionFingerprint === selection.fingerprint) continue

    const generated = await fetch('/api/adaptive/blueprint', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        materials: group.materials.map(material => ({ ...material, text: '' })),
        sourceSelection: selection,
        requireExplicitPageSelection: true,
      }),
    })
    const payload = await generated.json().catch(() => ({}))
    if (!generated.ok || payload?.success !== true || payload?.blueprint?.sourceSelectionFingerprint !== selection.fingerprint) {
      throw new Error('No pude preparar tus materiales. Inténtalo de nuevo.')
    }
  }
}

function Provenance({ turn, names }: { turn: PageStudyPublicTurn; names: Map<string, string> }) {
  const grouped = new Map<string, number[]>()
  for (const source of turn.provenance) grouped.set(source.materialId, [...(grouped.get(source.materialId) || []), ...source.pages])
  if (!grouped.size) return null
  return (
    <div className="ps-sources" aria-label="Fuentes de esta respuesta">
      {[...grouped].map(([materialId, pages]) => (
        <span className="ps-source" key={materialId}>
          Fuente: {names.get(materialId) || 'Material'} · págs. {compactPageList(pages)}
        </span>
      ))}
    </div>
  )
}

export default function PageStudyMode({ temaId, materiales, initialSelectedIds = [], initialPlanId, onPlanIdChange, onClose }: Props) {
  const options = useMemo(() => materiales
    .map(material => ({ raw: material, id: materialIdOf(material), name: materialNameOf(material) }))
    .filter(material => material.id), [materiales])
  const optionIds = useMemo(() => new Set(options.map(option => option.id)), [options])
  const [orderedIds, setOrderedIds] = useState<string[]>(() => [...new Set(initialSelectedIds.map(String).filter(id => optionIds.has(id)))])
  const [planId, setPlanId] = useState<string | null>(initialPlanId || null)
  const [view, setView] = useState<PageStudyView | null>(null)
  const [turns, setTurns] = useState<PageStudyPublicTurn[]>([])
  const [restoring, setRestoring] = useState(Boolean(initialPlanId))
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [setupRetry, setSetupRetry] = useState(false)
  const [retryRequest, setRetryRequest] = useState<{ request: TurnRequest; groups?: PreparationGroup[] } | null>(null)
  const [blockChoice, setBlockChoice] = useState<number | 'custom'>(PAGE_STUDY_DEFAULT_BLOCK_SIZE)
  const [blockChoiceTouched, setBlockChoiceTouched] = useState(false)
  const [customBlockSize, setCustomBlockSize] = useState('15')
  const [overviewOpen, setOverviewOpen] = useState(true)
  const actionLockRef = useRef(false)
  const skipNextRestoreRef = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  // Phase 5I: the block-size step adapts to the ACTUAL selected materials — a tiny document never
  // offers a 5/10/15/20 choice that all resolve to the same one-block plan anyway.
  const blockPlan = useMemo(() => adaptiveBlockSizeOptions(orderedIds.map(id => options.find(option => option.id === id)?.raw.pages_count)), [orderedIds, options])
  useEffect(() => {
    if (blockChoiceTouched) return
    setBlockChoice(blockPlan.recommended)
  }, [blockPlan, blockChoiceTouched])
  const blockSize = blockPlan.mode === 'full' ? blockPlan.recommended : (blockChoice === 'custom' ? validatePageStudyBlockSize(customBlockSize) : blockChoice)
  const names = useMemo(() => new Map((view?.materials || []).map(material => [material.materialId, material.name])), [view])

  const applyState = useCallback((payload: StateResponse) => {
    if (payload.view) setView(payload.view)
    setTurns(normalizePublicTurns(payload.turns))
  }, [])

  const restore = useCallback(async (targetPlanId: string) => {
    setRestoring(true)
    setError(null)
    try {
      applyState(await readState(targetPlanId))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No pude recuperar tu estudio. Inténtalo de nuevo.')
    } finally {
      setRestoring(false)
    }
  }, [applyState])

  useEffect(() => {
    if (!planId) return
    if (skipNextRestoreRef.current === planId) {
      skipNextRestoreRef.current = null
      return
    }
    void restore(planId)
  }, [planId, restore])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: turns.length ? 'smooth' : 'auto' })
  }, [turns, busy])

  const recoverAfterFailure = useCallback(async (request: TurnRequest): Promise<boolean> => {
    try {
      const restored = await readState(request.planId)
      applyState(restored)
      return Boolean(restored.view && restored.view.turnSeq >= request.expectedSeq)
    } catch {
      return false
    }
  }, [applyState])

  const performTurn = useCallback(async (request: TurnRequest, groups?: PreparationGroup[]) => {
    let posted = false
    try {
      if (groups?.length) {
        setPreparing(true)
        await prepareMaterialGroups(groups)
        setPreparing(false)
      }
      posted = true
      const response = await fetch('/api/page-study/turn', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success !== true || !payload?.view || !payload?.turn) {
        if (payload?.view) setView(payload.view as PageStudyView)
        throw new Error(safePageStudyMessage(payload))
      }
      setView(payload.view as PageStudyView)
      setTurns(previous => normalizePublicTurns([...previous, payload.turn]))
      setInput('')
      setError(null)
      setRetryRequest(null)
      setSetupRetry(false)
      requestAnimationFrame(() => composerRef.current?.focus())
    } catch (failure) {
      setPreparing(false)
      const recovered = posted ? await recoverAfterFailure(request) : false
      if (recovered) {
        setError(null)
        setRetryRequest(null)
        setInput('')
      } else {
        setError(failure instanceof Error ? failure.message : 'No pude continuar este turno. Inténtalo de nuevo.')
        setRetryRequest({ request, groups })
      }
    }
  }, [recoverAfterFailure])

  const withActionLock = useCallback(async (work: () => Promise<void>) => {
    if (actionLockRef.current) return
    actionLockRef.current = true
    setBusy(true)
    try { await work() } finally {
      actionLockRef.current = false
      setBusy(false)
    }
  }, [])

  const startNewPlan = useCallback(() => withActionLock(async () => {
    if (!orderedIds.length || blockSize === null) return
    setError(null)
    setSetupRetry(false)
    const response = await fetch('/api/page-study-plan', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ temaId, orderedMaterialIds: orderedIds, blockSize }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.success !== true || !payload?.view) {
      setSetupRetry(true)
      setError(safePageStudyMessage(payload, 'No pude preparar este plan. Inténtalo de nuevo.'))
      return
    }
    const nextPlanId = String(payload.view.planId)
    // This action already owns the freshly returned authoritative view. Avoid racing it with
    // the mount/reopen reader; only genuine mounts and later reopens should run that reader.
    skipNextRestoreRef.current = nextPlanId
    setPlanId(nextPlanId)
    setView(payload.view)
    setTurns([])
    onPlanIdChange?.(nextPlanId)
    updatePlanUrl(temaId, nextPlanId)
    if (payload.view.turnSeq === 0 && payload.view.nextSlot) {
      await performTurn({ planId: nextPlanId, slot: payload.view.nextSlot, message: '', expectedSeq: 1 }, payload.preparationGroups || [])
    } else {
      await restore(nextPlanId)
    }
  }), [blockSize, onPlanIdChange, orderedIds, performTurn, restore, temaId, withActionLock])

  const startExistingPlan = useCallback(() => {
    if (!planId || !view?.nextSlot || view.turnSeq !== 0) return Promise.resolve()
    return withActionLock(async () => {
      setError(null)
      const response = await fetch(`/api/page-study-plan?planId=${encodeURIComponent(planId)}`, { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success !== true) {
        setError(safePageStudyMessage(payload, 'No pude preparar este plan. Inténtalo de nuevo.'))
        return
      }
      await performTurn({ planId, slot: view.nextSlot!, message: '', expectedSeq: 1 }, payload.preparationGroups || [])
    })
  }, [performTurn, planId, view, withActionLock])

  const send = useCallback(() => {
    const message = input.trim()
    if (!message || !planId || !view?.nextSlot || busy) return
    const request = { planId, slot: view.nextSlot, message, expectedSeq: view.turnSeq + 1 }
    void withActionLock(() => performTurn(request))
  }, [busy, input, performTurn, planId, view, withActionLock])

  const retry = useCallback(() => {
    if (!retryRequest) return
    void withActionLock(() => performTurn(retryRequest.request, retryRequest.groups))
  }, [performTurn, retryRequest, withActionLock])

  const toggleMaterial = (id: string) => setOrderedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
  const moveMaterial = (index: number, direction: -1 | 1) => setOrderedIds(current => {
    const target = index + direction
    if (target < 0 || target >= current.length) return current
    const next = [...current]
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
  })

  if (!planId) {
    return (
      <main className="ps-root ps-setup-root" data-testid="page-study-setup">
        <header className="ps-header">
          <button type="button" className="ps-back" onClick={onClose} aria-label="Volver al tema">← volver</button>
          <div className="ps-title-wrap"><span className="ps-kicker">STUDYAL</span><h1>Estudio por Páginas</h1><p>Ordena tus materiales y ALAI los estudiará contigo, página por página.</p></div>
        </header>
        <section className="ps-setup-card">
          <div className="ps-setup-copy"><span>Paso 1</span><h2>Elige y ordena tus materiales</h2><p>Puedes incluir más de cinco. El orden de esta lista será el orden de estudio.</p></div>
          <div className="ps-material-picker" role="group" aria-label="Materiales para estudiar">
            {options.map(option => {
              const selectedIndex = orderedIds.indexOf(option.id)
              const selected = selectedIndex >= 0
              return (
                <div className={`ps-material-option ${selected ? 'selected' : ''}`} key={option.id}>
                  <button type="button" className="ps-material-toggle" aria-pressed={selected} onClick={() => toggleMaterial(option.id)}>
                    <span className="ps-order-badge">{selected ? selectedIndex + 1 : '○'}</span>
                    <span className="ps-material-name" title={option.name}>{option.name}</span>
                    <span>{selected ? 'Incluido' : 'Añadir'}</span>
                  </button>
                  {selected && <div className="ps-reorder" aria-label={`Ordenar ${option.name}`}>
                    <button type="button" aria-label={`Mover ${option.name} hacia arriba`} disabled={selectedIndex === 0} onClick={() => moveMaterial(selectedIndex, -1)}>↑</button>
                    <button type="button" aria-label={`Mover ${option.name} hacia abajo`} disabled={selectedIndex === orderedIds.length - 1} onClick={() => moveMaterial(selectedIndex, 1)}>↓</button>
                  </div>}
                </div>
              )
            })}
          </div>

          <div className="ps-setup-copy ps-block-copy"><span>Paso 2</span><h2>Tamaño de cada bloque</h2><p>{blockPlan.mode === 'full' ? 'Este material es corto: lo estudiamos completo, sin dividirlo en bloques.' : '15 páginas funciona bien para la mayoría de materiales.'}</p></div>
          {blockPlan.mode === 'full'
            ? <div className="ps-block-full" role="status">{blockPlan.fullLabel}</div>
            : <>
                <div className="ps-block-options" role="radiogroup" aria-label="Páginas por bloque">
                  {blockPlan.choices.map(choice => <button key={choice.size} type="button" role="radio" aria-checked={blockChoice === choice.size} className={blockChoice === choice.size ? 'active' : ''} onClick={() => { setBlockChoice(choice.size); setBlockChoiceTouched(true) }}>{choice.label}</button>)}
                  {blockPlan.showCustom && <button type="button" role="radio" aria-checked={blockChoice === 'custom'} className={blockChoice === 'custom' ? 'active' : ''} onClick={() => { setBlockChoice('custom'); setBlockChoiceTouched(true) }}>Personalizado</button>}
                </div>
                {blockChoice === 'custom' && <label className="ps-custom-size">Páginas por bloque<input value={customBlockSize} onChange={event => setCustomBlockSize(event.target.value)} inputMode="numeric" type="number" min={1} max={50} aria-invalid={blockSize === null} />{blockSize === null && <span>Escribe un número entre 1 y 50.</span>}</label>}
              </>}

          {error && <div className="ps-error" role="alert"><span>⚠️ {error}</span>{setupRetry && <button type="button" onClick={startNewPlan} disabled={busy}>Reintentar</button>}</div>}
          <div className="ps-start-row"><span>{orderedIds.length} {orderedIds.length === 1 ? 'material' : 'materiales'} · {blockSize ?? '—'} páginas por bloque</span><button type="button" className="ps-primary" onClick={startNewPlan} disabled={busy || !orderedIds.length || blockSize === null}>{busy ? (preparing ? 'Preparando materiales…' : 'Creando tu estudio…') : 'Empezar a estudiar →'}</button></div>
        </section>
        <PageStudyStyles />
      </main>
    )
  }

  const current = view?.block
  return (
    <main className="ps-root ps-workspace" data-testid="page-study-workspace">
      <header className="ps-header ps-workspace-header">
        <button type="button" className="ps-back" onClick={onClose} aria-label="Salir de Estudio por Páginas">← salir</button>
        <div className="ps-title-wrap"><span className="ps-kicker">ESTUDIO POR PÁGINAS</span><h1 title={current?.materialName}>{current?.materialName || (view?.finished ? 'Plan completado' : 'Tu plan de estudio')}</h1><p>{current ? `Páginas ${current.pageStart}–${current.pageEnd}` : view?.finished ? 'Terminaste todos los materiales.' : 'Listo para comenzar.'}</p></div>
        <div className="ps-header-progress" aria-label={`${view?.coverage.planPct || 0}% estudiado`}><strong>{view?.coverage.planPct || 0}%</strong><span>estudiado</span></div>
        <button type="button" className="ps-overview-toggle" aria-expanded={overviewOpen} onClick={() => setOverviewOpen(value => !value)}>Plan</button>
      </header>

      {restoring ? <div className="ps-center-state" role="status" aria-live="polite"><span className="ps-spinner" />Recuperando tu estudio…</div> : !view ? (
        <div className="ps-center-state"><p>{error || 'No pude recuperar tu estudio.'}</p><button type="button" className="ps-primary" onClick={() => void restore(planId)}>Reintentar</button></div>
      ) : (
        <div className={`ps-workspace-grid ${overviewOpen ? '' : 'context-collapsed'}`}>
          <section className="ps-chat" aria-label="Conversación de estudio">
            <div ref={listRef} className="ps-messages" aria-live="polite">
              {!turns.length && !busy && <div className="ps-empty-chat"><span>✦</span><h2>Tu estudio está listo</h2><p>ALAI empezará por {current?.materialName || 'el primer material'}, páginas {current?.pageStart}–{current?.pageEnd}.</p><button type="button" className="ps-primary" onClick={startExistingPlan}>Comenzar el estudio</button></div>}
              {turns.map(turn => (
                <div className="ps-turn" key={turn.seq}>
                  {turn.userMessage && <article className="ps-message ps-user"><div className="ps-speaker">TÚ</div><div className="ps-message-content"><AcademicContent content={turn.userMessage} /></div></article>}
                  <article className="ps-message ps-alai"><div className="ps-speaker"><span>✦</span> ALAI</div><div className="ps-message-content"><AcademicContent content={turn.reply} /></div><Provenance turn={turn} names={names} /></article>
                </div>
              ))}
              {busy && <div className="ps-thinking" role="status" aria-live="polite"><span className="ps-thinking-mark">✦</span><span>{preparing ? 'Preparando tus materiales…' : 'ALAI está pensando'}</span><i /><i /><i /></div>}
            </div>

            {error && <div className="ps-error ps-turn-error" role="alert"><span>⚠️ {error}</span>{retryRequest && <button type="button" onClick={retry} disabled={busy}>Reintentar</button>}</div>}
            {!view.finished && turns.length > 0 && <form className="ps-composer" onSubmit={event => { event.preventDefault(); send() }}>
              <textarea ref={composerRef} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() } }} rows={1} disabled={busy} placeholder="Escribe tu respuesta o pregunta…" aria-label="Escribe tu respuesta o pregunta" />
              <button type="submit" disabled={busy || !input.trim()} aria-label="Enviar mensaje">➤</button>
              <span className="ps-composer-hint">Enter para enviar · Shift+Enter para nueva línea</span>
            </form>}
            {view.finished && <div className="ps-complete" role="status"><strong>Plan completado</strong><span>Has recorrido todas las páginas seleccionadas.</span></div>}
          </section>

          {overviewOpen && <aside className="ps-context" aria-label="Contexto y progreso del estudio">
            <div className="ps-progress-card"><div><span>COBERTURA</span><strong>{view.coverage.planPct}% del contenido</strong></div><div className="ps-progress-track"><span style={{ width: `${view.coverage.planPct}%` }} /></div><small>{view.coverage.pagesDone} de {view.coverage.pagesTotal} páginas completas</small></div>
            {view.pending && <div className="ps-pending-note">ALAI espera tu respuesta en la conversación.</div>}
            <div className="ps-context-section"><h2>Plan de estudio</h2><div className="ps-block-list">
              {view.blocks.map(block => <div className={`ps-block ${block.phase}`} key={`${block.materialId}:${block.index}`}><span>{block.phase === 'studied' ? '✓' : block.phase === 'current' ? '●' : '○'}</span><div><strong title={block.materialName}>{block.materialName}</strong><small>Páginas {block.pageStart}–{block.pageEnd}</small></div></div>)}
            </div></div>
            <div className="ps-context-section"><h2>Materiales</h2>{view.materials.map(material => <div className={`ps-material-progress ${material.current ? 'current' : ''}`} key={material.materialId}><span title={material.name}>{material.name}</span><small>{material.blocksDone}/{material.blocksTotal} bloques</small></div>)}</div>
            {view.carryoverDue > 0 && <div className="ps-recheck">↻ {view.carryoverDue} {view.carryoverDue === 1 ? 'concepto para volver a mirar' : 'conceptos para volver a mirar'}</div>}
          </aside>}
        </div>
      )}
      <PageStudyStyles />
    </main>
  )
}

function PageStudyStyles() {
  return <style>{`
    .ps-root{position:fixed;inset:0;z-index:9998;background:radial-gradient(circle at 12% 0%,rgba(56,189,248,.1),transparent 30%),var(--bg-primary);color:var(--text-primary);font-family:var(--font-body);display:flex;flex-direction:column;min-width:0;overflow:hidden}
    .ps-header{min-height:72px;padding:12px clamp(14px,2.5vw,34px);display:flex;align-items:center;gap:18px;border-bottom:1px solid var(--border-color);background:color-mix(in srgb,var(--bg-primary) 92%,transparent);backdrop-filter:blur(16px);flex-shrink:0;z-index:2}
    .ps-back,.ps-overview-toggle{min-height:42px;border:1px solid var(--border-color);border-radius:12px;background:var(--bg-card);color:var(--text-primary);padding:8px 14px;font:700 15px var(--font-body);cursor:pointer}
    .ps-title-wrap{min-width:0;flex:1}.ps-kicker{font-size:10px;letter-spacing:.16em;color:#38bdf8;font-weight:800}.ps-title-wrap h1{font:800 clamp(20px,2.6vw,30px) var(--font-hand);margin:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ps-title-wrap p{margin:0;color:var(--text-muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ps-setup-root{overflow:auto}.ps-setup-card{width:min(980px,calc(100% - 28px));margin:24px auto 40px;padding:clamp(20px,3vw,36px);border:1px solid var(--border-color);border-radius:22px;background:color-mix(in srgb,var(--bg-card) 88%,transparent);box-shadow:0 24px 70px rgba(0,0,0,.25)}
    .ps-setup-copy span{font-size:11px;color:#38bdf8;font-weight:800;text-transform:uppercase;letter-spacing:.12em}.ps-setup-copy h2{font:800 25px var(--font-hand);margin:4px 0}.ps-setup-copy p{margin:0 0 16px;color:var(--text-muted)}.ps-block-copy{margin-top:30px}
    .ps-material-picker{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;max-height:330px;overflow:auto;padding:3px}.ps-material-option{display:flex;min-width:0;border:1px solid var(--border-color);border-radius:14px;background:var(--bg-primary)}.ps-material-option.selected{border-color:#38bdf8;background:rgba(56,189,248,.08)}.ps-material-toggle{flex:1;min-width:0;display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:10px;border:0;background:transparent;color:var(--text-primary);padding:12px;text-align:left;cursor:pointer}.ps-material-toggle>span:last-child{font-size:12px;color:var(--text-muted)}.ps-order-badge{width:28px;height:28px;display:grid;place-items:center;border-radius:50%;background:rgba(56,189,248,.16);color:#7dd3fc;font-weight:900}.ps-material-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}.ps-reorder{display:flex;align-items:center;padding-right:8px;gap:4px}.ps-reorder button{width:32px;height:32px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-primary);cursor:pointer}.ps-reorder button:disabled{opacity:.3;cursor:not-allowed}
    .ps-block-full{padding:11px 15px;border:1px solid var(--border-color);border-radius:12px;background:rgba(56,189,248,.08);color:#7dd3fc;font-weight:700;display:inline-block}
    .ps-block-options{display:flex;gap:9px;flex-wrap:wrap}.ps-block-options button{min-height:42px;padding:8px 15px;border:1px solid var(--border-color);border-radius:12px;background:var(--bg-primary);color:var(--text-primary);font-weight:700;cursor:pointer}.ps-block-options button.active{border-color:#38bdf8;background:rgba(56,189,248,.13);color:#7dd3fc}.ps-custom-size{display:flex;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap}.ps-custom-size input{width:100px;min-height:42px;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-primary);color:var(--text-primary);padding:8px 10px;font-size:16px}.ps-custom-size span{color:#fca5a5;font-size:13px}.ps-start-row{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:30px;padding-top:20px;border-top:1px solid var(--border-color);color:var(--text-muted)}.ps-primary{min-height:44px;padding:10px 20px;border:0;border-radius:12px;background:linear-gradient(135deg,#38bdf8,#818cf8);color:#071018;font-weight:900;cursor:pointer;box-shadow:0 8px 25px rgba(56,189,248,.22)}.ps-primary:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
    .ps-header-progress{display:flex;flex-direction:column;align-items:flex-end;min-width:76px}.ps-header-progress strong{font-size:20px;color:#7dd3fc}.ps-header-progress span{font-size:11px;color:var(--text-muted)}.ps-workspace-grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,320px);gap:14px;padding:14px}.ps-workspace-grid.context-collapsed{grid-template-columns:minmax(0,1fr)}
    .ps-chat{min-width:0;min-height:0;display:flex;flex-direction:column;border:1px solid var(--border-color);border-radius:18px;background:color-mix(in srgb,var(--bg-card) 76%,transparent);overflow:hidden}.ps-messages{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:clamp(16px,3vw,34px)}.ps-turn{display:flex;flex-direction:column;gap:14px;margin-bottom:24px}.ps-message{min-width:0;max-width:min(820px,88%);border-radius:17px;padding:15px 17px}.ps-alai{align-self:flex-start;background:var(--bg-primary);border:1px solid var(--border-color)}.ps-user{align-self:flex-end;background:rgba(56,189,248,.13);border:1px solid rgba(56,189,248,.28)}.ps-speaker{font-size:11px;font-weight:900;letter-spacing:.1em;color:#7dd3fc;margin-bottom:8px}.ps-user .ps-speaker{color:var(--text-muted);text-align:right}.ps-message-content{min-width:0;overflow-wrap:anywhere;line-height:1.62}.ps-message-content [data-academic-content]{max-width:100%}.ps-message-content pre,.ps-message-content table,.ps-message-content [role=math]{max-width:100%;overflow-x:auto}.ps-message-content table{border-collapse:collapse}.ps-message-content th,.ps-message-content td{border:1px solid var(--border-color);padding:7px}.ps-message-content h1,.ps-message-content h2,.ps-message-content h3{font-family:var(--font-hand);line-height:1.2}.ps-message-content pre{padding:12px;border-radius:10px;background:#0b0b10}.ps-sources{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px solid var(--border-color)}.ps-source{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 9px;border-radius:999px;background:rgba(56,189,248,.08);color:#9bdcf7;font-size:11px}
    .ps-thinking{display:flex;align-items:center;gap:5px;color:var(--text-muted);padding:12px 2px}.ps-thinking-mark{color:#38bdf8;margin-right:5px}.ps-thinking i{width:5px;height:5px;border-radius:50%;background:#7dd3fc;animation:psPulse 1.1s infinite}.ps-thinking i:nth-of-type(2){animation-delay:.15s}.ps-thinking i:nth-of-type(3){animation-delay:.3s}@keyframes psPulse{0%,70%,100%{opacity:.25;transform:translateY(0)}35%{opacity:1;transform:translateY(-3px)}}
    .ps-composer{position:relative;display:flex;align-items:flex-end;gap:10px;padding:12px 14px 24px;border-top:1px solid var(--border-color);background:var(--bg-primary)}.ps-composer textarea{flex:1;min-width:0;min-height:48px;max-height:150px;resize:vertical;border:1px solid var(--border-color);border-radius:14px;background:var(--bg-card);color:var(--text-primary);padding:13px 15px;font:15px var(--font-body);line-height:1.45}.ps-composer textarea:focus{outline:2px solid rgba(56,189,248,.45);border-color:#38bdf8}.ps-composer>button{width:48px;height:48px;border:0;border-radius:13px;background:#38bdf8;color:#06121a;font-size:20px;cursor:pointer}.ps-composer>button:disabled{opacity:.4}.ps-composer-hint{position:absolute;bottom:5px;left:16px;font-size:9px;color:var(--text-faint)}
    .ps-context{min-width:0;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:12px}.ps-progress-card,.ps-context-section,.ps-recheck,.ps-pending-note{border:1px solid var(--border-color);border-radius:15px;background:var(--bg-card);padding:14px}.ps-progress-card>div:first-child{display:flex;align-items:center;justify-content:space-between;gap:10px}.ps-progress-card span,.ps-context-section h2{font-size:10px;letter-spacing:.11em;color:var(--text-muted);margin:0;text-transform:uppercase}.ps-progress-card strong{font-size:14px}.ps-progress-track{height:7px;border-radius:99px;background:var(--bg-primary);overflow:hidden;margin:12px 0 8px}.ps-progress-track span{display:block;height:100%;background:linear-gradient(90deg,#38bdf8,#818cf8);border-radius:inherit}.ps-progress-card small{color:var(--text-muted)}.ps-pending-note{font-size:12px;color:#fde68a;border-color:rgba(250,204,21,.25);background:rgba(250,204,21,.06)}.ps-context-section h2{margin-bottom:10px}.ps-block-list{display:flex;flex-direction:column;gap:8px}.ps-block{display:flex;align-items:center;gap:9px;min-width:0;color:var(--text-muted)}.ps-block.current{color:#7dd3fc}.ps-block.studied{color:#86efac}.ps-block>div{min-width:0;display:flex;flex-direction:column}.ps-block strong{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ps-block small{font-size:10px}.ps-material-progress{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--border-color);font-size:12px}.ps-material-progress.current{color:#7dd3fc}.ps-material-progress span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ps-material-progress small{white-space:nowrap;color:var(--text-muted)}.ps-recheck{font-size:12px;color:#fda4af}
    .ps-error{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:16px 0 0;padding:11px 13px;border:1px solid rgba(248,113,113,.35);border-radius:12px;background:rgba(248,113,113,.08);color:#fecaca}.ps-error button{border:1px solid currentColor;border-radius:9px;background:transparent;color:inherit;padding:7px 10px;cursor:pointer}.ps-turn-error{margin:0 14px 10px}.ps-center-state,.ps-empty-chat{margin:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:30px;color:var(--text-muted)}.ps-empty-chat span{font-size:35px;color:#38bdf8}.ps-empty-chat h2{font:800 27px var(--font-hand);color:var(--text-primary);margin:0}.ps-empty-chat p{max-width:520px;margin:0}.ps-spinner{width:28px;height:28px;border:3px solid rgba(56,189,248,.2);border-top-color:#38bdf8;border-radius:50%;animation:psSpin .8s linear infinite}@keyframes psSpin{to{transform:rotate(360deg)}}.ps-complete{display:flex;align-items:center;justify-content:center;gap:10px;padding:16px;border-top:1px solid var(--border-color);color:#86efac}.ps-complete span{color:var(--text-muted)}
    @media(max-width:900px){.ps-workspace-grid{grid-template-columns:minmax(0,1fr);overflow-y:auto}.ps-chat{min-height:68vh}.ps-context{overflow:visible;order:2}.ps-material-picker{grid-template-columns:1fr}.ps-message{max-width:94%}}
    @media(max-width:600px){.ps-header{padding:9px 10px;gap:9px}.ps-back{padding:7px 9px}.ps-title-wrap h1{font-size:19px}.ps-title-wrap p{font-size:11px}.ps-header-progress{min-width:54px}.ps-overview-toggle{padding:7px 9px}.ps-setup-card{width:calc(100% - 16px);margin:8px auto 24px;padding:16px}.ps-start-row{align-items:stretch;flex-direction:column}.ps-primary{width:100%}.ps-workspace-grid{padding:7px;gap:7px}.ps-chat{border-radius:14px;min-height:72vh}.ps-messages{padding:14px 10px}.ps-message{max-width:97%;padding:12px}.ps-composer{padding:9px 9px 23px}.ps-composer-hint{display:none}.ps-source{white-space:normal}.ps-header-progress span{display:none}}
    @media(prefers-reduced-motion:reduce){.ps-thinking i,.ps-spinner{animation:none}.ps-messages{scroll-behavior:auto}}
  `}</style>
}
