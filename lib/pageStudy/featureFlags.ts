/**
 * Feature flag for Page Study (Estudio por Páginas).
 * Controlled via NEXT_PUBLIC_PAGE_STUDY_ENABLED.
 * When disabled (anything other than 'true'), Page Study is locked in the UI,
 * direct navigation is rejected, and server API routes return 403 PAGE_STUDY_DISABLED.
 */
export function isPageStudyEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PAGE_STUDY_ENABLED === 'true'
}
