'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { SourceSelectionSnapshot } from '../adaptive/sourceSelection'
import type { MaterialBrainLookupStatus } from './types'
import type { QuizCoverageAnalysis } from './quiz/types'
import type { MaterialCapabilities } from './capabilities'
import type { AcademicStability } from './academicStability'

// ============================================================
// useMaterialBrainLifecycle — dispara el build de Material Brain
// apenas hay una selección confirmada, no cuando el usuario
// hace click en "Generar" dentro de una herramienta.
//
// - POST /api/material-brain dispara el build real
// - GET /api/material-brain consulta estado sin construir
// - Keyed por fingerprint: no refira si no cambia
// - Descarta respuestas stale si el fingerprint cambia mid-flight
// - partial/failed recuperables se reanudan automáticamente con cota dura
// - pending extraction se distingue de failed real y se hace poll
//   acotado con backoff hasta que el texto esté listo
// ============================================================

export type BrainLifecycleStatus = 'idle' | 'extracting' | 'building' | 'ready' | 'partial' | 'failed'

export interface MaterialBrainLifecycle {
  status: BrainLifecycleStatus
  fingerprint: string | null
  preparation: MaterialPreparationClientSummary | null
  quizRecommendation: QuizCoverageAnalysis | null
  /** What each tool can safely do RIGHT NOW — see lib/materialBrain/capabilities.ts. Never gates the hub by itself. */
  capabilities: MaterialCapabilities | null
  /** 'ready' once every leaf is rich or complete_no_content — undefined for a legacy brain (treat as fully enriched). */
  brainEnrichment: 'not_started' | 'enriching' | 'ready' | 'degraded' | 'failed' | null
  /**
   * Canonical academic-stability verdict (see academicStability.ts) —
   * the SINGLE signal to gate new artifact creation on. 'preparing'
   * means the academic universe can still change automatically;
   * 'stable_rich'/'stable_degraded' means it never will again without
   * an explicit regenerate; 'failed' means no usable representation
   * exists. Background enrichment continuation below stops EXACTLY when
   * the server reports one of the three terminal values — never merely
   * because the client gave up polling.
   */
  academicStability: AcademicStability | null
  recheck: () => void
}

export interface MaterialPreparationClientSummary {
  requiredStatus: 'complete' | 'partial' | 'failed' | 'building' | 'missing'
  optionalVisualStatus: string
  completedRequiredSections: number
  totalRequiredSections: number
  completedOptionalSections: number
  totalOptionalSections: number
  requiredFailures: Array<{ chunkId: string; status: string; reason?: string }>
  optionalGaps: string[]
}

const MAX_POLL_ATTEMPTS = 40
const POLL_BACKOFF_BASE_MS = 3000
const POLL_BACKOFF_MAX_MS = 20000
const MAX_AUTOMATIC_RECOVERY_CYCLES = 4
const AUTO_RECOVERY_BASE_MS = 500
// Background rich-enrichment continuation (two-level readiness) — the
// hub is already open at this point. This gap is a small UI "settle"
// pause BETWEEN requests, never overlapping one in flight — it is NOT
// the rate limiter (the server already bounds concurrency/batch size
// per advance call), so it stays short: the real pacing comes from how
// long each bounded batch itself takes (often several seconds), not
// from an artificial client-side tax stacked on top of that.
const ENRICHMENT_POLL_MS = 800
const MAX_ENRICHMENT_CYCLES = 60

type InternalLifecycleStatus = BrainLifecycleStatus | 'missing'

function isExtractingText(textStatus: string | undefined): boolean {
  return textStatus === 'pending' || textStatus === 'processing'
}

function mapServerStatus(
  serverStatus: MaterialBrainLookupStatus | undefined,
  textStatus: string | undefined,
): InternalLifecycleStatus {
  if (isExtractingText(textStatus)) return 'extracting'
  if (serverStatus === 'ready') return 'ready'
  if (serverStatus === 'partial') return 'partial'
  if (serverStatus === 'building') return 'building'
  if (serverStatus === 'missing') return 'missing'
  return 'failed'
}

export function useMaterialBrainLifecycle(
  sourceSelection: SourceSelectionSnapshot | null,
): MaterialBrainLifecycle {
  const [status, setStatus] = useState<BrainLifecycleStatus>('idle')
  const [activeFingerprint, setActiveFingerprint] = useState<string | null>(null)
  const [preparation, setPreparation] = useState<MaterialPreparationClientSummary | null>(null)
  const [quizRecommendation, setQuizRecommendation] = useState<QuizCoverageAnalysis | null>(null)
  const [capabilities, setCapabilities] = useState<MaterialCapabilities | null>(null)
  const [brainEnrichment, setBrainEnrichment] = useState<MaterialBrainLifecycle['brainEnrichment']>(null)
  const [academicStability, setAcademicStability] = useState<MaterialBrainLifecycle['academicStability']>(null)
  // P0 STALL FIX: the background enrichment poller must read the LATEST
  // academicStability from a ref, never from the effect's dependency
  // array. `academicStability` stays the SAME string ('preparing')
  // across many consecutive polls — a useEffect keyed on a value that
  // doesn't change between re-renders simply does not re-run (React
  // skips it when every dependency is reference/value-equal to the
  // previous render), so a poll loop that relies on that value changing
  // to reschedule itself silently dies after exactly one iteration the
  // instant two consecutive polls both report 'preparing'. This is
  // EXACTLY the observed production stall: base build -> one enrichment
  // POST -> academicStability still 'preparing' -> no further POSTs,
  // ever. The fix: self-reschedule from INSIDE the async poll callback
  // itself (never depend on React re-running the effect for repeat
  // ticks), reading this ref for the up-to-date stop condition.
  const academicStabilityRef = useRef<MaterialBrainLifecycle['academicStability']>(null)
  const enrichmentAttemptsRef = useRef(0)

  // Monotonic generation counter — stale responses are discarded
  const generationRef = useRef(0)
  const automaticRecoveryCyclesRef = useRef(0)
  const mountedRef = useRef(true)

  // Pending poll timeout — cleared on new generation or unmount
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current)
        pollTimeoutRef.current = null
      }
    }
  }, [])

  // Track which fingerprint we already triggered a POST for
  const triggeredFingerprintRef = useRef<string | null>(null)

  const clearPendingPoll = useCallback(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current)
      pollTimeoutRef.current = null
    }
  }, [])

  const waitWithCancel = useCallback((ms: number) => {
    return new Promise<void>((resolve) => {
      pollTimeoutRef.current = setTimeout(() => {
        pollTimeoutRef.current = null
        resolve()
      }, ms)
    })
  }, [])

  const resolveStatusFromResponse = useCallback((data: any): InternalLifecycleStatus => {
    const serverStatus = data?.status as MaterialBrainLookupStatus | undefined
    const textStatus = data?.textStatus as string | undefined
    return mapServerStatus(serverStatus, textStatus)
  }, [])

  const hasRetryableRequiredWork = useCallback((data: any) => {
    const failures = data?.preparation?.requiredFailures
    return Array.isArray(failures) && failures.some((failure: any) => failure?.status === 'retryable_failed')
  }, [])

  const hasTerminalRequiredFailure = useCallback((data: any) => {
    const failures = data?.preparation?.requiredFailures
    return Array.isArray(failures) && failures.some((failure: any) => failure?.status === 'terminal_failed')
  }, [])

  const waitForAutomaticRecovery = useCallback(async (): Promise<boolean> => {
    if (automaticRecoveryCyclesRef.current >= MAX_AUTOMATIC_RECOVERY_CYCLES) return false
    automaticRecoveryCyclesRef.current += 1
    setStatus('building')
    await waitWithCancel(AUTO_RECOVERY_BASE_MS * automaticRecoveryCyclesRef.current)
    return true
  }, [waitWithCancel])

  const triggerBuild = useCallback(async (
    selection: SourceSelectionSnapshot,
    generation: number,
  ) => {
    if (!mountedRef.current) return

    clearPendingPoll()
    setStatus('building')
    setActiveFingerprint(selection.fingerprint)

    try {
      const res = await fetch('/api/material-brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialIds: selection.materialIds,
          selectedPages: selection.selectedPages,
        }),
      })

      // Stale check
      if (!mountedRef.current || generationRef.current !== generation) return

      if (!res.ok) {
        if (res.status >= 500 && await waitForAutomaticRecovery()) {
          if (mountedRef.current && generationRef.current === generation) triggerBuild(selection, generation)
          return
        }
        setStatus('failed')
        return
      }

      const data = await res.json()
      if (!mountedRef.current || generationRef.current !== generation) return

      setPreparation(data?.preparation || null)
      setQuizRecommendation(data?.quizRecommendation || null)
      setCapabilities(data?.capabilities || null)
      setBrainEnrichment(data?.brainEnrichment ?? null)
      setAcademicStability(data?.academicStability ?? null)
      academicStabilityRef.current = data?.academicStability ?? null
      const lifecycleStatus = resolveStatusFromResponse(data)

      if ((lifecycleStatus === 'partial' || lifecycleStatus === 'failed') && hasRetryableRequiredWork(data)) {
        if (await waitForAutomaticRecovery()) {
          if (mountedRef.current && generationRef.current === generation) triggerBuild(selection, generation)
        } else setStatus('failed')
        return
      }
      if ((lifecycleStatus === 'partial' || lifecycleStatus === 'failed') && hasTerminalRequiredFailure(data)) {
        setStatus('failed')
        return
      }

      if (lifecycleStatus === 'extracting') {
        setStatus('extracting')
        pollStatus(selection, generation)
      } else if (lifecycleStatus === 'building') {
        setStatus('building')
        pollStatus(selection, generation)
      } else if (lifecycleStatus === 'ready') {
        setStatus('ready')
      } else if (lifecycleStatus === 'partial') {
        setStatus('partial')
      } else {
        // 'missing' from POST should not happen; treat as failed to avoid loops
        setStatus('failed')
      }
    } catch {
      if (mountedRef.current && generationRef.current === generation) {
        if (await waitForAutomaticRecovery()) triggerBuild(selection, generation)
        else setStatus('failed')
      }
    }
  }, [clearPendingPoll, hasRetryableRequiredWork, hasTerminalRequiredFailure, resolveStatusFromResponse, waitForAutomaticRecovery])

  const pollStatus = useCallback(async (
    selection: SourceSelectionSnapshot,
    generation: number,
    attempt = 0,
  ) => {
    if (!mountedRef.current || generationRef.current !== generation) return

    if (attempt >= MAX_POLL_ATTEMPTS) {
      setStatus('failed')
      return
    }

    const delay = Math.min(
      POLL_BACKOFF_BASE_MS * Math.pow(1.5, attempt),
      POLL_BACKOFF_MAX_MS,
    )
    await waitWithCancel(delay)

    if (!mountedRef.current || generationRef.current !== generation) return

    try {
      const params = new URLSearchParams({
        materialIds: JSON.stringify(selection.materialIds),
        selectedPages: JSON.stringify(selection.selectedPages),
      })
      const res = await fetch(`/api/material-brain?${params.toString()}`, {
        method: 'GET',
      })

      if (!mountedRef.current || generationRef.current !== generation) return

      if (!res.ok) {
        setStatus('failed')
        return
      }

      const data = await res.json()
      if (!mountedRef.current || generationRef.current !== generation) return

      setPreparation(data?.preparation || null)
      setQuizRecommendation(data?.quizRecommendation || null)
      setCapabilities(data?.capabilities || null)
      setBrainEnrichment(data?.brainEnrichment ?? null)
      setAcademicStability(data?.academicStability ?? null)
      academicStabilityRef.current = data?.academicStability ?? null
      const lifecycleStatus = resolveStatusFromResponse(data)

      if ((lifecycleStatus === 'partial' || lifecycleStatus === 'failed') && hasRetryableRequiredWork(data)) {
        if (automaticRecoveryCyclesRef.current >= MAX_AUTOMATIC_RECOVERY_CYCLES) {
          setStatus('failed')
          return
        }
        automaticRecoveryCyclesRef.current += 1
        setStatus('building')
        triggerBuild(selection, generation)
        return
      }
      if ((lifecycleStatus === 'partial' || lifecycleStatus === 'failed') && hasTerminalRequiredFailure(data)) {
        setStatus('failed')
        return
      }

      if (lifecycleStatus === 'extracting') {
        setStatus('extracting')
        pollStatus(selection, generation, attempt + 1)
      } else if (lifecycleStatus === 'building') {
        setStatus('building')
        pollStatus(selection, generation, attempt + 1)
      } else if (lifecycleStatus === 'missing') {
        // Text is available and Brain is missing — trigger the real build
        triggerBuild(selection, generation)
      } else if (lifecycleStatus === 'ready') {
        setStatus('ready')
      } else if (lifecycleStatus === 'partial') {
        setStatus('partial')
      } else {
        setStatus('failed')
      }
    } catch {
      if (mountedRef.current && generationRef.current === generation) {
        setStatus('failed')
      }
    }
  }, [clearPendingPoll, hasRetryableRequiredWork, hasTerminalRequiredFailure, resolveStatusFromResponse, triggerBuild, waitWithCancel])

  // P0 fix ("Seguir estudiando" going through preparation again): the
  // FIRST call for a fingerprint used to always go through triggerBuild,
  // which sets status:'building' synchronously and then POSTs — and a
  // POST against an ALREADY-READY Brain still runs one bounded
  // enrichment batch server-side (two-level readiness) before it
  // resolves, which can take tens of seconds. A returning session whose
  // Brain was already fully built from a PRIOR visit would show the
  // preparation screen for that entire batch, every single time it was
  // reopened. Fast lookup-only GET first: if the Brain is already
  // 'ready', resolve immediately with NO 'building' flash at all — the
  // existing background-enrichment-continuation effect below (unchanged)
  // still nudges enrichment forward afterward, without blocking the hub.
  // Only genuinely missing/partial/extracting Brains fall through to the
  // real triggerBuild (POST) path, unchanged.
  const checkExistingThenBuild = useCallback(async (
    selection: SourceSelectionSnapshot,
    generation: number,
  ) => {
    if (!mountedRef.current) return
    setActiveFingerprint(selection.fingerprint)
    try {
      const params = new URLSearchParams({
        materialIds: JSON.stringify(selection.materialIds),
        selectedPages: JSON.stringify(selection.selectedPages),
      })
      const res = await fetch(`/api/material-brain?${params.toString()}`, { method: 'GET' })
      if (!mountedRef.current || generationRef.current !== generation) return
      if (!res.ok) { triggerBuild(selection, generation); return }
      const data = await res.json()
      if (!mountedRef.current || generationRef.current !== generation) return
      const lifecycleStatus = resolveStatusFromResponse(data)
      if (lifecycleStatus === 'ready') {
        setPreparation(data?.preparation || null)
        setQuizRecommendation(data?.quizRecommendation || null)
        setCapabilities(data?.capabilities || null)
        setBrainEnrichment(data?.brainEnrichment ?? null)
        setAcademicStability(data?.academicStability ?? null)
        academicStabilityRef.current = data?.academicStability ?? null
        setStatus('ready')
        return
      }
      // Not ready yet (missing/partial/extracting/failed) — the real
      // build/enrichment path is genuinely needed; fall through as before.
      triggerBuild(selection, generation)
    } catch {
      if (mountedRef.current && generationRef.current === generation) triggerBuild(selection, generation)
    }
  }, [resolveStatusFromResponse, triggerBuild])

  // Main effect: when fingerprint changes, trigger a new build cycle
  useEffect(() => {
    if (!sourceSelection || !sourceSelection.fingerprint) {
      setStatus('idle')
      setActiveFingerprint(null)
      setPreparation(null)
      setQuizRecommendation(null)
      setCapabilities(null)
      setBrainEnrichment(null)
      setAcademicStability(null)
      academicStabilityRef.current = null
      enrichmentAttemptsRef.current = 0
      triggeredFingerprintRef.current = null
      return
    }

    // Already triggered for this fingerprint — don't re-fire
    if (triggeredFingerprintRef.current === sourceSelection.fingerprint) return

    // New fingerprint — new generation. A DIFFERENT selection must
    // never keep polling for enrichment of the OLD one (MB-FAST/CAP
    // isolation) — the generation guard below already discards any
    // in-flight response from a stale generation.
    generationRef.current += 1
    automaticRecoveryCyclesRef.current = 0
    enrichmentAttemptsRef.current = 0
    setCapabilities(null)
    setBrainEnrichment(null)
    setAcademicStability(null)
    academicStabilityRef.current = null
    const generation = generationRef.current
    triggeredFingerprintRef.current = sourceSelection.fingerprint

    checkExistingThenBuild(sourceSelection, generation)
  }, [sourceSelection?.fingerprint, checkExistingThenBuild])

  // Explicit recheck — user-initiated retry for partial/failed
  const recheck = useCallback(() => {
    if (!sourceSelection?.fingerprint) return

    // Force a new generation even for same fingerprint
    generationRef.current += 1
    automaticRecoveryCyclesRef.current = 0
    enrichmentAttemptsRef.current = 0
    const generation = generationRef.current
    triggeredFingerprintRef.current = sourceSelection.fingerprint

    triggerBuild(sourceSelection, generation)
  }, [sourceSelection, triggerBuild])

  // Background enrichment continuation (two-level readiness). The hub
  // is ALREADY open (status:'ready') — this just keeps nudging rich
  // enrichment forward with bounded, spaced-out requests, entirely
  // independent of the gate. Never flips status away from 'ready'.
  //
  // P0 fix ("Material Brain debe tener un final real y estable", §7):
  // this loop used to stop ONLY on `brainEnrichment === 'ready'` or on
  // an arbitrary client-side cycle cap — meaning a persistently-failing
  // leaf left `academicStability` stuck at 'preparing' on the server
  // FOREVER, with the client silently giving up and pretending nothing
  // was wrong. build.ts now gives every leaf a real, durable, per-leaf
  // enrichment budget (MAX_ENRICHMENT_ATTEMPTS_PER_LEAF, persisted on
  // the checkpoint itself) that converges to a genuine terminal
  // academicStability ('stable_rich'/'stable_degraded'/'failed') well
  // before the client cap. So the loop now stops on the SERVER'S
  // terminal verdict — never merely because the client got tired. If
  // the client cap is somehow still hit first (e.g. an unusually large
  // material), that is logged as an explicit, inspectable telemetry
  // event — never silently treated as done. `academicStability` simply
  // stays 'preparing' (the UI's existing waiting state remains
  // accurate), it is never faked into a terminal value.
  useEffect(() => {
    if (status !== 'ready' || !sourceSelection?.fingerprint) return
    if (academicStabilityRef.current && academicStabilityRef.current !== 'preparing') return // already terminal at the moment this loop would start — nothing to do
    const generation = generationRef.current
    const selection = sourceSelection
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let transportFailures = 0
    const MAX_TRANSPORT_FAILURES = 5
    // §11 defense-in-depth: after the real root cause (the effect that
    // never rescheduled itself) is fixed, this guards against a
    // DIFFERENT class of problem — the server legitimately responding
    // 200 but reporting no forward progress for many consecutive real
    // ticks (no brainEnrichment change) with no explicit reason. This
    // must never again silently produce 40+ blind "successful" polls.
    let lastBrainEnrichment: unknown = undefined
    let stagnantTicks = 0
    const MAX_STAGNANT_TICKS = 8

    console.log('[MaterialBrainLifecycle] material_brain_enrichment_continue', JSON.stringify({ fingerprint: selection.fingerprint }))

    // Self-scheduling loop — deliberately NOT driven by React's effect
    // dependency array for repeat ticks. `academicStability` stays the
    // SAME string ('preparing') across many consecutive polls; a
    // useEffect keyed on a value that doesn't change between renders is
    // simply skipped by React, so a design that relies on that value
    // changing to reschedule itself dies after exactly one iteration —
    // this was the real production stall (base build -> one enrichment
    // POST -> still 'preparing' -> no further POSTs, ever). Each tick
    // instead reschedules itself explicitly, reading the freshest
    // academicStability from a ref (never a stale closure).
    const tick = async () => {
      if (cancelled || !mountedRef.current || generationRef.current !== generation) return
      const current = academicStabilityRef.current
      if (current && current !== 'preparing') {
        console.log('[MaterialBrainLifecycle] material_brain_enrichment_terminal', JSON.stringify({ fingerprint: selection.fingerprint, academicStability: current, passes: enrichmentAttemptsRef.current }))
        return
      }
      if (enrichmentAttemptsRef.current >= MAX_ENRICHMENT_CYCLES) {
        console.warn('[MaterialBrainLifecycle] enrichment_client_cap_reached_without_terminal_state', JSON.stringify({
          fingerprint: selection.fingerprint, cycles: enrichmentAttemptsRef.current, academicStability: current,
        }))
        return
      }
      enrichmentAttemptsRef.current += 1
      // P0 diagnostic: the request body is ALWAYS exactly this shape —
      // no mode/force/continue flag exists anywhere in this client. The
      // route infers everything from persisted Brain state alone.
      console.log('[MaterialBrainLifecycle] material_brain_client_continue_request', JSON.stringify({
        fingerprint: selection.fingerprint, passNumber: enrichmentAttemptsRef.current,
      }))
      try {
        const res = await fetch('/api/material-brain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ materialIds: selection.materialIds, selectedPages: selection.selectedPages }),
        })
        if (cancelled || !mountedRef.current || generationRef.current !== generation) return
        if (!res.ok) {
          transportFailures++
          if (transportFailures >= MAX_TRANSPORT_FAILURES) {
            // §14: a run of real TRANSPORT failures (never merely leaf
            // enrichment failures, which converge to stable_degraded on
            // the server) must surface as a real, recoverable error —
            // never an infinite spinner.
            setStatus('failed')
            console.warn('[MaterialBrainLifecycle] enrichment_transport_failures_exhausted', JSON.stringify({ fingerprint: selection.fingerprint, failures: transportFailures }))
            return
          }
        } else {
          transportFailures = 0
          const data = await res.json()
          if (cancelled || !mountedRef.current || generationRef.current !== generation) return
          setPreparation(data?.preparation || null)
          setQuizRecommendation(data?.quizRecommendation || null)
          setCapabilities(data?.capabilities || null)
          setBrainEnrichment(data?.brainEnrichment ?? null)
          setAcademicStability(data?.academicStability ?? null)
          academicStabilityRef.current = data?.academicStability ?? null
          if (academicStabilityRef.current === 'preparing') {
            if (data?.brainEnrichment !== undefined && data?.brainEnrichment === lastBrainEnrichment) {
              stagnantTicks++
              if (stagnantTicks >= MAX_STAGNANT_TICKS) {
                setStatus('failed')
                console.warn('[MaterialBrainLifecycle] enrichment_stagnation_detected', JSON.stringify({
                  fingerprint: selection.fingerprint, brainEnrichment: data?.brainEnrichment, stagnantTicks,
                }))
                return
              }
            } else {
              stagnantTicks = 0
            }
            lastBrainEnrichment = data?.brainEnrichment
          }
          console.log('[MaterialBrainLifecycle] material_brain_enrichment_progress', JSON.stringify({
            fingerprint: selection.fingerprint, academicStability: academicStabilityRef.current,
            brainEnrichment: data?.brainEnrichment ?? null, passNumber: enrichmentAttemptsRef.current,
          }))
          if (academicStabilityRef.current && academicStabilityRef.current !== 'preparing') {
            console.log('[MaterialBrainLifecycle] material_brain_enrichment_terminal', JSON.stringify({ fingerprint: selection.fingerprint, academicStability: academicStabilityRef.current, passes: enrichmentAttemptsRef.current }))
            return
          }
        }
      } catch {
        transportFailures++
        if (transportFailures >= MAX_TRANSPORT_FAILURES) {
          setStatus('failed')
          console.warn('[MaterialBrainLifecycle] enrichment_transport_failures_exhausted', JSON.stringify({ fingerprint: selection.fingerprint, failures: transportFailures }))
          return
        }
      }
      if (cancelled || !mountedRef.current || generationRef.current !== generation) return
      timer = setTimeout(tick, ENRICHMENT_POLL_MS)
    }

    timer = setTimeout(tick, ENRICHMENT_POLL_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // Deliberately NOT depending on `academicStability` — see comment
    // above. The loop starts once per (status, fingerprint) transition
    // and self-perpetuates until a terminal value or a bounded failure
    // count is reached, reading the latest value via the ref each tick.
    //
    // P3 fix (real production READY->BUILDING regression): this used to
    // depend on the `sourceSelection` OBJECT itself, not its
    // `fingerprint`. materialIds/selectedPages never legitimately change
    // for a given fingerprint (the fingerprint IS their hash), but the
    // CALLER can easily hand this hook a freshly-constructed
    // `sourceSelection` object on every render (a new object literal /
    // unstable useMemo deps upstream) — a dependency on the object
    // REFERENCE then tears this effect down and restarts a brand-new
    // tick chain on every such render, exactly the same class of self-
    // scheduling-loop bug already fixed once for `academicStability`
    // above. Each restart's in-flight fetch is NOT abortable (no
    // AbortController), so a storm of redundant concurrent POSTs to the
    // SAME fingerprint went out to the server — some of which can race
    // past the server's per-isolate single-flight guard. Depending on
    // the primitive `fingerprint` instead (matching the sibling "main
    // effect" above, which already gets this right) makes the loop
    // start/restart ONLY on a genuine fingerprint change, never on
    // incidental re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sourceSelection?.fingerprint])

  return {
    status,
    fingerprint: activeFingerprint,
    preparation,
    quizRecommendation,
    capabilities,
    brainEnrichment,
    academicStability,
    recheck,
  }
}
