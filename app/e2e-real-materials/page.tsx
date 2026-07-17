'use client'

import { useEffect, useState } from 'react'

type Result = {
  file: { name: string; type: string; size: number; multipart: { contentType: string; hasBoundary: boolean; requestBytes: number } }
  server: { receivedName: string; receivedType: string; receivedSize: number; bufferLength: number; extractionChars: number; extractionKind: string; sourceName: string; provider: string; openRouterUsed: boolean }
  extraction: { text: string; chars: number; pages?: number; method: string; hasText: boolean; classification?: string }
  graph: { sourceName: string; totalMicros: number; micros: Array<{ id: string; name: string }>; identityTokens: string[] }
  layer: Record<string, string>
}

export default function RealMaterialsHarness() {
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => setReady(true), [])

  async function ingest(file: File) {
    setLoading(true); setError(''); setResult(null)
    const form = new FormData(); form.append('file', file)
    const response = await fetch('/api/e2e-real-materials/extract', { method: 'POST', body: form })
    const data = await response.json()
    if (!response.ok) setError(data.error || 'Extraction failed')
    else setResult(data)
    setLoading(false)
  }

  return <main data-testid="real-materials-harness" style={{ padding: 32, fontFamily: 'sans-serif' }}>
    <h1>Real materials E2E harness</h1>
    {ready && <span data-testid="real-materials-ready" hidden>ready</span>}
    <p data-testid="layer-disclosure">Upload real · extracción local real · grafo determinista derivado</p>
    <input data-testid="material-upload" type="file" accept=".pdf,.docx" disabled={!ready} onChange={event => {
      const file = event.target.files?.[0]; if (file) void ingest(file)
    }} />
    {loading && <p data-testid="ingestion-loading">Extrayendo…</p>}
    {error && <p role="alert">{error}</p>}
    {result && <section data-testid="ingestion-result" data-source-name={result.graph.sourceName}>
      <h2 data-testid="material-name">{result.file.name}</h2>
      <dl>
        <dt>Tipo</dt><dd data-testid="material-type">{result.file.type}</dd>
        <dt>Tamaño</dt><dd data-testid="material-size">{result.file.size}</dd>
        <dt>Multipart</dt><dd data-testid="multipart-boundary">{String(result.file.multipart.hasBoundary)}</dd>
        <dt>Bytes request</dt><dd data-testid="multipart-request-bytes">{result.file.multipart.requestBytes}</dd>
        <dt>Nombre recibido</dt><dd data-testid="server-received-name">{result.server.receivedName}</dd>
        <dt>Tipo recibido</dt><dd data-testid="server-received-type">{result.server.receivedType}</dd>
        <dt>Tamaño recibido</dt><dd data-testid="server-received-size">{result.server.receivedSize}</dd>
        <dt>Bytes leídos</dt><dd data-testid="server-buffer-length">{result.server.bufferLength}</dd>
        <dt>Caracteres servidor</dt><dd data-testid="server-extraction-chars">{result.server.extractionChars}</dd>
        <dt>Fuente servidor</dt><dd data-testid="server-source-name">{result.server.sourceName}</dd>
        <dt>Proveedor</dt><dd data-testid="extraction-provider">{result.server.provider}</dd>
        <dt>Tipo extracción</dt><dd data-testid="extraction-kind">{result.server.extractionKind}</dd>
        <dt>OpenRouter usado</dt><dd data-testid="openrouter-used">{String(result.server.openRouterUsed)}</dd>
        <dt>Método</dt><dd data-testid="extraction-method">{result.extraction.method}</dd>
        <dt>Clasificación</dt><dd data-testid="extraction-classification">{result.extraction.classification ?? 'not_applicable'}</dd>
        <dt>Caracteres</dt><dd data-testid="extraction-chars">{result.extraction.chars}</dd>
        <dt>Páginas</dt><dd data-testid="extraction-pages">{result.extraction.pages ?? 'n/a'}</dd>
      </dl>
      <div data-testid="extracted-text">{result.extraction.text.slice(0, 4000)}</div>
      <ul data-testid="graph-micros">{result.graph.micros.map(micro => <li key={micro.id}>{micro.name}</li>)}</ul>
      <div data-testid="identity-tokens">{result.graph.identityTokens.join(' ')}</div>
    </section>}
  </main>
}
