import type { SourceSelectionSnapshot } from '../adaptive/sourceSelection'

export interface AuthorizedSourceMaterial {
  materialId: string
  selectedPages: number[]
  text: string
  nombre: string
  kind: string
  chars: number
}

export interface AuthorizedSourceResult {
  fingerprint: string
  materials: Record<string, AuthorizedSourceMaterial>
  combinedText: string
  totalChars: number
}

export async function fetchAuthorizedSource(
  sourceSelection: SourceSelectionSnapshot,
  signal?: AbortSignal,
): Promise<AuthorizedSourceResult> {
  const response = await fetch('/api/enfoques/teorico/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    signal,
    body: JSON.stringify({ sourceSelection }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.success !== true) {
    throw new Error(String(payload?.error || `AUTHORIZED_SOURCE_FAILED:${response.status}`))
  }
  if (payload?.sourceSelectionFingerprint !== sourceSelection.fingerprint) {
    throw new Error('AUTHORIZED_SOURCE_FINGERPRINT_MISMATCH')
  }
  const materials = payload.materials as Record<string, AuthorizedSourceMaterial>
  const combinedText = sourceSelection.materials.map((selection, index) => {
    const material = materials?.[selection.materialId]
    if (!material?.text) throw new Error(`AUTHORIZED_SOURCE_MISSING:${selection.materialId}`)
    const scope = selection.selectedPages.length
      ? `páginas ${selection.selectedPages.join(', ')}`
      : 'documento completo'
    return `[Material ${index + 1}: ID=${selection.materialId} | ${material.nombre || selection.materialId} | ${scope}]\n${material.text}`
  }).join('\n\n---\n\n')
  return {
    fingerprint: sourceSelection.fingerprint,
    materials,
    combinedText,
    totalChars: Number(payload.totalChars || combinedText.length),
  }
}

export function sourceScopedKey(
  namespace: string,
  sourceSelection: SourceSelectionSnapshot,
  options: { sessionId?: string | null; temaId?: string | null; userId?: string | null } = {},
): string {
  return [namespace, options.userId || 'user', options.temaId || 'tema', options.sessionId || 'session', sourceSelection.fingerprint]
    .map(value => String(value).replace(/[^a-zA-Z0-9_-]/g, '_'))
    .join('_')
}
