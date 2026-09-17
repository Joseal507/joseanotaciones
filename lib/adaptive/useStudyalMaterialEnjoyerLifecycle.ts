'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SourceSelectionSnapshot } from './sourceSelection'

// ============================================================
// StudyalMaterialEnjoyer — Phase 2 client lifecycle hook.
//
// This is Free Mode's hub-entry counterpart to
// lib/materialBrain/useMaterialBrainLifecycle.ts, but for the SHARED
// analysis authority instead of Material Brain:
//
//   1. GET /api/adaptive/blueprint (lookup-only — never generates).
//   2. If missing, POST /api/adaptive/blueprint ONCE — the SAME
//      existing Adaptive blueprint generation route Phase 1 already
//      made restore-first/persisted. No new prompt, no second
//      pipeline.
//
// Unlike Material Brain's lifecycle, there is no polling/background
// enrichment loop here: the blueprint route's generation is a single
// synchronous call that returns a final result (ready/failed), so
// this hook's state machine is deliberately simpler:
// idle -> checking -> (ready | generating -> ready | failed)
// ============================================================

export type MaterialEnjoyerLifecycleStatus = 'idle' | 'checking' | 'generating' | 'ready' | 'failed'

export interface MaterialEnjoyerLifecycle {
  status: MaterialEnjoyerLifecycleStatus
  fingerprint: string | null
  blueprint: any | null
  quality: any | null
  error: string | null
  recheck: () => void
}

export function useStudyalMaterialEnjoyerLifecycle(
  sourceSelection: SourceSelectionSnapshot | null,
  materials: { materialId: string; materialName: string }[],
): MaterialEnjoyerLifecycle {
  const [status, setStatus] = useState<MaterialEnjoyerLifecycleStatus>('idle')
  const [fingerprint, setFingerprint] = useState<string | null>(null)
  const [blueprint, setBlueprint] = useState<any | null>(null)
  const [quality, setQuality] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)

  const triggeredFingerprintRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  const materialsRef = useRef(materials)
  materialsRef.current = materials

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const run = useCallback(async (selection: SourceSelectionSnapshot) => {
    const targetFingerprint = selection.fingerprint
    try {
      const params = new URLSearchParams({
        materialIds: JSON.stringify(selection.materialIds),
        selectedPages: JSON.stringify(selection.selectedPages),
        fingerprint: targetFingerprint,
      })
      const getRes = await fetch(`/api/adaptive/blueprint?${params.toString()}`, {
        method: 'GET', credentials: 'same-origin',
      })
      const getJson = await getRes.json().catch(() => null)
      if (!mountedRef.current || triggeredFingerprintRef.current !== targetFingerprint) return

      if (getRes.ok && getJson?.status === 'ready' && getJson.blueprint?.sourceSelectionFingerprint === targetFingerprint) {
        setBlueprint(getJson.blueprint)
        setQuality(getJson.quality || null)
        setStatus('ready')
        return
      }

      // Missing for this exact fingerprint — generate ONCE via the
      // existing Adaptive blueprint pipeline (never a duplicate
      // prompt/pipeline). materials' `text` is intentionally left
      // empty; the route already resolves text/PDF server-side when
      // the client doesn't supply it (the same behavior
      // StudyALAdaptive.tsx's own generateBlueprint() already relies on).
      setStatus('generating')
      const postRes = await fetch('/api/adaptive/blueprint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          materials: materialsRef.current.map(m => ({
            materialId: m.materialId,
            materialName: m.materialName,
            text: '',
            selectedPages: selection.selectedPages[m.materialId] || [],
          })),
          sourceSelection: selection,
          requireExplicitPageSelection: true,
        }),
      })
      const postJson = await postRes.json().catch(() => null)
      if (!mountedRef.current || triggeredFingerprintRef.current !== targetFingerprint) return

      if (!postRes.ok || !postJson?.success) {
        setStatus('failed')
        setError(postJson?.error || `HTTP_${postRes.status}`)
        return
      }
      const returnedFingerprint = postJson.blueprint?.sourceSelectionFingerprint
      if (returnedFingerprint !== targetFingerprint) {
        setStatus('failed')
        setError('SOURCE_SELECTION_FINGERPRINT_MISMATCH')
        return
      }
      setBlueprint(postJson.blueprint)
      setQuality(postJson.quality || null)
      setStatus('ready')
    } catch (err: any) {
      if (!mountedRef.current || triggeredFingerprintRef.current !== targetFingerprint) return
      setStatus('failed')
      setError(err?.message || String(err))
    }
  }, [])

  useEffect(() => {
    if (!sourceSelection?.fingerprint || sourceSelection.materialIds.length === 0) {
      setStatus('idle')
      setFingerprint(null)
      setBlueprint(null)
      setQuality(null)
      setError(null)
      triggeredFingerprintRef.current = null
      return
    }
    // A DIFFERENT fingerprint must never keep/reuse the previous one's
    // result — reset immediately, then trigger a fresh check.
    if (triggeredFingerprintRef.current === sourceSelection.fingerprint) return
    triggeredFingerprintRef.current = sourceSelection.fingerprint
    setFingerprint(sourceSelection.fingerprint)
    setBlueprint(null)
    setQuality(null)
    setError(null)
    setStatus('checking')
    run(sourceSelection)
  }, [sourceSelection?.fingerprint, run])

  // Explicit user-initiated retry (e.g. a 'failed' state's Retry
  // button) — forces a fresh GET-then-POST cycle for the CURRENT
  // sourceSelection even though its fingerprint was already
  // "triggered". Never used to re-fire the same request twice for a
  // fingerprint that already succeeded.
  const recheck = useCallback(() => {
    if (!sourceSelection?.fingerprint) return
    triggeredFingerprintRef.current = sourceSelection.fingerprint
    setBlueprint(null)
    setQuality(null)
    setError(null)
    setStatus('checking')
    run(sourceSelection)
  }, [sourceSelection, run])

  return { status, fingerprint, blueprint, quality, error, recheck }
}
