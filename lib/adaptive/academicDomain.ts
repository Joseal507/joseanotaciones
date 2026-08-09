export type AcademicDomain =
  | 'general_conceptual'
  | 'mathematics'
  | 'physics_quantitative'
  | 'chemistry_quantitative'
  | 'chemistry_conceptual'
  | 'biology'
  | 'medicine'
  | 'history'
  | 'language'
  | 'law'
  | 'mixed'

export type AcademicDomainSource = 'persisted' | 'content_contract'

export interface AcademicDomainResolution {
  academicDomain: AcademicDomain
  academicDomainSource: AcademicDomainSource
  academicDomainConfidence: number
  academicDomainVersion: 'academic-domain-v1'
}

const domains = new Set<AcademicDomain>([
  'general_conceptual', 'mathematics', 'physics_quantitative',
  'chemistry_quantitative', 'chemistry_conceptual', 'biology', 'medicine',
  'history', 'language', 'law', 'mixed',
])

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

export function resolveAcademicDomain(input: {
  persistedDomain?: unknown
  materialTitle?: unknown
  blocks?: Array<Record<string, unknown>>
  topics?: Array<Record<string, unknown>>
}): AcademicDomainResolution {
  const persisted = clean(input.persistedDomain) as AcademicDomain
  if (domains.has(persisted)) {
    return { academicDomain:persisted, academicDomainSource:'persisted', academicDomainConfidence:1, academicDomainVersion:'academic-domain-v1' }
  }

  const blocks = input.blocks || []
  const text = [
    clean(input.materialTitle),
    ...blocks.flatMap(block => [clean(block.label), clean(block.summary)]),
    ...(input.topics || []).flatMap(topic => [clean(topic.title), clean(topic.description)]),
  ].join(' ').toLowerCase()
  const formulaCount = blocks.filter(block => clean(block.kind) === 'formula').length
  const hasEquationContract = formulaCount > 0 || /(?:\b(?:ecuaci[oó]n|f[oó]rmula|derivada|integral|variable)\b|\\frac|[a-z]\s*=\s*-?\d)/i.test(text)
  const hasCalculationContract = /\b(?:calcula(?:r)?|c[aá]lculo|resolver una ecuaci[oó]n|compute|calculate)\b/i.test(text)
  const chemistry = /\b(?:qu[ií]mica|reacci[oó]n|mol(?:es)?|estequiometr|equilibrio qu[ií]mico)\b/i.test(text)
  const physics = /\b(?:f[ií]sica|cinem[aá]tica|din[aá]mica|fuerza|energ[ií]a|velocidad)\b/i.test(text)
  const medicine = /\b(?:medicina|m[eé]dic[oa]|diagn[oó]stico|paciente|cardiovascular)\b/i.test(text)
  const biology = /\b(?:biolog[ií]a|c[eé]lula|gen[eé]tica|ecosistema)\b/i.test(text)
  const law = /\b(?:constituci[oó]n|jur[ií]dico|derecho|ley|tribunal)\b/i.test(text)
  const language = /\b(?:gram[aá]tica|ling[uü][ií]stica|idioma|sintaxis)\b/i.test(text)
  const history = /\b(?:historiograf[ií]a|periodo hist[oó]rico|guerra|revoluci[oó]n|imperio|dinast[ií]a)\b/i.test(text)
  const conceptualDomains = [medicine, biology, law, language, history].filter(Boolean).length
  const quantitativeDomain = hasEquationContract && hasCalculationContract

  let academicDomain: AcademicDomain = 'general_conceptual'
  let confidence = 0.78
  if (quantitativeDomain && conceptualDomains > 0 && !chemistry && !physics) academicDomain = 'mixed'
  else if (chemistry) academicDomain = quantitativeDomain ? 'chemistry_quantitative' : 'chemistry_conceptual'
  else if (physics && quantitativeDomain) academicDomain = 'physics_quantitative'
  else if (quantitativeDomain) academicDomain = 'mathematics'
  else if (medicine) academicDomain = 'medicine'
  else if (biology) academicDomain = 'biology'
  else if (law) academicDomain = 'law'
  else if (language) academicDomain = 'language'
  else if (history) academicDomain = 'history'
  else confidence = 0.86

  return { academicDomain, academicDomainSource:'content_contract', academicDomainConfidence:confidence, academicDomainVersion:'academic-domain-v1' }
}

export function legacyMaterialType(domain: AcademicDomain): 'mathematical' | 'scientific' | 'historical' | 'narrative' | 'procedural' | 'general' {
  if (domain === 'mathematics' || domain === 'physics_quantitative' || domain === 'chemistry_quantitative') return 'mathematical'
  if (domain === 'history') return 'historical'
  if (domain === 'biology' || domain === 'medicine' || domain === 'chemistry_conceptual') return 'scientific'
  return 'general'
}
