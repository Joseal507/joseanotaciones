'use client'

import { useEffect, useState } from 'react'
import type { SourceSelectionSnapshot } from '../adaptive/sourceSelection'
import { fetchAuthorizedSource, type AuthorizedSourceResult } from './authorizedSource'

// In-memory cache por fingerprint. Compartido entre componentes que consumen
// la misma fuente. Sobrevive unmount/remount rápidos (dev Fast Refresh,
// re-renders del padre) sin refetch.
const cache = new Map<string, AuthorizedSourceResult>()
const inFlight = new Map<string, Promise<AuthorizedSourceResult>>()

export function useAuthorizedSource(sourceSelection: SourceSelectionSnapshot | null | undefined) {
  const fingerprint = sourceSelection?.fingerprint || ''
  const [result, setResult] = useState<AuthorizedSourceResult | null>(() => {
    return fingerprint ? cache.get(fingerprint) || null : null
  })
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(() => {
    return fingerprint && cache.has(fingerprint) ? 'ready' : 'idle'
  })
  const [error, setError] = useState('')

  useEffect(() => {
    if (!sourceSelection || !fingerprint) {
      setResult(null)
      setStatus('idle')
      setError('')
      return
    }

    // Cache hit sincrónico: no refetch, no clear.
    const cached = cache.get(fingerprint)
    if (cached) {
      setResult(cached)
      setStatus('ready')
      setError('')
      return
    }

    let cancelled = false
    const controller = new AbortController()
    setError('')
    setStatus('loading')
    // NO borramos result aqui: si venia con datos viejos de otro fingerprint,
    // ya se limpiaron en el bloque de arriba. Si venimos de idle, ya es null.

    // Deduplicacion de requests concurrentes: si otra instancia ya esta
    // pidiendo el mismo fingerprint, comparte la misma promise.
    let promise = inFlight.get(fingerprint)
    if (!promise) {
      promise = fetchAuthorizedSource(sourceSelection, controller.signal)
        .then(value => {
          cache.set(fingerprint, value)
          inFlight.delete(fingerprint)
          return value
        })
        .catch(err => {
          inFlight.delete(fingerprint)
          throw err
        })
      inFlight.set(fingerprint, promise)
    }

    promise
      .then(value => {
        if (cancelled) return
        setResult(value)
        setStatus('ready')
      })
      .catch(fetchError => {
        if (cancelled || controller.signal.aborted) return
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError))
        setStatus('error')
      })

    return () => {
      cancelled = true
      // Solo abortamos si esta instancia es la unica esperando.
      // Si hay cache o hay otras instancias esperando, dejamos el fetch en curso.
      if (!cache.has(fingerprint) && !inFlight.has(fingerprint)) {
        controller.abort()
      }
    }
  }, [fingerprint])

  return { result, status, error }
}

// Export para tests: permite limpiar cache entre test runs
export function __clearAuthorizedSourceCache() {
  cache.clear()
  inFlight.clear()
}
