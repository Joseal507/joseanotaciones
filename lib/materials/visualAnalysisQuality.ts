import type { PageContentSignalMetrics } from './pageContentSignals'

export type VisualQualityPageMetrics = Partial<PageContentSignalMetrics> & {
  visualRiskScore?: number
}

export interface VisualAnalysisQuality {
  accepted: boolean
  score: number
  reasons: string[]
  truncated: boolean
  academicSignals: {
    numericValues: number
    formulaOrSymbols: number
    structuredItems: number
    relationships: number
    labelsOrHeadings: number
  }
}

export interface EvaluateVisualAnalysisQualityInput {
  description: string
  pageMetrics?: VisualQualityPageMetrics
  finishReason?: string | null
}

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length
}

function round(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000
}

export function evaluateVisualAnalysisQuality(
  input: EvaluateVisualAnalysisQualityInput,
): VisualAnalysisQuality {
  const description = input.description.replace(/\s+/g, ' ').trim()
  const numericValues = count(description, /\b\d+(?:[.,]\d+)?(?:\s*[×x]\s*10[⁻−-]?[⁰¹²³⁴⁵⁶⁷⁸⁹\d]+)?\b/gu)
  const formulaOrSymbols = count(description, /(?:[A-Z][a-z]?(?:[₀-₉0-9]+)?){2,}|[=⇌↔→←<>≤≥±∑∫√]|\b(?:pH|pKa|Ka|Kb|kg|mg|mL|mol|m\/s|km\/h|Hz|Pa|V|W)\b/gu)
  const structuredItems = count(input.description, /(?:^|\n)\s*(?:[-*•]|\d+[.)]|[a-z][.)]|#{1,4})\s+/gimu)
    + input.description.split('\n').filter(line => (line.match(/\|/g) || []).length >= 2).length
  const relationships = count(description, /\b(?:causes?|produces?|connects?|between|increases?|decreases?|converts?|represents?|muestra|produce|conecta|entre|aumenta|disminuye|convierte|equilibrio|relaci[oó]n)\b|[→←⇌↔=<>≤≥]/giu)
  const labelsOrHeadings = count(input.description, /(?:^|\n)\s*(?:#{1,4}\s*)?[^\n:]{2,50}:\s*/gmu)
  const tokenCount = description ? description.split(/\s+/u).length : 0
  const genericLead = /^(?:here(?:'s| is)|this page|the page|page \d+|there (?:is|are)|this (?:appears|image|document)|a continuaci[oó]n|la p[aá]gina)\b/iu.test(description)
  const signalKinds = [numericValues, formulaOrSymbols, structuredItems, relationships, labelsOrHeadings]
    .filter(value => value > 0).length

  let score = description.length >= 900 ? 0.28
    : description.length >= 300 ? 0.22
      : description.length >= 120 ? 0.12
        : description.length >= 55 ? 0.06 : 0
  if (numericValues >= 2) score += 0.15
  else if (numericValues === 1) score += 0.07
  if (formulaOrSymbols >= 2) score += 0.17
  else if (formulaOrSymbols === 1) score += 0.09
  if (structuredItems >= 2) score += 0.12
  if (relationships >= 1) score += 0.12
  if (labelsOrHeadings >= 1) score += 0.08
  if (tokenCount >= 25) score += 0.08

  const visualRisk = input.pageMetrics?.visualRiskScore || 0
  const complexPage = visualRisk >= 0.5
    || (input.pageMetrics?.embeddedImageCount || 0) >= 2
    || (input.pageMetrics?.rasterEdgeDensity || 0) >= 0.04
  if (complexPage && signalKinds < 2) score -= 0.16
  if (genericLead && signalKinds === 0) score -= 0.35

  const truncated = input.finishReason === 'length'
  const threshold = complexPage ? 0.48 : 0.38
  const conciseSpecific = (formulaOrSymbols > 0 && relationships > 0)
    || (numericValues >= 2 && structuredItems >= 2)
  const accepted = (description.length >= 55 && signalKinds >= 1 && score >= threshold)
    || (description.length >= 25 && conciseSpecific && score >= 0.2)
  const reasons: string[] = []
  if (description.length >= 300) reasons.push('substantive_description')
  else if (description.length >= 55) reasons.push('limited_description')
  if (numericValues) reasons.push('numeric_values')
  if (formulaOrSymbols) reasons.push('formula_or_symbols')
  if (structuredItems) reasons.push('structured_content')
  if (relationships) reasons.push('explicit_relationships')
  if (labelsOrHeadings) reasons.push('labels_or_headings')
  if (complexPage) reasons.push('complex_page_requires_more_evidence')
  if (genericLead && signalKinds === 0) reasons.push('generic_without_academic_specificity')
  if (truncated) reasons.push('provider_length_truncation')
  reasons.push(accepted ? 'quality_threshold_met' : 'quality_threshold_not_met')

  return {
    accepted,
    score: round(score),
    reasons,
    truncated,
    academicSignals: { numericValues, formulaOrSymbols, structuredItems, relationships, labelsOrHeadings },
  }
}
