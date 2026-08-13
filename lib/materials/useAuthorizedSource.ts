'use client'

import { useEffect, useState } from 'react'
import type { SourceSelectionSnapshot } from '../adaptive/sourceSelection'
import { fetchAuthorizedSource, type AuthorizedSourceResult } from './authorizedSource'

export function useAuthorizedSource(sourceSelection: SourceSelectionSnapshot | null | undefined) {
  const [result, setResult] = useState<AuthorizedSourceResult | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState('')
  const fingerprint = sourceSelection?.fingerprint || ''

  useEffect(() => {
    if (!sourceSelection || !fingerprint) {
      setResult(null)
      setStatus('idle')
      return
    }
    const controller = new AbortController()
    setResult(null)
    setError('')
    setStatus('loading')
    fetchAuthorizedSource(sourceSelection, controller.signal)
      .then(value => {
        setResult(value)
        setStatus('ready')
      })
      .catch(fetchError => {
        if (controller.signal.aborted) return
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError))
        setStatus('error')
      })
    return () => controller.abort()
  }, [fingerprint])

  return { result, status, error }
}
