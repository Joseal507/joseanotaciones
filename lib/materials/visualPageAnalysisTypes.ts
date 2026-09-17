export type VisualPageAnalysisStatus =
  | 'success'
  | 'partial'
  | 'no_content'
  | 'failed'
  | 'no_api_key'

export interface VisualPageAnalysisResult {
  materialId?: string
  page: number
  status: VisualPageAnalysisStatus
  text: string
  visualDescription: string
  derivation: 'vision'
  provider: string
  model: string
  attempts: number
  finishReason?: string
  quality?: import('./visualAnalysisQuality').VisualAnalysisQuality
  analyzerVersion: string
  promptVersion: string
  error?: string
  /** Reserved for a future page-level cache key. */
  contentFingerprint?: string
  /** Reserved for a future page-level cache key. */
  pageFingerprint?: string
}

export interface VisualPageProviderRequest {
  pdfBuffer: Buffer
  page: number
  maxTokens: number
  apiKey: string
}

export interface VisualPageProviderResponse {
  text: string
  finishReason?: string | null
}

export type VisualPageProvider = (
  request: VisualPageProviderRequest,
) => Promise<string | VisualPageProviderResponse>
